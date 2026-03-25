// netlify/functions/deploy-site.js
// Deploys a generated athlete site to Netlify as a live subdomain
// Called from the admin panel when you hit "Publish"

const SUPABASE_URL = "https://ildcajsjreayvinutwyr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;

const crypto = require("crypto");

// ── Supabase helper ──
async function supaFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Supabase: ${err.message || err.msg || res.statusText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Netlify API helper ──
async function netlifyApi(path, opts = {}) {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${NETLIFY_TOKEN}`,
      "Content-Type": opts.contentType || "application/json",
      ...opts.headers,
    },
    body: opts.rawBody || (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Netlify API: ${err.message || res.statusText} (${res.status})`);
  }
  return res.json();
}

// ── SHA1 hash ──
function sha1(content) {
  return crypto.createHash("sha1").update(content).digest("hex");
}

// ── Slugify for subdomain ──
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!NETLIFY_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "NETLIFY_TOKEN not configured. Add it in Netlify environment variables." }) };
  }

  try {
    const { site_id } = JSON.parse(event.body);
    if (!site_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "site_id required" }) };
    }

    // 1. Get the site record from Supabase
    const sites = await supaFetch(`/rest/v1/sites?id=eq.${site_id}&select=*`);
    if (!sites?.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Site not found" }) };
    }
    const site = sites[0];

    if (!site.generated_html) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No generated HTML to deploy" }) };
    }

    const slug = slugify(site.athlete_name || "athlete");
    const preferredName = site.domain_pref ? slugify(site.domain_pref.replace(/\.(com|net|me|org)$/i, "")) : slug;

    // 2. Check if this site already has a Netlify site ID (re-deploy vs first deploy)
    let netlifySiteId = site.netlify_site_id;
    let siteUrl;

    // If we have a URL but no site ID (from a partial previous deploy), look up the site
    if (!netlifySiteId && site.site_url) {
      const urlMatch = site.site_url.match(/https?:\/\/([^.]+)\.netlify\.app/);
      if (urlMatch) {
        try {
          const existing = await netlifyApi(`/sites/${urlMatch[1]}.netlify.app`);
          if (existing?.id) {
            netlifySiteId = existing.id;
            siteUrl = existing.ssl_url || existing.url;
            console.log("Found site from existing URL:", siteUrl);
          }
        } catch (e) { console.log("URL lookup failed:", e.message); }
      }
    }

    if (netlifySiteId) {
      // Re-deploy to existing site
      console.log("Re-deploying to existing Netlify site:", netlifySiteId);
    } else {
      // Try to find an existing site with this name first (in case it was created manually)
      console.log("Looking for existing Netlify site:", preferredName);
      try {
        const existing = await netlifyApi(`/sites/${preferredName}.netlify.app`);
        if (existing?.id) {
          netlifySiteId = existing.id;
          siteUrl = existing.ssl_url || existing.url;
          console.log("Found existing site:", siteUrl);
        }
      } catch (e) {
        console.log("No existing site found, creating new...");
      }

      if (!netlifySiteId) {
        // Create a new Netlify site — try preferred name, then with suffix if taken
        const tryCreate = async (name) => {
          const newSite = await netlifyApi("/sites", {
            method: "POST",
            body: { name },
          });
          return newSite;
        };

        try {
          const newSite = await tryCreate(preferredName);
          netlifySiteId = newSite.id;
          siteUrl = newSite.ssl_url || newSite.url;
        } catch (e) {
          // Name taken — try with random suffix
          console.log("Name taken, trying with suffix...");
          const suffix = Math.random().toString(36).slice(2, 6);
          try {
            const newSite = await tryCreate(preferredName + "-" + suffix);
            netlifySiteId = newSite.id;
            siteUrl = newSite.ssl_url || newSite.url;
          } catch (e2) {
            throw new Error(`Could not create Netlify site: ${e2.message}`);
          }
        }
        console.log("Created site:", siteUrl);
      }
    }

    // 3. Deploy the HTML file
    const htmlContent = site.generated_html;
    const htmlHash = sha1(htmlContent);

    // Create deploy with file manifest
    const deploy = await netlifyApi(`/sites/${netlifySiteId}/deploys`, {
      method: "POST",
      body: {
        files: {
          "/index.html": htmlHash,
        },
      },
    });

    console.log("Deploy created:", deploy.id, "- uploading files...");

    // Upload the HTML file
    await netlifyApi(`/deploys/${deploy.id}/files/index.html`, {
      method: "PUT",
      contentType: "application/octet-stream",
      rawBody: htmlContent,
    });

    console.log("File uploaded, deploy processing...");

    // Get the final site URL
    const deployedSite = await netlifyApi(`/sites/${netlifySiteId}`);
    siteUrl = deployedSite.ssl_url || deployedSite.url;

    // 4. Update Supabase with deploy info
    await supaFetch(`/rest/v1/sites?id=eq.${site_id}`, {
      method: "PATCH",
      body: {
        status: "published",
        site_url: siteUrl,
        netlify_site_id: netlifySiteId,
      },
    });

    // 5. Update the invite code with the site URL (so dashboard shows it)
    if (site.invite_code) {
      try {
        await supaFetch(`/rest/v1/invite_codes?code=eq.${encodeURIComponent(site.invite_code)}&select=id`, {
          method: "GET",
        }).then(async (codes) => {
          if (codes?.length) {
            await supaFetch(`/rest/v1/invite_codes?id=eq.${codes[0].id}`, {
              method: "PATCH",
              body: { athlete_site_url: siteUrl },
            });
          }
        });
      } catch (e) {
        console.log("Invite code URL update:", e.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        site_url: siteUrl,
        netlify_site_id: netlifySiteId,
        deploy_id: deploy.id,
      }),
    };
  } catch (error) {
    console.error("deploy-site error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
