import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

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
  { name: "Indigo", hex: "#6366f1" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Cyan", hex: "#06b6d4" },
  { name: "Emerald", hex: "#10b981" },
  { name: "Lime", hex: "#84cc16" },
  { name: "Amber", hex: "#f59e0b" },
  { name: "Rose", hex: "#f43f5e" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Fuchsia", hex: "#d946ef" },
  { name: "Violet", hex: "#8b5cf6" },
  { name: "Gray", hex: "#6b7280" },
];

const HEX_PATTERN: RegExp = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const normalizeHex: (hex: string | undefined) => string | undefined = (
  hex: string | undefined,
): string | undefined => {
  return hex ? hex.trim().toLowerCase() : undefined;
};

/*
 * Expand 3-digit shorthand hex (#abc) to 6-digit (#aabbcc). The native
 * <input type="color"> accepts only #rrggbb — fed shorthand, browsers coerce
 * it to #000000 and the picker opens on black. CSS/SVG render shorthand fine,
 * so this is used only for the native input's value.
 */
const expandHex: (hex: string) => string = (hex: string): string => {
  const short: RegExpMatchArray | null = hex.match(
    /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/,
  );
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  }
  return hex;
};

/**
 * Compact color control for a chart series: an optional "Auto" reset, a row of
 * preset swatches, and a custom picker (native color input + hex text field)
 * for arbitrary/brand colors. Values are stored as hex strings; "Auto" clears
 * the override so the series falls back to the theme palette.
 */
const SeriesColorSelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const normalizedValue: string | undefined = normalizeHex(props.value);
  const isAuto: boolean = !normalizedValue;
  const matchesSwatch: boolean = SERIES_COLOR_SWATCHES.some(
    (swatch: Swatch): boolean => {
      return swatch.hex === normalizedValue;
    },
  );
  const isCustom: boolean = !isAuto && !matchesSwatch;

  // Local text buffer so a partially-typed hex doesn't clobber the value.
  const [hexText, setHexText] = useState<string>(normalizedValue || "");

  /*
   * Resync the buffer when the parent feeds this instance a different series'
   * color. Query/formula rows are keyed positionally and spliced on remove, so
   * React reuses this mounted instance for a shifted series — without this the
   * text field would keep showing the previously edited series' hex. Keyed on
   * the committed value only, so a partially-typed hex (which emits no
   * onChange) is preserved.
   */
  useEffect(() => {
    setHexText(normalizedValue || "");
  }, [normalizedValue]);

  const handleHexTextChange: (text: string) => void = (text: string): void => {
    setHexText(text);
    const candidate: string = text.trim();
    if (HEX_PATTERN.test(candidate)) {
      props.onChange(candidate.toLowerCase());
    }
  };

  const controlsRow: ReactElement = (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Auto (reset) */}
      {!props.hideAuto && (
        <button
          type="button"
          title="Auto — use the theme palette"
          aria-pressed={isAuto}
          onClick={() => {
            setHexText("");
            props.onChange(undefined);
          }}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 h-7 text-xs font-medium transition ${
            isAuto
              ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {isAuto && <Icon icon={IconProp.Check} className="h-3 w-3" />}
          Auto
        </button>
      )}

      {/* Preset swatches */}
      {SERIES_COLOR_SWATCHES.map((swatch: Swatch) => {
        const isSelected: boolean = swatch.hex === normalizedValue;
        return (
          <button
            key={swatch.hex}
            type="button"
            title={swatch.name}
            aria-label={swatch.name}
            aria-pressed={isSelected}
            onClick={() => {
              setHexText(swatch.hex);
              props.onChange(swatch.hex);
            }}
            className={`relative h-7 w-7 rounded-full border transition ${
              isSelected
                ? "border-white ring-2 ring-offset-1 ring-gray-400"
                : "border-black/10 hover:scale-110"
            }`}
            style={{ backgroundColor: swatch.hex }}
          >
            {isSelected && (
              <Icon
                icon={IconProp.Check}
                className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow"
              />
            )}
          </button>
        );
      })}

      {/* Custom color — native picker */}
      <label
        title="Custom color"
        className={`relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border transition ${
          isCustom
            ? "border-white ring-2 ring-offset-1 ring-gray-400"
            : "border-black/10 hover:scale-110"
        }`}
        style={
          isCustom
            ? { backgroundColor: normalizedValue }
            : {
                background:
                  "conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)",
              }
        }
      >
        <input
          type="color"
          aria-label="Custom color"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={expandHex(normalizedValue || "#6366f1")}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const next: string = e.target.value.toLowerCase();
            setHexText(next);
            props.onChange(next);
          }}
        />
        {isCustom && (
          <Icon
            icon={IconProp.Check}
            className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow"
          />
        )}
      </label>

      {/* Hex text entry for exact/brand colors */}
      <input
        type="text"
        value={hexText}
        placeholder="#6366f1"
        spellCheck={false}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          handleHexTextChange(e.target.value);
        }}
        className="h-7 w-24 rounded-md border border-gray-200 bg-white px-2 text-xs font-mono text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
    </div>
  );

  if (props.compact) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="font-mono text-xs text-gray-600 shrink-0 max-w-[10rem] truncate"
          title={props.label}
        >
          {props.label}
        </span>
        {controlsRow}
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {props.label || "Series Color"}
      </label>
      <p className="text-xs text-gray-400 mb-2">
        {props.description ||
          "Pick a color for this series, or leave on Auto to use the theme palette."}
      </p>
      {controlsRow}
    </div>
  );
};

export default SeriesColorSelector;
