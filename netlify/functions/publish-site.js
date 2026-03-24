const crypto = require('crypto');

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

  const NETLIFY_TOKEN = process.env.NETLIFY_AUTH_TOKEN;
  if (!NETLIFY_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'NETLIFY_AUTH_TOKEN not configured' }) };
  }

  try {
    const { siteId, siteUrl, stats, measurables, sport, profile, videos } = JSON.parse(event.body);

    if (!siteId || !siteUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing siteId or siteUrl' }) };
    }

    // Step 1: Fetch the CURRENT live site HTML
    const siteRes = await fetch(siteUrl, { headers: { 'Cache-Control': 'no-cache' } });
    if (!siteRes.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Could not fetch site: ' + siteRes.status }) };
    }
    let html = await siteRes.text();

    const statLabels = {
      baseball: { batting_avg: 'Batting Avg', home_runs: 'Home Runs', rbis: 'RBIs', stolen_bases: 'Stolen Bases', era: 'ERA', pitching_velo: 'Pitching Velo', exit_velo: 'Exit Velo (mph)', fielding_pct: 'Fielding %' },
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
      const gpa = profile.gpa || '';
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
    }

    if (replacements === 0) {
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
