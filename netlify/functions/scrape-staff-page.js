// scrape-staff-page.js — Netlify function
// Takes { url }, fetches page via ScrapingBee with JS rendering, returns extracted text
// The coach-updater then passes this text to parse-staff-page for Haiku extraction

const fetch = require("node-fetch");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };

  const SB_KEY = process.env.SCRAPINGBEE_KEY;
  if (!SB_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing SCRAPINGBEE_KEY env var" }) };

  try {
    const { url } = JSON.parse(event.body);
    if (!url || url.length < 5) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "URL is required" }) };
    }

    // Normalize URL
    let targetUrl = url.trim();
    if (!targetUrl.startsWith("http")) targetUrl = "https://" + targetUrl;

    console.log(`Scraping: ${targetUrl}`);

    // ── Try ScrapingBee with JS rendering ──
    const sbParams = new URLSearchParams({
      api_key: SB_KEY,
      url: targetUrl,
      render_js: "true",
      wait_browser: "networkidle2",
      block_ads: "true",
      block_resources: "false",
      timeout: "30000",
    });

    const sbRes = await fetch(`https://app.scrapingbee.com/api/v1?${sbParams.toString()}`, {
      timeout: 35000,
    });

    if (!sbRes.ok) {
      const errText = await sbRes.text().catch(() => "");
      console.error(`ScrapingBee error: ${sbRes.status} ${errText.slice(0, 200)}`);

      // If ScrapingBee fails, try a basic fetch as fallback
      console.log("Falling back to basic fetch...");
      return await basicFetch(targetUrl, headers);
    }

    const html = await sbRes.text();
    console.log(`ScrapingBee returned ${html.length} chars`);

    if (!html || html.length < 100) {
      return { statusCode: 200, headers, body: JSON.stringify({ 
        text: "", 
        chars: 0, 
        method: "scrapingbee",
        warning: "Page returned very little content. Try pasting manually." 
      })};
    }

    const text = htmlToText(html);
    console.log(`Extracted ${text.length} chars of text`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        text,
        chars: text.length,
        method: "scrapingbee",
        warning: text.length < 100 ? "Very little text extracted. The page may require manual copy-paste." : null,
      }),
    };

  } catch (e) {
    console.error("scrape-staff-page error:", e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

/**
 * Basic fetch fallback (no JS rendering)
 */
async function basicFetch(url, headers) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 15000,
    });

    if (!res.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ 
        text: "", 
        chars: 0, 
        method: "basic",
        warning: `Page returned HTTP ${res.status}. Try pasting content manually.` 
      })};
    }

    const html = await res.text();
    const text = htmlToText(html);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        text,
        chars: text.length,
        method: "basic",
        warning: text.length < 100 ? "Basic fetch returned little text. This site likely needs JS rendering — try pasting content manually." : null,
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ 
      text: "", 
      chars: 0, 
      method: "basic",
      warning: `Could not fetch page: ${e.message}. Try pasting content manually.` 
    })};
  }
}

/**
 * Convert HTML to clean text, preserving structure useful for Haiku parsing
 */
function htmlToText(html) {
  let text = html;

  // Remove script, style, nav, footer, header blocks
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Convert block elements to newlines
  text = text.replace(/<\/?(?:div|p|br|hr|li|tr|h[1-6]|section|article|aside|dd|dt|figcaption|blockquote)[^>]*>/gi, "\n");

  // Convert table cells to tabs (preserves table structure for Haiku)
  text = text.replace(/<\/?(td|th)[^>]*>/gi, "\t");

  // Extract href from mailto links (preserve email addresses)
  text = text.replace(/<a[^>]*href\s*=\s*["']mailto:([^"'?]+)[^"']*["'][^>]*>[^<]*<\/a>/gi, " $1 ");

  // Extract href from tel links (preserve phone numbers)
  text = text.replace(/<a[^>]*href\s*=\s*["']tel:([^"']+)["'][^>]*>[^<]*<\/a>/gi, " $1 ");

  // Extract Twitter/X handles from links
  text = text.replace(/<a[^>]*href\s*=\s*["']https?:\/\/(?:twitter|x)\.com\/(@?[\w]+)["'][^>]*>[^<]*<\/a>/gi, " @$1 ");

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ");

  // Clean up whitespace
  text = text.replace(/\t+/g, "\t");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/^[\s\n]+|[\s\n]+$/g, "");

  // Cap at 12000 chars (Haiku handles ~8000 but we want buffer for the user to review)
  if (text.length > 12000) {
    text = text.slice(0, 12000) + "\n\n[... truncated ...]";
  }

  return text;
}
