/**
 * Strict, versioned action-plan schema for the private local assistant.
 *
 * A plan is the *only* thing a local model may propose. It contains no shell
 * commands, no executables, no filesystem paths and no secrets: inputs are
 * 1-based indexes into the workspace snapshot shown to the model, and an output
 * name is a file name (never a directory). The schema is validated with plain
 * TypeScript, without loading a model or calling the backend.
 *
 * Validation is intentionally closed: unknown tools, fields and enum values are
 * rejected, so a prompt-injected or hallucinated plan cannot silently gain new
 * capabilities.
 */

import { PAPERS, type Orientation, type PaperId } from "../paper";
import type { RotationAngle, ToolId } from "../types";
import { validateFileName } from "../validation";
import {
  COMPRESS_MODES,
  IMAGE_DPI_VALUES,
  IMAGE_FORMATS,
  NUP_MODES,
  ORIENTATION_VALUES,
  PAGE_NUMBER_FORMATS,
  PAGE_NUMBER_POSITIONS,
  PDF_TO_OFFICE_FORMATS,
  STAMP_ANCHORS,
  STAMP_COLORS,
  STAMP_SIZES,
  TEXT_EXPORT_SCOPES,
  TOOL_DEFAULTS,
  type ImageDpi,
  type ImageFormat,
  type NupMode,
  type PageNumberFormat,
  type PageNumberPosition,
  type PdfToOfficeFormat,
  type StampAnchor,
  type StampColor,
  type StampSize,
} from "../toolDefaults";

export const ACTION_PLAN_VERSION = 1 as const;

export const ACTION_PLAN_LIMITS = {
  /** A single request should stay reviewable in the confirmation UI. */
  maxActions: 8,
  maxInputs: 50,
  maxPagesPerList: 5000,
  maxPageRanges: 100,
  maxRotations: 100,
  maxTextLength: 500,
  maxPrefixLength: 64,
  maxJsonLength: 64 * 1024,
  maxPageIndex: 1_000_000,
} as const;

// ---------------------------------------------------------------------------
// Supported action vocabulary
// ---------------------------------------------------------------------------

export const SUPPORTED_TOOL_IDS = [
  "merge",
  "split",
  "reorder",
  "pageNumbers",
  "watermark",
  "crop",
  "stamp",
  "compress",
  "images",
  "repair",
  "protect",
  "unlock",
  "ocr",
  "pdfa",
  "pdfToOffice",
  "textExport",
  "nup",
  "poster",
  "metadata",
] as const satisfies readonly ToolId[];

export type SupportedToolId = (typeof SUPPORTED_TOOL_IDS)[number];

/**
 * Tools that exist in the app but are deliberately not planned automatically.
 * The values explain why, so the rejection is useful instead of a dead end.
 */
export const UNSUPPORTED_TOOL_REASONS = {
  editPdf: "Editing is interactive (text, shapes, forms); use the Edit PDF tool directly.",
  compare: "Comparison is read-only and does not produce an output file.",
  blankPages: "Blank-page detection needs a visual review step before anything is removed.",
  delete: 'Use the reorder action with options.remove instead.',
  extract: 'Use the reorder action with options.order instead.',
  rotate: 'Use the reorder action with options.rotate instead.',
  optimize: 'Use compress with options.mode = "keepText" instead.',
  officeToPdf: "The PDF workspace does not retain original Office files; use the Office to PDF tool directly.",
} as const satisfies Partial<Record<ToolId, string>>;

export type UnsupportedToolId = keyof typeof UNSUPPORTED_TOOL_REASONS;

