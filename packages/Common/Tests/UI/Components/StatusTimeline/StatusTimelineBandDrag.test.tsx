/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import StatusTimeline, {
  StatusTimelineDisplayEntry,
} from "../../../../UI/Components/StatusTimeline/StatusTimeline";
import { DRAG_TO_ZOOM_THRESHOLD_PX } from "../../../../UI/Components/StatusTimeline/StatusTimelineBand";
import { StatusTimelineWindow } from "../../../../UI/Components/StatusTimeline/StatusTimelineLayout";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";

/*
 * Dragging across the band zooms to the stretch dragged over - the way the
 * product's charts zoom - for a mouse or a pen. A finger scrolls the page
 * instead, and a press that barely moves is a click, which chooses the
 * status under it. jsdom lays nothing out, so the band is given a 1000px box.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
const NOW: Date = new Date("2026-10-14T08:36:00.000Z");
const BAND_LEFT: number = 100;
const BAND_WIDTH: number = 1000;

const at: (offsetMs: number) => Date = (offsetMs: number): Date => {
  return new Date(NOW.getTime() + offsetMs);
};

const WINDOW: StatusTimelineWindow = { start: at(-100 * DAY), end: NOW };

const ENTRIES: Array<StatusTimelineDisplayEntry> = [
  {
    id: "up",
    statusKey: "operational",
    name: "Operational",
    color: "#10b981",
    startsAt: at(-200 * DAY),
    endsAt: at(-50 * DAY),
  },
  {
    id: "down",
    statusKey: "offline",
    name: "Offline",
    color: "#ef4444",
    startsAt: at(-50 * DAY),
    endsAt: null,
  },
];

const boxOf: (element: Element) => DOMRect = (element: Element): DOMRect => {
  const isBand: boolean =
    element.getAttribute("data-testid") === "status-timeline-band";

  return {
    left: isBand ? BAND_LEFT : 0,
    width: isBand ? BAND_WIDTH : 0,
    top: 0,
    height: 36,
    right: isBand ? BAND_LEFT + BAND_WIDTH : 0,
    bottom: 36,
    x: isBand ? BAND_LEFT : 0,
    y: 0,
    toJSON: (): string => {
      return "";
    },
  } as DOMRect;
};

let onZoom: jest.Mock;

/*
 * jsdom has no PointerEvent, so testing-library would dispatch a plain
 * Event, without a clientX, a button or a pointer type. A MouseEvent carries
 * the first two, as a browser's PointerEvent does; the pointer's id and type
 * are added on top.
 */
beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class TestPointerEvent extends MouseEvent {
      public pointerId: number;
      public pointerType: string;

      public constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }

    Object.defineProperty(window, "PointerEvent", {
      configurable: true,
      writable: true,
      value: TestPointerEvent,
    });
  }
});

const renderBand: () => HTMLElement = (): HTMLElement => {
  render(
    <StatusTimeline
      entries={ENTRIES}
      window={WINDOW}
      emptyMessage="No status recorded yet."
      ariaLabel="Status timeline"
      now={NOW}
      onZoom={onZoom as unknown as (window: StatusTimelineWindow) => void}
    />,
  );

  return screen.getByTestId("status-timeline-band");
};

// A point of the band, from 0 (its left edge) to 1 (its right).
const clientX: (fraction: number) => number = (fraction: number): number => {
  return BAND_LEFT + fraction * BAND_WIDTH;
};

const press: (
  band: HTMLElement,
  fraction: number,
  init?: Record<string, unknown>,
) => void = (
  band: HTMLElement,
  fraction: number,
  init?: Record<string, unknown>,
): void => {
  fireEvent.pointerDown(band, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: clientX(fraction),
    ...(init || {}),
  });
};

const move: (
  band: HTMLElement,
  fraction: number,
  init?: Record<string, unknown>,
) => void = (
  band: HTMLElement,
  fraction: number,
  init?: Record<string, unknown>,
): void => {
  fireEvent.pointerMove(band, {
    pointerId: 1,
    pointerType: "mouse",
    buttons: 1,
    clientX: clientX(fraction),
    ...(init || {}),
  });
};

const release: (band: HTMLElement, fraction: number) => void = (
  band: HTMLElement,
  fraction: number,
): void => {
  fireEvent.pointerUp(band, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 0,
    clientX: clientX(fraction),
  });
};

