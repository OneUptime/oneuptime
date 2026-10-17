import StatusPageTheme from "Common/Types/StatusPage/StatusPageTheme";
import React, { FunctionComponent, ReactElement, useId } from "react";
import {
  STATUS_PAGE_THEME_PREVIEW_EDGE,
  STATUS_PAGE_THEME_PREVIEW_SELECTED_EDGE,
  StatusPageThemePreviewPalette,
  getStatusPageThemePreviewPalettes,
} from "./StatusPageThemeCopy";

/*
 * A thumbnail of a status page in one theme, beside each choice of the
 * Theme card (StatusPageThemeCard): the header's logo and name, and a card
 * with a strip of uptime bars - light, dark, or for a page that follows each
 * visitor's device, the two side by side, split on a slant.
 *
 * Drawn with fill colours of its own, never Tailwind colour classes: the
 * dashboard's dark theme remaps those (Common/UI/Styles/Theme.css), and the
 * light page has to stay light in the picture whatever theme the person
 * choosing is reading the dashboard in. The colours are the status page's
 * own (StatusPageThemeCopy, getStatusPageThemePreviewPalettes).
 *
 * Decoration only: the choice's title names it, so the picture says nothing
 * to a screen reader.
 */

export interface ComponentProps {
  theme: StatusPageTheme;
  // The choice in force: its picture is framed in the accent colour.
  isSelected: boolean;
}

/*
 * The picture's own size, in its own units: the 72x48 of the choice's
 * picture slot from sm up (ChoiceRows), scaled down with it on a phone.
 */
const WIDTH: number = 72;
const HEIGHT: number = 48;

// The bars of the strip, and the one day that was not fully up.
const BAR_COUNT: number = 11;
const DEGRADED_BAR: number = 7;

const Scene: FunctionComponent<{
  palette: StatusPageThemePreviewPalette;
}> = (props: { palette: StatusPageThemePreviewPalette }): ReactElement => {
  const palette: StatusPageThemePreviewPalette = props.palette;

  return (
    <>
      <rect width={WIDTH} height={HEIGHT} fill={palette.page} />
      {/* The header: the logo's mark and the page's name. */}
      <rect x={7} y={7} width={6} height={6} rx={1.5} fill={palette.mark} />
      <rect x={16} y={8.5} width={17} height={3} rx={1.5} fill={palette.name} />
      {/* A card of the overview, with a resource and its uptime strip. */}
      <rect
        x={7.5}
        y={17.5}
        width={57}
        height={23}
        rx={3}
        fill={palette.card}
        stroke={palette.cardEdge}
      />
      <rect
        x={11}
        y={21}
        width={18}
        height={2.5}
        rx={1.25}
        fill={palette.line}
      />
      {Array.from({ length: BAR_COUNT }).map(
        (_value: unknown, index: number): ReactElement => {
          return (
            <rect
              key={index}
              x={11 + index * 4.6}
              y={27}
              width={3}
              height={9}
              rx={0.75}
              fill={index === DEGRADED_BAR ? palette.degraded : palette.up}
            />
          );
        },
      )}
    </>
  );
};

const StatusPageThemePreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // React's ids hold colons, which a url(#...) reference cannot.
  const id: string = useId().split(":").join("");
  const palettes: {
    light: StatusPageThemePreviewPalette;
    dark: StatusPageThemePreviewPalette;
  } = getStatusPageThemePreviewPalettes();

  const frameId: string = `status-page-theme-preview-frame-${id}`;
  const lightHalfId: string = `status-page-theme-preview-light-${id}`;
  const darkHalfId: string = `status-page-theme-preview-dark-${id}`;

  const getPicture: () => ReactElement = (): ReactElement => {
    if (props.theme === StatusPageTheme.System) {
      return (
        <>
          <g clipPath={`url(#${lightHalfId})`}>
            <Scene palette={palettes.light} />
          </g>
          <g clipPath={`url(#${darkHalfId})`}>
            <Scene palette={palettes.dark} />
          </g>
        </>
      );
    }

    return (
      <Scene
        palette={
          props.theme === StatusPageTheme.Dark ? palettes.dark : palettes.light
        }
      />
    );
  };

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      // Fills the choice's picture slot (ChoiceRows), keeping its shape.
      className="block h-auto w-full"
      aria-hidden="true"
      focusable="false"
      data-theme-preview={props.theme}
      data-selected={props.isSelected ? "true" : "false"}
    >
      <defs>
        <clipPath id={frameId}>
          <rect width={WIDTH} height={HEIGHT} rx={6} />
        </clipPath>
        {/* A page that follows the device: light on the left, dark on the right. */}
        <clipPath id={lightHalfId}>
          <polygon points="0,0 44,0 28,48 0,48" />
        </clipPath>
        <clipPath id={darkHalfId}>
          <polygon points="44,0 72,0 72,48 28,48" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${frameId})`}>{getPicture()}</g>
      <rect
        x={props.isSelected ? 1 : 0.5}
        y={props.isSelected ? 1 : 0.5}
        width={props.isSelected ? WIDTH - 2 : WIDTH - 1}
        height={props.isSelected ? HEIGHT - 2 : HEIGHT - 1}
        rx={props.isSelected ? 5 : 5.5}
        fill="none"
        stroke={
          props.isSelected
            ? STATUS_PAGE_THEME_PREVIEW_SELECTED_EDGE
            : STATUS_PAGE_THEME_PREVIEW_EDGE
        }
        strokeWidth={props.isSelected ? 2 : 1}
      />
    </svg>
  );
};

export default StatusPageThemePreview;
