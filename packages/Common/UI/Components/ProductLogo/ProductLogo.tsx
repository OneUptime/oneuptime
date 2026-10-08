import OneUptimeLogo from "../../Images/logos/OneUptimeSVG/3-transparent.svg";
import {
  getProductLogoUrl,
  getProductName,
  isProductRenamed,
} from "../../Utils/ProductBranding";
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

// The logo at the top of a sign-in page: centred, 40px tall, 48px from sm.
export const PAGE_LOGO_CLASS_NAME: string =
  "mx-auto h-10 w-auto max-w-full object-contain sm:h-12";

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

  return (
    <img
      className={props.className || PAGE_LOGO_CLASS_NAME}
      src={source}
      alt={productName}
      data-testid={props.dataTestId}
      onClick={props.onClick}
    />
  );
};

export default ProductLogo;
