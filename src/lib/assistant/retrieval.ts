/**
 * Deterministic, bounded retrieval over page chunks for the private local
 * assistant.
 *
 * Ingestion (#86) owns text extraction, OCR and chunking. This module only
 * consumes chunks that already carry a stable source id and a 1-based page
 * number. It performs no I/O, no network access and no model calls.
 *
 * The ranking is intentionally simple and reproducible: BM25 over Unicode word
 * terms, a small exact-phrase bonus, and stable tie-breaks by input order. The
 * result is capped by both a chunk count and a character budget so a long PDF
 * cannot flood the local model's context.
 */

export interface PageChunk {
  /** Stable within one assistant session. Never a filesystem path. */
  readonly id: string;
  /** Stable workspace/source id, e.g. `f1`. */
  readonly sourceId: string;
  /** Display name only (basename), never a directory. */
  readonly sourceName: string;
  /** 1-based page number in the source PDF. */
  readonly page: number;
  /** Text for this chunk, with page boundaries preserved by ingestion. */
  readonly text: string;
}

export interface RetrievedChunk extends PageChunk {
  /** Deterministic BM25 score, rounded for stable display/tests. */
  readonly score: number;
  /** Query terms that matched this chunk, in query order. */
  readonly matchedTerms: readonly string[];
}

export const RETRIEVAL_LIMITS = {
  maxQueryChars: 1000,
  maxChunks: 5000,
  maxChunkChars: 16000,
  maxSourceNameChars: 255,
  maxIndexChars: 2_000_000,
  defaultTopK: 6,
  maxTopK: 12,
  defaultMaxContextChars: 12_000,
  maxContextChars: 24_000,
  defaultSummaryPages: 12,
  maxSummaryPages: 24,
} as const;

export interface RetrievalOptions {
  /** Maximum number of chunks returned. Defaults to 6; capped at 12. */
  readonly topK?: number;
  /** Maximum total characters returned. Defaults to 12,000; capped at 24,000. */
  readonly maxContextChars?: number;
}

export interface RetrievalResult {
  /** Whitespace-normalized query, capped at `maxQueryChars`. */
  readonly query: string;
  /** Folded query terms used for ranking. Empty when the query has no terms. */
  readonly terms: readonly string[];
  readonly chunks: readonly RetrievedChunk[];
  /** True when any input was capped or a matching chunk was omitted. */
  readonly truncated: boolean;
}

export interface SummaryOptions {
  /** Number of pages sampled evenly across the document. Defaults to 12. */
  readonly maxPages?: number;
  /** Maximum total characters returned. Defaults to 12,000; capped at 24,000. */
  readonly maxContextChars?: number;
}

export interface SummaryRetrieval {
  readonly chunks: readonly RetrievedChunk[];
  /** True when pages/chunks were omitted to stay within the limits. */
  readonly truncated: boolean;
}

const K1 = 1.2;
const B = 0.75;
const PHRASE_BOOST = 2.5;
const WORD_RE = /[\p{L}\p{N}]+/gu;
const NO_SPACE_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

interface WordSegment {
  readonly segment: string;
  readonly isWordLike?: boolean;
}

interface WordSegmenter {
  segment(input: string): Iterable<WordSegment>;
}

type WordSegmenterConstructor = new (
  locales?: string | string[],
  options?: { readonly granularity: "word" },
) => WordSegmenter;

let cachedSegmenter: WordSegmenter | null | undefined;

