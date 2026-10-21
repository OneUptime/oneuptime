import StatusPageTheme, {
  StatusPageColorScheme,
} from "Common/Types/StatusPage/StatusPageTheme";
import React, { FunctionComponent, ReactElement } from "react";
import PublicPageThemePreview, {
  PUBLIC_PAGE_THEME_PREVIEW_HEIGHT,
  PUBLIC_PAGE_THEME_PREVIEW_WIDTH,
} from "../PublicPageTheme/PublicPageThemePreview";
import {
  StatusPageThemePreviewPalette,
  getStatusPageThemePreviewPalettes,
} from "./StatusPageThemeCopy";

/*
 * A thumbnail of a status page in one theme, beside each choice of the
 * Theme card (StatusPageThemeCard): the header's logo and name, and a card
 * with a strip of uptime bars - light, dark, or for a page that follows each
 * visitor's device, the two side by side, split on a slant (the frame and
 * the split are every public page's: PublicPageThemePreview).
 *
 * The colours are the status page's own (StatusPageThemeCopy,
 * getStatusPageThemePreviewPalettes), as plain fills the dashboard's dark
 * theme cannot remap.
 */

export interface ComponentProps {
  theme: StatusPageTheme;
  // The choice in force: its picture is framed in the accent colour.
  isSelected: boolean;
}

const WIDTH: number = PUBLIC_PAGE_THEME_PREVIEW_WIDTH;
const HEIGHT: number = PUBLIC_PAGE_THEME_PREVIEW_HEIGHT;

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
  const palettes: {
    light: StatusPageThemePreviewPalette;
    dark: StatusPageThemePreviewPalette;
  } = getStatusPageThemePreviewPalettes();

  return (
    <PublicPageThemePreview
      theme={props.theme}
      isSelected={props.isSelected}
      idPrefix="status-page-theme-preview"
      renderScene={(scheme: StatusPageColorScheme): ReactElement => {
        return <Scene palette={palettes[scheme]} />;
      }}
    />
  );
};

export default StatusPageThemePreview;
