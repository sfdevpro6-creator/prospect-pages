// netlify/functions/generate-site.js
// Receives intake form data, stores in Supabase, generates bio via Claude, builds HTML site

const SUPABASE_URL = "https://ildcajsjreayvinutwyr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Service role key for admin operations
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
    throw new Error(`Supabase error: ${err.message || err.msg || res.statusText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Generate bio via Claude Haiku ──
async function generateBio(data) {
  const prompt = `You are writing the bio section for a high school athlete's college recruiting website. Write a compelling, confident, and authentic 2-3 paragraph bio in third person. No fluff, no cliches about "grinding" or "hustle." Write like a real human parent would talk about their kid to a coach. Keep it grounded and relatable.

ATHLETE INFO:
- Name: ${data.athlete_name}
- Sport: ${data.sport}
- Position: ${data.position || "N/A"}
- School: ${data.high_school || "N/A"}, ${data.city_state || "N/A"}
- Grad Year: ${data.grad_year || "N/A"}
- Height: ${data.height || "N/A"}, Weight: ${data.weight || "N/A"}
- ${data.hand_label || "Bats/Throws"}: ${data.hand_detail || "N/A"}
- GPA: ${data.gpa || "N/A"}
- Travel Team: ${data.travel_team || "N/A"}

STORY ANSWERS FROM PARENT:
How they got started: ${data.story_how_started || "Not provided"}
What drives them: ${data.story_what_drives || "Not provided"}
Proud moment: ${data.story_proud_moment || "Not provided"}
Goals: ${data.story_goals || "Not provided"}
Off the field: ${data.story_personality || "Not provided"}
Extra details: ${data.story_extra || "Not provided"}

ACHIEVEMENTS:
${data.achievements || "None listed"}

Write ONLY the bio paragraphs. No headers, no labels, no intro. Just the bio text. Use <strong> tags around the athlete's name the first time it appears. Make the first paragraph about who they are as a player, the second about their journey/drive, and optionally a third about academics/character if there's enough info.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Anthropic API ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const result = await response.json();
  return result.content?.[0]?.text || "";
}

// ── Generate invite code ──
function makeInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "PP-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Slugify athlete name for URLs ──
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Build stat cards HTML ──
function buildStatCards(data) {
  const stats = [];
  for (let i = 1; i <= 8; i++) {
    const label = data[`stat_${i}_label`];
    const value = data[`stat_${i}_value`];
    if (label && value) stats.push({ label, value });
  }
  if (stats.length === 0) return "<!-- No stats provided -->";

  return `<div class="stats-grid">
${stats.map((s, i) => `      <div class="stat-card reveal">
        <div class="stat-number">${escHtml(s.value)}</div>
        <div class="stat-label">${escHtml(s.label)}</div>
        <div class="stat-season">Current</div>
      </div>`).join("\n")}
    </div>`;
}

// ── Build achievements HTML ──
function buildAchievements(text) {
  if (!text || !text.trim()) return "<!-- No achievements provided -->";
  const items = text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  const icons = ["🏆", "⭐", "📰", "🎯", "🥇", "📚", "💪", "🏅"];
  return `<div class="achievements-grid">
${items.map((item, i) => `      <div class="achievement-card reveal">
        <div class="achievement-icon">${icons[i % icons.length]}</div>
        <div class="achievement-text">
          <h4>${escHtml(item)}</h4>
        </div>
      </div>`).join("\n")}
    </div>`;
}

// ── Build hero stats ──
function buildHeroStats(data) {
  const items = [];
  if (data.height) items.push({ value: data.height, label: "Height" });
  if (data.weight) items.push({ value: data.weight, label: "Weight (lbs)" });
  if (data.hand_detail) items.push({ value: data.hand_detail, label: data.hand_label || "Bats / Throws" });
  if (data.gpa) items.push({ value: data.gpa, label: "GPA" });
  return items.map(s => `      <div class="hero-stat">
        <div class="hero-stat-value">${escHtml(s.value)}</div>
        <div class="hero-stat-label">${escHtml(s.label)}</div>
      </div>`).join("\n");
}

