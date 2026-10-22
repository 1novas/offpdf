import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_LIMITS,
  normalizeWhitespace,
  retrieveChunks,
  selectSummaryChunks,
  tokenizeForSearch,
  type PageChunk,
} from "./retrieval";
import {
  GROUNDED_ANSWER_VERSION,
  GROUNDING_LIMITS,
  GROUNDING_MESSAGES,
  citationTarget,
  formatCitation,
  formatCitationList,
  formatPageRanges,
  groundAnswer,
  groundAnswerJson,
  groundSummary,
  groundSummaryJson,
  parseGroundedAnswerJson,
  validateGroundedAnswer,
} from "./citations";
import fixtureJson from "./fixtures/grounding.json";

type AnswerKind = "answer" | "summary";

interface QueryFixture {
  name: string;
  query: string;
  expectedChunkIds: string[];
}

interface ValidAnswerFixture {
  name: string;
  query: string;
  expectedKind: AnswerKind;
  expectedPages: number[];
  answer: unknown;
}

interface InvalidAnswerFixture {
  name: string;
  expectedCode: string;
  answer: unknown;
  expectedKind?: AnswerKind;
}

interface GroundingFixture {
  chunks: PageChunk[];
  queries: QueryFixture[];
  validAnswers: ValidAnswerFixture[];
  invalidAnswers: InvalidAnswerFixture[];
  summaryCandidate: unknown;
  insufficientCandidate: unknown;
}

const fixture = fixtureJson as unknown as GroundingFixture;
const chunks = fixture.chunks;
const answerFixtures = fixture.validAnswers.filter(
  (candidate) => candidate.expectedKind === "answer",
);

describe("retrieveChunks", () => {
  it.each(fixture.queries)(
    "retrieves $name",
    ({ query, expectedChunkIds }) => {
      const result = retrieveChunks(query, chunks);
      expect(result.chunks.map((chunk) => chunk.id)).toEqual(expectedChunkIds);
    },
  );

  it("is deterministic", () => {
    const first = retrieveChunks("operating costs", chunks);
    const second = retrieveChunks("operating costs", chunks);
    expect(second).toEqual(first);
  });

  it("counts repeated document terms while deduplicating query terms", () => {
    const once: PageChunk = {
      ...chunks[0],
      id: "once",
      text: "revenue alpha beta gamma delta epsilon",
    };
    const repeated: PageChunk = {
      ...chunks[0],
      id: "repeated",
      text: "revenue revenue revenue revenue alpha beta",
    };

    expect(tokenizeForSearch("revenue revenue")).toEqual(["revenue"]);

    const result = retrieveChunks("revenue", [once, repeated], { topK: 2 });
    expect(result.chunks.map((chunk) => chunk.id)).toEqual([
      "repeated",
      "once",
    ]);

    const repeatedScore =
      result.chunks.find((chunk) => chunk.id === "repeated")?.score ?? 0;
    const onceScore =
      result.chunks.find((chunk) => chunk.id === "once")?.score ?? 0;
    expect(repeatedScore).toBeGreaterThan(onceScore);
  });

  it("respects the topK and context budgets", () => {
    const top = retrieveChunks("revenue", chunks, { topK: 1 });
    expect(top.chunks).toHaveLength(1);

    const noRoom = retrieveChunks("revenue", chunks, { maxContextChars: 1 });
    expect(noRoom.chunks).toHaveLength(0);
    expect(noRoom.truncated).toBe(true);
  });

  it("ignores duplicate ids, invalid chunks and oversized chunks", () => {
    const duplicate = { ...chunks[0], text: "Revenue appears twice." };
    const invalidPage = { ...chunks[0], id: "bad-page", page: 0 };
    const pathName = {
      ...chunks[0],
      id: "bad-name",
      sourceName: "C:\\secret\\annual-report.pdf",
    };
    const oversized = {
      ...chunks[0],
      id: "oversized",
      text: "Revenue ".repeat(RETRIEVAL_LIMITS.maxChunkChars),
    };

    const result = retrieveChunks("revenue", [
      chunks[0],
      duplicate,
      invalidPage,
      pathName,
      oversized,
    ]);

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["c1"]);
    expect(result.truncated).toBe(true);
  });

  it("returns no terms for a blank query", () => {
    const result = retrieveChunks("   ", chunks);
    expect(result.terms).toEqual([]);
    expect(result.chunks).toEqual([]);
  });

  it("tokenizes supported scripts", () => {
    const terms = tokenizeForSearch(
      "Facturación İstanbul 合同金额 المجموع",
    );
    expect(terms).toContain("facturacion");
    expect(terms).toContain("istanbul");
    expect(terms).toContain("合同");
    expect(terms).toContain("金额");
    expect(terms).toContain("المجموع");
  });

  it("breaks ties by source order", () => {
    const first = { ...chunks[0], id: "tie-a", text: "Revenue is stable." };
    const second = { ...chunks[0], id: "tie-b", text: "Revenue is stable." };
    const result = retrieveChunks("revenue", [first, second]);
    expect(result.chunks.map((chunk) => chunk.id)).toEqual([
      "tie-a",
      "tie-b",
    ]);
  });
});

