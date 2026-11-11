// Tailwind
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * Where the logo goes: the project's Home (getLogoDestination). It was
   * drawn as something to click, with a pointer and a hover, and did
   * nothing (#6816).
   */
  to: Route;
  // What the link says to a screen reader and in its tooltip: "Home".
  title: string;
}

export const HEADER_LOGO_TEST_ID: string = "header-logo";

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
     * half a phone header, and the profile and bell buttons beside it have
     * nowhere to go. Shrink the mark and its gutter below sm.
     *
     * The installation's own logo when it has one (ProductBranding), held to
     * the same height and to a width that leaves the header its buttons; its
     * name, as tall as the logo, when it goes by a name of its own and has no
     * logo.
     *
     * A link, not an image with a click handler: it is reached with Tab,
     * opened with Enter, opened in a new tab with a middle click, and named
     * "Home" for a screen reader.
     */
    <div className="relative z-10 flex items-center border-r border-gray-200 pr-2 mr-2 -ml-2 sm:pr-4 sm:mr-4 sm:-ml-5">
      <Link
        to={props.to}
        title={props.title}
        dataTestId={HEADER_LOGO_TEST_ID}
        className="flex flex-shrink-0 items-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        <ProductLogo
          className="oneuptime-dashboard-logo block h-6 w-auto max-w-[8rem] object-contain hover:opacity-80 transition-opacity sm:h-8 sm:max-w-[12rem]"
          nameClassName="block max-w-[8rem] truncate text-base font-semibold leading-6 tracking-tight text-gray-900 hover:opacity-80 transition-opacity sm:max-w-[12rem] sm:text-lg sm:leading-8"
        />
      </Link>
    </div>
  );
};

export default Logo;
