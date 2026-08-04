import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
} from "../../../Types/UseAnchoredFieldPopup";
import DROPDOWN_MENU_Z_INDEX from "../../Dropdown/DropdownMenuZIndex";
import Icon from "../../Icon/Icon";
import Input, { InputType } from "../../Input/Input";
import IconProp from "../../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

const ICON_PICKER_POPUP_WIDTH_PX: number = 320;
const ICON_PICKER_POPUP_MAX_HEIGHT_PX: number = 400;

export interface ComponentProps {
  onChange: (value: IconProp | null) => void;
  initialValue?: undefined | IconProp;
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

const IconPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedIcon, setSelectedIcon] = useState<IconProp | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const {
    anchorRef,
    popupRef,
    isPopupOpen,
    popupPosition,
    portalTarget,
    closePopup,
    togglePopup,
  }: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: ICON_PICKER_POPUP_MAX_HEIGHT_PX,
    popupWidth: ICON_PICKER_POPUP_WIDTH_PX,
  });

  const [isInitialValuesInitialized, setIsInitialValuesInitialized] =
    useState<boolean>(false);

  useEffect(() => {
    if (props.initialValue && !isInitialValuesInitialized) {
      setSelectedIcon(props.initialValue);
      setIsInitialValuesInitialized(true);
    }
  }, [props.initialValue]);

  type HandleChangeFunction = (icon: IconProp | null) => void;

  const handleChange: HandleChangeFunction = (icon: IconProp | null): void => {
    setSelectedIcon(icon);
    props.onChange(icon);
    closePopup(true);
  };

  // Get all icons from IconProp enum
  const allIcons: Array<IconProp> = Object.values(IconProp);

  // Filter icons based on search query
  const filteredIcons: Array<IconProp> = allIcons.filter((icon: IconProp) => {
    return icon.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div>
      <div
        ref={anchorRef}
        className="flex block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
      >
        <div
          onClick={() => {
            if (!props.readOnly && !props.disabled) {
              togglePopup();
            }
          }}
          className="flex items-center justify-center h-5 w-5 cursor-pointer"
        >
          {selectedIcon ? (
            <Icon icon={selectedIcon} className="h-5 w-5 text-gray-600" />
          ) : (
            <div className="h-5 w-5 border border-dashed border-gray-300 rounded"></div>
          )}
        </div>

        <Input
          onClick={() => {
            if (!props.readOnly && !props.disabled) {
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
          value={selectedIcon || props.value || ""}
          readOnly={true}
          type={InputType.TEXT}
          tabIndex={props.tabIndex}
          ariaLabelledby={props.ariaLabelledby}
          onChange={() => {}}
          onFocus={props.onFocus || undefined}
        />
        {selectedIcon && !props.disabled && (
          <Icon
            icon={IconProp.Close}
            className="text-gray-400 h-5 w-5 cursor-pointer hover:text-gray-600"
            onClick={() => {
              setSelectedIcon(null);
              props.onChange(null);
            }}
          />
        )}
      </div>
      {/*
       * Portalled out of the modal body, which is a scroll container capped at
       * calc(100vh - 3rem) and would otherwise clip the icon grid.
       */}
      {isPopupOpen && portalTarget
        ? createPortal(
            <div
              ref={popupRef}
              data-testid="icon-picker-popup"
              tabIndex={-1}
              className="fixed flex flex-col overflow-hidden bg-white border border-gray-200 rounded-lg shadow-lg p-3"
              style={{
                bottom: popupPosition?.bottom,
                left: popupPosition?.left ?? 0,
                maxHeight: popupPosition?.maxHeight,
                top: popupPosition?.top,
                visibility: popupPosition ? "visible" : "hidden",
                width: popupPosition?.width ?? ICON_PICKER_POPUP_WIDTH_PX,
                zIndex: DROPDOWN_MENU_Z_INDEX,
              }}
            >
              {/* Search input */}
              <div className="mb-3 flex-shrink-0">
                <Input
                  type={InputType.TEXT}
                  placeholder="Search icons..."
                  value={searchQuery}
                  onChange={(value: string) => {
                    setSearchQuery(value);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>

              {/* Icons grid */}
              <div className="grid grid-cols-6 gap-2 min-h-0 flex-1 overflow-y-auto">
                {filteredIcons.map((icon: IconProp) => {
                  return (
                    <div
                      key={icon}
                      onClick={() => {
                        handleChange(icon);
                      }}
                      className={`flex items-center justify-center p-2 rounded cursor-pointer hover:bg-gray-100 ${
                        selectedIcon === icon
                          ? "bg-indigo-100 ring-2 ring-indigo-500"
                          : ""
                      }`}
                      title={icon}
                    >
                      <Icon icon={icon} className="h-5 w-5 text-gray-600" />
                    </div>
                  );
                })}
              </div>

              {filteredIcons.length === 0 && (
                <div className="text-center text-gray-500 py-4">
                  No icons found
                </div>
              )}
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

export default IconPicker;
