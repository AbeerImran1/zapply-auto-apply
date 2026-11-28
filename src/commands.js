import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createApplicationPack } from './ai.js';
import { createPdfFiles } from './documents.js';
import { sendApplicationEmail, verifySmtp } from './mailer.js';
import { getJob, listJobs, updateJobIf } from './storage.js';
import { escapeDiscordText, isHttpUrl } from './utils.js';

export const commandData = [
  new SlashCommandBuilder().setName('queue').setDescription('Show the jobs detected by Zapply.'),
  ...['prepare', 'approve', 'send', 'details'].map((name) =>
    new SlashCommandBuilder()
      .setName(name)
      .setDescription({
        prepare: 'Create a tailored CV and cover-letter PDF for a job.',
        approve: 'Approve a prepared application for sending.',
        send: 'Send an approved application email with its PDFs.',
        details: 'Show the details and application link for a job.',
      }[name])
      .addStringOption((option) => option.setName('id').setDescription('Job ID from /queue').setRequired(true))),
].map((command) => command.toJSON());

const getId = (interaction) => interaction.options.getString('id', true).trim().toLowerCase();
const safeText = (value, max = 700) => escapeDiscordText(value, max);

async function filesExist(...paths) {
  try {
    await Promise.all(paths.map((file) => access(file, constants.R_OK)));
    return true;
  } catch { return false; }
}

