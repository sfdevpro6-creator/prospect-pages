// netlify/functions/deploy-site.js
// Deploys a generated athlete site to Netlify as a live subdomain
// Called from the admin panel when you hit "Publish"

const SUPABASE_URL = "https://ildcajsjreayvinutwyr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const NETLIFY_TOKEN = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;

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

// ── Look up profile photos via invite_code ──
async function getProfilePhotos(inviteCode) {
  if (!inviteCode) return null;
  try {
    // Find the user who claimed this invite code
    const codes = await supaFetch(
      `/rest/v1/invite_codes?code=eq.${encodeURIComponent(inviteCode)}&select=used_by`
    );
    if (!codes?.length || !codes[0].used_by) return null;

    const userId = codes[0].used_by;
    const profiles = await supaFetch(
      `/rest/v1/profiles?id=eq.${userId}&select=hero_photo_url,headshot_url,additional_photos`
    );
    if (!profiles?.length) return null;
    return profiles[0];
  } catch (e) {
    console.log("Profile photo lookup:", e.message);
    return null;
  }
}

// ── Inject photos into generated HTML ──
function injectPhotos(html, photos) {
  if (!photos) return html;
  let result = html;

  // 1. Hero photo — replace placeholder in photo card
  if (photos.hero_photo_url) {
    result = result.replace(
      /<!-- PP-HERO-PHOTO -->[\s\S]*?<!-- \/PP-HERO-PHOTO -->/,
      `<!-- PP-HERO-PHOTO -->\n    <div class="hero-photo-card">\n      <img src="${photos.hero_photo_url}" alt="Athlete action photo">\n    </div>\n    <!-- /PP-HERO-PHOTO -->`
    );
    // Fallback for legacy sites without PP-HERO-PHOTO markers
    if (!result.includes('PP-HERO-PHOTO')) {
      result = result.replace(
        /<div class="photo-placeholder">Photo Coming Soon<\/div>/,
        `<img src="${photos.hero_photo_url}" alt="Athlete action photo">`
      );
    }
  }

  // 2. Headshot — replace placeholder or existing headshot
  if (photos.headshot_url) {
    result = result.replace(
      /<div class="about-photo reveal">(?:PHOTO COMING SOON|<img[^>]*>)<\/div>/,
      `<div class="about-photo reveal"><img src="${photos.headshot_url}" alt="Athlete headshot"></div>`
    );
  }

  // 3. Additional photos — inject gallery before the footer if any exist
  const additionalPhotos = photos.additional_photos || [];
  if (additionalPhotos.length > 0) {
    const galleryCards = additionalPhotos
      .filter((p) => p && p.url)
      .map(
        (p) =>
          `<div class="gallery-item"><img src="${p.url}" alt="${p.caption || "Photo"}" loading="lazy"></div>`
      )
      .join("\n      ");

    const gallerySection = `
<!-- PHOTO GALLERY -->
<section id="gallery" style="padding:6rem 0;">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">Gallery</div>
      <h2 class="section-title">PHOTOS</h2>
    </div>
    <div class="gallery-grid reveal" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
      ${galleryCards}
    </div>
  </div>
</section>`;

    const galleryStyles = `
.gallery-item {
  border-radius: 4px; overflow: hidden; border: 1px solid var(--border);
  transition: transform 0.3s, border-color 0.3s;
}
.gallery-item:hover { transform: translateY(-4px); border-color: rgba(255,255,255,0.12); }
.gallery-item img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; }`;

    // Inject styles before </style>
    result = result.replace("</style>", galleryStyles + "\n</style>");

    // Inject gallery section before footer
    result = result.replace("<!-- FOOTER -->", gallerySection + "\n\n<!-- FOOTER -->");

    // Add Gallery nav link if not already there
    if (!result.includes('href="#gallery"')) {
      result = result.replace(
        '<a href="#contact" class="nav-cta">Contact</a>',
        '<a href="#gallery">Gallery</a>\n    <a href="#contact" class="nav-cta">Contact</a>'
      );
    }
  }

  return result;
}

// ── Inject PP markers into legacy HTML that was generated without them ──
function injectPPMarkers(html) {
  let result = html;

  // PP-HERO-STATS
  if (!result.includes('<!-- PP-HERO-STATS -->')) {
    result = result.replace(
      /(<div class="hero-stats">)/,
      '<!-- PP-HERO-STATS -->\n    $1'
    );
    result = result.replace(
      /(<\/div>\s*<div class="hero-cta-group">)/,
      '</div>\n    <!-- /PP-HERO-STATS -->\n    <div class="hero-cta-group">'
    );
  }

  // PP-PERF-STATS
  if (!result.includes('<!-- PP-PERF-STATS -->')) {
    result = result.replace(
      /(<div class="stats-grid">)/,
      '<!-- PP-PERF-STATS -->\n    $1'
    );
    // Close after the stats-grid div (before the container close in stats section)
    result = result.replace(
      /(<\/div>\s*<\/div>\s*<\/section>\s*<!-- HIGHLIGHTS -->)/,
      '</div>\n    <!-- /PP-PERF-STATS -->\n  </div>\n</section>\n\n<!-- HIGHLIGHTS -->'
    );
  }

  // PP-INFO
  if (!result.includes('<!-- PP-INFO -->')) {
    result = result.replace(
      /(<div class="about-info-grid[^>]*>)/,
      '<!-- PP-INFO -->\n        $1'
    );
    result = result.replace(
      /(<\/div>\s*<div class="about-bio reveal">)/,
      '</div>\n        <!-- /PP-INFO -->\n        <div class="about-bio reveal">'
    );
  }

  // PP-FILM
  if (!result.includes('<!-- PP-FILM -->')) {
    result = result.replace(
      /(<div class="film-placeholder reveal")/,
      '<!-- PP-FILM -->\n    $1'
    );
    result = result.replace(
      /(GAME FILM COMING SOON<\/h3>[\s\S]*?<\/div>\s*<\/div>\s*<\/section>\s*<!-- ABOUT -->)/,
      'GAME FILM COMING SOON</h3>\n      <p style="max-width:400px; margin:0 auto; line-height:1.7; font-size:0.95rem;">Log in to your Prospect Pages dashboard to upload and manage your highlight clips.</p>\n    </div>\n    <!-- /PP-FILM -->\n  </div>\n</section>\n\n<!-- ABOUT -->'
    );
  }

  return result;
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: "NETLIFY_AUTH_TOKEN not configured. Add it in Netlify environment variables." }) };
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
    let htmlContent = site.generated_html;

    // 3a. Inject PP markers if missing (legacy sites generated before markers were added)
    htmlContent = injectPPMarkers(htmlContent);

    // 3b. Look up profile photos and inject into HTML
    const profilePhotos = await getProfilePhotos(site.invite_code);
    if (profilePhotos) {
      console.log("Injecting photos:", {
        hero: !!profilePhotos.hero_photo_url,
        headshot: !!profilePhotos.headshot_url,
        additional: (profilePhotos.additional_photos || []).length,
      });
      htmlContent = injectPhotos(htmlContent, profilePhotos);
    }

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

    // Upload the HTML file (direct fetch — matches publish-site.js)
    const uploadRes = await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}/files/index.html`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${NETLIFY_TOKEN}`,
        "Content-Type": "application/octet-stream",
      },
      body: htmlContent,
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.text().catch(() => "");
      throw new Error(`File upload failed (${uploadRes.status}): ${err.slice(0, 200)}`);
    }

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
