import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // CORS headers (same as your Claude setup)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // Gemini API key — add GEMINI_KEY to your GitHub Secrets + Vercel Environment Variables
  const apiKey = process.env.GEMINI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      // Pass through the system prompt from the app (ADHD mode, dyslexia mode, etc.)
      systemInstruction: body.system || "You are an ADHD-friendly note reformatter. Use bold headers, bullet points, and high-contrast structure. Return only valid HTML."
    });

    // Handle timeouts (same as your Claude code)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    try {
      // Build parts array — handles plain text AND PDFs/images
      const parts = [];
      for (const msg of body.messages || []) {
        if (typeof msg.content === 'string') {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              parts.push({ text: part.text });
            } else if (part.type === 'document' && part.source?.type === 'base64') {
              // PDF file
              parts.push({
                inlineData: {
                  mimeType: part.source.media_type || 'application/pdf',
                  data: part.source.data,
                }
              });
            } else if (part.type === 'image' && part.source?.type === 'base64') {
              // Image from Word doc or upload
              parts.push({
                inlineData: {
                  mimeType: part.source.media_type || 'image/jpeg',
                  data: part.source.data,
                }
              });
            }
          }
        }
      }

      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: body.max_tokens || 6000,
          temperature: 0.7,
        }
      });

      const responseText = result.response.text();

      // Return in Claude-compatible format so the frontend needs no changes
      const formattedResponse = {
        content: [{ type: 'text', text: responseText }],
        model: "gemini-2.0-flash"
      };

      clearTimeout(timeout);
      return res.status(200).json(formattedResponse);

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
