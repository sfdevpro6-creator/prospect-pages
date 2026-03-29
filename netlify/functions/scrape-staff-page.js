// scrape-staff-page.js — Netlify function
// Takes { url }, fetches page via ScrapingBee with JS rendering, returns extracted text
// The coach-updater then passes this text to parse-staff-page for Haiku extraction
// Uses built-in fetch (Node 18+)

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };

  const SB_KEY = process.env.SCRAPINGBEE_API_KEY || process.env.SCRAPINGBEE_KEY;
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    const sbRes = await fetch(`https://app.scrapingbee.com/api/v1?${sbParams.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

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
 * Convert HTML to clean text, preserving structure useful for Haiku parsing.
 * Smart extraction: tries to find the staff directory table/content first,
 * strips navigation menus and cruft aggressively.
 */
function htmlToText(html) {
  let text = html;

  // ── STEP 1: Try to extract just the staff table/content area ──
  // Sidearm sites wrap the directory in a specific container
  const staffSection = findStaffSection(html);
  if (staffSection && staffSection.length > 200) {
    text = staffSection;
  }

  // ── STEP 2: Remove junk blocks ──
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

  // Remove menus and dropdowns (common Sidearm patterns)
  text = text.replace(/<ul[^>]*class="[^"]*(?:menu|nav|dropdown)[^"]*"[^>]*>[\s\S]*?<\/ul>/gi, "");

  // ── STEP 3: Extract structured content ──
  // Extract href from mailto links (preserve email addresses)
  text = text.replace(/<a[^>]*href\s*=\s*["']mailto:([^"'?]+)[^"']*["'][^>]*>[^<]*<\/a>/gi, " $1 ");

  // Extract href from tel links (preserve phone numbers)
  text = text.replace(/<a[^>]*href\s*=\s*["']tel:([^"']+)["'][^>]*>[^<]*<\/a>/gi, " $1 ");

  // Extract Twitter/X handles from links
  text = text.replace(/<a[^>]*href\s*=\s*["']https?:\/\/(?:twitter|x)\.com\/(@?[\w]+)["'][^>]*>[^<]*<\/a>/gi, " @$1 ");

  // Convert block elements to newlines
  text = text.replace(/<\/?(?:div|p|br|hr|li|tr|h[1-6]|section|article|aside|dd|dt|figcaption|blockquote)[^>]*>/gi, "\n");

  // Convert table cells to tabs (preserves table structure for Haiku)
  text = text.replace(/<\/?(td|th)[^>]*>/gi, "\t");

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

  // ── STEP 4: Remove common nav/menu text lines ──
  const navJunkLines = /^\s*(Skip To Main Content|Pause All Rotators|Opens in new window|Opens in a new window|Search Button|Keyword Search|Filter By|All Categories|Main Navigation Menu|Search:|Print)\s*$/gmi;
  text = text.replace(navJunkLines, "");

  // Remove standalone single-word nav items that are just link text
  const standaloneNavWords = /^\s*(Schedule|Roster|News|Tickets|Facebook|Instagram|YouTube|Twitter|X)\s*$/gmi;
  text = text.replace(standaloneNavWords, "");

  // ── STEP 5: Clean up whitespace ──
  text = text.replace(/\t+/g, "\t");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/^[\s\n]+|[\s\n]+$/g, "");

  // Cap at 12000 chars
  if (text.length > 12000) {
    text = text.slice(0, 12000) + "\n\n[... truncated ...]";
  }

  return text;
}

/**
 * Try to find the main staff directory content section in the HTML.
 * Sidearm sites use specific class names and ID patterns.
 */
function findStaffSection(html) {
  // Try common patterns for staff directory content areas

  // Pattern 1: Sidearm staff directory table
  const tableMatch = html.match(/<table[^>]*class="[^"]*sidearm-table[^"]*"[^>]*>[\s\S]*?<\/table>/i);
  if (tableMatch) return tableMatch[0];

  // Pattern 2: Any table that contains "staff-directory" links
  const staffTableMatch = html.match(/<table[^>]*>[\s\S]*?staff-directory[\s\S]*?<\/table>/i);
  if (staffTableMatch && staffTableMatch[0].length > 500) return staffTableMatch[0];

  // Pattern 3: Main content area with role="main" or id="main-content"
  const mainMatch = html.match(/<main[^>]*>[\s\S]*?<\/main>/i)
    || html.match(/<div[^>]*id="main-content"[^>]*>[\s\S]*?<\/div>\s*<(?:footer|div[^>]*class="[^"]*footer)/i)
    || html.match(/<div[^>]*role="main"[^>]*>[\s\S]*?<\/div>\s*<(?:footer|div[^>]*class="[^"]*footer)/i);
  if (mainMatch) return mainMatch[0];

  // Pattern 4: Content between "Staff Directory" heading and footer
  const headingMatch = html.match(/<h[12][^>]*>\s*Staff Directory\s*<\/h[12]>([\s\S]*?)(?:<footer|<div[^>]*class="[^"]*footer)/i);
  if (headingMatch) return headingMatch[0];

  // Pattern 5: Content starting from "Members By Category" (Sidearm specific)
  const categoryMatch = html.match(/Members By Category[\s\S]*?(?:<footer|<\/body)/i);
  if (categoryMatch) return categoryMatch[0];

  // No specific section found — return null to use full page
  return null;
}
