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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    times_quizzed INTEGER NOT NULL DEFAULT 0,
    times_correct INTEGER NOT NULL DEFAULT 0
  )
`);

// Migration for databases created before synonyms/antonyms existed.
for (const col of ['synonyms', 'antonyms']) {
  try { db.exec(`ALTER TABLE words ADD COLUMN ${col} TEXT`); } catch { /* already exists */ }
}

export function saveWord({ word, partOfSpeech, definition, etymology, synonyms, antonyms }) {
  const stmt = db.prepare(`
    INSERT INTO words (word, part_of_speech, definition, etymology, synonyms, antonyms)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(word) DO UPDATE SET
      part_of_speech = excluded.part_of_speech,
      definition = excluded.definition,
      etymology = excluded.etymology,
      synonyms = excluded.synonyms,
      antonyms = excluded.antonyms
  `);
  stmt.run(
    word.toLowerCase(),
    partOfSpeech ?? null,
    definition,
    etymology ?? null,
    synonyms?.join(', ') ?? null,
    antonyms?.join(', ') ?? null,
  );
}

export function hasWord(word) {
  return db.prepare('SELECT 1 FROM words WHERE word = ?').get(word.toLowerCase()) !== undefined;
}

export function listWords() {
  return db.prepare('SELECT * FROM words ORDER BY created_at DESC').all();
}

export function randomWord() {
  return db.prepare('SELECT * FROM words ORDER BY RANDOM() LIMIT 1').get();
}

export function recordQuizResult(id, correct) {
  db.prepare(`
    UPDATE words
    SET times_quizzed = times_quizzed + 1,
        times_correct = times_correct + ?
    WHERE id = ?
  `).run(correct ? 1 : 0, id);
}
