const crypto = require('crypto');

exports.handler = async (event) => {
  // CORS headers
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
    const { html, siteId } = JSON.parse(event.body);

    if (!html || !siteId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing html or siteId' }) };
    }

    // Step 1: Get current site info to find the published deploy
    const siteRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` },
    });

    if (!siteRes.ok) {
      const err = await siteRes.text();
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Site not found: ${err}` }) };
    }

    const site = await siteRes.json();
    const currentDeployId = site.published_deploy?.id;

    // Step 2: Get existing files from current deploy (so we keep videos, images, etc.)
    let existingFiles = {};
    if (currentDeployId) {
      const deployRes = await fetch(`https://api.netlify.com/api/v1/deploys/${currentDeployId}`, {
        headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` },
      });
      if (deployRes.ok) {
        const deploy = await deployRes.json();
        existingFiles = deploy.files || {};
      }
    }

    // Step 3: Calculate SHA1 of the new index.html
    const sha1 = crypto.createHash('sha1').update(html).digest('hex');
    existingFiles['/index.html'] = sha1;

    // Step 4: Create new deploy with all files (existing + updated index.html)
    const newDeployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NETLIFY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: existingFiles }),
    });

    if (!newDeployRes.ok) {
      const err = await newDeployRes.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Deploy create failed: ${err}` }) };
    }

    const deployData = await newDeployRes.json();

    // Step 5: Upload only the files Netlify doesn't already have (should just be index.html)
    if (deployData.required && deployData.required.includes(sha1)) {
      const uploadRes = await fetch(
        `https://api.netlify.com/api/v1/deploys/${deployData.id}/files/index.html`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${NETLIFY_TOKEN}`,
            'Content-Type': 'application/octet-stream',
          },
          body: html,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return { statusCode: 500, headers, body: JSON.stringify({ error: `File upload failed: ${err}` }) };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        deployId: deployData.id,
        siteUrl: site.ssl_url || site.url,
        siteName: site.name,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
