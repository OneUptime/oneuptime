import React, { FunctionComponent, ReactElement, useId } from "react";
import Color from "Common/Types/Color";
import ColorPicker from "Common/UI/Components/Forms/Fields/ColorPicker";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  // Current color as a hex string (e.g. "#6366f1"); undefined = Auto.
  value?: string | undefined;
  // Emits the chosen hex, or undefined when reset to Auto.
  onChange: (color: string | undefined) => void;
  label?: string | undefined;
  description?: string | undefined;
  /*
   * Compact mode: render the label inline (mono) to the left of the swatch
   * row with no description. Used for per-group rows where many controls stack.
   */
  compact?: boolean | undefined;
  /*
   * Hide the "Auto" reset button. Used for per-group rows, where the row only
   * exists because it is pinned — clearing is done by removing the row instead.
   */
  hideAuto?: boolean | undefined;
}

export interface Swatch {
  name: string;
  hex: string;
}

/*
 * Preset swatches. These hexes intentionally mirror the chart palette
 * (Common/UI/.../ChartColors) so a picked swatch renders identically to an
 * auto-assigned palette color — the picker just lets the user pin which one.
 * Exported so the per-group editor can default new pins to a palette color.
 */
export const SERIES_COLOR_SWATCHES: Array<Swatch> = [
  { name: translationKey("Indigo"), hex: "#6366f1" },
  { name: translationKey("Blue"), hex: "#3b82f6" },
  { name: translationKey("Cyan"), hex: "#06b6d4" },
  { name: translationKey("Emerald"), hex: "#10b981" },
  { name: translationKey("Lime"), hex: "#84cc16" },
  { name: translationKey("Amber"), hex: "#f59e0b" },
  { name: translationKey("Rose"), hex: "#f43f5e" },
  { name: translationKey("Pink"), hex: "#ec4899" },
  { name: translationKey("Fuchsia"), hex: "#d946ef" },
  { name: translationKey("Violet"), hex: "#8b5cf6" },
  { name: translationKey("Gray"), hex: "#6b7280" },
];

// The empty choice of a series' color: follow the theme palette.
export const SERIES_COLOR_AUTO_LABEL: string = translationKey("Auto");
export const SERIES_COLOR_AUTO_TITLE: string = translationKey(
  "Auto — use the theme palette",
);

/**
 * Color control for a chart series: "Auto" (follow the theme palette), the
 * chart palette's swatches, and "Custom color" for an exact brand color -
 * the product's one color field (Common/UI/Components/Forms/Fields/
 * ColorPicker) with this palette and Auto as its empty choice. Values are
 * stored as hex strings; Auto clears the override.
 */
const SeriesColorSelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `${useId()}-series-color-label`;

  const picker: ReactElement = (
    <ColorPicker
      layout="inline"
      swatches={SERIES_COLOR_SWATCHES}
      isClearable={!props.hideAuto}
      clearLabel={SERIES_COLOR_AUTO_LABEL}
      clearTitle={SERIES_COLOR_AUTO_TITLE}
      value={props.value || ""}
      ariaLabelledby={labelId}
      dataTestId="series-color-picker"
      onChange={(color: Color | null) => {
        props.onChange(color ? color.toString() : undefined);
      }}
    />
  );

  if (props.compact) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span
          id={labelId}
          className="font-mono text-xs text-gray-600 shrink-0 max-w-[10rem] truncate"
          title={props.label}
        >
          {props.label}
        </span>
        <div className="min-w-0 flex-1">{picker}</div>
      </div>
    );
  }

  return (
    <div>
      <label
        id={labelId}
        className="block text-xs font-medium text-gray-500 mb-1"
      >
        {translator.translateText(props.label || "Series Color")}
      </label>
      <p className="text-xs text-gray-400 mb-2">
        {translator.translateText(
          props.description ||
            "Pick a color for this series, or leave on Auto to use the theme palette.",
        )}
      </p>
      {picker}
    </div>
  );
};

export default SeriesColorSelector;