describe("groundAnswer", () => {
  it.each(answerFixtures)("grounds $name", (candidate) => {
    const result = groundAnswer(candidate.query, chunks, candidate.answer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.answer.version).toBe(GROUNDED_ANSWER_VERSION);
    expect(result.answer.kind).toBe("answer");
    expect(result.answer.citations.map((citation) => citation.page)).toEqual(
      candidate.expectedPages,
    );

    for (const citation of result.answer.citations) {
      const chunk = chunks.find((candidateChunk) => candidateChunk.id === citation.chunkId);
      if (!chunk) throw new Error(`Missing fixture chunk ${citation.chunkId}`);
      expect(normalizeWhitespace(chunk.text)).toContain(citation.quote);
    }
  });

  it("returns the source text for a diacritic-insensitive quote", () => {
    const candidate = answerFixtures.find((item) =>
      item.name.includes("diacritic"),
    );
    if (!candidate) throw new Error("Missing diacritic fixture");

    const result = groundAnswer(candidate.query, chunks, candidate.answer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.answer.citations[0]?.quote).toBe(
      "La facturación anual fue de 42.000 euros",
    );
  });

  it.each(fixture.invalidAnswers)(
    "rejects invalid answer: $name",
    (candidate) => {
      const retrieval = retrieveChunks("revenue", chunks);
      const result = validateGroundedAnswer(
        candidate.answer,
        retrieval.chunks,
        candidate.expectedKind
          ? { expectedKind: candidate.expectedKind }
          : {},
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.map((issue) => issue.code)).toContain(
        candidate.expectedCode,
      );
    },
  );

  it("rejects control characters in answer text", () => {
    const retrieval = retrieveChunks("revenue", chunks);
    const result = validateGroundedAnswer(
      {
        version: 1,
        kind: "answer",
        text: "Revenue\u0000 was 4.2 million euros.",
        citations: [
          {
            chunkId: "c1",
            quote: "Revenue was 4.2 million euros.",
          },
        ],
      },
      retrieval.chunks,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        "INVALID_VALUE",
      );
    }
  });

  it("rejects a quote over the limit", () => {
    const retrieval = retrieveChunks("revenue", chunks);
    const result = validateGroundedAnswer(
      {
        version: 1,
        kind: "answer",
        text: "Revenue was 4.2 million euros.",
        citations: [
          {
            chunkId: "c1",
            quote: "x".repeat(GROUNDING_LIMITS.maxQuoteChars + 1),
          },
        ],
      },
      retrieval.chunks,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        "INVALID_VALUE",
      );
    }
  });

  it("returns honest failures for no query, no evidence and unverified answers", () => {
    const blank = groundAnswer("   ", chunks, fixture.validAnswers[0]?.answer);
    expect(blank.ok).toBe(false);
    if (!blank.ok) {
      expect(blank.reason).toBe("no-query");
      expect(blank.message).toBe(GROUNDING_MESSAGES.noQuery);
    }

    const noEvidence = groundAnswer(
      "volcano",
      chunks,
      fixture.validAnswers[0]?.answer,
    );
    expect(noEvidence.ok).toBe(false);
    if (!noEvidence.ok) {
      expect(noEvidence.reason).toBe("no-evidence");
      expect(noEvidence.message).toBe(
        GROUNDING_MESSAGES.insufficientEvidence,
      );
    }

    const quoteNotFound = fixture.invalidAnswers.find(
      (candidate) => candidate.expectedCode === "QUOTE_NOT_FOUND",
    );
    if (!quoteNotFound) throw new Error("Missing quote-not-found fixture");

    const unverified = groundAnswer(
      "revenue",
      chunks,
      quoteNotFound.answer,
    );
    expect(unverified.ok).toBe(false);
    if (!unverified.ok) {
      expect(unverified.reason).toBe("unverified-answer");
      expect(unverified.issues?.map((issue) => issue.code)).toContain(
        "QUOTE_NOT_FOUND",
      );
    }
  });

  it("rejects a summary candidate for a question", () => {
    const result = groundAnswer(
      "revenue",
      chunks,
      fixture.summaryCandidate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues?.map((issue) => issue.code)).toContain(
        "INVALID_VALUE",
      );
    }
  });

  it("accepts an explicit insufficient candidate and reports no evidence", () => {
    const retrieval = retrieveChunks("revenue", chunks);
    const validation = validateGroundedAnswer(
      fixture.insufficientCandidate,
      retrieval.chunks,
    );
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.answer.kind).toBe("insufficient");
      expect(validation.answer.citations).toEqual([]);
    }

    const result = groundAnswer(
      "revenue",
      chunks,
      fixture.insufficientCandidate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-evidence");
      expect(result.message).toBe(
        GROUNDING_MESSAGES.insufficientEvidence,
      );
    }
  });
});

