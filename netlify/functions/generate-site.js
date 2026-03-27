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
const ACHIEVEMENT_LOGOS = {
  "baseball factory": "data:image/png;base64,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",
  "prep baseball": "data:image/png;base64,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",
  "ca showcase": "data:image/png;base64,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",
};

function buildAchievements(text) {
  if (!text || !text.trim()) return "<!-- No achievements provided -->";
  const items = text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  const icons = [
    '<svg viewBox="0 0 24 24"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>',
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    '<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  ];
  return `<div class="achievements-grid">
${items.map((item, i) => {
      const lower = item.toLowerCase();
      const logoKey = Object.keys(ACHIEVEMENT_LOGOS).find(k => lower.includes(k));
      const iconHtml = logoKey
        ? `<img class="achievement-logo" src="${ACHIEVEMENT_LOGOS[logoKey]}" alt="">`
        : `<div class="achievement-icon">${icons[i % icons.length]}</div>`;
      return `      <div class="achievement-card reveal">
        ${iconHtml}
        <div class="achievement-text">
          <h4>${escHtml(item)}</h4>
        </div>
      </div>`;
    }).join("\n")}
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
    html += `<div style="margin-top:1.5rem; padding-top:1.5rem; border-top:1px solid var(--border);">
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

// ── Theme configuration for all 7 templates ──
// VALUES ARE 1:1 EXACT MATCHES from the live demo HTML files.
// DO NOT "improve" or "customize" these — they must match the demos.
const THEME_CONFIG = {
  dark: {
    // SOURCE: dmedina.me (baseball-demo.html / live site)
    name: "Dark Pro",
    bg: "#0a0a0c",
    bg2: "#111116",
    card: "#16161c",
    cardHover: "#1c1c24",
    accent: "#e63a2e",
    accentGlow: "rgba(230, 58, 46, 0.25)",
    accentHover: "#cf2f24",
    gold: "#c9a84c",
    textPrimary: "#f0ece4",
    textSecondary: "#9a968e",
    textMuted: "#5c5952",
    border: "rgba(255,255,255,0.06)",
    fontDisplay: "'Bebas Neue', sans-serif",
    fontBody: "'Barlow', sans-serif",
    fontCondensed: "'Barlow Condensed', sans-serif",
    fontImport: "family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700;800&family=Barlow+Condensed:wght@400;600;700;800&family=Oswald:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700;800&family=Montserrat:wght@300;400;500;600;700;800;900",
    heroLayout: "overlay",
    heroBgGradient: "linear-gradient(135deg, #0d0d12 0%, #1a1018 50%, #0d0d12 100%)",
    navBg: "rgba(10,10,12,0.85)",
    navBgScrolled: "rgba(10,10,12,0.95)",
    isLight: false,
  },
  clean: {
    // SOURCE: softball-demo.html (Isabella Martinez)
    name: "Clean Light",
    bg: "#faf8f5",
    bg2: "#f0e8ef",
    card: "#ffffff",
    cardHover: "#f5f3f0",
    accent: "#c4387a",
    accentGlow: "rgba(196, 56, 122, 0.20)",
    accentHover: "#a82e66",
    gold: "#c9a84c",
    textPrimary: "#2a2030",
    textSecondary: "#6a6070",
    textMuted: "#aaa4b0",
    border: "rgba(0,0,0,0.06)",
    fontDisplay: "'Raleway', sans-serif",
    fontBody: "'Barlow', sans-serif",
    fontCondensed: "'Barlow Condensed', sans-serif",
    fontImport: "family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700;800&family=Barlow+Condensed:wght@400;600;700;800&family=Oswald:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700;800&family=Montserrat:wght@300;400;500;600;700;800;900",
    heroLayout: "split",
    heroBgGradient: "linear-gradient(135deg, #faf8f5 60%, #f0e8ef 100%)",
    navBg: "rgba(255,255,255,0.95)",
    navBgScrolled: "rgba(255,255,255,0.97)",
    isLight: true,
  },
  fire: {
    // SOURCE: basketball-demo.html (Marcus Thompson)
    name: "Bold Fire",
    bg: "#08080a",
    bg2: "#0d0d10",
    card: "#111114",
    cardHover: "#1a1a20",
    accent: "#ff6b2b",
    accentGlow: "rgba(255, 107, 43, 0.25)",
    accentHover: "#e65a1a",
    gold: "#c9a84c",
    textPrimary: "#eae8e4",
    textSecondary: "#8a8680",
    textMuted: "#4a4640",
    border: "rgba(255,255,255,0.05)",
    fontDisplay: "'Oswald', sans-serif",
    fontBody: "'Barlow', sans-serif",
    fontCondensed: "'Barlow Condensed', sans-serif",
    fontImport: "family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700;800&family=Barlow+Condensed:wght@400;600;700;800&family=Oswald:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700;800&family=Montserrat:wght@300;400;500;600;700;800;900",
    heroLayout: "centered",
    heroBgGradient: "radial-gradient(ellipse at center, #181410 0%, #08080a 70%)",
    navBg: "rgba(8,8,10,0.92)",
    navBgScrolled: "rgba(8,8,10,0.95)",
    isLight: false,
  },
  field: {
    // SOURCE: football-demo.html (Jordan Williams)
    name: "Field",
    bg: "#060a07",
    bg2: "#0c140e",
    card: "#101a14",
    cardHover: "#172019",
    accent: "#2d8a4e",
    accentGlow: "rgba(45, 138, 78, 0.25)",
    accentHover: "#247040",
    gold: "#c9a84c",
    textPrimary: "#f0ece4",
    textSecondary: "#9a968e",
    textMuted: "#5c5952",
    border: "rgba(255,255,255,0.06)",
    fontDisplay: "'Oswald', sans-serif",
    fontBody: "'Barlow', sans-serif",
    fontCondensed: "'Barlow Condensed', sans-serif",
    fontImport: "family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700;800&family=Barlow+Condensed:wght@400;600;700;800&family=Oswald:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700;800&family=Montserrat:wght@300;400;500;600;700;800;900",
    heroLayout: "centered",
    heroBgGradient: "radial-gradient(ellipse at 30% 50%, #101a14 0%, #060a07 70%)",
    navBg: "rgba(0,0,0,0.85)",
    navBgScrolled: "rgba(0,0,0,0.95)",
    isLight: false,
  },
  midnight: {
    // SOURCE: soccer-demo.html (Sofia Reyes)
    name: "Midnight",
    bg: "#060810",
    bg2: "#0c1020",
    card: "#101828",
    cardHover: "#171a26",
    accent: "#2563eb",
    accentGlow: "rgba(37, 99, 235, 0.25)",
    accentHover: "#1d4fd8",
    gold: "#c9a84c",
    textPrimary: "#f0ece4",
    textSecondary: "#9a968e",
    textMuted: "#5c5952",
    border: "rgba(255,255,255,0.06)",
    fontDisplay: "'Montserrat', sans-serif",
    fontBody: "'Barlow', sans-serif",
    fontCondensed: "'Barlow Condensed', sans-serif",
    fontImport: "family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700;800&family=Barlow+Condensed:wght@400;600;700;800&family=Oswald:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700;800&family=Montserrat:wght@300;400;500;600;700;800;900",
    heroLayout: "centered",
    heroBgGradient: "radial-gradient(ellipse at 30% 50%, #101828 0%, #060810 70%)",
    navBg: "rgba(0,0,0,0.85)",
    navBgScrolled: "rgba(0,0,0,0.95)",
    isLight: false,
  },
  ultraviolet: {
    // SOURCE: volleyball-demo.html (Ava Chen)
    name: "Ultraviolet",
    bg: "#0a0614",
    bg2: "#120e20",
    card: "#18122a",
    cardHover: "#1c142c",
    accent: "#7c3aed",
    accentGlow: "rgba(124, 58, 237, 0.25)",
    accentHover: "#6d28d9",
    gold: "#c9a84c",
    textPrimary: "#f0ece4",
    textSecondary: "#9a968e",
    textMuted: "#5c5952",
    border: "rgba(255,255,255,0.06)",
    fontDisplay: "'Raleway', sans-serif",
    fontBody: "'Barlow', sans-serif",
    fontCondensed: "'Barlow Condensed', sans-serif",
    fontImport: "family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700;800&family=Barlow+Condensed:wght@400;600;700;800&family=Oswald:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700;800&family=Montserrat:wght@300;400;500;600;700;800;900",
    heroLayout: "centered",
    heroBgGradient: "radial-gradient(ellipse at 30% 50%, #18122a 0%, #0a0614 70%)",
    navBg: "rgba(0,0,0,0.85)",
    navBgScrolled: "rgba(0,0,0,0.95)",
    isLight: false,
  },
  ember: {
    // SOURCE: track-demo.html (Elijah Brooks)
    name: "Ember",
    bg: "#0c0806",
    bg2: "#14100a",
    card: "#1c1610",
    cardHover: "#201a16",
    accent: "#ea580c",
    accentGlow: "rgba(234, 88, 12, 0.25)",
    accentHover: "#d24a0a",
    gold: "#c9a84c",
    textPrimary: "#f0ece4",
    textSecondary: "#9a968e",
    textMuted: "#5c5952",
    border: "rgba(255,255,255,0.06)",
    fontDisplay: "'Bebas Neue', sans-serif",
    fontBody: "'Barlow', sans-serif",
    fontCondensed: "'Barlow Condensed', sans-serif",
    fontImport: "family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700;800&family=Barlow+Condensed:wght@400;600;700;800&family=Oswald:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700;800&family=Montserrat:wght@300;400;500;600;700;800;900",
    heroLayout: "centered",
    heroBgGradient: "radial-gradient(ellipse at 30% 50%, #1c1610 0%, #0c0806 70%)",
    navBg: "rgba(0,0,0,0.85)",
    navBgScrolled: "rgba(0,0,0,0.95)",
    isLight: false,
  },
};

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

  // Resolve theme
  const templateKey = data.template && THEME_CONFIG[data.template] ? data.template : "dark";
  const theme = { ...THEME_CONFIG[templateKey] };
  // Color picker override
  if (data.color_pref && /^#[0-9a-fA-F]{6}$/.test(data.color_pref)) {
    theme.accent = data.color_pref;
    // Derive glow and hover from custom accent
    const r = parseInt(data.color_pref.slice(1,3), 16);
    const g = parseInt(data.color_pref.slice(3,5), 16);
    const b = parseInt(data.color_pref.slice(5,7), 16);
    theme.accentGlow = `rgba(${r}, ${g}, ${b}, 0.25)`;
    theme.accentHover = `#${Math.max(0,r-20).toString(16).padStart(2,'0')}${Math.max(0,g-20).toString(16).padStart(2,'0')}${Math.max(0,b-20).toString(16).padStart(2,'0')}`;
  }
  const isCentered = theme.heroLayout === "centered";
  const isOverlay = theme.heroLayout === "overlay";   // Dark Pro: full-bleed right image
  const isSplit = theme.heroLayout === "split";        // Clean Light: grid 1fr 1fr
  const whiteOrPrimary = theme.isLight ? theme.textPrimary : "#ffffff";
  // Hero h1 font-sizes per demo (exact from source HTML)
  const heroH1Sizes = { dark: 'clamp(4rem, 12vw, 10rem)', clean: 'clamp(3rem, 6vw, 5rem)', fire: 'clamp(5rem, 15vw, 12rem)' };
  const heroH1Size = heroH1Sizes[templateKey] || 'clamp(4rem, 12vw, 9rem)'; // T4-7 default

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(name)} | ${escHtml(sport)}</title>
<meta name="description" content="${escHtml(name)} – ${escHtml(sport)} Player Recruiting Profile. Game film, stats, progression timeline, and contact information for college coaches.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?${theme.fontImport}&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg-primary: ${theme.bg};
  --bg-secondary: ${theme.bg2};
  --bg-card: ${theme.card};
  --bg-card-hover: ${theme.cardHover};
  --text-primary: ${theme.textPrimary};
  --text-secondary: ${theme.textSecondary};
  --text-muted: ${theme.textMuted};
  --accent: ${theme.accent};
  --accent-glow: ${theme.accentGlow};
  --accent-secondary: ${theme.accent};
  --gold: ${theme.gold};
  --white: ${whiteOrPrimary};
  --border: ${theme.border};
  --font-display: ${theme.fontDisplay};
  --font-body: ${theme.fontBody};
  --font-condensed: ${theme.fontCondensed};
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
  background: ${theme.navBg};
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
  transition: all 0.4s ease;
}
nav.scrolled { padding: 0.8rem 3rem; background: ${theme.navBgScrolled}; }
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
.nav-cta:hover { background: ${theme.accentHover} !important; transform: translateY(-1px); }
.nav-toggle {
  display: none; background: none; border: none; cursor: pointer;
  flex-direction: column; gap: 5px; padding: 4px;
}
.nav-toggle span { width: 24px; height: 2px; background: var(--text-primary); transition: 0.3s; }

