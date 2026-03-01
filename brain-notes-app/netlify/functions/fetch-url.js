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
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Page returned status ${res.statusCode}. Try copying and pasting the text instead.`));
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', (err) => reject(new Error('Could not reach that URL. The site may be blocking outside access.')));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out. Try copying and pasting the text instead.')); });
  });
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

    if (!url) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No URL provided' }) };
    }

    if (!url.startsWith('http')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a full URL starting with https://' }) };
    }

    const html = await fetchPage(url);
    let text = extractText(html);

    if (text.length < 100) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: 'Could not extract enough text from that page. Try copying and pasting the text instead.' })
      };
    }

    if (text.length > 15000) text = text.substring(0, 15000) + '\n\n[Content trimmed for length]';

    return { statusCode: 200, headers, body: JSON.stringify({ text }) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Could not fetch that URL. Try copying and pasting the text instead.' })
    };
  }
};
