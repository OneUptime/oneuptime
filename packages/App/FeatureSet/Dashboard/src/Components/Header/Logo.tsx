// Tailwind
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import ProductLogo, {
  getProductMarkSource,
} from "Common/UI/Components/ProductLogo/ProductLogo";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * Called as the logo is followed. It goes to the project's Home either
   * way (getLogoDestination): it was drawn as something to click, with a
   * pointer and a hover, and did nothing (#6816).
   */
  onClick?: (() => void) | undefined;
}

export const HEADER_LOGO_TEST_ID: string = "header-logo";

/*
 * The logo's image: 24px tall below sm, where it is the product's mark (or
 * an installation's logo held to 5rem), and 32px from sm, at most 12rem wide.
 */
export const HEADER_LOGO_CLASS_NAME: string =
  "oneuptime-dashboard-logo block h-6 w-auto max-w-[5rem] object-contain hover:opacity-80 transition-opacity sm:h-8 sm:max-w-[12rem]";

/*
 * The installation's own name, drawn in place of a logo when it has none:
 * one line as tall as the logo, at most 6rem wide below sm (room for its
 * first word and, beside it, the project's name) and 12rem from sm.
 */
export const HEADER_PRODUCT_NAME_CLASS_NAME: string =
  "block max-w-[6rem] truncate text-base font-semibold leading-6 tracking-tight text-gray-900 hover:opacity-80 transition-opacity sm:max-w-[12rem] sm:text-lg sm:leading-8";

/*
 * Where the logo goes: the project's Home, as in almost every web app. With
 * no project selected yet (a new account, a project being picked), Home has
 * no address, so the logo goes to the Dashboard's start, which picks one.
 */
export const getLogoDestination: () => Route = (): Route => {
  const home: Route = RouteUtil.populateRouteParams(RouteMap[PageMap.HOME]!);

  if (home.toString().includes(":")) {
    return RouteMap[PageMap.INIT]!;
  }

  return home;
};

const Logo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    /*
     * The wordmark is a 5:1 letterbox, so at h-8 it is 160px wide — nearly
     * half a phone header. Below sm it gives way to the product's mark
     * (OneUptime's "Up" square, or the installation's own tab icon:
     * ProductLogo's markOnSmallScreens), about 44px wide, with a narrower
     * gutter: the project picker beside it is the one entry that gives way
     * when the header is tight (Common's Header, min-w-0), and with the
     * wordmark a 390px phone left it room for one letter of the project's
     * name (#7236). The bell and the profile button keep their place.
     *
     * The installation's own logo when it has one (ProductBranding), held to
     * the same height and to a width that leaves the header its buttons (5rem
     * below sm, when it has no tab icon to draw there); its name, as tall as
     * the logo, when it goes by a name of its own and has no logo.
     *
     * A link, not an image with a click handler: it is reached with Tab,
     * opened with Enter, and opened in a new tab with a middle click. A
     * screen reader names it by the logo, the product's name, as sites
     * name their logo's link: the nav bar's Home, just below, is the link
     * named Home.
     */
    <div className="relative z-10 flex items-center border-r border-gray-200 pr-2 mr-2 -ml-2 sm:pr-4 sm:mr-4 sm:-ml-5">
      <Link
        to={getLogoDestination()}
        onClick={props.onClick}
        dataTestId={HEADER_LOGO_TEST_ID}
        className="flex flex-shrink-0 items-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        <ProductLogo
          className={HEADER_LOGO_CLASS_NAME}
          nameClassName={HEADER_PRODUCT_NAME_CLASS_NAME}
          markOnSmallScreens={getProductMarkSource}
        />
      </Link>
    </div>
  );
};

export default Logo;
