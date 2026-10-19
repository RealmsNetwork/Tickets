import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config, validateRuntimeConfig } from './config.js';
import { Database } from './db/database.js';
import { handleInteraction } from './handlers/interactions.js';
import { markActivity, runInactivityMonitor } from './services/tickets.js';
import { syncTicketPresentation, syncQueueDisplaysForClient } from './services/ticket-presentation.js';

validateRuntimeConfig();
const db = new Database(config.databasePath);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  allowedMentions: { parse: [], repliedUser: false }
});
client.db = db;
client.config = config;

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[ready] ${readyClient.user.tag} online · shard ${readyClient.shard?.ids?.join(',') ?? 'single'} · db=${config.databasePath}`);
  console.log(`[ready] Queue ${config.ticketing.queue?.enabled ? 'enabled' : 'disabled'} · ${config.ticketing.categories.length} ticket categories loaded.`);
  syncQueueDisplaysForClient(client, db, config).catch((error) => {
    console.error('[ticket-presentation] Startup synchronization failed:', error);
  });

  const queueDisplay = config.ticketing.queue?.display;
  if (queueDisplay?.enabled) {
    const intervalMs = Math.max(15, Number(queueDisplay.refreshIntervalSeconds ?? 60)) * 1000;
    const timer = setInterval(() => {
      for (const guild of client.guilds.cache.values()) {
        syncTicketPresentation({ guild, db, config, sortChannels: false }).catch((error) => {
          console.error(`[queue-display] Refresh failed for guild ${guild.id}:`, error);
        });
      }
    }, intervalMs);
    timer.unref();
  }

  if (config.ticketing.inactivityMonitor?.enabled) {
    const intervalMs = Math.max(1, Number(config.ticketing.inactivityMonitor.checkIntervalMinutes ?? 5)) * 60_000;
    const timer = setInterval(() => runInactivityMonitor(client).catch((error) => console.error('[inactivity]', error)), intervalMs);
    timer.unref();
    runInactivityMonitor(client).catch((error) => console.error('[inactivity]', error));
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  await handleInteraction(interaction);
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  try {
    const ticket = db.getTicketByChannel(message.channel.id);
    if (ticket) await markActivity({ ticket, author: message.member ?? message.author, db, config });
  } catch (error) {
    console.error('[messageCreate] Could not update ticket activity:', error);
  }
});

client.on(Events.ChannelDelete, (channel) => {
  try {
    const ticket = db.getTicketByChannel(channel.id);
    if (ticket && ['open', 'queued'].includes(ticket.status)) {
      db.updateTicket(ticket.id, { status: 'closed', closed_at: Date.now(), close_reason: 'Ticket channel was deleted outside the bot.' });
      syncTicketPresentation({ guild: channel.guild, db, config }).catch((error) => {
        console.error('[ticket-presentation] Failed after an external channel deletion:', error);
      });
    }
  } catch (error) {
    console.error('[channelDelete] Could not reconcile deleted ticket:', error);
  }
});

client.on(Events.GuildDelete, (guild) => {
  console.warn(`[guildDelete] Bot removed from guild ${guild.id}. Ticket records remain in the local database for audit/export purposes.`);
});

process.once('SIGINT', () => {
  console.log('[shutdown] Closing database and Discord client…');
  db.close();
  client.destroy();
  process.exit(0);
});
process.once('SIGTERM', () => {
  db.close();
  client.destroy();
  process.exit(0);
});

client.on(Events.Error, (error) => console.error('[discord-client]', error));
process.on('unhandledRejection', (error) => console.error('[unhandled-rejection]', error));

client.login(config.token).catch((error) => {
  console.error('Discord login failed:', error);
  db.close();
  process.exit(1);
});