export async function handleCommand(interaction, config) {
  if (interaction.user.id !== config.discordOwnerId) {
    await interaction.reply({ content: 'You are not authorised to use this bot.', ephemeral: true });
    return;
  }

  const name = interaction.commandName;
  if (name === 'queue') {
    const jobs = await listJobs(config.dataFile);
    if (!jobs.length) {
      await interaction.reply({ content: 'No jobs detected yet.', ephemeral: true });
      return;
    }
    const lines = jobs.slice(0, 8).map((job) => {
      const state = job.deliveryState === 'sent' ? 'sent'
        : job.deliveryState === 'sending' ? 'send uncertain'
          : job.status === 'preparing' ? 'preparing'
            : job.approved ? 'approved'
              : job.pack ? 'prepared' : 'needs preparation';
      return job.id + ' — **' + safeText(job.role, 80) + '** at '
        + safeText(job.company, 80) + ' · ' + state;
    });
    await interaction.reply({ content: '**Latest jobs**\n' + lines.join('\n'), ephemeral: true });
    return;
  }

  if (!['prepare', 'approve', 'send', 'details'].includes(name)) return;
  const id = getId(interaction);
  const job = await getJob(config.dataFile, id);
  if (!job) {
    await interaction.reply({ content: "I couldn't find job " + id + ". Run /queue to see valid IDs.", ephemeral: true });
    return;
  }

  if (name === 'details') {
    const applicationLink = isHttpUrl(job.applicationUrl) ? safeText(job.applicationUrl, 500) : 'Not detected';
    const sourceLink = isHttpUrl(job.sourceUrl) ? safeText(job.sourceUrl, 500) : 'Not available';
    const parts = [
      '**' + safeText(job.role, 130) + ' — ' + safeText(job.company, 130) + '**',
      'ID: ' + id,
      'Location: ' + safeText(job.location, 120),
      'Type: ' + safeText(job.employmentType, 80),
      'Deadline: ' + safeText(job.deadline, 80),
      'Application email: ' + safeText(job.applicationEmail, 160),
      'Application link: ' + applicationLink,
      'Source: ' + sourceLink,
      '\n**Description**\n' + safeText(job.description, 900),
    ];
    await interaction.reply({ content: parts.join('\n').slice(0, 1950), ephemeral: true });
    return;
  }

  if (name === 'prepare') {
    if (job.deliveryState !== 'not_sent') {
      await interaction.reply({ content: 'This application has delivery state "' + job.deliveryState + '" and cannot be prepared again.', ephemeral: true });
      return;
    }
    const claim = await updateJobIf(
      config.dataFile, id,
      (current) => current.deliveryState === 'not_sent' && current.status !== 'preparing',
      (current) => ({ ...current, status: 'preparing', approved: false, preparationStartedAt: new Date().toISOString() }),
    );
    if (!claim.updated) {
      await interaction.reply({ content: 'This job is already being prepared. Check /queue shortly.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const [baseCv, profile] = await Promise.all([
        readFile(config.baseCvFile, 'utf8'), readFile(config.profileFile, 'utf8'),
      ]);
      if (!baseCv.trim() || !profile.trim()) throw new Error('Your base CV or profile file is empty.');
      const pack = await createApplicationPack({ job: claim.job, baseCv, profile });
      const files = await createPdfFiles({ generatedDir: config.generatedDir, job: claim.job, pack });
      const update = await updateJobIf(
        config.dataFile, id,
        (current) => current.status === 'preparing' && current.deliveryState === 'not_sent',
        (current) => ({
          ...current, status: 'prepared', approved: false, deliveryState: 'not_sent',
          pack: { ...pack, ...files },
        }),
      );
      if (!update.updated) throw new Error('The job state changed while the documents were being prepared.');

      const notes = pack.reviewNotes.length
        ? '\n**Please check these points:**\n' + pack.reviewNotes.map((note) => '• ' + safeText(note, 250)).join('\n')
        : '';
      await interaction.editReply({
        content: ('Drafts created for **' + safeText(job.role) + ' at ' + safeText(job.company)
          + '**. Read both PDFs and check every statement before using /approve.' + notes).slice(0, 1950),
        files: [new AttachmentBuilder(files.cvPath), new AttachmentBuilder(files.coverPath)],
      });
    } catch (error) {
      await updateJobIf(
        config.dataFile, id,
        (current) => current.status === 'preparing' && current.deliveryState === 'not_sent',
        (current) => ({ ...current, status: current.pack ? 'prepared' : 'new', approved: false }),
      );
      await interaction.editReply('Could not prepare this application: ' + safeText(error.message, 900));
    }
    return;
  }

  if (name === 'approve') {
    if (!job.pack?.cvPath || !job.pack?.coverPath || !(await filesExist(job.pack.cvPath, job.pack.coverPath))) {
      await interaction.reply({ content: 'The generated PDFs are missing. Run /prepare again, then read both files.', ephemeral: true });
      return;
    }
    const result = await updateJobIf(
      config.dataFile, id,
      (current) => current.deliveryState === 'not_sent' && current.status === 'prepared'
        && current.pack?.cvPath && current.pack?.coverPath,
      (current) => ({ ...current, approved: true, status: 'approved', approvedAt: new Date().toISOString() }),
    );
    if (!result.updated) {
      await interaction.reply({ content: 'This job is not in a state that can be approved. Refresh /queue and check its status.', ephemeral: true });
      return;
    }
    await interaction.reply({
      content: 'Application ' + id + ' approved. Use /send ' + id + ' to send it to ' + safeText(job.applicationEmail, 160) + '.',
      ephemeral: true,
    });
    return;
  }

  if (name === 'send') {
    if (!job.approved || job.status !== 'approved') {
      await interaction.reply({ content: 'This application is not approved. Review the PDFs, then use /approve first.', ephemeral: true });
      return;
    }
    if (job.deliveryState !== 'not_sent') {
      const extra = job.deliveryState === 'sending'
        ? ' A previous send attempt may have reached the employer. Check your Sent folder before taking further action.'
        : '';
      await interaction.reply({ content: 'This application cannot be sent again (state: ' + job.deliveryState + ').' + extra, ephemeral: true });
      return;
    }
    if (!config.smtp.configured) {
      await interaction.reply({ content: 'SMTP is not configured. Add the SMTP settings to .env before using /send.', ephemeral: true });
      return;
    }
    if (!job.applicationEmail) {
      await interaction.reply({ content: 'No employer email was selected from the original job post. Use the application link and submit manually after reviewing the documents.', ephemeral: true });
      return;
    }
    if (!job.pack?.cvPath || !job.pack?.coverPath || !(await filesExist(job.pack.cvPath, job.pack.coverPath))) {
      await interaction.reply({ content: 'The generated PDFs are missing. Run /prepare again, review the new files, and approve again.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try { await verifySmtp(config.smtp); }
    catch (error) {
      await interaction.editReply('SMTP could not be verified, so nothing was sent and the application remains approved: ' + safeText(error.message, 700));
      return;
    }

    const claim = await updateJobIf(
      config.dataFile, id,
      (current) => current.approved === true && current.status === 'approved' && current.deliveryState === 'not_sent',
      (current) => ({ ...current, deliveryState: 'sending', status: 'sending', sendStartedAt: new Date().toISOString() }),
    );
    if (!claim.updated) {
      await interaction.editReply('The application state changed before sending could start. Nothing was sent; refresh /queue.');
      return;
    }

    try {
      const result = await sendApplicationEmail({
        smtp: config.smtp, to: claim.job.applicationEmail,
        subject: claim.job.pack.emailSubject, text: claim.job.pack.emailBody,
        attachments: [claim.job.pack.cvPath, claim.job.pack.coverPath],
      });
      await updateJobIf(
        config.dataFile, id,
        (current) => current.deliveryState === 'sending',
        (current) => ({
          ...current, deliveryState: 'sent', status: 'sent',
          sentAt: new Date().toISOString(), messageId: result.messageId || '',
        }),
      );
      await interaction.editReply('Application email sent to **' + safeText(claim.job.applicationEmail, 160)
        + '**. Message ID: ' + (result.messageId || 'not returned') + '.');
    } catch (error) {
      await interaction.editReply('Email delivery could not be confirmed: ' + safeText(error.message, 700)
        + '. The job is locked against resending. Check your Sent folder and SMTP logs before taking further action.');
    }
  }
}
