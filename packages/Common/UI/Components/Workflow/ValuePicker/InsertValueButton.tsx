/*
 * A button that opens the list of values, for places where the value does
 * not go into a text field of this picker's own: a code editor's toolbar
 * (JSON, an email's HTML), or the Schedule trigger's choice of variable.
 */

import { ValueSuggestionGroup } from "./ValueSuggestion";
import { ValuePickerContextValue, useValuePicker } from "./ValuePickerContext";
import ValuePickerMenu from "./ValuePickerMenu";
import ValuePickerPopup, {
  ValuePickerCloseReason,
  ValuePickerPopupMode,
} from "./ValuePickerPopup";
import { INSERT_VALUE_LABEL } from "./ValueTextField";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useRef,
  useState,
} from "react";

export interface InsertValueButtonProps {
  onPick: (reference: string) => void;
  /** What the button says. Defaults to "{ } Insert value". */
  children?: ReactNode | undefined;
  /** The button's accessible name, when its text is not enough. */
  ariaLabel?: string | undefined;
  groupFilter?: ((group: ValueSuggestionGroup) => boolean) | undefined;
  searchPlaceholder?: string | undefined;
  emptyMessage?: string | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
  /** Called as the button is pressed, before it takes the focus. */
  onPressStart?: (() => void) | undefined;
  /** Where the focus goes when the list closes with Escape or Tab. */
  onCloseFocus?: (() => void) | undefined;
}

const DEFAULT_CLASS: string =
  "inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const InsertValueButton: FunctionComponent<InsertValueButtonProps> = (
  props: InsertValueButtonProps,
): ReactElement | null => {
  const picker: ValuePickerContextValue = useValuePicker();
  const anchorRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (!picker.isAvailable) {
    return null;
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={props.className || DEFAULT_CLASS}
        aria-label={props.ariaLabel || (props.children ? undefined : INSERT_VALUE_LABEL)}
        title={props.ariaLabel || INSERT_VALUE_LABEL}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        data-testid={props.dataTestId || "insert-value-button"}
        onMouseDown={() => {
          props.onPressStart?.();
        }}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        {props.children || (
          <>
            <span className="font-mono text-[11px] leading-none">{"{ }"}</span>
            Insert value
          </>
        )}
      </button>

      {isOpen && (
        <ValuePickerPopup
          anchorRef={anchorRef}
          mode={ValuePickerPopupMode.Popover}
          ariaLabel="Insert a value"
          onClose={(reason: ValuePickerCloseReason) => {
            setIsOpen(false);

            if (reason !== ValuePickerCloseReason.Outside) {
              if (props.onCloseFocus) {
                props.onCloseFocus();
              } else {
                anchorRef.current?.focus();
              }
            }
          }}
        >
          <ValuePickerMenu
            hasSearchBox={true}
            groupFilter={props.groupFilter}
            searchPlaceholder={props.searchPlaceholder}
            emptyMessage={props.emptyMessage}
            onPick={(reference: string) => {
              setIsOpen(false);
              props.onPick(reference);
            }}
          />
        </ValuePickerPopup>
      )}
    </>
  );
};

export default InsertValueButton;
