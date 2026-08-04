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
    popupPosition,
    portalTarget,
    togglePopup,
  }: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: COLOR_PICKER_POPUP_MAX_HEIGHT_PX,
    popupWidth: COLOR_PICKER_POPUP_WIDTH_PX,
  });

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
            if (!props.readOnly) {
              togglePopup();
            }
          }}
          className="rounded h-5 w-5 border border-gray-200 cursor-pointer"
          style={{ backgroundColor: color.toString() }}
        ></div>

        <Input
          onClick={() => {
            if (!props.readOnly) {
              togglePopup();
            }
          }}
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
          <Icon
            icon={IconProp.Close}
            className="text-gray-400 h-5 w-5 cursor-pointer hover:text-gray-600"
            onClick={() => {
              setColor("");
              if (props.onChange) {
                props.onChange(null);
              }
            }}
          />
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
                onChange={(color: ColorResult) => {
                  setColor(color.hex);
                }}
                onChangeComplete={(color: ColorResult) => {
                  return handleChange(color.hex);
                }}
              />
            </div>,
            portalTarget,
          )
        : null}
      {props.error && (
        <p data-testid="error-message" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default ColorPicker;
