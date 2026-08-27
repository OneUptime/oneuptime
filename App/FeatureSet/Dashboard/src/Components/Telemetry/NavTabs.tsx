import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import AppLink from "../AppLink/AppLink";
import Dictionary from "Common/Types/Dictionary";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import {
  readTelemetryTabScopeParams,
  withTelemetryTabScopeParams,
} from "../../Utils/TelemetryTabScope";
import { subscribeToTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";

export interface TelemetryTab {
  key: string;
  label: string;
  icon: IconProp;
  to: Route;
  /*
   * True for the tabs that show the SAME telemetry through a different lens
   * — Viewer and Insights. Their links carry the scope the user is currently
   * looking at (services, hosts, saved view, window), so switching lens does
   * not silently reset the slice. False for Setup Guide and Settings, which
   * are not views of the data and would only be given a confusing URL.
   */
  carriesScope?: boolean | undefined;
  badge?: {
    text: string;
    tone?: "default" | "danger" | "warning" | "success";
  };
}

interface Props {
  tabs: Array<TelemetryTab>;
  activeKey: string;
  trailing?: ReactElement | undefined;
}

const BADGE_TONES: Record<string, string> = {
  default: "bg-gray-100 text-gray-700",
  danger: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  success: "bg-emerald-100 text-emerald-700",
};

/*
 * The current query string, re-read whenever an explorer rewrites it.
 *
 * The explorers mirror their scope with `history.replaceState`, which fires
 * no event and re-renders nothing — so without the subscription these tabs
 * would keep the hrefs they were born with and hand the sibling tab whatever
 * the scope was on first render. Kept as the raw string so an unchanged URL
 * re-renders nothing: setState on an equal string is a no-op in React.
 */
function useCurrentQueryString(): string {
  const [search, setSearch] = useState<string>(() => {
    return Navigation.getQueryString();
  });

  useEffect(() => {
    const sync: () => void = (): void => {
      setSearch(Navigation.getQueryString());
    };

    // The URL may already have moved between the initial render and here.
    sync();

    const unsubscribe: () => void = subscribeToTelemetryViewerUrlState(sync);

    /*
     * `popstate` covers the back/forward buttons, which change the query
     * string without any explorer writing it.
     */
    window.addEventListener("popstate", sync);

    return () => {
      unsubscribe();
      window.removeEventListener("popstate", sync);
    };
  }, []);

  return search;
}

const TelemetryNavTabs: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  const search: string = useCurrentQueryString();

  const scopeParams: Dictionary<string> = useMemo(() => {
    return readTelemetryTabScopeParams(search);
  }, [search]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        {props.tabs.map((tab: TelemetryTab): ReactElement => {
          const isActive: boolean = tab.key === props.activeKey;
          const badgeTone: string =
            BADGE_TONES[tab.badge?.tone || "default"] ||
            BADGE_TONES["default"]!;
          const to: Route = tab.carriesScope
            ? withTelemetryTabScopeParams(tab.to, scopeParams)
            : tab.to;
          return (
            <AppLink
              key={tab.key}
              to={to}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Icon icon={tab.icon} className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
              {tab.badge ? (
                <span
                  className={`ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeTone}`}
                >
                  {tab.badge.text}
                </span>
              ) : (
                <></>
              )}
            </AppLink>
          );
        })}
      </nav>
      {props.trailing ? (
        <div className="flex items-center gap-2">{props.trailing}</div>
      ) : null}
    </div>
  );
};

export default TelemetryNavTabs;
