const crypto = require('crypto');

const SUPABASE_URL = "https://ildcajsjreayvinutwyr.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Supabase helper ──
async function supaFetch(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Inject PP markers into legacy HTML ──
function injectPPMarkers(html) {
  let result = html;

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

  if (!result.includes('<!-- PP-PERF-STATS -->')) {
    result = result.replace(
      /(<div class="stats-grid">)/,
      '<!-- PP-PERF-STATS -->\n    $1'
    );
    result = result.replace(
      /(<\/div>\s*<\/div>\s*<\/section>\s*(?:<!-- HIGHLIGHTS -->|<section id="highlights">))/,
      '</div>\n    <!-- /PP-PERF-STATS -->\n  </div>\n</section>\n\n<!-- HIGHLIGHTS -->\n<section id="highlights">'
    );
  }

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

  if (!result.includes('<!-- PP-FILM -->')) {
    result = result.replace(
      /(<div class="film-placeholder reveal")/,
      '<!-- PP-FILM -->\n    $1'
    );
    result = result.replace(
      /(GAME FILM COMING SOON<\/h3>[\s\S]*?<\/p>\s*<\/div>)/,
      '$1\n    <!-- /PP-FILM -->'
    );
  }

  if (!result.includes('<!-- PP-HERO-PHOTO -->')) {
    // Legacy sites don't have the photo card at all — inject one before scroll indicator or closing hero div
    if (result.includes('hero-photo-card')) {
      result = result.replace(
        /(<div class="hero-photo-card">)/,
        '<!-- PP-HERO-PHOTO -->\n    $1'
      );
      result = result.replace(
        /(<\/div>\s*<!-- \/PP-HERO-PHOTO -->)/,
        '</div>\n    <!-- /PP-HERO-PHOTO -->'
      );
    }
  }

  // Footer branding
  if (!result.includes('Built by') && !result.includes('Prospect Pages</a>')) {
    result = result.replace(
      /<\/div>\s*<\/footer>/,
      `<div class="footer-pp">Built by <a href="https://prospectpages.net" target="_blank">Prospect Pages</a></div>\n  </div>\n</footer>`
    );
    if (!result.includes('.footer-pp')) {
      result = result.replace(
        '</style>',
        `.footer-pp { font-size: 0.7rem; color: var(--text-muted); margin-top: 1rem; opacity: 0.6; }\n.footer-pp a { color: var(--gold); text-decoration: none; }\n.footer-pp a:hover { text-decoration: underline; }\n</style>`
      );
    }
  }

  return result;
}

// ── Film player CSS ──
const FILM_CSS = `
/* FILM PLAYER */
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
.film-tab:hover, .film-tab.active { border-color: var(--accent); color: var(--accent); background: rgba(230,58,46,0.08); }
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
.gallery-item {
  border-radius: 4px; overflow: hidden; border: 1px solid var(--border);
  transition: transform 0.3s, border-color 0.3s;
}
.gallery-item:hover { transform: translateY(-4px); border-color: rgba(255,255,255,0.12); }
.gallery-item img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; }
`;

// ── Film player JS ──
const FILM_JS = `
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
`;

// ── Inject photos into HTML ──
function injectPhotos(html, photos) {
  if (!photos) return html;
  let result = html;

  if (photos.hero_photo_url) {
    // Update the PP-HERO-PHOTO marker if present
    result = result.replace(
      /<!-- PP-HERO-PHOTO -->[\s\S]*?<!-- \/PP-HERO-PHOTO -->/,
      `<!-- PP-HERO-PHOTO -->\n    <div class="hero-photo-card">\n      <img src="${photos.hero_photo_url}" alt="Athlete action photo">\n    </div>\n    <!-- /PP-HERO-PHOTO -->`
    );

    // Replace content inside hero-player-img (placeholder OR previously injected img)
    if (result.includes('hero-player-img') && /<div class="hero-player-img"/.test(result)) {
      // hero-player-img div exists — replace its contents
      result = result.replace(
        /(<div class="hero-player-img"[^>]*>)\s*(?:<div class="photo-placeholder">[^<]*<\/div>|<img[^>]*>)\s*(<\/div>)/,
        `$1\n    <img src="${photos.hero_photo_url}" alt="Athlete action photo">\n  $2`
      );
    } else if (result.includes('.hero-player-img')) {
      // CSS exists but div doesn't — inject the div after hero-overlay-lines
      result = result.replace(
        /(<div class="hero-overlay-lines"><\/div>)/,
        `$1\n  <div class="hero-player-img" style="position:absolute; right:0; top:0; bottom:0; width:45%; z-index:1; overflow:hidden; display:flex; align-items:flex-end; justify-content:center;">\n    <img src="${photos.hero_photo_url}" alt="Athlete action photo" style="width:100%; height:100%; object-fit:cover; object-position:center top;">\n  </div>`
      );
    }

    // If hero-player-img exists (Dark Pro layout), photo goes there as right-side cutout
    // If NOT, photo goes into .hero-bg as full background
    if (result.includes('hero-player-img')) {
      // hero-player-img already handled by placeholder replacement above
    } else {
      // No cutout layout — use as full background image
      result = result.replace(
        /\.hero-bg\s*\{[\s\S]*?\}/,
        `.hero-bg {\n  position: absolute; inset: 0;\n  background: url('${photos.hero_photo_url}') center 20% / cover no-repeat;\n}`
      );
    }
  }

  if (photos.headshot_url) {
    // Match about-photo div with any content inside (multiline), including whitespace
    result = result.replace(
      /<div class="about-photo reveal">\s*(?:PHOTO COMING SOON|[\s\S]*?)\s*<\/div>/,
      `<div class="about-photo reveal"><img src="${photos.headshot_url}" alt="Athlete headshot"></div>`
    );
  }

  const additional = photos.additional_photos || [];
  if (additional.length > 0) {
    const cards = additional
      .filter(p => p && p.url)
      .map(p => `<div class="gallery-item"><img src="${p.url}" alt="${p.caption || 'Photo'}" loading="lazy"></div>`)
      .join('\n      ');

    const gallerySection = `\n<!-- PHOTO GALLERY -->\n<section id="gallery" style="padding:6rem 0;">\n  <div class="container">\n    <div class="section-header reveal">\n      <div class="section-label">Gallery</div>\n      <h2 class="section-title">PHOTOS</h2>\n    </div>\n    <div class="gallery-grid reveal" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">\n      ${cards}\n    </div>\n  </div>\n</section>`;

    result = result.replace(/\n<!-- PHOTO GALLERY -->[\s\S]*?<\/section>\s*(?=\n*<!-- FOOTER -->)/, '');
    result = result.replace('<!-- FOOTER -->', gallerySection + '\n\n<!-- FOOTER -->');

    if (!result.includes('href="#gallery"')) {
      result = result.replace(
        '<a href="#contact" class="nav-cta">Contact</a>',
        '<a href="#gallery">Gallery</a>\n    <a href="#contact" class="nav-cta">Contact</a>'
      );
    }
  }

  return result;
}

// ── Inject social links into footer ──
function injectSocialLinks(html, profileData) {
  if (!profileData) return html;
  let result = html;
  const ig = profileData.athlete_instagram;
  const yt = profileData.athlete_youtube;

  // ALWAYS strip ALL existing social link divs in footer to prevent duplication
  result = result.replace(/<div style="display:flex;gap:8px;justify-content:center;margin-top:1rem;">[\s\S]*?<\/div>\s*\n?/g, '');

  if (!ig && !yt) return result;

  // Build social links HTML
  let socialHtml = '';
  if (ig) {
    const handle = ig.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\/?/, '').replace(/\/+$/, '');
    socialHtml += `<a href="https://instagram.com/${handle}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid var(--border);color:var(--text-secondary);text-decoration:none;transition:all 0.3s;" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-secondary)'"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg></a>`;
  }
  if (yt) {
    const ytUrl = yt.startsWith('http') ? yt : `https://youtube.com/${yt.replace(/^@/, '@')}`;
    socialHtml += `<a href="${ytUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid var(--border);color:var(--text-secondary);text-decoration:none;transition:all 0.3s;" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-secondary)'"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.81zM9.75 15.02V8.98L15.5 12l-5.75 3.02z"/></svg></a>`;
  }

  if (socialHtml) {
    const socialWrap = `<div style="display:flex;gap:8px;justify-content:center;margin-top:1rem;">${socialHtml}</div>`;
    if (result.includes('footer-pp')) {
      result = result.replace(/<div class="footer-pp">/, socialWrap + '\n    <div class="footer-pp">');
    } else {
      result = result.replace(/<\/div>\s*<\/footer>/, socialWrap + '\n  </div>\n</footer>');
    }
  }

  return result;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const NETLIFY_TOKEN = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;
  if (!NETLIFY_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'NETLIFY_AUTH_TOKEN not configured' }) };
  }

  try {
    const { siteId, siteUrl, stats, measurables, sport, profile, videos } = JSON.parse(event.body);

    if (!siteId || !siteUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing siteId or siteUrl' }) };
    }

    // Normalize URL
    let fetchUrl = siteUrl;
    if (fetchUrl && !fetchUrl.startsWith('http')) {
      fetchUrl = 'https://' + fetchUrl;
    }

    // Step 1: Fetch the CURRENT live site HTML
    const siteRes = await fetch(fetchUrl, { headers: { 'Cache-Control': 'no-cache' } });
    if (!siteRes.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Could not fetch site: ' + siteRes.status }) };
    }
    let html = await siteRes.text();

    // Step 1b: Inject PP markers if missing (legacy sites)
    html = injectPPMarkers(html);

    // Step 1c: Inject photos and social links from profile
    let photoReplacements = 0;
    if (profile && SUPABASE_SERVICE_KEY) {
      try {
        const userId = profile.id;
        if (userId) {
          const profiles = await supaFetch(
            `/rest/v1/profiles?id=eq.${userId}&select=hero_photo_url,headshot_url,additional_photos,athlete_instagram,athlete_youtube,athlete_bio`
          );
          if (profiles && profiles.length) {
            const beforeLen = html.length;
            html = injectPhotos(html, profiles[0]);
            if (html.length !== beforeLen) photoReplacements++;
            html = injectSocialLinks(html, profiles[0]);

            // Inject bio if available — check profiles first, then sites table
            let bioText = profiles[0].athlete_bio || '';
            if (!bioText && siteId) {
              try {
                const siteRows = await supaFetch(`/rest/v1/sites?netlify_site_id=eq.${siteId}&select=generated_bio`);
                if (siteRows && siteRows.length && siteRows[0].generated_bio) {
                  bioText = siteRows[0].generated_bio;
                }
              } catch (e) { console.log('Bio fallback:', e.message); }
            }
            if (bioText) {
              const safeBio = bioText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const bioParas = safeBio.split(/\n+/).filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('\n            ');
              html = html.replace(
                /<div class="about-bio reveal">[\s\S]*?<\/div>/,
                `<div class="about-bio reveal">\n            ${bioParas}\n          </div>`
              );
            }
          }
        }
      } catch (e) {
        console.log('Photo/social injection:', e.message);
      }
    }

    const statLabels = {
      baseball: { batting_avg: 'Batting Avg', home_runs: 'Home Runs', rbis: 'RBIs', stolen_bases: 'Stolen Bases', era: 'ERA', pitching_velo: 'Pitching Velo', exit_velo: 'Exit Velo (mph)', fielding_pct: 'Fielding %', sixty_yard: '60-Yard Dash' },
      softball: { batting_avg: 'Batting Avg', home_runs: 'Home Runs', era: 'ERA', fielding_pct: 'Fielding %', pitching_velo: 'Pitching Velo', stolen_bases: 'Stolen Bases', slugging_pct: 'Slugging %' },
      basketball: { ppg: 'Points/Game', apg: 'Assists/Game', rpg: 'Rebounds/Game', spg: 'Steals/Game', fg_pct: 'FG %', three_pct: '3PT %', ft_pct: 'FT %' },
      football: { pass_yards: 'Pass Yards', touchdowns: 'Touchdowns', comp_pct: 'Comp %', rush_yards: 'Rush Yards', tackles: 'Tackles', interceptions: 'INTs', forty_yard: '40-Yard' },
      soccer: { goals: 'Goals', assists: 'Assists', shots_per_game: 'Shots/Game', pass_accuracy: 'Pass Acc', minutes_played: 'Minutes' },
      volleyball: { kills: 'Kills', kills_per_set: 'Kills/Set', hit_pct: 'Hit %', digs: 'Digs', aces: 'Aces', blocks: 'Blocks' },
      track: { event_100m: '100m (sec)', event_200m: '200m (sec)', event_400m: '400m (sec)', long_jump: 'Long Jump', high_jump: 'High Jump', relay_split: 'Relay Split' },
    };

    const labels = statLabels[sport] || statLabels.baseball;
    let replacements = 0;

    // ── PP-HERO-STATS ──
    if (measurables && html.includes('<!-- PP-HERO-STATS -->')) {
      const height = measurables.athlete_height || '';
      const weight = measurables.athlete_weight || '';
      const hand = measurables.athlete_bats_throws || measurables.athlete_dominant_hand || measurables.athlete_dominant_foot || '';
      const handLabel = (sport === 'soccer') ? 'Dominant Foot' : (sport === 'baseball' || sport === 'softball') ? 'Bats / Throws' : 'Dominant Hand';
      const gpa = measurables.athlete_gpa || profile.athlete_gpa || '';
      const heroItems = [];
      if (height) heroItems.push('      <div class="hero-stat">\n        <div class="hero-stat-value">' + height + '</div>\n        <div class="hero-stat-label">Height</div>\n      </div>');
      if (weight) heroItems.push('      <div class="hero-stat">\n        <div class="hero-stat-value">' + weight + '</div>\n        <div class="hero-stat-label">Weight (lbs)</div>\n      </div>');
      if (hand) heroItems.push('      <div class="hero-stat">\n        <div class="hero-stat-value">' + hand + '</div>\n        <div class="hero-stat-label">' + handLabel + '</div>\n      </div>');
      if (gpa) heroItems.push('      <div class="hero-stat">\n        <div class="hero-stat-value">' + gpa + '</div>\n        <div class="hero-stat-label">GPA</div>\n      </div>');
      if (heroItems.length > 0) {
        const newHero = '<!-- PP-HERO-STATS -->\n    <div class="hero-stats">\n' + heroItems.join('\n') + '\n    </div>\n    <!-- /PP-HERO-STATS -->';
        html = html.replace(/<!-- PP-HERO-STATS -->[\s\S]*?<!-- \/PP-HERO-STATS -->/, newHero);
        replacements++;
      }
    }

    // ── PP-PERF-STATS ──
    if (stats && html.includes('<!-- PP-PERF-STATS -->')) {
      const statCards = Object.entries(stats)
        .filter(function(e) { return e[1] && labels[e[0]]; })
        .map(function(e) {
          return '      <div class="stat-card reveal">\n        <div class="stat-number">' + e[1] + '</div>\n        <div class="stat-label">' + labels[e[0]] + '</div>\n      </div>';
        }).join('\n');
      if (statCards) {
        const newStats = '<!-- PP-PERF-STATS -->\n    <div class="stats-grid">\n' + statCards + '\n    </div>\n    <!-- /PP-PERF-STATS -->';
        html = html.replace(/<!-- PP-PERF-STATS -->[\s\S]*?<!-- \/PP-PERF-STATS -->/, newStats);
        replacements++;
      }
    }

    // ── PP-INFO ──
    if (measurables && html.includes('<!-- PP-INFO -->')) {
      const pos = profile.athlete_position || '';
      const school = measurables.athlete_school || '';
      const gradYear = profile.athlete_grad_year || '';
      const team = measurables.athlete_travel_team || '';
      const infoCards = [];
      if (pos) infoCards.push('          <div class="info-card">\n            <div class="info-card-label">Position</div>\n            <div class="info-card-value">' + pos + '</div>\n          </div>');
      if (school) infoCards.push('          <div class="info-card">\n            <div class="info-card-label">High School</div>\n            <div class="info-card-value">' + school + '</div>\n          </div>');
      if (gradYear) infoCards.push('          <div class="info-card">\n            <div class="info-card-label">Graduation</div>\n            <div class="info-card-value">Class of ' + gradYear + '</div>\n          </div>');
      if (team) infoCards.push('          <div class="info-card">\n            <div class="info-card-label">Travel Team</div>\n            <div class="info-card-value">' + team + '</div>\n          </div>');
      if (infoCards.length > 0) {
        const newInfo = '<!-- PP-INFO -->\n        <div class="about-info-grid">\n' + infoCards.join('\n') + '\n        </div>\n        <!-- /PP-INFO -->';
        html = html.replace(/<!-- PP-INFO -->[\s\S]*?<!-- \/PP-INFO -->/, newInfo);
        replacements++;
      }
    }

    // ── PP-FILM (videos) ──
    if (videos && videos.length > 0 && html.includes('<!-- PP-FILM -->')) {
      const fv = videos[0];
      const catLabels = {
        pitching:'Pitching', hitting:'Hitting', fielding:'Fielding / 1B',
        offense:'Offense', defense:'Defense', highlights:'Highlights',
        special_teams:'Special Teams', goals:'Goals', assists:'Assists',
        serves:'Serves', sprints:'Sprints', jumps:'Jumps', throws:'Throws',
      };
      const cats = [];
      videos.forEach(function(v) { if (cats.indexOf(v.category) === -1) cats.push(v.category); });

      let f = '<!-- PP-FILM -->\n';
      f += '    <!-- Main Player -->\n';
      f += '    <div class="film-player-wrap reveal" id="filmPlayer">\n';
      f += '      <div class="film-main-video" id="filmMainVideo">\n';
      f += '        <video id="mainVideo" controls playsinline preload="auto" src="' + fv.video_url + '" style="width:100%;display:block;background:#000;"></video>\n';
      f += '      </div>\n';
      f += '      <div class="film-now-playing">\n        <div>\n';
      f += '          <div class="film-now-tag" id="filmNowTag">' + (fv.category.charAt(0).toUpperCase() + fv.category.slice(1)) + '</div>\n';
      f += '          <div class="film-now-title" id="filmNowTitle">' + fv.title + '</div>\n';
      f += '          <div class="film-now-meta" id="filmNowMeta">' + (fv.meta_text||'') + '</div>\n';
      f += '        </div>\n';
      f += '        <div class="film-count" id="filmCount">1 of ' + videos.length + '</div>\n';
      f += '      </div>\n    </div>\n\n';

      f += '    <!-- Category Tabs -->\n    <div class="film-tabs reveal" id="filmTabs">\n';
      f += '      <div class="film-tab active" data-cat="all" onclick="filterFilm(this)">All Film</div>\n';
      cats.forEach(function(c) {
        f += '      <div class="film-tab" data-cat="' + c + '" onclick="filterFilm(this)">' + (catLabels[c]||c.charAt(0).toUpperCase()+c.slice(1)) + '</div>\n';
      });
      f += '    </div>\n\n    <!-- Thumbnail Strip -->\n    <div class="film-thumbs reveal" id="filmThumbs">\n\n';

      videos.forEach(function(v, i) {
        var n = String(i+1).padStart(2,'0');
        var cl = catLabels[v.category]||v.category.charAt(0).toUpperCase()+v.category.slice(1);
        f += '      <div class="film-thumb' + (i===0?' active':'') + '" data-src="' + v.video_url + '" data-cat="' + v.category + '" data-title="' + v.title + '" data-meta="' + (v.meta_text||'') + '" onclick="playVideo(this)">\n';
        f += '        <div class="film-thumb-preview"><div class="film-thumb-number">' + n + '</div><div class="film-thumb-play"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div><div class="film-thumb-duration">' + (v.duration||'1:00') + '</div></div>\n';
        f += '        <div class="film-thumb-info"><div class="film-thumb-cat">' + cl + '</div><div class="film-thumb-title">' + v.title + '</div><div class="film-thumb-meta">' + (v.meta_text||'') + '</div></div>\n';
        f += '      </div>\n\n';
      });

      f += '    </div>\n    <!-- /PP-FILM -->';
      html = html.replace(/<!-- PP-FILM -->[\s\S]*?<!-- \/PP-FILM -->/, f);
      replacements++;

      // Inject film CSS if not already present
      if (!html.includes('.film-player-wrap')) {
        html = html.replace('</style>', FILM_CSS + '\n</style>');
      }

      // Inject film JS if not already present
      if (!html.includes('function playVideo')) {
        html = html.replace('</script>\n</body>', FILM_JS + '</script>\n</body>');
      }
    }

    if (replacements === 0 && photoReplacements === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No PP markers found in site HTML. Make sure the template has PP markers.' }) };
    }

    // Step 3: Deploy via Netlify API
    const siteInfoRes = await fetch('https://api.netlify.com/api/v1/sites/' + siteId, {
      headers: { Authorization: 'Bearer ' + NETLIFY_TOKEN },
    });
    if (!siteInfoRes.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Site not found in Netlify' }) };
    }
    const siteInfo = await siteInfoRes.json();

    let existingFiles = {};
    const currentDeployId = siteInfo.published_deploy ? siteInfo.published_deploy.id : null;
    if (currentDeployId) {
      const deployRes = await fetch('https://api.netlify.com/api/v1/deploys/' + currentDeployId, {
        headers: { Authorization: 'Bearer ' + NETLIFY_TOKEN },
      });
      if (deployRes.ok) {
        const deploy = await deployRes.json();
        existingFiles = deploy.files || {};
      }
    }

    const sha1 = crypto.createHash('sha1').update(html).digest('hex');
    existingFiles['/index.html'] = sha1;

    const newDeployRes = await fetch('https://api.netlify.com/api/v1/sites/' + siteId + '/deploys', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + NETLIFY_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: existingFiles }),
    });
    if (!newDeployRes.ok) {
      const err = await newDeployRes.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Deploy failed: ' + err }) };
    }

    const deployData = await newDeployRes.json();
    if (deployData.required && deployData.required.includes(sha1)) {
      const uploadRes = await fetch(
        'https://api.netlify.com/api/v1/deploys/' + deployData.id + '/files/index.html',
        { method: 'PUT', headers: { Authorization: 'Bearer ' + NETLIFY_TOKEN, 'Content-Type': 'application/octet-stream' }, body: html }
      );
      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'File upload failed: ' + err }) };
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, replacements, deployId: deployData.id, siteUrl: siteInfo.ssl_url || siteInfo.url }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