beforeEach(() => {
  onZoom = jest.fn();
  OneUptimeDate.setUserTimezone("UTC" as Timezone);
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      return boxOf(this);
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("dragging across the band", () => {
  test("zooms to the stretch dragged over", () => {
    const band: HTMLElement = renderBand();

    press(band, 0.2);
    move(band, 0.3);
    move(band, 0.4);

    // The stretch is shown while the drag goes on.
    const box: HTMLElement = screen.getByTestId("status-timeline-drag-box");
    expect(Number(box.style.left.replace("%", ""))).toBeCloseTo(20, 3);
    expect(Number(box.style.width.replace("%", ""))).toBeCloseTo(20, 3);

    release(band, 0.4);

    expect(onZoom).toHaveBeenCalledTimes(1);
    const zoomed: StatusTimelineWindow = onZoom.mock
      .calls[0]![0] as StatusTimelineWindow;
    expect(zoomed.start.getTime()).toBe(at(-80 * DAY).getTime());
    expect(zoomed.end.getTime()).toBe(at(-60 * DAY).getTime());
    expect(screen.queryByTestId("status-timeline-drag-box")).toBeNull();
  });

  test("dragging right to left zooms to the same stretch", () => {
    const band: HTMLElement = renderBand();

    press(band, 0.4);
    move(band, 0.2);
    release(band, 0.2);

    const zoomed: StatusTimelineWindow = onZoom.mock
      .calls[0]![0] as StatusTimelineWindow;
    expect(zoomed.start.getTime()).toBe(at(-80 * DAY).getTime());
    expect(zoomed.end.getTime()).toBe(at(-60 * DAY).getTime());
  });

  test("the click that ends a drag does not choose the status under it", () => {
    const band: HTMLElement = renderBand();
    const segment: HTMLElement = screen
      .getAllByTestId("status-timeline-segment")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-entry-ids") === "down";
      })!;

    press(band, 0.6);
    move(band, 0.8);
    release(band, 0.8);
    fireEvent.click(segment, { detail: 1 });

    expect(segment).toHaveAttribute("aria-pressed", "false");
  });

  test("a press that barely moves is a click, not a zoom", () => {
    const band: HTMLElement = renderBand();
    const nudge: number = (DRAG_TO_ZOOM_THRESHOLD_PX - 1) / BAND_WIDTH;

    press(band, 0.6);
    move(band, 0.6 + nudge);
    release(band, 0.6 + nudge);

    expect(onZoom).not.toHaveBeenCalled();
    expect(screen.queryByTestId("status-timeline-drag-box")).toBeNull();
  });

  test("a finger scrolls the page: it never drags", () => {
    const band: HTMLElement = renderBand();

    press(band, 0.2, { pointerType: "touch" });
    move(band, 0.6, { pointerType: "touch" });
    release(band, 0.6);

    expect(onZoom).not.toHaveBeenCalled();
  });

  test("only the main button drags", () => {
    const band: HTMLElement = renderBand();

    press(band, 0.2, { button: 2, buttons: 2 });
    move(band, 0.6, { buttons: 2 });
    release(band, 0.6);

    expect(onZoom).not.toHaveBeenCalled();
  });

  test("a button let go outside the window abandons the drag", () => {
    const band: HTMLElement = renderBand();

    press(band, 0.2);
    move(band, 0.4);
    move(band, 0.5, { buttons: 0 });
    release(band, 0.5);

    expect(onZoom).not.toHaveBeenCalled();
    expect(screen.queryByTestId("status-timeline-drag-box")).toBeNull();
  });

  test("a cancelled pointer abandons the drag", () => {
    const band: HTMLElement = renderBand();

    press(band, 0.2);
    move(band, 0.4);
    fireEvent.pointerCancel(band, { pointerId: 1 });
    release(band, 0.4);

    expect(onZoom).not.toHaveBeenCalled();
  });

  test("a drag past the band's edge stops at the edge", () => {
    const band: HTMLElement = renderBand();

    press(band, 0.9);
    move(band, 1.3);
    release(band, 1.3);

    const zoomed: StatusTimelineWindow = onZoom.mock
      .calls[0]![0] as StatusTimelineWindow;
    expect(zoomed.end.getTime()).toBe(NOW.getTime());
  });
});

describe("a band that cannot zoom", () => {
  test("has no drag at all", () => {
    render(
      <StatusTimeline
        entries={ENTRIES}
        window={WINDOW}
        emptyMessage="No status recorded yet."
        ariaLabel="Status timeline"
        now={NOW}
      />,
    );
    const band: HTMLElement = screen.getByTestId("status-timeline-band");

    press(band, 0.2);
    move(band, 0.6);

    expect(screen.queryByTestId("status-timeline-drag-box")).toBeNull();
  });
});