export function isSupportedTool(value: string): value is SupportedToolId {
  return (SUPPORTED_TOOL_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Plan types (the normalized result of validation)
// ---------------------------------------------------------------------------

export type EmptyOptions = Record<string, never>;

export interface PageRange {
  start: number;
  end: number;
}

export interface RotationSpec {
  pages: number[];
  angle: RotationAngle;
}

export interface SplitEveryNOptions {
  mode: "everyN";
  everyN: number;
}

export interface SplitRangesOptions {
  mode: "ranges";
  ranges: PageRange[];
}

export type SplitOptions = SplitEveryNOptions | SplitRangesOptions;

export interface ReorderOptions {
  /** Exact output order, or null to keep every page except `remove`. */
  order: number[] | null;
  remove: number[];
  rotate: RotationSpec[];
}

export interface PageNumbersOptions {
  position: PageNumberPosition;
  start: number;
  format: PageNumberFormat;
  prefix: string;
  padWidth: number;
}

export interface WatermarkOptions {
  text: string;
  opacity: number;
}

export interface CropOptions {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface StampOptions {
  text: string;
  page: number;
  anchor: StampAnchor;
  color: StampColor;
  size: StampSize;
}

export type CompressOptions =
  | { mode: "target"; targetMb: number }
  | { mode: "keepText" };

export interface ImagesOptions {
  format: ImageFormat;
  dpi: ImageDpi;
}

export interface OcrOptions {
  languages: string[];
}

export interface PdfToOfficeOptions {
  format: PdfToOfficeFormat;
}

export type TextExportOptions =
  | { scope: "all" }
  | { scope: "range"; from: number; to: number };

export interface NupOptions {
  mode: NupMode;
  paper: PaperId;
  orientation: Orientation;
}

export interface PosterOptions {
  page: number;
  paper: PaperId;
  orientation: Orientation;
  overlapMm: number;
  marks: boolean;
}

export type MetadataFieldKey =
  | "title"
  | "author"
  | "subject"
  | "keywords"
  | "creator"
  | "producer";

export type MetadataFields = Partial<Record<MetadataFieldKey, string>>;

export interface MetadataOptions {
  clearAll: boolean;
  fields: MetadataFields;
}

export interface NormalizedOptionsMap {
  merge: EmptyOptions;
  split: SplitOptions;
  reorder: ReorderOptions;
  pageNumbers: PageNumbersOptions;
  watermark: WatermarkOptions;
  crop: CropOptions;
  stamp: StampOptions;
  compress: CompressOptions;
  images: ImagesOptions;
  repair: EmptyOptions;
  protect: EmptyOptions;
  unlock: EmptyOptions;
  ocr: OcrOptions;
  pdfa: EmptyOptions;
  pdfToOffice: PdfToOfficeOptions;
  textExport: TextExportOptions;
  nup: NupOptions;
  poster: PosterOptions;
  metadata: MetadataOptions;
}

export type AnyOptions = NormalizedOptionsMap[SupportedToolId];

export interface PlannedAction {
  tool: SupportedToolId;
  /** 1-based indexes into the workspace list shown to the model. */
  inputs: number[];
  options: AnyOptions;
  /** File name only (no directory). Absent for multi-file outputs. */
  outputName?: string;
}

export interface ActionPlan {
  version: typeof ACTION_PLAN_VERSION;
  actions: PlannedAction[];
}

export type PlannedActionOf<T extends SupportedToolId> = PlannedAction & {
  tool: T;
  options: NormalizedOptionsMap[T];
};

/** Narrow a validated action to a concrete tool with its typed options. */
export function isAction<T extends SupportedToolId>(
  action: PlannedAction,
  tool: T,
): action is PlannedActionOf<T> {
  return action.tool === tool;
}

/** Fields the preview UI must collect from the user, never from the model. */
export function secretFieldsFor(tool: SupportedToolId): readonly string[] {
  return ACTION_SPECS[tool].secretFields ?? [];
}

// ---------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------

export type PlanIssueCode =
  | "INVALID_PLAN"
  | "UNKNOWN_VERSION"
  | "UNKNOWN_FIELD"
  | "UNKNOWN_TOOL"
  | "UNSUPPORTED_TOOL"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "UNKNOWN_ENUM_VALUE"
  | "TOO_MANY_ACTIONS"
  | "TOO_MANY_INPUTS"
  | "INPUT_OUT_OF_RANGE"
  | "DUPLICATE_INPUT"
  | "PAGE_OUT_OF_RANGE"
  | "DUPLICATE_PAGE"
  | "INVALID_PAGE_RANGE"
  | "INVALID_OUTPUT_NAME"
  | "DUPLICATE_OUTPUT_NAME"
  | "AMBIGUOUS_OPTIONS"
  | "SECRET_IN_PLAN"
  | "INVALID_JSON"
  | "JSON_TOO_LARGE";

export interface PlanIssue {
  /** JSONPath-like location, e.g. `$.actions[0].options.pages`. */
  path: string;
  code: PlanIssueCode;
  message: string;
}

export type PlanValidationResult =
  | { ok: true; plan: ActionPlan }
  | { ok: false; issues: PlanIssue[] };

export interface PlanValidationContext {
  /** Number of files in the workspace snapshot, for input-index bounds. */
  fileCount?: number;
  /** Page count per 1-based input index (null/undefined when unknown). */
  pageCounts?: readonly (number | null | undefined)[];
  /** Installed Tesseract language codes, when available. */
  installedOcrLanguages?: readonly string[];
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Validate an already-parsed value. Never throws. */
export function validateActionPlan(
  raw: unknown,
  context: PlanValidationContext = {},
): PlanValidationResult {
  const issues: PlanIssue[] = [];

  if (!isRecord(raw)) {
    addIssue(issues, "$", "INVALID_PLAN", "The plan must be a JSON object.");
    return { ok: false, issues };
  }

  checkObjectKeys(raw, ["version", "actions"], "$", issues);

  const version = hasOwn(raw, "version") ? raw.version : undefined;
  if (version !== ACTION_PLAN_VERSION) {
    addIssue(
      issues,
      "$.version",
      "UNKNOWN_VERSION",
      `Expected plan version ${ACTION_PLAN_VERSION}.`,
    );
  }

  const actionsRaw = hasOwn(raw, "actions") ? raw.actions : undefined;
  if (!Array.isArray(actionsRaw)) {
    addIssue(issues, "$.actions", "INVALID_TYPE", "actions must be an array.");
    return { ok: false, issues };
  }

  if (actionsRaw.length === 0) {
    addIssue(issues, "$.actions", "INVALID_VALUE", "Use at least one action.");
  }

  if (actionsRaw.length > ACTION_PLAN_LIMITS.maxActions) {
    addIssue(
      issues,
      "$.actions",
      "TOO_MANY_ACTIONS",
      `Use at most ${ACTION_PLAN_LIMITS.maxActions} actions per plan.`,
    );
    return { ok: false, issues };
  }

  const actions: PlannedAction[] = [];
  const outputNames = new Map<string, string>();

  actionsRaw.forEach((actionRaw, index) => {
    const action = normalizeAction(actionRaw, `$.actions[${index}]`, context, issues);
    if (!action) return;

    actions.push(action);

    if (action.outputName) {
      const key = action.outputName.toLowerCase();
      const previous = outputNames.get(key);
      if (previous) {
        addIssue(
          issues,
          `$.actions[${index}].outputName`,
          "DUPLICATE_OUTPUT_NAME",
          `That output name is already used at ${previous}.`,
        );
      } else {
        outputNames.set(key, `$.actions[${index}].outputName`);
      }
    }
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, plan: { version: ACTION_PLAN_VERSION, actions } };
}

/**
 * Parse model text and validate it. JSON must be a single object; markdown
 * fences are rejected rather than stripped, so invalid model output fails
 * safely and visibly.
 */
export function parseActionPlanJson(
  text: string,
  context: PlanValidationContext = {},
): PlanValidationResult {
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
    text.length > ACTION_PLAN_LIMITS.maxJsonLength ||
    new TextEncoder().encode(text).byteLength > ACTION_PLAN_LIMITS.maxJsonLength
  ) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "JSON_TOO_LARGE",
          message: `JSON must be at most ${ACTION_PLAN_LIMITS.maxJsonLength} bytes.`,
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

  return validateActionPlan(parsed, context);
}

// ---------------------------------------------------------------------------
// Action normalization
// ---------------------------------------------------------------------------

interface OptionContext {
  totalPages: number | null;
  installedOcrLanguages?: readonly string[];
}

interface ToolSpec {
  minInputs: number;
  maxInputs: number;
  output: "single" | "multiple";
  extensionFor?: (options: AnyOptions) => string;
  defaultOutputName?: (options: AnyOptions) => string;
  validateOptions: (
    raw: unknown,
    path: string,
    context: OptionContext,
    issues: PlanIssue[],
  ) => AnyOptions | null;
  secretFields?: readonly string[];
}

const SECRET_FIELD_NAMES = new Set([
  "password",
  "userPassword",
  "ownerPassword",
  "user_password",
  "owner_password",
]);

const KNOWN_OUTPUT_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".docx",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
] as const;

const ROTATION_ANGLES = [90, 180, 270] as const;
const METADATA_FIELD_KEYS = [
  "title",
  "author",
  "subject",
  "keywords",
  "creator",
  "producer",
] as const;
const SPLIT_MODES = ["everyN", "ranges"] as const;
const PAGE_NUMBER_POSITION_VALUES = PAGE_NUMBER_POSITIONS.map((p) => p.value);
const PAGE_NUMBER_FORMAT_VALUES = PAGE_NUMBER_FORMATS.map((f) => f.value);
const STAMP_COLOR_VALUES = STAMP_COLORS.map((c) => c.id);
const STAMP_SIZE_VALUES = STAMP_SIZES.map((s) => s.value);
const COMPRESS_MODE_VALUES = COMPRESS_MODES.map((m) => m.value);
const IMAGE_FORMAT_VALUES = IMAGE_FORMATS.map((f) => f.value);
const NUP_MODE_VALUES = NUP_MODES.map((m) => m.value);
const PDF_TO_OFFICE_FORMAT_VALUES = PDF_TO_OFFICE_FORMATS.map((f) => f.value);
const TEXT_EXPORT_SCOPE_VALUES = TEXT_EXPORT_SCOPES.map((s) => s.value);
const PAPER_IDS = PAPERS.map((p) => p.id);

function normalizeAction(
  raw: unknown,
  path: string,
  context: PlanValidationContext,
  issues: PlanIssue[],
): PlannedAction | null {
  if (!isRecord(raw)) {
    addIssue(issues, path, "INVALID_TYPE", "Each action must be an object.");
    return null;
  }

  const before = issues.length;
  checkObjectKeys(raw, ["tool", "inputs", "options", "outputName"], path, issues);

  const tool = hasOwn(raw, "tool") ? raw.tool : undefined;
  if (typeof tool !== "string") {
    addIssue(issues, `${path}.tool`, "INVALID_TYPE", "tool must be a string.");
    return null;
  }

  if (!isSupportedTool(tool)) {
    if (Object.prototype.hasOwnProperty.call(UNSUPPORTED_TOOL_REASONS, tool)) {
      addIssue(
        issues,
        `${path}.tool`,
        "UNSUPPORTED_TOOL",
        UNSUPPORTED_TOOL_REASONS[tool as UnsupportedToolId],
      );
    } else {
      addIssue(issues, `${path}.tool`, "UNKNOWN_TOOL", `Unknown tool "${tool}".`);
    }
    return null;
  }

  const spec = ACTION_SPECS[tool];
  const inputs = normalizeInputs(
    hasOwn(raw, "inputs") ? raw.inputs : undefined,
    `${path}.inputs`,
    spec,
    context,
    issues,
  );

  const optionContext: OptionContext = {
    totalPages: totalPagesFor(inputs ?? [], context),
    installedOcrLanguages: context.installedOcrLanguages,
  };

  const options = spec.validateOptions(
    hasOwn(raw, "options") ? raw.options : undefined,
    `${path}.options`,
    optionContext,
    issues,
  );

  let outputName: string | undefined;
  if (options !== null) {
    outputName = normalizeOutputName(
      hasOwn(raw, "outputName") ? raw.outputName : undefined,
      `${path}.outputName`,
      spec,
      options,
      issues,
    );
  }

  if (issues.length !== before) return null;
  if (!inputs || options === null) return null;
  if (spec.output === "single" && !outputName) return null;

  return {
    tool,
    inputs,
    options,
    ...(outputName ? { outputName } : {}),
  };
}

function normalizeInputs(
  raw: unknown,
  path: string,
  spec: ToolSpec,
  context: PlanValidationContext,
  issues: PlanIssue[],
): number[] | null {
  if (raw === undefined) {
    addIssue(issues, path, "INVALID_VALUE", "inputs is required.");
    return null;
  }

  if (!Array.isArray(raw)) {
    addIssue(issues, path, "INVALID_TYPE", "inputs must be an array of 1-based file indexes.");
    return null;
  }

  if (raw.length < spec.minInputs) {
    addIssue(
      issues,
      path,
      "INVALID_VALUE",
      `Use at least ${spec.minInputs} input${spec.minInputs === 1 ? "" : "s"}.`,
    );
    return null;
  }

  if (raw.length > spec.maxInputs || raw.length > ACTION_PLAN_LIMITS.maxInputs) {
    addIssue(
      issues,
      path,
      "TOO_MANY_INPUTS",
      `Use at most ${Math.min(spec.maxInputs, ACTION_PLAN_LIMITS.maxInputs)} inputs.`,
    );
    return null;
  }

  const before = issues.length;
  const inputs: number[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    const itemPath = `${path}[${i}]`;

    if (typeof value !== "number") {
      addIssue(issues, itemPath, "INVALID_TYPE", "Use a numeric file index.");
      continue;
    }

    if (!Number.isSafeInteger(value) || value < 1) {
      addIssue(issues, itemPath, "INVALID_VALUE", "File indexes start at 1.");
      continue;
    }

    if (context.fileCount !== undefined && value > context.fileCount) {
      addIssue(
        issues,
        itemPath,
        "INPUT_OUT_OF_RANGE",
        `File index ${value} is outside the ${context.fileCount}-file workspace.`,
      );
      continue;
    }

    if (seen.has(value)) {
      addIssue(issues, itemPath, "DUPLICATE_INPUT", `File index ${value} is repeated.`);
      continue;
    }

    seen.add(value);
    inputs.push(value);
  }

  return issues.length === before ? inputs : null;
}

function normalizeOutputName(
  raw: unknown,
  path: string,
  spec: ToolSpec,
  options: AnyOptions,
  issues: PlanIssue[],
): string | undefined {
  if (spec.output === "multiple") {
    if (raw !== undefined) {
      addIssue(
        issues,
        path,
        "INVALID_VALUE",
        "This action writes multiple files; omit outputName.",
      );
    }
    return undefined;
  }

  const extension = spec.extensionFor?.(options) ?? ".pdf";

  if (raw !== undefined) {
    if (typeof raw !== "string") {
      addIssue(issues, path, "INVALID_TYPE", "outputName must be a file name string.");
      return undefined;
    }

    if (hasMismatchedExtension(raw, extension)) {
      addIssue(
        issues,
        path,
        "INVALID_OUTPUT_NAME",
        `Expected a ${extension} file name.`,
      );
      return undefined;
    }

    const result = validateFileName(raw, extension);
    if (!result.ok) {
      addIssue(issues, path, "INVALID_OUTPUT_NAME", result.error);
      return undefined;
    }
    return result.value;
  }

  const fallback = spec.defaultOutputName?.(options);
  if (!fallback) {
    addIssue(issues, path, "INVALID_VALUE", "outputName is required.");
    return undefined;
  }

  const result = validateFileName(fallback, extension);
  if (!result.ok) {
    addIssue(issues, path, "INVALID_OUTPUT_NAME", result.error);
    return undefined;
  }
  return result.value;
}

function hasMismatchedExtension(name: string, extension: string): boolean {
  const lower = name.trim().toLowerCase();
  const known = KNOWN_OUTPUT_EXTENSIONS.find((candidate) =>
    lower.endsWith(candidate),
  );
  return known !== undefined && known !== extension.toLowerCase();
}

function totalPagesFor(
  inputs: number[],
  context: PlanValidationContext,
): number | null {
  if (!context.pageCounts || inputs.length === 0) return null;

  let total = 0;
  for (const input of inputs) {
    const pages = context.pageCounts[input - 1];
    if (typeof pages !== "number" || !Number.isSafeInteger(pages) || pages < 0) {
      return null;
    }
    total += pages;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Per-tool option validators
// ---------------------------------------------------------------------------

function noOptions(
  raw: unknown,
  path: string,
  _context: OptionContext,
  issues: PlanIssue[],
): EmptyOptions | null {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    addIssue(issues, path, "INVALID_TYPE", "options must be an object.");
    return null;
  }

  const before = issues.length;
  checkObjectKeys(raw, [], path, issues);
  return issues.length === before ? {} : null;
}

function splitOptions(
  raw: unknown,
  path: string,
  context: OptionContext,
  issues: PlanIssue[],
): SplitOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["mode", "everyN", "ranges"], path, issues);
  if (!obj) return null;

  const mode = readEnum(obj, "mode", path, issues, SPLIT_MODES, {
    fallback: TOOL_DEFAULTS.split.mode,
  });
  if (!mode) return null;

  if (mode === "everyN") {
    if (hasOwn(obj, "ranges")) {
      addIssue(
        issues,
        `${path}.ranges`,
        "AMBIGUOUS_OPTIONS",
        'ranges is only allowed when mode is "ranges".',
      );
    }

    const everyN = readInteger(obj, "everyN", path, issues, {
      fallback: TOOL_DEFAULTS.split.everyN,
      min: 1,
      max: ACTION_PLAN_LIMITS.maxPageIndex,
    });
    if (everyN === undefined) return null;
    return issues.length === before ? { mode, everyN } : null;
  }

  if (hasOwn(obj, "everyN")) {
    addIssue(
      issues,
      `${path}.everyN`,
      "AMBIGUOUS_OPTIONS",
      'everyN is only allowed when mode is "everyN".',
    );
  }

  const ranges = readPageRanges(obj, "ranges", path, issues, context.totalPages);
  if (!ranges) return null;
  return issues.length === before ? { mode, ranges } : null;
}

function reorderOptions(
  raw: unknown,
  path: string,
  context: OptionContext,
  issues: PlanIssue[],
): ReorderOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["order", "remove", "rotate"], path, issues);
  if (!obj) return null;

  if (hasOwn(obj, "order") && hasOwn(obj, "remove")) {
    addIssue(
      issues,
      path,
      "AMBIGUOUS_OPTIONS",
      "Use either order or remove, not both.",
    );
  }

  const order =
    hasOwn(obj, "order")
      ? readPageList(obj, "order", path, issues)
      : undefined;
  const remove = hasOwn(obj, "remove")
    ? readPageList(obj, "remove", path, issues, { allowEmpty: true })
    : [];
  const rotate = hasOwn(obj, "rotate")
    ? readRotations(obj, "rotate", path, issues, context.totalPages)
    : [];

  if (order && order.length === 0) {
    addIssue(issues, `${path}.order`, "INVALID_VALUE", "order cannot be empty.");
  }

  if (order) {
    checkPageBounds(order, `${path}.order`, context.totalPages, issues);
  }

  if (remove) {
    checkPageBounds(remove, `${path}.remove`, context.totalPages, issues);
    if (context.totalPages !== null && remove.length >= context.totalPages) {
      addIssue(
        issues,
        `${path}.remove`,
        "INVALID_VALUE",
        "Cannot remove every page.",
      );
    }
  }

  if (!rotate) return null;

  const outputPages = order ? new Set(order) : null;
  const removedPages = new Set(remove ?? []);

  for (const rotation of rotate) {
    for (const page of rotation.pages) {
      if (outputPages && !outputPages.has(page)) {
        addIssue(
          issues,
          `${path}.rotate`,
          "INVALID_VALUE",
          `Cannot rotate page ${page}: it is not in order.`,
        );
      }
      if (!outputPages && removedPages.has(page)) {
        addIssue(
          issues,
          `${path}.rotate`,
          "INVALID_VALUE",
          `Cannot rotate page ${page}: it is removed.`,
        );
      }
    }
  }

  const emptyOrder = order === undefined || order.length === 0;
  const emptyRemove = remove === undefined || remove.length === 0;
  const emptyRotate = rotate === undefined || rotate.length === 0;

  if (emptyOrder && emptyRemove && emptyRotate) {
    addIssue(issues, path, "INVALID_VALUE", "Nothing to change.");
  }

  return issues.length === before
    ? { order: order ?? null, remove: remove ?? [], rotate: rotate ?? [] }
    : null;
}

