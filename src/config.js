import 'dotenv/config';
import path from 'node:path';
import { isEmail } from './utils.js';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function parsePort(value, fallback = 587) {
  const port = Number(value == null || String(value).trim() === '' ? fallback : value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function parseSnowflakeList(value, name) {
  const values = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!values.length) throw new Error('Set ' + name + ' to at least one Discord ID.');
  if (values.some((item) => !/^\d{17,20}$/.test(item))) {
    throw new Error(name + ' must contain comma-separated Discord snowflake IDs.');
  }
  return values;
}

export function parseBoolean(value, fallback = false, name = 'boolean setting') {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw new Error(name + ' must be true or false.');
}

export function parseAllowedHosts(value) {
  return new Set(String(value ?? '').split(',').map((item) => {
    const candidate = item.trim().toLowerCase();
    if (!candidate) return '';
    const withScheme = candidate.includes('://') ? candidate : 'https://' + candidate;
    let hostname;
    try {
      const url = new URL(withScheme);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Only bare HTTPS hostnames are allowed.');
      }
      hostname = url.hostname;
    } catch {
      throw new Error('Invalid AUTO_APPLY_ALLOWED_HOSTS entry: ' + candidate);
    }
    if (hostname === 'localhost' || !hostname.includes('.') || hostname.includes('*')) {
      throw new Error('AUTO_APPLY_ALLOWED_HOSTS must contain real hostnames, not wildcards or local addresses.');
    }
    return hostname;
  }).filter(Boolean));
}

export function loadConfig() {
  const root = process.cwd();
  const smtpHost = process.env.SMTP_HOST?.trim() || '';
  const smtpUser = process.env.SMTP_USER?.trim() || '';
  const smtpPass = process.env.SMTP_PASS || '';
  const smtpFrom = process.env.SMTP_FROM?.trim() || smtpUser;
  const smtpValues = [smtpHost, smtpUser, smtpPass, smtpFrom];
  const smtpConfigured = smtpValues.every(Boolean);
  if (smtpValues.some(Boolean) && !smtpConfigured) {
    throw new Error('SMTP is only partially configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM, or leave them all blank.');
  }
  if (smtpConfigured && !isEmail(smtpFrom)) throw new Error('SMTP_FROM must be a valid email address.');

  const ownerIds = parseSnowflakeList(required('DISCORD_OWNER_ID'), 'DISCORD_OWNER_ID');
  if (ownerIds.length !== 1) throw new Error('DISCORD_OWNER_ID must contain exactly one Discord user ID.');
  const guildId = process.env.DISCORD_GUILD_ID?.trim() || '';
  if (guildId && !/^\d{17,20}$/.test(guildId)) throw new Error('DISCORD_GUILD_ID must be a Discord server ID.');

  const maxPerDay = Number(process.env.AUTO_APPLY_MAX_PER_DAY || 5);
  if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 30) {
    throw new Error('AUTO_APPLY_MAX_PER_DAY must be an integer from 1 to 30.');
  }
  const autoApplyEnabled = parseBoolean(process.env.AUTO_APPLY_ENABLED, false, 'AUTO_APPLY_ENABLED');
  const allowedHosts = parseAllowedHosts(process.env.AUTO_APPLY_ALLOWED_HOSTS);
  const allowedEmailDomains = parseAllowedHosts(process.env.AUTO_APPLY_ALLOWED_EMAIL_DOMAINS);
  if (autoApplyEnabled && allowedHosts.size === 0 && (!smtpConfigured || allowedEmailDomains.size === 0)) {
    throw new Error('Autopilot needs an allowed web host or both SMTP settings and allowed email domains.');
  }

  return {
    discordToken: required('DISCORD_TOKEN'),
    discordClientId: required('DISCORD_CLIENT_ID'),
    discordOwnerId: ownerIds[0],
    discordGuildId: guildId,
    allowedChannelIds: new Set(parseSnowflakeList(process.env.DISCORD_JOB_CHANNEL_IDS, 'DISCORD_JOB_CHANNEL_IDS')),
    openAiApiKey: required('OPENAI_API_KEY'),
    openAiModel: required('OPENAI_MODEL'),
    baseCvFile: path.resolve(root, process.env.BASE_CV_FILE || './private/base-cv.md'),
    profileFile: path.resolve(root, process.env.PROFILE_FILE || './private/profile.md'),
    applicationProfileFile: path.resolve(root, process.env.APPLICATION_PROFILE_FILE || './private/application-profile.json'),
    browserProfileDir: path.resolve(root, process.env.BROWSER_PROFILE_DIR || './private/browser-profile'),
    dataFile: path.resolve(root, './data/jobs.json'),
    generatedDir: path.resolve(root, './data/generated'),
    autoApply: {
      enabled: autoApplyEnabled,
      allowedHosts,
      allowedEmailDomains,
      headless: parseBoolean(process.env.AUTO_APPLY_HEADLESS, true, 'AUTO_APPLY_HEADLESS'),
      maxPerDay,
    },
    smtp: {
      configured: smtpConfigured,
      host: smtpHost,
      port: parsePort(process.env.SMTP_PORT),
      secure: parseBoolean(process.env.SMTP_SECURE, false, 'SMTP_SECURE'),
      user: smtpUser,
      pass: smtpPass,
      from: smtpFrom,
    },
  };
}
