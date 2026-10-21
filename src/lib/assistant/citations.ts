/**
 * Strict, versioned citation envelope for private-assistant answers.
 *
 * A local model may return prose only through this envelope. Every citation
 * must name a chunk that was retrieved for this request, and its quote must
 * occur in that chunk. The validator rewrites the quote to the exact source
 * span, so the UI and tests can trace a citation back to the text the model
 * actually received.
 *
 * This module is pure: no network, no filesystem and no model calls. Ingestion
 * (#86) supplies chunks; the session UI (#88) is responsible for opening a
 * citation target in the viewer.
 */

import {
  normalizeWhitespace,
  retrieveChunks,
  selectSummaryChunks,
  type PageChunk,
  type RetrievalOptions,
  type RetrievalResult,
  type RetrievedChunk,
  type SummaryOptions,
} from "./retrieval";

export const GROUNDED_ANSWER_VERSION = 1 as const;

export const GROUNDING_LIMITS = {
  maxJsonBytes: 64 * 1024,
  maxAnswerChars: 4_000,
  maxQuoteChars: 500,
  maxCitations: 8,
  maxChunkIdChars: 128,
} as const;

export type GroundedAnswerKind = "answer" | "summary" | "insufficient";
export type GroundedAnswerRequestKind = Exclude<
  GroundedAnswerKind,
  "insufficient"
>;

export interface Citation {
  /** Chunk id from ingestion, not a path. */
  readonly chunkId: string;
  /** Stable workspace/source id, e.g. `f1`. */
  readonly sourceId: string;
  /** Display name only (basename). */
  readonly sourceName: string;
  /** 1-based page number in the source PDF. */
  readonly page: number;
  /** Exact, whitespace-normalized span of the cited chunk. */
  readonly quote: string;
}

export interface GroundedAnswer {
  readonly version: typeof GROUNDED_ANSWER_VERSION;
  readonly kind: GroundedAnswerKind;
  readonly text: string;
  readonly citations: readonly Citation[];
}

/** A citation target the session UI can pass to the existing page viewer. */
export interface CitationTarget {
  readonly sourceId: string;
  readonly page: number;
}

export type GroundingIssueCode =
  | "INVALID_ANSWER"
  | "UNKNOWN_VERSION"
  | "UNKNOWN_FIELD"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "UNKNOWN_ENUM_VALUE"
  | "NO_CITATIONS"
  | "TOO_MANY_CITATIONS"
  | "CITATION_NOT_RETRIEVED"
  | "DUPLICATE_CITATION"
  | "QUOTE_NOT_FOUND"
  | "INVALID_JSON"
  | "JSON_TOO_LARGE";

export interface GroundingIssue {
  /** JSONPath-like location, e.g. `$.citations[0].quote`. */
  readonly path: string;
  readonly code: GroundingIssueCode;
  readonly message: string;
}

export type GroundingValidationResult =
  | { ok: true; answer: GroundedAnswer }
  | { ok: false; issues: GroundingIssue[] };

export interface GroundingValidationOptions {
  /**
   * Reject the other positive kind, e.g. require `summary` for a summary
   * request. An `insufficient` candidate is always accepted as an honest
   * refusal and handled by the grounding entry point.
   */
  readonly expectedKind?: GroundedAnswerRequestKind;
}

export type GroundingFailureReason =
  | "no-query"
  | "no-evidence"
  | "unverified-answer"
  | "invalid-json";

export interface GroundingFailure {
  readonly ok: false;
  readonly reason: GroundingFailureReason;
  readonly message: string;
  readonly retrieval: RetrievalResult;
  readonly issues?: readonly GroundingIssue[];
}

export type GroundingResult =
  | {
      readonly ok: true;
      readonly answer: GroundedAnswer;
      readonly retrieval: RetrievalResult;
    }
  | GroundingFailure;

export const GROUNDING_MESSAGES = {
  noQuery: "Ask a question about the selected PDF.",
  insufficientEvidence:
    "I couldn't find enough evidence in the selected PDF to answer that.",
  unverifiedAnswer:
    "The answer could not be verified against the selected PDF, so it was discarded.",
  invalidJson: "The assistant returned an invalid answer format.",
} as const;

const CONTROL_CHARS_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const CHAR_FOLD: Readonly<Record<string, string>> = {
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "−": "-",
  "ı": "i",
  "ø": "o",
  "ł": "l",
  "đ": "d",
  "ħ": "h",
};

