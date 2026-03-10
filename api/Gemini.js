import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // 1. Keep your existing CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 2. Change the Key to GEMINI_KEY (Update this in your GitHub Secrets!)
  const apiKey = process.env.GEMINI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    // 3. Initialize the 2026 'Workhorse' model: Gemini 3.1 Flash
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.1-flash",
      // This is where your ADHD instructions go
      systemInstruction: "You are an ADHD-friendly note reformatter. Use bold headers, bullet points, and high-contrast structure."
    });

    // 4. Handle the Timeouts (Same as your Claude code)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    try {
      // Gemini can take a simple string or a complex array (for videos/files)
      // For now, we'll process the text from your 'body'
      const prompt = body.messages.map(m => m.content).join("\n");
      
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4000,
          temperature: 0.7,
        }
      });

      const responseText = result.response.text();

      // 5. Format the response to match what your Frontend expects
      // Your front-end likely looks for 'content[0].text' from the Claude format
      const legacyFormattedData = {
        content: [{ type: 'text', text: responseText }],
        model: "gemini-3.1-flash"
      };

      clearTimeout(timeout);
      return res.status(200).json(legacyFormattedData);

    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'The request took too long. Gemini is processing a lot of data!' });
      }
      throw fetchErr;
    }

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Something went wrong with Gemini. Please try again.' });
  }
}
