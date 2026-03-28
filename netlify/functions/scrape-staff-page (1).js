// scrape-staff-page.js — Netlify function
// Fetches an athletics staff page URL and returns cleaned text for parsing

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };

  try {
    const { url } = JSON.parse(event.body);
    if (!url || !url.startsWith("http")) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Valid URL required" }) };
    }

    // Try ScrapingBee first (handles JS-rendered sites like Sidearm/PrestoSports)
    const SB_KEY = process.env.SCRAPINGBEE_API_KEY;
    let html = "";

    if (SB_KEY) {
      const sbParams = new URLSearchParams({
        api_key: SB_KEY,
        url: url,
        render_js: "true",
        wait_browser: "networkidle2",
        block_ads: "true",
        block_resources: "false",
      });

      const sbRes = await fetch(`https://app.scrapingbee.com/api/v1?${sbParams.toString()}`);
      if (sbRes.ok) {
        html = await sbRes.text();
      } else {
        // ScrapingBee failed — fall back to direct fetch
        console.log(`ScrapingBee returned ${sbRes.status}, falling back to direct fetch`);
      }
    }

    // Fall back to direct fetch if no ScrapingBee key or if it failed
    if (!html) {
      const directRes = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!directRes.ok) {
        return { statusCode: 502, headers, body: JSON.stringify({ error: `Failed to fetch page: ${directRes.status} ${directRes.statusText}` }) };
      }

      html = await directRes.text();
    }

    // Clean HTML to readable text
    const text = cleanHtml(html);

    if (text.length < 50) {
      return { statusCode: 200, headers, body: JSON.stringify({ text, warning: "Very little text extracted. This site may require JavaScript rendering. Try pasting the page content manually." }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ text, chars: text.length }) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

// Strip HTML to clean text, preserving structure
function cleanHtml(html) {
  let text = html;

  // Remove script, style, nav, footer, header tags and their content
  text = text.replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Convert common block elements to newlines
  text = text.replace(/<\/?(div|p|br|hr|li|tr|h[1-6]|section|article|aside|dd|dt|figcaption|blockquote)[^>]*>/gi, "\n");

  // Convert table cells to tabs
  text = text.replace(/<\/?(td|th)[^>]*>/gi, "\t");

  // Extract href from mailto links (preserve email addresses)
  text = text.replace(/<a[^>]*href\s*=\s*["']mailto:([^"'?]+)[^"']*["'][^>]*>[^<]*<\/a>/gi, " $1 ");

  // Extract href from tel links
  text = text.replace(/<a[^>]*href\s*=\s*["']tel:([^"']+)["'][^>]*>[^<]*<\/a>/gi, " $1 ");

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&")
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

  // Limit to 12000 chars (Haiku can handle ~8000 but we want buffer for the user to see)
  if (text.length > 12000) {
    text = text.slice(0, 12000) + "\n\n[... truncated ...]";
  }

  return text;
}
