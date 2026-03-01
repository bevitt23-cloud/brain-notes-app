const https = require('https');
const http = require('http');

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    };

    const req = client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirect = res.headers.location;
        if (redirect.startsWith('/')) {
          const base = new URL(url);
          redirect = base.origin + redirect;
        }
        return fetchPage(redirect).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Page returned status ${res.statusCode}. Try copying and pasting the text instead.`));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', () => reject(new Error('Could not reach that URL. The site may be blocking outside access.')));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out. Try copying and pasting the text instead.')); });
  });
}

function extractImages(html, baseUrl) {
  const images = [];
  const seen = new Set();

  // Match <img> tags and extract src + alt
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

    // Skip tiny icons, tracking pixels, logos, ads
    if (src.includes('icon') || src.includes('logo') || src.includes('pixel') ||
        src.includes('tracking') || src.includes('ad') || src.includes('banner') ||
        src.includes('avatar') || src.includes('spinner') || src.includes('loading')) continue;
    if (alt && (alt.toLowerCase().includes('icon') || alt.toLowerCase().includes('logo') || alt.toLowerCase().includes('avatar'))) continue;

    // Make relative URLs absolute
    if (src.startsWith('//')) src = 'https:' + src;
    else if (src.startsWith('/')) {
      try { src = new URL(baseUrl).origin + src; } catch(e) { continue; }
    } else if (!src.startsWith('http')) {
      try { src = new URL(src, baseUrl).href; } catch(e) { continue; }
    }

    if (seen.has(src)) continue;
    seen.add(src);

    images.push({ src, alt: alt || 'Image from page' });
    if (images.length >= 10) break; // cap at 10 images
  }

  return images;
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
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
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { url } = JSON.parse(event.body || '{}');

    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
    if (!url.startsWith('http')) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a full URL starting with https://' }) };

    const html = await fetchPage(url);
    let text = extractText(html);
    const images = extractImages(html, url);

    if (text.length < 100) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: 'Could not extract enough text from that page. Try copying and pasting the text instead.' }) };
    }

    if (text.length > 15000) text = text.substring(0, 15000) + '\n\n[Content trimmed for length]';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text, images, sourceUrl: url })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Could not fetch that URL. Try copying and pasting the text instead.' })
    };
  }
};
