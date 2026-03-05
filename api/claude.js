export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (body.max_tokens > 4000) body.max_tokens = 4000;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

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
        return res.status(504).json({ error: 'The request took too long. Try using a shorter piece of text.' });
      }
      throw fetchErr;
    }

    clearTimeout(timeout);

    const rawText = await response.text();
    let data;
    try { data = JSON.parse(rawText); } catch(e) {
      return res.status(500).json({ error: 'Unexpected response from AI. Please try again.' });
    }

    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Something went wrong. Please try again.' });
  }
}
