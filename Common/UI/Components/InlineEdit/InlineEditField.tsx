import Icon from "../Icon/Icon";
import { ShowToastNotification } from "../Toast/ToastInit";
import { ToastType } from "../Toast/Toast";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * InlineEditField
 *
 * A click-to-edit field — the "no edit mode, no Save button, no modal" pattern
 * from the Linear-like overhaul. Rendered as text; click (or focus + Enter) to
 * edit in place. It commits OPTIMISTICALLY: the new value renders immediately
 * while `onSave` flushes in the background. If the save rejects, the field
 * quietly rolls back to the previous value and surfaces a loud, actionable
 * error toast — because a silently-dropped write is worse than a slow one.
 *
 * Save on blur or Enter; cancel on Escape.
 */

export interface ComponentProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  placeholder?: string | undefined;
  // Accessible label for the edit input.
  ariaLabel?: string | undefined;
  // Applied to the read-mode text and the input.
  className?: string | undefined;
  // Disable editing (e.g. when the user lacks write permission).
  disabled?: boolean | undefined;
  // Copy for the error toast shown when a save fails.
  errorTitle?: string | undefined;
}

const InlineEditField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  // The value we render — updated optimistically, rolled back on failure.
  const [displayValue, setDisplayValue] = useState<string>(props.value);
  const [draft, setDraft] = useState<string>(props.value);
  // After a successful save, hold the prior value briefly so the edit is undoable.
  const [undoValue, setUndoValue] = useState<string | null>(null);

  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const undoTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearUndoTimer: () => void = (): void => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  };

  // Clear any pending undo timer on unmount.
  useEffect(() => {
    return () => {
      return clearUndoTimer();
    };
  }, []);

  // Keep local state in sync when the source value changes upstream.
  useEffect(() => {
    if (!isEditing && !isSaving) {
      setDisplayValue(props.value);
      setDraft(props.value);
    }
  }, [props.value]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const startEditing: () => void = (): void => {
    if (props.disabled) {
      return;
    }
    setDraft(displayValue);
    setIsEditing(true);
  };

  const cancel: () => void = (): void => {
    setDraft(displayValue);
    setIsEditing(false);
  };

  const commit: () => Promise<void> = async (): Promise<void> => {
    const trimmed: string = draft;
    setIsEditing(false);

    // No change — nothing to persist.
    if (trimmed === displayValue) {
      return;
    }

    const previousValue: string = displayValue;

    // Optimistic: show the new value immediately.
    setDisplayValue(trimmed);
    setIsSaving(true);

    try {
      await props.onSave(trimmed);
      // Offer a brief window to undo the change.
      setUndoValue(previousValue);
      clearUndoTimer();
      undoTimerRef.current = setTimeout(() => {
        setUndoValue(null);
      }, 6000);
    } catch (err) {
      // Roll back and surface a loud, actionable error.
      setDisplayValue(previousValue);
      setDraft(previousValue);
      ShowToastNotification({
        title: props.errorTitle || "Couldn't save change",
        description:
          err instanceof Error
            ? err.message
            : "The change was reverted. Please try again.",
        type: ToastType.DANGER,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const undo: () => Promise<void> = async (): Promise<void> => {
    if (undoValue === null) {
      return;
    }
    const revertTo: string = undoValue;
    const current: string = displayValue;
    clearUndoTimer();
    setUndoValue(null);
    setDisplayValue(revertTo);
    setDraft(revertTo);
    setIsSaving(true);
    try {
      await props.onSave(revertTo);
    } catch (err) {
      setDisplayValue(current);
      setDraft(current);
      ShowToastNotification({
        title: props.errorTitle || "Couldn't undo change",
        description:
          err instanceof Error
            ? err.message
            : "The undo failed. Please try again.",
        type: ToastType.DANGER,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const onInputKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setDraft(e.target.value);
        }}
        onKeyDown={onInputKeyDown}
        onBlur={commit}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel || "Edit value"}
        className={`rounded-md border border-indigo-300 bg-white px-2 py-1 text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
          props.className || ""
        }`}
        autoComplete="off"
        spellCheck={false}
      />
    );
  }

  const showPlaceholder: boolean = !displayValue && Boolean(props.placeholder);

  return (
    <span className="inline-flex items-center gap-2">
      <span
        role={props.disabled ? undefined : "button"}
        tabIndex={props.disabled ? undefined : 0}
        onClick={startEditing}
        onKeyDown={(e: React.KeyboardEvent<HTMLSpanElement>) => {
          if (!props.disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            startEditing();
          }
        }}
        title={props.disabled ? undefined : "Click to edit"}
        className={`group inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${
          props.disabled
            ? "cursor-default"
            : "cursor-text hover:bg-gray-100 focus:bg-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-300"
        } ${isSaving ? "opacity-70" : ""} ${props.className || ""}`}
        aria-label={props.ariaLabel}
      >
        <span className={showPlaceholder ? "text-gray-400" : ""}>
          {showPlaceholder ? props.placeholder : displayValue}
        </span>
        {!props.disabled && (
          <Icon
            icon={IconProp.Edit}
            className="h-3.5 w-3.5 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </span>
      {undoValue !== null && !props.disabled && (
        <button
          type="button"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            undo();
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
        >
          <Icon icon={IconProp.Reload} className="h-3 w-3" />
          Undo
        </button>
      )}
    </span>
  );
};

export default InlineEditField;
