import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { ColorSwatchOption } from "./ColorPalette";
import { findSwatch, normalizeColorValue, shouldUseDarkMark } from "./ColorValue";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
} from "react";

/*
 * The swatches of a color field, as one radio group: one Tab stop, the arrow
 * keys move between colors and pick as they go, Space or Enter (or a click)
 * picks, and a screen reader hears "Teal, radio button, checked, 3 of 10".
 * The picked color carries a tick and a ring in its own color.
 *
 * An optional field puts its way back to no color first - "No color", or
 * "Auto" for a chart series that should follow the theme - as a radio of the
 * same group, so leaving a field empty is a choice like any other.
 */

export interface ColorSwatchPickDetails {
  // From the keyboard (Space, Enter or an arrow), not a pointer.
  viaKeyboard: boolean;
  /*
   * An arrow key moved to this color. A popover stays open for that, so the
   * reader can keep arrowing; a click or Space/Enter is a choice and closes it.
   */
  isArrowKey: boolean;
}

export interface ClearOption {
  label: string;
  title?: string | undefined;
}

export type ColorSwatchGroupLayout = "row" | "grid";

export interface ComponentProps {
  swatches: ReadonlyArray<ColorSwatchOption>;
  // The field's color, normalized; "" for none.
  value: string;
  onPick: (hex: string | null, details: ColorSwatchPickDetails) => void;
  clearOption?: ClearOption | undefined;
  layout: ColorSwatchGroupLayout;
  ariaLabelledby?: string | undefined;
  ariaLabel?: string | undefined;
  ariaDescribedby?: string | undefined;
  ariaInvalid?: boolean | undefined;
  ariaRequired?: boolean | undefined;
  disabled?: boolean | undefined;
  dataTestId?: string | undefined;
  onFocus?: (() => void) | undefined;
}

interface RadioItem {
  key: string;
  // null for the clear option.
  hex: string | null;
  label: string;
  title: string;
}

export const COLOR_SWATCH_CLASS: string =
  "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform duration-100 motion-reduce:transition-none focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-indigo-500";

export const COLOR_SWATCH_ENABLED_CLASS: string =
  "cursor-pointer hover:scale-110";

export const COLOR_SWATCH_DISABLED_CLASS: string =
  "cursor-not-allowed opacity-50";

/*
 * The picked swatch's ring: a gap the color of the surface it sits on (so it
 * reads as a ring, in either theme, on a card or in a popover), then a ring
 * of the swatch's own color. A thin inner edge keeps a pale custom color
 * from melting into a white card.
 */
export const getSwatchShadow: (hex: string, isPicked: boolean) => string = (
  hex: string,
  isPicked: boolean,
): string => {
  const edge: string = "inset 0 0 0 1px rgb(0 0 0 / 0.12)";

  if (!isPicked) {
    return edge;
  }

  return `${edge}, 0 0 0 2px var(--ou-surface-primary, #ffffff), 0 0 0 4px ${hex}`;
};

