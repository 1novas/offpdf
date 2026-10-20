/**
 * Shared option defaults and option vocabularies for the manual tools.
 *
 * Both the feature pages and the assistant action-plan schema import from this
 * module. That keeps "what the UI starts with" and "what a plan assumes when an
 * option is omitted" in one place, and prevents enum values from drifting.
 */

import type { Orientation, PaperId } from "./paper";

export const PAGE_NUMBER_POSITIONS = [
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
] as const;
export type PageNumberPosition = (typeof PAGE_NUMBER_POSITIONS)[number]["value"];

export const PAGE_NUMBER_FORMATS = [
  { value: "plain", label: "Plain number (1, 2, 3…)" },
  { value: "bates", label: "Prefix + padded (DAVA-000123)" },
  { value: "bates-date", label: "Prefix + padded + date" },
] as const;
export type PageNumberFormat = (typeof PAGE_NUMBER_FORMATS)[number]["value"];

export const STAMP_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type StampAnchor = (typeof STAMP_ANCHORS)[number];

export const STAMP_COLORS = [
  { id: "black", label: "Black", rgb: [0, 0, 0] as const },
  { id: "red", label: "Red", rgb: [0.85, 0.12, 0.12] as const },
  { id: "blue", label: "Blue", rgb: [0.1, 0.3, 0.8] as const },
  { id: "gray", label: "Gray", rgb: [0.45, 0.45, 0.45] as const },
] as const;
export type StampColor = (typeof STAMP_COLORS)[number]["id"];

export const STAMP_SIZES = [
  { value: 0.025, label: "Small" },
  { value: 0.04, label: "Medium" },
  { value: 0.06, label: "Large" },
] as const;
export type StampSize = (typeof STAMP_SIZES)[number]["value"];
export const STAMP_SIZE_OPTIONS = STAMP_SIZES.map((size) => ({
  value: String(size.value),
  label: size.label,
}));

export const COMPRESS_MODES = [
  { value: "target", label: "To target size" },
  { value: "keepText", label: "Keep text (lossless)" },
] as const;
export type CompressMode = (typeof COMPRESS_MODES)[number]["value"];

export const IMAGE_FORMATS = [
  { value: "png", label: "PNG (lossless, larger)" },
  { value: "jpg", label: "JPG (smaller)" },
] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number]["value"];

export const IMAGE_DPI_OPTIONS = [
  { value: "96", label: "Screen (96 DPI)" },
  { value: "150", label: "Print (150 DPI)" },
  { value: "300", label: "High (300 DPI)" },
] as const;
export const IMAGE_DPI_VALUES = [96, 150, 300] as const;
export type ImageDpi = (typeof IMAGE_DPI_VALUES)[number];

export const NUP_MODES = [
  { value: "2up", label: "2 pages per sheet" },
  { value: "4up", label: "4 pages per sheet" },
  { value: "booklet", label: "Booklet (fold & staple)" },
] as const;
export type NupMode = (typeof NUP_MODES)[number]["value"];

export const PDF_TO_OFFICE_FORMATS = [
  { value: "docx", label: "Word (.docx)" },
  { value: "pptx", label: "PowerPoint (.pptx)" },
] as const;
export type PdfToOfficeFormat = (typeof PDF_TO_OFFICE_FORMATS)[number]["value"];

export const TEXT_EXPORT_SCOPES = [
  { value: "all", label: "Whole document" },
  { value: "range", label: "Page range" },
] as const;
export type TextExportScope = (typeof TEXT_EXPORT_SCOPES)[number]["value"];

export const ORIENTATION_VALUES = ["auto", "portrait", "landscape"] as const;

export const TOOL_DEFAULTS = {
  merge: {
    outputName: "merged.pdf",
  },
  split: {
    mode: "everyN" as const,
    everyN: 10,
  },
  reorder: {
    outputName: "edited.pdf",
  },
  pageNumbers: {
    outputName: "numbered.pdf",
    position: "bottom-center" as PageNumberPosition,
    start: 1,
    format: "plain" as PageNumberFormat,
    prefix: "",
    padWidth: 6,
  },
  watermark: {
    outputName: "watermarked.pdf",
    text: "DRAFT",
    opacity: 0.3,
  },
  crop: {
    outputName: "cropped.pdf",
    left: 5,
    top: 5,
    right: 5,
    bottom: 5,
  },
  stamp: {
    outputName: "stamped.pdf",
    text: "APPROVED",
    anchor: "bottom-right" as StampAnchor,
    color: "red" as StampColor,
    size: 0.04 as StampSize,
    page: 1,
  },
  compress: {
    outputName: "compressed.pdf",
    optimizedOutputName: "optimized.pdf",
    mode: "target" as CompressMode,
    targetMb: 20,
  },
  images: {
    format: "png" as ImageFormat,
    dpi: 150 as ImageDpi,
  },
  repair: {
    outputName: "repaired.pdf",
  },
  protect: {
    outputName: "protected.pdf",
  },
  unlock: {
    outputName: "unlocked.pdf",
  },
  ocr: {
    outputName: "searchable.pdf",
  },
  pdfa: {
    outputName: "archive.pdf",
  },
  pdfToOffice: {
    format: "docx" as PdfToOfficeFormat,
    outputName: "converted.docx",
    pptxOutputName: "converted.pptx",
  },
  textExport: {
    outputName: "document.txt",
    scope: "all" as TextExportScope,
    from: 1,
  },
  nup: {
    outputName: "layout.pdf",
    mode: "2up" as NupMode,
    paper: "a4" as PaperId,
    orientation: "auto" as Orientation,
  },
  poster: {
    outputName: "poster.pdf",
    page: 1,
    paper: "a4" as PaperId,
    orientation: "auto" as Orientation,
    overlapMm: 10,
    marks: true,
  },
  metadata: {
    outputName: "metadata.pdf",
    clearAll: false,
  },
};
