import DashboardTheme, {
  DashboardColorScheme,
} from "Common/Types/Dashboard/DashboardTheme";
import React, { FunctionComponent, ReactElement } from "react";
import PublicPageThemePreview, {
  PUBLIC_PAGE_THEME_PREVIEW_HEIGHT,
  PUBLIC_PAGE_THEME_PREVIEW_WIDTH,
} from "../../PublicPageTheme/PublicPageThemePreview";
import {
  DashboardThemePreviewPalette,
  getDashboardThemePreviewPalettes,
} from "./DashboardThemeCopy";

/*
 * A thumbnail of a public dashboard in one theme, beside each choice of the
 * Theme card (DashboardThemeCard): the header with the logo's mark and the
 * dashboard's name, a value, a line chart and a bar chart - light, dark, or
 * for a dashboard that follows each visitor's device, the two side by side,
 * split on a slant (the frame and the split are every public page's:
 * PublicPageThemePreview).
 *
 * The colours are the public dashboard's own (DashboardThemeCopy,
 * getDashboardThemePreviewPalettes), as plain fills the dashboard's dark
 * theme cannot remap.
 */

export interface ComponentProps {
  theme: DashboardTheme;
  // The choice in force: its picture is framed in the accent colour.
  isSelected: boolean;
}

const WIDTH: number = PUBLIC_PAGE_THEME_PREVIEW_WIDTH;
const HEIGHT: number = PUBLIC_PAGE_THEME_PREVIEW_HEIGHT;

// The bar chart's bars, as a share of their tallest, and the second series.
const BARS: ReadonlyArray<number> = [
  0.45, 0.7, 0.55, 0.9, 0.6, 0.8, 0.5, 1, 0.65, 0.75,
];
const SECOND_SERIES_BAR: number = 7;
const BAR_BOTTOM: number = 41.5;
const BAR_HEIGHT: number = 5.5;

// The line chart's points.
const LINE_POINTS: string = "32,25 37,22.5 42,23.5 47,20.5 52,22 57,19.5 63,21";

const Scene: FunctionComponent<{
  palette: DashboardThemePreviewPalette;
}> = (props: { palette: DashboardThemePreviewPalette }): ReactElement => {
  const palette: DashboardThemePreviewPalette = props.palette;

  return (
    <>
      <rect width={WIDTH} height={HEIGHT} fill={palette.page} />
      {/* The header: the logo's mark and the dashboard's name. */}
      <rect width={WIDTH} height={10} fill={palette.header} />
      <rect y={10} width={WIDTH} height={0.75} fill={palette.cardEdge} />
      <rect x={6} y={3} width={4} height={4} rx={1} fill={palette.mark} />
      <rect x={12} y={4} width={16} height={2} rx={1} fill={palette.name} />
      {/* A value. */}
      <rect
        x={5.5}
        y={14.5}
        width={20}
        height={13}
        rx={2.5}
        fill={palette.card}
        stroke={palette.cardEdge}
      />
      <rect
        x={8}
        y={17.5}
        width={10}
        height={1.5}
        rx={0.75}
        fill={palette.line}
      />
      <rect x={8} y={21} width={12} height={3.5} rx={1} fill={palette.value} />
      {/* A line chart. */}
      <rect
        x={29.5}
        y={14.5}
        width={37}
        height={13}
        rx={2.5}
        fill={palette.card}
        stroke={palette.cardEdge}
      />
      <rect
        x={32}
        y={17.5}
        width={12}
        height={1.5}
        rx={0.75}
        fill={palette.line}
      />
      <polyline
        points={LINE_POINTS}
        fill="none"
        stroke={palette.series}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* A bar chart across the board. */}
      <rect
        x={5.5}
        y={31.5}
        width={61}
        height={12.5}
        rx={2.5}
        fill={palette.card}
        stroke={palette.cardEdge}
      />
      <rect
        x={8}
        y={34}
        width={14}
        height={1.5}
        rx={0.75}
        fill={palette.line}
      />
      {BARS.map((share: number, index: number): ReactElement => {
        const height: number = BAR_HEIGHT * share;

        return (
          <rect
            key={index}
            x={26 + index * 3.9}
            y={BAR_BOTTOM - height}
            width={2.4}
            height={height}
            rx={0.6}
            fill={
              index === SECOND_SERIES_BAR
                ? palette.secondSeries
                : palette.series
            }
          />
        );
      })}
    </>
  );
};

const DashboardThemePreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const palettes: {
    light: DashboardThemePreviewPalette;
    dark: DashboardThemePreviewPalette;
  } = getDashboardThemePreviewPalettes();

  return (
    <PublicPageThemePreview
      theme={props.theme}
      isSelected={props.isSelected}
      idPrefix="dashboard-theme-preview"
      renderScene={(scheme: DashboardColorScheme): ReactElement => {
        return <Scene palette={palettes[scheme]} />;
      }}
    />
  );
};

export default DashboardThemePreview;