// ── Build contact section ──
function buildContactItems(data) {
  let html = "";
  if (data.athlete_email) {
    html += `<div class="contact-item">
          <div class="contact-item-icon"><svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>
          <div>
            <div class="contact-item-label">Email</div>
            <div class="contact-item-value"><a href="mailto:${escAttr(data.athlete_email)}">${escHtml(data.athlete_email)}</a></div>
          </div>
        </div>`;
  }
  if (data.athlete_phone || data.parent_phone) {
    const phone = data.athlete_phone || data.parent_phone;
    const label = data.athlete_phone ? "Phone" : "Phone (Parent)";
    html += `<div class="contact-item">
          <div class="contact-item-icon"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>
          <div>
            <div class="contact-item-label">${label}</div>
            <div class="contact-item-value"><a href="tel:${escAttr(phone)}">${escHtml(phone)}</a></div>
          </div>
        </div>`;
  }
  if (data.city_state) {
    html += `<div class="contact-item">
          <div class="contact-item-icon"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
          <div>
            <div class="contact-item-label">Location</div>
            <div class="contact-item-value">${escHtml(data.city_state)}</div>
          </div>
        </div>`;
  }
  if (data.athlete_twitter) {
    html += `<div class="contact-item">
          <div class="contact-item-icon"><svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></div>
          <div>
            <div class="contact-item-label">Twitter / X</div>
            <div class="contact-item-value"><a href="https://twitter.com/${escAttr(data.athlete_twitter.replace('@',''))}">${escHtml(data.athlete_twitter)}</a></div>
          </div>
        </div>`;
  }
  if (data.athlete_instagram) {
    html += `<div class="contact-item">
          <div class="contact-item-icon"><svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg></div>
          <div>
            <div class="contact-item-label">Instagram</div>
            <div class="contact-item-value"><a href="https://instagram.com/${escAttr(data.athlete_instagram.replace('@',''))}">${escHtml(data.athlete_instagram)}</a></div>
          </div>
        </div>`;
  }

  // Coach references
  if (data.hs_coach_name || data.travel_coach_name) {
    html += `<div style="margin-top:1.5rem; padding-top:1.5rem; border-top:1px solid rgba(255,255,255,0.06);">
          <div style="font-family:var(--font-condensed); font-size:0.65rem; font-weight:600; letter-spacing:0.25em; text-transform:uppercase; color:var(--accent); margin-bottom:0.8rem;">Coach References</div>`;
    if (data.hs_coach_name) {
      html += `<div class="contact-item" style="border-bottom:none; padding-bottom:0;">
            <div class="contact-item-icon"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
            <div>
              <div class="contact-item-label">HS Coach${data.high_school ? " — " + escHtml(data.high_school) : ""}</div>
              <div class="contact-item-value">${escHtml(data.hs_coach_name)}</div>
              ${data.hs_coach_contact ? `<div class="contact-item-value" style="margin-top:0.2rem;"><a href="${data.hs_coach_contact.includes('@') ? 'mailto:' : 'tel:'}${escAttr(data.hs_coach_contact)}">${escHtml(data.hs_coach_contact)}</a></div>` : ""}
            </div>
          </div>`;
    }
    if (data.travel_coach_name) {
      html += `<div class="contact-item" style="border-bottom:none; padding-bottom:0; margin-top:0.8rem;">
            <div class="contact-item-icon"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
            <div>
              <div class="contact-item-label">Travel Coach${data.travel_team ? " — " + escHtml(data.travel_team) : ""}</div>
              <div class="contact-item-value">${escHtml(data.travel_coach_name)}</div>
              ${data.travel_coach_contact ? `<div class="contact-item-value" style="margin-top:0.2rem;"><a href="${data.travel_coach_contact.includes('@') ? 'mailto:' : 'tel:'}${escAttr(data.travel_coach_contact)}">${escHtml(data.travel_coach_contact)}</a></div>` : ""}
            </div>
          </div>`;
    }
    html += `</div>`;
  }
  return html;
}

// ── HTML escaping ──
function escHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Sport display name ──
function sportName(sport) {
  const map = { baseball: "Baseball", softball: "Softball", basketball: "Basketball", football: "Football", soccer: "Soccer", volleyball: "Volleyball", track: "Track & Field" };
  return map[sport] || sport;
}

// ── Format bio into HTML paragraphs ──
function formatBio(bio) {
  if (!bio || !bio.trim()) return "<p><em>Bio coming soon.</em></p>";
  // Strip any script/iframe/event handler tags for safety (Claude shouldn't produce these, but just in case)
  let safe = bio.replace(/<script[\s\S]*?<\/script>/gi, "")
               .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
               .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");
  // Split by double newlines into paragraphs
  const paragraphs = safe.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "<p><em>Bio coming soon.</em></p>";
  // If Claude returned a single block, try splitting by single newlines that look like paragraph breaks
  if (paragraphs.length === 1 && paragraphs[0].length > 300) {
    const singles = paragraphs[0].split(/\n/).map(p => p.trim()).filter(Boolean);
    if (singles.length > 1) return singles.map(p => `<p>${p}</p>`).join("\n          ");
  }
  return paragraphs.map(p => `<p>${p}</p>`).join("\n          ");
}

