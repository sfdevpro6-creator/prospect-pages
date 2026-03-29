// parse-staff-page.js — Netlify function
// Takes raw staff page text + school name, sends to Claude Haiku, returns structured coach JSON

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

    const prompt = `You are parsing a college athletics staff directory page into structured coaching data.

SCHOOL: ${school_name || "Unknown"}

RAW STAFF PAGE CONTENT:
${raw_text.slice(0, 25000)}

Extract ONLY coaching staff. Respond with valid JSON only — no markdown, no backticks, no explanation.

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
  "sports_found": ["basketball", "basketball_w", "volleyball"],
  "total_parsed": 12,
  "notes": "Any issues"
}

WHO TO INCLUDE (coaching staff only):
- Head Coach, Associate Head Coach, Assistant Coach
- Coordinators (Offensive/Defensive/Recruiting Coordinator)
- Volunteer Assistant Coach, Graduate Assistant Coach
- Director of Operations (for a specific sport)
- Pitching Coach, Hitting Coach, Quarterbacks Coach, Goalkeepers Coach, etc.

WHO TO EXCLUDE (skip these completely):
- Director of Athletics, Associate/Assistant AD (unless they also coach a sport)
- Athletic Trainers, Sports Medicine staff
- Sports Information Directors, Media Relations
- Strength & Conditioning coaches (not sport-specific)
- Marketing, Ticketing, Business, Compliance, Academic staff
- Faculty Athletic Representatives
- Administrative Assistants, Fiscal staff
- Student interns, student managers

SPORT TAGGING — ONLY extract coaches for these 7 sports, skip all others:
- baseball
- softball
- football
- soccer (use "soccer" for men's, "soccer_w" for women's)
- track (includes Track & Field, Cross Country, XC)
- basketball (use "basketball" for men's, "basketball_w" for women's)
- volleyball

IGNORE coaches for all other sports entirely — do NOT include ice hockey, skiing, swimming, gymnastics, rifle, golf, tennis, lacrosse, rowing, wrestling, field hockey, or any sport not in the 7 above.

Use the page's category/section headers to determine sport:
- The page groups staff by department like "Men's Basketball", "Women's Volleyball", etc.
- "Men's Basketball" → basketball, "Women's Basketball" → basketball_w
- "Men's Soccer" → soccer, "Women's Soccer" → soccer_w
- "Track & Field" or "Cross Country" or "Men's and Women's Cross Country" → track
- If a coach appears under "Administration" but their title says "Head Baseball Coach", tag as baseball
- If you cannot determine the sport OR the sport is not one of the 7 above, SKIP that coach entirely

CRITICAL: Only return coaches for these 7 sports. Every coach MUST have a sport tag from the list above. Do NOT return coaches with null or "unknown" sport.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8000,
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

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (jsonErr) {
      // Try to salvage truncated JSON
      const lastComplete = clean.lastIndexOf("},");
      if (lastComplete > 0) {
        const salvaged = clean.slice(0, lastComplete + 1) + '], "sports_found": [], "total_parsed": 0, "notes": "Response was truncated — some coaches may be missing"}';
        try {
          parsed = JSON.parse(salvaged);
        } catch (e2) {
          throw new Error("Haiku returned invalid JSON. Try a sport-specific page instead of the full staff directory.");
        }
      } else {
        throw new Error("Haiku returned invalid JSON. Try a sport-specific page instead of the full staff directory.");
      }
    }

    // Deduplicate by name+sport (case-insensitive)
    const PP_SPORTS = new Set(["baseball", "softball", "football", "soccer", "soccer_w", "track", "basketball", "basketball_w", "volleyball"]);

    if (parsed.coaches && Array.isArray(parsed.coaches)) {
      // Filter to PP sports only
      parsed.coaches = parsed.coaches.filter(c => c.sport && PP_SPORTS.has(c.sport));

      // Deduplicate
      const seen = new Set();
      parsed.coaches = parsed.coaches.filter((c) => {
        const key = `${(c.name || "").toLowerCase().trim()}|${(c.sport || "").toLowerCase().trim()}`;
        if (!c.name || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      parsed.total_parsed = parsed.coaches.length;

      // Rebuild sports_found from actual data
      parsed.sports_found = [...new Set(parsed.coaches.map(c => c.sport).filter(Boolean))];
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
