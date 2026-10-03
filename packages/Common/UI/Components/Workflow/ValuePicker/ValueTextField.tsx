/*
 * A text setting that can use values from earlier steps: the chip editor in
 * a box that looks like any other text field, with a { } button at its end.
 *
 * Two ways to put a value in, both landing it where the caret is:
 * - { } opens the list of values, with a search box;
 * - typing "{{" opens the same list under the field, filtered by what comes
 *   next, for those who know the syntax.
 * Either way the value shows as a chip, not as {{...}}.
 *
 * This replaces "Pick this value from other component or from variable"
 * under every field, which opened one of two dialogs and then appended the
 * reference to the end of whatever was there.
 */

import { ReferenceTrigger } from "./TemplateText";
import TemplateTextEditor, {
  TemplateTextEditorHandle,
} from "./TemplateTextEditor";
import { TemplateSelection } from "./TemplateTextDom";
import { ValuePickerContextValue, useValuePicker } from "./ValuePickerContext";
import ValuePickerMenu, { ValuePickerMenuHandle } from "./ValuePickerMenu";
import ValuePickerPopup, {
  ValuePickerCloseReason,
  ValuePickerPopupMode,
} from "./ValuePickerPopup";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useRef,
  useState,
} from "react";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

export const INSERT_VALUE_LABEL: string = translationKey(
  "Insert a value from an earlier step or a variable",
);

/*
 * The { } button, the same in every field that has one. Bordered, so it reads
 * as a button at a glance: it is how values get into a step, and a faint
 * glyph in the corner of the box was easy to miss.
 */
export const INSERT_VALUE_BUTTON_CLASS: string =
  "shrink-0 rounded border px-1.5 py-0.5 font-mono text-xs leading-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export const INSERT_VALUE_BUTTON_IDLE_CLASS: string =
  "border-gray-200 bg-white text-gray-500 hover:bg-indigo-50 hover:text-indigo-600";

export const INSERT_VALUE_BUTTON_OPEN_CLASS: string =
  "border-indigo-200 bg-indigo-50 text-indigo-600";

export interface ValueTextFieldProps {
  value: unknown;
  onChange: (value: string) => void;
  /** Enter starts a new line, and the box grows with what is in it. */
  multiline: boolean;
  placeholder?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaLabel?: string | undefined;
  error?: string | undefined;
  autoFocus?: boolean | undefined;
  tabIndex?: number | undefined;
  disabled?: boolean | undefined;
  monospace?: boolean | undefined;
  /** The editor's test id; the { } button is `${dataTestId}-insert-value`. */
  dataTestId?: string | undefined;
  onBlur?: (() => void) | undefined;
  /** Smaller, for a cell in a table of rows. */
  isCompact?: boolean | undefined;
}