// ── Build the full athlete site HTML ──
function buildSiteHtml(data, bio) {
  const name = data.athlete_name || "Athlete";
  const firstName = name.split(" ")[0];
  const sport = sportName(data.sport);
  const slug = slugify(name);
  const taglineParts = [data.position, data.city_state].filter(Boolean);
  const tagline = taglineParts.join(" &bull; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(name)} | ${escHtml(sport)}</title>
<meta name="description" content="${escHtml(name)} – ${escHtml(sport)} Player Recruiting Profile. Game film, stats, progression timeline, and contact information for college coaches.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg-primary: #0a0a0c;
  --bg-secondary: #111116;
  --bg-card: #16161c;
  --bg-card-hover: #1c1c24;
  --text-primary: #f0ece4;
  --text-secondary: #9a968e;
  --text-muted: #5c5952;
  --accent: #e63a2e;
  --accent-glow: rgba(230, 58, 46, 0.25);
  --accent-secondary: #ff6b3d;
  --gold: #c9a84c;
  --white: #ffffff;
  --border: rgba(255,255,255,0.06);
  --font-display: 'Bebas Neue', sans-serif;
  --font-body: 'Barlow', sans-serif;
  --font-condensed: 'Barlow Condensed', sans-serif;
}
html { scroll-behavior: smooth; }
body {
  font-family: var(--font-body);
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

/* NAV */
nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  padding: 1.25rem 3rem;
  display: flex; align-items: center; justify-content: space-between;
  background: rgba(10,10,12,0.85);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
  transition: all 0.4s ease;
}
nav.scrolled { padding: 0.8rem 3rem; background: rgba(10,10,12,0.95); }
.nav-logo {
  font-family: var(--font-display); font-size: 1.6rem;
  letter-spacing: 0.08em; color: var(--text-primary); text-decoration: none;
}
.nav-logo span { color: var(--accent); }
.nav-links { display: flex; gap: 2rem; align-items: center; }
.nav-links a {
  font-family: var(--font-condensed); font-size: 0.85rem; font-weight: 600;
  letter-spacing: 0.15em; text-transform: uppercase;
  color: var(--text-secondary); text-decoration: none; transition: color 0.3s; position: relative;
}
.nav-links a::after {
  content: ''; position: absolute; bottom: -4px; left: 0;
  width: 0; height: 2px; background: var(--accent); transition: width 0.3s ease;
}
.nav-links a:hover { color: var(--text-primary); }
.nav-links a:hover::after { width: 100%; }
.nav-cta {
  background: var(--accent) !important; color: var(--white) !important;
  padding: 0.55rem 1.4rem !important; border-radius: 2px;
  transition: background 0.3s, transform 0.3s !important;
}
.nav-cta::after { display: none !important; }
.nav-cta:hover { background: #cf2f24 !important; transform: translateY(-1px); }
.nav-toggle {
  display: none; background: none; border: none; cursor: pointer;
  flex-direction: column; gap: 5px; padding: 4px;
}
.nav-toggle span { width: 24px; height: 2px; background: var(--text-primary); transition: 0.3s; }

/* HERO */
.hero {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  position: relative; overflow: hidden;
}
.hero-bg {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, #0d0d12 0%, #1a1018 50%, #0d0d12 100%);
}
.hero-bg::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(to bottom, rgba(10,10,12,0.45) 0%, rgba(10,10,12,0.75) 50%, var(--bg-primary) 100%);
}
.hero-overlay-lines {
  position: absolute; inset: 0; opacity: 0.04;
  background: repeating-linear-gradient(90deg, transparent, transparent 120px, rgba(255,255,255,0.5) 120px, rgba(255,255,255,0.5) 121px);
}
.hero-content {
  position: relative; z-index: 2; text-align: left; padding-left: 6%; max-width: 60%;
  animation: heroFadeIn 1.2s ease-out;
}
@keyframes heroFadeIn {
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
}
.hero-eyebrow {
  font-family: var(--font-condensed); font-weight: 600; font-size: 0.85rem;
  letter-spacing: 0.35em; text-transform: uppercase; color: var(--accent);
  margin-bottom: 1.2rem; display: flex; align-items: center; justify-content: flex-start; gap: 1rem;
}
.hero-eyebrow::before, .hero-eyebrow::after { content: ''; width: 40px; height: 1px; background: var(--accent); }
.hero-name {
  font-family: var(--font-display); font-size: clamp(4rem, 12vw, 10rem);
  line-height: 0.9; letter-spacing: 0.04em; color: var(--white); margin-bottom: 0.5rem;
}
.hero-tagline {
  font-family: var(--font-condensed); font-size: clamp(1.1rem, 2.5vw, 1.6rem);
  font-weight: 400; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--text-secondary); margin-bottom: 2.5rem;
}
.hero-stats { display: flex; gap: 3rem; justify-content: flex-start; flex-wrap: wrap; margin-bottom: 3rem; }
.hero-stat { text-align: center; }
.hero-stat-value { font-family: var(--font-display); font-size: 2.8rem; color: var(--white); line-height: 1; }
.hero-stat-label {
  font-family: var(--font-condensed); font-size: 0.7rem; letter-spacing: 0.25em;
  text-transform: uppercase; color: var(--text-muted); margin-top: 0.3rem;
}
.hero-cta-group { display: flex; gap: 1rem; justify-content: flex-start; flex-wrap: wrap; }
.btn-primary {
  font-family: var(--font-condensed); font-weight: 700; font-size: 0.85rem;
  letter-spacing: 0.18em; text-transform: uppercase; padding: 1rem 2.5rem;
  background: var(--accent); color: var(--white); border: none; cursor: pointer;
  text-decoration: none; transition: all 0.3s; position: relative; overflow: hidden;
}
.btn-primary:hover { background: #cf2f24; transform: translateY(-2px); box-shadow: 0 8px 30px var(--accent-glow); }
.btn-secondary {
  font-family: var(--font-condensed); font-weight: 700; font-size: 0.85rem;
  letter-spacing: 0.18em; text-transform: uppercase; padding: 1rem 2.5rem;
  background: transparent; color: var(--text-primary); border: 1px solid rgba(255,255,255,0.2);
  cursor: pointer; text-decoration: none; transition: all 0.3s;
}
.btn-secondary:hover { border-color: var(--text-primary); background: rgba(255,255,255,0.04); }
.scroll-indicator {
  position: absolute; bottom: 2.5rem; left: 50%; transform: translateX(-50%);
  z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
  animation: scrollBounce 2s infinite;
}
.scroll-indicator span {
  font-family: var(--font-condensed); font-size: 0.65rem; letter-spacing: 0.3em;
  text-transform: uppercase; color: var(--text-muted);
}
.scroll-arrow { width: 20px; height: 20px; border-right: 1.5px solid var(--text-muted); border-bottom: 1.5px solid var(--text-muted); transform: rotate(45deg); }
@keyframes scrollBounce {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  50% { transform: translateX(-50%) translateY(8px); }
}

/* SECTIONS */
section { padding: 6rem 0; }
.container { max-width: 1200px; margin: 0 auto; padding: 0 2rem; }
.section-header { margin-bottom: 4rem; }
.section-label {
  font-family: var(--font-condensed); font-weight: 600; font-size: 0.75rem;
  letter-spacing: 0.35em; text-transform: uppercase; color: var(--accent); margin-bottom: 0.8rem;
}
.section-title {
  font-family: var(--font-display); font-size: clamp(2.5rem, 5vw, 4rem);
  letter-spacing: 0.03em; color: var(--white); line-height: 1;
}
.section-subtitle { font-size: 1rem; color: var(--text-secondary); margin-top: 1rem; max-width: 600px; line-height: 1.7; }

/* ABOUT */
#about { background: var(--bg-secondary); }
.about-grid { display: grid; grid-template-columns: 340px 1fr; gap: 4rem; align-items: start; }
.about-photo {
  width: 100%; aspect-ratio: 3/4; background: var(--bg-card); border: 1px solid var(--border);
  position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;
  color: var(--text-muted); font-family: var(--font-condensed); font-size: 0.8rem;
  letter-spacing: 0.15em; text-transform: uppercase;
}
.about-photo img { width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; }
.about-photo::before {
  content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 40%;
  background: linear-gradient(to top, var(--bg-secondary), transparent); z-index: 1;
}
.about-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 2rem; }
.info-card {
  background: var(--bg-card); border: 1px solid var(--border); padding: 1.2rem 1.5rem;
  transition: border-color 0.3s;
}
.info-card:hover { border-color: rgba(255,255,255,0.12); }
.info-card-label {
  font-family: var(--font-condensed); font-size: 0.65rem; font-weight: 600;
  letter-spacing: 0.25em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.4rem;
}
.info-card-value {
  font-family: var(--font-condensed); font-size: 1.1rem; font-weight: 700;
  color: var(--text-primary); letter-spacing: 0.02em;
}
.about-bio { font-size: 1.05rem; line-height: 1.8; color: var(--text-secondary); margin-top: 1.5rem; }
.about-bio strong { color: var(--text-primary); font-weight: 600; }

