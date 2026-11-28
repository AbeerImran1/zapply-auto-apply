import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addJob, getJob, listJobs, recoverInterruptedPreparations, updateJob, updateJobIf } from '../src/storage.js';

async function withStore(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zapply-test-'));
  const filePath = path.join(directory, 'jobs.json');
  try { await callback(filePath); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('job store adds, retrieves, updates, and de-duplicates jobs', async () => {
  await withStore(async (filePath) => {
    assert.deepEqual(await listJobs(filePath), []);
    const input = {
      company: 'Example Ltd', role: 'Junior Developer',
      applicationUrl: 'https://example.com/jobs/1', sourceMessageId: 'discord-message-1',
    };
    const first = await addJob(filePath, input);
    assert.equal(first.added, true);
    assert.match(first.job.id, /^[a-f0-9]{8}$/);
    const duplicate = await addJob(filePath, input);
    assert.equal(duplicate.added, false);
    assert.equal(duplicate.job.id, first.job.id);
    await updateJob(filePath, first.job.id, { ...first.job, approved: true });
    const found = await getJob(filePath, first.job.id);
    assert.equal(found.approved, true);
    assert.equal((await listJobs(filePath)).length, 1);
  });
});

test('job store does not let incoming job data override control fields', async () => {
  await withStore(async (filePath) => {
    const result = await addJob(filePath, {
      id: 'spoofed', approved: true, deliveryState: 'sent', status: 'sent',
      company: 'Example Ltd', role: 'Support Analyst',
    });
    assert.notEqual(result.job.id, 'spoofed');
    assert.equal(result.job.approved, false);
    assert.equal(result.job.deliveryState, 'not_sent');
    assert.equal(result.job.status, 'new');
  });
});

test('atomic conditional update prevents two simultaneous send claims', async () => {
  await withStore(async (filePath) => {
    const { job } = await addJob(filePath, { company: 'Example Ltd', role: 'Developer' });
    const claim = () => updateJobIf(filePath, job.id,
      (current) => current.deliveryState === 'not_sent',
      (current) => ({ ...current, deliveryState: 'sending', status: 'sending' }));
    const results = await Promise.all([claim(), claim()]);
    assert.equal(results.filter((result) => result.updated).length, 1);
    assert.equal((await getJob(filePath, job.id)).deliveryState, 'sending');
  });
});

test('startup recovery resets interrupted preparation and keeps uncertain sends locked', async () => {
  await withStore(async (filePath) => {
    const first = await addJob(filePath, { company: 'Example Ltd', role: 'Developer' });
    const second = await addJob(filePath, { company: 'Example Ltd', role: 'Support Analyst' });
    await updateJob(filePath, first.job.id, { ...first.job, status: 'preparing' });
    await updateJob(filePath, second.job.id, {
      ...second.job, status: 'sending', approved: true, deliveryState: 'sending',
    });
    assert.equal(await recoverInterruptedPreparations(filePath), 1);
    const recovered = await getJob(filePath, first.job.id);
    const uncertain = await getJob(filePath, second.job.id);
    assert.equal(recovered.status, 'new');
    assert.equal(recovered.approved, false);
    assert.ok(recovered.preparationRecoveredAt);
    assert.equal(uncertain.status, 'sending');
    assert.equal(uncertain.deliveryState, 'sending');
    assert.equal(uncertain.approved, true);
  });
});

test('startup recovery preserves a previous prepared pack after interrupted re-preparation', async () => {
  await withStore(async (filePath) => {
    const { job } = await addJob(filePath, { company: 'Example Ltd', role: 'Developer' });
    await updateJob(filePath, job.id, {
      ...job, status: 'preparing',
      pack: { cvPath: '/tmp/previous-cv.pdf', coverPath: '/tmp/previous-cover.pdf' },
      approved: false,
    });
    assert.equal(await recoverInterruptedPreparations(filePath), 1);
    const recovered = await getJob(filePath, job.id);
    assert.equal(recovered.status, 'prepared');
    assert.equal(recovered.pack.cvPath, '/tmp/previous-cv.pdf');
  });
});
