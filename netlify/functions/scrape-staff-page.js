// scrape-staff-page.js — Netlify function
// Fetches an athletics staff page URL and returns cleaned text for parsing
// Supports Sidearm/PrestoSports JS-rendered sites via ScrapingBee

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

    const SB_KEY = process.env.SCRAPINGBEE_API_KEY;
    let html = "";
    let usedScrapingBee = false;

    // Try ScrapingBee first (handles JS-rendered sites like Sidearm/PrestoSports)
    if (SB_KEY) {
      console.log("Scraping with ScrapingBee (JS rendering):", url);
      const sbParams = new URLSearchParams({
        api_key: SB_KEY,
        url: url,
        render_js: "true",
        wait_browser: "networkidle2",
        wait: "3000",
        block_ads: "true",
        block_resources: "false",
      });

      try {
        const sbRes = await fetch(`https://app.scrapingbee.com/api/v1?${sbParams.toString()}`);
        if (sbRes.ok) {
          html = await sbRes.text();
          usedScrapingBee = true;
          console.log("ScrapingBee success, got", html.length, "chars of HTML");
        } else {
          const sbErr = await sbRes.text().catch(() => "");
          console.log(`ScrapingBee returned ${sbRes.status}: ${sbErr.slice(0, 200)}`);
        }
      } catch (sbError) {
        console.log("ScrapingBee fetch error:", sbError.message);
      }
    }

    // Fall back to direct fetch if no ScrapingBee key or if it failed
    if (!html) {
      console.log("Direct fetch:", url);
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

    // Detect JS-only sites (Sidearm, PrestoSports, etc.)
    const jsRequired = /javascript\s+is\s+required/i.test(html) ||
      (/sidearm/i.test(html) && !/<staff|<person|<coach/i.test(html));

    if (jsRequired && !usedScrapingBee) {
      const noKeyMsg = !SB_KEY
        ? "Add SCRAPINGBEE_API_KEY to your Netlify environment variables to scrape JS-rendered sites."
        : "ScrapingBee failed to render this page.";
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          text: "",
          warning: `This is a Sidearm/JS-rendered site. Direct fetch can't see the staff data. ${noKeyMsg} For now, open the page in your browser, select all the coach content, copy it, and paste it into the text area.`,
        }),
      };
    }

    // Clean HTML to readable text
    const text = cleanHtml(html);

    if (text.length < 100) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          text,
          warning: "Very little content extracted. Try opening the page in your browser, selecting all coach content, and pasting it manually.",
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        text,
        chars: text.length,
        method: usedScrapingBee ? "scrapingbee" : "direct",
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

// Strip HTML to clean text, preserving structure for coach parsing
function cleanHtml(html) {
  let text = html;

  // Remove script, style, noscript, svg, iframe tags and their content
  text = text.replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Remove nav elements and their content (site menus bloat the text)
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");

  // Remove header elements (site header, not content headers)
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");

  // Remove footer elements
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

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

  // Remove common nav/menu junk text patterns
  text = text.replace(/Opens in a new window/g, "");
  text = text.replace(/Skip To Main Content/g, "");

  // Clean up whitespace
  text = text.replace(/\t+/g, "\t");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/^[\s\n]+|[\s\n]+$/g, "");

  // Limit to 12000 chars
  if (text.length > 12000) {
    text = text.slice(0, 12000) + "\n\n[... truncated ...]";
  }

  return text;
}