/* STATS */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; }
.stat-card {
  background: var(--bg-card); border: 1px solid var(--border); padding: 2rem 1.5rem;
  text-align: center; transition: all 0.4s;
}
.stat-card:hover { border-color: rgba(255,255,255,0.12); transform: translateY(-4px); }
.stat-number { font-family: var(--font-display); font-size: 3rem; color: var(--white); line-height: 1; }
.stat-label {
  font-family: var(--font-condensed); font-size: 0.75rem; font-weight: 600;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-muted); margin-top: 0.5rem;
}
.stat-season { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.3rem; opacity: 0.6; }

/* HIGHLIGHTS (placeholder for video uploads) */
.film-placeholder {
  background: var(--bg-card); border: 2px dashed var(--border); border-radius: 8px;
  padding: 4rem 2rem; text-align: center; color: var(--text-muted);
}
.film-placeholder h3 { font-family: var(--font-display); font-size: 1.8rem; color: var(--text-secondary); margin-bottom: 0.5rem; }

/* ACHIEVEMENTS */
.achievements-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; }
.achievement-card {
  background: var(--bg-card); border: 1px solid var(--border); padding: 1.5rem;
  display: flex; gap: 1.2rem; align-items: flex-start; transition: border-color 0.3s;
}
.achievement-card:hover { border-color: rgba(255,255,255,0.12); }
.achievement-icon {
  width: 44px; height: 44px; background: linear-gradient(135deg, var(--gold), #a8862e);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1.2rem;
}
.achievement-text h4 { font-family: var(--font-condensed); font-weight: 700; font-size: 1rem; color: var(--text-primary); margin-bottom: 0.2rem; }
.achievement-text p { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; }

/* CONTACT */
.contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; }
.contact-info h3 { font-family: var(--font-display); font-size: 2rem; color: var(--white); margin-bottom: 1.5rem; }
.contact-item { display: flex; align-items: center; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid var(--border); }
.contact-item-icon {
  width: 40px; height: 40px; background: var(--bg-card); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.contact-item-icon svg { width: 18px; height: 18px; stroke: var(--accent); fill: none; stroke-width: 2; }
.contact-item-label {
  font-family: var(--font-condensed); font-size: 0.65rem; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--text-muted);
}
.contact-item-value { font-size: 1rem; color: var(--text-primary); margin-top: 0.1rem; }
.contact-item-value a { color: var(--text-primary); text-decoration: none; }
.contact-item-value a:hover { color: var(--accent); }
.contact-form {
  background: var(--bg-card); border: 1px solid var(--border); padding: 2.5rem;
}
.contact-form h3 { font-family: var(--font-display); font-size: 1.8rem; color: var(--white); margin-bottom: 1.5rem; }
.form-group { margin-bottom: 1.2rem; }
.form-group label {
  display: block; font-family: var(--font-condensed); font-size: 0.7rem; font-weight: 600;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.4rem;
}
.form-group input, .form-group textarea {
  width: 100%; padding: 0.9rem 1rem; background: var(--bg-primary);
  border: 1px solid var(--border); color: var(--text-primary);
  font-family: var(--font-body); font-size: 0.95rem; transition: border-color 0.3s; outline: none;
}
.form-group input:focus, .form-group textarea:focus { border-color: var(--accent); }
.form-group textarea { resize: vertical; min-height: 100px; }
.contact-form .btn-primary { width: 100%; text-align: center; }

