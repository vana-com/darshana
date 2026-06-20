import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const HEADER_HEIGHT = 28;
const HEADER_BG = rgb(0, 0, 0);
const HEADER_BG_AUTH = rgb(0.25, 0.25, 0.35);
const HEADER_FG = rgb(1, 1, 1);
const FONT_SIZE = 11;

export async function assemblePdf(pages, config, outputDir) {
  const masterDoc = await PDFDocument.create();
  const font = await masterDoc.embedFont(StandardFonts.Helvetica);
  const date = new Date().toISOString().slice(0, 10);

  // Cover page — sized to first capture's dimensions, or 1440×900 fallback
  let coverWidth = 1440, coverHeight = 900;
  if (pages.length > 0) {
    try {
      const firstImg = await masterDoc.embedPng(pages[0].imageBuffer);
      const dims = firstImg.scale(1);
      coverWidth = dims.width;
      coverHeight = dims.height;
    } catch (_) {}
  }

  const coverPage = masterDoc.addPage([coverWidth, coverHeight + HEADER_HEIGHT]);
  coverPage.drawRectangle({ x: 0, y: 0, width: coverWidth, height: coverHeight + HEADER_HEIGHT, color: rgb(0.05, 0.05, 0.05) });
  coverPage.drawText(config.title ?? 'Design Review', {
    x: 60, y: coverHeight / 2 + 60, font, size: 36, color: rgb(1, 1, 1),
  });
  coverPage.drawText(config.url, {
    x: 60, y: coverHeight / 2 + 10, font, size: 16, color: rgb(0.7, 0.7, 0.7),
  });
  coverPage.drawText(`${date}  ·  ${pages.length} pages`, {
    x: 60, y: coverHeight / 2 - 30, font, size: 14, color: rgb(0.5, 0.5, 0.5),
  });

  // Embed each screenshot
  for (const capture of pages) {
    console.log(`  [pdf] embedding: ${capture.label}`);
    try {
      const img = await masterDoc.embedPng(capture.imageBuffer);
      const { width: imgWidth, height: imgHeight } = img.scale(1);
      const pgWidth = imgWidth;
      const pgHeight = imgHeight + HEADER_HEIGHT;
      const page = masterDoc.addPage([pgWidth, pgHeight]);

      // Draw screenshot filling below the header
      page.drawImage(img, { x: 0, y: 0, width: pgWidth, height: imgHeight });

      // Header bar at top (y=0 is bottom in pdf-lib, so header sits at y=imgHeight)
      const headerColor = capture.section === 'auth' ? HEADER_BG_AUTH : HEADER_BG;
      page.drawRectangle({
        x: 0, y: imgHeight, width: pgWidth, height: HEADER_HEIGHT, color: headerColor,
      });
      page.drawText(capture.label, {
        x: 8, y: imgHeight + 8, font, size: FONT_SIZE, color: HEADER_FG, maxWidth: pgWidth - 16,
      });
    } catch (err) {
      console.warn(`  [pdf] WARNING: failed to embed ${capture.label}: ${err.message}`);
    }
  }

  const outputPath = path.join(outputDir, 'console-review.pdf');
  const pdfBytes = await masterDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);

  const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
  console.log(`\n[pdf] Wrote ${masterDoc.getPageCount()} pages (${sizeMB} MB) → ${outputPath}`);
}
