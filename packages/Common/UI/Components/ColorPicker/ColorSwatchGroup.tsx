import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { ColorSwatchOption } from "./ColorPalette";
import { findSwatch, getMarkColor, normalizeColorValue } from "./ColorValue";
import React, { FunctionComponent, ReactElement, useRef } from "react";

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

/*
 * "row": the swatches in two runs of equal length that wrap as wholes - ten
 * colors sit on one line where there is room for them, and on two lines of
 * five on a phone, never nine and one. "grid": five to a line, for a
 * popover of a fixed width.
 */
export type ColorSwatchGroupLayout = "row" | "grid";

/*
 * The swatches of a row layout, split into the runs that wrap as wholes:
 * one run up to five colors, otherwise two halves (the first one the longer).
 */
export const splitSwatchRuns: <T>(
  items: ReadonlyArray<T>,
) => Array<Array<T>> = <T,>(items: ReadonlyArray<T>): Array<Array<T>> => {
  if (items.length <= 5) {
    return items.length > 0 ? [[...items]] : [];
  }

  const firstLength: number = Math.ceil(items.length / 2);

  return [items.slice(0, firstLength), items.slice(firstLength)];
};

export interface ComponentProps {
  swatches: ReadonlyArray<ColorSwatchOption>;
  // The field's color; "" for none.
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
}

interface RadioItem {
  key: string;
  // null for the clear option.
  hex: string | null;
  label: string;
  title: string;
}

// One round swatch; a ring shows focus, set off from the swatch by a gap.
export const COLOR_SWATCH_CLASS: string =
  "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform duration-100 motion-reduce:transition-none focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-indigo-500";

export const COLOR_SWATCH_ENABLED_CLASS: string =
  "cursor-pointer hover:scale-110";

export const COLOR_SWATCH_DISABLED_CLASS: string =
  "cursor-not-allowed opacity-50";

/*
 * The two worded choices beside the swatches - "No color" before them and
 * "Custom color" after them - are pills of one shape, so the row reads as
 * one set of choices.
 */
export const COLOR_PILL_CLASS: string =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border text-xs font-medium transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";

export const COLOR_PILL_PICKED_CLASS: string =
  "border-indigo-500 bg-indigo-50 text-indigo-700";

export const COLOR_PILL_UNPICKED_CLASS: string =
  "border-gray-300 bg-white text-gray-700";

export const COLOR_PILL_HOVER_CLASS: string = "cursor-pointer hover:bg-gray-50";

// A thin inner edge, so a pale color does not melt into a white card.
export const SWATCH_EDGE: string = "inset 0 0 0 1px rgb(0 0 0 / 0.12)";

/*
 * The picked swatch's ring: a gap the color of the surface it sits on (so it
 * reads as a ring, in either theme, on a card or in a popover), then a ring
 * of the swatch's own color.
 */
export const getSwatchShadow: (hex: string, isPicked: boolean) => string = (
  hex: string,
  isPicked: boolean,
): string => {
  if (!isPicked) {
    return SWATCH_EDGE;
  }

  return `${SWATCH_EDGE}, 0 0 0 2px var(--ou-surface-primary, #ffffff), 0 0 0 4px ${hex}`;
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
  const pickedHex: string | null = pickedSwatch
    ? normalizeColorValue(pickedSwatch.hex)
    : null;

  const checkedIndex: number = items.findIndex((item: RadioItem): boolean => {
    if (item.hex === null) {
      return !props.value;
    }

    return item.hex === pickedHex;
  });

  // The one Tab stop: the checked color, or the first when none is.
  const tabStopIndex: number = checkedIndex >= 0 ? checkedIndex : 0;

  type PickAtFunction = (
    index: number,
    details: ColorSwatchPickDetails,
  ) => void;

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
    pickAt(nextIndex, { isArrowKey: true });
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
      "aria-label": item.label,
      tabIndex: index === tabStopIndex ? 0 : -1,
      disabled: props.disabled,
      title: item.title,
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown(event, index);
      },
      onClick: () => {
        pickAt(index, { isArrowKey: false });
      },
      "data-testid":
        item.hex === null ? "color-picker-clear" : "color-picker-swatch",
    };

    const setRef: (element: HTMLButtonElement | null) => void = (
      element: HTMLButtonElement | null,
    ): void => {
      itemRefs.current[index] = element;
    };

    if (item.hex === null) {
      return (
        <button
          key={item.key}
          ref={setRef}
          {...commonProps}
          className={`${COLOR_PILL_CLASS} px-2.5 ${
            isChecked ? COLOR_PILL_PICKED_CLASS : COLOR_PILL_UNPICKED_CLASS
          } ${
            props.disabled
              ? COLOR_SWATCH_DISABLED_CLASS
              : isChecked
                ? "cursor-pointer"
                : COLOR_PILL_HOVER_CLASS
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
        ref={setRef}
        {...commonProps}
        data-color={item.hex}
        className={`${COLOR_SWATCH_CLASS} ${
          props.disabled
            ? COLOR_SWATCH_DISABLED_CLASS
            : COLOR_SWATCH_ENABLED_CLASS
        }`}
        style={{
          backgroundColor: item.hex,
          boxShadow: getSwatchShadow(item.hex, isChecked),
        }}
      >
        {isChecked ? (
          <Icon
            icon={IconProp.Check}
            className="h-4 w-4"
            style={{ color: getMarkColor(item.hex) }}
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

  // Each run with the index of its first swatch among all the radios.
  const runs: Array<{ items: Array<RadioItem>; offset: number }> = [];

  for (const run of splitSwatchRuns(swatchItems)) {
    const previous: { items: Array<RadioItem>; offset: number } | undefined =
      runs[runs.length - 1];

    runs.push({
      items: run,
      offset: previous ? previous.offset + previous.items.length : swatchOffset,
    });
  }

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
      className={
        props.layout === "grid"
          ? "flex flex-col gap-3"
          : "flex flex-wrap items-center gap-2"
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
        <>
          {clearItem ? renderItem(clearItem, 0) : <></>}
          {runs.map(
            (
              run: { items: Array<RadioItem>; offset: number },
              runIndex: number,
            ) => {
              return (
                <div
                  key={runIndex}
                  data-testid="color-picker-swatch-run"
                  className="flex items-center gap-2"
                >
                  {run.items.map((item: RadioItem, index: number) => {
                    return renderItem(item, run.offset + index);
                  })}
                </div>
              );
            },
          )}
        </>
      )}
    </div>
  );
};

export default ColorSwatchGroup;
