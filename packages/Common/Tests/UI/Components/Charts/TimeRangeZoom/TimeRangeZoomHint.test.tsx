import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import TimeRangeZoomHint, {
  TIME_RANGE_ZOOM_HINT_GROUP_CLASS,
  TIME_RANGE_ZOOM_HINT_RESET_TEXT,
  TIME_RANGE_ZOOM_HINT_TEST_ID,
  TIME_RANGE_ZOOM_HINT_TEXT,
} from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { TimeRangeZoomProvider } from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TimeRange from "../../../../../Types/Time/TimeRange";

/*
 * Issue #4105: the words beside a zoomable chart that name the gesture.
 * What the hint says, and when a hover-revealed hint may show: the pointer
 * over its card, or keyboard focus in it - never merely "something in the
 * card has focus", which a mouse press on the chart leaves behind (see
 * TimeRangeZoomHintTailwind.test.tsx for the CSS those classes become).
 */

function pageZoom(isZoomed: boolean): TimeRangeZoom {
  return {
    isZoomed: isZoomed,
    rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_HOUR } : null,
    timeRange: { range: TimeRange.PAST_ONE_HOUR },
    zoomToTimeRange: (): void => {},
    resetZoom: (): void => {},
  };
}

function inZoomablePage(isZoomed: boolean, hint: ReactElement): ReactElement {
  return (
    <TimeRangeZoomProvider zoom={pageZoom(isZoomed)}>
      <div className={TIME_RANGE_ZOOM_HINT_GROUP_CLASS}>{hint}</div>
    </TimeRangeZoomProvider>
  );
}

function hint(): HTMLElement {
  return screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
}

afterEach(() => {
  cleanup();
});

describe("TimeRangeZoomHint", () => {
  test("outside a zoomable page it renders nothing", () => {
    const { container } = render(<TimeRangeZoomHint revealOnHover={true} />);

    expect(container).toBeEmptyDOMElement();
  });

  test("a page that offers no zoom (zoom={null}) shows no hint either", () => {
    const { container } = render(
      <TimeRangeZoomProvider zoom={null}>
        <TimeRangeZoomHint />
      </TimeRangeZoomProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("names the drag while the page is not zoomed", () => {
    render(inZoomablePage(false, <TimeRangeZoomHint />));

    expect(hint()).toHaveTextContent(TIME_RANGE_ZOOM_HINT_TEXT);
  });

  test("names the way back while the page is zoomed", () => {
    render(inZoomablePage(true, <TimeRangeZoomHint />));

    expect(hint()).toHaveTextContent(TIME_RANGE_ZOOM_HINT_RESET_TEXT);
  });

  test("a hover-revealed hint is invisible at rest and shows on hover of its card", () => {
    render(inZoomablePage(false, <TimeRangeZoomHint revealOnHover={true} />));

    expect(hint()).toHaveClass("opacity-0");
    expect(hint()).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(hint().closest('[class~="group/zoomhint"]')).not.toBeNull();
  });

  test("keyboard focus in the card shows it; focus a mouse press leaves behind does not", () => {
    render(inZoomablePage(true, <TimeRangeZoomHint revealOnHover={true} />));

    expect(hint()).toHaveClass(
      "group-has-[:focus-visible]/zoomhint:opacity-100",
    );
    for (const className of Array.from(hint().classList)) {
      expect(className).not.toContain("focus-within");
    }
  });

  test("a hint that is not hover-revealed is always visible", () => {
    render(inZoomablePage(false, <TimeRangeZoomHint />));

    expect(hint()).not.toHaveClass("opacity-0");
    for (const className of Array.from(hint().classList)) {
      expect(className).not.toContain("opacity");
    }
  });

  test("a caller's classes are kept, alongside the reveal", () => {
    render(
      inZoomablePage(
        false,
        <TimeRangeZoomHint
          revealOnHover={true}
          className="ml-auto leading-3"
        />,
      ),
    );

    expect(hint()).toHaveClass("ml-auto", "leading-3", "opacity-0");
  });
});