function pageNumbersOptions(
  raw: unknown,
  path: string,
  _context: OptionContext,
  issues: PlanIssue[],
): PageNumbersOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(
    raw,
    ["position", "start", "format", "prefix", "padWidth"],
    path,
    issues,
  );
  if (!obj) return null;

  const position = readEnum(obj, "position", path, issues, PAGE_NUMBER_POSITION_VALUES, {
    fallback: TOOL_DEFAULTS.pageNumbers.position,
  });
  const start = readInteger(obj, "start", path, issues, {
    fallback: TOOL_DEFAULTS.pageNumbers.start,
    min: -ACTION_PLAN_LIMITS.maxPageIndex,
    max: ACTION_PLAN_LIMITS.maxPageIndex,
  });
  const format = readEnum(obj, "format", path, issues, PAGE_NUMBER_FORMAT_VALUES, {
    fallback: TOOL_DEFAULTS.pageNumbers.format,
  });
  const prefix = readString(obj, "prefix", path, issues, {
    fallback: TOOL_DEFAULTS.pageNumbers.prefix,
    maxLength: ACTION_PLAN_LIMITS.maxPrefixLength,
    allowEmpty: true,
  });
  const padWidth = readInteger(obj, "padWidth", path, issues, {
    fallback: TOOL_DEFAULTS.pageNumbers.padWidth,
    min: 0,
    max: 12,
  });

  if (
    position === undefined ||
    start === undefined ||
    format === undefined ||
    prefix === undefined ||
    padWidth === undefined
  ) {
    return null;
  }

  if (format === "plain") {
    if (prefix.length > 0) {
      addIssue(
        issues,
        `${path}.prefix`,
        "AMBIGUOUS_OPTIONS",
        "prefix only applies to Bates formats.",
      );
    }
    if (padWidth !== TOOL_DEFAULTS.pageNumbers.padWidth) {
      addIssue(
        issues,
        `${path}.padWidth`,
        "AMBIGUOUS_OPTIONS",
        "padWidth only applies to Bates formats.",
      );
    }
  }

  return issues.length === before
    ? { position, start, format, prefix, padWidth }
    : null;
}

