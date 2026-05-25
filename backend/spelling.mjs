import dictionaryEn from "dictionary-en";
import nspell from "nspell";
import { query } from "./db.mjs";

const wordPattern = /\b[\p{L}][\p{L}'-]*\b/gu;
const maxSegments = 2000;
const maxSegmentLength = 20000;
const maxSuggestions = 6;

let englishSpellchecker;

function getEnglishSpellchecker() {
  if (!englishSpellchecker) {
    englishSpellchecker = nspell(dictionaryEn);
    [
      "AuthFlow",
      "DITA",
      "DITA-OT",
      "conref",
      "conrefs",
      "keyref",
      "shortdesc",
      "topicref",
      "xml",
    ].forEach((word) => englishSpellchecker.add(word));
  }

  return englishSpellchecker;
}

function normalizeLanguage(language = "") {
  const normalized = String(language || "en-US").trim() || "en-US";
  return normalized.toLowerCase().startsWith("en") ? "en" : normalized.toLowerCase();
}

function pathKeyFor(path = []) {
  return path.join(".");
}

function normalizeWord(word = "") {
  return String(word || "").trim().toLowerCase();
}

async function getUserDictionaryWordSet(userId) {
  if (!userId) return new Set();

  const result = await query(
    `
      select language, normalized_word
      from user_spelling_dictionary
      where user_id = $1
    `,
    [userId],
  );

  return new Set(result.rows.map((row) => `${row.language}:${row.normalized_word}`));
}

function isUserDictionaryWord(userDictionaryWords, language, word) {
  if (!userDictionaryWords?.size) return false;
  return userDictionaryWords.has(`${normalizeLanguage(language)}:${normalizeWord(word)}`);
}

function checkEnglishSegment(segment, userDictionaryWords) {
  const spellchecker = getEnglishSpellchecker();
  const text = String(segment.text || "").slice(0, maxSegmentLength);
  const path = Array.isArray(segment.path) ? segment.path : [];
  const childNodeIndex = Number.isInteger(segment.childNodeIndex) ? segment.childNodeIndex : 0;
  const language = segment.language || "en-US";
  const issues = [];

  for (const match of text.matchAll(wordPattern)) {
    const word = match[0];
    if (
      word.length <= 1 ||
      spellchecker.correct(word) ||
      isUserDictionaryWord(userDictionaryWords, language, word)
    ) {
      continue;
    }

    const startOffset = match.index || 0;
    issues.push({
      id: `${pathKeyFor(path)}:${childNodeIndex}:${startOffset}:${word.toLowerCase()}`,
      fileId: segment.fileId || null,
      pathKey: pathKeyFor(path),
      path,
      childNodeIndex,
      startOffset,
      endOffset: startOffset + word.length,
      word,
      suggestions: spellchecker.suggest(word).slice(0, maxSuggestions),
      language,
    });
  }

  return issues;
}

export async function checkSpellingSegments(payload = {}, options = {}) {
  const segments = Array.isArray(payload.segments) ? payload.segments.slice(0, maxSegments) : [];
  const userDictionaryWords = await getUserDictionaryWordSet(options.userId);
  const issues = [];
  const languages = new Set();

  for (const segment of segments) {
    const language = normalizeLanguage(segment?.language);
    languages.add(language);
    if (language !== "en") continue;

    issues.push(...checkEnglishSegment(segment, userDictionaryWords));
  }

  return {
    engine: "nspell",
    dictionaries: ["en"],
    languages: [...languages],
    issues,
  };
}

export async function addUserSpellingDictionaryWord(userId, payload = {}) {
  if (!userId) {
    throw Object.assign(new Error("A signed-in user is required."), { statusCode: 401 });
  }

  const word = String(payload.word || "").trim();
  const normalizedWord = normalizeWord(word);
  const language = normalizeLanguage(payload.language || "en-US");

  if (!normalizedWord || !/^[\p{L}][\p{L}'-]*$/u.test(word)) {
    throw Object.assign(new Error("Enter one word to add to the dictionary."), { statusCode: 400 });
  }

  const result = await query(
    `
      insert into user_spelling_dictionary (
        user_id,
        language,
        word,
        normalized_word
      )
      values ($1, $2, $3, $4)
      on conflict (user_id, language, normalized_word)
      do update set word = excluded.word
      returning id, language, word, normalized_word, created_at
    `,
    [userId, language, word.slice(0, 120), normalizedWord.slice(0, 120)],
  );

  return {
    ok: true,
    word: result.rows[0],
  };
}
