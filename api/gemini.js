import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // REQUIRED for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.GEMINI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    const body = req.body;
    // Use the correct model name to avoid the 404 error
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite", 
      systemInstruction: body.system
    });

    // Convert your message format to Gemini's format
    const prompt = body.messages[0].content;

    // Use generateContentStream instead of generateContent
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      // Format the data exactly how readSSEStream expects it
      res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}
