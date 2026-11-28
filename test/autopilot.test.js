import test from 'node:test';
import assert from 'node:assert/strict';
import { hostIsAllowed, emailDomainIsAllowed, protectedQuestion, resolveCandidateValue } from '../src/web-applier.js';
import { jobMatchesPreferences } from '../src/autopilot.js';
import { parseAllowedHosts, parseBoolean } from '../src/config.js';

const profile = {
  personal: { firstName: 'Alex', lastName: 'Example', email: 'alex@example.com', city: 'London' },
  workAuthorisation: { authorisedToWork: true, requiresSponsorship: false },
  preferences: { keywords: ['junior developer'], locations: ['London'] },
  answers: { 'Notice period': 'Two weeks' },
};

test('web allowlist accepts HTTPS exact and subdomains only', () => {
  const allow = new Set(['greenhouse.io', 'jobs.example.com']);
  assert.equal(hostIsAllowed('https://boards.greenhouse.io/acme/jobs/1', allow), true);
  assert.equal(hostIsAllowed('https://jobs.example.com/apply', allow), true);
  assert.equal(hostIsAllowed('https://evilgreenhouse.io/apply', allow), false);
  assert.equal(hostIsAllowed('http://greenhouse.io/apply', allow), false);
  assert.equal(hostIsAllowed('https://user:pass@greenhouse.io/apply', allow), false);
  assert.equal(hostIsAllowed('https://unknown.example/apply', allow), false);
});

test('email allowlist only accepts the configured recipient domains', () => {
  const allow = new Set(['example.com', 'recruitment.co.uk']);
  assert.equal(emailDomainIsAllowed('jobs@example.com', allow), true);
  assert.equal(emailDomainIsAllowed('hr@careers.example.com', allow), true);
  assert.equal(emailDomainIsAllowed('jobs@evil-example.com', allow), false);
  assert.equal(emailDomainIsAllowed('not-an-email', allow), false);
});

test('candidate form field mapping uses only explicit profile values', () => {
  assert.deepEqual(resolveCandidateValue({ label: 'First name', name: 'first_name' }, profile), { kind: 'value', value: 'Alex' });
  assert.deepEqual(resolveCandidateValue({ label: 'Last name' }, profile), { kind: 'value', value: 'Example' });
  assert.deepEqual(resolveCandidateValue({ label: 'Email address' }, profile), { kind: 'value', value: 'alex@example.com' });
  assert.deepEqual(resolveCandidateValue({ label: 'Notice period' }, profile), { kind: 'value', value: 'Two weeks' });
  assert.equal(resolveCandidateValue({ label: 'Expected salary' }, profile).kind, 'unknown');
});

test('protected, legal, demographic and consent questions are never autofilled', () => {
  for (const label of ['Disability status', 'Race or ethnicity', 'Date of birth', 'I agree to the terms and conditions', 'Electronic signature']) {
    assert.equal(protectedQuestion(label), true);
    assert.equal(resolveCandidateValue({ label }, profile).kind, 'blocked');
  }
  assert.equal(protectedQuestion('Right to work in the UK'), false);
  assert.equal(resolveCandidateValue({ label: 'Are you authorised to work in the UK?' }, profile).value, 'Yes');
});

test('job preferences include allowed target roles and exclude unwanted posts', () => {
  const job = { role: 'Junior Developer', company: 'Example', location: 'London', employmentType: 'Full-time', description: 'Entry level software engineering role.' };
  assert.equal(jobMatchesPreferences(job, profile.preferences), true);
  assert.equal(jobMatchesPreferences(job, { ...profile.preferences, keywords: ['retail assistant'] }), false);
  assert.equal(jobMatchesPreferences(job, { ...profile.preferences, excludeKeywords: ['software engineering'] }), false);
  assert.equal(jobMatchesPreferences({ ...job, location: 'Manchester' }, profile.preferences), false);
});

test('autopilot config accepts bare HTTPS hostnames and rejects wildcards or paths', () => {
  assert.deepEqual([...parseAllowedHosts('greenhouse.io, jobs.lever.co')], ['greenhouse.io', 'jobs.lever.co']);
  assert.throws(() => parseAllowedHosts('*.example.com'), /AUTO_APPLY_ALLOWED_HOSTS/);
  assert.throws(() => parseAllowedHosts('example.com/apply'), /Invalid AUTO_APPLY_ALLOWED_HOSTS/);
  assert.throws(() => parseAllowedHosts('http://example.com'), /Invalid AUTO_APPLY_ALLOWED_HOSTS/);
});

test('boolean configuration is explicit and validates invalid values', () => {
  assert.equal(parseBoolean(undefined, false), false);
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('0'), false);
  assert.throws(() => parseBoolean('sometimes'), /must be true or false/);
});