describe("JSON parsing", () => {
  const validAnswer = fixture.validAnswers[0]?.answer;
  if (validAnswer === undefined) throw new Error("Missing valid answer fixture");

  it("parses valid JSON with an optional BOM", () => {
    const retrieval = retrieveChunks("revenue", chunks);
    const raw = JSON.stringify(validAnswer);

    expect(parseGroundedAnswerJson(raw, retrieval.chunks).ok).toBe(true);
    expect(
      parseGroundedAnswerJson(`\uFEFF${raw}`, retrieval.chunks).ok,
    ).toBe(true);
  });

  it("rejects markdown fences", () => {
    const retrieval = retrieveChunks("revenue", chunks);
    const result = parseGroundedAnswerJson(
      `\`\`\`json\n${JSON.stringify(validAnswer)}\n\`\`\``,
      retrieval.chunks,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("INVALID_JSON");
    }
  });

  it("rejects JSON over the byte limit", () => {
    const result = parseGroundedAnswerJson(
      "x".repeat(GROUNDING_LIMITS.maxJsonBytes + 1),
      [],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("JSON_TOO_LARGE");
    }
  });

  it("grounds a JSON answer", () => {
    const result = groundAnswerJson(
      "revenue",
      chunks,
      JSON.stringify(validAnswer),
    );
    expect(result.ok).toBe(true);
  });

  it("reports invalid JSON from groundAnswerJson", () => {
    const result = groundAnswerJson("revenue", chunks, "not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-json");
    }
  });
});

describe("summary grounding", () => {
  it("grounds a summary with sampled context", () => {
    const result = groundSummary(chunks, fixture.summaryCandidate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.answer.kind).toBe("summary");
    expect(result.answer.citations.map((citation) => citation.page)).toEqual([
      1, 2,
    ]);
    expect(result.retrieval.chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("samples page groups evenly and reports truncation", () => {
    const context = selectSummaryChunks(chunks, { maxPages: 3 });
    expect(context.chunks.map((chunk) => chunk.page)).toEqual([1, 5, 8]);
    expect(context.truncated).toBe(true);
  });

  it("covers each sampled page before filling extra chunks", () => {
    const makeChunk = (id: string, page: number): PageChunk => ({
      id,
      sourceId: "f1",
      sourceName: "long.pdf",
      page,
      text: "revenue ".repeat(750),
    });

    const context = selectSummaryChunks(
      [makeChunk("a", 1), makeChunk("b", 1), makeChunk("c", 2)],
      { maxPages: 2, maxContextChars: 12_000 },
    );

    expect(context.chunks.map((chunk) => chunk.id)).toEqual(["a", "c"]);
    expect(context.truncated).toBe(true);
  });

  it("rejects a citation outside the sampled context", () => {
    const result = groundSummary(chunks, fixture.summaryCandidate, {
      maxPages: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unverified-answer");
      expect(result.issues?.map((issue) => issue.code)).toContain(
        "CITATION_NOT_RETRIEVED",
      );
    }
  });

  it("rejects an answer candidate for a summary", () => {
    const result = groundSummary(
      chunks,
      fixture.validAnswers[0]?.answer,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues?.map((issue) => issue.code)).toContain(
        "INVALID_VALUE",
      );
    }
  });

  it("returns no evidence for an empty document", () => {
    const result = groundSummary([], fixture.summaryCandidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-evidence");
    }
  });

  it("accepts an explicit insufficient summary candidate", () => {
    const result = groundSummary(chunks, fixture.insufficientCandidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-evidence");
      expect(result.message).toBe(
        GROUNDING_MESSAGES.insufficientEvidence,
      );
    }
  });

  it("parses and grounds summary JSON", () => {
    const result = groundSummaryJson(
      chunks,
      JSON.stringify(fixture.summaryCandidate),
    );
    expect(result.ok).toBe(true);
  });
});

describe("citation formatting", () => {
  it("formats page ranges", () => {
    expect(formatPageRanges([])).toBe("");
    expect(formatPageRanges([3])).toBe("p. 3");
    expect(formatPageRanges([5, 3, 4, 4])).toBe("pp. 3–5");
    expect(formatPageRanges([3, 5, 6])).toBe("pp. 3, 5–6");
  });

  it("formats one citation", () => {
    expect(
      formatCitation({
        sourceId: "f1",
        sourceName: "annual-report.pdf",
        page: 4,
      }),
    ).toBe("annual-report.pdf, p. 4");
  });

  it("groups and deduplicates citations", () => {
    const citations = [
      { sourceId: "f1", sourceName: "annual-report.pdf", page: 2 },
      { sourceId: "f1", sourceName: "annual-report.pdf", page: 1 },
      { sourceId: "f2", sourceName: "nota-fiscal.pdf", page: 4 },
      { sourceId: "f2", sourceName: "nota-fiscal.pdf", page: 3 },
      { sourceId: "f2", sourceName: "nota-fiscal.pdf", page: 3 },
    ];

    expect(formatCitationList(citations)).toBe(
      "annual-report.pdf, pp. 1–2; nota-fiscal.pdf, pp. 3–4",
    );
  });

  it("maps a citation to a viewer target", () => {
    expect(
      citationTarget({
        sourceId: "f2",
        sourceName: "nota-fiscal.pdf",
        page: 3,
      }),
    ).toEqual({ sourceId: "f2", page: 3 });
  });
});
