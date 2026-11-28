import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeDiscordText, extractEmails, extractUrls, isEmail, isHttpUrl,
  normaliseParsedJob, safeFilePart,
} from '../src/utils.js';

test('extractUrls returns unique HTTP(S) links and removes trailing punctuation', () => {
  assert.deepEqual(
    extractUrls('Apply: https://jobs.example/role. Also https://jobs.example/role.'),
    ['https://jobs.example/role'],
  );
});

test('extractEmails returns unique lower-case email addresses', () => {
  assert.deepEqual(extractEmails('Contact HR@Example.com or hr@example.com'), ['hr@example.com']);
});

test('URL validation rejects non-web protocols and credential URLs', () => {
  assert.equal(isHttpUrl('https://example.com/job'), true);
  assert.equal(isHttpUrl('http://example.com/job'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('https://user:pass@example.com/job'), false);
  assert.equal(isHttpUrl('not a URL'), false);
});

test('email validation rejects malformed addresses', () => {
  assert.equal(isEmail('recruitment@example.com'), true);
  assert.equal(isEmail('not-an-email'), false);
  assert.equal(isEmail('hello@localhost'), false);
});

test('file names are made safe for local paths', () => {
  assert.equal(safeFilePart('../Graduate Role!'), 'Graduate-Role');
  assert.equal(safeFilePart('...'), 'application');
});

test('AI cannot invent application URLs or email recipients absent from the post', () => {
  const parsed = normaliseParsedJob({
    is_job_post: true, company: 'Example Ltd', role: 'IT Support Assistant',
    application_url: 'https://attacker.example/collect-cv',
    application_email: 'attacker@example.net', confidence: 1.4,
  }, 'We are hiring an IT Support Assistant. Apply at https://jobs.example/it-support or email jobs@example.co.uk');
  assert.equal(parsed.applicationUrl, '');
  assert.equal(parsed.applicationEmail, '');
  assert.equal(parsed.confidence, 1);
  assert.equal(parsed.role, 'IT Support Assistant');
});

test('AI cannot choose or guess an application contact absent from its explicit extraction', () => {
  const parsed = normaliseParsedJob({
    is_job_post: true, company: 'Example Ltd', role: 'Junior Developer',
    application_url: 'https://not-in-post.example/apply', application_email: '',
  }, 'We are hiring. Company website: https://example.com and contact press@example.com');
  assert.equal(parsed.applicationUrl, '');
  assert.equal(parsed.applicationEmail, '');
});

test('AI-selected application URL and email must exactly match values in the source post', () => {
  const parsed = normaliseParsedJob({
    is_job_post: true, company: 'Example Ltd', role: 'Junior Developer',
    application_url: 'https://example.com/apply', application_email: 'JOBS@EXAMPLE.COM',
  }, 'Apply at https://example.com/apply or email jobs@example.com. For press contact press@example.com.');
  assert.equal(parsed.applicationUrl, 'https://example.com/apply');
  assert.equal(parsed.applicationEmail, 'jobs@example.com');
});

test('Discord text escaping suppresses markdown and mentions', () => {
  const escaped = escapeDiscordText('@everyone **hello** [link](https://example.com)');
  assert.match(escaped, /@\u200beveryone/);
  assert.match(escaped, /\\\*/);
  assert.match(escaped, /\\\[/);
});