function getWordSegmenter(): WordSegmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;

  const ctor = (Intl as unknown as { Segmenter?: WordSegmenterConstructor })
    .Segmenter;
  if (!ctor) {
    cachedSegmenter = null;
    return null;
  }

  try {
    // Use the root/undetermined locale so retrieval does not change with the
    // user's UI language. Word segmentation for these scripts is script-based.
    cachedSegmenter = new ctor("und", { granularity: "word" });
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/** Collapse all whitespace runs to one space and trim. */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Fold text for matching, never for display: compatibility-normalize, remove
 * combining marks, lowercase, and collapse a few common OCR variants. This is
 * language-agnostic; it does not apply an English stop-word list or an English
 * stemming rule.
 */
function foldForSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ıßæœøłđħ]/gu, (char) => {
      switch (char) {
        case "ı":
          return "i";
        case "ß":
          return "ss";
        case "æ":
          return "ae";
        case "œ":
          return "oe";
        case "ø":
          return "o";
        case "ł":
          return "l";
        case "đ":
          return "d";
        case "ħ":
          return "h";
        default:
          return char;
      }
    })
    .replace(/['’\-]/gu, "");
}

function addTokenTerms(token: string, out: string[]): void {
  if (token.length === 0) return;

  // Scripts that do not reliably separate words with spaces get characters and
  // bigrams in addition to the segmenter's word tokens. This keeps a query such
  // as `合同金额` useful even when the segmenter splits the surrounding text
  // differently (or is unavailable on older WebViews).
  if (NO_SPACE_SCRIPT_RE.test(token)) {
    const chars = Array.from(token);
    if (chars.length === 1) {
      out.push(token);
      return;
    }

    out.push(token);
    for (const char of chars) out.push(char);
    for (let i = 0; i < chars.length - 1; i += 1) {
      out.push(`${chars[i]}${chars[i + 1]}`);
    }
    return;
  }

  // Single Latin/Cyrillic/Arabic/etc. letters are too noisy. Numbers are kept.
  if (token.length >= 2 || /\d/u.test(token)) out.push(token);
}

/**
 * Deterministic, Unicode-aware term extraction used by retrieval. Document
 * indexing keeps repeated terms so BM25 can use term frequency; query callers
 * should use `tokenizeForSearch`, which deduplicates.
 */
function tokenizeAll(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const raw: string[] = [];
  const segmenter = getWordSegmenter();

  if (segmenter) {
    for (const part of segmenter.segment(normalized)) {
      if (part.isWordLike === false) continue;
      raw.push(part.segment);
    }
  } else {
    raw.push(...(normalized.match(WORD_RE) ?? []));
  }

  const terms: string[] = [];
  for (const rawToken of raw) {
    addTokenTerms(foldForSearch(rawToken), terms);
  }

  return terms;
}

/** Deterministic, Unicode-aware query terms, deduplicated in query order. */
export function tokenizeForSearch(value: string): string[] {
  return Array.from(new Set(tokenizeAll(value)));
}

function isUsableChunk(chunk: PageChunk): boolean {
  return (
    typeof chunk.id === "string" &&
    chunk.id.length > 0 &&
    chunk.id.length <= 128 &&
    !CONTROL_CHARS_RE.test(chunk.id) &&
    typeof chunk.sourceId === "string" &&
    chunk.sourceId.length > 0 &&
    chunk.sourceId.length <= 128 &&
    !CONTROL_CHARS_RE.test(chunk.sourceId) &&
    typeof chunk.sourceName === "string" &&
    chunk.sourceName.length > 0 &&
    chunk.sourceName.length <= RETRIEVAL_LIMITS.maxSourceNameChars &&
    !CONTROL_CHARS_RE.test(chunk.sourceName) &&
    !/[\\/]/u.test(chunk.sourceName) &&
    !/^[A-Za-z]:/u.test(chunk.sourceName) &&
    Number.isInteger(chunk.page) &&
    chunk.page >= 1 &&
    typeof chunk.text === "string" &&
    chunk.text.trim().length > 0 &&
    chunk.text.length <= RETRIEVAL_LIMITS.maxChunkChars
  );
}

interface NormalizedChunks {
  readonly chunks: readonly PageChunk[];
  readonly truncated: boolean;
}

/**
 * Drop unusable/duplicate chunks and enforce count/character bounds before any
 * tokenization happens. Ingestion is trusted app code, but a failed or partial
 * ingestion job must not be able to blow up the assistant context.
 */
function normalizeChunks(chunks: readonly PageChunk[]): NormalizedChunks {
  const limited = chunks.slice(0, RETRIEVAL_LIMITS.maxChunks);
  let truncated = chunks.length > limited.length;
  let indexedChars = 0;
  const seenIds = new Set<string>();
  const result: PageChunk[] = [];

  for (const chunk of limited) {
    if (!isUsableChunk(chunk)) {
      truncated = true;
      continue;
    }

    if (seenIds.has(chunk.id)) {
      truncated = true;
      continue;
    }

    if (indexedChars + chunk.text.length > RETRIEVAL_LIMITS.maxIndexChars) {
      truncated = true;
      break;
    }

    seenIds.add(chunk.id);
    indexedChars += chunk.text.length;
    result.push(chunk);
  }

  return { chunks: result, truncated };
}

interface IndexedChunk {
  readonly chunk: PageChunk;
  readonly order: number;
  readonly counts: ReadonlyMap<string, number>;
  readonly length: number;
  readonly foldedText: string;
}

function indexChunk(chunk: PageChunk, order: number): IndexedChunk | null {
  // Keep repeated terms for term-frequency scoring; query terms are deduped
  // separately in retrieveChunks.
  const tokens = tokenizeAll(chunk.text);
  if (tokens.length === 0) return null;

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return {
    chunk,
    order,
    counts,
    length: tokens.length,
    foldedText: foldForSearch(normalizeWhitespace(chunk.text)),
  };
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

interface ScoredChunk {
  readonly indexed: IndexedChunk;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

/**
 * Retrieve a bounded, deterministic set of page chunks for a question.
 *
 * The returned `chunks[].text` is the original chunk text, so a citation can be
 * checked against exactly the context the model was given. If no term matches,
 * `chunks` is empty; callers must report insufficient evidence rather than
 * letting the model answer from general knowledge.
 */
export function retrieveChunks(
  query: string,
  chunks: readonly PageChunk[],
  options: RetrievalOptions = {},
): RetrievalResult {
  const rawQuery =
    typeof query === "string" ? normalizeWhitespace(query) : "";
  const rawQueryChars = Array.from(rawQuery);
  const queryWasTruncated =
    rawQueryChars.length > RETRIEVAL_LIMITS.maxQueryChars;
  const normalizedQuery = rawQueryChars
    .slice(0, RETRIEVAL_LIMITS.maxQueryChars)
    .join("")
    .trim();
  const terms = tokenizeForSearch(normalizedQuery);

  const normalized = normalizeChunks(chunks);
  let truncated = normalized.truncated || queryWasTruncated;

  if (terms.length === 0) {
    return {
      query: normalizedQuery,
      terms: [],
      chunks: [],
      truncated,
    };
  }

  const docs: IndexedChunk[] = [];
  normalized.chunks.forEach((chunk, order) => {
    const indexed = indexChunk(chunk, order);
    if (!indexed) {
      truncated = true;
      return;
    }
    docs.push(indexed);
  });

  if (docs.length === 0) {
    return {
      query: normalizedQuery,
      terms,
      chunks: [],
      truncated,
    };
  }

  const termSet = new Set(terms);
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.counts.keys()) {
      if (!termSet.has(term)) continue;
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const averageLength =
    docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length;
  const foldedQuery = foldForSearch(normalizedQuery);
  const scored: ScoredChunk[] = [];

  for (const doc of docs) {
    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of terms) {
      const frequency = doc.counts.get(term) ?? 0;
      if (frequency === 0) continue;

      matchedTerms.push(term);
      const frequencyInDocs = documentFrequency.get(term) ?? 0;
      const idf = Math.log(
        1 + (docs.length - frequencyInDocs + 0.5) / (frequencyInDocs + 0.5),
      );
      const denominator =
        frequency + K1 * (1 - B + (B * doc.length) / averageLength);
      score += idf * ((frequency * (K1 + 1)) / denominator);
    }

    if (matchedTerms.length === 0) continue;

    if (
      foldedQuery.length >= 3 &&
      doc.foldedText.length > 0 &&
      doc.foldedText.includes(foldedQuery)
    ) {
      score += PHRASE_BOOST;
    }

    scored.push({
      indexed: doc,
      score: roundScore(score),
      matchedTerms,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.indexed.order !== b.indexed.order) {
      return a.indexed.order - b.indexed.order;
    }
    return a.indexed.chunk.id.localeCompare(b.indexed.chunk.id);
  });

  const topK = clampInteger(
    options.topK,
    RETRIEVAL_LIMITS.defaultTopK,
    1,
    RETRIEVAL_LIMITS.maxTopK,
  );
  const maxContextChars = clampInteger(
    options.maxContextChars,
    RETRIEVAL_LIMITS.defaultMaxContextChars,
    1,
    RETRIEVAL_LIMITS.maxContextChars,
  );

  const selected: RetrievedChunk[] = [];
  let usedChars = 0;

  for (const candidate of scored) {
    if (selected.length >= topK) {
      truncated = true;
      break;
    }

    const textLength = candidate.indexed.chunk.text.length;
    if (usedChars + textLength > maxContextChars) {
      truncated = true;
      continue;
    }

    usedChars += textLength;
    selected.push({
      ...candidate.indexed.chunk,
      score: candidate.score,
      matchedTerms: candidate.matchedTerms,
    });
  }

  return {
    query: normalizedQuery,
    terms,
    chunks: selected,
    truncated: truncated || selected.length < scored.length,
  };
}

/**
 * Build a bounded summary context by sampling page groups evenly across the
 * document. This is not a full-text summary: it deliberately trades coverage
 * for a predictable context size, and `truncated` tells the caller that some
 * pages were omitted. The model may only cite chunks returned here.
 */
export function selectSummaryChunks(
  chunks: readonly PageChunk[],
  options: SummaryOptions = {},
): SummaryRetrieval {
  const normalized = normalizeChunks(chunks);
  let truncated = normalized.truncated;
  const orderById = new Map<string, number>();

  const groups = new Map<string, PageChunk[]>();
  normalized.chunks.forEach((chunk, index) => {
    orderById.set(chunk.id, index);
    const key = `${chunk.sourceId}\u0000${chunk.page}`;
    const group = groups.get(key);
    if (group) group.push(chunk);
    else groups.set(key, [chunk]);
  });

  const allGroups = Array.from(groups.values());
  if (allGroups.length === 0) {
    return { chunks: [], truncated };
  }

  const maxPages = clampInteger(
    options.maxPages,
    RETRIEVAL_LIMITS.defaultSummaryPages,
    1,
    RETRIEVAL_LIMITS.maxSummaryPages,
  );
  const maxContextChars = clampInteger(
    options.maxContextChars,
    RETRIEVAL_LIMITS.defaultMaxContextChars,
    1,
    RETRIEVAL_LIMITS.maxContextChars,
  );

  const selectedGroupIndexes = new Set<number>();
  if (allGroups.length <= maxPages) {
    for (let i = 0; i < allGroups.length; i += 1) selectedGroupIndexes.add(i);
  } else if (maxPages === 1) {
    selectedGroupIndexes.add(0);
  } else {
    for (let i = 0; i < maxPages; i += 1) {
      const index = Math.round(
        (i * (allGroups.length - 1)) / (maxPages - 1),
      );
      selectedGroupIndexes.add(index);
    }
  }

  const selectedGroups = Array.from(selectedGroupIndexes)
    .sort((a, b) => a - b)
    .map((index) => allGroups[index] ?? []);

  const selected: RetrievedChunk[] = [];
  const selectedIds = new Set<string>();
  let usedChars = 0;

  // First pass: give every sampled page a chance to contribute one chunk, so a
  // single long page cannot consume the whole budget before later pages appear.
  for (const group of selectedGroups) {
    const chunk = group.find(
      (candidate) =>
        !selectedIds.has(candidate.id) &&
        usedChars + candidate.text.length <= maxContextChars,
    );
    if (!chunk) {
      truncated = true;
      continue;
    }

    selectedIds.add(chunk.id);
    usedChars += chunk.text.length;
    selected.push({
      ...chunk,
      score: 0,
      matchedTerms: [],
    });
  }

  // Second pass: fill the remaining budget with additional chunks from the
  // same sampled pages, in document order.
  for (const group of selectedGroups) {
    for (const chunk of group) {
      if (selectedIds.has(chunk.id)) continue;
      if (usedChars + chunk.text.length > maxContextChars) {
        truncated = true;
        continue;
      }

      selectedIds.add(chunk.id);
      usedChars += chunk.text.length;
      selected.push({
        ...chunk,
        score: 0,
        matchedTerms: [],
      });
    }
  }

  selected.sort(
    (a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0),
  );

  return {
    chunks: selected,
    truncated:
      truncated ||
      selected.length < normalized.chunks.length ||
      selectedGroupIndexes.size < allGroups.length,
  };
}
