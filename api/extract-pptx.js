import AdmZip from 'adm-zip';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // Read raw body as buffer
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    // Find all slide XML files in order
    const slideEntries = zipEntries
      .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/))
      .sort((a, b) => {
        const na = parseInt(a.entryName.match(/slide(\d+)/)[1]);
        const nb = parseInt(b.entryName.match(/slide(\d+)/)[1]);
        return na - nb;
      });

    if (slideEntries.length === 0) {
      return res.status(422).json({ error: 'No slides found in this PowerPoint file.' });
    }

    const slides = [];

    for (const slideEntry of slideEntries) {
      const slideNum = parseInt(slideEntry.entryName.match(/slide(\d+)/)[1]);
      const slideXml = slideEntry.getData().toString('utf8');

      // Extract all text from the slide XML (grab <a:t> tags)
      const textMatches = slideXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g);
      const textParts = [];
      for (const match of textMatches) {
        const t = match[1].trim();
        if (t) textParts.push(t);
      }
      const slideText = textParts.join(' ');

      // Find images on this slide via its relationship file
      const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
      const relsEntry = zip.getEntry(relsPath);
      const slideImages = [];

      if (relsEntry) {
        const relsXml = relsEntry.getData().toString('utf8');
        // Find all image relationships
        const imgMatches = relsXml.matchAll(/Type="[^"]*image[^"]*"[^/]*Target="([^"]+)"/g);
        for (const match of imgMatches) {
          let imgPath = match[1];
          // Resolve relative path from slides/ folder
          if (imgPath.startsWith('../')) {
            imgPath = 'ppt/' + imgPath.replace('../', '');
          }
          const imgEntry = zip.getEntry(imgPath);
          if (imgEntry) {
            const ext = imgPath.split('.').pop().toLowerCase();
            const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', emf: null, wmf: null };
            const mime = mimeMap[ext];
            if (mime) { // skip emf/wmf (Windows-only vector formats)
              const b64 = imgEntry.getData().toString('base64');
              slideImages.push({ mime, data: b64 });
            }
          }
        }
      }

      slides.push({
        slideNumber: slideNum,
        text: slideText,
        images: slideImages,
      });
    }

    return res.status(200).json({
      slides,
      slideCount: slides.length,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not read that PowerPoint file.' });
  }
}
