import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
} from "../../../Types/UseAnchoredFieldPopup";
import DROPDOWN_MENU_Z_INDEX from "../../Dropdown/DropdownMenuZIndex";
import Icon from "../../Icon/Icon";
import Input, { InputType } from "../../Input/Input";
import Color from "../../../../Types/Color";
import IconProp from "../../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChromePicker, ColorResult } from "react-color";

// ChromePicker renders at a fixed intrinsic width.
const COLOR_PICKER_POPUP_WIDTH_PX: number = 225;
const COLOR_PICKER_POPUP_MAX_HEIGHT_PX: number = 320;

export interface ComponentProps {
  onChange: (value: Color | null) => void;
  initialValue?: undefined | Color;
  placeholder: string;
  onFocus?: (() => void) | undefined;
  tabIndex?: number | undefined;
  value?: string | undefined;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  onEnterPress?: (() => void) | undefined;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
}

const ColorPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [color, setColor] = useState<string>("");
  const {
    anchorRef,
    popupRef,
    isPopupOpen,
    popupId,
    popupPosition,
    portalTarget,
    onTriggerKeyDown,
    togglePopup,
  }: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: COLOR_PICKER_POPUP_MAX_HEIGHT_PX,
    popupWidth: COLOR_PICKER_POPUP_WIDTH_PX,
  });

  const isInteractive: boolean = !props.readOnly && !props.disabled;
  const generatedId: string = useId();
  const errorId: string = `${generatedId}-color-picker-error`;

  const [isInitialValuesInitialized, setIsInitialValuesInitialized] =
    useState<boolean>(false);

  useEffect(() => {
    if (props.initialValue && !isInitialValuesInitialized) {
      setColor(props.initialValue.toString());
      setIsInitialValuesInitialized(true);
    }
  }, [props.initialValue]);

  type HandleChangeFunction = (color: string) => void;

  const handleChange: HandleChangeFunction = (color: string): void => {
    setColor(color);
    if (!color) {
      return props.onChange(null);
    }
    props.onChange(new Color(color));
  };

  return (
    <div>
      <div
        ref={anchorRef}
        className="flex block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
      >
        <div
          onClick={() => {
            if (isInteractive) {
              togglePopup();
            }
          }}
          aria-hidden="true"
          className="rounded h-5 w-5 border border-gray-200 cursor-pointer"
          style={{ backgroundColor: color.toString() }}
        ></div>

        <Input
          onClick={() => {
            if (isInteractive) {
              togglePopup();
            }
          }}
          /*
           * The field is a trigger, not a text box: it is readOnly and its only
           * job is to open the picker. Without this a keyboard user cannot
           * reach the picker at all, which on a required colour - the Create
           * Label form - means they cannot submit the form either.
           */
          onKeyDown={isInteractive ? onTriggerKeyDown : undefined}
          ariaHasPopup="dialog"
          ariaExpanded={isPopupOpen}
          ariaControls={isPopupOpen ? popupId : undefined}
          /*
           * The message below belongs to the whole control rather than to this
           * input, so it has to be pointed at explicitly - otherwise "Label
           * Color is required." is on screen and nowhere in the accessibility
           * tree, and a screen reader user is told only that the form failed.
           */
          ariaDescribedby={props.error ? errorId : undefined}
          ariaInvalid={Boolean(props.error)}
          disabled={props.disabled}
          dataTestId={props.dataTestId}
          onBlur={props.onBlur}
          onEnterPress={props.onEnterPress}
          className="border-none focus:outline-none w-full pl-2 text-gray-500 cursor-pointer"
          outerDivClassName='className="border-none focus:outline-none w-full pl-2 text-gray-500 cursor-pointer"'
          placeholder={props.placeholder}
          value={color || props.value}
          readOnly={true}
          type={InputType.TEXT}
          tabIndex={props.tabIndex}
          ariaLabelledby={props.ariaLabelledby}
          onChange={(value: string) => {
            if (!value) {
              return handleChange("");
            }
          }}
          onFocus={props.onFocus || undefined}
        />
        {color && !props.disabled && (
          /*
           * A button, not a bare svg with a click handler: undoing a choice has
           * to be reachable by the same keyboard that made it.
           */
          <button
            type="button"
            aria-label="Clear color"
            title="Clear color"
            className="flex items-center text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
            onClick={() => {
              setColor("");
              if (props.onChange) {
                props.onChange(null);
              }
            }}
          >
            <Icon icon={IconProp.Close} className="h-5 w-5 cursor-pointer" />
          </button>
        )}
      </div>
      {/*
       * Portalled out of the modal body, which is a scroll container and would
       * otherwise clip the saturation square, hue slider and hex input.
       */}
      {isPopupOpen && portalTarget
        ? createPortal(
            <div
              ref={popupRef}
              data-testid="color-picker-popup"
              id={popupId}
              role="dialog"
              aria-label="Color picker"
              tabIndex={-1}
              className="fixed overflow-auto rounded-md shadow-lg"
              style={{
                bottom: popupPosition?.bottom,
                left: popupPosition?.left ?? 0,
                maxHeight: popupPosition?.maxHeight,
                top: popupPosition?.top,
                visibility: popupPosition ? "visible" : "hidden",
                zIndex: DROPDOWN_MENU_Z_INDEX,
              }}
            >
              <ChromePicker
                color={color}
                /*
                 * The field stores a bare hex, so an alpha channel it cannot
                 * represent is worse than no alpha at all: react-color reports
                 * a fully transparent colour as the literal "transparent",
                 * which sails through Color (it validates nothing) and is then
                 * rejected on save as longer than the ten characters the column
                 * holds - for a colour the user can see in the swatch.
                 */
                disableAlpha={true}
                /*
                 * One callback, not two. The swatch used to be painted from
                 * onChange and the form fed from onChangeComplete, which
                 * react-color debounces by 100ms — so for that window the field
                 * showed a colour the form did not hold yet. The value always
                 * arrived in the end, but there is no reason for the two to
                 * disagree at all.
                 */
                onChange={(color: ColorResult) => {
                  return handleChange(color.hex);
                }}
              />
            </div>,
            portalTarget,
          )
        : null}
      {props.error && (
        <p
          id={errorId}
          role="alert"
          data-testid="error-message"
          className="mt-1 text-sm text-red-400"
        >
          {props.error}
        </p>
      )}
    </div>
  );
};

export default ColorPicker;