/* FOOTER */
footer {
  background: var(--bg-secondary); border-top: 1px solid var(--border);
  padding: 3rem 0; text-align: center;
}
.footer-logo {
  font-family: var(--font-display); font-size: 1.2rem; letter-spacing: 0.1em;
  color: var(--text-secondary); margin-bottom: 0.5rem;
}
.footer-logo span { color: var(--accent); }
.footer-tagline { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem; }
.footer-pp { font-size: 0.7rem; color: var(--text-muted); margin-top: 1rem; opacity: 0.6; }
.footer-pp a { color: var(--gold); text-decoration: none; }
.footer-pp a:hover { text-decoration: underline; }

/* REVEAL ANIMATION */
.reveal { opacity: 0; transform: translateY(30px); transition: opacity 0.6s ease, transform 0.6s ease; }
.reveal.visible { opacity: 1; transform: translateY(0); }

/* RESPONSIVE */
@media (max-width: 900px) {
  nav { padding: 1rem 1.5rem; }
  .nav-links { display:none; position:fixed; inset:0; background:rgba(10,10,12,0.98); backdrop-filter:blur(20px); flex-direction:column; align-items:center; justify-content:center; gap:2rem; z-index:200; }
  .nav-links.open { display:flex; }
  .nav-toggle { display:flex; z-index:201; }
  .hero-content { max-width: 90% !important; padding-left: 5% !important; }
  .about-grid { grid-template-columns: 1fr; }
  .about-photo { max-width: 300px; }
  .contact-grid { grid-template-columns: 1fr; }
  .achievements-grid { grid-template-columns: 1fr; }
  .hero-stats { gap: 2rem; }
}
</style>
</head>
<body>

