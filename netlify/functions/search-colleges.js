// search-colleges.js — Netlify function
// Searches the colleges table for the coach updater admin tool

const PP_URL = "https://ildcajsjreayvinutwyr.supabase.co";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing SUPABASE_SERVICE_KEY" }) };

  try {
    const q = (event.queryStringParameters?.q || "").trim();
    if (!q || q.length < 2) return { statusCode: 200, headers, body: JSON.stringify([]) };

    const res = await fetch(
      `${PP_URL}/rest/v1/colleges?select=id,name,state,division,conference&name=ilike.*${encodeURIComponent(q)}*&limit=15&order=name.asc`,
      {
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
        },
      }
    );

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Supabase ${res.status}: ${err.slice(0, 200)}` }) };
    }

    const colleges = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(colleges) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
