import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

function normaliseLabel(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function protectedQuestion(label) {
  return /\b(disability|disabled|medical|health|race|ethnic|ethnicity|gender|sexual orientation|religion|belief|veteran|military service|criminal record|conviction|background check consent|date of birth|birth date|age|equal opportunity|diversity|demographic|i certify|i attest|i agree|terms and conditions|electronic signature|signature|consent)\b/i.test(label);
}

function fieldContext(meta) {
  return normaliseLabel([meta.label, meta.ariaLabel, meta.placeholder, meta.name, meta.id, meta.autocomplete].join(' '));
}

export function hostIsAllowed(rawUrl, allowedHosts) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return [...(allowedHosts ?? [])].some((allowed) => {
      const domain = String(allowed).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      return domain && (host === domain || host.endsWith('.' + domain));
    });
  } catch { return false; }
}

export function emailDomainIsAllowed(email, allowedDomains) {
  if (typeof email !== 'string' || !email.includes('@')) return false;
  const domain = email.split('@').at(-1).toLowerCase();
  return [...(allowedDomains ?? [])].some((allowed) => {
    const normal = String(allowed).trim().toLowerCase();
    return normal && (domain === normal || domain.endsWith('.' + normal));
  });
}

export function resolveCandidateValue(meta, profile) {
  const label = fieldContext(meta);
  if (protectedQuestion(label)) return { kind: 'blocked', reason: 'Protected, legal, or consent question.' };

  const personal = profile.personal ?? {};
  const work = profile.workAuthorisation ?? {};
  const answers = profile.answers ?? {};
  const targetLabel = normaliseLabel(meta.label || meta.ariaLabel || meta.name || meta.id);
  const explicitAnswer = Object.entries(answers).find(([key]) => normaliseLabel(key) === targetLabel);
  if (explicitAnswer && String(explicitAnswer[1] ?? '').trim()) {
    return { kind: 'value', value: String(explicitAnswer[1]).trim() };
  }

  const rules = [
    [/\b(first name|given name|forename)\b/i, personal.firstName],
    [/\b(last name|family name|surname)\b/i, personal.lastName],
    [/\b(full name|candidate name|applicant name)\b/i, [personal.firstName, personal.lastName].filter(Boolean).join(' ')],
    [/\b(email|e mail|email address)\b/i, personal.email],
    [/\b(phone|mobile|telephone)\b/i, personal.phone],
    [/\b(linkedin)\b/i, personal.linkedinUrl],
    [/\b(github|git hub)\b/i, personal.githubUrl],
    [/\b(portfolio|personal website|website url)\b/i, personal.portfolioUrl],
    [/\b(city|town|current location|location)\b/i, personal.city],
    [/\b(country|country of residence)\b/i, personal.country],
    [/\b(postcode|postal code|zip code)\b/i, personal.postalCode],
    [/\b(authorized|authorised) to work|right to work|legally eligible to work/i,
      work.authorisedToWork === true ? 'Yes' : work.authorisedToWork === false ? 'No' : undefined],
    [/\b(require|need) (visa )?sponsorship|sponsorship (required|needed)/i,
      work.requiresSponsorship === true ? 'Yes' : work.requiresSponsorship === false ? 'No' : undefined],
    [/\b(resume|curriculum vitae|cv upload)\b/i, '__RESUME_FILE__'],
    [/\b(cover letter|coverletter)\b/i, '__COVER_FILE__'],
  ];
  for (const [pattern, value] of rules) {
    if (pattern.test(label) && value !== undefined && value !== null && String(value).trim()) {
      return value === '__RESUME_FILE__' ? { kind: 'file', key: 'cv' }
        : value === '__COVER_FILE__' ? { kind: 'file', key: 'cover' }
          : { kind: 'value', value: String(value) };
    }
  }
  return { kind: 'unknown', reason: 'No explicitly configured answer matches this field.' };
}

async function inspectField(locator) {
  return locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    type: (element.getAttribute('type') || '').toLowerCase(),
    name: element.getAttribute('name') || '',
    id: element.id || '',
    placeholder: element.getAttribute('placeholder') || '',
    ariaLabel: element.getAttribute('aria-label') || '',
    autocomplete: element.getAttribute('autocomplete') || '',
    required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
    disabled: Boolean(element.disabled),
    checked: Boolean(element.checked),
    label: Array.from(element.labels || []).map((item) => item.innerText).join(' '),
    options: element.tagName === 'SELECT'
      ? Array.from(element.options).map((option) => ({ value: option.value, text: option.textContent?.trim() || '' }))
      : [],
  }));
}

async function isBlockedPage(page) {
  const body = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, 12000);
  return /captcha|recaptcha|hcaptcha|verify you are human|checking your browser|unusual traffic|automated access|access denied|cloudflare ray id|sign in to apply|log in to apply|create an account to apply/i.test(body);
}

async function chooseApplicationForm(page) {
  const forms = page.locator('form');
  const count = await forms.count();
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < count; i += 1) {
    const form = forms.nth(i);
    if (!(await form.isVisible().catch(() => false))) continue;
    const text = (await form.innerText().catch(() => '')).slice(0, 8000);
    const inputs = await form.locator('input,select,textarea').count();
    const score = inputs + (/application|resume|curriculum vitae|apply for|submit application/i.test(text) ? 20 : 0);
    if (inputs > 0 && score > bestScore) { best = form; bestScore = score; }
  }
  return best;
}

