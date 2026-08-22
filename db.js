import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dbPath = join(dirname(fileURLToPath(import.meta.url)), 'vocab.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    part_of_speech TEXT,
    definition TEXT NOT NULL,
    etymology TEXT,
    synonyms TEXT,
    antonyms TEXT,
    audio_url TEXT,
    tags TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    times_quizzed INTEGER NOT NULL DEFAULT 0,
    times_correct INTEGER NOT NULL DEFAULT 0,
    next_review TEXT NOT NULL DEFAULT (datetime('now')),
    interval_days INTEGER NOT NULL DEFAULT 1,
    ease REAL NOT NULL DEFAULT 2.5
  )
`);

// Migration for databases created before later columns existed.
for (const [col, def] of [
  ['synonyms', 'TEXT'], ['antonyms', 'TEXT'], ['audio_url', 'TEXT'], ['tags', 'TEXT'],
  ['next_review', 'TEXT'], ['interval_days', 'INTEGER NOT NULL DEFAULT 1'], ['ease', 'REAL NOT NULL DEFAULT 2.5'],
]) {
  try { db.exec(`ALTER TABLE words ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
}
// SQLite ALTER TABLE can't default a column to datetime('now'), so backfill separately.
db.exec(`UPDATE words SET next_review = datetime('now') WHERE next_review IS NULL`);

export function saveWord({ word, partOfSpeech, definition, etymology, synonyms, antonyms, audioUrl, tags }) {
  const stmt = db.prepare(`
    INSERT INTO words (word, part_of_speech, definition, etymology, synonyms, antonyms, audio_url, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(word) DO UPDATE SET
      part_of_speech = excluded.part_of_speech,
      definition = excluded.definition,
      etymology = excluded.etymology,
      synonyms = excluded.synonyms,
      antonyms = excluded.antonyms,
      audio_url = excluded.audio_url
  `);
  stmt.run(
    word.toLowerCase(),
    partOfSpeech ?? null,
    definition,
    etymology ?? null,
    synonyms?.join(', ') ?? null,
    antonyms?.join(', ') ?? null,
    audioUrl ?? null,
    tags ?? null,
  );
}

export function updateTags(id, tags) {
  db.prepare('UPDATE words SET tags = ? WHERE id = ?').run(tags, id);
}

export function hasWord(word) {
  return db.prepare('SELECT 1 FROM words WHERE word = ?').get(word.toLowerCase()) !== undefined;
}

export function listWords(tag) {
  if (tag) {
    return db.prepare('SELECT * FROM words WHERE tags LIKE ? ORDER BY created_at DESC').all(`%${tag}%`);
  }
  return db.prepare('SELECT * FROM words ORDER BY created_at DESC').all();
}

export function randomWord() {
  return db.prepare('SELECT * FROM words ORDER BY RANDOM() LIMIT 1').get();
}

// Spaced repetition (SM-2-lite): due words first, oldest-due first; falls back to
// any random word once nothing is due yet, so quizzing still works on a fresh bank.
export function dueWord() {
  return db.prepare(`SELECT * FROM words WHERE next_review <= datetime('now') ORDER BY next_review ASC LIMIT 1`).get()
    ?? randomWord();
}

export function recordQuizResult(id, correct) {
  const word = db.prepare('SELECT interval_days, ease FROM words WHERE id = ?').get(id);
  let interval = word.interval_days;
  let ease = word.ease;
  if (correct) {
    interval = Math.max(1, Math.round(interval * ease));
    ease = Math.min(2.8, ease + 0.1);
  } else {
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  }
  db.prepare(`
    UPDATE words
    SET times_quizzed = times_quizzed + 1,
        times_correct = times_correct + ?,
        interval_days = ?,
        ease = ?,
        next_review = datetime('now', '+' || ? || ' days')
    WHERE id = ?
  `).run(correct ? 1 : 0, interval, ease, interval, id);
  return interval;
}
