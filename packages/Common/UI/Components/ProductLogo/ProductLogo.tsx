import OneUptimeLogo from "../../Images/logos/OneUptimeSVG/3-transparent.svg";
import OneUptimeMark from "../../Images/logos/OneUptimeSVG/mark-transparent.svg";
import {
  getProductBranding,
  getProductLogoUrl,
  getProductName,
  isProductRenamed,
} from "../../Utils/ProductBranding";
import { ProductBranding } from "../../../Types/Branding/ProductBranding";
import { Theme, useTheme } from "../../Utils/Theme";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The product's logo: the installation's own when it has one
 * (ProductBranding - for the current theme, the logo for dark backgrounds
 * when there is one); its name, drawn as text, when it goes by a name of its
 * own and has no logo (OneUptime's wordmark reads "OneUptime"); otherwise
 * OneUptime's wordmark, recoloured for a dark background. An image's alt text
 * is the product's name. Used wherever the product shows itself: the
 * Dashboard and Admin Dashboard headers and the sign-in pages.
 */

/*
 * OneUptime's wordmark for a dark background: the same SVG with its dark
 * text recoloured. The data: URL the bundler makes of the SVG is decoded,
 * recoloured and encoded again; anything unexpected keeps the original.
 */
export const getDarkThemeLogo: (logo: string) => string = (
  logo: string,
): string => {
  // Not a data: URL string (a test's asset stub): nothing to recolour.
  if (typeof logo !== "string") {
    return logo;
  }

  const base64Marker: string = "base64,";
  const markerIndex: number = logo.indexOf(base64Marker);

  if (
    markerIndex === -1 ||
    typeof window === "undefined" ||
    typeof window.atob !== "function" ||
    typeof window.btoa !== "function"
  ) {
    return logo;
  }

  try {
    const prefix: string = logo.substring(0, markerIndex + base64Marker.length);
    const source: string = window.atob(
      logo.substring(markerIndex + base64Marker.length),
    );
    const darkSource: string = source.split("#121212").join("#f8fafc");
    return `${prefix}${window.btoa(darkSource)}`;
  } catch {
    return logo;
  }
};

const DarkOneUptimeLogo: string = getDarkThemeLogo(OneUptimeLogo);

/*
 * The logo's address for a theme: the installation's own; null when the
 * installation goes by a name of its own and has no logo, so its name is
 * drawn in the logo's place; OneUptime's wordmark otherwise.
 */
export const getProductLogoSource: (theme: Theme) => string | null = (
  theme: Theme,
): string | null => {
  const customLogoUrl: string | null = getProductLogoUrl(theme);

  if (customLogoUrl) {
    return customLogoUrl;
  }

  if (isProductRenamed()) {
    return null;
  }

  return theme === Theme.Dark ? DarkOneUptimeLogo : OneUptimeLogo;
};

/*
 * OneUptime's mark for a dark background, made the first time it is asked
 * for (getProductMarkSource). Made as this module loads, as the wordmark's
 * is, it would keep the mark - a data: URL of its SVG - in every bundle that
 * draws ProductLogo, the sign-in pages' among them, though only the
 * Dashboard's header draws it (packages/Common/Scripts/first-load-budgets.js).
 */
let darkOneUptimeMark: string | null = null;

/*
 * Below 640px, as a media query: Tailwind's max-sm, which the header's own
 * classes use for the same screens.
 */
export const SMALL_SCREEN_MEDIA_QUERY: string =
  "not all and (min-width: 640px)";

/*
 * The product's mark for a theme: what a header that asks for it
 * (markOnSmallScreens) draws on a small screen in place of the logo, so a
 * phone's header has room for what it is there to say - the project's name
 * (#7236). OneUptime's mark (its "Up" and green square, the browser tab's
 * icon) in place of its wordmark; the installation's own browser tab icon
 * in place of its own logo. Null when there is none: an installation's logo
 * without a tab icon is drawn as it is (the header's classes hold it to a
 * small screen's width), and an installation that goes by a name of its
 * own and has no logo draws its name.
 *
 * The header hands this to ProductLogo (markOnSmallScreens), which never
 * calls it on its own: a bundle whose modules do not import it - the
 * sign-in pages' - is built without the mark.
 */
export const getProductMarkSource: (theme: Theme) => string | null = (
  theme: Theme,
): string | null => {
  if (getProductLogoUrl(theme)) {
    return getProductBranding()?.faviconUrl || null;
  }

  if (isProductRenamed()) {
    return null;
  }

  if (theme !== Theme.Dark) {
    return OneUptimeMark;
  }

  if (darkOneUptimeMark === null) {
    darkOneUptimeMark = getDarkThemeLogo(OneUptimeMark);
  }

  return darkOneUptimeMark;
};

// The logo at the top of a sign-in page: centred, 40px tall, 48px from sm.
export const PAGE_LOGO_CLASS_NAME: string =
  "mx-auto h-10 w-auto max-w-full object-contain sm:h-12";

/*
 * What a page logo sits on while the page is dark and the installation's
 * only logo is made for light backgrounds: a small light backdrop
 * (Theme.css, [data-ou-logo-plate]), so its letters read as they do on the
 * light page - a status page's logo does the same (StatusPage's LogoPlate).
 * The installation's logo for dark backgrounds, when it has one, is drawn
 * as it is.
 */
export const LOGO_PLATE_ATTRIBUTE: string = "data-ou-logo-plate";

// Whether a page in this theme draws the installation's light logo on a plate.
export const isLightLogoOnDarkPage: (theme: Theme) => boolean = (
  theme: Theme,
): boolean => {
  if (theme !== Theme.Dark) {
    return false;
  }

  const branding: ProductBranding | null = getProductBranding();

  return Boolean(branding?.logoUrl) && !branding?.darkLogoUrl;
};

// The name in its place: one line of it is as tall as the logo.
export const PAGE_PRODUCT_NAME_CLASS_NAME: string =
  "mx-auto max-w-full break-words text-center text-2xl font-semibold leading-10 tracking-tight text-gray-900 sm:text-3xl sm:leading-[3rem]";

export interface ComponentProps {
  // The image's classes. Without them, PAGE_LOGO_CLASS_NAME.
  className?: string | undefined;
  /*
   * The classes of the name drawn in place of a logo. Without them,
   * PAGE_PRODUCT_NAME_CLASS_NAME.
   */
  nameClassName?: string | undefined;
  /*
   * Below 640px, draw the product's mark in place of its logo - the one
   * this gives for the theme, getProductMarkSource - as one image whose
   * source the browser picks by the screen's width: the Dashboard's header,
   * where a phone has no room for both the wordmark and the project's name.
   * Handed in, not called from here: the mark would come along into every
   * bundle that draws this logo.
   */
  markOnSmallScreens?: ((theme: Theme) => string | null) | undefined;
  onClick?: (() => void) | undefined;
  dataTestId?: string | undefined;
}

const ProductLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const theme: Theme = useTheme();
  const source: string | null = getProductLogoSource(theme);
  const productName: string = getProductName();

  if (!source) {
    return (
      <div
        className={props.nameClassName || PAGE_PRODUCT_NAME_CLASS_NAME}
        data-testid={props.dataTestId}
        onClick={props.onClick}
      >
        {productName}
      </div>
    );
  }

  /*
   * The plate is for the logo at the top of a page (the sign-in pages); a
   * logo given classes of its own (the dashboards' headers) is drawn as it
   * is.
   */
  const plateProps: Record<string, string> =
    !props.className && isLightLogoOnDarkPage(theme)
      ? { [LOGO_PLATE_ATTRIBUTE]: "" }
      : {};

  const image: ReactElement = (
    <img
      className={props.className || PAGE_LOGO_CLASS_NAME}
      src={source}
      alt={productName}
      data-testid={props.dataTestId}
      onClick={props.onClick}
      {...plateProps}
    />
  );

  const markSource: string | null = props.markOnSmallScreens
    ? props.markOnSmallScreens(theme)
    : null;

  if (!markSource) {
    return image;
  }

  /*
   * One image, its name the product's: the browser draws the mark on a
   * small screen and the logo from 640px, and loads only the one it draws.
   */
  return (
    <picture>
      <source media={SMALL_SCREEN_MEDIA_QUERY} srcSet={markSource} />
      {image}
    </picture>
  );
};

export default ProductLogo;
