exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { url } = JSON.parse(event.body);
    if (!url) return { statusCode: 400, body: JSON.stringify({ error: 'No URL provided' }) };

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BrainNotes/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain'
      }
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Could not fetch page: ${response.statusText}` })
      };
    }

    const contentType = response.headers.get('content-type') || '';
    const html = await response.text();

    // Strip HTML tags and extract readable text
    let text = html
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

    if (text.length < 100) {
      return {
        statusCode: 422,
        body: JSON.stringify({ error: 'Could not extract enough text from that page. Try copying and pasting the text instead.' })
      };
    }

    // Limit to 15000 chars to avoid overwhelming the AI
    if (text.length > 15000) text = text.substring(0, 15000) + '\n\n[Content trimmed for length]';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not reach that URL. The site may be blocking outside access. Try copying and pasting the text instead.' })
    };
  }
};
