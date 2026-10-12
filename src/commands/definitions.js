import { SlashCommandBuilder } from 'discord.js';

export function buildCommands(config) {
  const categoryChoices = config.ticketing.categories.slice(0, 25).map((item) => ({ name: item.name, value: item.id }));
  const priorities = config.priorityLevels.slice(0, 25).map((item) => ({ name: `${item.emoji ?? ''} ${item.label}`.trim(), value: item.id }));
  const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Check the bot response time.'),
    new SlashCommandBuilder().setName('help').setDescription('Show the support bot command guide.'),
    new SlashCommandBuilder().setName('stats').setDescription('View server and ticket statistics.'),
    new SlashCommandBuilder().setName('calculate').setDescription('Evaluate a basic arithmetic expression safely.')
      .addStringOption((o) => o.setName('expression').setDescription('Arithmetic expression, e.g. (12 + 5) * 3.').setRequired(true).setMaxLength(120)),
    new SlashCommandBuilder().setName('ticket-panel').setDescription('Post a support panel in this or another channel.')
      .addChannelOption((o) => o.setName('channel').setDescription('Text channel where the panel should be posted.')),
    new SlashCommandBuilder().setName('ticket-close').setDescription('Close this ticket and create a transcript.')
      .addStringOption((o) => o.setName('reason').setDescription('Optional reason for closing.').setMaxLength(900)),
    new SlashCommandBuilder().setName('ticket-delete').setDescription('Permanently delete a ticket after exporting its transcript.'),
    new SlashCommandBuilder().setName('ticket-add').setDescription('Allow another member to view and participate in this ticket.')
      .addUserOption((o) => o.setName('user').setDescription('Member to add.').setRequired(true)),
    new SlashCommandBuilder().setName('ticket-remove').setDescription('Remove a participant from this ticket.')
      .addUserOption((o) => o.setName('user').setDescription('Member to remove.').setRequired(true)),
    new SlashCommandBuilder().setName('ticket-rename').setDescription('Rename the current ticket channel.')
      .addStringOption((o) => o.setName('name').setDescription('New channel name.').setRequired(true).setMaxLength(90)),
    new SlashCommandBuilder().setName('ticket-claim').setDescription('Claim the current ticket.'),
    new SlashCommandBuilder().setName('ticket-unclaim').setDescription('Release the current ticket.'),
    new SlashCommandBuilder().setName('ticket-priority').setDescription('Change this ticket priority.')
      .addStringOption((o) => o.setName('level').setDescription('Priority level.').setRequired(true).addChoices(...priorities)),
    new SlashCommandBuilder().setName('ticket-category').setDescription('Move this ticket to a configured category.')
      .addStringOption((o) => o.setName('category').setDescription('Target category.').setRequired(true).addChoices(...categoryChoices)),
    new SlashCommandBuilder().setName('ticket-tag').setDescription('Manage ticket tags.')
      .addSubcommand((s) => s.setName('add').setDescription('Add a configured tag.').addStringOption((o) => o.setName('tag').setDescription('Tag identifier.').setRequired(true).setMaxLength(50)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove a configured tag.').addStringOption((o) => o.setName('tag').setDescription('Tag identifier.').setRequired(true).setMaxLength(50)))
      .addSubcommand((s) => s.setName('list').setDescription('Show tags applied to this ticket.')),
    new SlashCommandBuilder().setName('ticket-transcript').setDescription('Export the current ticket transcript as HTML.'),
    new SlashCommandBuilder().setName('ticket-pin').setDescription('Pin the opening ticket information message.'),
    new SlashCommandBuilder().setName('ticket-alert').setDescription('Send the ticket owner a follow-up reminder.')
      .addStringOption((o) => o.setName('message').setDescription('Reminder message.').setRequired(true).setMaxLength(900)),
    new SlashCommandBuilder().setName('ticket-queue').setDescription('View or process the optional support queue.')
      .addSubcommand((s) => s.setName('list').setDescription('List waiting tickets.'))
      .addSubcommand((s) => s.setName('next').setDescription('Claim the next ticket in the queue.'))
      .addSubcommand((s) => s.setName('position').setDescription('Show your current ticket position.')),
    new SlashCommandBuilder().setName('ticket-blacklist').setDescription('Manage who can open support tickets.')
      .addSubcommand((s) => s.setName('add').setDescription('Block a member from opening tickets.')
        .addUserOption((o) => o.setName('user').setDescription('Member to block.').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason, visible to staff.').setRequired(true).setMaxLength(500)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove a ticket blacklist entry.')
        .addUserOption((o) => o.setName('user').setDescription('Member to unblock.').setRequired(true)))
      .addSubcommand((s) => s.setName('check').setDescription('Check a member blacklist entry.')
        .addUserOption((o) => o.setName('user').setDescription('Member to check.').setRequired(true))),
    new SlashCommandBuilder().setName('ticket-stats').setDescription('View server-wide ticket statistics.'),
    new SlashCommandBuilder().setName('staff-stats').setDescription('View support staff performance statistics.')
      .addUserOption((o) => o.setName('member').setDescription('Staff member to inspect.')),
    new SlashCommandBuilder().setName('suggest').setDescription('Submit an idea for the server.')
      .addStringOption((o) => o.setName('idea').setDescription('Describe your suggestion.').setRequired(true).setMinLength(8).setMaxLength(1800)),
    new SlashCommandBuilder().setName('suggestion-manage').setDescription('Accept or decline a suggestion.')
      .addStringOption((o) => o.setName('message-id').setDescription('Message ID of the suggestion.').setRequired(true).setMaxLength(30))
      .addStringOption((o) => o.setName('decision').setDescription('Decision to apply.').setRequired(true)
        .addChoices({ name: 'Accept', value: 'accepted' }, { name: 'Decline', value: 'denied' }))
      .addStringOption((o) => o.setName('note').setDescription('Optional staff note.').setMaxLength(500)),
    new SlashCommandBuilder().setName('review-stats').setDescription('View support satisfaction and review totals.'),
    new SlashCommandBuilder().setName('invoice').setDescription('Create or manage a staff-tracked invoice record.')
      .addSubcommand((s) => s.setName('create').setDescription('Create an invoice record (does not charge a payment method).')
        .addUserOption((o) => o.setName('user').setDescription('Member being billed.').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Amount, e.g. 12.50.').setRequired(true).setMaxLength(12))
        .addStringOption((o) => o.setName('currency').setDescription('ISO 4217 currency code, e.g. USD.').setRequired(true).setMinLength(3).setMaxLength(3))
        .addStringOption((o) => o.setName('description').setDescription('What the invoice is for.').setRequired(true).setMaxLength(500))
        .addStringOption((o) => o.setName('payment-url').setDescription('Optional trusted payment link.').setMaxLength(500)))
      .addSubcommand((s) => s.setName('status').setDescription('Show an invoice record.')
        .addIntegerOption((o) => o.setName('id').setDescription('Invoice number.').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('mark-paid').setDescription('Mark an invoice as paid after verifying it externally.')
        .addIntegerOption((o) => o.setName('id').setDescription('Invoice number.').setRequired(true).setMinValue(1)))
  ];
  return commands.map((command) => command.toJSON());
}