function watermarkOptions(
  raw: unknown,
  path: string,
  _context: OptionContext,
  issues: PlanIssue[],
): WatermarkOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["text", "opacity"], path, issues);
  if (!obj) return null;

  const text = readString(obj, "text", path, issues, {
    required: true,
    maxLength: 200,
  });
  const opacity = readNumber(obj, "opacity", path, issues, {
    fallback: TOOL_DEFAULTS.watermark.opacity,
    min: 0.05,
    max: 1,
  });

  if (text === undefined || opacity === undefined) return null;
  return issues.length === before ? { text, opacity } : null;
}

function cropOptions(
  raw: unknown,
  path: string,
  _context: OptionContext,
  issues: PlanIssue[],
): CropOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["left", "top", "right", "bottom"], path, issues);
  if (!obj) return null;

  const left = readNumber(obj, "left", path, issues, {
    fallback: TOOL_DEFAULTS.crop.left,
    min: 0,
    exclusiveMax: 50,
  });
  const top = readNumber(obj, "top", path, issues, {
    fallback: TOOL_DEFAULTS.crop.top,
    min: 0,
    exclusiveMax: 50,
  });
  const right = readNumber(obj, "right", path, issues, {
    fallback: TOOL_DEFAULTS.crop.right,
    min: 0,
    exclusiveMax: 50,
  });
  const bottom = readNumber(obj, "bottom", path, issues, {
    fallback: TOOL_DEFAULTS.crop.bottom,
    min: 0,
    exclusiveMax: 50,
  });

  if (
    left === undefined ||
    top === undefined ||
    right === undefined ||
    bottom === undefined
  ) {
    return null;
  }

  if (left === 0 && top === 0 && right === 0 && bottom === 0) {
    addIssue(issues, path, "INVALID_VALUE", "Crop at least one edge.");
  }

  return issues.length === before ? { left, top, right, bottom } : null;
}

