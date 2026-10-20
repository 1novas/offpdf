import { describe, expect, it } from "vitest";
import { TOOLS } from "../tools";
import { TOOL_DEFAULTS } from "../toolDefaults";
import {
  ACTION_PLAN_LIMITS,
  ACTION_PLAN_VERSION,
  SUPPORTED_TOOL_IDS,
  UNSUPPORTED_TOOL_REASONS,
  isAction,
  parseActionPlanJson,
  secretFieldsFor,
  validateActionPlan,
  type ActionPlan,
  type PlanValidationContext,
} from "./actionPlan";
import invalidFixtures from "./fixtures/invalid.json";
import validFixtures from "./fixtures/valid.json";

interface InvalidFixture {
  name: string;
  expectedCode: string;
  plan: unknown;
  context?: PlanValidationContext;
}

const validPlans = validFixtures as unknown[];
const invalidPlans = invalidFixtures as InvalidFixture[];

function firstPlan(plan: unknown): ActionPlan {
  const result = validateActionPlan(plan);
  if (!result.ok) {
    throw new Error(`Expected a valid plan, got: ${JSON.stringify(result.issues)}`);
  }
  return result.plan;
}

describe("validateActionPlan", () => {
  it.each(validPlans.map((plan, index) => ({ index, plan })))(
    "accepts valid fixture $index",
    ({ plan }) => {
      expect(validateActionPlan(plan).ok).toBe(true);
    },
  );

  it.each(invalidPlans)(
    "rejects invalid fixture: $name",
    (fixture) => {
      const result = validateActionPlan(fixture.plan, fixture.context);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      const codes = result.issues.map((issue) => issue.code);
      expect(codes, JSON.stringify(result.issues)).toContain(fixture.expectedCode);
    },
  );

  it("covers every supported tool in the valid fixtures", () => {
    const seen = new Set<string>();

    for (const plan of validPlans) {
      const result = validateActionPlan(plan);
      if (!result.ok) continue;
      for (const action of result.plan.actions) seen.add(action.tool);
    }

    expect([...seen].sort()).toEqual([...SUPPORTED_TOOL_IDS].sort());
  });

  it("rejects unknown and unsupported tools with distinct codes", () => {
    const unknown = validateActionPlan({
      version: 1,
      actions: [{ tool: "runShell", inputs: [1] }],
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues[0]?.code).toBe("UNKNOWN_TOOL");

    const unsupported = validateActionPlan({
      version: 1,
      actions: [{ tool: "compare", inputs: [1] }],
    });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) {
      expect(unsupported.issues[0]?.code).toBe("UNSUPPORTED_TOOL");
      expect(unsupported.issues[0]?.message).toBe(UNSUPPORTED_TOOL_REASONS.compare);
    }

    const office = validateActionPlan({
      version: 1,
      actions: [{ tool: "officeToPdf", inputs: [1] }],
    });
    expect(office.ok).toBe(false);
    if (!office.ok) {
      expect(office.issues[0]?.code).toBe("UNSUPPORTED_TOOL");
      expect(office.issues[0]?.message).toBe(UNSUPPORTED_TOOL_REASONS.officeToPdf);
    }
  });

  it("rejects unknown fields at every level", () => {
    const cases: unknown[] = [
      {
        version: 1,
        actions: [{ tool: "repair", inputs: [1] }],
        cwd: "C:\\",
      },
      {
        version: 1,
        actions: [{ tool: "repair", inputs: [1], shell: true }],
      },
      {
        version: 1,
        actions: [{ tool: "repair", inputs: [1], options: { outputPath: "x" } }],
      },
      {
        version: 1,
        actions: [
          {
            tool: "metadata",
            inputs: [1],
            options: { fields: { title: "x", path: "/etc/passwd" } },
          },
        ],
      },
    ];

    for (const plan of cases) {
      const result = validateActionPlan(plan);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((issue) => issue.code)).toContain("UNKNOWN_FIELD");
      }
    }
  });

  it("never accepts passwords from the model", () => {
    for (const plan of [
      {
        version: 1,
        actions: [{ tool: "protect", inputs: [1], password: "hunter2" }],
      },
      {
        version: 1,
        actions: [
          { tool: "unlock", inputs: [1], options: { password: "hunter2" } },
        ],
      },
      {
        version: 1,
        actions: [
          { tool: "protect", inputs: [1], options: { ownerPassword: "hunter2" } },
        ],
      },
    ]) {
      const result = validateActionPlan(plan);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((issue) => issue.code)).toContain("SECRET_IN_PLAN");
      }
    }

    expect(secretFieldsFor("protect")).toEqual(["password"]);
    expect(secretFieldsFor("unlock")).toEqual(["password"]);
    expect(secretFieldsFor("repair")).toEqual([]);
  });

  it("rejects unknown enum values instead of coercing them", () => {
    const result = validateActionPlan({
      version: 1,
      actions: [
        {
          tool: "images",
          inputs: [1],
          options: { format: "gif", dpi: 200 },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.issues.map((issue) => issue.code);
      expect(codes).toContain("UNKNOWN_ENUM_VALUE");
      expect(codes.filter((code) => code === "UNKNOWN_ENUM_VALUE")).toHaveLength(2);
    }
  });

  it("enforces input count, uniqueness and workspace bounds", () => {
    const tooFew = validateActionPlan({
      version: 1,
      actions: [{ tool: "merge", inputs: [1] }],
    });
    expect(tooFew.ok).toBe(false);

    const duplicate = validateActionPlan({
      version: 1,
      actions: [{ tool: "merge", inputs: [1, 1] }],
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.issues.map((issue) => issue.code)).toContain("DUPLICATE_INPUT");
    }

    const outside = validateActionPlan(
      { version: 1, actions: [{ tool: "repair", inputs: [3] }] },
      { fileCount: 2 },
    );
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.issues.map((issue) => issue.code)).toContain("INPUT_OUT_OF_RANGE");
    }
  });

  it("enforces page bounds when page counts are known", () => {
    const result = validateActionPlan(
      {
        version: 1,
        actions: [
          {
            tool: "stamp",
            inputs: [1, 2],
            options: { text: "OK", page: 6 },
          },
        ],
      },
      { pageCounts: [3, 2] },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("PAGE_OUT_OF_RANGE");
    }
  });

  it("skips page bounds when a page count is unknown", () => {
    const result = validateActionPlan(
      {
        version: 1,
        actions: [
          {
            tool: "stamp",
            inputs: [1, 2],
            options: { text: "OK", page: 99 },
          },
        ],
      },
      { pageCounts: [3, null] },
    );

    expect(result.ok).toBe(true);
  });

  it("applies the shared tool defaults", () => {
    const merge = firstPlan({
      version: 1,
      actions: [{ tool: "merge", inputs: [1, 2] }],
    });
    expect(merge.actions[0]?.outputName).toBe(TOOL_DEFAULTS.merge.outputName);

    const split = firstPlan({
      version: 1,
      actions: [{ tool: "split", inputs: [1] }],
    });
    expect(split.actions[0]?.options).toEqual({
      mode: "everyN",
      everyN: TOOL_DEFAULTS.split.everyN,
    });

    const pageNumbers = firstPlan({
      version: 1,
      actions: [{ tool: "pageNumbers", inputs: [1] }],
    });
    expect(pageNumbers.actions[0]?.options).toEqual({
      position: TOOL_DEFAULTS.pageNumbers.position,
      start: TOOL_DEFAULTS.pageNumbers.start,
      format: TOOL_DEFAULTS.pageNumbers.format,
      prefix: TOOL_DEFAULTS.pageNumbers.prefix,
      padWidth: TOOL_DEFAULTS.pageNumbers.padWidth,
    });
    expect(pageNumbers.actions[0]?.outputName).toBe(
      TOOL_DEFAULTS.pageNumbers.outputName,
    );

    const watermark = firstPlan({
      version: 1,
      actions: [
        {
          tool: "watermark",
          inputs: [1],
          options: { text: "DRAFT" },
        },
      ],
    });
    expect(watermark.actions[0]?.options).toEqual({
      text: "DRAFT",
      opacity: TOOL_DEFAULTS.watermark.opacity,
    });

    const stamp = firstPlan({
      version: 1,
      actions: [
        {
          tool: "stamp",
          inputs: [1],
          options: { text: "OK" },
        },
      ],
    });
    expect(stamp.actions[0]?.options).toEqual({
      text: "OK",
      page: TOOL_DEFAULTS.stamp.page,
      anchor: TOOL_DEFAULTS.stamp.anchor,
      color: TOOL_DEFAULTS.stamp.color,
      size: TOOL_DEFAULTS.stamp.size,
    });

    const crop = firstPlan({
      version: 1,
      actions: [{ tool: "crop", inputs: [1] }],
    });
    expect(crop.actions[0]?.options).toEqual({
      left: TOOL_DEFAULTS.crop.left,
      top: TOOL_DEFAULTS.crop.top,
      right: TOOL_DEFAULTS.crop.right,
      bottom: TOOL_DEFAULTS.crop.bottom,
    });

    const compress = firstPlan({
      version: 1,
      actions: [{ tool: "compress", inputs: [1] }],
    });
    expect(compress.actions[0]?.options).toEqual({
      mode: "target",
      targetMb: TOOL_DEFAULTS.compress.targetMb,
    });
    expect(compress.actions[0]?.outputName).toBe(
      TOOL_DEFAULTS.compress.outputName,
    );

    const keepText = firstPlan({
      version: 1,
      actions: [
        {
          tool: "compress",
          inputs: [1],
          options: { mode: "keepText" },
        },
      ],
    });
    expect(keepText.actions[0]?.outputName).toBe(
      TOOL_DEFAULTS.compress.optimizedOutputName,
    );

    const images = firstPlan({
      version: 1,
      actions: [{ tool: "images", inputs: [1] }],
    });
    expect(images.actions[0]?.options).toEqual({
      format: TOOL_DEFAULTS.images.format,
      dpi: TOOL_DEFAULTS.images.dpi,
    });

    const textExport = firstPlan({
      version: 1,
      actions: [{ tool: "textExport", inputs: [1] }],
    });
    expect(textExport.actions[0]?.options).toEqual({ scope: "all" });
    expect(textExport.actions[0]?.outputName).toBe(
      TOOL_DEFAULTS.textExport.outputName,
    );

    const nup = firstPlan({
      version: 1,
      actions: [{ tool: "nup", inputs: [1] }],
    });
    expect(nup.actions[0]?.options).toEqual({
      mode: TOOL_DEFAULTS.nup.mode,
      paper: TOOL_DEFAULTS.nup.paper,
      orientation: TOOL_DEFAULTS.nup.orientation,
    });

    const poster = firstPlan({
      version: 1,
      actions: [{ tool: "poster", inputs: [1] }],
    });
    expect(poster.actions[0]?.options).toEqual({
      page: TOOL_DEFAULTS.poster.page,
      paper: TOOL_DEFAULTS.poster.paper,
      orientation: TOOL_DEFAULTS.poster.orientation,
      overlapMm: TOOL_DEFAULTS.poster.overlapMm,
      marks: TOOL_DEFAULTS.poster.marks,
    });

    const pptx = firstPlan({
      version: 1,
      actions: [
        {
          tool: "pdfToOffice",
          inputs: [1],
          options: { format: "pptx" },
        },
      ],
    });
    expect(pptx.actions[0]?.outputName).toBe(
      TOOL_DEFAULTS.pdfToOffice.pptxOutputName,
    );
  });

  it("normalizes output names and rejects paths", () => {
    const withoutExtension = firstPlan({
      version: 1,
      actions: [{ tool: "repair", inputs: [1], outputName: "report" }],
    });
    expect(withoutExtension.actions[0]?.outputName).toBe("report.pdf");

    const traversal = validateActionPlan({
      version: 1,
      actions: [{ tool: "repair", inputs: [1], outputName: "../../etc/passwd" }],
    });
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) {
      expect(traversal.issues.map((issue) => issue.code)).toContain(
        "INVALID_OUTPUT_NAME",
      );
    }

    const empty = validateActionPlan({
      version: 1,
      actions: [{ tool: "repair", inputs: [1], outputName: "" }],
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.issues.map((issue) => issue.code)).toContain(
        "INVALID_OUTPUT_NAME",
      );
    }

    const wrongExtension = validateActionPlan({
      version: 1,
      actions: [
        {
          tool: "textExport",
          inputs: [1],
          outputName: "notes.pdf",
        },
      ],
    });
    expect(wrongExtension.ok).toBe(false);
    if (!wrongExtension.ok) {
      expect(wrongExtension.issues.map((issue) => issue.code)).toContain(
        "INVALID_OUTPUT_NAME",
      );
    }

    const multi = validateActionPlan({
      version: 1,
      actions: [
        {
          tool: "split",
          inputs: [1],
          outputName: "pieces.pdf",
        },
      ],
    });
    expect(multi.ok).toBe(false);
    if (!multi.ok) {
      expect(multi.issues.map((issue) => issue.code)).toContain("INVALID_VALUE");
    }
  });

  it("rejects a page that is removed and then rotated", () => {
    const result = validateActionPlan(
      {
        version: 1,
        actions: [
          {
            tool: "reorder",
            inputs: [1],
            options: {
              remove: [2],
              rotate: [{ pages: [2], angle: 90 }],
            },
          },
        ],
      },
      { pageCounts: [3] },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("INVALID_VALUE");
    }
  });

  it("rejects an output name used twice in the same plan", () => {
    const result = validateActionPlan({
      version: 1,
      actions: [
        {
          tool: "merge",
          inputs: [1, 2],
          outputName: "same.pdf",
        },
        {
          tool: "merge",
          inputs: [1, 2],
          outputName: "SAME.PDF",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        "DUPLICATE_OUTPUT_NAME",
      );
    }
  });

  it("enforces action, input, page and JSON limits", () => {
    const tooManyInputs = validateActionPlan({
      version: 1,
      actions: [
        {
          tool: "split",
          inputs: Array.from({ length: 51 }, (_, index) => index + 1),
        },
      ],
    });
    expect(tooManyInputs.ok).toBe(false);
    if (!tooManyInputs.ok) {
      expect(tooManyInputs.issues.map((issue) => issue.code)).toContain(
        "TOO_MANY_INPUTS",
      );
    }

    const tooManyPages = validateActionPlan({
      version: 1,
      actions: [
        {
          tool: "reorder",
          inputs: [1],
          options: {
            order: Array.from(
              { length: ACTION_PLAN_LIMITS.maxPagesPerList + 1 },
              (_, index) => index + 1,
            ),
          },
        },
      ],
    });
    expect(tooManyPages.ok).toBe(false);

    const tooLarge = parseActionPlanJson(
      `{"version":1,"actions":[],"padding":"${"x".repeat(
        ACTION_PLAN_LIMITS.maxJsonLength,
      )}"}`,
    );
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.issues[0]?.code).toBe("JSON_TOO_LARGE");

    const multibyte = parseActionPlanJson(
      `"${"é".repeat(ACTION_PLAN_LIMITS.maxJsonLength / 2 + 1)}"`,
    );
    expect(multibyte.ok).toBe(false);
    if (!multibyte.ok) expect(multibyte.issues[0]?.code).toBe("JSON_TOO_LARGE");
  });

  it("does not throw on arbitrary values", () => {
    const values: unknown[] = [
      null,
      undefined,
      true,
      42,
      "not a plan",
      [],
      {},
      { version: 1 },
      { version: 1, actions: null },
      { version: 1, actions: [null, 1, "x"] },
    ];

    for (const value of values) {
      expect(() => validateActionPlan(value)).not.toThrow();
      expect(validateActionPlan(value).ok).toBe(false);
    }

    const inherited = Object.create({
      version: 1,
      actions: [{ tool: "repair", inputs: [1] }],
    });
    expect(validateActionPlan(inherited).ok).toBe(false);
  });

  it("validates OCR languages against the installed set", () => {
    const result = validateActionPlan(
      {
        version: 1,
        actions: [
          {
            tool: "ocr",
            inputs: [1],
            options: { languages: ["eng", "tur"] },
          },
        ],
      },
      { installedOcrLanguages: ["eng"] },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        "UNKNOWN_ENUM_VALUE",
      );
    }
  });
});