/* HERO */
.hero {
  min-height: 100vh; display: flex; align-items: center;
  position: relative; overflow: visible;
}
.hero-bg {
  position: absolute; inset: 0;
  background: ${theme.heroBgGradient};
}
.hero-overlay-lines {
  position: absolute; inset: 0; opacity: 0.04;
  background: repeating-linear-gradient(90deg, transparent, transparent 120px, rgba(255,255,255,0.5) 120px, rgba(255,255,255,0.5) 121px);
}
.hero-inner {
  position: relative; z-index: 2; display: flex; align-items: center;
  width: 100%; max-width: 1200px; margin: 0 auto;
  padding: 5rem 2rem 5rem 3rem; gap: 3rem;
  animation: heroFadeIn 1.2s ease-out;
}
@keyframes heroFadeIn {
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
}
.hero-content { flex: 1; min-width: 0; }
.hero-eyebrow {
  font-family: var(--font-condensed); font-weight: 600; font-size: 0.85rem;
  letter-spacing: 0.35em; text-transform: uppercase; color: var(--accent);
  margin-bottom: 1.2rem; display: flex; align-items: center; justify-content: flex-start; gap: 1rem;
}
.hero-eyebrow::before, .hero-eyebrow::after { content: ''; width: 40px; height: 1px; background: var(--accent); }
.hero-name {
  font-family: var(--font-display); font-size: ${heroH1Size};
  line-height: 0.9; letter-spacing: 0.04em; color: var(--white); margin-bottom: 0.5rem;
}
.hero-tagline {
  font-family: var(--font-condensed); font-size: clamp(1.1rem, 2.5vw, 1.6rem);
  font-weight: 400; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--text-secondary); margin-bottom: 2.5rem;
}
.hero-stats { display: flex; gap: 2.5rem; justify-content: flex-start; flex-wrap: wrap; margin-bottom: 2.5rem; }
.hero-stat { text-align: center; }
.hero-stat-value { font-family: var(--font-display); font-size: 2.5rem; color: var(--white); line-height: 1; }
.hero-stat-label {
  font-family: var(--font-condensed); font-size: 0.7rem; letter-spacing: 0.25em;
  text-transform: uppercase; color: var(--text-muted); margin-top: 0.3rem;
}
.hero-cta-group { display: flex; gap: 1rem; justify-content: flex-start; flex-wrap: wrap; }
.hero-photo-card {
  width: 320px; flex-shrink: 0; align-self: flex-start;
  margin-bottom: -100px; position: relative; z-index: 3;
  border: 1px solid var(--border); background: var(--bg-card); overflow: hidden;
}
.hero-photo-card img {
  width: 100%; height: 420px; object-fit: cover; display: block;
}
.hero-photo-card .photo-placeholder {
  width: 100%; height: 420px; display: flex; align-items: center; justify-content: center;
  background: var(--bg-card); color: var(--text-muted);
  font-family: var(--font-condensed); font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase;
}
.btn-primary {
  font-family: var(--font-condensed); font-weight: 700; font-size: 0.85rem;
  letter-spacing: 0.18em; text-transform: uppercase; padding: 1rem 2.5rem;
  background: var(--accent); color: var(--white); border: none; cursor: pointer;
  text-decoration: none; transition: all 0.3s; position: relative; overflow: hidden;
}
.btn-primary:hover { background: ${theme.accentHover}; transform: translateY(-2px); box-shadow: 0 8px 30px var(--accent-glow); }
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
${theme.isLight ? '#about { background: var(--bg-secondary); }' : '#highlights, #contact { background: var(--bg-secondary); }'}
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

