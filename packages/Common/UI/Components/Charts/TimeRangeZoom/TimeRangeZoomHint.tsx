import React, { FunctionComponent, ReactElement } from "react";
import { translationKey, Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  useChartTimeRangeZoom,
} from "./TimeRangeZoomContext";

export const TIME_RANGE_ZOOM_HINT_TEST_ID: string = "time-range-zoom-hint";

/*
 * The class a chart card puts on its root so the hint can reveal itself on
 * hover. A NAMED Tailwind group on purpose: a plain `group` on the card
 * would also light up every descendant's own `group-hover:` styles - the
 * chart legends darken their labels on `group-hover` - whenever the pointer
 * is anywhere over the card.
 */
export const TIME_RANGE_ZOOM_HINT_GROUP_CLASS: string = "group/zoomhint";

/*
 * The hint's words, in English: keys of the locales, drawn in the reader's
 * language wherever they are shown (here, and DashboardWidgetZoomHint).
 */
export const TIME_RANGE_ZOOM_HINT_TEXT: string = translationKey("Drag to zoom");
export const TIME_RANGE_ZOOM_HINT_RESET_TEXT: string = translationKey(
  "Double-click to reset",
);
/*
 * Both gestures as one line, for a chart with a row of its own (a metric
 * chart in a ChartGroup) while it is zoomed: it can be dragged again, and
 * double-clicked back out.
 */
export const TIME_RANGE_ZOOM_HINT_BOTH_TEXT: string = translationKey(
  "Drag to zoom · double-click to reset",
);

/*
 * How a revealOnHover hint shows itself: while the pointer is over the card,
 * and while something in the card has KEYBOARD focus. Not on any focus
 * (focus-within): a press on a chart focuses recharts' own layers, which
 * keep that focus after the drag, so the hint stayed up over a card the
 * pointer had long left. :focus-visible is the focus a keyboard gives.
 */
export const TIME_RANGE_ZOOM_HINT_REVEAL_CLASSES: string =
  "opacity-0 transition-opacity group-hover/zoomhint:opacity-100 group-has-[:focus-visible]/zoomhint:opacity-100";

/*
 * Where the hint is never drawn: on a phone's width, and on a screen that
 * is only touched (no pointer can hover it: a phone, a tablet). A finger
 * neither drags a zoom box nor double-clicks, so there the words named a
 * gesture the reader cannot make - and, never giving way, they squeezed a
 * chart's title to a few letters on a 390px card ("Размер…" beside a
 * Russian hint twice its width, #8048). Media variants only, never a bare
 * `hidden` shown again by one (ForeignHiddenRuleGuard).
 */
export const TIME_RANGE_ZOOM_HINT_NOT_ON_PHONES_CLASSES: string =
  "max-sm:hidden [@media(hover:none)]:hidden";

// Every hint's own look: small, quiet, on one line.
export const TIME_RANGE_ZOOM_HINT_CLASSES: string = `${TIME_RANGE_ZOOM_HINT_NOT_ON_PHONES_CLASSES} whitespace-nowrap text-xs text-gray-500`;

export interface ComponentProps {
  /*
   * Show the hint only while the pointer is over the card (an ancestor
   * with TIME_RANGE_ZOOM_HINT_GROUP_CLASS), or while the reader tabs
   * through it. Keeps a row of small chart cards uncluttered; the hint
   * appears exactly when the reader could drag.
   */
  revealOnHover?: boolean | undefined;
  className?: string | undefined;
  /*
   * The chart's own zoom, resolved the way the chart resolves it
   * (resolveChartTimeRangeZoom): its host's handlers, else the page's, or
   * none for a chart kept out of the page's zoom. A chart in a ChartGroup
   * hands it, so the hint never promises a gesture the chart does not
   * have. Unset, the page's zoom: nothing outside a zoomable page.
   */
  zoom?: ChartTimeRangeZoomHandlers | undefined;
  /*
   * While zoomed, name the drag as well as the way back ("Drag to zoom ·
   * double-click to reset"), for a chart with a row of its own. Unset, a
   * zoomed card says the way back alone: four cards can share a row.
   */
  namesDragWhileZoomed?: boolean | undefined;
}

/**
 * Names the drag-to-zoom gesture in a chart's header whenever the chart
 * zooms: "Drag to zoom", and "Double-click to reset" while a zoom is
 * active. The words are short on purpose - four of these cards can share a
 * row - and never drawn on a phone (TIME_RANGE_ZOOM_HINT_NOT_ON_PHONES_CLASSES).
 * Renders nothing for a chart that does not zoom.
 */
const TimeRangeZoomHint: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();
  const translator: Translator = useTranslator();
  const zoom: ChartTimeRangeZoomHandlers | null = props.zoom || pageZoom;

  if (!zoom || !zoom.onTimeRangeSelect) {
    return null;
  }

  const revealClassName: string = props.revealOnHover
    ? TIME_RANGE_ZOOM_HINT_REVEAL_CLASSES
    : "";

  // The way back is only worth naming while there is something to reset.
  const text: string = !zoom.onTimeRangeReset
    ? TIME_RANGE_ZOOM_HINT_TEXT
    : props.namesDragWhileZoomed
      ? TIME_RANGE_ZOOM_HINT_BOTH_TEXT
      : TIME_RANGE_ZOOM_HINT_RESET_TEXT;

  return (
    <span
      data-testid={TIME_RANGE_ZOOM_HINT_TEST_ID}
      className={`shrink-0 ${TIME_RANGE_ZOOM_HINT_CLASSES} ${revealClassName} ${props.className || ""}`}
    >
      {translator.translateText(text)}
    </span>
  );
};

export default TimeRangeZoomHint;
