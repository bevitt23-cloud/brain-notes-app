exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const body = JSON.parse(event.body);
    let finalBody = body;

    // NEW LOGIC: If a URL is provided, read it first!
    if (body.targetUrl) {
      const scrapeResp = await fetch(`https://r.jina.ai/${body.targetUrl}`);
      const scrapedText = await scrapeResp.text();
      
      // Update the message to Claude with the new text
      finalBody = {
        ...body,
        messages: [{
          role: 'user', 
          content: 'Convert this study material into ADHD-friendly notes:\n\n' + scrapedText
        }]
      };
      delete finalBody.targetUrl; // Clean up
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(finalBody)
    });

    const data = await response.json();
    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