/* FILM PLAYER (injected by publish) */
.film-player-wrap { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.film-main-video video { width: 100%; display: block; background: #000; aspect-ratio: 16/9; }
.film-now-playing {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem 1.5rem; border-top: 1px solid var(--border);
}
.film-now-tag {
  font-family: var(--font-condensed); font-size: 0.65rem; font-weight: 600;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); margin-bottom: 0.2rem;
}
.film-now-title { font-family: var(--font-condensed); font-weight: 700; font-size: 1.1rem; color: var(--text-primary); }
.film-now-meta { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.1rem; }
.film-count {
  font-family: var(--font-condensed); font-size: 0.75rem; font-weight: 600;
  letter-spacing: 0.15em; color: var(--text-muted); white-space: nowrap;
}
.film-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1.5rem; }
.film-tab {
  font-family: var(--font-condensed); font-size: 0.8rem; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase; padding: 0.5rem 1.2rem;
  background: var(--bg-card); border: 1px solid var(--border); color: var(--text-muted);
  cursor: pointer; transition: all 0.2s;
}
.film-tab:hover, .film-tab.active { border-color: var(--accent); color: var(--accent); background: var(--accent-glow); }
.film-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; margin-top: 1rem; }
.film-thumb {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px;
  overflow: hidden; cursor: pointer; transition: all 0.3s;
}
.film-thumb:hover, .film-thumb.active { border-color: var(--accent); }
.film-thumb-preview {
  position: relative; background: #000; aspect-ratio: 16/9;
  display: flex; align-items: center; justify-content: center;
}
.film-thumb-number {
  position: absolute; top: 8px; left: 8px; font-family: var(--font-condensed);
  font-size: 0.7rem; font-weight: 700; color: var(--text-muted); letter-spacing: 0.1em;
}
.film-thumb-play svg { width: 32px; height: 32px; fill: rgba(255,255,255,0.7); }
.film-thumb-duration {
  position: absolute; bottom: 8px; right: 8px; font-family: var(--font-condensed);
  font-size: 0.7rem; font-weight: 600; color: var(--text-secondary); background: rgba(0,0,0,0.6);
  padding: 2px 6px; border-radius: 3px;
}
.film-thumb-info { padding: 0.8rem 1rem; }
.film-thumb-cat {
  font-family: var(--font-condensed); font-size: 0.6rem; font-weight: 600;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); margin-bottom: 0.15rem;
}
.film-thumb-title { font-family: var(--font-condensed); font-weight: 700; font-size: 0.95rem; color: var(--text-primary); }
.film-thumb-meta { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.1rem; }

