import { useEffect, useState } from "react";
import { ToolPage, ToolSection } from "@/components/tools/ToolPage";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/components/ui/Icon";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { WorkspaceFilePicker, OutputFolderPicker } from "@/components/pdf";
import { useJob, JobStatus } from "@/components/jobs";
// `exportPdfText` is added by INTEGRATION-utils.md (tauriCommands.ts).
import { exportPdfText } from "@/lib/tauriCommands";
import { getTool } from "@/lib/tools";
import { joinPath, validateFileName } from "@/lib/validation";
import { stripExt } from "@/lib/formatBytes";
import {
  TEXT_EXPORT_SCOPES,
  TOOL_DEFAULTS,
  type TextExportScope,
} from "@/lib/toolDefaults";
import { useSettingsStore } from "@/state/settingsStore";
import { useWorkspace } from "@/state/workspaceStore";

const tool = getTool("textExport");

type Scope = TextExportScope;

export function TextExportPage() {
  const files = useWorkspace((s) => s.files);
  const job = useJob();
  const { toast } = useToast();

  const lastFolder = useSettingsStore((s) => s.lastOutputFolder);
  const [folder, setFolder] = useState<string | null>(lastFolder);
  const [name, setName] = useState(TOOL_DEFAULTS.textExport.outputName);

  const [scope, setScope] = useState<Scope>(TOOL_DEFAULTS.textExport.scope);
  const [from, setFrom] = useState(String(TOOL_DEFAULTS.textExport.from));
  const [to, setTo] = useState("");

  const first = files[0];
  const pageCount = first?.pageCount ?? 0;

  useEffect(() => {
    if (first) {
      setName(`${stripExt(first.name)}.txt`);
      setFrom("1");
      setTo(first.pageCount ? String(first.pageCount) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first?.path]);

  const start = async () => {
    if (!first) return toast({ title: "Add a PDF first", variant: "error" });
    if (!folder) return toast({ title: "Choose an output folder", variant: "error" });
    const nameRes = validateFileName(name, ".txt");
    if (!nameRes.ok) return toast({ title: "Invalid file name", description: nameRes.error, variant: "error" });
    const outputPath = joinPath(folder, nameRes.value);

    let firstPage: number | null = null;
    let lastPage: number | null = null;
    if (scope === "range") {
      const f = Number(from);
      const l = Number(to);
      if (!Number.isInteger(f) || f < 1 || !Number.isInteger(l) || l < 1) {
        return toast({ title: "Invalid page range", description: "Enter whole page numbers, e.g. 2 to 10.", variant: "error" });
      }
      if (f > l) {
        return toast({ title: "Invalid page range", description: "The range must start before it ends.", variant: "error" });
      }
      firstPage = f;
      lastPage = l;
    }

    await job.run((id) => exportPdfText(id, first.path, outputPath, firstPage, lastPage), {
      tool: "textExport",
      label:
        scope === "range"
          ? `Export text of pages ${firstPage}-${lastPage}`
          : `Export text of ${first.name}`,
      inputBytes: first.sizeBytes,
    });
  };

  const canStart = !!first && !!folder && !job.isBusy;

  return (
    <ToolPage tool={tool}>
      <ToolSection label="Document" sublabel="Text is extracted from one file at a time.">
        <WorkspaceFilePicker selectable={false} />
        {files.length > 1 && (
          <div className="mt">
            <Alert variant="info">
              Several files are loaded — only the first one ({first?.name}) is exported here.
            </Alert>
          </div>
        )}
      </ToolSection>

      <ToolSection label="Pages">
        <Tabs
          tabs={TEXT_EXPORT_SCOPES.map((s) => ({ id: s.value, label: s.label }))}
          active={scope}
          onChange={(t) => setScope(t as Scope)}
        />
        {scope === "range" ? (
          <div className="row mt">
            <Input
              label="From page"
              type="number"
              min={1}
              max={pageCount || undefined}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              label="To page"
              type="number"
              min={1}
              max={pageCount || undefined}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        ) : (
          <div className="mt">
            <Alert variant="info">
              The whole document is exported as one UTF-8 .txt file with the page layout preserved.
              Scanned PDFs without a text layer produce empty text — run OCR first.
            </Alert>
          </div>
        )}
      </ToolSection>

      <ToolSection label="Output">
        <div className="col">
          <Input label="File name" value={name} onChange={(e) => setName(e.target.value)} placeholder="document.txt" />
          <OutputFolderPicker value={folder} onChange={setFolder} />
        </div>
      </ToolSection>

      <div className="row">
        <Button
          variant="primary"
          size="lg"
          onClick={start}
          disabled={!canStart}
          loading={job.isBusy}
          leftIcon={<Icon name="fileText" size={18} />}
        >
          Export text
        </Button>
      </div>

      <JobStatus job={job} />
    </ToolPage>
  );
}
