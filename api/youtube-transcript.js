import { YoutubeTranscript } from 'youtube-transcript';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { url } = body;

    if (!url) return res.status(400).json({ error: 'No URL provided' });

    // Extract video ID from any YouTube URL format
    const videoId = extractYouTubeId(url);
    if (!videoId) return res.status(400).json({ error: 'Could not find a YouTube video ID in that URL.' });

    // Fetch transcript using the youtube-transcript package
    // It handles YouTube's bot detection automatically
    let transcriptData;
    try {
      transcriptData = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    } catch (e) {
      // If English not found, try without language preference (takes whatever's available)
      try {
        transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
      } catch (e2) {
        return res.status(422).json({
          error: 'No transcript available for this video. The creator may have captions turned off, or this video may be too new.'
        });
      }
    }

    if (!transcriptData || transcriptData.length === 0) {
      return res.status(422).json({ error: 'Transcript was empty for this video.' });
    }

    // Join all transcript chunks into plain text
    const transcript = transcriptData
      .map(item => item.text.replace(/\n/g, ' ').trim())
      .filter(Boolean)
      .join(' ');

    // Try to get video title from YouTube oEmbed (no API key needed)
    let videoTitle = 'YouTube Video';
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        if (oembedData.title) videoTitle = oembedData.title;
      }
    } catch (e) {
      // Title is optional, don't fail if we can't get it
    }

    return res.status(200).json({
      transcript,
      title: videoTitle,
      videoId,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Something went wrong fetching the transcript.' });
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