/** Fold one code point for quote matching without changing its length. */
function foldChar(char: string): string {
  const mapped = CHAR_FOLD[char];
  if (mapped) return mapped;

  const decomposed = char.normalize("NFKD").replace(/\p{M}+/gu, "");
  const lower = decomposed.toLowerCase();
  const chars = Array.from(lower);
  return chars.length === 1 ? chars[0] : char;
}

function indexOfCodePoints(
  haystack: readonly string[],
  needle: readonly string[],
): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;

  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }

  return -1;
}

/**
 * Find a quote in a chunk, ignoring case/combining-mark differences but
 * returning the original source span (with whitespace normalized).
 */
export function findQuoteInChunk(
  chunkText: string,
  quote: string,
): string | null {
  const haystack = normalizeWhitespace(chunkText);
  const needle = normalizeWhitespace(quote);
  if (needle.length === 0) return null;

  const hayChars = Array.from(haystack);
  const needleChars = Array.from(needle);
  const foldedHaystack = hayChars.map(foldChar);
  const foldedNeedle = needleChars.map(foldChar);
  const index = indexOfCodePoints(foldedHaystack, foldedNeedle);
  if (index < 0) return null;

  return hayChars.slice(index, index + needleChars.length).join("");
}

/** Format one or more pages as `p. 3`, `pp. 3–5` or `pp. 3, 7–8`. */
export function formatPageRanges(pages: readonly number[]): string {
  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  if (sorted.length === 0) return "";

  const ranges: { start: number; end: number }[] = [];
  for (const page of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && page === last.end + 1) last.end = page;
    else ranges.push({ start: page, end: page });
  }

  if (ranges.length === 1) {
    const range = ranges[0];
    return range.start === range.end
      ? `p. ${range.start}`
      : `pp. ${range.start}–${range.end}`;
  }

  const labels = ranges.map((range) =>
    range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`,
  );
  return `pp. ${labels.join(", ")}`;
}

export type CitationLike = Pick<
  Citation,
  "sourceId" | "sourceName" | "page"
>;

/** Human-readable label for one citation, e.g. `report.pdf, p. 4`. */
export function formatCitation(citation: CitationLike): string {
  return `${citation.sourceName}, ${formatPageRanges([citation.page])}`;
}

/**
 * Format all citations for display, grouping by source and collapsing
 * consecutive pages. Duplicate pages are shown once.
 */
export function formatCitationList(
  citations: readonly CitationLike[],
): string {
  const groups = new Map<
    string,
    { sourceName: string; pages: Set<number> }
  >();

  for (const citation of citations) {
    const group = groups.get(citation.sourceId) ?? {
      sourceName: citation.sourceName,
      pages: new Set<number>(),
    };
    group.pages.add(citation.page);
    groups.set(citation.sourceId, group);
  }

  return Array.from(groups.values())
    .map(
      (group) =>
        `${group.sourceName}, ${formatPageRanges(Array.from(group.pages))}`,
    )
    .join("; ");
}

/** Map a citation to the data the existing viewer needs (no filesystem path). */
export function citationTarget(citation: CitationLike): CitationTarget {
  return { sourceId: citation.sourceId, page: citation.page };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function addIssue(
  issues: GroundingIssue[],
  path: string,
  code: GroundingIssueCode,
  message: string,
): void {
  issues.push({ path, code, message });
}

function checkObjectKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: GroundingIssue[],
): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    addIssue(issues, `${path}.${key}`, "UNKNOWN_FIELD", `Unknown field "${key}".`);
  }
}

function normalizeCitation(
  raw: unknown,
  index: number,
  retrievedChunks: readonly RetrievedChunk[],
  seenIds: Set<string>,
  issues: GroundingIssue[],
): Citation | null {
  const path = `$.citations[${index}]`;

  if (!isRecord(raw)) {
    addIssue(issues, path, "INVALID_TYPE", "Each citation must be an object.");
    return null;
  }

  checkObjectKeys(raw, ["chunkId", "quote"], path, issues);

  let chunkId: string | undefined;
  const chunkIdRaw = hasOwn(raw, "chunkId") ? raw.chunkId : undefined;
  if (typeof chunkIdRaw !== "string") {
    addIssue(issues, `${path}.chunkId`, "INVALID_TYPE", "chunkId must be a string.");
  } else {
    const trimmed = chunkIdRaw.trim();
    if (trimmed.length === 0) {
      addIssue(
        issues,
        `${path}.chunkId`,
        "INVALID_VALUE",
        "chunkId cannot be empty.",
      );
    } else if (trimmed.length > GROUNDING_LIMITS.maxChunkIdChars) {
      addIssue(
        issues,
        `${path}.chunkId`,
        "INVALID_VALUE",
        `Use at most ${GROUNDING_LIMITS.maxChunkIdChars} characters.`,
      );
    } else if (CONTROL_CHARS_RE.test(trimmed)) {
      addIssue(
        issues,
        `${path}.chunkId`,
        "INVALID_VALUE",
        "Control characters are not allowed.",
      );
    } else {
      chunkId = trimmed;
    }
  }

  let quote: string | undefined;
  const quoteRaw = hasOwn(raw, "quote") ? raw.quote : undefined;
  if (typeof quoteRaw !== "string") {
    addIssue(issues, `${path}.quote`, "INVALID_TYPE", "quote must be a string.");
  } else if (quoteRaw.length > GROUNDING_LIMITS.maxQuoteChars) {
    addIssue(
      issues,
      `${path}.quote`,
      "INVALID_VALUE",
      `Use at most ${GROUNDING_LIMITS.maxQuoteChars} characters.`,
    );
  } else if (CONTROL_CHARS_RE.test(quoteRaw)) {
    addIssue(
      issues,
      `${path}.quote`,
      "INVALID_VALUE",
      "Control characters are not allowed.",
    );
  } else {
    const normalized = normalizeWhitespace(quoteRaw);
    if (normalized.length < 2) {
      addIssue(
        issues,
        `${path}.quote`,
        "INVALID_VALUE",
        "quote must contain at least 2 characters.",
      );
    } else {
      quote = normalized;
    }
  }

  if (!chunkId || !quote) return null;

  if (seenIds.has(chunkId)) {
    addIssue(
      issues,
      `${path}.chunkId`,
      "DUPLICATE_CITATION",
      "Use one citation per chunk; combine the supporting quotes instead.",
    );
    return null;
  }
  seenIds.add(chunkId);

  const chunk = retrievedChunks.find((candidate) => candidate.id === chunkId);
  if (
    !chunk ||
    typeof chunk.text !== "string" ||
    typeof chunk.sourceId !== "string" ||
    typeof chunk.sourceName !== "string" ||
    !Number.isInteger(chunk.page) ||
    chunk.page < 1
  ) {
    addIssue(
      issues,
      `${path}.chunkId`,
      "CITATION_NOT_RETRIEVED",
      "The citation must reference a chunk retrieved for this answer.",
    );
    return null;
  }

  const sourceQuote = findQuoteInChunk(chunk.text, quote);
  if (!sourceQuote) {
    addIssue(
      issues,
      `${path}.quote`,
      "QUOTE_NOT_FOUND",
      "The quoted text does not occur in the cited chunk.",
    );
    return null;
  }

  return {
    chunkId,
    sourceId: chunk.sourceId,
    sourceName: chunk.sourceName,
    page: chunk.page,
    quote: sourceQuote,
  };
}

/**
 * Validate an already-parsed answer envelope against the chunks retrieved for
 * this request. Never throws. The returned citations contain source metadata
 * taken from ingestion, never from model output.
 */
export function validateGroundedAnswer(
  raw: unknown,
  retrievedChunks: readonly RetrievedChunk[],
  options: GroundingValidationOptions = {},
): GroundingValidationResult {
  const issues: GroundingIssue[] = [];

  if (!isRecord(raw)) {
    addIssue(
      issues,
      "$",
      "INVALID_ANSWER",
      "The answer must be a JSON object.",
    );
    return { ok: false, issues };
  }

  checkObjectKeys(raw, ["version", "kind", "text", "citations"], "$", issues);

  const version = hasOwn(raw, "version") ? raw.version : undefined;
  if (version !== GROUNDED_ANSWER_VERSION) {
    addIssue(
      issues,
      "$.version",
      "UNKNOWN_VERSION",
      `Expected answer version ${GROUNDED_ANSWER_VERSION}.`,
    );
  }

  const kindRaw = hasOwn(raw, "kind") ? raw.kind : undefined;
  if (
    kindRaw !== "answer" &&
    kindRaw !== "summary" &&
    kindRaw !== "insufficient"
  ) {
    addIssue(
      issues,
      "$.kind",
      "UNKNOWN_ENUM_VALUE",
      'Use "answer", "summary" or "insufficient".',
    );
  } else if (
    options.expectedKind &&
    kindRaw !== "insufficient" &&
    kindRaw !== options.expectedKind
  ) {
    addIssue(
      issues,
      "$.kind",
      "INVALID_VALUE",
      `Expected kind "${options.expectedKind}".`,
    );
  }

  let text: string | undefined;
  const textRaw = hasOwn(raw, "text") ? raw.text : undefined;
  if (typeof textRaw !== "string") {
    addIssue(issues, "$.text", "INVALID_TYPE", "text must be a string.");
  } else {
    const trimmed = textRaw.trim();
    if (trimmed.length === 0) {
      addIssue(
        issues,
        "$.text",
        "INVALID_VALUE",
        "text cannot be empty.",
      );
    } else if (trimmed.length > GROUNDING_LIMITS.maxAnswerChars) {
      addIssue(
        issues,
        "$.text",
        "INVALID_VALUE",
        `Use at most ${GROUNDING_LIMITS.maxAnswerChars} characters.`,
      );
    } else if (CONTROL_CHARS_RE.test(trimmed)) {
      addIssue(
        issues,
        "$.text",
        "INVALID_VALUE",
        "Control characters are not allowed.",
      );
    } else {
      text = trimmed;
    }
  }

  const citations: Citation[] = [];
  const citationsRaw = hasOwn(raw, "citations") ? raw.citations : undefined;
  const insufficient = kindRaw === "insufficient";
  if (!Array.isArray(citationsRaw)) {
    addIssue(
      issues,
      "$.citations",
      "INVALID_TYPE",
      "citations must be an array.",
    );
  } else if (insufficient) {
    if (citationsRaw.length !== 0) {
      addIssue(
        issues,
        "$.citations",
        "INVALID_VALUE",
        "An insufficient-evidence answer must not include citations.",
      );
    }
  } else if (citationsRaw.length === 0) {
    addIssue(
      issues,
      "$.citations",
      "NO_CITATIONS",
      "Every answer must cite at least one retrieved chunk.",
    );
  } else if (citationsRaw.length > GROUNDING_LIMITS.maxCitations) {
    addIssue(
      issues,
      "$.citations",
      "TOO_MANY_CITATIONS",
      `Use at most ${GROUNDING_LIMITS.maxCitations} citations.`,
    );
  } else {
    const seenIds = new Set<string>();
    citationsRaw.forEach((citationRaw, index) => {
      const citation = normalizeCitation(
        citationRaw,
        index,
        retrievedChunks,
        seenIds,
        issues,
      );
      if (citation) citations.push(citation);
    });
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    answer: {
      version: GROUNDED_ANSWER_VERSION,
      kind: kindRaw as GroundedAnswerKind,
      text: text as string,
      citations,
    },
  };
}

/**
 * Parse a model answer and validate it. Markdown fences are rejected rather
 * than stripped, so malformed output fails visibly and safely.
 */
export function parseGroundedAnswerJson(
  text: string,
  retrievedChunks: readonly RetrievedChunk[],
  options: GroundingValidationOptions = {},
): GroundingValidationResult {
  if (typeof text !== "string") {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "INVALID_JSON",
          message: "Expected a JSON string.",
        },
      ],
    };
  }

  if (
    text.length > GROUNDING_LIMITS.maxJsonBytes ||
    new TextEncoder().encode(text).byteLength > GROUNDING_LIMITS.maxJsonBytes
  ) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "JSON_TOO_LARGE",
          message: `JSON must be at most ${GROUNDING_LIMITS.maxJsonBytes} bytes.`,
        },
      ],
    };
  }

  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "INVALID_JSON",
          message: "The text is not valid JSON.",
        },
      ],
    };
  }

  return validateGroundedAnswer(parsed, retrievedChunks, options);
}

function failure(
  reason: GroundingFailureReason,
  message: string,
  retrieval: RetrievalResult,
  issues?: readonly GroundingIssue[],
): GroundingFailure {
  return issues
    ? { ok: false, reason, message, retrieval, issues }
    : { ok: false, reason, message, retrieval };
}

/**
 * Retrieve context, then validate a model candidate against exactly that
 * context. A model cannot cite a chunk that was not retrieved, and it cannot
 * quote text that is absent from the cited chunk.
 */
export function groundAnswer(
  query: string,
  chunks: readonly PageChunk[],
  candidate: unknown,
  options: RetrievalOptions = {},
): GroundingResult {
  const retrieval = retrieveChunks(query, chunks, options);

  if (retrieval.terms.length === 0) {
    return failure(
      "no-query",
      GROUNDING_MESSAGES.noQuery,
      retrieval,
    );
  }

  if (retrieval.chunks.length === 0) {
    return failure(
      "no-evidence",
      GROUNDING_MESSAGES.insufficientEvidence,
      retrieval,
    );
  }

  const validation = validateGroundedAnswer(candidate, retrieval.chunks, {
    expectedKind: "answer",
  });
  if (!validation.ok) {
    return failure(
      "unverified-answer",
      GROUNDING_MESSAGES.unverifiedAnswer,
      retrieval,
      validation.issues,
    );
  }

  if (validation.answer.kind === "insufficient") {
    return failure(
      "no-evidence",
      GROUNDING_MESSAGES.insufficientEvidence,
      retrieval,
    );
  }

  return { ok: true, answer: validation.answer, retrieval };
}

/** Parse and ground a JSON answer from the local model. */
export function groundAnswerJson(
  query: string,
  chunks: readonly PageChunk[],
  json: string,
  options: RetrievalOptions = {},
): GroundingResult {
  const retrieval = retrieveChunks(query, chunks, options);

  if (retrieval.terms.length === 0) {
    return failure(
      "no-query",
      GROUNDING_MESSAGES.noQuery,
      retrieval,
    );
  }

  if (retrieval.chunks.length === 0) {
    return failure(
      "no-evidence",
      GROUNDING_MESSAGES.insufficientEvidence,
      retrieval,
    );
  }

  const validation = parseGroundedAnswerJson(json, retrieval.chunks, {
    expectedKind: "answer",
  });
  if (!validation.ok) {
    const invalidJson = validation.issues.some(
      (issue) =>
        issue.code === "INVALID_JSON" || issue.code === "JSON_TOO_LARGE",
    );
    return failure(
      invalidJson ? "invalid-json" : "unverified-answer",
      invalidJson
        ? GROUNDING_MESSAGES.invalidJson
        : GROUNDING_MESSAGES.unverifiedAnswer,
      retrieval,
      validation.issues,
    );
  }

  if (validation.answer.kind === "insufficient") {
    return failure(
      "no-evidence",
      GROUNDING_MESSAGES.insufficientEvidence,
      retrieval,
    );
  }

  return { ok: true, answer: validation.answer, retrieval };
}

/**
 * Build a bounded summary context and validate a summary candidate against it.
 * The candidate must use `kind: "summary"` and cite only the sampled chunks.
 */
export function groundSummary(
  chunks: readonly PageChunk[],
  candidate: unknown,
  options: SummaryOptions = {},
): GroundingResult {
  const context = selectSummaryChunks(chunks, options);
  const retrieval: RetrievalResult = {
    query: "",
    terms: [],
    chunks: context.chunks,
    truncated: context.truncated,
  };

  if (context.chunks.length === 0) {
    return failure(
      "no-evidence",
      GROUNDING_MESSAGES.insufficientEvidence,
      retrieval,
    );
  }

  const validation = validateGroundedAnswer(candidate, context.chunks, {
    expectedKind: "summary",
  });
  if (!validation.ok) {
    return failure(
      "unverified-answer",
      GROUNDING_MESSAGES.unverifiedAnswer,
      retrieval,
      validation.issues,
    );
  }

  if (validation.answer.kind === "insufficient") {
    return failure(
      "no-evidence",
      GROUNDING_MESSAGES.insufficientEvidence,
      retrieval,
    );
  }

  return { ok: true, answer: validation.answer, retrieval };
}

/** Parse and ground a JSON summary from the local model. */
export function groundSummaryJson(
  chunks: readonly PageChunk[],
  json: string,
  options: SummaryOptions = {},
): GroundingResult {
  const context = selectSummaryChunks(chunks, options);
  const retrieval: RetrievalResult = {
    query: "",
    terms: [],
    chunks: context.chunks,
    truncated: context.truncated,
  };

  if (context.chunks.length === 0) {
    return failure(
      "no-evidence",
      GROUNDING_MESSAGES.insufficientEvidence,
      retrieval,
    );
  }

  const validation = parseGroundedAnswerJson(json, context.chunks, {
    expectedKind: "summary",
  });
  if (!validation.ok) {
    const invalidJson = validation.issues.some(
      (issue) =>
        issue.code === "INVALID_JSON" || issue.code === "JSON_TOO_LARGE",
    );
    return failure(
      invalidJson ? "invalid-json" : "unverified-answer",
      invalidJson
        ? GROUNDING_MESSAGES.invalidJson
        : GROUNDING_MESSAGES.unverifiedAnswer,
      retrieval,
      validation.issues,
    );
  }

  if (validation.answer.kind === "insufficient") {
    return failure(
      "no-evidence",
      GROUNDING_MESSAGES.insufficientEvidence,
      retrieval,
    );
  }

  return { ok: true, answer: validation.answer, retrieval };
}