/* ACHIEVEMENTS */
.achievements-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
.achievement-card {
  background: var(--bg-card); border: 1px solid var(--border); padding: 1.5rem 1.5rem 1.5rem 1.8rem;
  display: flex; gap: 1rem; align-items: flex-start; transition: all 0.4s;
  position: relative; overflow: hidden;
}
.achievement-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--accent); opacity: 0.6; transition: opacity 0.3s;
}
.achievement-card:hover { border-color: rgba(255,255,255,0.12); transform: translateY(-3px); box-shadow: 0 8px 25px rgba(0,0,0,0.15); }
.achievement-card:hover::before { opacity: 1; }
.achievement-icon {
  width: 40px; height: 40px; background: var(--accent); opacity: 0.9;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  border-radius: 4px;
}
.achievement-icon svg { width: 20px; height: 20px; stroke: #fff; fill: none; stroke-width: 2; }
.achievement-text h4 { font-family: var(--font-condensed); font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 0.15rem; letter-spacing: 0.02em; }
.achievement-text p { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5; }
.achievement-logo { width: 40px; height: 40px; flex-shrink: 0; border-radius: 4px; object-fit: contain; background: rgba(255,255,255,0.05); padding: 4px; }

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

${isCentered ? `/* CENTERED HERO LAYOUT */
.hero-inner { flex-direction: column; align-items: center; text-align: center; padding: 8rem 2rem 5rem; }
.hero-eyebrow { justify-content: center; }
.hero-stats { justify-content: center; }
.hero-cta-group { justify-content: center; }
.hero-photo-card { display: none; }
` : ""}

${isOverlay ? `/* DARK PRO — LEFT TEXT + RIGHT IMAGE OVERLAY */
.hero-bg::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(to bottom, rgba(10,10,12,0.45) 0%, rgba(10,10,12,0.75) 50%, var(--bg-primary) 100%);
}
.hero-inner { padding: 5rem 2rem 5rem 6%; max-width: 100%; }
.hero-content { max-width: 55%; }
.hero-photo-card { display: none; }
.hero-player-img {
  position: absolute; right: 0; top: 0; bottom: 0; width: 45%; z-index: 1;
  overflow: hidden; display: flex; align-items: flex-end; justify-content: center;
}
.hero-player-img img {
  width: 100%; height: 100%; object-fit: cover; object-position: center top;
  mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.4) 15%, rgba(0,0,0,0.8) 40%, rgba(0,0,0,0.9) 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.4) 15%, rgba(0,0,0,0.8) 40%, rgba(0,0,0,0.9) 100%);
}
.hero-player-img .photo-placeholder {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  background: var(--bg-card); color: var(--text-muted); font-family: var(--font-condensed);
  font-size: 0.8rem; letter-spacing: 0.15em; text-transform: uppercase; opacity: 0.5;
}
@media (max-width: 900px) {
  .hero-content { max-width: 100% !important; text-align: center !important; padding-left: 2rem !important; }
  .hero-player-img { width: 100% !important; left: 0 !important; opacity: 0.4; }
  .hero-player-img img { object-position: center top !important; mask-image: none !important; -webkit-mask-image: none !important; }
  .hero-eyebrow { justify-content: center !important; }
  .hero-stats { justify-content: center !important; }
  .hero-cta-group { justify-content: center !important; }
}
` : ""}

${isSplit ? `/* CLEAN LIGHT — SPLIT GRID HERO */
.hero {
  display: grid !important; grid-template-columns: 1fr 1fr; align-items: center;
  padding: 8rem 5% 4rem; gap: 4rem;
}
.hero-bg, .hero-overlay-lines, .scroll-indicator { display: none; }
.hero-inner {
  display: contents !important; padding: 0 !important; max-width: none !important;
  animation: heroFadeIn 1.2s ease-out;
}
.hero-photo-card {
  width: 100% !important; margin: 0 !important; position: static !important;
  box-shadow: 20px 20px 60px rgba(0,0,0,0.06);
}
.hero-photo-card img, .hero-photo-card .photo-placeholder { height: 100% !important; aspect-ratio: 3/4; }
@media (max-width: 900px) {
  .hero { grid-template-columns: 1fr !important; padding: 7rem 2rem 3rem !important; text-align: center; }
  .hero-photo-card { max-width: 360px; margin: 0 auto !important; }
  .hero-eyebrow { justify-content: center; }
  .hero-stats { justify-content: center; }
  .hero-cta-group { justify-content: center; }
}
` : ""}

${theme.isLight ? `/* LIGHT THEME OVERRIDES */
.contact-item-icon svg { stroke: var(--accent); fill: none; }
.about-photo::before { background: linear-gradient(to top, var(--bg-secondary), transparent); }
.contact-form input, .contact-form textarea { background: var(--bg-primary); border-color: var(--border); color: var(--text-primary); }
.stat-card { background: var(--bg-card); border-color: var(--border); }
.nav-links a { color: var(--text-secondary); }
.nav-links a:hover { color: var(--text-primary); }
a { color: var(--text-primary); }
a:hover { color: var(--accent); }
.contact-item-icon { background: rgba(${parseInt(theme.accent.slice(1,3),16)}, ${parseInt(theme.accent.slice(3,5),16)}, ${parseInt(theme.accent.slice(5,7),16)}, 0.08); border-color: rgba(${parseInt(theme.accent.slice(1,3),16)}, ${parseInt(theme.accent.slice(3,5),16)}, ${parseInt(theme.accent.slice(5,7),16)}, 0.15); }
.btn-secondary { color: var(--text-primary); border-color: var(--text-primary); }
.btn-secondary:hover { background: var(--text-primary); color: var(--bg-primary); }
.hero-name em { font-style: normal; color: var(--accent); }
.nav-logo, .hero-name, .section-title, .contact-form h3 { font-weight: 800; }
.stat-card:hover { box-shadow: 0 12px 30px rgba(0,0,0,0.06); }
footer { background: #1a1420 !important; border-color: transparent !important; }
footer .footer-logo, footer .footer-logo span { color: #fff; }
footer .footer-logo span { color: var(--accent); }
footer .footer-tagline { color: rgba(255,255,255,0.5); }
footer .footer-pp { color: rgba(255,255,255,0.4); }
` : ""}

${templateKey === 'fire' ? `/* BOLD FIRE — GLOW + TEXT-STROKE + STAT GRADIENT BAR */
.hero::before {
  content: ''; position: absolute; top: 50%; left: 50%; width: 500px; height: 500px;
  background: radial-gradient(circle, ${theme.accentGlow} 0%, transparent 70%);
  transform: translate(-50%, -50%); pointer-events: none;
}
.hero-name .hero-name-stroke {
  display: block; -webkit-text-stroke: 2px rgba(${parseInt(theme.accent.slice(1,3),16)}, ${parseInt(theme.accent.slice(3,5),16)}, ${parseInt(theme.accent.slice(5,7),16)}, 0.4);
  color: transparent;
}
.stat-card { position: relative; overflow: hidden; }
.stat-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, var(--accent), ${theme.accentGlow.replace('0.25','1')});
  opacity: 0; transition: opacity 0.3s;
}
.stat-card:hover::before { opacity: 1; }
.contact-item-icon { background: rgba(${parseInt(theme.accent.slice(1,3),16)}, ${parseInt(theme.accent.slice(3,5),16)}, ${parseInt(theme.accent.slice(5,7),16)}, 0.08); border-color: rgba(${parseInt(theme.accent.slice(1,3),16)}, ${parseInt(theme.accent.slice(3,5),16)}, ${parseInt(theme.accent.slice(5,7),16)}, 0.2); }
footer { background: var(--bg-card) !important; }
` : ''}

/* RESPONSIVE */
@media (max-width: 900px) {
  nav { padding: 1rem 1.5rem; }
  .nav-links { display:none; position:fixed; inset:0; background:${theme.navBgScrolled}; backdrop-filter:blur(20px); flex-direction:column; align-items:center; justify-content:center; gap:2rem; z-index:200; }
  .nav-links.open { display:flex; }
  .nav-toggle { display:flex; z-index:201; }
  .hero-inner { flex-direction: column; padding: 6rem 1.5rem 3rem; gap: 2rem; }
  .hero-photo-card { width: 100%; max-width: 360px; margin-bottom: 0; align-self: center; }
  .hero-photo-card img, .hero-photo-card .photo-placeholder { height: 320px; }
  .hero-content { text-align: center; }
  .hero-eyebrow { justify-content: center; }
  .hero-stats { justify-content: center; gap: 2rem; }
  .hero-cta-group { justify-content: center; }
  .about-grid { grid-template-columns: 1fr; }
  .about-photo { max-width: 300px; }
  .contact-grid { grid-template-columns: 1fr; }
  .achievements-grid { grid-template-columns: 1fr; gap: 0.8rem; }
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
  ${isOverlay ? `<!-- PP-HERO-PHOTO -->
  <div class="hero-player-img">
    <div class="photo-placeholder">Action Photo Coming Soon</div>
  </div>
  <!-- /PP-HERO-PHOTO -->` : ''}
  <div class="hero-inner">
    <div class="hero-content">
      <div class="hero-eyebrow">Class of ${escHtml(data.grad_year || "2027")}</div>
      <h1 class="hero-name">${templateKey === 'fire'
        ? escHtml(firstName.toUpperCase()) + '<br><span class="hero-name-stroke">' + escHtml(name.split(" ").slice(1).join(" ").toUpperCase()) + '</span>'
        : templateKey === 'clean'
          ? escHtml(firstName.toUpperCase()) + '<br><em>' + escHtml(name.split(" ").slice(1).join(" ").toUpperCase()) + '</em>'
          : escHtml(name.toUpperCase()).replace(" ", "<br>")
      }</h1>
      <p class="hero-tagline">${tagline}</p>
      <!-- PP-HERO-STATS -->
      <div class="hero-stats">
${buildHeroStats(data)}
      </div>
      <!-- /PP-HERO-STATS -->
      <div class="hero-cta-group">
        <a href="#highlights" class="btn-primary">Watch Film</a>
        <a href="#contact" class="btn-secondary">Contact${isOverlay ? ' Me' : ''}</a>
      </div>
    </div>
    ${isSplit ? `<!-- PP-HERO-PHOTO -->
    <div class="hero-photo-card">
      <div class="photo-placeholder">Add Action Photo</div>
    </div>
    <!-- /PP-HERO-PHOTO -->` : ''}
  </div>
  ${!isSplit ? `<div class="scroll-indicator">
    <span>Scroll</span>
    <div class="scroll-arrow"></div>
  </div>` : ''}
</section>

<!-- STATS -->
<section id="stats">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">Performance</div>
      <h2 class="section-title">BY THE NUMBERS</h2>
      <p class="section-subtitle">Current and career statistics.</p>
    </div>
    <!-- PP-PERF-STATS -->
    ${buildStatCards(data)}
    <!-- /PP-PERF-STATS -->
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
    <!-- PP-FILM -->
    <div class="film-placeholder reveal" id="filmArea">
      <div style="font-size:3rem; margin-bottom:1rem;">🎬</div>
      <h3>GAME FILM COMING SOON</h3>
      <p style="max-width:400px; margin:0 auto; line-height:1.7; font-size:0.95rem;">Log in to your Prospect Pages dashboard to upload and manage your highlight clips.</p>
    </div>
    <!-- /PP-FILM -->
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
        <!-- PP-INFO -->
        <div class="about-info-grid reveal">
          ${data.high_school ? `<div class="info-card"><div class="info-card-label">School</div><div class="info-card-value">${escHtml(data.high_school)}</div></div>` : ""}
          ${data.grad_year ? `<div class="info-card"><div class="info-card-label">Class</div><div class="info-card-value">${escHtml(data.grad_year)}</div></div>` : ""}
          ${data.position ? `<div class="info-card"><div class="info-card-label">Position</div><div class="info-card-value">${escHtml(data.position)}</div></div>` : ""}
          ${data.travel_team ? `<div class="info-card"><div class="info-card-label">Travel / Club</div><div class="info-card-value">${escHtml(data.travel_team)}</div></div>` : ""}
        </div>
        <!-- /PP-INFO -->
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

// Film player controls (used when videos are published)
function playVideo(el) {
  var vid = document.getElementById('mainVideo');
  if (vid) {
    vid.src = el.getAttribute('data-src');
    vid.play();
    document.getElementById('filmNowTitle').textContent = el.getAttribute('data-title') || '';
    document.getElementById('filmNowMeta').textContent = el.getAttribute('data-meta') || '';
    var cat = el.getAttribute('data-cat') || '';
    document.getElementById('filmNowTag').textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    document.querySelectorAll('.film-thumb').forEach(function(t) { t.classList.remove('active'); });
    el.classList.add('active');
    var all = document.querySelectorAll('.film-thumb');
    var idx = Array.prototype.indexOf.call(all, el);
    document.getElementById('filmCount').textContent = (idx + 1) + ' of ' + all.length;
    document.getElementById('filmPlayer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function filterFilm(tab) {
  var cat = tab.getAttribute('data-cat');
  document.querySelectorAll('.film-tab').forEach(function(t) { t.classList.remove('active'); });
  tab.classList.add('active');
  document.querySelectorAll('.film-thumb').forEach(function(t) {
    t.style.display = (cat === 'all' || t.getAttribute('data-cat') === cat) ? '' : 'none';
  });
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

    // 6. Create invite code in invite_codes table
    // Only use columns guaranteed to exist: code, client_name, sport
    // Try with created_by first; if it fails, retry without it
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
      console.log("Invite code created:", inviteCode);
    } catch (e) {
      console.log("Invite code insert (with created_by) failed:", e.message, "— retrying without...");
      try {
        await supaFetch("/rest/v1/invite_codes", {
          method: "POST",
          body: {
            code: inviteCode,
            client_name: data.athlete_name,
            sport: data.sport,
          },
        });
        console.log("Invite code created (without created_by):", inviteCode);
      } catch (e2) {
        console.error("Invite code insert FAILED completely:", e2.message);
      }
    }

    // 7. Send email notification to David (Web3Forms free plan only sends to registered email)
    // Combine admin + parent info into one email so David has everything
    try {
      const emailBody = [
        `NEW SITE AUTO-GENERATED`,
        `========================`,
        ``,
        `Athlete: ${data.athlete_name}`,
        `Sport: ${data.sport}`,
        `Grad Year: ${data.grad_year || "N/A"}`,
        `Position: ${data.position || "N/A"}`,
        `School: ${data.high_school || "N/A"}, ${data.city_state || "N/A"}`,
        ``,
        `PARENT INFO`,
        `Name: ${data.parent_name}`,
        `Email: ${data.parent_email}`,
        `Phone: ${data.parent_phone || "N/A"}`,
        `Preferred Contact: ${data.contact_method || "email"}`,
        ``,
        `INVITE CODE: ${inviteCode}`,
        ``,
        `FORWARD THIS TO THE PARENT:`,
        `---`,
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
        `From the dashboard you can:`,
        `- Upload hero photos and headshots`,
        `- Upload and manage game film`,
        `- Update stats and measurables`,
        `- Generate personalized coach outreach emails`,
        `- Track your recruiting outreach`,
        ``,
        `— David Medina`,
        `Prospect Pages`,
        `david@prospectpages.college`,
        `---`,
        ``,
        `Review in admin: https://prospectpages.net/admin`,
      ].join("\n");

      const emailFd = new URLSearchParams();
      emailFd.append("access_key", "5fa35adf-581a-4cfe-afa6-8b8811ed2219");
      emailFd.append("subject", `🚀 New Site: ${data.athlete_name || "Athlete"} (${data.sport || "Unknown"}) — Invite: ${inviteCode}`);
      emailFd.append("from_name", "Prospect Pages Auto-Gen");
      emailFd.append("message", emailBody);
      const emailRes = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: emailFd.toString(),
      });
      const emailResult = await emailRes.json();
      console.log("Email notification result:", emailResult.success ? "sent" : JSON.stringify(emailResult));
    } catch (e) {
      console.error("Email notification failed:", e.message);
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
