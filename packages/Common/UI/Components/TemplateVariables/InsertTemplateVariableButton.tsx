/*
 * "{ } Insert variable" in an editor's toolbar: opens the field's template
 * variables with a search box, and puts the one picked where the cursor was.
 * The Markdown editor and the code editor both have one when their field
 * has variables.
 *
 * The cursor is remembered as the button is pressed (onPressStart): the
 * search box takes the focus, and with it a visual editor's selection.
 */

import TemplateVariableMenu from "./TemplateVariableMenu";
import { VALUE_PICKER_MIN_WIDTH_PX } from "../Workflow/ValuePicker/ValuePickerPopup";
import TemplateVariablePopup, {
  TemplateVariablePopupCloseReason,
  TemplateVariablePopupMode,
} from "./TemplateVariablePopup";
import TemplateVariablesCopy from "./TemplateVariablesCopy";
import {
  TemplateVariable,
  TemplateVariableGroups,
} from "../../../Types/Template/TemplateVariable";
import useTranslateValue from "../../Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useRef,
  useState,
} from "react";

export interface InsertTemplateVariableButtonProps {
  groups: TemplateVariableGroups;
  onPick: (variable: TemplateVariable) => void;
  /** Called as the button is pressed, before the list takes the focus. */
  onPressStart?: (() => void) | undefined;
  /** Where the focus goes when the list closes with Escape or Tab. */
  onCloseFocus?: (() => void) | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

// The code editor's toolbar buttons look like this.
export const INSERT_TEMPLATE_VARIABLE_BUTTON_CLASS: string =
  "inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const InsertTemplateVariableButton: FunctionComponent<
  InsertTemplateVariableButtonProps
> = (props: InsertTemplateVariableButtonProps): ReactElement => {
  const { translateString } = useTranslateValue();
  const anchorRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const popupId: string = `insert-template-variable-${useId()}`;

  const label: string =
    translateString(TemplateVariablesCopy.insertButton) ||
    TemplateVariablesCopy.insertButton;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={props.className || INSERT_TEMPLATE_VARIABLE_BUTTON_CLASS}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popupId : undefined}
        data-testid={props.dataTestId || "insert-template-variable-button"}
        onMouseDown={(event: React.MouseEvent<HTMLButtonElement>) => {
          /*
           * Keep the editor's focus and selection while the button is
           * pressed, as its other toolbar buttons do.
           */
          event.preventDefault();
          props.onPressStart?.();
        }}
        onClick={() => {
          if (!isOpen) {
            // A keyboard press has no mousedown: remember the cursor here too.
            props.onPressStart?.();
          }
          setIsOpen(!isOpen);
        }}
      >
        <span
          aria-hidden="true"
          className="font-mono text-[11px] font-semibold leading-none"
        >
          {"{ }"}
        </span>
        <span>{label}</span>
      </button>

      {isOpen ? (
        <TemplateVariablePopup
          id={popupId}
          mode={TemplateVariablePopupMode.Popover}
          ariaLabel={label}
          dataTestId="insert-template-variable-popup"
          getAnchorRect={(): DOMRect | null => {
            const rect: DOMRect | undefined =
              anchorRef.current?.getBoundingClientRect();

            if (!rect) {
              return null;
            }

            /*
             * The list ends where the button ends: the button sits at the
             * right of its toolbar, and a list hanging out past the editor -
             * past the dialog - looked lost.
             */
            const width: number = Math.max(
              rect.width,
              VALUE_PICKER_MIN_WIDTH_PX,
            );

            return {
              left: rect.right - width,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: width,
              height: rect.height,
              x: rect.right - width,
              y: rect.top,
              toJSON: (): Record<string, number> => {
                return {};
              },
            } as DOMRect;
          }}
          isInsideAnchor={(target: Node): boolean => {
            return Boolean(anchorRef.current?.contains(target));
          }}
          onClose={(reason: TemplateVariablePopupCloseReason) => {
            setIsOpen(false);

            if (reason !== TemplateVariablePopupCloseReason.Outside) {
              if (props.onCloseFocus) {
                props.onCloseFocus();
              } else {
                anchorRef.current?.focus();
              }
            }
          }}
        >
          <TemplateVariableMenu
            groups={props.groups}
            hasSearchBox={true}
            onPick={(variable: TemplateVariable) => {
              setIsOpen(false);
              props.onPick(variable);
            }}
          />
        </TemplateVariablePopup>
      ) : null}
    </>
  );
};

export default InsertTemplateVariableButton;