<!-- NAV -->
<nav id="navbar">
  <a href="#" class="nav-logo">${escHtml(firstName.toUpperCase())} <span>${escHtml(name.split(" ").slice(1).join(" ").toUpperCase())}</span></a>
  <button class="nav-toggle" onclick="document.querySelector('.nav-links').classList.toggle('open')">
    <span></span><span></span><span></span>
  </button>
  <div class="nav-links">
    <a href="#stats">Stats</a>
    <a href="#highlights">Film</a>
    <a href="#about">About</a>
    <a href="#contact" class="nav-cta">Contact</a>
  </div>
</nav>

<!-- HERO -->
<section class="hero" id="home">
  <div class="hero-bg"></div>
  <div class="hero-overlay-lines"></div>
  <div class="hero-content">
    <div class="hero-eyebrow">Class of ${escHtml(data.grad_year || "2027")}</div>
    <h1 class="hero-name">${escHtml(name.toUpperCase()).replace(" ", "<br>")}</h1>
    <p class="hero-tagline">${tagline}</p>
    <div class="hero-stats">
${buildHeroStats(data)}
    </div>
    <div class="hero-cta-group">
      <a href="#highlights" class="btn-primary">Watch Film</a>
      <a href="#contact" class="btn-secondary">Contact Me</a>
    </div>
  </div>
  <div class="scroll-indicator">
    <span>Scroll</span>
    <div class="scroll-arrow"></div>
  </div>
</section>

<!-- STATS -->
<section id="stats">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">Performance</div>
      <h2 class="section-title">BY THE NUMBERS</h2>
      <p class="section-subtitle">Current and career statistics.</p>
    </div>
    ${buildStatCards(data)}
  </div>
</section>

<!-- HIGHLIGHTS -->
<section id="highlights">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">Game Film</div>
      <h2 class="section-title">HIGHLIGHTS</h2>
      <p class="section-subtitle">Watch the progression. Upload clips from your dashboard.</p>
    </div>
    <div class="film-placeholder reveal" id="filmArea">
      <div style="font-size:3rem; margin-bottom:1rem;">🎬</div>
      <h3>GAME FILM COMING SOON</h3>
      <p style="max-width:400px; margin:0 auto; line-height:1.7; font-size:0.95rem;">Log in to your Prospect Pages dashboard to upload and manage your highlight clips.</p>
    </div>
  </div>
</section>

<!-- ABOUT -->
<section id="about">
  <div class="container">
    <div class="about-grid">
      <div class="about-photo reveal">PHOTO COMING SOON</div>
      <div>
        <div class="section-header reveal" style="margin-bottom: 2rem;">
          <div class="section-label">The Athlete</div>
          <h2 class="section-title">ABOUT ${escHtml(firstName.toUpperCase())}</h2>
        </div>
        <div class="about-info-grid reveal">
          ${data.high_school ? `<div class="info-card"><div class="info-card-label">School</div><div class="info-card-value">${escHtml(data.high_school)}</div></div>` : ""}
          ${data.grad_year ? `<div class="info-card"><div class="info-card-label">Class</div><div class="info-card-value">${escHtml(data.grad_year)}</div></div>` : ""}
          ${data.position ? `<div class="info-card"><div class="info-card-label">Position</div><div class="info-card-value">${escHtml(data.position)}</div></div>` : ""}
          ${data.travel_team ? `<div class="info-card"><div class="info-card-label">Travel / Club</div><div class="info-card-value">${escHtml(data.travel_team)}</div></div>` : ""}
        </div>
        <div class="about-bio reveal">
          ${formatBio(bio)}
        </div>
      </div>
    </div>
  </div>
</section>

