import { randomBytes } from 'node:crypto';

export function makeJobId() {
  return randomBytes(4).toString('hex');
}

export function extractUrls(text) {
  const matches = String(text ?? '').match(/https?:\/\/[^\s<>]+/gi) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[),.!?]+$/, '')))];
}

export function extractEmails(text) {
  const matches = String(text ?? '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

export function isHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function safeFilePart(value) {
  return String(value ?? 'application')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'application';
}

export function trimText(value, maxLength = 12000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

/** Accept application contacts only when AI explicitly selects a value in the source post. */
export function normaliseParsedJob(result, messageText) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('The AI returned an invalid job record.');
  }
  const urls = extractUrls(messageText).filter(isHttpUrl);
  const emails = extractEmails(messageText).filter(isEmail);
  const proposedUrl = isHttpUrl(result.application_url) ? result.application_url : '';
  const proposedEmail = isEmail(result.application_email) ? result.application_email.toLowerCase() : '';
  const confidenceValue = Number(result.confidence);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.max(0, Math.min(1, confidenceValue)) : 0;

  return {
    isJobPost: result.is_job_post === true,
    company: trimText(result.company, 160),
    role: trimText(result.role, 160),
    location: trimText(result.location, 160),
    employmentType: trimText(result.employment_type, 100),
    description: trimText(result.description || messageText, 12000),
    // Never guess the first URL/email if the model did not identify the application contact.
    applicationUrl: urls.includes(proposedUrl) ? proposedUrl : '',
    applicationEmail: emails.includes(proposedEmail) ? proposedEmail : '',
    deadline: trimText(result.deadline, 100),
    confidence,
  };
}

export function escapeDiscordText(value, maxLength = 700) {
  return trimText(value || 'Not provided', maxLength)
    .replace(/[\\\`*_{}\[\]()<>|~]/g, '\\$&')
    .replace(/@/g, '@\u200b');
}
