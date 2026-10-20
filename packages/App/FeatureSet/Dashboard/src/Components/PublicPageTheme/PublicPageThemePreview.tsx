import PublicPageTheme, {
  PUBLIC_PAGE_DARK_SCHEME,
  PUBLIC_PAGE_LIGHT_SCHEME,
  PublicPageColorScheme,
} from "Common/Types/Theme/PublicPageTheme";
import React, { FunctionComponent, ReactElement, useId } from "react";
import {
  PUBLIC_PAGE_THEME_PREVIEW_EDGE,
  PUBLIC_PAGE_THEME_PREVIEW_SELECTED_EDGE,
} from "./PublicPageThemeCopy";

/*
 * A thumbnail of a public page in one theme, beside each choice of a Theme
 * card (PublicPageThemeCard): light, dark, or for a page that follows each
 * visitor's device, the two side by side, split on a slant. What the page
 * looks like in each scheme - a status page with its uptime bars, a
 * dashboard with its widgets - is the card's own scene (renderScene); the
 * frame, the split and the mark of the choice in force are here.
 *
 * Drawn with fill colours of their own, never Tailwind colour classes: the
 * dashboard's dark theme remaps those (Common/UI/Styles/Theme.css), and the
 * light page has to stay light in the picture whatever theme the person
 * choosing is reading the dashboard in.
 *
 * Decoration only: the choice's title names it, so the picture says nothing
 * to a screen reader.
 */

/*
 * The picture's own size, in its own units: the 72x48 of the choice's
 * picture slot from sm up (ChoiceRows), scaled down with it on a phone. A
 * scene is drawn in these units.
 */
export const PUBLIC_PAGE_THEME_PREVIEW_WIDTH: number = 72;
export const PUBLIC_PAGE_THEME_PREVIEW_HEIGHT: number = 48;

export interface ComponentProps {
  theme: PublicPageTheme;
  // The choice in force: its picture is framed in the accent colour.
  isSelected: boolean;
  // The page in one scheme, in the picture's units.
  renderScene: (scheme: PublicPageColorScheme) => ReactElement;
  // Names the picture's clip paths, which must be unique on the page.
  idPrefix: string;
}

const WIDTH: number = PUBLIC_PAGE_THEME_PREVIEW_WIDTH;
const HEIGHT: number = PUBLIC_PAGE_THEME_PREVIEW_HEIGHT;

const PublicPageThemePreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // React's ids hold colons, which a url(#...) reference cannot.
  const id: string = useId().split(":").join("");

  const frameId: string = `${props.idPrefix}-frame-${id}`;
  const lightHalfId: string = `${props.idPrefix}-light-${id}`;
  const darkHalfId: string = `${props.idPrefix}-dark-${id}`;

  const getPicture: () => ReactElement = (): ReactElement => {
    if (props.theme === PublicPageTheme.System) {
      return (
        <>
          <g clipPath={`url(#${lightHalfId})`}>
            {props.renderScene(PUBLIC_PAGE_LIGHT_SCHEME)}
          </g>
          <g clipPath={`url(#${darkHalfId})`}>
            {props.renderScene(PUBLIC_PAGE_DARK_SCHEME)}
          </g>
        </>
      );
    }

    return props.renderScene(
      props.theme === PublicPageTheme.Dark
        ? PUBLIC_PAGE_DARK_SCHEME
        : PUBLIC_PAGE_LIGHT_SCHEME,
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
            ? PUBLIC_PAGE_THEME_PREVIEW_SELECTED_EDGE
            : PUBLIC_PAGE_THEME_PREVIEW_EDGE
        }
        strokeWidth={props.isSelected ? 2 : 1}
      />
    </svg>
  );
};

export default PublicPageThemePreview;
