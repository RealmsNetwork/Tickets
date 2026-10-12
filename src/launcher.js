import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShardingManager } from 'discord.js';
import { config, validateRuntimeConfig } from './config.js';

validateRuntimeConfig();
if (process.argv.includes('--single') || process.env.TICKETS_SINGLE_PROCESS === 'true') {
  await import('./bot.js');
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const shardCount = config.sharding?.totalShards ?? 'auto';
  const manager = new ShardingManager(path.join(root, 'src', 'bot.js'), {
    token: config.token,
    totalShards: shardCount,
    respawn: true
  });
  manager.on('shardCreate', (shard) => {
    console.log(`[sharding] Launched shard ${shard.id}.`);
    shard.on('death', () => console.warn(`[sharding] Shard ${shard.id} exited.`));
    shard.on('error', (error) => console.error(`[sharding:${shard.id}]`, error));
  });
  await manager.spawn({ amount: shardCount, delay: 5500, timeout: 120000 });
}
