// save-coaches.js — Netlify function
// Deletes existing coaches for a college_id (optionally filtered by sport), inserts new ones

const PP_URL = "https://ildcajsjreayvinutwyr.supabase.co";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };

  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing SUPABASE_SERVICE_KEY" }) };

  try {
    const { college_id, coaches, delete_sports } = JSON.parse(event.body);

    if (!college_id) return { statusCode: 400, headers, body: JSON.stringify({ error: "college_id required" }) };
    if (!coaches || !coaches.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "No coaches to save" }) };

    const supaHeaders = {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
    };

    // Delete existing coaches for this college
    // If delete_sports is provided, only delete those sports (partial update)
    // Otherwise delete ALL coaches for this college (full replace)
    let deleteUrl = `${PP_URL}/rest/v1/coaches?college_id=eq.${college_id}`;
    if (delete_sports && delete_sports.length > 0) {
      deleteUrl += `&sport=in.(${delete_sports.map(s => `"${s}"`).join(",")})`;
    }

    const delRes = await fetch(deleteUrl, {
      method: "DELETE",
      headers: { ...supaHeaders, Prefer: "return=representation" },
    });
    const deleted = delRes.ok ? (await delRes.json()) : [];

    // Insert new coaches
    const rows = coaches.map((c) => ({
      college_id,
      name: c.name,
      title: c.title || null,
      sport: c.sport || null,
      email: c.email && c.email !== "null" ? c.email : null,
      phone: c.phone && c.phone !== "null" ? c.phone : null,
      is_recruiting_contact: c.is_recruiting_contact || false,
      flagged_outdated: false,
      verified_at: new Date().toISOString(),
    }));

    // Batch insert (Supabase handles arrays)
    const insRes = await fetch(`${PP_URL}/rest/v1/coaches`, {
      method: "POST",
      headers: { ...supaHeaders, Prefer: "return=representation" },
      body: JSON.stringify(rows),
    });

    if (!insRes.ok) {
      const err = await insRes.text().catch(() => "");
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Insert failed: ${err.slice(0, 300)}` }) };
    }

    const inserted = await insRes.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        deleted: deleted.length,
        inserted: inserted.length,
        sports: [...new Set(rows.map((r) => r.sport))],
      }),
    };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
