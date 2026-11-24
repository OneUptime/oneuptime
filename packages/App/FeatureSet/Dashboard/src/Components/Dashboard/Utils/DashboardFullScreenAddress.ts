import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  applyDashboardFullScreenToSearch,
  getDashboardFullScreenLinkQuery,
  isDashboardFullScreenInSearch,
} from "Common/Utils/Dashboard/DashboardFullScreenLink";
import { DASHBOARD_WIDGET_LINK_PARAMETER } from "Common/Utils/Dashboard/DashboardWidgetLink";
import { useCallback, useEffect, useState } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * Where a dashboard shown full screen is (issue #10409): its own page, with
 * ?view=full-screen in the address (Common/Utils/Dashboard/
 * DashboardFullScreenLink). The address is the truth: a tab opened on it, a
 * bookmark and a reload show the dashboard full screen, and Full Screen and
 * Exit Full Screen write it - in place, without a new entry in the tab's
 * history, as the dashboard's range, refresh and variables are written. So
 * the browser's Back goes back to the page before the dashboard, and never
 * to an address whose range is no longer the board's.
 */

// A dashboard's page, shown full screen: what Open in New Tab opens from the Dashboards list.
export function getDashboardFullScreenRoute(dashboardId: ObjectID): Route {
  return new Route(
    RouteUtil.populateRouteParams(RouteMap[PageMap.DASHBOARD_VIEW] as Route, {
      modelId: dashboardId,
    }).toString(),
  ).addQueryParams(getDashboardFullScreenLinkQuery());
}

/*
 * The address a new tab shows this dashboard full screen at, from the one
 * on screen: its range, refresh and variables, so the tab opens on what the
 * person sees. A link's widget is left out: it landed this tab on a widget
 * once, and a new tab opens at the board's top.
 */
export function getDashboardFullScreenNewTabAddress(location: {
  pathname: string;
  search: string;
}): string {
  const params: URLSearchParams = new URLSearchParams(location.search || "");
  params.delete(DASHBOARD_WIDGET_LINK_PARAMETER);

  const search: string = applyDashboardFullScreenToSearch(
    params.toString(),
    true,
  );

  return `${location.pathname}${search ? `?${search}` : ""}`;
}

/*
 * Opens an address of this app in a new tab, on its own: the new tab cannot
 * reach back into this one (noopener), and a browser runs it apart.
 */
export function openAddressInNewTab(address: string): void {
  if (typeof window === "undefined" || typeof window.open !== "function") {
    return;
  }

  window.open(address, "_blank", "noopener");
}

// Whether the tab's address names the full-screen view.
export function isAddressFullScreen(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return isDashboardFullScreenInSearch(window.location.search);
}

/*
 * Writes the view into the tab's address in place: no new history entry,
 * the history's state kept, every other parameter where it was.
 */
export function writeAddressFullScreen(isFullScreen: boolean): void {
  if (
    typeof window === "undefined" ||
    typeof window.history === "undefined" ||
    typeof window.location === "undefined"
  ) {
    return;
  }

  const search: string = applyDashboardFullScreenToSearch(
    window.location.search,
    isFullScreen,
  );
  const current: string = window.location.search.replace(/^\?/, "");

  if (search === current) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${
      window.location.hash || ""
    }`,
  );
}

export interface DashboardFullScreenAddress {
  // Whether the address names the full-screen view.
  isFullScreen: boolean;
  // Writes it into the address, or takes it out.
  setFullScreen: (isFullScreen: boolean) => void;
  // Opens this dashboard full screen in a new tab.
  openInNewTab: () => void;
}

/*
 * The full-screen view as the dashboard's page reads it: from the address
 * on every render - so a step of the router to this page with or without
 * it, and Back or Forward onto it, are followed - and written back there.
 */
export function useDashboardFullScreenAddress(): DashboardFullScreenAddress {
  const [, setAddressVersion] = useState<number>(0);

  const readAgain: () => void = useCallback((): void => {
    setAddressVersion((version: number): number => {
      return version + 1;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("popstate", readAgain);

    return () => {
      window.removeEventListener("popstate", readAgain);
    };
  }, [readAgain]);

  const setFullScreen: (isFullScreen: boolean) => void = useCallback(
    (isFullScreen: boolean): void => {
      writeAddressFullScreen(isFullScreen);
      readAgain();
    },
    [readAgain],
  );

  const openInNewTab: () => void = useCallback((): void => {
    openAddressInNewTab(getDashboardFullScreenNewTabAddress(window.location));
  }, []);

  return {
    isFullScreen: isAddressFullScreen(),
    setFullScreen: setFullScreen,
    openInNewTab: openInNewTab,
  };
}
