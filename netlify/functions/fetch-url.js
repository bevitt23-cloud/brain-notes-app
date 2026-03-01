const https = require('https');
const http = require('http');

// Rotate through realistic browser user agents
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

function getRandomAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function fetchPage(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects.'));

    const client = url.startsWith('https') ? https : http;

    const options = {
      headers: {
        'User-Agent': getRandomAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Connection': 'keep-alive',
      }
    };

    const req = client.get(url, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirect = res.headers.location;
        if (redirect.startsWith('/')) {
          try { redirect = new URL(url).origin + redirect; } catch(e) { return reject(new Error('Could not follow redirect.')); }
        } else if (!redirect.startsWith('http')) {
          try { redirect = new URL(redirect, url).href; } catch(e) { return reject(new Error('Could not follow redirect.')); }
        }
        return fetchPage(redirect, redirectCount + 1).then(resolve).catch(reject);
      }

      if (res.statusCode === 403) {
        return reject(new Error('This website is blocking outside access (403 Forbidden). Try copying and pasting the text instead.'));
      }
      if (res.statusCode === 401) {
        return reject(new Error('This page requires a login. Try copying and pasting the text instead.'));
      }
      if (res.statusCode === 429) {
        return reject(new Error('This website is rate-limiting requests. Try again in a few minutes or paste the text instead.'));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Page returned status ${res.statusCode}. Try copying and pasting the text instead.`));
      }

      // Handle encoding
      res.setEncoding('utf8');
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        // Stop after 2MB to avoid memory issues
        if (data.length > 2000000) { req.destroy(); resolve(data); }
      });
      res.on('end', () => resolve(data));
    });

    req.on('error', (err) => {
      if (err.code === 'ENOTFOUND') return reject(new Error('Could not find that website. Check the URL and try again.'));
      if (err.code === 'ECONNREFUSED') return reject(new Error('The website refused the connection. Try copying and pasting the text instead.'));
      reject(new Error('Could not reach that URL. The site may be blocking outside access.'));
    });

    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error('Request timed out. The site may be slow or blocking access. Try copying and pasting the text instead.'));
    });
  });
}

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

    // Skip icons, logos, tracking pixels
    if (/icon|logo|pixel|tracking|\.gif$|avatar|spinner|loading|ad[_-]|banner/i.test(src)) continue;
    if (alt && /icon|logo|avatar/i.test(alt)) continue;

    // Make relative URLs absolute
    try {
      if (src.startsWith('//')) src = 'https:' + src;
      else if (src.startsWith('/')) src = new URL(baseUrl).origin + src;
      else if (!src.startsWith('http')) src = new URL(src, baseUrl).href;
    } catch(e) { continue; }

    if (seen.has(src)) continue;
    seen.add(src);
    images.push({ src, alt: alt || 'Image from page' });
    if (images.length >= 10) break;
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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { url } = body;

    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
    if (!url.startsWith('http')) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a full URL starting with https://' }) };

    const html = await fetchPage(url);
    let text = extractText(html);
    const images = extractImages(html, url);

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
