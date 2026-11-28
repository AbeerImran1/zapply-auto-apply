import nodemailer from 'nodemailer';
import { isEmail } from './utils.js';

function createTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });
}

export async function verifySmtp(smtp) {
  if (!smtp.configured) throw new Error('SMTP is not configured. Add SMTP settings to your .env file first.');
  const transporter = createTransport(smtp);
  try { await transporter.verify(); }
  finally { transporter.close(); }
}

export async function sendApplicationEmail({ smtp, to, subject, text, attachments }) {
  if (!smtp.configured) throw new Error('SMTP is not configured. Add SMTP settings to your .env file first.');
  if (!isEmail(to)) throw new Error('The job post does not contain a valid application email address.');
  if (!Array.isArray(attachments) || attachments.length !== 2) {
    throw new Error('Exactly two reviewed application PDFs must be attached.');
  }
  const transporter = createTransport(smtp);
  try {
    return await transporter.sendMail({
      from: smtp.from, to,
      subject: String(subject ?? 'Job application').replace(/[\r\n]+/g, ' ').slice(0, 200),
      text: String(text ?? '').slice(0, 6000),
      attachments: attachments.map((filePath) => ({ path: filePath })),
    });
  } finally { transporter.close(); }
}
