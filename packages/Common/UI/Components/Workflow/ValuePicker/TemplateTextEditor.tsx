/*
 * A text box that shows references as chips.
 *
 * "Body: {{local.components.webhook-1.returnValues.request-body}}" is what a
 * step stores, and what this box shows is "Body: [Webhook › Request Body]".
 * The chip is one thing: the caret steps over it, Backspace removes it whole,
 * and copying it copies the reference. Everything else is plain text, typed,
 * stored and copied exactly as written - no formatting, ever.
 *
 * It is a contenteditable element, because a text field cannot hold a chip.
 * The stored string is the truth and the DOM is drawn from it
 * (TemplateTextDom): plain typing is left to the browser, which keeps spell
 * checking, autocorrect and input methods working, and is read back after
 * every change. What browsers do differently or badly - Enter makes a <div>,
 * paste brings formatting, a caret lands inside a chip, undo cannot follow a
 * chip being drawn - is done here instead. The tests in
 * packages/E2E/ValuePicker cover the parts only a real browser shows.
 */

import { ReferenceDescription } from "./ReferenceDescription";
import { createReferenceChipElement } from "./ReferenceChip";
import {
  ReferenceTrigger,
  TemplateSegment,
  TemplateSegmentKind,
  findReferenceTrigger,
  replaceRange,
  splitTemplateText,
} from "./TemplateText";
import {
  AdjacentChip,
  TemplateSelection,
  chipAncestor,
  chipAtOffset,
  domPointToOffset,
  isTemplateDomTidy,
  readTemplateSelection,
  renderTemplateValue,
  serializeTemplateEditor,
  writeTemplateSelection,
} from "./TemplateTextDom";
import TemplateTextHistory, {
  TemplateTextChangeKind,
  TemplateTextSnapshot,
} from "./TemplateTextHistory";
import React, {
  ReactElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface TemplateTextEditorHandle {
  focus: () => void;
  /**
   * The selection as offsets into the value: the live one while the box has
   * the focus, otherwise the last one it had.
   */
  getSelection: () => TemplateSelection;
  /**
   * Put text in place of a range (by default the selection), give the box the
   * focus, and leave the caret after what was put in.
   */
  insert: (text: string, range?: TemplateSelection) => void;
  getValue: () => string;
  /** Stop offering values for the "{{" being typed (Escape). */
  dismissTrigger: () => void;
}

export interface TemplateTextEditorProps {
  /** What is stored; anything that is not a string is shown as text. */
  value: unknown;
  onChange: (value: string) => void;
  /** Enter starts a new line. Otherwise there is only ever one line. */
  multiline: boolean;
  /** The words a chip shows for a reference; null leaves it as text. */
  describeReference: (reference: string) => ReferenceDescription | null;
  placeholder?: string | undefined;
  id?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaLabel?: string | undefined;
  ariaDescribedby?: string | undefined;
  ariaInvalid?: boolean | undefined;
  /** The list of values, while it is open for what is being typed. */
  ariaControls?: string | undefined;
  ariaActiveDescendant?: string | undefined;
  autoFocus?: boolean | undefined;
  tabIndex?: number | undefined;
  disabled?: boolean | undefined;
  spellCheck?: boolean | undefined;
  monospace?: boolean | undefined;
  /** Padding and the like, shared with the placeholder so they line up. */
  className?: string | undefined;
  dataTestId?: string | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: ((event: React.FocusEvent<HTMLDivElement>) => void) | undefined;
  /** Runs first; a handler that calls preventDefault keeps the key from the box. */
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** A "{{" being typed, so values can be offered for it; null when there is none. */
  onTriggerChange?: ((trigger: ReferenceTrigger | null) => void) | undefined;
  /** Enter, in a one-line box. */
  onEnter?: (() => void) | undefined;
}

type ToTextFunction = (value: unknown) => string;

/*
 * The form hands over whatever is stored, and that is not always a string. A
 * box shows text; the line breaks are "\n", as a browser reads them back.
 */
export const toEditorText: ToTextFunction = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value.replace(/\r\n?/g, "\n");
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  return String(value);
};

type CleanInsertedTextFunction = (text: string, multiline: boolean) => string;

/** Pasted text, as plain text with "\n" line breaks; a one-line box gets spaces. */
export const cleanInsertedText: CleanInsertedTextFunction = (
  text: string,
  multiline: boolean,
): string => {
  const normalized: string = (text || "").replace(/\r\n?/g, "\n");

  return multiline ? normalized : normalized.replace(/\n+/g, " ");
};

