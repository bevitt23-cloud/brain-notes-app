import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.GEMINI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

  try {
    // Read the raw multipart body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // Parse multipart form data manually to get the file
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) return res.status(400).json({ error: 'Invalid multipart request' });

    const boundary = boundaryMatch[1];
    const { fileBuffer, mimeType, fileName } = parseMultipart(buffer, boundary);

    if (!fileBuffer) return res.status(400).json({ error: 'No video file found in request' });

    const fileSizeMB = Math.round(fileBuffer.length / 1024 / 1024 * 10) / 10;

    // Use Gemini File API to upload the video (handles files of any size)
    const fileManager = new GoogleAIFileManager(apiKey);

    // Write buffer to a temp-like approach using base64 inline for small files,
    // or upload via File API for larger ones
    let transcript;

    if (fileBuffer.length < 15 * 1024 * 1024) {
      // Under 15MB — send inline as base64 directly to generateContent
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });

      const result = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType || 'video/mp4',
                data: fileBuffer.toString('base64'),
              }
            },
            {
              text: 'Please transcribe all the spoken words in this video as plain text. Include everything said, in order. No formatting, no summaries, no commentary — just the raw transcript of what was spoken.'
            }
          ]
        }],
        generationConfig: { maxOutputTokens: 8000, temperature: 0.1 }
      });

      transcript = result.response.text();

    } else {
      // Over 15MB — upload via Gemini File API first
      // We need to write to /tmp since Vercel serverless has /tmp access
      const fs = await import('fs');
      const path = await import('path');
      const tmpPath = path.join('/tmp', `video_${Date.now()}.${getExt(fileName, mimeType)}`);

      fs.writeFileSync(tmpPath, fileBuffer);

      try {
        const uploadResult = await fileManager.uploadFile(tmpPath, {
          mimeType: mimeType || 'video/mp4',
          displayName: fileName || 'uploaded_video',
        });

        // Wait for file to finish processing
        let file = await fileManager.getFile(uploadResult.file.name);
        let attempts = 0;
        while (file.state === 'PROCESSING' && attempts < 30) {
          await new Promise(r => setTimeout(r, 2000));
          file = await fileManager.getFile(uploadResult.file.name);
          attempts++;
        }

        if (file.state !== 'ACTIVE') {
          throw new Error('Video processing timed out. Try a shorter clip.');
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });

        const result = await model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
              { text: 'Please transcribe all the spoken words in this video as plain text. Include everything said, in order. No formatting, no summaries — just the raw spoken transcript.' }
            ]
          }],
          generationConfig: { maxOutputTokens: 8000, temperature: 0.1 }
        });

        transcript = result.response.text();

        // Clean up uploaded file from Gemini
        await fileManager.deleteFile(uploadResult.file.name).catch(() => {});

      } finally {
        // Clean up tmp file
        fs.unlinkSync(tmpPath);
      }
    }

    return res.status(200).json({ transcript, fileSizeMB });

  } catch (err) {
    console.error('Video extraction error:', err);
    return res.status(500).json({ error: err.message || 'Could not process that video file.' });
  }
}

function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary);
  let fileBuffer = null;
  let mimeType = 'video/mp4';
  let fileName = 'video.mp4';

  let pos = 0;
  while (pos < buffer.length) {
    const boundaryIdx = buffer.indexOf(boundaryBuf, pos);
    if (boundaryIdx === -1) break;
    pos = boundaryIdx + boundaryBuf.length + 2; // skip \r\n

    // Read headers
    const headerEnd = buffer.indexOf('\r\n\r\n', pos);
    if (headerEnd === -1) break;
    const headers = buffer.slice(pos, headerEnd).toString();
    pos = headerEnd + 4;

    // Find next boundary
    const nextBoundary = buffer.indexOf(boundaryBuf, pos);
    const dataEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2; // -2 for \r\n

    if (headers.includes('filename=')) {
      fileBuffer = buffer.slice(pos, dataEnd);
      const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
      if (mimeMatch) mimeType = mimeMatch[1].trim();
      const nameMatch = headers.match(/filename="([^"]+)"/);
      if (nameMatch) fileName = nameMatch[1];
      break;
    }
    pos = dataEnd;
  }

  return { fileBuffer, mimeType, fileName };
}

function getExt(fileName, mimeType) {
  if (fileName && fileName.includes('.')) return fileName.split('.').pop();
  const mimeToExt = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-msvideo': 'avi' };
  return mimeToExt[mimeType] || 'mp4';
}