function stampOptions(
  raw: unknown,
  path: string,
  context: OptionContext,
  issues: PlanIssue[],
): StampOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(
    raw,
    ["text", "page", "anchor", "color", "size"],
    path,
    issues,
  );
  if (!obj) return null;

  const text = readString(obj, "text", path, issues, {
    required: true,
    maxLength: 200,
  });
  const page = readInteger(obj, "page", path, issues, {
    fallback: TOOL_DEFAULTS.stamp.page,
    min: 1,
    max: ACTION_PLAN_LIMITS.maxPageIndex,
  });
  const anchor = readEnum(obj, "anchor", path, issues, STAMP_ANCHORS, {
    fallback: TOOL_DEFAULTS.stamp.anchor,
  });
  const color = readEnum(obj, "color", path, issues, STAMP_COLOR_VALUES, {
    fallback: TOOL_DEFAULTS.stamp.color,
  });
  const size = readNumberEnum(obj, "size", path, issues, STAMP_SIZE_VALUES, {
    fallback: TOOL_DEFAULTS.stamp.size,
  });

  if (
    text === undefined ||
    page === undefined ||
    anchor === undefined ||
    color === undefined ||
    size === undefined
  ) {
    return null;
  }

  if (context.totalPages !== null && page > context.totalPages) {
    addIssue(
      issues,
      `${path}.page`,
      "PAGE_OUT_OF_RANGE",
      `Page ${page} is beyond the ${context.totalPages}-page document.`,
    );
  }

  return issues.length === before ? { text, page, anchor, color, size } : null;
}

function compressOptions(
  raw: unknown,
  path: string,
  _context: OptionContext,
  issues: PlanIssue[],
): CompressOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["mode", "targetMb"], path, issues);
  if (!obj) return null;

  const mode = readEnum(obj, "mode", path, issues, COMPRESS_MODE_VALUES, {
    fallback: TOOL_DEFAULTS.compress.mode,
  });
  if (!mode) return null;

  if (mode === "keepText") {
    if (hasOwn(obj, "targetMb")) {
      addIssue(
        issues,
        `${path}.targetMb`,
        "AMBIGUOUS_OPTIONS",
        'targetMb only applies when mode is "target".',
      );
    }
    return issues.length === before ? { mode } : null;
  }

  const targetMb = readNumber(obj, "targetMb", path, issues, {
    fallback: TOOL_DEFAULTS.compress.targetMb,
    min: 0.01,
    max: 100_000,
  });
  if (targetMb === undefined) return null;
  return issues.length === before ? { mode, targetMb } : null;
}

function imagesOptions(
  raw: unknown,
  path: string,
  _context: OptionContext,
  issues: PlanIssue[],
): ImagesOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["format", "dpi"], path, issues);
  if (!obj) return null;

  const format = readEnum(obj, "format", path, issues, IMAGE_FORMAT_VALUES, {
    fallback: TOOL_DEFAULTS.images.format,
  });
  const dpi = readNumberEnum(obj, "dpi", path, issues, IMAGE_DPI_VALUES, {
    fallback: TOOL_DEFAULTS.images.dpi,
  });

  if (format === undefined || dpi === undefined) return null;
  return issues.length === before ? { format, dpi } : null;
}

function ocrOptions(
  raw: unknown,
  path: string,
  context: OptionContext,
  issues: PlanIssue[],
): OcrOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["languages"], path, issues);
  if (!obj) return null;

  const languages = readStringArray(obj, "languages", path, issues, {
    required: true,
    minItems: 1,
    maxItems: 8,
    // Tesseract uses three-letter codes plus a few script variants such as
    // chi_sim and srp_latn.
    pattern: /^[a-z]{3}(?:_[a-z]{3,4})?$/,
  });

  if (!languages) return null;

  if (context.installedOcrLanguages) {
    for (const language of languages) {
      if (!context.installedOcrLanguages.includes(language)) {
        addIssue(
          issues,
          `${path}.languages`,
          "UNKNOWN_ENUM_VALUE",
          `OCR language "${language}" is not installed.`,
        );
      }
    }
  }

  return issues.length === before ? { languages } : null;
}

function pdfToOfficeOptions(
  raw: unknown,
  path: string,
  _context: OptionContext,
  issues: PlanIssue[],
): PdfToOfficeOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["format"], path, issues);
  if (!obj) return null;

  const format = readEnum(obj, "format", path, issues, PDF_TO_OFFICE_FORMAT_VALUES, {
    fallback: TOOL_DEFAULTS.pdfToOffice.format,
  });
  if (!format) return null;
  return issues.length === before ? { format } : null;
}

function textExportOptions(
  raw: unknown,
  path: string,
  context: OptionContext,
  issues: PlanIssue[],
): TextExportOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["scope", "from", "to"], path, issues);
  if (!obj) return null;

  const scope = readEnum(obj, "scope", path, issues, TEXT_EXPORT_SCOPE_VALUES, {
    fallback: TOOL_DEFAULTS.textExport.scope,
  });
  if (!scope) return null;

  if (scope === "all") {
    if (hasOwn(obj, "from")) {
      addIssue(
        issues,
        `${path}.from`,
        "AMBIGUOUS_OPTIONS",
        'from only applies when scope is "range".',
      );
    }
    if (hasOwn(obj, "to")) {
      addIssue(
        issues,
        `${path}.to`,
        "AMBIGUOUS_OPTIONS",
        'to only applies when scope is "range".',
      );
    }
    return issues.length === before ? { scope } : null;
  }

  const from = readInteger(obj, "from", path, issues, {
    fallback: TOOL_DEFAULTS.textExport.from,
    min: 1,
    max: ACTION_PLAN_LIMITS.maxPageIndex,
  });
  const to = readInteger(obj, "to", path, issues, {
    required: true,
    min: 1,
    max: ACTION_PLAN_LIMITS.maxPageIndex,
  });

  if (from === undefined || to === undefined) return null;

  if (from > to) {
    addIssue(issues, `${path}.from`, "INVALID_PAGE_RANGE", "from must be <= to.");
  }

  if (context.totalPages !== null && to > context.totalPages) {
    addIssue(
      issues,
      `${path}.to`,
      "PAGE_OUT_OF_RANGE",
      `Page ${to} is beyond the ${context.totalPages}-page document.`,
    );
  }

  return issues.length === before ? { scope, from, to } : null;
}

function nupOptions(
  raw: unknown,
  path: string,
  context: OptionContext,
  issues: PlanIssue[],
): NupOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["mode", "paper", "orientation"], path, issues);
  if (!obj) return null;

  const mode = readEnum(obj, "mode", path, issues, NUP_MODE_VALUES, {
    fallback: TOOL_DEFAULTS.nup.mode,
  });
  const paper = readEnum(obj, "paper", path, issues, PAPER_IDS, {
    fallback: TOOL_DEFAULTS.nup.paper,
  });
  const orientation = readEnum(obj, "orientation", path, issues, ORIENTATION_VALUES, {
    fallback: TOOL_DEFAULTS.nup.orientation,
  });

  if (mode === undefined || paper === undefined || orientation === undefined) {
    return null;
  }

  if (mode === "booklet" && context.totalPages !== null && context.totalPages < 3) {
    addIssue(
      issues,
      `${path}.mode`,
      "INVALID_VALUE",
      "A booklet needs at least 3 pages.",
    );
  }

  return issues.length === before ? { mode, paper, orientation } : null;
}