const DELETE_WHOLE_CHIP_INPUT_TYPES: Array<string> = [
  "deleteContentBackward",
  "deleteContentForward",
  "deleteWordBackward",
  "deleteWordForward",
];

const PASTE_INPUT_TYPES: Array<string> = [
  "insertFromPaste",
  "insertFromPasteAsQuotation",
  "insertFromDrop",
  "insertFromYank",
];

type ClampFunction = (
  selection: TemplateSelection,
  length: number,
) => TemplateSelection;

const clamp: ClampFunction = (
  selection: TemplateSelection,
  length: number,
): TemplateSelection => {
  const start: number = Math.max(0, Math.min(selection.start, length));
  const end: number = Math.max(start, Math.min(selection.end, length));
  return { start, end };
};

const TemplateTextEditor: React.ForwardRefExoticComponent<
  TemplateTextEditorProps & React.RefAttributes<TemplateTextEditorHandle>
> = forwardRef<TemplateTextEditorHandle, TemplateTextEditorProps>(
  (
    props: TemplateTextEditorProps,
    ref: React.ForwardedRef<TemplateTextEditorHandle>,
  ): ReactElement => {
    const rootRef: React.MutableRefObject<HTMLDivElement | null> =
      useRef<HTMLDivElement | null>(null);

    const initialText: string = toEditorText(props.value);

    // The value the DOM shows - read back after every change, set by every edit.
    const valueRef: React.MutableRefObject<string> = useRef<string>(initialText);
    const selectionRef: React.MutableRefObject<TemplateSelection> =
      useRef<TemplateSelection>({
        start: initialText.length,
        end: initialText.length,
      });
    const historyRef: React.MutableRefObject<TemplateTextHistory> =
      useRef<TemplateTextHistory>(
        new TemplateTextHistory({
          value: initialText,
          selectionStart: initialText.length,
          selectionEnd: initialText.length,
        }),
      );
    const composingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
    const selectionBeforeRef: React.MutableRefObject<TemplateSelection | null> =
      useRef<TemplateSelection | null>(null);
    const pendingKindRef: React.MutableRefObject<TemplateTextChangeKind> =
      useRef<TemplateTextChangeKind>(TemplateTextChangeKind.Other);
    const dismissedTriggerRef: React.MutableRefObject<number | null> = useRef<
      number | null
    >(null);

    // The latest props, for listeners added once.
    const propsRef: React.MutableRefObject<TemplateTextEditorProps> =
      useRef<TemplateTextEditorProps>(props);
    propsRef.current = props;

    const [isEmpty, setIsEmpty] = useState<boolean>(initialText === "");

    const buildChip: (reference: string) => HTMLElement = useCallback(
      (reference: string): HTMLElement => {
        const root: HTMLDivElement = rootRef.current!;

        return createReferenceChipElement(
          root.ownerDocument,
          reference,
          propsRef.current.describeReference(reference),
        );
      },
      [],
    );

    type HasFocusFunction = () => boolean;

    const hasFocus: HasFocusFunction = (): boolean => {
      const root: HTMLDivElement | null = rootRef.current;
      return Boolean(root && root.ownerDocument.activeElement === root);
    };

    type DrawFunction = (
      value: string,
      selection: TemplateSelection | null,
    ) => void;

    const draw: DrawFunction = (
      value: string,
      selection: TemplateSelection | null,
    ): void => {
      const root: HTMLDivElement | null = rootRef.current;

      if (!root) {
        return;
      }

      renderTemplateValue(root, value, buildChip);
      setIsEmpty(value === "");

      if (selection && hasFocus()) {
        writeTemplateSelection(root, clamp(selection, value.length));
      }
    };

    type ReportTriggerFunction = (kind: TemplateTextChangeKind) => void;

    const reportTrigger: ReportTriggerFunction = (
      kind: TemplateTextChangeKind,
    ): void => {
      const onTriggerChange:
        | ((trigger: ReferenceTrigger | null) => void)
        | undefined = propsRef.current.onTriggerChange;

      if (!onTriggerChange) {
        return;
      }

      const selection: TemplateSelection = selectionRef.current;

      if (
        (kind !== TemplateTextChangeKind.Typing &&
          kind !== TemplateTextChangeKind.Deleting) ||
        selection.start !== selection.end
      ) {
        onTriggerChange(null);
        return;
      }

      const trigger: ReferenceTrigger | null = findReferenceTrigger(
        valueRef.current,
        selection.start,
      );

      if (!trigger) {
        dismissedTriggerRef.current = null;
        onTriggerChange(null);
        return;
      }

      onTriggerChange(
        trigger.start === dismissedTriggerRef.current ? null : trigger,
      );
    };

    type CommitFunction = (
      value: string,
      selection: TemplateSelection,
      kind: TemplateTextChangeKind,
      selectionBefore: TemplateSelection | null,
    ) => void;

    const commit: CommitFunction = (
      value: string,
      selection: TemplateSelection,
      kind: TemplateTextChangeKind,
      selectionBefore: TemplateSelection | null,
    ): void => {
      selectionRef.current = selection;

      if (value !== valueRef.current) {
        valueRef.current = value;
        historyRef.current.record(
          {
            value: value,
            selectionStart: selection.start,
            selectionEnd: selection.end,
          },
          kind,
          Date.now(),
          selectionBefore || undefined,
        );
        propsRef.current.onChange(value);
      }

      reportTrigger(kind);
    };

    type ApplyEditFunction = (
      range: TemplateSelection,
      insert: string,
      kind: TemplateTextChangeKind,
    ) => void;

    // An edit made here rather than by the browser: the DOM is drawn again.
    const applyEdit: ApplyEditFunction = (
      range: TemplateSelection,
      insert: string,
      kind: TemplateTextChangeKind,
    ): void => {
      const root: HTMLDivElement | null = rootRef.current;

      if (!root) {
        return;
      }

      const target: TemplateSelection = clamp(range, valueRef.current.length);
      const result: { value: string; caret: number } = replaceRange(
        valueRef.current,
        target.start,
        target.end,
        insert,
      );

      renderTemplateValue(root, result.value, buildChip);
      setIsEmpty(result.value === "");

      if (!hasFocus()) {
        root.focus();
      }

      const caret: TemplateSelection = { start: result.caret, end: result.caret };
      writeTemplateSelection(root, caret);
      commit(result.value, caret, kind, target);
    };

    type ReconcileFunction = (kind: TemplateTextChangeKind) => void;

    // After the browser changed the DOM: read it back, and tidy it if needed.
    const reconcile: ReconcileFunction = (kind: TemplateTextChangeKind): void => {
      const root: HTMLDivElement | null = rootRef.current;

      if (!root) {
        return;
      }

      const selection: TemplateSelection =
        readTemplateSelection(root) || selectionRef.current;
      const value: string = serializeTemplateEditor(root);

      if (!isTemplateDomTidy(root, value)) {
        renderTemplateValue(root, value, buildChip);

        if (hasFocus()) {
          writeTemplateSelection(root, clamp(selection, value.length));
        }
      }

      setIsEmpty(value === "");
      commit(value, selection, kind, selectionBeforeRef.current);
      selectionBeforeRef.current = null;
    };

    type RestoreFunction = (snapshot: TemplateTextSnapshot | null) => void;

    const restore: RestoreFunction = (
      snapshot: TemplateTextSnapshot | null,
    ): void => {
      if (!snapshot) {
        return;
      }

      const selection: TemplateSelection = {
        start: snapshot.selectionStart,
        end: snapshot.selectionEnd,
      };

      valueRef.current = snapshot.value;
      selectionRef.current = selection;
      draw(snapshot.value, selection);
      propsRef.current.onChange(snapshot.value);
      propsRef.current.onTriggerChange?.(null);
    };

    type ActionFunction = () => void;

    const undo: ActionFunction = (): void => {
      restore(historyRef.current.undo());
    };

    const redo: ActionFunction = (): void => {
      restore(historyRef.current.redo());
    };

    useImperativeHandle(ref, () => {
      return {
        focus: (): void => {
          const root: HTMLDivElement | null = rootRef.current;

          if (!root) {
            return;
          }

          root.focus();
          writeTemplateSelection(
            root,
            clamp(selectionRef.current, valueRef.current.length),
          );
        },
        getSelection: (): TemplateSelection => {
          const root: HTMLDivElement | null = rootRef.current;
          const live: TemplateSelection | null =
            root && hasFocus() ? readTemplateSelection(root) : null;

          return clamp(live || selectionRef.current, valueRef.current.length);
        },
        insert: (text: string, range?: TemplateSelection): void => {
          applyEdit(
            range || selectionRef.current,
            text,
            TemplateTextChangeKind.Other,
          );
        },
        getValue: (): string => {
          return valueRef.current;
        },
        dismissTrigger: (): void => {
          const trigger: ReferenceTrigger | null = findReferenceTrigger(
            valueRef.current,
            selectionRef.current.start,
          );

          dismissedTriggerRef.current = trigger ? trigger.start : null;
          propsRef.current.onTriggerChange?.(null);
        },
      };
    });

    // First draw, and the focus if the form wants it here.
    useLayoutEffect(() => {
      const root: HTMLDivElement | null = rootRef.current;

      if (!root) {
        return;
      }

      renderTemplateValue(root, valueRef.current, buildChip);

      if (propsRef.current.autoFocus) {
        root.focus();
        writeTemplateSelection(root, {
          start: valueRef.current.length,
          end: valueRef.current.length,
        });
      }
    }, []);

    /*
     * A value set from outside - the form loading, or a different step's
     * settings - is drawn, and becomes the start of the undo history. The
     * value this box just reported coming back is not a change.
     */
    useLayoutEffect(() => {
      const next: string = toEditorText(props.value);

      if (next === valueRef.current) {
        return;
      }

      valueRef.current = next;
      const selection: TemplateSelection = clamp(
        selectionRef.current,
        next.length,
      );
      selectionRef.current = selection;
      draw(next, selection);
      historyRef.current.reset({
        value: next,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      });
    }, [props.value]);

    /*
     * The words on the chips can change without the value changing - the
     * variables finish loading, a step is renamed. Draw them again.
     */
    const isFirstDescribeRef: React.MutableRefObject<boolean> =
      useRef<boolean>(true);

    useLayoutEffect(() => {
      if (isFirstDescribeRef.current) {
        isFirstDescribeRef.current = false;
        return;
      }

      const root: HTMLDivElement | null = rootRef.current;

      if (!root || composingRef.current) {
        return;
      }

      const hasChips: boolean = splitTemplateText(valueRef.current).some(
        (segment: TemplateSegment) => {
          return segment.kind === TemplateSegmentKind.Reference;
        },
      );

      if (!hasChips) {
        return;
      }

      const selection: TemplateSelection | null = hasFocus()
        ? readTemplateSelection(root)
        : null;
      draw(valueRef.current, selection);
    }, [props.describeReference]);

    // The events React does not pass on faithfully: beforeinput and input.
    useEffect(() => {
      const root: HTMLDivElement | null = rootRef.current;

      if (!root) {
        return;
      }

      const handleBeforeInput: (event: InputEvent) => void = (
        event: InputEvent,
      ): void => {
        const current: TemplateTextEditorProps = propsRef.current;

        if (current.disabled) {
          event.preventDefault();
          return;
        }

        const inputType: string = event.inputType || "";
        const selection: TemplateSelection =
          readTemplateSelection(root) || selectionRef.current;

        selectionBeforeRef.current = selection;

        if (inputType === "insertCompositionText" || composingRef.current) {
          pendingKindRef.current = TemplateTextChangeKind.Typing;
          return;
        }

        if (inputType === "historyUndo" || inputType === "historyRedo") {
          event.preventDefault();

          if (inputType === "historyUndo") {
            undo();
          } else {
            redo();
          }

          return;
        }

        // Bold, italic, a font: there is no formatting to store.
        if (inputType.startsWith("format")) {
          event.preventDefault();
          return;
        }

        if (inputType === "insertParagraph" || inputType === "insertLineBreak") {
          event.preventDefault();

          if (!current.multiline) {
            current.onEnter?.();
            return;
          }

          applyEdit(selection, "\n", TemplateTextChangeKind.Other);
          return;
        }

        if (PASTE_INPUT_TYPES.includes(inputType)) {
          // Normally the paste and drop events got here first.
          event.preventDefault();
          const text: string =
            event.dataTransfer?.getData("text/plain") ?? event.data ?? "";
          applyEdit(
            selection,
            cleanInsertedText(text, current.multiline),
            TemplateTextChangeKind.Other,
          );
          return;
        }

        if (inputType === "deleteByDrag") {
          event.preventDefault();
          return;
        }

        if (inputType.startsWith("delete")) {
          if (selection.start !== selection.end) {
            event.preventDefault();
            applyEdit(selection, "", TemplateTextChangeKind.Deleting);
            return;
          }

          // Next to a chip, the key takes the whole chip.
          if (DELETE_WHOLE_CHIP_INPUT_TYPES.includes(inputType)) {
            const chip: AdjacentChip | null = chipAtOffset(
              root,
              selection.start,
              inputType.endsWith("Backward") ? "before" : "after",
            );

            if (chip) {
              event.preventDefault();
              applyEdit(
                { start: chip.start, end: chip.end },
                "",
                TemplateTextChangeKind.Deleting,
              );
              return;
            }
          }

          pendingKindRef.current = TemplateTextChangeKind.Deleting;
          return;
        }

        if (inputType === "insertText") {
          // Typing over a selection, chips and all, is done here.
          if (selection.start !== selection.end) {
            event.preventDefault();
            applyEdit(
              selection,
              cleanInsertedText(event.data || "", current.multiline),
              TemplateTextChangeKind.Typing,
            );
            return;
          }

          pendingKindRef.current = TemplateTextChangeKind.Typing;
          return;
        }

        pendingKindRef.current = TemplateTextChangeKind.Other;
      };

      const handleInput: () => void = (): void => {
        if (composingRef.current) {
          return;
        }

        reconcile(pendingKindRef.current);
        pendingKindRef.current = TemplateTextChangeKind.Other;
      };

      /*
       * A caret inside a chip - Firefox puts it there for Home before a chip
       * that opens the line - goes to the chip's edge, where typing works.
       */
      const handleSelectionChange: () => void = (): void => {
        if (root.ownerDocument.activeElement !== root) {
          return;
        }

        const domSelection: Selection | null =
          root.ownerDocument.defaultView?.getSelection() || null;

        if (
          !domSelection ||
          domSelection.rangeCount === 0 ||
          !root.contains(domSelection.anchorNode)
        ) {
          return;
        }

        const selection: TemplateSelection | null = readTemplateSelection(root);

        if (!selection) {
          return;
        }

        if (
          domSelection.isCollapsed &&
          chipAncestor(root, domSelection.anchorNode)
        ) {
          writeTemplateSelection(root, selection);
        }

        selectionRef.current = selection;
      };

      root.addEventListener("beforeinput", handleBeforeInput);
      root.addEventListener("input", handleInput);
      root.ownerDocument.addEventListener(
        "selectionchange",
        handleSelectionChange,
      );

      return () => {
        root.removeEventListener("beforeinput", handleBeforeInput);
        root.removeEventListener("input", handleInput);
        root.ownerDocument.removeEventListener(
          "selectionchange",
          handleSelectionChange,
        );
      };
    }, []);

    type RememberSelectionFunction = () => void;

    const rememberSelection: RememberSelectionFunction = (): void => {
      const root: HTMLDivElement | null = rootRef.current;
      const selection: TemplateSelection | null = root
        ? readTemplateSelection(root)
        : null;

      if (selection) {
        selectionRef.current = selection;
      }
    };

    type PlaceCaretFunction = (offset: number) => void;

    const placeCaret: PlaceCaretFunction = (offset: number): void => {
      const root: HTMLDivElement | null = rootRef.current;

      if (!root) {
        return;
      }

      const caret: TemplateSelection = { start: offset, end: offset };
      writeTemplateSelection(root, caret);
      selectionRef.current = caret;
    };

    /*
     * Home lands after a chip that opens the line, in Chromium: there is no
     * text before it to put the caret in. Put it before the chip.
     */
    const fixHome: ActionFunction = (): void => {
      const root: HTMLDivElement | null = rootRef.current;
      const selection: TemplateSelection | null = root
        ? readTemplateSelection(root)
        : null;

      if (!selection || selection.start !== selection.end) {
        return;
      }

      const value: string = valueRef.current;
      const lineStart: number = value.lastIndexOf("\n", selection.start - 1) + 1;

      if (lineStart >= selection.start) {
        return;
      }

      const onlyChips: boolean = splitTemplateText(
        value.slice(lineStart, selection.start),
      ).every((segment: TemplateSegment) => {
        return segment.kind === TemplateSegmentKind.Reference;
      });

      if (onlyChips) {
        placeCaret(lineStart);
      }
    };

    const multilineClass: string = props.multiline
      ? "min-h-[4.75rem] max-h-80 overflow-y-auto"
      : "";

    const fontClass: string = props.monospace
      ? "font-mono text-xs leading-5"
      : "text-sm leading-5";

    const sharedClass: string = `${props.className || "px-3 py-2"} ${fontClass}`;

    return (
      <div className="relative min-w-0 flex-1">
        {isEmpty && props.placeholder && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 top-0 select-none truncate text-gray-400 ${sharedClass}`}
          >
            {props.placeholder}
          </div>
        )}
        <div
          ref={rootRef}
          id={props.id}
          role="textbox"
          aria-multiline={props.multiline}
          aria-labelledby={props.ariaLabelledby}
          aria-label={props.ariaLabel}
          aria-describedby={props.ariaDescribedby}
          aria-invalid={props.ariaInvalid ? true : undefined}
          aria-placeholder={props.placeholder || undefined}
          aria-disabled={props.disabled ? true : undefined}
          aria-autocomplete={props.onTriggerChange ? "list" : undefined}
          aria-controls={props.ariaControls}
          aria-activedescendant={props.ariaActiveDescendant}
          contentEditable={!props.disabled}
          suppressContentEditableWarning={true}
          spellCheck={props.spellCheck ?? props.multiline}
          tabIndex={props.tabIndex ?? 0}
          data-testid={props.dataTestId}
          data-template-editor=""
          data-multiline={props.multiline ? "true" : "false"}
          className={`block w-full min-w-0 whitespace-pre-wrap break-words text-gray-900 [overflow-wrap:anywhere] focus:outline-none ${sharedClass} ${multilineClass} ${
            props.disabled ? "cursor-not-allowed text-gray-500" : ""
          }`}
          onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
            props.onKeyDown?.(event);

            if (event.defaultPrevented) {
              return;
            }

            const isModified: boolean = event.metaKey || event.ctrlKey;
            const key: string = event.key.toLowerCase();

            if (isModified && !event.altKey && key === "z") {
              event.preventDefault();

              if (event.shiftKey) {
                redo();
              } else {
                undo();
              }

              return;
            }

            if (isModified && !event.altKey && key === "y") {
              event.preventDefault();
              redo();
              return;
            }

            if (isModified && ["b", "i", "u"].includes(key)) {
              event.preventDefault();
              return;
            }

            if (event.key === "Enter" && !props.multiline) {
              event.preventDefault();
              props.onEnter?.();
              return;
            }

            /*
             * The arrows step over a chip in one go. Firefox will not step back
             * over one that opens the line at all.
             */
            if (
              (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
              !event.shiftKey &&
              !isModified &&
              !event.altKey
            ) {
              const root: HTMLDivElement | null = rootRef.current;
              const selection: TemplateSelection | null = root
                ? readTemplateSelection(root)
                : null;

              if (root && selection && selection.start === selection.end) {
                const chip: AdjacentChip | null = chipAtOffset(
                  root,
                  selection.start,
                  event.key === "ArrowLeft" ? "before" : "after",
                );

                if (chip) {
                  event.preventDefault();
                  placeCaret(event.key === "ArrowLeft" ? chip.start : chip.end);
                  return;
                }
              }
            }

            if (event.key === "Home" && !event.shiftKey) {
              window.setTimeout(fixHome, 0);
            }
          }}
          onKeyUp={rememberSelection}
          onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
            const root: HTMLDivElement | null = rootRef.current;
            const chip: HTMLElement | null = root
              ? chipAncestor(root, event.target as Node)
              : null;

            /*
             * Pressing a chip would put the caret at the start of the box in
             * every browser. It goes on the side of the chip that was pressed.
             */
            if (!root || !chip || event.button !== 0) {
              return;
            }

            event.preventDefault();
            root.focus();

            const index: number = Array.prototype.indexOf.call(
              root.childNodes,
              chip,
            );
            const start: number = domPointToOffset(root, root, index);
            const end: number = domPointToOffset(root, root, index + 1);
            const rect: DOMRect = chip.getBoundingClientRect();

            placeCaret(event.clientX > rect.left + rect.width / 2 ? end : start);
          }}
          onMouseUp={(event: React.MouseEvent<HTMLDivElement>) => {
            const root: HTMLDivElement | null = rootRef.current;
            const selection: TemplateSelection | null = root
              ? readTemplateSelection(root)
              : null;

            if (!root || !selection) {
              return;
            }

            selectionRef.current = selection;

            if (selection.start !== selection.end) {
              return;
            }

            /*
             * A click past the end of a chip can land before it (Firefox, when
             * the chip ends the line), and one before a chip after it.
             */
            const isOnLine: (rect: DOMRect) => boolean = (
              rect: DOMRect,
            ): boolean => {
              return (
                event.clientY >= rect.top - 2 && event.clientY <= rect.bottom + 2
              );
            };

            const next: AdjacentChip | null = chipAtOffset(
              root,
              selection.start,
              "after",
            );

            if (next) {
              const rect: DOMRect = next.element.getBoundingClientRect();

              if (rect.width > 0 && event.clientX >= rect.right && isOnLine(rect)) {
                placeCaret(next.end);
                return;
              }
            }

            const previous: AdjacentChip | null = chipAtOffset(
              root,
              selection.start,
              "before",
            );

            if (previous) {
              const rect: DOMRect = previous.element.getBoundingClientRect();

              if (rect.width > 0 && event.clientX <= rect.left && isOnLine(rect)) {
                placeCaret(previous.start);
              }
            }
          }}
          onPaste={(event: React.ClipboardEvent<HTMLDivElement>) => {
            event.preventDefault();

            if (props.disabled) {
              return;
            }

            const root: HTMLDivElement | null = rootRef.current;
            const selection: TemplateSelection =
              (root && readTemplateSelection(root)) || selectionRef.current;

            applyEdit(
              selection,
              cleanInsertedText(
                event.clipboardData.getData("text/plain"),
                props.multiline,
              ),
              TemplateTextChangeKind.Other,
            );
          }}
          onCopy={(event: React.ClipboardEvent<HTMLDivElement>) => {
            const root: HTMLDivElement | null = rootRef.current;
            const selection: TemplateSelection | null = root
              ? readTemplateSelection(root)
              : null;

            if (!selection || selection.start === selection.end) {
              return;
            }

            // The references, not the chips' words.
            event.preventDefault();
            event.clipboardData.setData(
              "text/plain",
              valueRef.current.slice(selection.start, selection.end),
            );
          }}
          onCut={(event: React.ClipboardEvent<HTMLDivElement>) => {
            const root: HTMLDivElement | null = rootRef.current;
            const selection: TemplateSelection | null = root
              ? readTemplateSelection(root)
              : null;

            if (!selection || selection.start === selection.end) {
              return;
            }

            event.preventDefault();
            event.clipboardData.setData(
              "text/plain",
              valueRef.current.slice(selection.start, selection.end),
            );

            if (!props.disabled) {
              applyEdit(selection, "", TemplateTextChangeKind.Other);
            }
          }}
          onDragStart={(event: React.DragEvent<HTMLDivElement>) => {
            // Dragging would carry the chips' words, not their references.
            event.preventDefault();
          }}
          onDragOver={(event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault();
          }}
          onDrop={(event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault();

            const root: HTMLDivElement | null = rootRef.current;
            const text: string = event.dataTransfer.getData("text/plain");

            if (!root || !text || props.disabled) {
              return;
            }

            let offset: number | null = null;
            const doc: Document & {
              caretPositionFromPoint?: (
                x: number,
                y: number,
              ) => { offsetNode: Node; offset: number } | null;
              caretRangeFromPoint?: (x: number, y: number) => Range | null;
            } = root.ownerDocument;

            if (typeof doc.caretPositionFromPoint === "function") {
              const position: { offsetNode: Node; offset: number } | null =
                doc.caretPositionFromPoint(event.clientX, event.clientY);

              if (position && root.contains(position.offsetNode)) {
                offset = domPointToOffset(
                  root,
                  position.offsetNode,
                  position.offset,
                );
              }
            } else if (typeof doc.caretRangeFromPoint === "function") {
              const range: Range | null = doc.caretRangeFromPoint(
                event.clientX,
                event.clientY,
              );

              if (range && root.contains(range.startContainer)) {
                offset = domPointToOffset(
                  root,
                  range.startContainer,
                  range.startOffset,
                );
              }
            }

            const at: TemplateSelection =
              offset === null
                ? selectionRef.current
                : { start: offset, end: offset };

            applyEdit(
              at,
              cleanInsertedText(text, props.multiline),
              TemplateTextChangeKind.Other,
            );
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            reconcile(TemplateTextChangeKind.Typing);
          }}
          onFocus={() => {
            props.onFocus?.();
          }}
          onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
            props.onBlur?.(event);
          }}
        />
      </div>
    );
  },
);

TemplateTextEditor.displayName = "TemplateTextEditor";

export default TemplateTextEditor;