describe("parseActionPlanJson", () => {
  const plan = JSON.stringify(validPlans[0]);

  it("parses valid JSON", () => {
    const result = parseActionPlanJson(plan);
    expect(result.ok).toBe(true);
  });

  it("accepts a UTF-8 BOM", () => {
    const result = parseActionPlanJson(`\uFEFF${plan}`);
    expect(result.ok).toBe(true);
  });

  it("rejects syntax errors and markdown fences", () => {
    for (const text of ["{", "```json\n{}\n```", ""]) {
      const result = parseActionPlanJson(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]?.code).toBe("INVALID_JSON");
    }
  });

  it("rejects non-string input", () => {
    const result = parseActionPlanJson(null as unknown as string);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("INVALID_JSON");
  });
});

describe("schema coverage", () => {
  it("maps every registry tool to a supported or explicitly unsupported action", () => {
    for (const tool of TOOLS) {
      const supported = (SUPPORTED_TOOL_IDS as readonly string[]).includes(
        tool.id,
      );
      const unsupported = Object.prototype.hasOwnProperty.call(
        UNSUPPORTED_TOOL_REASONS,
        tool.id,
      );
      expect(supported || unsupported, `${tool.id} is not classified`).toBe(
        true,
      );
    }
  });

  it("uses the documented version", () => {
    expect(ACTION_PLAN_VERSION).toBe(1);
  });

  it("narrows a validated action with isAction", () => {
    const plan = firstPlan({
      version: 1,
      actions: [
        {
          tool: "pageNumbers",
          inputs: [1],
          options: { format: "plain" },
        },
      ],
    });
    const action = plan.actions[0];
    expect(action).toBeDefined();
    if (!action) return;

    expect(isAction(action, "pageNumbers")).toBe(true);
    if (isAction(action, "pageNumbers")) {
      expect(action.options.format).toBe("plain");
    }
  });
});
