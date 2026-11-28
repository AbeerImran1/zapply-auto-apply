import { readFile } from 'node:fs/promises';
import { createApplicationPack } from './ai.js';
import { createPdfFiles } from './documents.js';
import { sendApplicationEmail, verifySmtp } from './mailer.js';
import { getJob, listJobs, updateJobIf } from './storage.js';
import { emailDomainIsAllowed, hostIsAllowed, submitApplicationWithBrowser } from './web-applier.js';

let queue = Promise.resolve();

export function enqueueAutoApplication(jobId, config, logger = console) {
  const task = queue.then(() => runAutoApplication(jobId, config, logger));
  queue = task.catch((error) => logger.error('Autopilot queue error: ' + error.message));
  return task;
}

export async function loadApplicationProfile(filePath) {
  const profile = JSON.parse(await readFile(filePath, 'utf8'));
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('Application profile must be a JSON object.');
  }
  const personal = profile.personal ?? {};
  if (!personal.firstName || !personal.lastName || !personal.email) {
    throw new Error('Set personal.firstName, personal.lastName, and personal.email in the application profile.');
  }
  if (!Array.isArray(profile.preferences?.keywords) || profile.preferences.keywords.length === 0) {
    throw new Error('Set at least one target keyword in preferences.keywords before enabling autopilot.');
  }
  return profile;
}

export function jobMatchesPreferences(job, preferences = {}) {
  const haystack = [job.role, job.company, job.description, job.location, job.employmentType].join(' ').toLowerCase();
  const excluded = (preferences.excludeKeywords ?? []).map((x) => String(x).toLowerCase()).filter(Boolean);
  if (excluded.some((keyword) => haystack.includes(keyword))) return false;
  const included = (preferences.keywords ?? []).map((x) => String(x).toLowerCase()).filter(Boolean);
  if (included.length && !included.some((keyword) => haystack.includes(keyword))) return false;
  const locations = (preferences.locations ?? []).map((x) => String(x).toLowerCase()).filter(Boolean);
  if (locations.length && !locations.some((location) => String(job.location ?? '').toLowerCase().includes(location))) return false;
  const types = (preferences.employmentTypes ?? []).map((x) => String(x).toLowerCase()).filter(Boolean);
  if (types.length && !types.some((type) => String(job.employmentType ?? '').toLowerCase().includes(type))) return false;
  return true;
}

async function withinDailyLimit(config) {
  const jobs = await listJobs(config.dataFile);
  const today = new Date().toISOString().slice(0, 10);
  const completed = jobs.filter((job) => {
    const timestamp = job.webSubmittedAt || job.sentAt
      || (job.deliveryState === 'sending' ? job.sendStartedAt : '')
      || (['web_sending', 'web_unknown'].includes(job.deliveryState) ? job.webStartedAt : '');
    return timestamp && timestamp.slice(0, 10) === today;
  }).length;
  return completed < config.autoApply.maxPerDay;
}

async function prepare(job, config) {
  const claim = await updateJobIf(
    config.dataFile, job.id,
    (current) => current.status === 'new' && current.deliveryState === 'not_sent',
    (current) => ({ ...current, status: 'preparing', autopilot: true, preparationStartedAt: new Date().toISOString(), approved: false }),
  );
  if (!claim.updated) return null;

  try {
    const [baseCv, candidateProfile] = await Promise.all([
      readFile(config.baseCvFile, 'utf8'), readFile(config.profileFile, 'utf8'),
    ]);
    if (!baseCv.trim() || !candidateProfile.trim()) throw new Error('Base CV or profile is empty.');
    const pack = await createApplicationPack({ job, baseCv, profile: candidateProfile });
    const files = await createPdfFiles({ generatedDir: config.generatedDir, job, pack });
    const saved = await updateJobIf(
      config.dataFile, job.id,
      (current) => current.status === 'preparing' && current.deliveryState === 'not_sent',
      (current) => ({ ...current, status: 'prepared', autopilot: true, pack: { ...pack, ...files }, approved: false }),
    );
    return saved.updated ? saved.job : null;
  } catch (error) {
    await updateJobIf(config.dataFile, job.id,
      (current) => current.status === 'preparing',
      (current) => ({ ...current, status: 'failed_preparation', lastError: error.message }));
    throw error;
  }
}

