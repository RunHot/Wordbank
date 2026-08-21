import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

try { process.loadEnvFile(join(__dirname, '.env')); } catch { /* .env optional */ }

import { saveWord, listWords, randomWord, recordQuizResult, hasWord } from './db.js';

const MW_DICT_KEY = process.env.MW_API_KEY1;
const MW_THESAURUS_KEY = process.env.MW_API_KEY2;
const PORT = process.env.PORT || 3000;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

// Strips Merriam-Webster's markup tokens like {bc}, {it}...{/it}, {sx|word||}
function stripMwMarkup(text) {
  return text
    .replace(/\{sx\|([^|}]+)\|[^}]*\}/g, '$1')
    .replace(/\{a_link\|([^}]+)\}/g, '$1')
    .replace(/\{d_link\|([^|}]+)\|[^}]*\}/g, '$1')
    .replace(/\{[^}]+\}/g, '')
    .trim();
}

function findEntry(data, word) {
  return data.find((e) => typeof e === 'object' && e.meta?.id?.toLowerCase().startsWith(word.toLowerCase()));
}

async function lookupWord(word) {
  if (!MW_DICT_KEY) throw new Error('MW_API_KEY1 (dictionary key) not set — see README');

  const dictUrl = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${MW_DICT_KEY}`;
  const dictRes = await fetch(dictUrl);
  if (!dictRes.ok) throw new Error(`Dictionary API error: ${dictRes.status}`);
  const dictData = await dictRes.json();

  const entry = findEntry(dictData, word);
  if (!entry) {
    const suggestions = Array.isArray(dictData) ? dictData.filter((e) => typeof e === 'string') : [];
    throw new Error(suggestions.length ? `Not found. Did you mean: ${suggestions.slice(0, 5).join(', ')}?` : 'Word not found');
  }

  const definition = (entry.shortdef ?? []).join('; ') || 'No definition available';
  const etymology = entry.et?.[0]?.[1] ? stripMwMarkup(entry.et[0][1]) : null;

  let synonyms = [];
  let antonyms = [];
  if (MW_THESAURUS_KEY) {
    const thesUrl = `https://www.dictionaryapi.com/api/v3/references/thesaurus/json/${encodeURIComponent(word)}?key=${MW_THESAURUS_KEY}`;
    const thesRes = await fetch(thesUrl);
    if (thesRes.ok) {
      const thesData = await thesRes.json();
      const thesEntry = findEntry(thesData, word);
      synonyms = thesEntry?.meta?.syns?.[0] ?? [];
      antonyms = thesEntry?.meta?.ants?.[0] ?? [];
    }
  }

  return { word: word.toLowerCase(), partOfSpeech: entry.fl ?? null, definition, etymology, synonyms, antonyms, saved: hasWord(word) };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function serveStatic(req, res) {
  const path = req.url === '/' ? '/index.html' : req.url;
  try {
    const file = await readFile(join(__dirname, 'public', path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'text/plain' });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/api/lookup' && req.method === 'GET') {
      const word = url.searchParams.get('word')?.trim();
      if (!word) return sendJson(res, 400, { error: 'word is required' });
      return sendJson(res, 200, await lookupWord(word));
    }

    if (url.pathname === '/api/words' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.word || !body.definition) return sendJson(res, 400, { error: 'word and definition are required' });
      saveWord(body);
      return sendJson(res, 201, { ok: true });
    }

    if (url.pathname === '/api/words' && req.method === 'GET') {
      return sendJson(res, 200, listWords());
    }

    if (url.pathname === '/api/quiz' && req.method === 'GET') {
      const word = randomWord();
      if (!word) return sendJson(res, 404, { error: 'No saved words yet' });
      return sendJson(res, 200, word);
    }

    const quizMatch = url.pathname.match(/^\/api\/quiz\/(\d+)$/);
    if (quizMatch && req.method === 'POST') {
      const body = await readBody(req);
      recordQuizResult(Number(quizMatch[1]), Boolean(body.correct));
      return sendJson(res, 200, { ok: true });
    }

    return serveStatic(req, res);
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Vocabulary app running at http://localhost:${PORT}`));
