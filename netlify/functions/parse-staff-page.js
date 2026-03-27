// parse-staff-page.js — Netlify function
// Takes raw staff page text + sport context, sends to Claude Haiku, returns structured JSON

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }) };

  try {
    const { raw_text, school_name } = JSON.parse(event.body);
    if (!raw_text || raw_text.length < 20) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Paste at least a few lines of staff page content" }) };
    }

    const prompt = `You are parsing a college athletics coaching staff page into structured data.

SCHOOL: ${school_name || "Unknown"}

RAW STAFF PAGE CONTENT:
${raw_text.slice(0, 8000)}

Parse every coach/staff member into structured JSON. Respond ONLY with valid JSON, no markdown, no backticks, no explanation. Format:

{
  "coaches": [
    {
      "name": "Full Name",
      "title": "Their Title",
      "sport": "sport_key",
      "email": "email@school.edu or null",
      "phone": "phone or null"
    }
  ],
  "sports_found": ["baseball", "basketball", "football"],
  "total_parsed": 12,
  "notes": "Any issues or ambiguities"
}

SPORT KEY RULES (use these exact keys):
- baseball, basketball, basketball_w, football, soccer, soccer_w
- softball, volleyball, track, cross_country, swimming
- tennis, tennis_w, golf, golf_w, gymnastics, wrestling
- lacrosse, lacrosse_w, rowing, field_hockey
- If you see "Men's Basketball" → "basketball", "Women's Basketball" → "basketball_w"
- If you see "Men's Soccer" → "soccer", "Women's Soccer" → "soccer_w"
- If gender is ambiguous for a sport that has both, default to the base key
- Track & Field / Cross Country → "track"
- Swimming & Diving → "swimming"

PARSING RULES:
- Extract EVERY person listed, including support staff, GAs, trainers, operations
- If an email appears on the same line or near a name, associate it
- Ignore social media links (Twitter, Instagram handles)
- Ignore phone numbers in the title area (those are office numbers)
- If the raw text has multiple sports, parse them all and tag correctly
- Names like "Opens in a new window" or navigation text are NOT coaches — skip them
- Respond ONLY with JSON`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Haiku API ${res.status}: ${err.slice(0, 200)}` }) };
    }

    const result = await res.json();
    const text = result.content?.[0]?.text || "";
    const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(clean);

    // Deduplicate by name (case-insensitive) — pasted text often has repeats
    if (parsed.coaches && Array.isArray(parsed.coaches)) {
      const seen = new Set();
      parsed.coaches = parsed.coaches.filter((c) => {
        const key = (c.name || "").toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      parsed.total_parsed = parsed.coaches.length;
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
