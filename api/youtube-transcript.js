import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.GEMINI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { url } = body;

    if (!url) return res.status(400).json({ error: 'No URL provided' });

    const videoId = extractYouTubeId(url);
    if (!videoId) return res.status(400).json({ error: 'Could not find a YouTube video ID in that URL.' });

    // Gemini natively supports YouTube URLs — no transcript fetching needed
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    try {
      const result = await model.generateContent({
        contents: [{
          role: "user",
          parts: [
            {
              // Pass the YouTube URL directly — Gemini reads the video natively
              fileData: {
                mimeType: "video/youtube",
                fileUri: `https://www.youtube.com/watch?v=${videoId}`
              }
            },
            {
              text: "Please transcribe the full spoken content of this video as plain text. Include all spoken words in order. Do not add any commentary, summaries, or formatting — just the raw transcript text."
            }
          ]
        }],
        generationConfig: {
          maxOutputTokens: 8000,
          temperature: 0.1,
        }
      });

      clearTimeout(timeout);

      const transcript = result.response.text();

      // Also try to get the video title via oEmbed (free, no API key)
      let videoTitle = 'YouTube Video';
      try {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        if (oembedRes.ok) {
          const oembedData = await oembedRes.json();
          if (oembedData.title) videoTitle = oembedData.title;
        }
      } catch (e) { /* title is optional */ }

      return res.status(200).json({ transcript, title: videoTitle, videoId });

    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'The video took too long to process. Try a shorter video or paste the transcript manually.' });
      }
      throw err;
    }

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Something went wrong processing the video.' });
  }
}

function extractYouTubeId(url) {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
