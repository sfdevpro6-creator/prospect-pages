// save-coaches.js — Netlify function
// Deletes existing coaches for a college_id, inserts new ones

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

  const supaFetch = async (path, method, body) => {
    const opts = {
      method,
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        Prefer: "return=representation",
      },
    };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${PP_URL}${path}`, opts);
    const text = await res.text();
    console.log(`${method} ${path} -> ${res.status} (${text.length} chars)`);
    if (!res.ok) throw new Error(`Supabase ${method} ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : [];
  };

  try {
    const { college_id, coaches, delete_sports } = JSON.parse(event.body);

    if (!college_id) return { statusCode: 400, headers, body: JSON.stringify({ error: "college_id required" }) };
    if (!coaches || !coaches.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "No coaches to save" }) };

    console.log(`Save request: college_id=${college_id}, coaches=${coaches.length}, delete_sports=${JSON.stringify(delete_sports)}`);

    // Step 1: Count existing coaches (diagnostic)
    let existingCount = 0;
    try {
      const countRes = await fetch(`${PP_URL}/rest/v1/coaches?college_id=eq.${college_id}&select=id`, {
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
      });
      const existing = await countRes.json();
      existingCount = Array.isArray(existing) ? existing.length : 0;
      console.log(`Existing coaches for college_id=${college_id}: ${existingCount}`);
    } catch (e) {
      console.log("Count check failed:", e.message);
    }

    // Step 2: Delete existing coaches if in replace mode
    let deletedCount = 0;
    const shouldDelete = delete_sports && delete_sports.length > 0;

    if (shouldDelete && existingCount > 0) {
      const deleted = await supaFetch(`/rest/v1/coaches?college_id=eq.${college_id}`, "DELETE");
      deletedCount = Array.isArray(deleted) ? deleted.length : 0;
      console.log(`Deleted ${deletedCount} coaches`);

      // Verify the delete actually worked
      if (deletedCount === 0 && existingCount > 0) {
        console.error("DELETE returned 0 rows but we expected", existingCount);
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({
            error: `Delete appeared to succeed but 0 rows were removed (expected ${existingCount}). This may be a permissions issue with the Supabase service key.`,
          }),
        };
      }
    } else if (shouldDelete) {
      console.log("Replace mode but no existing coaches found - skipping delete");
    }

    // Step 3: Deduplicate coaches by name (case-insensitive)
    const seen = new Set();
    const uniqueCoaches = coaches.filter((c) => {
      const key = (c.name || "").toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    console.log(`Deduped: ${coaches.length} -> ${uniqueCoaches.length} unique coaches`);

    // Step 4: Insert new coaches
    const rows = uniqueCoaches.map((c) => ({
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

    const inserted = await supaFetch("/rest/v1/coaches", "POST", rows);
    const insertedCount = Array.isArray(inserted) ? inserted.length : 0;
    console.log(`Inserted ${insertedCount} coaches`);

    // Step 5: Stamp college as verified via Coach Updater
    try {
      await fetch(`${PP_URL}/rest/v1/colleges?id=eq.${college_id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ updater_verified_at: new Date().toISOString() }),
      });
      console.log(`Stamped college ${college_id} as updater-verified`);
    } catch (e) {
      console.log(`Warning: could not stamp college: ${e.message}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        deleted: deletedCount,
        inserted: insertedCount,
        existing_before: existingCount,
        sports: [...new Set(rows.map((r) => r.sport))],
      }),
    };
  } catch (e) {
    console.error("save-coaches error:", e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