const ColorSwatchGroup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);

  const items: Array<RadioItem> = [];

  if (props.clearOption) {
    const label: string =
      translator.translateText(props.clearOption.label) ||
      props.clearOption.label;

    items.push({
      key: "clear",
      hex: null,
      label,
      title:
        translator.translateText(props.clearOption.title) ||
        props.clearOption.title ||
        label,
    });
  }

  for (const swatch of props.swatches) {
    const name: string = translator.translateText(swatch.name) || swatch.name;

    items.push({
      key: swatch.hex,
      hex: normalizeColorValue(swatch.hex),
      label: name,
      title: name,
    });
  }

  const pickedSwatch: ColorSwatchOption | undefined = findSwatch(
    props.value,
    props.swatches,
  );

  const checkedIndex: number = items.findIndex((item: RadioItem): boolean => {
    if (item.hex === null) {
      return !props.value;
    }

    return Boolean(pickedSwatch) && item.hex === normalizeColorValue(pickedSwatch!.hex);
  });

  // The one Tab stop: the checked color, or the first when none is.
  const tabStopIndex: number = checkedIndex >= 0 ? checkedIndex : 0;

  type PickAtFunction = (index: number, details: ColorSwatchPickDetails) => void;

  const pickAt: PickAtFunction = (
    index: number,
    details: ColorSwatchPickDetails,
  ): void => {
    const item: RadioItem | undefined = items[index];

    if (!item || props.disabled) {
      return;
    }

    props.onPick(item.hex, details);
  };

  type OnKeyDownFunction = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void;

  const onKeyDown: OnKeyDownFunction = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    if (props.disabled || items.length === 0) {
      return;
    }

    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % items.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    itemRefs.current[nextIndex]?.focus();
    pickAt(nextIndex, { viaKeyboard: true, isArrowKey: true });
  };

  const renderItem: (item: RadioItem, index: number) => ReactElement = (
    item: RadioItem,
    index: number,
  ): ReactElement => {
    const isChecked: boolean = index === checkedIndex;

    const commonProps: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      "data-testid": string;
    } = {
      type: "button",
      role: "radio",
      "aria-checked": isChecked,
      tabIndex: index === tabStopIndex ? 0 : -1,
      disabled: props.disabled,
      title: item.title,
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown(event, index);
      },
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        pickAt(index, {
          // A click a key made (Space, Enter) has no pointer position.
          viaKeyboard: event.detail === 0,
          isArrowKey: false,
        });
      },
      "data-testid":
        item.hex === null ? "color-picker-clear" : "color-picker-swatch",
    };

    if (item.hex === null) {
      return (
        <button
          key={item.key}
          ref={(element: HTMLButtonElement | null) => {
            itemRefs.current[index] = element;
          }}
          {...commonProps}
          aria-label={item.label}
          className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
            isChecked
              ? "border-indigo-500 bg-indigo-50 text-indigo-700"
              : "border-gray-300 bg-white text-gray-600"
          } ${
            props.disabled
              ? COLOR_SWATCH_DISABLED_CLASS
              : isChecked
                ? "cursor-pointer"
                : "cursor-pointer hover:bg-gray-50"
          }`}
        >
          {isChecked ? (
            <Icon icon={IconProp.Check} className="h-3 w-3" />
          ) : (
            <></>
          )}
          <span>{item.label}</span>
        </button>
      );
    }

    return (
      <button
        key={item.key}
        ref={(element: HTMLButtonElement | null) => {
          itemRefs.current[index] = element;
        }}
        {...commonProps}
        aria-label={item.label}
        data-color={item.hex}
        className={`${COLOR_SWATCH_CLASS} ${
          props.disabled ? COLOR_SWATCH_DISABLED_CLASS : COLOR_SWATCH_ENABLED_CLASS
        }`}
        style={{
          backgroundColor: item.hex,
          boxShadow: getSwatchShadow(item.hex, isChecked),
        }}
      >
        {isChecked ? (
          <Icon
            icon={IconProp.Check}
            className={`h-4 w-4 ${
              shouldUseDarkMark(item.hex) ? "text-gray-900" : "text-white"
            }`}
          />
        ) : (
          <></>
        )}
      </button>
    );
  };

  const clearItem: RadioItem | undefined =
    items[0]?.hex === null ? items[0] : undefined;
  const swatchItems: Array<RadioItem> = clearItem ? items.slice(1) : items;
  const swatchOffset: number = clearItem ? 1 : 0;

  return (
    <div
      role="radiogroup"
      aria-labelledby={props.ariaLabelledby}
      aria-label={props.ariaLabelledby ? undefined : props.ariaLabel}
      aria-describedby={props.ariaDescribedby}
      aria-invalid={props.ariaInvalid ? true : undefined}
      aria-required={props.ariaRequired ? true : undefined}
      aria-disabled={props.disabled ? true : undefined}
      data-testid={props.dataTestId || "color-picker-swatches"}
      onFocus={props.onFocus}
      className={
        props.layout === "grid"
          ? "flex flex-col gap-3"
          : "inline-flex flex-wrap items-center gap-2"
      }
    >
      {props.layout === "grid" ? (
        <>
          {clearItem ? (
            <div className="flex">{renderItem(clearItem, 0)}</div>
          ) : (
            <></>
          )}
          <div className="grid grid-cols-5 justify-items-center gap-x-2 gap-y-2.5">
            {swatchItems.map((item: RadioItem, index: number) => {
              return renderItem(item, index + swatchOffset);
            })}
          </div>
        </>
      ) : (
        items.map((item: RadioItem, index: number) => {
          return renderItem(item, index);
        })
      )}
    </div>
  );
};

export default ColorSwatchGroup;