export async function runAutoApplication(jobId, config, logger = console) {
  if (!config.autoApply.enabled) return { outcome: 'disabled' };
  let job = await getJob(config.dataFile, jobId);
  if (!job || job.deliveryState !== 'not_sent') return { outcome: 'not_eligible' };
  if (!['new', 'prepared'].includes(job.status)) return { outcome: 'not_eligible' };

  let profile;
  try { profile = await loadApplicationProfile(config.applicationProfileFile); }
  catch (error) {
    logger.error('Auto-apply profile could not be loaded: ' + error.message);
    return { outcome: 'profile_error', reason: error.message };
  }
  if (job.status === 'new' && !jobMatchesPreferences(job, profile.preferences ?? {})) {
    await updateJobIf(config.dataFile, jobId,
      (current) => current.status === 'new',
      (current) => ({ ...current, status: 'filtered_out', filteredAt: new Date().toISOString() }));
    return { outcome: 'filtered' };
  }
  if (!(await withinDailyLimit(config))) {
    logger.warn('Auto-apply daily limit reached. Job ' + jobId + ' remains queued.');
    return { outcome: 'daily_limit' };
  }

  if (job.status === 'new') {
    job = await prepare(job, config);
    if (!job) return { outcome: 'not_eligible' };
  } else if (!job.autopilot || !job.pack?.cvPath || !job.pack?.coverPath) {
    return { outcome: 'not_eligible' };
  }

  if (job.applicationEmail && config.smtp.configured
      && emailDomainIsAllowed(job.applicationEmail, config.autoApply.allowedEmailDomains)) {
    try { await verifySmtp(config.smtp); }
    catch (error) {
      await updateJobIf(config.dataFile, jobId,
        (current) => current.status === 'prepared',
        (current) => ({ ...current, status: 'prepared', lastError: 'SMTP verification failed: ' + error.message }));
      return { outcome: 'needs_configuration', reason: error.message };
    }
    const claim = await updateJobIf(config.dataFile, jobId,
      (current) => current.status === 'prepared' && current.deliveryState === 'not_sent',
      (current) => ({ ...current, status: 'sending', deliveryState: 'sending', sendStartedAt: new Date().toISOString() }));
    if (!claim.updated) return { outcome: 'not_eligible' };
    try {
      const sent = await sendApplicationEmail({
        smtp: config.smtp, to: claim.job.applicationEmail,
        subject: claim.job.pack.emailSubject, text: claim.job.pack.emailBody,
        attachments: [claim.job.pack.cvPath, claim.job.pack.coverPath],
      });
      await updateJobIf(config.dataFile, jobId,
        (current) => current.deliveryState === 'sending',
        (current) => ({ ...current, status: 'sent', deliveryState: 'sent', sentAt: new Date().toISOString(), messageId: sent.messageId || '' }));
      logger.info('Automatically emailed application for ' + jobId + ' to ' + claim.job.applicationEmail);
      return { outcome: 'sent' };
    } catch (error) {
      logger.error('Email delivery uncertain for ' + jobId + ': ' + error.message);
      return { outcome: 'unknown', reason: error.message };
    }
  }

  if (job.applicationUrl && hostIsAllowed(job.applicationUrl, config.autoApply.allowedHosts)) {
    const claim = await updateJobIf(config.dataFile, jobId,
      (current) => current.status === 'prepared' && current.deliveryState === 'not_sent',
      (current) => ({ ...current, status: 'web_applying', deliveryState: 'web_sending', webStartedAt: new Date().toISOString() }));
    if (!claim.updated) return { outcome: 'not_eligible' };
    const result = await submitApplicationWithBrowser({ job: claim.job, profile, pack: claim.job.pack, config });
    if (result.outcome === 'submitted') {
      await updateJobIf(config.dataFile, jobId,
        (current) => current.deliveryState === 'web_sending',
        (current) => ({ ...current, status: 'web_submitted', deliveryState: 'web_submitted', webSubmittedAt: new Date().toISOString(), webConfirmation: result.confirmation || '' }));
      logger.info('Automatically submitted web application ' + jobId);
      return { outcome: 'submitted' };
    }
    if (result.outcome === 'unknown') {
      await updateJobIf(config.dataFile, jobId,
        (current) => current.deliveryState === 'web_sending',
        (current) => ({ ...current, status: 'submission_unknown', deliveryState: 'web_unknown', lastError: result.reason }));
      return result;
    }
    await updateJobIf(config.dataFile, jobId,
      (current) => current.deliveryState === 'web_sending',
      (current) => ({ ...current, status: 'needs_manual', deliveryState: 'not_sent', lastError: result.reason }));
    logger.warn('Skipped web application ' + jobId + ': ' + result.reason);
    return result;
  }

  await updateJobIf(config.dataFile, jobId,
    (current) => current.status === 'prepared',
    (current) => ({ ...current, status: 'needs_manual', lastError: 'No allowed application route was available.' }));
  return { outcome: 'needs_manual' };
}
