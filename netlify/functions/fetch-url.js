const https = require('https');
const http = require('http');

// ── Direct fetch (for sites that don't block) ──
function directFetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
      }
    };

    const req = client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirect = res.headers.location;
        if (redirect.startsWith('/')) {
          try { redirect = new URL(url).origin + redirect; } catch(e) { return reject(new Error('Redirect failed')); }
        } else if (!redirect.startsWith('http')) {
          try { redirect = new URL(redirect, url).href; } catch(e) { return reject(new Error('Redirect failed')); }
        }
        return directFetch(redirect).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => { data += chunk; if (data.length > 2000000) { req.destroy(); resolve(data); } });
      res.on('end', () => resolve(data));
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── ScrapingBee fetch (for blocked sites) ──
function scrapingBeeFetch(url, apiKey) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      api_key: apiKey,
      url: url,
      render_js: 'false',
      premium_proxy: 'false',
    });

    const sbUrl = `https://app.scrapingbee.com/api/v1/?${params.toString()}`;

    const req = https.get(sbUrl, { headers: { 'Accept': 'text/html' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`ScrapingBee status ${res.statusCode}`));
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('ScrapingBee timeout')); });
  });
}

// ── Extract images from HTML ──
function extractImages(html, baseUrl) {
  const images = [];
  const seen = new Set();
  const imgRegex = /<img[^>]+>/gi;
  const srcRegex = /src=["']([^"']+)["']/i;
  const altRegex = /alt=["']([^"']+)["']/i;

  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0];
    const srcMatch = srcRegex.exec(tag);
    const altMatch = altRegex.exec(tag);
    if (!srcMatch) continue;
    let src = srcMatch[1];
    const alt = altMatch ? altMatch[1].trim() : '';
    if (/icon|logo|pixel|tracking|\.gif$|avatar|spinner|loading|ad[_-]|banner/i.test(src)) continue;
    if (alt && /icon|logo|avatar/i.test(alt)) continue;
    try {
      if (src.startsWith('//')) src = 'https:' + src;
      else if (src.startsWith('/')) src = new URL(url).origin + src;
      else if (!src.startsWith('http')) src = new URL(src, baseUrl).href;
    } catch(e) { continue; }
    if (seen.has(src)) continue;
    seen.add(src);
    images.push({ src, alt: alt || 'Image from page' });
    if (images.length >= 10) break;
  }
  return images;
}

// ── Extract readable text from HTML ──
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { url } = JSON.parse(event.body || '{}');
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
    if (!url.startsWith('http')) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a full URL starting with https://' }) };

    const sbKey = process.env.SCRAPINGBEE_KEY;
    let html = null;
    let usedScrapingBee = false;

    // Try direct fetch first (free, fast)
    try {
      html = await directFetch(url);
    } catch(e) {
      // Direct fetch failed — try ScrapingBee if key is available
      if (sbKey) {
        try {
          html = await scrapingBeeFetch(url, sbKey);
          usedScrapingBee = true;
        } catch(e2) {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Could not access that page. The site may require a login or is heavily restricted. Try copying and pasting the text instead.' })
          };
        }
      } else {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'This website is blocking outside access. Try copying and pasting the text instead.' })
        };
      }
    }

    const images = extractImages(html, url);
    let text = extractText(html);

    if (text.length < 100) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: 'Could not extract enough text from that page. Try copying and pasting the text instead.' })
      };
    }

    if (text.length > 15000) text = text.substring(0, 15000) + '\n\n[Content trimmed for length]';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text, images, sourceUrl: url, usedScrapingBee })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Could not fetch that URL. Try copying and pasting the text instead.' })
    };
  }
};
