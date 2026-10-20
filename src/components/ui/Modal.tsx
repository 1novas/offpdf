import { useEffect, useId, useRef, type ReactNode } from "react";
import { FOCUSABLE_SELECTOR, nextTrapIndex } from "@/lib/focusTrap";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Wide layout for viewers (≈ full-screen page preview). */
  wide?: boolean;
}

export function Modal({ open, onClose, title, headerActions, children, footer, wide = false }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open and return it to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    const dialog = dialogRef.current;
    // Keep focus on an auto-focused child when one already lives in the dialog.
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    // Escape closes; Tab is trapped inside the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const current = focusables.indexOf(document.activeElement as HTMLElement);
      const next = nextTrapIndex(current, focusables.length, e.shiftKey);
      e.preventDefault();
      focusables[next]?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal ${wide ? "modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal__header">
          <div className="modal__title" id={titleId}>
            {title}
          </div>
          {headerActions && <div className="modal__header-actions">{headerActions}</div>}
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
