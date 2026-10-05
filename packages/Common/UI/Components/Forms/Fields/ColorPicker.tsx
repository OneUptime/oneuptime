import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
} from "../../../Types/UseAnchoredFieldPopup";
import {
  COLOR_PICKER_SWATCHES,
  ColorSwatchOption,
} from "../../ColorPicker/ColorPalette";
import ColorSwatchGroup, {
  COLOR_SWATCH_CLASS,
  COLOR_SWATCH_DISABLED_CLASS,
  COLOR_SWATCH_ENABLED_CLASS,
  ColorSwatchPickDetails,
  getSwatchShadow,
} from "../../ColorPicker/ColorSwatchGroup";
import {
  findSwatch,
  normalizeColorValue,
  shouldUseDarkMark,
} from "../../ColorPicker/ColorValue";
import CustomColorPanel from "../../ColorPicker/CustomColorPanel";
import DROPDOWN_MENU_Z_INDEX from "../../Dropdown/DropdownMenuZIndex";
import Icon from "../../Icon/Icon";
import Color from "../../../../Types/Color";
import IconProp from "../../../../Types/Icon/IconProp";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/*
 * The color field, everywhere a color is chosen: labels, states and
 * severities, monitor statuses, incident roles, services, a status page's bar
 * colors, custom field and form options, workflow values and chart series.
 *
 * It leads with ready swatches to click (ColorPicker/ColorPalette), ticks the
 * one picked, and keeps an exact color one step away behind "Custom color"
 * (ColorPicker/CustomColorPanel): a saturation square, a hue strip and a
 * checked box for a color code. An optional field offers "No color" as the
 * first choice. What is stored is unchanged: a hex string.
 *
 * Two layouts of the same parts:
 *
 *   - "inline", in a form: the swatches are the field. One click picks a
 *     color; "Custom color" opens the fine picker under them, inside the
 *     form, so nothing floats over the dialog's buttons or out of the dialog
 *     - the popup in the report sat over Create Label's footer and past the
 *     dialog's edge.
 *   - "compact", where a row has room for one control (a custom field's
 *     options, a workflow value): a field-like button showing the color and
 *     its name opens the same swatches in a popover. The popover stays inside
 *     the dialog body and the window (UseAnchoredFieldPopup's
 *     stayInsideBoundary), and closes on a pick, on Escape or on a press
 *     anywhere else.
 */

export type ColorPickerLayout = "inline" | "compact";

export const COLOR_PICKER_POPUP_WIDTH_PX: number = 232;
export const COLOR_PICKER_POPUP_MAX_HEIGHT_PX: number = 480;

export const NO_COLOR_LABEL: string = "No color";

/*
 * The custom color button, drawn as a color wheel so it reads as "any other
 * color" beside the swatches.
 */
const COLOR_WHEEL: string =
  "conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #84cc16, #10b981, #06b6d4, #3b82f6, #6366f1, #a855f7, #d946ef, #ef4444)";

const SWATCH_EDGE: string = "inset 0 0 0 1px rgb(0 0 0 / 0.12)";

export interface ComponentProps {
  onChange: (value: Color | null) => void;
  /*
   * The field's color. Given, the field shows it and nothing else (a form,
   * an options row, a workflow cell all hold the value themselves); left
   * out, the field keeps its own, starting from initialValue.
   */
  value?: Color | string | null | undefined;
  initialValue?: Color | string | undefined;
  layout?: ColorPickerLayout | undefined;
  /*
   * Offer a way back to no color, as the first choice (default true). A
   * form's required color says false: there is always one picked.
   */
  isClearable?: boolean | undefined;
  // The clear choice's words: "No color", or "Auto" for a chart series.
  clearLabel?: string | undefined;
  clearTitle?: string | undefined;
  // The ready colors; the shared palette unless a caller has its own.
  swatches?: ReadonlyArray<ColorSwatchOption> | undefined;
  // What the compact button says while no color is picked.
  placeholder?: string | undefined;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaLabel?: string | undefined;
  dataTestId?: string | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  tabIndex?: number | undefined;
}

const ColorPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const layout: ColorPickerLayout = props.layout || "inline";
  const swatches: ReadonlyArray<ColorSwatchOption> =
    props.swatches || COLOR_PICKER_SWATCHES;
  const isClearable: boolean = props.isClearable !== false;
  const isInteractive: boolean = !props.readOnly && !props.disabled;

  const generatedId: string = useId();
  const errorId: string = `${generatedId}-color-picker-error`;
  const panelId: string = `${generatedId}-color-picker-custom`;
  const valueTextId: string = `${generatedId}-color-picker-value`;
  const ownLabelId: string = `${generatedId}-color-picker-label`;
  const customValueId: string = `${generatedId}-color-picker-custom-value`;

  const isControlled: boolean = props.value !== undefined;
  const [ownValue, setOwnValue] = useState<string>((): string => {
    return normalizeColorValue(props.initialValue);
  });
  const hasOwnChangeRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  /*
   * An uncontrolled field adopts an initial color that arrives after it
   * mounted (an edit form whose record loads late), until someone picks.
   */
  useEffect(() => {
    if (isControlled || hasOwnChangeRef.current) {
      return;
    }

    const initial: string = normalizeColorValue(props.initialValue);

    if (initial) {
      setOwnValue(initial);
    }
  }, [props.initialValue?.toString()]);

  const value: string = isControlled
    ? normalizeColorValue(props.value)
    : ownValue;

  const pickedSwatch: ColorSwatchOption | undefined = findSwatch(
    value,
    swatches,
  );
  const isCustom: boolean = Boolean(value) && !pickedSwatch;

  const [isCustomOpen, setIsCustomOpen] = useState<boolean>(false);
  const [shouldFocusCodeInput, setShouldFocusCodeInput] =
    useState<boolean>(false);

  const rootRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const customButtonRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const panelWrapperRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  const {
    anchorRef,
    popupRef,
    isPopupOpen,
    popupId,
    popupPosition,
    portalTarget,
    closePopup,
    onTriggerKeyDown,
    togglePopup,
  }: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: COLOR_PICKER_POPUP_MAX_HEIGHT_PX,
    popupWidth: COLOR_PICKER_POPUP_WIDTH_PX,
    stayInsideBoundary: true,
    // The popover grows when Custom color opens, so it is placed again.
    repositionKey: isCustomOpen ? "custom" : "swatches",
    getInitialFocusElement: (popup: HTMLElement): HTMLElement | null => {
      return (
        popup.querySelector<HTMLElement>(
          '[role="radio"][aria-checked="true"]',
        ) || popup.querySelector<HTMLElement>('[role="radio"]')
      );
    },
  });

  /*
   * The compact popover opens on the custom picker when the color is a
   * custom one, so it shows the color it holds; it starts on the swatches
   * every other time.
   */
  useEffect(() => {
    if (layout !== "compact") {
      return;
    }

    if (isPopupOpen) {
      setIsCustomOpen(isCustom);
    } else {
      setIsCustomOpen(false);
      setShouldFocusCodeInput(false);
    }
  }, [isPopupOpen]);

  // An inline panel opened at the foot of a dialog is scrolled into view.
  useEffect(() => {
    if (layout !== "inline" || !isCustomOpen) {
      return;
    }

    const wrapper: HTMLDivElement | null = panelWrapperRef.current;

    if (wrapper && typeof wrapper.scrollIntoView === "function") {
      wrapper.scrollIntoView({ block: "nearest" });
    }
  }, [isCustomOpen]);

  type CommitFunction = (hex: string | null) => void;

  const commit: CommitFunction = (hex: string | null): void => {
    hasOwnChangeRef.current = true;

    if (!isControlled) {
      setOwnValue(hex || "");
    }

    props.onChange(hex ? new Color(hex) : null);
  };

  type OpenCustomFunction = (viaKeyboard: boolean) => void;

  const toggleCustom: OpenCustomFunction = (viaKeyboard: boolean): void => {
    if (!isInteractive) {
      return;
    }

    setShouldFocusCodeInput(!isCustomOpen && viaKeyboard);
    setIsCustomOpen(!isCustomOpen);
  };

  type CloseCustomFunction = () => void;

  // Done or Escape in the inline panel: close it, and put focus back.
  const closeInlineCustom: CloseCustomFunction = (): void => {
    setIsCustomOpen(false);
    setShouldFocusCodeInput(false);
    customButtonRef.current?.focus();
  };

  type PickFunction = (
    hex: string | null,
    details: ColorSwatchPickDetails,
  ) => void;

  const onSwatchPick: PickFunction = (
    hex: string | null,
    details: ColorSwatchPickDetails,
  ): void => {
    commit(hex);

    if (layout === "compact") {
      // An arrow is still choosing; a click or Space/Enter has chosen.
      if (!details.isArrowKey) {
        closePopup(true);
      }
      return;
    }

    // A ready color picked: the exact-color picker has done its job.
    if (isCustomOpen && !details.isArrowKey) {
      setIsCustomOpen(false);
      setShouldFocusCodeInput(false);
    }
  };

  const swatchName: (swatch: ColorSwatchOption) => string = (
    swatch: ColorSwatchOption,
  ): string => {
    return translator.translateText(swatch.name) || swatch.name;
  };

  const clearLabel: string = props.clearLabel || NO_COLOR_LABEL;

  const isInsideField: (node: Node | null) => boolean = (
    node: Node | null,
  ): boolean => {
    if (!node) {
      return false;
    }

    return Boolean(
      rootRef.current?.contains(node) || popupRef.current?.contains(node),
    );
  };

  const errorElement: ReactElement = props.error ? (
    <p
      id={errorId}
      role="alert"
      data-testid="error-message"
      className="mt-1 text-sm text-red-400"
    >
      {props.error}
    </p>
  ) : (
    <></>
  );

  const renderCustomMark: (sizeClass: string) => ReactElement = (
    sizeClass: string,
  ): ReactElement => {
    if (isCustom) {
      return (
        <span
          aria-hidden="true"
          className={`flex items-center justify-center rounded-full ${sizeClass}`}
          style={{ backgroundColor: value, boxShadow: SWATCH_EDGE }}
        >
          <Icon
            icon={IconProp.Check}
            className={`h-3 w-3 ${
              shouldUseDarkMark(value) ? "text-gray-900" : "text-white"
            }`}
          />
        </span>
      );
    }

    return (
      <span
        aria-hidden="true"
        className={`flex items-center justify-center rounded-full ${sizeClass}`}
        style={{ backgroundColor: "#ffffff", boxShadow: SWATCH_EDGE }}
      >
        <Icon icon={IconProp.Add} className="h-3 w-3 text-gray-700" />
      </span>
    );
  };

  const customLabel: string =
    translator.translateText("Custom color") || "Custom color";

  const rootProps: React.HTMLAttributes<HTMLDivElement> & {
    "data-testid": string;
    "data-value": string;
    "data-layout": ColorPickerLayout;
  } = {
    "data-testid": props.dataTestId || "color-picker",
    "data-value": value,
    "data-layout": layout,
    onFocus: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!isInsideField(event.relatedTarget as Node | null)) {
        props.onFocus?.();
      }
    },
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!isInsideField(event.relatedTarget as Node | null)) {
        props.onBlur?.();
      }
    },
  };

  if (layout === "inline") {
    return (
      <div ref={rootRef} className="w-full" {...rootProps}>
        <div className="flex flex-wrap items-center gap-2">
          <ColorSwatchGroup
            layout="row"
            swatches={swatches}
            value={value}
            onPick={onSwatchPick}
            clearOption={
              isClearable
                ? { label: clearLabel, title: props.clearTitle }
                : undefined
            }
            ariaLabelledby={props.ariaLabelledby}
            ariaLabel={props.ariaLabel || translator.translateText("Color")}
            ariaDescribedby={props.error ? errorId : undefined}
            ariaInvalid={Boolean(props.error)}
            ariaRequired={!isClearable}
            disabled={!isInteractive}
          />
          <button
            ref={customButtonRef}
            type="button"
            aria-label={customLabel}
            title={customLabel}
            aria-expanded={isCustomOpen}
            aria-controls={isCustomOpen ? panelId : undefined}
            aria-describedby={isCustom ? customValueId : undefined}
            data-testid="color-picker-custom"
            data-picked={isCustom ? "true" : "false"}
            disabled={!isInteractive}
            className={`${COLOR_SWATCH_CLASS} ${
              isInteractive
                ? COLOR_SWATCH_ENABLED_CLASS
                : COLOR_SWATCH_DISABLED_CLASS
            }`}
            style={{
              background: COLOR_WHEEL,
              boxShadow: isCustom
                ? getSwatchShadow(value, true)
                : getSwatchShadow("#ffffff", false),
            }}
            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
              toggleCustom(event.detail === 0);
            }}
          >
            {renderCustomMark("h-[18px] w-[18px]")}
          </button>
          {isCustom ? (
            <span
              id={customValueId}
              data-testid="color-picker-custom-value"
              className="font-mono text-xs text-gray-500"
            >
              {value}
            </span>
          ) : (
            <></>
          )}
        </div>
        {isCustomOpen ? (
          <div ref={panelWrapperRef} className="mt-3 w-full max-w-xs">
            <CustomColorPanel
              id={panelId}
              value={value}
              onChange={(hex: string) => {
                commit(hex);
              }}
              onDone={closeInlineCustom}
              autoFocusCodeInput={shouldFocusCodeInput}
              disabled={!isInteractive}
            />
          </div>
        ) : (
          <></>
        )}
        {errorElement}
      </div>
    );
  }

  const valueText: string = pickedSwatch
    ? swatchName(pickedSwatch)
    : value ||
      translator.translateText(props.placeholder || NO_COLOR_LABEL) ||
      NO_COLOR_LABEL;

  return (
    <div ref={rootRef} className="w-full" {...rootProps}>
      {props.ariaLabelledby ? (
        <></>
      ) : (
        <span id={ownLabelId} className="sr-only">
          {props.ariaLabel || translator.translateText("Color") || "Color"}
        </span>
      )}
      <div ref={anchorRef} className="w-full">
        <button
          type="button"
          data-testid="color-picker-trigger"
          aria-haspopup="dialog"
          aria-expanded={isPopupOpen}
          aria-controls={isPopupOpen ? popupId : undefined}
          /*
           * Named by the field's label and then the color it holds - "Color
           * for High, Red" - so the value is heard without opening it.
           */
          aria-labelledby={`${props.ariaLabelledby || ownLabelId} ${valueTextId}`}
          aria-describedby={props.error ? errorId : undefined}
          aria-invalid={props.error ? true : undefined}
          disabled={!isInteractive}
          tabIndex={props.tabIndex}
          onClick={() => {
            if (isInteractive) {
              togglePopup();
            }
          }}
          onKeyDown={isInteractive ? onTriggerKeyDown : undefined}
          className="flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white py-2 pl-3 pr-2 text-left text-sm text-gray-900 focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-1 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
        >
          <span
            aria-hidden="true"
            data-testid="color-picker-trigger-swatch"
            className={`h-5 w-5 shrink-0 rounded-full ${
              value ? "" : "border border-dashed border-gray-300"
            }`}
            style={
              value
                ? { backgroundColor: value, boxShadow: SWATCH_EDGE }
                : undefined
            }
          ></span>
          <span
            id={valueTextId}
            className={`min-w-0 flex-1 truncate ${
              value ? (isCustom ? "font-mono" : "") : "text-gray-500"
            }`}
          >
            {valueText}
          </span>
          <Icon
            icon={IconProp.ChevronDown}
            className="h-4 w-4 shrink-0 text-gray-400"
          />
        </button>
      </div>
      {isPopupOpen && portalTarget
        ? createPortal(
            <div
              ref={popupRef}
              data-testid="color-picker-popup"
              id={popupId}
              role="dialog"
              aria-label={translator.translateText("Color picker")}
              tabIndex={-1}
              className="fixed overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white p-3 shadow-lg focus:outline-none"
              style={{
                bottom: popupPosition?.bottom,
                left: popupPosition?.left ?? 0,
                maxHeight: popupPosition?.maxHeight,
                top: popupPosition?.top,
                width: popupPosition?.width ?? COLOR_PICKER_POPUP_WIDTH_PX,
                visibility: popupPosition ? "visible" : "hidden",
                zIndex: DROPDOWN_MENU_Z_INDEX,
              }}
            >
              <ColorSwatchGroup
                layout="grid"
                swatches={swatches}
                value={value}
                onPick={onSwatchPick}
                clearOption={
                  isClearable
                    ? { label: clearLabel, title: props.clearTitle }
                    : undefined
                }
                ariaLabelledby={props.ariaLabelledby}
                ariaLabel={
                  props.ariaLabel || translator.translateText("Color")
                }
                disabled={!isInteractive}
              />
              <div className="mt-3 border-t border-gray-100 pt-2">
                <button
                  ref={customButtonRef}
                  type="button"
                  aria-expanded={isCustomOpen}
                  aria-controls={isCustomOpen ? panelId : undefined}
                  data-testid="color-picker-custom"
                  data-picked={isCustom ? "true" : "false"}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    toggleCustom(event.detail === 0);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{ background: COLOR_WHEEL }}
                  >
                    {renderCustomMark("h-4 w-4")}
                  </span>
                  <span className="min-w-0 flex-1">{customLabel}</span>
                  {isCustom ? (
                    <span
                      data-testid="color-picker-custom-value"
                      className="font-mono text-xs text-gray-500"
                    >
                      {value}
                    </span>
                  ) : (
                    <></>
                  )}
                  <Icon
                    icon={
                      isCustomOpen ? IconProp.ChevronUp : IconProp.ChevronDown
                    }
                    className="h-4 w-4 shrink-0 text-gray-400"
                  />
                </button>
                {isCustomOpen ? (
                  <CustomColorPanel
                    id={panelId}
                    value={value}
                    onChange={(hex: string) => {
                      commit(hex);
                    }}
                    onDone={() => {
                      closePopup(true);
                    }}
                    autoFocusCodeInput={shouldFocusCodeInput}
                    disabled={!isInteractive}
                    className="mt-2 w-full"
                  />
                ) : (
                  <></>
                )}
              </div>
            </div>,
            portalTarget,
          )
        : null}
      {errorElement}
    </div>
  );
};

export default ColorPicker;
