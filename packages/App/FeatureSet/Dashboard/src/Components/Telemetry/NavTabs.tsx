import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AppLink from "../AppLink/AppLink";
import Dictionary from "Common/Types/Dictionary";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  readTelemetryTabScopeParams,
  withTelemetryTabScopeParams,
} from "../../Utils/TelemetryTabScope";
import { subscribeToTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";
import {
  getTabBarFadeClassName,
  getTabBarHiddenEdges,
  getTabBarScrollDelta,
  NO_HIDDEN_EDGES,
  TabBarHiddenEdges,
} from "./TabBarScroll";

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

// The data-testids of the bar and of the part of it that scrolls.
export const TELEMETRY_NAV_TABS_TEST_IDS: {
  bar: string;
  scroller: string;
} = {
  bar: "telemetry-nav-tabs",
  scroller: "telemetry-nav-tabs-scroller",
};

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

function isRightToLeft(element: HTMLElement): boolean {
  try {
    return window.getComputedStyle(element).direction === "rtl";
  } catch {
    return false;
  }
}

/*
 * The tab bar's sideways scroll (TabBarScroll): which of its edges hide
 * tabs - read again as it scrolls and whenever it or its tabs change size -
 * and the lit tab scrolled to the bar's middle when the page opens or
 * another tab is lit. Only the bar scrolls: the page never moves.
 */
function useTabBarScroll(activeKey: string): {
  scrollerRef: MutableRefObject<HTMLDivElement | null>;
  hiddenEdges: TabBarHiddenEdges;
  onScroll: () => void;
} {
  const scrollerRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [hiddenEdges, setHiddenEdges] =
    useState<TabBarHiddenEdges>(NO_HIDDEN_EDGES);

  const measure: () => void = useCallback((): void => {
    const scroller: HTMLDivElement | null = scrollerRef.current;

    if (!scroller) {
      return;
    }

    const next: TabBarHiddenEdges = getTabBarHiddenEdges({
      scrollLeft: scroller.scrollLeft,
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      isRightToLeft: isRightToLeft(scroller),
    });

    // The same edges again re-render nothing.
    setHiddenEdges((previous: TabBarHiddenEdges): TabBarHiddenEdges => {
      return previous.left === next.left && previous.right === next.right
        ? previous
        : next;
    });
  }, []);

  const showActiveTab: () => void = useCallback((): void => {
    const scroller: HTMLDivElement | null = scrollerRef.current;
    const tab: Element | null | undefined = scroller?.querySelector(
      "[aria-current='page']",
    );

    if (!scroller || !tab) {
      measure();
      return;
    }

    const tabBox: DOMRect = tab.getBoundingClientRect();
    const barBox: DOMRect = scroller.getBoundingClientRect();
    const delta: number = getTabBarScrollDelta({
      tab: { left: tabBox.left, right: tabBox.right },
      bar: { left: barBox.left, right: barBox.right },
      isRightToLeft: isRightToLeft(scroller),
    });

    if (delta !== 0) {
      scroller.scrollLeft = scroller.scrollLeft + delta;
    }

    measure();
  }, [measure]);

  useEffect(() => {
    showActiveTab();

    // The Dashboard's font changes every tab's width once it has loaded.
    let isMounted: boolean = true;
    const fonts: { ready?: Promise<unknown> } | undefined = (
      document as unknown as { fonts?: { ready?: Promise<unknown> } }
    ).fonts;

    fonts?.ready
      ?.then(() => {
        if (isMounted) {
          showActiveTab();
        }
      })
      .catch(() => {
        // Without the font's widths the bar is measured as it is drawn.
      });

    return () => {
      isMounted = false;
    };
  }, [activeKey, showActiveTab]);

  useEffect(() => {
    const scroller: HTMLDivElement | null = scrollerRef.current;

    if (!scroller) {
      return;
    }

    window.addEventListener("resize", measure);

    let observer: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(scroller);

      for (const child of Array.from(scroller.children)) {
        observer.observe(child);
      }
    }

    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  return { scrollerRef, hiddenEdges, onScroll: measure };
}

const TelemetryNavTabs: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  const translator: Translator = useTranslator();
  const search: string = useCurrentQueryString();

  const scopeParams: Dictionary<string> = useMemo(() => {
    return readTelemetryTabScopeParams(search);
  }, [search]);

  const { scrollerRef, hiddenEdges, onScroll } = useTabBarScroll(
    props.activeKey,
  );

  /*
   * One line, whatever the language: every tab keeps its own width and the
   * bar scrolls sideways when they do not fit (on a phone), its scrollbar
   * out of sight and an edge that hides tabs faded (TabBarScroll). They
   * used to wrap, and Setup Guide sat alone on a second line. The bar is as
   * wide as its tabs and never wider than the page. The padding is the
   * scroller's own, so a focused tab's ring is not cut at its top or bottom.
   */
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-3">
      <nav
        className="flex min-w-0 max-w-full rounded-lg border border-gray-200 bg-white shadow-sm"
        data-testid={TELEMETRY_NAV_TABS_TEST_IDS.bar}
      >
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          data-testid={TELEMETRY_NAV_TABS_TEST_IDS.scroller}
          data-hidden-left={hiddenEdges.left ? "true" : "false"}
          data-hidden-right={hiddenEdges.right ? "true" : "false"}
          className={`flex min-w-0 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${getTabBarFadeClassName(
            hiddenEdges,
          )}`}
        >
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
                isCurrentPage={isActive}
                className={`inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon icon={tab.icon} className="h-3.5 w-3.5 flex-none" />
                {/* Each tab in the reader's language. */}
                <span>{translator.translateText(tab.label)}</span>
                {tab.badge ? (
                  <span
                    className={`ms-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeTone}`}
                  >
                    {tab.badge.text}
                  </span>
                ) : (
                  <></>
                )}
              </AppLink>
            );
          })}
        </div>
      </nav>
      {props.trailing ? (
        <div className="flex items-center gap-2">{props.trailing}</div>
      ) : null}
    </div>
  );
};

export default TelemetryNavTabs;