<!-- CONTACT -->
<section id="contact">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">Recruiting</div>
      <h2 class="section-title">GET IN TOUCH</h2>
      <p class="section-subtitle">Coaches — feel free to reach out. We'd love to connect.</p>
    </div>
    <div class="contact-grid reveal">
      <div class="contact-info">
        <h3>CONTACT INFO</h3>
        ${buildContactItems(data)}
      </div>
      <div class="contact-form" id="contactFormWrap">
        <h3>SEND A MESSAGE</h3>
        <form name="contact" method="POST" data-netlify="true" id="contactForm" onsubmit="return submitContact(event)">
          <input type="hidden" name="form-name" value="contact">
          <input type="hidden" name="athlete" value="${escAttr(name)}">
          <div class="form-group">
            <label for="c_name">Your Name</label>
            <input type="text" id="c_name" name="name" placeholder="Coach Name" required>
          </div>
          <div class="form-group">
            <label for="c_school">School / Organization</label>
            <input type="text" id="c_school" name="school" placeholder="University or Program">
          </div>
          <div class="form-group">
            <label for="c_email">Email</label>
            <input type="email" id="c_email" name="email" placeholder="coach@university.edu" required>
          </div>
          <div class="form-group">
            <label for="c_message">Message</label>
            <textarea id="c_message" name="message" placeholder="Let us know how we can connect..." required></textarea>
          </div>
          <button type="submit" class="btn-primary" style="border:none;cursor:pointer;width:100%;text-align:center;">Send Message</button>
        </form>
        <div id="thankYou" style="display:none; text-align:center; padding:3rem 1rem;">
          <div style="width:60px;height:60px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.2rem;font-size:1.5rem;color:#fff;">✓</div>
          <h3 style="font-family:var(--font-display);font-size:2rem;color:var(--white);margin-bottom:0.5rem;">MESSAGE SENT</h3>
          <p style="color:var(--text-secondary);line-height:1.7;margin-bottom:1.5rem;">Thank you for reaching out about ${escHtml(firstName)}.<br>We'll get back to you as soon as possible.</p>
          <a href="#home" class="btn-primary" style="text-decoration:none;display:inline-block;">Back to Top</a>
        </div>
      </div>
    </div>
  </div>
</section>

${data.achievements ? `<!-- ACHIEVEMENTS -->
<section id="achievements">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">Recognition</div>
      <h2 class="section-title">ACHIEVEMENTS</h2>
    </div>
    ${buildAchievements(data.achievements)}
  </div>
</section>` : ""}

<!-- FOOTER -->
<footer>
  <div class="container">
    <div class="footer-logo">${escHtml(firstName.toUpperCase())} <span>${escHtml(name.split(" ").slice(1).join(" ").toUpperCase())}</span></div>
    <div class="footer-tagline">${escHtml(sport)} | Class of ${escHtml(data.grad_year || "2027")} | ${escHtml(data.city_state || "")}</div>
    <div class="footer-pp">Built by <a href="https://prospectpages.net" target="_blank">Prospect Pages</a></div>
  </div>
</footer>

<script>
// Scroll nav effect
window.addEventListener('scroll', function() {
  document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 60);
});

