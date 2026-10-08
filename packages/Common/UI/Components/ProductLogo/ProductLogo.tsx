import OneUptimeLogo from "../../Images/logos/OneUptimeSVG/3-transparent.svg";
import { getProductLogoUrl, getProductName } from "../../Utils/ProductBranding";
import { Theme, useTheme } from "../../Utils/Theme";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The product's logo: the installation's own when it has one
 * (ProductBranding - for the current theme, the logo for dark backgrounds
 * when there is one), otherwise OneUptime's wordmark, recoloured for a dark
 * background. Its alt text is the product's name. Used wherever the product
 * shows itself: the Dashboard and Admin Dashboard headers and the sign-in
 * pages.
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

// The logo's address for a theme: the installation's own, or OneUptime's.
export const getProductLogoSource: (theme: Theme) => string = (
  theme: Theme,
): string => {
  const customLogoUrl: string | null = getProductLogoUrl(theme);

  if (customLogoUrl) {
    return customLogoUrl;
  }

  return theme === Theme.Dark ? DarkOneUptimeLogo : OneUptimeLogo;
};

export interface ComponentProps {
  className?: string | undefined;
  onClick?: (() => void) | undefined;
  dataTestId?: string | undefined;
}

const ProductLogo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const theme: Theme = useTheme();

  return (
    <img
      className={`${props.className || ""} max-w-full object-contain`.trim()}
      src={getProductLogoSource(theme)}
      alt={getProductName()}
      data-testid={props.dataTestId}
      onClick={props.onClick}
    />
  );
};

export default ProductLogo;
