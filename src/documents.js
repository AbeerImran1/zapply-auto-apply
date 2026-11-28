import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { safeFilePart } from './utils.js';

function renderPdf({ filePath, title, content }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 55, left: 58, right: 58 } });
    const stream = createWriteStream(filePath);
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
    pdf.on('error', reject);
    pdf.pipe(stream);
    pdf.fillColor('#1f2937').font('Helvetica-Bold').fontSize(18).text(title, { lineGap: 4 });
    pdf.moveDown(1.2);

    for (const rawLine of String(content).replace(/\r/g, '').split('\n')) {
      const line = rawLine.trim();
      if (!line) { pdf.moveDown(0.45); continue; }
      const heading = /^#{1,3}\s+/.test(line);
      const cleanLine = line.replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+/, '• ');
      pdf.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(heading ? 12 : 10.2);
      pdf.fillColor('#1f2937').text(cleanLine, { lineGap: 3, paragraphGap: heading ? 3 : 1 });
    }
    pdf.end();
  });
}

export async function createPdfFiles({ generatedDir, job, pack }) {
  await mkdir(generatedDir, { recursive: true });
  const prefix = \`\${safeFilePart(job.company)}-\${safeFilePart(job.role)}-\${job.id}\`;
  const cvPath = path.join(generatedDir, \`\${prefix}-cv.pdf\`);
  const coverPath = path.join(generatedDir, \`\${prefix}-cover-letter.pdf\`);
  await renderPdf({ filePath: cvPath, title: \`CV — \${job.role} at \${job.company}\`, content: pack.tailoredCv });
  await renderPdf({ filePath: coverPath, title: \`Cover Letter — \${job.role} at \${job.company}\`, content: pack.coverLetter });
  return { cvPath, coverPath };
}