// Reveal on scroll
var revealEls = document.querySelectorAll('.reveal');
var observer = new IntersectionObserver(function(entries) {
  entries.forEach(function(e) { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
}, { threshold: 0.15 });
revealEls.forEach(function(el) { observer.observe(el); });

// Contact form
function submitContact(e) {
  e.preventDefault();
  var form = document.getElementById('contactForm');
  var data = new FormData(form);
  fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString()
  }).then(function() {
    form.style.display = 'none';
    document.getElementById('thankYou').style.display = 'block';
  }).catch(function() {
    alert('Something went wrong. Please try reaching out directly via email.');
  });
  return false;
}
</script>
</body>
</html>`;
}

// ── Main handler ──
exports.handler = async (event) => {
  // CORS headers
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

  try {
    // Validate environment variables
    if (!SUPABASE_SERVICE_KEY) {
      throw new Error("SUPABASE_SERVICE_KEY environment variable is not set");
    }
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }

    // Parse form data (handles both JSON and form-encoded)
    let data;
    const contentType = event.headers["content-type"] || "";
    if (contentType.includes("application/json")) {
      data = JSON.parse(event.body);
    } else {
      // Parse URL-encoded form data
      data = {};
      const params = new URLSearchParams(event.body);
      for (const [key, val] of params) {
        data[key] = val;
      }
    }

    // 1. Generate bio via Claude (wrapped separately so data still saves on failure)
    let bio = "";
    console.log("Generating bio for:", data.athlete_name);
    try {
      bio = await generateBio(data);
    } catch (bioErr) {
      console.error("Bio generation failed:", bioErr.message);
      bio = ""; // Will be empty — admin can write it manually
    }

    // 2. Generate invite code
    const inviteCode = makeInviteCode();

    // 3. Build the full HTML site
    const siteHtml = buildSiteHtml(data, bio);

    // 4. Build stats JSON
    const statsJson = [];
    for (let i = 1; i <= 8; i++) {
      if (data[`stat_${i}_label`] && data[`stat_${i}_value`]) {
        statsJson.push({ label: data[`stat_${i}_label`], value: data[`stat_${i}_value`] });
      }
    }

    // 5. Store in Supabase
    const siteRecord = {
      status: bio ? "generated" : "pending",
      parent_name: data.parent_name || null,
      parent_email: data.parent_email || null,
      parent_phone: data.parent_phone || null,
      contact_method: data.contact_method || null,
      sport: data.sport || null,
      athlete_name: data.athlete_name || null,
      grad_year: data.grad_year || null,
      high_school: data.high_school || null,
      city_state: data.city_state || null,
      travel_team: data.travel_team || null,
      position: data.position || null,
      height: data.height || null,
      weight: data.weight || null,
      gpa: data.gpa || null,
      hand_detail: data.hand_detail || null,
      hand_label: data.hand_label || null,
      stats: statsJson,
      achievements: data.achievements || null,
      story_how_started: data.story_how_started || null,
      story_what_drives: data.story_what_drives || null,
      story_proud_moment: data.story_proud_moment || null,
      story_goals: data.story_goals || null,
      story_personality: data.story_personality || null,
      story_extra: data.story_extra || null,
      hs_coach_name: data.hs_coach_name || null,
      hs_coach_contact: data.hs_coach_contact || null,
      travel_coach_name: data.travel_coach_name || null,
      travel_coach_contact: data.travel_coach_contact || null,
      athlete_email: data.athlete_email || null,
      athlete_phone: data.athlete_phone || null,
      athlete_twitter: data.athlete_twitter || null,
      athlete_instagram: data.athlete_instagram || null,
      color_pref: data.color_pref || null,
      domain_pref: data.domain_pref || null,
      notes: data.notes || null,
      drive_link: data.drive_link || null,
      template: data.template || "dark",
      generated_bio: bio,
      generated_html: siteHtml,
      invite_code: inviteCode,
    };

    const inserted = await supaFetch("/rest/v1/sites", {
      method: "POST",
      body: siteRecord,
    });

    // 6. Also create the invite code in the invite_codes table
    try {
      await supaFetch("/rest/v1/invite_codes", {
        method: "POST",
        body: {
          code: inviteCode,
          client_name: data.athlete_name,
          sport: data.sport,
          created_by: "auto-generate",
        },
      });
    } catch (e) {
      console.log("Invite code insert:", e.message);
    }

    // 7. Send email notification to ADMIN (David)
    try {
      const adminEmail = new URLSearchParams();
      adminEmail.append("access_key", "5fa35adf-581a-4cfe-afa6-8b8811ed2219");
      adminEmail.append("subject", `🚀 Auto-Generated: ${data.athlete_name || "New Athlete"} (${data.sport || "Unknown Sport"})`);
      adminEmail.append("from_name", "Prospect Pages Auto-Gen");
      adminEmail.append("message", `New site auto-generated!\n\nAthlete: ${data.athlete_name}\nSport: ${data.sport}\nParent: ${data.parent_name} (${data.parent_email})\nInvite Code: ${inviteCode}\n\nReview it in the admin panel at prospectpages.net/admin`);
      const adminRes = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: adminEmail.toString(),
      });
      const adminResult = await adminRes.json();
      console.log("Admin email result:", adminResult.success ? "sent" : adminResult.message);
    } catch (e) {
      console.error("Admin email failed:", e.message);
    }

    // 8. Send email to PARENT with invite code and instructions
    if (data.parent_email) {
      try {
        const parentEmail = new URLSearchParams();
        parentEmail.append("access_key", "5fa35adf-581a-4cfe-afa6-8b8811ed2219");
        parentEmail.append("subject", `Your Prospect Pages Site is Ready — ${data.athlete_name}`);
        parentEmail.append("from_name", "Prospect Pages");
        parentEmail.append("replyto", "david@prospectpages.college");
        parentEmail.append("to", data.parent_email);
        parentEmail.append("message", [
          `Hi ${(data.parent_name || "").split(" ")[0] || "there"},`,
          ``,
          `${data.athlete_name}'s recruiting site has been generated and is being reviewed. You'll receive a follow-up when it's live.`,
          ``,
          `In the meantime, here's your dashboard invite code:`,
          ``,
          `    ${inviteCode}`,
          ``,
          `Use this code to sign up at: https://prospectpages.net/dashboard`,
          ``,
          `From the dashboard, you can:`,
          `- Upload and manage game film`,
          `- Update stats and measurables`,
          `- Generate personalized coach outreach emails`,
          `- Track your recruiting outreach`,
          ``,
          `If you have any questions, just reply to this email.`,
          ``,
          `— David Medina`,
          `Prospect Pages`,
          `david@prospectpages.college`,
        ].join("\n"));
        const parentRes = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: parentEmail.toString(),
        });
        const parentResult = await parentRes.json();
        console.log("Parent email result:", parentResult.success ? "sent" : parentResult.message);
      } catch (e) {
        console.error("Parent email failed:", e.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        invite_code: inviteCode,
        site_id: inserted?.[0]?.id,
        athlete_name: data.athlete_name,
      }),
    };
  } catch (error) {
    console.error("generate-site error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
