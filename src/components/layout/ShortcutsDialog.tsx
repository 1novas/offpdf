import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  SHORTCUT_GROUPS,
  formatShortcut,
  formatShortcutKeys,
  type ShortcutPlatform,
} from "@/lib/shortcuts";

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Modifier convention to display: Command/Option or Ctrl/Alt. */
  platform: ShortcutPlatform;
}

/**
 * Offline keyboard-shortcuts reference. Content comes from the shared
 * `SHORTCUT_GROUPS` list so the dialog and the actual handlers stay aligned.
 */
export function ShortcutsDialog({ open, onClose, platform }: ShortcutsDialogProps) {
  const baseId = useId();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      wide
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="shortcuts__note">
        {platform === "mac"
          ? "On macOS, shortcuts use Command and Option."
          : "On Windows and Linux, shortcuts use Ctrl and Alt."}
      </p>
      <div className="shortcuts">
        {SHORTCUT_GROUPS.map((group) => (
          <section
            key={group.id}
            className="shortcuts__group"
            aria-labelledby={`${baseId}-${group.id}`}
          >
            <h2 className="shortcuts__title" id={`${baseId}-${group.id}`}>
              {group.title}
            </h2>
            <dl className="shortcuts__list">
              {group.items.map((item) => (
                <div key={item.id} className="shortcuts__row">
                  <dt className="shortcuts__label">{item.label}</dt>
                  <dd className="shortcuts__keys" aria-label={formatShortcut(item.keys, platform)}>
                    {formatShortcutKeys(item.keys, platform).map((key, index) => (
                      <span key={`${item.id}-${index}`} className="shortcuts__combo">
                        {index > 0 && (
                          <span className="shortcuts__plus" aria-hidden="true">
                            +
                          </span>
                        )}
                        <kbd className="shortcuts__key">{key}</kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