const ValueTextField: FunctionComponent<ValueTextFieldProps> = (
  props: ValueTextFieldProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const picker: ValuePickerContextValue = useValuePicker();
  const id: string = useId();
  const errorId: string = `${id}-error`;
  const inlinePopupId: string = `${id}-inline`;
  const popoverId: string = `${id}-popover`;
  const inlineListboxId: string = `${id}-inline-values`;
  const dataTestId: string = props.dataTestId || "value-text-field";

  const boxRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const editorRef: React.MutableRefObject<TemplateTextEditorHandle | null> =
    useRef<TemplateTextEditorHandle | null>(null);
  const menuRef: React.MutableRefObject<ValuePickerMenuHandle | null> =
    useRef<ValuePickerMenuHandle | null>(null);

  // Where the caret was when { } was pressed: where the value goes.
  const savedSelectionRef: React.MutableRefObject<TemplateSelection | null> =
    useRef<TemplateSelection | null>(null);

  const [isPopoverOpen, setIsPopoverOpen] = useState<boolean>(false);
  const [trigger, setTrigger] = useState<ReferenceTrigger | null>(null);
  const [activeOptionId, setActiveOptionId] = useState<string | undefined>(
    undefined,
  );

  const canPick: boolean = picker.isAvailable && !props.disabled;
  const isInlineOpen: boolean = canPick && trigger !== null && !isPopoverOpen;

  type PickFunction = (reference: string) => void;

  const pickFromPopover: PickFunction = (reference: string): void => {
    setIsPopoverOpen(false);
    editorRef.current?.insert(
      reference,
      savedSelectionRef.current || undefined,
    );
    savedSelectionRef.current = null;
  };

  const pickInline: PickFunction = (reference: string): void => {
    const current: ReferenceTrigger | null = trigger;
    setTrigger(null);

    if (!current) {
      return;
    }

    editorRef.current?.insert(reference, {
      start: current.start,
      end: current.end,
    });
  };

  const compactPadding: string = props.isCompact
    ? "py-1 pl-2 pr-1"
    : "py-2 pl-3 pr-1";

  return (
    <div className="w-full">
      <div
        ref={boxRef}
        className={`relative flex w-full items-start rounded-md border bg-white shadow-sm ${
          props.error
            ? "border-red-300 focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500"
            : "border-gray-300 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500"
        } ${props.disabled ? "bg-gray-50" : ""}`}
        data-testid={`${dataTestId}-box`}
      >
        <TemplateTextEditor
          ref={editorRef}
          value={props.value}
          onChange={props.onChange}
          multiline={props.multiline}
          describeReference={picker.describeReference}
          placeholder={translator.translateText(props.placeholder)}
          ariaLabelledby={props.ariaLabelledby}
          ariaLabel={translator.translateText(props.ariaLabel)}
          ariaDescribedby={props.error ? errorId : undefined}
          ariaInvalid={Boolean(props.error)}
          ariaControls={isInlineOpen ? inlineListboxId : undefined}
          ariaActiveDescendant={isInlineOpen ? activeOptionId : undefined}
          autoFocus={props.autoFocus}
          tabIndex={props.tabIndex}
          disabled={props.disabled}
          monospace={props.monospace}
          className={compactPadding}
          dataTestId={dataTestId}
          onTriggerChange={
            canPick
              ? (next: ReferenceTrigger | null) => {
                  setTrigger(next);
                }
              : undefined
          }
          onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
            if (!isInlineOpen) {
              return;
            }

            if (event.key === "Escape") {
              // The list closes; the dialog around it stays.
              event.preventDefault();
              event.stopPropagation();
              editorRef.current?.dismissTrigger();
              setTrigger(null);
              return;
            }

            const key: string = event.key === "Tab" ? "Enter" : event.key;

            if (
              ![
                "ArrowDown",
                "ArrowUp",
                "Enter",
                "ArrowRight",
                "ArrowLeft",
              ].includes(key)
            ) {
              return;
            }

            // ArrowLeft only means "back" inside a value; else it moves the caret.
            menuRef.current?.handleKeyDown({
              key: key,
              shiftKey: event.shiftKey,
              preventDefault: () => {
                event.preventDefault();
              },
            });
          }}
          onBlur={(event: React.FocusEvent<HTMLDivElement>) => {
            const next: EventTarget | null = event.relatedTarget;
            type IsInFunction = (elementId: string) => boolean;

            const isIn: IsInFunction = (elementId: string): boolean => {
              const element: HTMLElement | null =
                document.getElementById(elementId);
              return Boolean(
                next instanceof Node && element && element.contains(next),
              );
            };

            // Into the list's own path box is not leaving the field.
            if (!isIn(inlinePopupId)) {
              setTrigger(null);
            }

            /*
             * Nor is going to its { } button or its list: the field is not
             * done with yet, and saying "Value is required." just as the
             * value is being picked would be wrong.
             */
            const staysInField: boolean =
              Boolean(next instanceof Node && boxRef.current?.contains(next)) ||
              isIn(inlinePopupId) ||
              isIn(popoverId);

            if (!staysInField) {
              props.onBlur?.();
            }
          }}
        />
        {canPick && (
          <button
            type="button"
            className={`self-start ${INSERT_VALUE_BUTTON_CLASS} ${
              props.isCompact ? "m-0.5" : "m-1"
            } ${
              isPopoverOpen
                ? INSERT_VALUE_BUTTON_OPEN_CLASS
                : INSERT_VALUE_BUTTON_IDLE_CLASS
            }`}
            aria-label={translator.translateText(INSERT_VALUE_LABEL)}
            title={translator.translateText(INSERT_VALUE_LABEL)}
            aria-haspopup="dialog"
            aria-expanded={isPopoverOpen}
            data-testid={`${dataTestId}-insert-value`}
            onMouseDown={() => {
              // Before the press takes the focus: where the caret is now.
              savedSelectionRef.current =
                editorRef.current?.getSelection() || null;
            }}
            onClick={() => {
              if (isPopoverOpen) {
                setIsPopoverOpen(false);
                return;
              }

              if (!savedSelectionRef.current) {
                savedSelectionRef.current =
                  editorRef.current?.getSelection() || null;
              }

              setTrigger(null);
              setIsPopoverOpen(true);
            }}
          >
            {"{ }"}
          </button>
        )}
      </div>

      {props.error && (
        <p
          id={errorId}
          data-testid="error-message"
          className="mt-1 text-sm text-red-400"
          role="alert"
        >
          {translator.translateText(props.error)}
        </p>
      )}

      {isPopoverOpen && (
        <ValuePickerPopup
          id={popoverId}
          anchorRef={boxRef}
          mode={ValuePickerPopupMode.Popover}
          ariaLabel="Insert a value"
          onClose={(reason: ValuePickerCloseReason) => {
            setIsPopoverOpen(false);
            savedSelectionRef.current = null;

            if (reason !== ValuePickerCloseReason.Outside) {
              editorRef.current?.focus();
            }
          }}
        >
          <ValuePickerMenu hasSearchBox={true} onPick={pickFromPopover} />
        </ValuePickerPopup>
      )}

      {isInlineOpen && (
        <ValuePickerPopup
          id={inlinePopupId}
          anchorRef={boxRef}
          mode={ValuePickerPopupMode.Inline}
          ariaLabel="Values matching what you typed"
          dataTestId="value-picker-inline"
          onClose={() => {
            editorRef.current?.dismissTrigger();
            setTrigger(null);
          }}
        >
          <ValuePickerMenu
            ref={menuRef}
            hasSearchBox={false}
            query={trigger?.query || ""}
            listboxId={inlineListboxId}
            onActiveOptionChange={setActiveOptionId}
            onPick={pickInline}
          />
        </ValuePickerPopup>
      )}
    </div>
  );
};

export default ValueTextField;
