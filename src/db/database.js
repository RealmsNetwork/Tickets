import fs from 'node:fs';
import path from 'node:path';
import Sqlite from 'better-sqlite3';
import { sortTicketsByPriority } from '../utils/priority.js';

const now = () => Date.now();
const asJson = (value, fallback = []) => {
  try { return JSON.parse(value ?? ''); } catch { return fallback; }
};

export class Database {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.sqlite = new Sqlite(filename);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
    this.migrate();
  }

  migrate() {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('queued','open','closed','archived')),
        priority TEXT NOT NULL DEFAULT 'normal',
        tags_json TEXT NOT NULL DEFAULT '[]',
        intake_json TEXT NOT NULL DEFAULT '{}',
        claimed_by TEXT,
        created_at INTEGER NOT NULL,
        first_response_at INTEGER,
        closed_at INTEGER,
        closed_by TEXT,
        close_reason TEXT,
        last_activity_at INTEGER NOT NULL,
        inactivity_alerted_at INTEGER,
        transcript_path TEXT,
        opening_message_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_owner_status ON tickets(guild_id, owner_id, status);
      CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(guild_id, status, priority, created_at);
      CREATE INDEX IF NOT EXISTS idx_tickets_staff_status ON tickets(guild_id, claimed_by, status);

      CREATE TABLE IF NOT EXISTS ticket_participants (
        ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        added_by TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY(ticket_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS staff_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        ticket_id INTEGER,
        staff_id TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_staff_events ON staff_events(guild_id, staff_id, action);

      CREATE TABLE IF NOT EXISTS ticket_creation_cooldowns (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(guild_id,user_id)
      );

      CREATE TABLE IF NOT EXISTS blacklisted_users (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        author_id TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','denied')),
        created_at INTEGER NOT NULL,
        decided_by TEXT,
        decision_note TEXT
      );
      CREATE TABLE IF NOT EXISTS suggestion_votes (
        suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        vote INTEGER NOT NULL CHECK(vote IN (-1,1)),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(suggestion_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        comment TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS queue_status_messages (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        ticket_id INTEGER,
        created_by TEXT NOT NULL,
        billed_user_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        description TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'manual',
        provider_reference TEXT,
        payment_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','void','failed')),
        created_at INTEGER NOT NULL,
        paid_at INTEGER
      );
    `);
    const ticketColumns = new Set(this.sqlite.pragma('table_info(tickets)').map((column) => column.name));
    if (!ticketColumns.has('inactivity_alerted_at')) {
      this.sqlite.exec('ALTER TABLE tickets ADD COLUMN inactivity_alerted_at INTEGER');
    }
    if (!ticketColumns.has('transcript_path')) {
      this.sqlite.exec('ALTER TABLE tickets ADD COLUMN transcript_path TEXT');
    }
    if (!ticketColumns.has('opening_message_id')) {
      this.sqlite.exec('ALTER TABLE tickets ADD COLUMN opening_message_id TEXT');
    }
  }

  createTicket(data) {
    const stamp = now();
    const result = this.sqlite.prepare(`INSERT INTO tickets
      (guild_id, channel_id, owner_id, category_id, status, priority, intake_json, created_at, last_activity_at)
      VALUES (@guildId, @channelId, @ownerId, @categoryId, @status, 'normal', @intakeJson, @createdAt, @createdAt)`)
      .run({ guildId: data.guildId, channelId: data.channelId, ownerId: data.ownerId, categoryId: data.categoryId, status: data.status, intakeJson: JSON.stringify(data.intake ?? {}), createdAt: stamp });
    const ticket = this.getTicketById(Number(result.lastInsertRowid));
    this.sqlite.prepare('INSERT OR IGNORE INTO ticket_participants(ticket_id,user_id,added_by,added_at) VALUES(?,?,?,?)')
      .run(ticket.id, data.ownerId, data.ownerId, stamp);
    return ticket;
  }

  ticketsForGuild(guildId) {
    return this.sqlite.prepare('SELECT * FROM tickets WHERE guild_id=? ORDER BY created_at ASC, id ASC')
      .all(guildId).map((row) => this.hydrateTicket(row));
  }

  getTicketById(id) {
    const row = this.sqlite.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(id));
    return this.hydrateTicket(row);
  }

  getTicketByChannel(channelId) {
    return this.hydrateTicket(this.sqlite.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId));
  }

  hydrateTicket(row) {
    if (!row) return null;
    return { ...row, tags: asJson(row.tags_json), intake: asJson(row.intake_json, {}) };
  }

  findOpenTicketsForUser(guildId, userId) {
    return this.sqlite.prepare("SELECT * FROM tickets WHERE guild_id=? AND owner_id=? AND status IN ('queued','open') ORDER BY created_at ASC")
      .all(guildId, userId).map((row) => this.hydrateTicket(row));
  }

  updateTicket(id, patch) {
    const allowed = new Set(['status','priority','tags_json','intake_json','claimed_by','first_response_at','closed_at','closed_by','close_reason','last_activity_at','inactivity_alerted_at','transcript_path','opening_message_id']);
    const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
    if (!entries.length) return this.getTicketById(id);
    const sql = entries.map(([key]) => `${key}=@${key}`).join(', ');
    const values = Object.fromEntries(entries);
    this.sqlite.prepare(`UPDATE tickets SET ${sql} WHERE id=@id`).run({ ...values, id: Number(id) });
    return this.getTicketById(id);
  }

  claimTicketAtomically({ ticketId, staffId, guildId, capacity = 0, strictOrder = false, allowQueueJump = false, priorityLevels = [] }) {
    const transaction = this.sqlite.transaction(() => {
      const ticket = this.sqlite.prepare('SELECT * FROM tickets WHERE id=? AND guild_id=?').get(Number(ticketId), guildId);
      if (!ticket) return { ok: false, reason: 'missing' };
      if (!['open', 'queued'].includes(ticket.status)) return { ok: false, reason: 'not-open' };
      if (ticket.claimed_by) return { ok: false, reason: 'claimed', claimedBy: ticket.claimed_by };

      if (capacity > 0) {
        const count = this.sqlite.prepare("SELECT COUNT(*) AS count FROM tickets WHERE guild_id=? AND claimed_by=? AND status IN ('open','queued')")
          .get(guildId, staffId).count;
        if (count >= capacity) return { ok: false, reason: 'capacity' };
      }

      if (strictOrder && !allowQueueJump) {
        const waiting = this.sqlite.prepare("SELECT * FROM tickets WHERE guild_id=? AND status='queued' AND claimed_by IS NULL")
          .all(guildId).map((row) => this.hydrateTicket(row));
        const first = sortTicketsByPriority(waiting, priorityLevels)[0];
        if (first && Number(first.id) !== Number(ticketId)) return { ok: false, reason: 'order', nextTicketId: Number(first.id) };
      }

      const stamp = now();
      const updated = this.sqlite.prepare("UPDATE tickets SET claimed_by=?, status='open', last_activity_at=? WHERE id=? AND guild_id=? AND claimed_by IS NULL AND status IN ('open','queued')")
        .run(staffId, stamp, Number(ticketId), guildId);
      if (!updated.changes) return { ok: false, reason: 'race' };
      this.sqlite.prepare('INSERT INTO staff_events(guild_id,ticket_id,staff_id,action,created_at) VALUES(?,?,?,?,?)')
        .run(guildId, Number(ticketId), staffId, 'claim', stamp);
      return { ok: true, ticket: this.getTicketById(ticketId) };
    });
    return transaction.immediate();
  }

  addParticipant(ticketId, userId, addedBy) {
    return this.sqlite.prepare('INSERT OR IGNORE INTO ticket_participants(ticket_id,user_id,added_by,added_at) VALUES(?,?,?,?)')
      .run(Number(ticketId), userId, addedBy, now()).changes > 0;
  }

  removeParticipant(ticketId, userId) {
    return this.sqlite.prepare('DELETE FROM ticket_participants WHERE ticket_id=? AND user_id=?').run(Number(ticketId), userId).changes > 0;
  }

  listParticipants(ticketId) {
    return this.sqlite.prepare('SELECT user_id AS userId FROM ticket_participants WHERE ticket_id=?').all(Number(ticketId)).map((r) => r.userId);
  }

  deleteTicket(id) {
    return this.sqlite.prepare('DELETE FROM tickets WHERE id=?').run(Number(id)).changes > 0;
  }

  logStaffEvent({ guildId, ticketId = null, staffId, action }) {
    this.sqlite.prepare('INSERT INTO staff_events(guild_id,ticket_id,staff_id,action,created_at) VALUES(?,?,?,?,?)')
      .run(guildId, ticketId, staffId, action, now());
  }

  staffStats(guildId, staffId) {
    const rows = this.sqlite.prepare(`SELECT action, COUNT(*) AS count FROM staff_events
      WHERE guild_id=? AND staff_id=? GROUP BY action`).all(guildId, staffId);
    const counts = Object.fromEntries(rows.map((r) => [r.action, r.count]));
    const response = this.sqlite.prepare(`SELECT AVG(first_response_at-created_at) AS avg FROM tickets
      WHERE guild_id=? AND claimed_by=? AND first_response_at IS NOT NULL`).get(guildId, staffId)?.avg;
    return { claims: counts.claim ?? 0, unclaims: counts.unclaim ?? 0, closes: counts.close ?? 0, responses: counts.response ?? 0, averageResponseMs: response ? Math.round(response) : null };
  }

  staffLeaderboard(guildId, limit = 10) {
    return this.sqlite.prepare(`SELECT staff_id AS staffId,
      SUM(CASE WHEN action='claim' THEN 1 ELSE 0 END) AS claims,
      SUM(CASE WHEN action='close' THEN 1 ELSE 0 END) AS closes,
      SUM(CASE WHEN action='response' THEN 1 ELSE 0 END) AS responses
      FROM staff_events WHERE guild_id=? GROUP BY staff_id ORDER BY closes DESC, claims DESC LIMIT ?`).all(guildId, limit);
  }

  ticketStats(guildId) {
    const counts = this.sqlite.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('open','queued') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status='closed' OR status='archived' THEN 1 ELSE 0 END) AS closed
      FROM tickets WHERE guild_id=?`).get(guildId);
    const rating = this.sqlite.prepare('SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE guild_id=?').get(guildId);
    const completion = this.sqlite.prepare(`SELECT AVG(closed_at-created_at) AS average FROM tickets
      WHERE guild_id=? AND closed_at IS NOT NULL`).get(guildId);
    return {
      total: counts.total ?? 0, active: counts.active ?? 0, queued: counts.queued ?? 0, closed: counts.closed ?? 0,
      averageRating: rating?.average ? Number(rating.average.toFixed(2)) : null,
      reviews: rating?.count ?? 0,
      averageCompletionMs: completion?.average ? Math.round(completion.average) : null
    };
  }

  inactiveTickets(staleBefore, guildIds = []) {
    if (!guildIds.length) return [];
    const placeholders = guildIds.map(() => '?').join(',');
    return this.sqlite.prepare(`SELECT * FROM tickets WHERE status='open' AND last_activity_at<=? AND inactivity_alerted_at IS NULL AND guild_id IN (${placeholders}) ORDER BY last_activity_at ASC LIMIT 100`)
      .all(staleBefore, ...guildIds).map((row) => this.hydrateTicket(row));
  }

  queueList(guildId, priorityLevels = []) {
    const rows = this.sqlite.prepare("SELECT * FROM tickets WHERE guild_id=? AND status='queued' AND claimed_by IS NULL")
      .all(guildId).map((row) => this.hydrateTicket(row));
    return sortTicketsByPriority(rows, priorityLevels);
  }

  getQueueStatusMessage(guildId) {
    return this.sqlite.prepare('SELECT guild_id, channel_id, message_id, updated_at FROM queue_status_messages WHERE guild_id=?')
      .get(guildId) ?? null;
  }

  saveQueueStatusMessage(guildId, channelId, messageId) {
    const stamp = now();
    this.sqlite.prepare(`INSERT INTO queue_status_messages(guild_id, channel_id, message_id, updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(guild_id) DO UPDATE SET
        channel_id=excluded.channel_id, message_id=excluded.message_id, updated_at=excluded.updated_at`)
      .run(guildId, channelId, messageId, stamp);
    return this.getQueueStatusMessage(guildId);
  }

  reserveCreationCooldown(guildId, userId, cooldownMs) {
    if (!cooldownMs || cooldownMs < 1) return { allowed: true, remainingMs: 0 };
    const stamp = now();
    const tx = this.sqlite.transaction(() => {
      const row = this.sqlite.prepare('SELECT created_at FROM ticket_creation_cooldowns WHERE guild_id=? AND user_id=?').get(guildId, userId);
      if (row && stamp - row.created_at < cooldownMs) return { allowed: false, remainingMs: cooldownMs - (stamp - row.created_at) };
      this.sqlite.prepare(`INSERT INTO ticket_creation_cooldowns(guild_id,user_id,created_at) VALUES(?,?,?)
        ON CONFLICT(guild_id,user_id) DO UPDATE SET created_at=excluded.created_at`).run(guildId, userId, stamp);
      return { allowed: true, remainingMs: 0 };
    });
    return tx();
  }

  setBlacklist(guildId, userId, reason, createdBy) {
    this.sqlite.prepare(`INSERT INTO blacklisted_users(guild_id,user_id,reason,created_by,created_at) VALUES(?,?,?,?,?)
      ON CONFLICT(guild_id,user_id) DO UPDATE SET reason=excluded.reason, created_by=excluded.created_by, created_at=excluded.created_at`)
      .run(guildId, userId, reason, createdBy, now());
  }

  removeBlacklist(guildId, userId) {
    return this.sqlite.prepare('DELETE FROM blacklisted_users WHERE guild_id=? AND user_id=?').run(guildId, userId).changes > 0;
  }

  getBlacklist(guildId, userId) {
    return this.sqlite.prepare('SELECT * FROM blacklisted_users WHERE guild_id=? AND user_id=?').get(guildId, userId) ?? null;
  }

  createSuggestion(data) {
    const result = this.sqlite.prepare(`INSERT INTO suggestions(guild_id,channel_id,message_id,author_id,body,created_at)
      VALUES(@guildId,@channelId,@messageId,@authorId,@body,@createdAt)`).run({ ...data, createdAt: now() });
    return this.getSuggestionByMessage(data.messageId);
  }

  getSuggestionByMessage(messageId) {
    return this.sqlite.prepare('SELECT * FROM suggestions WHERE message_id=?').get(messageId) ?? null;
  }

  voteSuggestion(messageId, userId, vote) {
    const suggestion = this.getSuggestionByMessage(messageId);
    if (!suggestion || suggestion.status !== 'pending') return { ok: false, reason: 'closed' };
    const old = this.sqlite.prepare('SELECT vote FROM suggestion_votes WHERE suggestion_id=? AND user_id=?').get(suggestion.id, userId);
    if (old?.vote === vote) {
      this.sqlite.prepare('DELETE FROM suggestion_votes WHERE suggestion_id=? AND user_id=?').run(suggestion.id, userId);
    } else {
      this.sqlite.prepare(`INSERT INTO suggestion_votes(suggestion_id,user_id,vote,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(suggestion_id,user_id) DO UPDATE SET vote=excluded.vote,updated_at=excluded.updated_at`).run(suggestion.id, userId, vote, now());
    }
    return { ok: true, counts: this.suggestionVoteCounts(suggestion.id) };
  }

  suggestionVoteCounts(suggestionId) {
    const row = this.sqlite.prepare(`SELECT SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END) AS up,
      SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END) AS down FROM suggestion_votes WHERE suggestion_id=?`).get(suggestionId);
    return { up: row?.up ?? 0, down: row?.down ?? 0 };
  }

  decideSuggestion(messageId, status, staffId, note = '') {
    this.sqlite.prepare('UPDATE suggestions SET status=?,decided_by=?,decision_note=? WHERE message_id=?')
      .run(status, staffId, note, messageId);
    return this.getSuggestionByMessage(messageId);
  }

  saveReview({ ticketId, guildId, userId, rating, comment }) {
    this.sqlite.prepare(`INSERT INTO reviews(ticket_id,guild_id,user_id,rating,comment,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(ticket_id) DO UPDATE SET rating=excluded.rating,comment=excluded.comment,created_at=excluded.created_at`)
      .run(Number(ticketId), guildId, userId, rating, comment, now());
  }

  getReviewStats(guildId) {
    const row = this.sqlite.prepare('SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE guild_id=?').get(guildId);
    const distribution = this.sqlite.prepare('SELECT rating, COUNT(*) AS count FROM reviews WHERE guild_id=? GROUP BY rating').all(guildId);
    return { average: row?.average ? Number(row.average.toFixed(2)) : null, count: row?.count ?? 0, distribution: Object.fromEntries(distribution.map((item) => [item.rating, item.count])) };
  }

  getInvoice(id) {
    return this.sqlite.prepare('SELECT * FROM invoices WHERE id=?').get(Number(id)) ?? null;
  }

  markInvoicePaid(id) {
    return this.sqlite.prepare("UPDATE invoices SET status='paid',paid_at=? WHERE id=? AND status='pending'").run(now(), Number(id)).changes > 0;
  }

  createInvoice(data) {
    const result = this.sqlite.prepare(`INSERT INTO invoices(guild_id,ticket_id,created_by,billed_user_id,amount_minor,currency,description,provider,provider_reference,payment_url,status,created_at)
      VALUES(@guildId,@ticketId,@createdBy,@billedUserId,@amountMinor,@currency,@description,@provider,@providerReference,@paymentUrl,'pending',@createdAt)`).run({ ...data, createdAt: now() });
    return this.sqlite.prepare('SELECT * FROM invoices WHERE id=?').get(Number(result.lastInsertRowid));
  }

  close() { this.sqlite.close(); }
}