function optionMatch(options, wanted) {
  const normalWanted = normaliseLabel(wanted);
  return options.find((option) => normaliseLabel(option.text) === normalWanted)
    ?? options.find((option) => normaliseLabel(option.text).includes(normalWanted) || normalWanted.includes(normaliseLabel(option.text)));
}

export async function submitApplicationWithBrowser({ job, profile, pack, config }) {
  if (!hostIsAllowed(job.applicationUrl, config.autoApply.allowedHosts)) {
    return { outcome: 'skipped', reason: 'The application site is not on the configured allowlist.' };
  }
  if (!profile.personal?.firstName || !profile.personal?.lastName || !profile.personal?.email) {
    return { outcome: 'skipped', reason: 'The application profile needs first name, last name, and email.' };
  }

  await mkdir(config.browserProfileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(config.browserProfileDir, {
    headless: config.autoApply.headless,
    acceptDownloads: false,
    viewport: { width: 1365, height: 900 },
  });
  let submitted = false;
  try {
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(job.applicationUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    if (!hostIsAllowed(page.url(), config.autoApply.allowedHosts)) {
      return { outcome: 'skipped', reason: 'The application link redirected outside the configured allowlist.' };
    }
    if (await isBlockedPage(page)) {
      return { outcome: 'skipped', reason: 'The site requires login, CAPTCHA, bot verification, or blocks automated access.' };
    }

    const form = await chooseApplicationForm(page);
    if (!form) return { outcome: 'skipped', reason: 'No unambiguous application form was found.' };
    const formAction = await form.evaluate((element) => element.action || window.location.href);
    if (!hostIsAllowed(formAction, config.autoApply.allowedHosts)) {
      return { outcome: 'skipped', reason: 'The application form posts to a host outside the configured allowlist.' };
    }

    const fields = form.locator('input,select,textarea');
    const count = await fields.count();
    const unresolved = [];
    for (let i = 0; i < count; i += 1) {
      const field = fields.nth(i);
      if (!(await field.isVisible().catch(() => false))) continue;
      const meta = await inspectField(field);
      if (meta.disabled || ['hidden', 'submit', 'button', 'reset', 'image'].includes(meta.type)) continue;
      if (['checkbox', 'radio'].includes(meta.type)) {
        if (meta.required) unresolved.push(meta.label || meta.name || meta.id || 'Required consent/choice');
        else if (meta.checked) await field.uncheck().catch(() => {});
        continue;
      }
      if (meta.type === 'password') {
        unresolved.push(meta.label || 'Password/login field');
        continue;
      }

      const mapped = resolveCandidateValue(meta, profile);
      if (mapped.kind === 'blocked') {
        if (meta.required) unresolved.push(meta.label || meta.name || 'Required legal or sensitive question');
        continue;
      }
      if (mapped.kind === 'unknown') {
        if (meta.required) unresolved.push(meta.label || meta.name || meta.id || 'Unknown required question');
        continue;
      }
      if (mapped.kind === 'file') {
        const filePath = mapped.key === 'cv' ? pack.cvPath : pack.coverPath;
        if (!filePath) {
          if (meta.required) unresolved.push(meta.label || 'Required file upload');
          continue;
        }
        await field.setInputFiles(filePath);
        continue;
      }

      if (meta.tag === 'select') {
        const match = optionMatch(meta.options, mapped.value);
        if (match) await field.selectOption(match.value);
        else if (meta.required) unresolved.push(meta.label || meta.name || 'Required dropdown');
      } else {
        await field.fill(String(mapped.value));
      }
    }

    if (unresolved.length) {
      return {
        outcome: 'skipped',
        reason: 'The form contains fields that cannot safely be answered from the saved profile: ' + unresolved.slice(0, 6).join(', '),
      };
    }

    const submitCandidates = form.getByRole('button', { name: /^(apply|submit|submit application|send application)$/i });
    const submitCount = await submitCandidates.count();
    if (submitCount !== 1 || !(await submitCandidates.first().isVisible().catch(() => false))) {
      return { outcome: 'skipped', reason: 'No single unambiguous application submit button was found.' };
    }

    await submitCandidates.first().click();
    submitted = true;
    if (!hostIsAllowed(page.url(), config.autoApply.allowedHosts)) {
      return { outcome: 'unknown', reason: 'The site redirected outside the allowlist after submitting. Check the application status before retrying.' };
    }
    const confirmation = page.getByText(/application (has been )?(submitted|received)|thank you for applying|successfully applied|we have received your application/i).first();
    const confirmed = await confirmation.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (confirmed) {
      return { outcome: 'submitted', confirmation: (await confirmation.innerText().catch(() => '')).slice(0, 500) };
    }
    return { outcome: 'unknown', reason: 'Submit was clicked, but the site did not show a clear application confirmation. Do not retry automatically.' };
  } catch (error) {
    return submitted
      ? { outcome: 'unknown', reason: 'The submit action may have reached the site, but confirmation failed: ' + error.message }
      : { outcome: 'skipped', reason: 'Application form could not be completed safely: ' + error.message };
  } finally {
    await context.close().catch(() => {});
  }
}
