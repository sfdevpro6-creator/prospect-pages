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
    const { siteId, siteUrl, stats, measurables, sport, profile } = JSON.parse(event.body);

    if (!siteId || !siteUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing siteId or siteUrl' }) };
    }

    // Step 1: Fetch the CURRENT live site HTML
    const siteRes = await fetch(siteUrl, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!siteRes.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Could not fetch site: ' + siteRes.status }) };
    }
    let html = await siteRes.text();

    // Step 2: Replace content between PP markers only
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

    // Replace hero stats (measurables)
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

    // Replace performance stats
    if (stats && html.includes('<!-- PP-PERF-STATS -->')) {
      const statCards = Object.entries(stats)
        .filter(function(entry) { return entry[1] && labels[entry[0]]; })
        .map(function(entry) {
          return '      <div class="stat-card reveal">\n        <div class="stat-number">' + entry[1] + '</div>\n        <div class="stat-label">' + labels[entry[0]] + '</div>\n      </div>';
        })
        .join('\n');

      if (statCards) {
        const newStats = '<!-- PP-PERF-STATS -->\n    <div class="stats-grid">\n' + statCards + '\n    </div>\n    <!-- /PP-PERF-STATS -->';
        html = html.replace(/<!-- PP-PERF-STATS -->[\s\S]*?<!-- \/PP-PERF-STATS -->/, newStats);
        replacements++;
      }
    }

    // Replace info cards
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

    if (replacements === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No PP markers found in site HTML. Add markers before publishing.' }) };
    }

    // Step 3: Deploy modified HTML via Netlify API
    const siteInfoRes = await fetch('https://api.netlify.com/api/v1/sites/' + siteId, {
      headers: { Authorization: 'Bearer ' + NETLIFY_TOKEN },
    });
    if (!siteInfoRes.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Site not found in Netlify' }) };
    }
    const siteInfo = await siteInfoRes.json();

    // Get existing files from current deploy
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

    // SHA1 of modified HTML
    const sha1 = crypto.createHash('sha1').update(html).digest('hex');
    existingFiles['/index.html'] = sha1;

    // Create new deploy with all files
    const newDeployRes = await fetch('https://api.netlify.com/api/v1/sites/' + siteId + '/deploys', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + NETLIFY_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: existingFiles }),
    });
    if (!newDeployRes.ok) {
      const err = await newDeployRes.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Deploy failed: ' + err }) };
    }

    const deployData = await newDeployRes.json();

    // Upload only index.html
    if (deployData.required && deployData.required.includes(sha1)) {
      const uploadRes = await fetch(
        'https://api.netlify.com/api/v1/deploys/' + deployData.id + '/files/index.html',
        {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer ' + NETLIFY_TOKEN,
            'Content-Type': 'application/octet-stream',
          },
          body: html,
        }
      );
      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'File upload failed: ' + err }) };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        replacements: replacements,
        deployId: deployData.id,
        siteUrl: siteInfo.ssl_url || siteInfo.url,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