function posterOptions(
  raw: unknown,
  path: string,
  context: OptionContext,
  issues: PlanIssue[],
): PosterOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(
    raw,
    ["page", "paper", "orientation", "overlapMm", "marks"],
    path,
    issues,
  );
  if (!obj) return null;

  const page = readInteger(obj, "page", path, issues, {
    fallback: TOOL_DEFAULTS.poster.page,
    min: 1,
    max: ACTION_PLAN_LIMITS.maxPageIndex,
  });
  const paper = readEnum(obj, "paper", path, issues, PAPER_IDS, {
    fallback: TOOL_DEFAULTS.poster.paper,
  });
  const orientation = readEnum(obj, "orientation", path, issues, ORIENTATION_VALUES, {
    fallback: TOOL_DEFAULTS.poster.orientation,
  });
  const overlapMm = readNumber(obj, "overlapMm", path, issues, {
    fallback: TOOL_DEFAULTS.poster.overlapMm,
    min: 0,
    max: 50,
  });
  const marks = readBoolean(obj, "marks", path, issues, {
    fallback: TOOL_DEFAULTS.poster.marks,
  });

  if (
    page === undefined ||
    paper === undefined ||
    orientation === undefined ||
    overlapMm === undefined ||
    marks === undefined
  ) {
    return null;
  }

  if (context.totalPages !== null && page > context.totalPages) {
    addIssue(
      issues,
      `${path}.page`,
      "PAGE_OUT_OF_RANGE",
      `Page ${page} is beyond the ${context.totalPages}-page document.`,
    );
  }

  return issues.length === before
    ? { page, paper, orientation, overlapMm, marks }
    : null;
}

function metadataOptions(
  raw: unknown,
  path: string,
  _context: OptionContext,
  issues: PlanIssue[],
): MetadataOptions | null {
  const before = issues.length;
  const obj = readOptionsObject(raw, ["clearAll", "fields"], path, issues);
  if (!obj) return null;

  const clearAll = readBoolean(obj, "clearAll", path, issues, {
    fallback: TOOL_DEFAULTS.metadata.clearAll,
  });
  const fields = readMetadataFields(obj.fields, `${path}.fields`, issues);

  if (clearAll === undefined || fields === null) return null;

  if (clearAll && Object.keys(fields).length > 0) {
    addIssue(
      issues,
      `${path}.fields`,
      "AMBIGUOUS_OPTIONS",
      "Do not combine clearAll with fields.",
    );
  }

  if (!clearAll && Object.keys(fields).length === 0) {
    addIssue(
      issues,
      `${path}.fields`,
      "INVALID_VALUE",
      "Provide at least one metadata field or set clearAll true.",
    );
  }

  return issues.length === before ? { clearAll, fields } : null;
}

// ---------------------------------------------------------------------------
// Tool catalog
// ---------------------------------------------------------------------------

const ACTION_SPECS: Record<SupportedToolId, ToolSpec> = {
  merge: {
    minInputs: 2,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.merge.outputName,
    validateOptions: noOptions,
  },
  split: {
    minInputs: 1,
    maxInputs: 50,
    output: "multiple",
    validateOptions: splitOptions,
  },
  reorder: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.reorder.outputName,
    validateOptions: reorderOptions,
  },
  pageNumbers: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.pageNumbers.outputName,
    validateOptions: pageNumbersOptions,
  },
  watermark: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.watermark.outputName,
    validateOptions: watermarkOptions,
  },
  crop: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.crop.outputName,
    validateOptions: cropOptions,
  },
  stamp: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.stamp.outputName,
    validateOptions: stampOptions,
  },
  compress: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: (options) =>
      (options as CompressOptions).mode === "keepText"
        ? TOOL_DEFAULTS.compress.optimizedOutputName
        : TOOL_DEFAULTS.compress.outputName,
    validateOptions: compressOptions,
  },
  images: {
    minInputs: 1,
    maxInputs: 50,
    output: "multiple",
    validateOptions: imagesOptions,
  },
  repair: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.repair.outputName,
    validateOptions: noOptions,
  },
  protect: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.protect.outputName,
    validateOptions: noOptions,
    secretFields: ["password"],
  },
  unlock: {
    minInputs: 1,
    maxInputs: 1,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.unlock.outputName,
    validateOptions: noOptions,
    secretFields: ["password"],
  },
  ocr: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.ocr.outputName,
    validateOptions: ocrOptions,
  },
  pdfa: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.pdfa.outputName,
    validateOptions: noOptions,
  },
  pdfToOffice: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: (options) =>
      (options as PdfToOfficeOptions).format === "pptx" ? ".pptx" : ".docx",
    defaultOutputName: (options) =>
      (options as PdfToOfficeOptions).format === "pptx"
        ? TOOL_DEFAULTS.pdfToOffice.pptxOutputName
        : TOOL_DEFAULTS.pdfToOffice.outputName,
    validateOptions: pdfToOfficeOptions,
  },
  textExport: {
    minInputs: 1,
    maxInputs: 1,
    output: "single",
    extensionFor: () => ".txt",
    defaultOutputName: () => TOOL_DEFAULTS.textExport.outputName,
    validateOptions: textExportOptions,
  },
  nup: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.nup.outputName,
    validateOptions: nupOptions,
  },
  poster: {
    minInputs: 1,
    maxInputs: 50,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.poster.outputName,
    validateOptions: posterOptions,
  },
  metadata: {
    minInputs: 1,
    maxInputs: 1,
    output: "single",
    extensionFor: () => ".pdf",
    defaultOutputName: () => TOOL_DEFAULTS.metadata.outputName,
    validateOptions: metadataOptions,
  },
};

// ---------------------------------------------------------------------------
// Primitive readers
// ---------------------------------------------------------------------------

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const CONTROL_CHARS_NO_NEWLINES = /[\u0000-\u001F\u007F]/;

interface StringOptions {
  required?: boolean;
  fallback?: string;
  maxLength?: number;
  allowEmpty?: boolean;
  allowNewlines?: boolean;
  trim?: boolean;
}

function readString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  options: StringOptions = {},
): string | undefined {
  const fieldPath = `${path}.${key}`;

  if (!hasOwn(obj, key) || obj[key] === undefined) {
    if (options.required) {
      addIssue(issues, fieldPath, "INVALID_VALUE", "This field is required.");
    }
    return options.fallback;
  }

  const value = obj[key];
  if (typeof value !== "string") {
    addIssue(issues, fieldPath, "INVALID_TYPE", "Expected a string.");
    return undefined;
  }

  const maxLength = options.maxLength ?? ACTION_PLAN_LIMITS.maxTextLength;
  if (value.length > maxLength) {
    addIssue(
      issues,
      fieldPath,
      "INVALID_VALUE",
      `Use at most ${maxLength} characters.`,
    );
    return undefined;
  }

  const controlChars = options.allowNewlines
    ? CONTROL_CHARS
    : CONTROL_CHARS_NO_NEWLINES;
  if (controlChars.test(value)) {
    addIssue(issues, fieldPath, "INVALID_VALUE", "Control characters are not allowed.");
    return undefined;
  }

  const output = options.trim === false ? value : value.trim();
  if (!options.allowEmpty && output.length === 0) {
    addIssue(issues, fieldPath, "INVALID_VALUE", "This field cannot be empty.");
    return undefined;
  }

  return output;
}

interface NumberOptions {
  required?: boolean;
  fallback?: number;
  min?: number;
  max?: number;
  exclusiveMax?: number;
}

function readNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  options: NumberOptions = {},
): number | undefined {
  const fieldPath = `${path}.${key}`;

  if (!hasOwn(obj, key) || obj[key] === undefined) {
    if (options.required) {
      addIssue(issues, fieldPath, "INVALID_VALUE", "This field is required.");
    }
    return options.fallback;
  }

  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addIssue(issues, fieldPath, "INVALID_TYPE", "Expected a finite number.");
    return undefined;
  }

  if (options.min !== undefined && value < options.min) {
    addIssue(issues, fieldPath, "INVALID_VALUE", `Must be at least ${options.min}.`);
    return undefined;
  }

  if (options.max !== undefined && value > options.max) {
    addIssue(issues, fieldPath, "INVALID_VALUE", `Must be at most ${options.max}.`);
    return undefined;
  }

  if (options.exclusiveMax !== undefined && value >= options.exclusiveMax) {
    addIssue(
      issues,
      fieldPath,
      "INVALID_VALUE",
      `Must be less than ${options.exclusiveMax}.`,
    );
    return undefined;
  }

  return value;
}

function readInteger(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  options: NumberOptions = {},
): number | undefined {
  const value = readNumber(obj, key, path, issues, options);
  if (value === undefined) return undefined;

  if (!Number.isSafeInteger(value)) {
    addIssue(issues, `${path}.${key}`, "INVALID_TYPE", "Expected a whole number.");
    return undefined;
  }

  return value;
}

function readBoolean(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  options: { required?: boolean; fallback?: boolean } = {},
): boolean | undefined {
  const fieldPath = `${path}.${key}`;

  if (!hasOwn(obj, key) || obj[key] === undefined) {
    if (options.required) {
      addIssue(issues, fieldPath, "INVALID_VALUE", "This field is required.");
    }
    return options.fallback;
  }

  const value = obj[key];
  if (typeof value !== "boolean") {
    addIssue(issues, fieldPath, "INVALID_TYPE", "Expected true or false.");
    return undefined;
  }
  return value;
}

function readEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  values: readonly T[],
  options: { required?: boolean; fallback?: T } = {},
): T | undefined {
  const fieldPath = `${path}.${key}`;

  if (!hasOwn(obj, key) || obj[key] === undefined) {
    if (options.required) {
      addIssue(issues, fieldPath, "INVALID_VALUE", "This field is required.");
    }
    return options.fallback;
  }

  const value = obj[key];
  if (typeof value !== "string") {
    addIssue(issues, fieldPath, "INVALID_TYPE", "Expected a string.");
    return undefined;
  }

  if (!(values as readonly string[]).includes(value)) {
    addIssue(
      issues,
      fieldPath,
      "UNKNOWN_ENUM_VALUE",
      `Unknown value "${value}". Allowed: ${values.join(", ")}.`,
    );
    return undefined;
  }

  return value as T;
}

function readNumberEnum<T extends number>(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  values: readonly T[],
  options: { required?: boolean; fallback?: T } = {},
): T | undefined {
  const fieldPath = `${path}.${key}`;

  if (!hasOwn(obj, key) || obj[key] === undefined) {
    if (options.required) {
      addIssue(issues, fieldPath, "INVALID_VALUE", "This field is required.");
    }
    return options.fallback;
  }

  const value = obj[key];
  if (typeof value !== "number") {
    addIssue(issues, fieldPath, "INVALID_TYPE", "Expected a number.");
    return undefined;
  }

  if (!(values as readonly number[]).includes(value)) {
    addIssue(
      issues,
      fieldPath,
      "UNKNOWN_ENUM_VALUE",
      `Unknown value "${value}". Allowed: ${values.join(", ")}.`,
    );
    return undefined;
  }

  return value as T;
}

interface IntegerArrayOptions {
  required?: boolean;
  fallback?: number[];
  min?: number;
  max?: number;
  minItems?: number;
  maxItems?: number;
  allowEmpty?: boolean;
}

function readIntegerArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  options: IntegerArrayOptions = {},
): number[] | undefined {
  const fieldPath = `${path}.${key}`;

  if (!hasOwn(obj, key) || obj[key] === undefined) {
    if (options.required) {
      addIssue(issues, fieldPath, "INVALID_VALUE", "This field is required.");
    }
    return options.fallback ? [...options.fallback] : undefined;
  }

  const value = obj[key];
  if (!Array.isArray(value)) {
    addIssue(issues, fieldPath, "INVALID_TYPE", "Expected an array of numbers.");
    return undefined;
  }

  const maxItems = options.maxItems ?? ACTION_PLAN_LIMITS.maxPagesPerList;
  if (value.length > maxItems) {
    addIssue(issues, fieldPath, "INVALID_VALUE", `Use at most ${maxItems} items.`);
    return undefined;
  }

  const minItems = options.minItems ?? (options.allowEmpty ? 0 : 1);
  if (value.length < minItems) {
    addIssue(issues, fieldPath, "INVALID_VALUE", `Use at least ${minItems} item(s).`);
    return undefined;
  }

  const before = issues.length;
  const output: number[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const itemPath = `${fieldPath}[${i}]`;

    if (typeof item !== "number" || !Number.isSafeInteger(item)) {
      addIssue(issues, itemPath, "INVALID_TYPE", "Expected a whole number.");
      continue;
    }

    if (options.min !== undefined && item < options.min) {
      addIssue(issues, itemPath, "INVALID_VALUE", `Must be at least ${options.min}.`);
      continue;
    }

    if (options.max !== undefined && item > options.max) {
      addIssue(issues, itemPath, "INVALID_VALUE", `Must be at most ${options.max}.`);
      continue;
    }

    if (seen.has(item)) {
      addIssue(issues, itemPath, "DUPLICATE_PAGE", `Page ${item} is repeated.`);
      continue;
    }

    seen.add(item);
    output.push(item);
  }

  return issues.length === before ? output : undefined;
}

interface StringArrayOptions {
  required?: boolean;
  fallback?: string[];
  minItems?: number;
  maxItems?: number;
  pattern?: RegExp;
}

function readStringArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  options: StringArrayOptions = {},
): string[] | undefined {
  const fieldPath = `${path}.${key}`;

  if (!hasOwn(obj, key) || obj[key] === undefined) {
    if (options.required) {
      addIssue(issues, fieldPath, "INVALID_VALUE", "This field is required.");
    }
    return options.fallback ? [...options.fallback] : undefined;
  }

  const value = obj[key];
  if (!Array.isArray(value)) {
    addIssue(issues, fieldPath, "INVALID_TYPE", "Expected an array of strings.");
    return undefined;
  }

  const maxItems = options.maxItems ?? 8;
  if (value.length > maxItems) {
    addIssue(issues, fieldPath, "INVALID_VALUE", `Use at most ${maxItems} items.`);
    return undefined;
  }

  const minItems = options.minItems ?? 1;
  if (value.length < minItems) {
    addIssue(issues, fieldPath, "INVALID_VALUE", `Use at least ${minItems} item(s).`);
    return undefined;
  }

  const before = issues.length;
  const output: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const itemPath = `${fieldPath}[${i}]`;

    if (typeof item !== "string") {
      addIssue(issues, itemPath, "INVALID_TYPE", "Expected a string.");
      continue;
    }

    if (options.pattern && !options.pattern.test(item)) {
      addIssue(
        issues,
        itemPath,
        "INVALID_VALUE",
        `"${item}" does not match ${options.pattern}.`,
      );
      continue;
    }

    if (seen.has(item)) {
      addIssue(issues, itemPath, "INVALID_VALUE", `"${item}" is repeated.`);
      continue;
    }

    seen.add(item);
    output.push(item);
  }

  return issues.length === before ? output : undefined;
}

