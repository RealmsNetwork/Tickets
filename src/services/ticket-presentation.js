import { refreshQueueDisplay } from './queue-display.js';
import { sortTicketChannelsByPriority } from './ticket-ordering.js';

/**
 * Best-effort synchronization of visible channel order and the persistent
 * queue embed. Presentation failures must never roll back ticket operations.
 */
export async function syncTicketPresentation({ guild, db, config, sortChannels = true }) {
  const jobs = [];
  if (sortChannels) jobs.push(['channel ordering', () => sortTicketChannelsByPriority({ guild, db, config })]);
  jobs.push(['queue display', () => refreshQueueDisplay({ guild, db, config })]);

  const results = await Promise.allSettled(jobs.map(([, run]) => run()));
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === 'rejected') {
      console.warn(`[ticket-presentation] Unable to update ${jobs[index][0]} for guild ${guild.id}: ${result.reason?.message ?? result.reason}`);
    }
  }
  return results.every((result) => result.status === 'fulfilled');
}

export async function syncQueueDisplaysForClient(client, db, config) {
  const guilds = [...client.guilds.cache.values()];
  await Promise.all(guilds.map((guild) => syncTicketPresentation({
    guild, db, config, sortChannels: true
  })));
  return guilds.length;
}
