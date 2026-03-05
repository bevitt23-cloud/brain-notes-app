exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const body = JSON.parse(event.body);

    // Cap max_tokens to keep response within Netlify's 26s limit
    if (body.max_tokens > 4000) body.max_tokens = 4000;

    // Use AbortController to timeout before Netlify kills us
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 24000);

    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return { statusCode: 504, headers, body: JSON.stringify({ error: 'The request took too long. Try using a shorter piece of text or a smaller PDF section.' }) };
      }
      throw fetchErr;
    }

    clearTimeout(timeout);

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch(e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Unexpected response from AI. Please try again.' }) };
    }

    return { statusCode: response.status, headers, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Something went wrong. Please try again.' }) };
  }
};