function readPageList(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  options: { allowEmpty?: boolean } = {},
): number[] | undefined {
  return readIntegerArray(obj, key, path, issues, {
    min: 1,
    max: ACTION_PLAN_LIMITS.maxPageIndex,
    maxItems: ACTION_PLAN_LIMITS.maxPagesPerList,
    allowEmpty: options.allowEmpty ?? false,
  });
}

function readPageRanges(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  totalPages: number | null,
): PageRange[] | undefined {
  const fieldPath = `${path}.${key}`;

  if (!hasOwn(obj, key) || obj[key] === undefined) {
    addIssue(issues, fieldPath, "INVALID_VALUE", "This field is required.");
    return undefined;
  }

  const value = obj[key];
  if (!Array.isArray(value)) {
    addIssue(issues, fieldPath, "INVALID_TYPE", "Expected an array of ranges.");
    return undefined;
  }

  if (value.length === 0) {
    addIssue(issues, fieldPath, "INVALID_VALUE", "Use at least one range.");
    return undefined;
  }

  if (value.length > ACTION_PLAN_LIMITS.maxPageRanges) {
    addIssue(
      issues,
      fieldPath,
      "INVALID_VALUE",
      `Use at most ${ACTION_PLAN_LIMITS.maxPageRanges} ranges.`,
    );
    return undefined;
  }

  const before = issues.length;
  const ranges: PageRange[] = [];

  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const itemPath = `${fieldPath}[${i}]`;

    if (!isRecord(item)) {
      addIssue(issues, itemPath, "INVALID_TYPE", "Each range must be an object.");
      continue;
    }

    checkObjectKeys(item, ["start", "end"], itemPath, issues);

    const start = readInteger(item, "start", itemPath, issues, {
      required: true,
      min: 1,
      max: ACTION_PLAN_LIMITS.maxPageIndex,
    });
    const end = readInteger(item, "end", itemPath, issues, {
      required: true,
      min: 1,
      max: ACTION_PLAN_LIMITS.maxPageIndex,
    });

    if (start === undefined || end === undefined) continue;

    if (start > end) {
      addIssue(issues, itemPath, "INVALID_PAGE_RANGE", "start must be <= end.");
      continue;
    }

    if (totalPages !== null && end > totalPages) {
      addIssue(
        issues,
        itemPath,
        "PAGE_OUT_OF_RANGE",
        `Range ends at ${end}, beyond the ${totalPages}-page document.`,
      );
      continue;
    }

    ranges.push({ start, end });
  }

  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start <= ranges[i - 1].end) {
      addIssue(
        issues,
        `${fieldPath}[${i}]`,
        "INVALID_PAGE_RANGE",
        "Ranges must be ascending and non-overlapping.",
      );
      break;
    }
  }

  return issues.length === before ? ranges : undefined;
}

function readRotations(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  issues: PlanIssue[],
  totalPages: number | null,
): RotationSpec[] | undefined {
  const fieldPath = `${path}.${key}`;

  if (!hasOwn(obj, key) || obj[key] === undefined) {
    return [];
  }

  const value = obj[key];
  if (!Array.isArray(value)) {
    addIssue(issues, fieldPath, "INVALID_TYPE", "Expected an array of rotations.");
    return undefined;
  }

  if (value.length > ACTION_PLAN_LIMITS.maxRotations) {
    addIssue(
      issues,
      fieldPath,
      "INVALID_VALUE",
      `Use at most ${ACTION_PLAN_LIMITS.maxRotations} rotations.`,
    );
    return undefined;
  }

  const before = issues.length;
  const rotations: RotationSpec[] = [];
  const rotatedPages = new Set<number>();

  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const itemPath = `${fieldPath}[${i}]`;

    if (!isRecord(item)) {
      addIssue(issues, itemPath, "INVALID_TYPE", "Each rotation must be an object.");
      continue;
    }

    checkObjectKeys(item, ["pages", "angle"], itemPath, issues);

    const pages = readIntegerArray(item, "pages", itemPath, issues, {
      required: true,
      min: 1,
      max: ACTION_PLAN_LIMITS.maxPageIndex,
      maxItems: ACTION_PLAN_LIMITS.maxPagesPerList,
    });
    const angle = readNumberEnum(item, "angle", itemPath, issues, ROTATION_ANGLES, {
      required: true,
    });

    if (!pages || angle === undefined) continue;

    for (const page of pages) {
      if (rotatedPages.has(page)) {
        addIssue(
          issues,
          `${itemPath}.pages`,
          "DUPLICATE_PAGE",
          `Page ${page} already has a rotation.`,
        );
      } else {
        rotatedPages.add(page);
      }

      if (totalPages !== null && page > totalPages) {
        addIssue(
          issues,
          `${itemPath}.pages`,
          "PAGE_OUT_OF_RANGE",
          `Page ${page} is beyond the ${totalPages}-page document.`,
        );
      }
    }

    rotations.push({ pages, angle });
  }

  return issues.length === before ? rotations : undefined;
}

function checkPageBounds(
  pages: number[],
  path: string,
  totalPages: number | null,
  issues: PlanIssue[],
): void {
  if (totalPages === null) return;

  for (const page of pages) {
    if (page > totalPages) {
      addIssue(
        issues,
        path,
        "PAGE_OUT_OF_RANGE",
        `Page ${page} is beyond the ${totalPages}-page document.`,
      );
      return;
    }
  }
}

function readMetadataFields(
  raw: unknown,
  path: string,
  issues: PlanIssue[],
): MetadataFields | null {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    addIssue(issues, path, "INVALID_TYPE", "fields must be an object.");
    return null;
  }

  checkObjectKeys(raw, METADATA_FIELD_KEYS, path, issues);

  const fields: MetadataFields = {};
  for (const key of METADATA_FIELD_KEYS) {
    const value = readString(raw, key, path, issues, {
      maxLength: 500,
      allowEmpty: true,
      allowNewlines: true,
    });
    if (value !== undefined) fields[key] = value;
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function readOptionsObject(
  raw: unknown,
  allowed: readonly string[],
  path: string,
  issues: PlanIssue[],
): Record<string, unknown> | null {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    addIssue(issues, path, "INVALID_TYPE", "options must be an object.");
    return null;
  }
  checkObjectKeys(raw, allowed, path, issues);
  return raw;
}

function checkObjectKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: PlanIssue[],
): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;

    if (SECRET_FIELD_NAMES.has(key)) {
      addIssue(
        issues,
        `${path}.${key}`,
        "SECRET_IN_PLAN",
        "Passwords are entered by the user at confirmation time, never included in a plan.",
      );
    } else {
      addIssue(issues, `${path}.${key}`, "UNKNOWN_FIELD", `Unknown field "${key}".`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function addIssue(
  issues: PlanIssue[],
  path: string,
  code: PlanIssueCode,
  message: string,
): void {
  issues.push({ path, code, message });
}
