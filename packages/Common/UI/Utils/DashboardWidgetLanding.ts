import { translationKey } from "../../Types/Translator";
import {
  bringPageAnchorIntoView,
  givePageAnchorFocus,
  PageAnchorViewBlock,
} from "./PageAnchor";

/*
 * A DASHBOARD OPENED AT ONE OF ITS WIDGETS (#10084).
 *
 * A link names a widget (?widget=<id>, Utils/Dashboard/DashboardWidgetLink):
 * a warning that names what reads a metric, a chart just added from the
 * metrics explorer. Once the board has drawn that widget's box, the page
 * lands on it the way a link lands on a place on a page (PageAnchor):
 *
 *  - brought into view: its middle in the middle of the window, or its top
 *    under the page's sticky header when it is taller than the space under
 *    that header, so its title is in sight - and kept there while the page
 *    around it settles, until the person scrolls, clicks, touches or types
 *    (bringPageAnchorIntoView);
 *  - outlined for a moment (DASHBOARD_WIDGET_LANDED_ATTRIBUTE): a ring in
 *    the product's indigo around its card, held, then faded - or, for a
 *    reader who asks for less motion, held still until it goes
 *    (Styles/Theme.css). A ring, not the tint a setting a link lands on
 *    gets: a widget's card has a ground of its own, which hides a tint
 *    drawn behind it;
 *  - given the keyboard's focus when nothing else holds it
 *    (givePageAnchorFocus): Tab goes on from the widget, not from the top
 *    of the page, and a screen reader reads where the page went.
 *
 * React-free, so the board and its tests read the same rules.
 */

/*
 * What the board says, in a note that goes by itself, when the widget a
 * link names is not on it any more - deleted since the link was made: the
 * board opens at its top, as it would without the link.
 */
export const DASHBOARD_LINKED_WIDGET_MISSING: string = translationKey(
  "The widget this link points to is no longer on this dashboard.",
);

// The note's test id.
export const DASHBOARD_LINKED_WIDGET_MISSING_TEST_ID: string =
  "dashboard-linked-widget-missing";

// What the widget a link landed on carries while it is outlined.
export const DASHBOARD_WIDGET_LANDED_ATTRIBUTE: string =
  "data-dashboard-widget-landed";

// How long it stays outlined: the ring's hold and fade (Theme.css).
export const DASHBOARD_WIDGET_LANDED_IN_MS: number = 3200;

/*
 * The sticky header's height, as MasterPage publishes it
 * (--app-header-height); 0 where nothing sticks above the page - a public
 * dashboard's header scrolls with it.
 */
export function getStickyHeaderHeightInPx(): number {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return 0;
  }

  try {
    const value: string = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--app-header-height");
    const height: number = parseFloat(value);

    return Number.isFinite(height) && height > 0 ? height : 0;
  } catch {
    return 0;
  }
}

/*
 * Where in the window a widget lands: in its middle, with the widgets
 * around it in sight - unless it is taller than the window has room for
 * under the header, when its top goes under the header, so its title is
 * not cut off.
 */
export function getDashboardWidgetLandingBlock(data: {
  widgetHeightInPx: number;
  windowHeightInPx: number;
  headerHeightInPx: number;
}): PageAnchorViewBlock {
  const room: number = data.windowHeightInPx - data.headerHeightInPx;

  return room > 0 && data.widgetHeightInPx > room ? "start" : "center";
}

export interface DashboardWidgetLandingOptions {
  // How long it stays outlined; DASHBOARD_WIDGET_LANDED_IN_MS when left out.
  landedInMs?: number | undefined;
  // How long it is kept in view while the page settles (PageAnchor's own when left out).
  settleInMs?: number | undefined;
}

/*
 * Lands on a widget's box: brings it into view, outlines it for a moment
 * and gives it the focus when nothing else holds it. Returns what ends it
 * at once - a board that goes away, a link that lands somewhere else.
 */
export function landOnDashboardWidget(
  element: HTMLElement,
  options?: DashboardWidgetLandingOptions | undefined,
): () => void {
  let timer: number | null = null;

  const unmark: () => void = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }

    element.removeAttribute(DASHBOARD_WIDGET_LANDED_ATTRIBUTE);
  };

  element.setAttribute(DASHBOARD_WIDGET_LANDED_ATTRIBUTE, "true");

  const stopBringingIntoView: () => void = bringPageAnchorIntoView(element, {
    block: getDashboardWidgetLandingBlock({
      widgetHeightInPx: element.getBoundingClientRect().height,
      windowHeightInPx: window.innerHeight,
      headerHeightInPx: getStickyHeaderHeightInPx(),
    }),
    settleInMs: options?.settleInMs,
  });

  givePageAnchorFocus(element);

  timer = window.setTimeout(
    unmark,
    options?.landedInMs ?? DASHBOARD_WIDGET_LANDED_IN_MS,
  );

  return (): void => {
    stopBringingIntoView();
    unmark();
  };
}
