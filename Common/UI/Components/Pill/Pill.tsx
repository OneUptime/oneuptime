import { Black } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";
import Tooltip from "../Tooltip/Tooltip";
import { GetReactElementFunction } from "../../Types/FunctionTypes";
import Icon, { IconType, SizeProp, ThickProp } from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export enum PillSize {
  Small = "10px",
  Normal = "13px",
  Large = "15px",
  ExtraLarge = "18px",
}

export interface ComponentProps {
  text: string;
  color: Color;
  size?: PillSize | undefined;
  style?: CSSProperties;
  isMinimal?: boolean | undefined;
  tooltip?: string | undefined;
  icon?: IconType | undefined;
}

const Pill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.isMinimal) {
    return (
      <span className="relative inline-flex items-center rounded-full border border-gray-300 px-3 py-0.5 text-sm">
        <span className="absolute flex flex-shrink-0 items-center justify-center">
          <span
            className="h-1.5 w-1.5 rounded-full bg-rose-500"
            style={{
              backgroundColor:
                props.style?.backgroundColor || props.color
                  ? props.color.toString()
                  : Black.toString(),
            }}
            aria-hidden="true"
          ></span>
        </span>
        <span className="ml-3.5 font-medium text-gray-900">{props.text}</span>
      </span>
    );
  }

  const resolvedSize: PillSize = props.size ? props.size : PillSize.Normal;

  const spacingBySize: Record<PillSize, { px: string; py: string; gap: string }> = {
    [PillSize.Small]: { px: "0.55rem", py: "0.25rem", gap: "0.3rem" },
    [PillSize.Normal]: { px: "0.75rem", py: "0.4rem", gap: "0.35rem" },
    [PillSize.Large]: { px: "0.95rem", py: "0.55rem", gap: "0.45rem" },
    [PillSize.ExtraLarge]: { px: "1.05rem", py: "0.65rem", gap: "0.5rem" },
  };

  const spacing = spacingBySize[resolvedSize];

  const iconLookups: Record<IconType, IconProp> = {
    [IconType.Danger]: IconProp.Error,
    [IconType.Success]: IconProp.CheckCircle,
    [IconType.Info]: IconProp.Info,
    [IconType.Warning]: IconProp.Alert,
  };

  // Softly shifts a hex color towards white (positive) or black (negative) for hover/focus accents.
  const adjustColor = (color: string, intensity: number): string => {
    try {
      const source: Color = Color.fromString(color);
      const rgb = Color.colorToRgb(source);

      const delta = Math.abs(intensity);
      const adjustChannel = (channel: number, lighten: boolean): number => {
        const boundary = lighten ? 255 : 0;
        const offset = boundary - channel;

        return Math.round(channel + offset * delta) as number;
      };

      const shouldLighten = intensity >= 0;
      const updated = {
        red: adjustChannel(rgb.red, shouldLighten),
        green: adjustChannel(rgb.green, shouldLighten),
        blue: adjustChannel(rgb.blue, shouldLighten),
      };

      return Color.rgbToColor(updated).toString();
    } catch (error) {
      return color;
    }
  };

  const baseColor: string = props.style?.backgroundColor
    ? `${props.style.backgroundColor}`
    : props.color
      ? props.color.toString()
      : Black.toString();

  const hexColorRegex: RegExp = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
  const isHexColor: boolean = hexColorRegex.test(baseColor);

  const prefersDarkText: boolean = (() => {
    try {
      return Color.shouldUseDarkText(Color.fromString(baseColor));
    } catch (error) {
      return true;
    }
  })();

  const contrastText: string = props.style?.color
    ? `${props.style.color}`
    : prefersDarkText
      ? "#0f172a"
      : "#f8fafc";

  const hoverColor: string = isHexColor
    ? adjustColor(baseColor, prefersDarkText ? -0.12 : 0.14)
    : baseColor;
  const focusRingColor: string = isHexColor
    ? adjustColor(baseColor, prefersDarkText ? -0.25 : 0.25)
    : prefersDarkText
      ? "rgba(15, 23, 42, 0.25)"
      : "rgba(255, 255, 255, 0.35)";
  const borderColor: string = prefersDarkText
    ? "rgba(15, 23, 42, 0.12)"
    : "rgba(255, 255, 255, 0.24)";

  const style: CSSProperties = {
    fontSize: resolvedSize.toString(),
    ...props.style,
  };

  style.backgroundColor = baseColor;
  style.color = contrastText;
  (style as CSSProperties & Record<string, string>)["--pill-px"] = spacing.px;
  (style as CSSProperties & Record<string, string>)["--pill-py"] = spacing.py;
  (style as CSSProperties & Record<string, string>)["--pill-gap"] = spacing.gap;

  (style as CSSProperties & Record<string, string>)["--pill-bg"] = baseColor;
  (style as CSSProperties & Record<string, string>)["--pill-hover-bg"] = hoverColor;
  (style as CSSProperties & Record<string, string>)["--pill-text"] = contrastText;
  (style as CSSProperties & Record<string, string>)["--pill-ring"] = focusRingColor;
  (style as CSSProperties & Record<string, string>)["--pill-border"] = borderColor;

  const getPillElement: GetReactElementFunction = (): ReactElement => {
    const iconElement: ReactElement | null = props.icon
      ? (
          <span className="flex items-center justify-center">
            <Icon
              icon={iconLookups[props.icon]}
              type={props.icon}
              size={resolvedSize === PillSize.Small ? SizeProp.Smaller : SizeProp.Small}
              thick={ThickProp.Thick}
              className="h-4 w-4"
              data-testid="pill-icon"
            />
          </span>
        )
      : null;

    return (
      <span
        data-testid="pill"
        className="inline-flex items-center gap-[var(--pill-gap)] rounded-full border border-[color:var(--pill-border)] bg-[color:var(--pill-bg)] px-[var(--pill-px)] py-[var(--pill-py)] font-semibold leading-none tracking-tight text-[color:var(--pill-text)] shadow-sm transition-colors duration-200 ease-out hover:bg-[color:var(--pill-hover-bg)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pill-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 active:shadow-sm"
        style={style}
      >
        {iconElement}
        {props.text}
      </span>
    );
  };

  if (props.tooltip) {
    return <Tooltip text={props.tooltip}>{getPillElement()}</Tooltip>;
  }

  return getPillElement();
};

export default Pill;
