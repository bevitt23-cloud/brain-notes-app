export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { url } = body;

    if (!url) return res.status(400).json({ error: 'No URL provided' });

    // Extract the YouTube video ID from any YouTube URL format
    const videoId = extractYouTubeId(url);
    if (!videoId) return res.status(400).json({ error: 'Could not find a YouTube video ID in that URL.' });

    // Step 1: Fetch the YouTube page to get the transcript URL
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!pageRes.ok) throw new Error('Could not load the YouTube page.');
    const pageHtml = await pageRes.text();

    // Step 2: Extract the video title
    const titleMatch = pageHtml.match(/"title":"([^"]+)"/);
    const videoTitle = titleMatch ? titleMatch[1].replace(/\\u0026/g, '&').replace(/\\n/g, ' ') : 'YouTube Video';

    // Step 3: Find the captionTracks data inside the page HTML
    const captionMatch = pageHtml.match(/"captionTracks":(\[.*?\])/);
    if (!captionMatch) {
      return res.status(422).json({ 
        error: 'No transcript found for this video. It may not have captions enabled, or captions may be disabled by the creator.' 
      });
    }

    let captionTracks;
    try {
      captionTracks = JSON.parse(captionMatch[1]);
    } catch (e) {
      throw new Error('Could not parse transcript data from YouTube.');
    }

    if (!captionTracks || captionTracks.length === 0) {
      return res.status(422).json({ error: 'This video has no available captions/transcript.' });
    }

    // Step 4: Prefer English captions; fall back to whatever is available
    const englishTrack = captionTracks.find(t => t.languageCode === 'en') ||
                         captionTracks.find(t => t.languageCode?.startsWith('en')) ||
                         captionTracks[0];

    const transcriptUrl = englishTrack.baseUrl;
    if (!transcriptUrl) throw new Error('Could not find transcript URL.');

    // Step 5: Fetch the actual transcript XML
    const transcriptRes = await fetch(transcriptUrl);
    if (!transcriptRes.ok) throw new Error('Could not fetch transcript from YouTube.');
    const transcriptXml = await transcriptRes.text();

    // Step 6: Parse the XML and extract plain text
    // Format: <text start="x.xx" dur="x.xx">content here</text>
    const textParts = [];
    const textMatches = transcriptXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g);
    for (const match of textMatches) {
      let text = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/<[^>]+>/g, '') // strip any nested tags like <font>
        .trim();
      if (text) textParts.push(text);
    }

    if (textParts.length === 0) throw new Error('Transcript was empty after parsing.');

    const transcript = textParts.join(' ');

    return res.status(200).json({
      transcript,
      title: videoTitle,
      videoId,
      wordCount: textParts.length,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Something went wrong fetching the transcript.' });
  }
}

function extractYouTubeId(url) {
  // Handles all YouTube URL formats:
  // https://www.youtube.com/watch?v=XXXXX
  // https://youtu.be/XXXXX
  // https://youtube.com/shorts/XXXXX
  // https://www.youtube.com/embed/XXXXX
  // https://youtu.be/XXXXX?si=...
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
