// api/extract-pdf-text.js
// Handles large PDF uploads that exceed the 4.5MB Anthropic API limit.
// Uses pdf-parse to extract raw text server-side, then returns it as plain text
// so the frontend can send just the text to Claude — no size issues.

const pdfParse = require('pdf-parse');

export const config = {
  api: {
    bodyParser: false, // We need raw binary for file uploads
  },
};

// Parse multipart form data manually (Vercel doesn't include multer)
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) return reject(new Error('No boundary found in multipart form'));

      const boundary = '--' + boundaryMatch[1];
      const parts = body.toString('binary').split(boundary);

      for (const part of parts) {
        if (part.includes('filename=') && part.includes('Content-Type')) {
          // Find where the file data starts (after double CRLF)
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const fileDataStr = part.slice(headerEnd + 4, part.endsWith('\r\n') ? -2 : undefined);
          const fileBuffer = Buffer.from(fileDataStr, 'binary');
          return resolve(fileBuffer);
        }
      }
      reject(new Error('No file found in upload'));
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Parse the uploaded PDF file from the form
    const fileBuffer = await parseMultipart(req);

    if (!fileBuffer || fileBuffer.length < 100) {
      return res.status(400).json({ error: 'Could not read the uploaded file. Please try again.' });
    }

    const sizeMB = Math.round(fileBuffer.length / 1024 / 1024 * 10) / 10;

    // Extract text using pdf-parse
    let parsed;
    try {
      parsed = await pdfParse(fileBuffer, {
        // Limit to 150 pages max to avoid timeouts on massive files
        max: 150,
      });
    } catch (e) {
      return res.status(422).json({
        error: 'Could not extract text from this PDF. It may be a scanned image PDF (no selectable text). Try copying and pasting the text manually instead.'
      });
    }

    let text = parsed.text || '';
    const pageCount = parsed.numpages || 0;

    // Clean up the extracted text
    text = text
      .replace(/\f/g, '\n\n') // form feeds → paragraph breaks
      .replace(/[ \t]{3,}/g, ' ') // collapse excessive spaces
      .replace(/\n{4,}/g, '\n\n\n') // max 3 consecutive newlines
      .trim();

    if (text.length < 50) {
      return res.status(422).json({
        error: 'This PDF appears to contain mostly images or scanned pages rather than text. Try copying and pasting the text instead.'
      });
    }

    // Cap at ~60,000 characters to stay within Claude's context window comfortably
    let trimmed = false;
    if (text.length > 60000) {
      text = text.substring(0, 60000);
      trimmed = true;
    }

    return res.status(200).json({
      text,
      pageCount,
      sizeMB,
      trimmed,
      charCount: text.length,
    });

  } catch (err) {
    console.error('extract-pdf-text error:', err);
    return res.status(500).json({
      error: err.message || 'Something went wrong reading the PDF. Try copying and pasting the text instead.'
    });
  }
}
