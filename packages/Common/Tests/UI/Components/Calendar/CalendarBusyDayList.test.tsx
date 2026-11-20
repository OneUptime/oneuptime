/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import CalendarElement, {
  BUSY_DAY_LIST_TEST_ID,
  DefaultCalendarView,
} from "../../../../UI/Components/Calendar/Calendar";
import {
  LAYERED_POPOVER_CLASS_NAME,
  LAYERED_POPOVER_WINDOW_PADDING_PX,
} from "../../../../UI/Components/Tooltip/LayeredPopover";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";

/*
 * A BUSY DAY'S "+N MORE" LIST STAYS INSIDE THE WINDOW (#9911).
 *
 * react-big-calendar drew the list itself, placed against the month view:
 * in a short window, with the busy day scrolled near the window's top, it
 * opened above the "+N more" and started above the window's top edge,
 * though the window had room under it. The calendar draws it on the tooltip
 * layer now (LayeredPopover), placed against the window: under the "+N
 * more" while the window has the room, above while it has it there, and
 * otherwise on the roomier side, cut down and scrolling; slid along inside
 * the window's sides. And a keyboard goes through it: Tab from the "+N
 * more" to the events' links, Escape back.
 *
 * jsdom lays nothing out, so these give the month's rows their heights
 * (react-big-calendar counts how many blocks a day's cell holds from them),
 * the window its size, and the "+N more" its place, and read where the
 * layer put the list.
 */

const OCTOBER: number = 9;

function october(day: number, hour: number): Date {
  return new Date(Date.UTC(2026, OCTOBER, day, hour, 0, 0));
}

// Eight events on the 22nd: a cell four blocks tall shows three, and "+5 more".
const BUSY_DAY: Array<CalendarEvent> = Array.from(
  { length: 8 },
  (_value: unknown, index: number): CalendarEvent => {
    return {
      id: index + 1,
      title: `Patch window ${index + 1}`,
      start: october(22, index + 1),
      end: october(22, index + 2),
    };
  },
);

interface Layout {
  windowWidth: number;
  windowHeight: number;
  // Where the "+N more" is drawn in the window.
  showMore: { left: number; top: number };
  // The list's own height as it draws itself (its CSS caps it at 320px).
  listHeight: number;
}

const LAPTOP: Layout = {
  windowWidth: 1280,
  windowHeight: 900,
  showMore: { left: 700, top: 300 },
  listHeight: 320,
};

const restore: Array<() => void> = [];

function rectOf(box: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => {
      return {};
    },
  } as DOMRect;
}

function stubProperty(
  target: HTMLElement,
  property: string,
  getter: (this: HTMLElement) => number,
): void {
  const original: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(target, property);

  Object.defineProperty(target, property, { configurable: true, get: getter });
  restore.push(() => {
    if (original) {
      Object.defineProperty(target, property, original);
    } else {
      Reflect.deleteProperty(target, property);
    }
  });
}

function isList(element: HTMLElement): boolean {
  return (
    element.classList.contains("rbc-overlay") ||
    element.classList.contains(LAYERED_POPOVER_CLASS_NAME)
  );
}

function stubLayout(layout: Layout): void {
  const originalRect: () => DOMRect =
    HTMLElement.prototype.getBoundingClientRect;

  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    // The month's rows, which react-big-calendar measures: four blocks a cell.
    if (this.classList.contains("rbc-month-row")) {
      return rectOf({ left: 0, top: 0, width: 1190, height: 120 });
    }

    if (this.classList.contains("rbc-row")) {
      return rectOf({ left: 0, top: 0, width: 1190, height: 24 });
    }

    if (this.classList.contains("rbc-row-segment")) {
      return rectOf({ left: 0, top: 0, width: 170, height: 24 });
    }

    if (this.classList.contains("rbc-show-more")) {
      return rectOf({ ...layout.showMore, width: 60, height: 20 });
    }

    return originalRect.call(this);
  };
  restore.push(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  stubProperty(document.documentElement, "clientWidth", () => {
    return layout.windowWidth;
  });
  stubProperty(document.documentElement, "clientHeight", () => {
    return layout.windowHeight;
  });

  // The list's height, cut by any max-height the layer gives it.
  const drawnHeight: (this: HTMLElement) => number = function (
    this: HTMLElement,
  ): number {
    if (!isList(this)) {
      return 0;
    }

    const cut: number = parseFloat(this.style.maxHeight || "");

    return Number.isFinite(cut)
      ? Math.min(cut, layout.listHeight)
      : layout.listHeight;
  };

  stubProperty(HTMLElement.prototype, "offsetHeight", drawnHeight);
  stubProperty(HTMLElement.prototype, "offsetWidth", function () {
    return isList(this) ? 255 : 0;
  });
}

beforeEach(() => {
  stubLayout(LAPTOP);
});

afterEach(() => {
  cleanup();

  for (const undo of restore.splice(0).reverse()) {
    undo();
  }

  document.documentElement.removeAttribute("dir");
});

// Lets Popper place what it was handed: its updates wait a promise.
async function placed(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderBusyMonth(
  props: {
    onEventClick?: (event: CalendarEvent) => void;
    renderEventContent?: (event: CalendarEvent) => ReactElement;
    onRangeChange?: () => void;
  } = {},
): void {
  render(
    <div>
      <p>Elsewhere on the page</p>
      <div data-testid="card" style={{ overflow: "hidden" }}>
        <CalendarElement
          events={BUSY_DAY}
          defaultDate={october(15, 10)}
          defaultCalendarView={DefaultCalendarView.Month}
          onRangeChange={props.onRangeChange || ((): void => {})}
          onEventClick={props.onEventClick}
          renderEventContent={props.renderEventContent}
        />
      </div>
    </div>,
  );
}

function showMore(): HTMLElement {
  return screen.getByRole("button", { name: /^\+\d+ more$/ });
}

function list(): HTMLElement {
  return screen.getByTestId(BUSY_DAY_LIST_TEST_ID);
}

function layerOf(element: HTMLElement): HTMLElement {
  const layer: HTMLElement | null = element.closest<HTMLElement>(
    `.${LAYERED_POPOVER_CLASS_NAME}`,
  );

  expect(layer).not.toBeNull();

  return layer!;
}

interface Placed {
  placement: string | null;
  x: number;
  y: number;
}

async function openList(): Promise<Placed> {
  fireEvent.click(showMore());
  await placed();

  const layer: HTMLElement = layerOf(list());
  const corner: { x: number; y: number } | undefined = (
    layer as HTMLElement & {
      _tippy?: {
        popperInstance?: {
          state: { modifiersData: Record<string, { x: number; y: number }> };
        };
      };
    }
  )._tippy?.popperInstance?.state.modifiersData["popperOffsets"];

  expect(corner).toBeDefined();

  return {
    placement: layer.getAttribute("data-popper-placement"),
    x: corner!.x,
    y: corner!.y,
  };
}

describe("the calendar's +N more list, on the tooltip layer", () => {
  test("a busy day says how many more it holds", () => {
    renderBusyMonth();

    expect(showMore()).toHaveTextContent(/^\+\d+ more$/);
  });

  test("opens on the page's body, outside the month view and the card the calendar is in", async () => {
    renderBusyMonth();
    await openList();

    const opened: HTMLElement = list();

    expect(screen.getByTestId("card")).not.toContainElement(opened);
    expect(layerOf(opened).parentElement).toBe(document.body);
    expect(
      (layerOf(opened) as HTMLElement & { _tippy?: { reference: Element } })
        ._tippy?.reference,
    ).toBe(showMore());
    // react-big-calendar no longer draws a list of its own.
    expect(document.querySelectorAll(".rbc-overlay")).toHaveLength(1);
  });

  test("holds the day's name and every one of its events, as the grid draws them", async () => {
    renderBusyMonth();
    await openList();

    expect(within(list()).getByText("Thursday Oct 22")).toHaveClass(
      "rbc-overlay-header",
    );

    const blocks: Array<Element> = Array.from(
      list().querySelectorAll(".rbc-event"),
    );

    expect(blocks).toHaveLength(8);
    expect(blocks[0]).toHaveTextContent("Patch window 1");
    expect(blocks[0]!.querySelector(".rbc-event-content")).not.toBeNull();
    // The block's colour, as the grid paints it (the calendar's style getter).
    expect((blocks[0] as HTMLElement).style.backgroundColor).not.toBe("");
  });

  test("is half again as wide as the day's cell, as react-big-calendar sized it", async () => {
    renderBusyMonth();
    await openList();

    expect(list().style.minWidth).toBe("255px");
    expect(list().style.position).toBe("static");
  });

  test("with room under its +N more, it opens under it, from its start", async () => {
    renderBusyMonth();

    const shown: Placed = await openList();

    expect(shown.placement).toBe("bottom-start");
    expect(shown.x).toBe(700);
    expect(shown.y).toBeGreaterThanOrEqual(320);
  });

  /*
   * The report: 1280x560, the busy 22nd scrolled near the window's top.
   * react-big-calendar put the 320px list above it, past the window's top.
   */
  test("in a short window, with the day near the window's top, it opens under its +N more, inside the window", async () => {
    for (const undo of restore.splice(0).reverse()) {
      undo();
    }
    stubLayout({
      windowWidth: 1280,
      windowHeight: 560,
      showMore: { left: 700, top: 60 },
      listHeight: 320,
    });
    renderBusyMonth();

    const shown: Placed = await openList();

    expect(shown.placement).toBe("bottom-start");
    expect(shown.y).toBeGreaterThanOrEqual(0);
    expect(shown.y + 320).toBeLessThanOrEqual(560);
    // It had all its room: not cut down.
    expect(list().style.maxHeight).toBe("");
  });

  test("in a short window, with the day near the window's foot, it opens above, inside the window", async () => {
    for (const undo of restore.splice(0).reverse()) {
      undo();
    }
    stubLayout({
      windowWidth: 1280,
      windowHeight: 560,
      showMore: { left: 700, top: 480 },
      listHeight: 320,
    });
    renderBusyMonth();

    const shown: Placed = await openList();

    expect(shown.placement).toBe("top-start");
    expect(shown.y).toBeGreaterThanOrEqual(0);
    expect(shown.y + 320).toBeLessThanOrEqual(480);
  });

  test("in a window too short for it either way, it opens on the roomier side, cut down to it and scrolling", async () => {
    for (const undo of restore.splice(0).reverse()) {
      undo();
    }
    stubLayout({
      windowWidth: 1280,
      windowHeight: 400,
      showMore: { left: 700, top: 220 },
      listHeight: 320,
    });
    renderBusyMonth();

    const shown: Placed = await openList();
    // 220 above the +N more, less the 5px gap and the window's 8px margin.
    const roomAbove: number = 220 - 5 - LAYERED_POPOVER_WINDOW_PADDING_PX;

    expect(shown.placement).toBe("top-start");
    expect(list().style.maxHeight).toBe(`${roomAbove}px`);
    expect(list().style.overflowY).toBe("auto");
  });

  test("in a narrow window, it slides along to stay inside the window's sides", async () => {
    for (const undo of restore.splice(0).reverse()) {
      undo();
    }
    stubLayout({
      windowWidth: 390,
      windowHeight: 844,
      showMore: { left: 300, top: 300 },
      listHeight: 320,
    });
    renderBusyMonth();

    const shown: Placed = await openList();

    expect(shown.placement).toBe("bottom-start");
    expect(shown.x + 255).toBeLessThanOrEqual(
      390 - LAYERED_POPOVER_WINDOW_PADDING_PX,
    );
    expect(shown.x).toBeGreaterThanOrEqual(LAYERED_POPOVER_WINDOW_PADDING_PX);
  });

  test("on a page read right to left, it hangs from its +N more's right edge", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    renderBusyMonth();

    const shown: Placed = await openList();

    expect(shown.placement).toBe("bottom-end");
  });
});

describe("the calendar's +N more list, with the keyboard and a press", () => {
  function renderWithLinks(
    onEventClick?: (event: CalendarEvent) => void,
  ): void {
    renderBusyMonth({
      onEventClick: onEventClick,
      renderEventContent: (event: CalendarEvent): ReactElement => {
        return (
          <a
            href={`/maintenance/${event.id}`}
            onClick={(clickEvent: React.MouseEvent) => {
              clickEvent.preventDefault();
              clickEvent.stopPropagation();
            }}
          >
            {event.title}
          </a>
        );
      },
    });
  }

  test("Tab on its +N more goes to the first event's link, through them, and on from the +N more", async () => {
    renderWithLinks();
    await openList();
    act(() => {
      showMore().focus();
    });

    const links: Array<HTMLElement> = within(list()).getAllByRole("link");

    expect(fireEvent.keyDown(showMore(), { key: "Tab" })).toBe(false);
    expect(links[0]).toHaveFocus();
    fireEvent.keyDown(links[0]!, { key: "Tab" });
    expect(links[1]).toHaveFocus();

    act(() => {
      links[links.length - 1]!.focus();
    });
    // Past its last: back on the +N more, the browser's own Tab moves on.
    expect(fireEvent.keyDown(links[links.length - 1]!, { key: "Tab" })).toBe(
      true,
    );
    expect(showMore()).toHaveFocus();
    expect(screen.queryByTestId(BUSY_DAY_LIST_TEST_ID)).toBeNull();
  });

  test("Escape closes it and gives the +N more its focus back", async () => {
    renderWithLinks();
    await openList();

    act(() => {
      within(list()).getAllByRole("link")[2]!.focus();
    });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByTestId(BUSY_DAY_LIST_TEST_ID)).toBeNull();
    expect(showMore()).toHaveFocus();
  });

  test("a press outside closes it; a press inside does not", async () => {
    renderWithLinks();
    await openList();

    fireEvent.mouseDown(within(list()).getByText("Thursday Oct 22"));
    expect(list()).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("Elsewhere on the page"));
    expect(screen.queryByTestId(BUSY_DAY_LIST_TEST_ID)).toBeNull();
  });

  test("a second press on its +N more puts it away", async () => {
    renderWithLinks();
    await openList();

    fireEvent.mouseDown(showMore());
    fireEvent.click(showMore());

    expect(screen.queryByTestId(BUSY_DAY_LIST_TEST_ID)).toBeNull();
  });

  test("a press on a block opens its event; its link is what a keyboard presses", async () => {
    const onEventClick: Mock<(event: CalendarEvent) => void> = jest.fn();
    renderWithLinks(onEventClick as unknown as (event: CalendarEvent) => void);
    await openList();

    const block: HTMLElement =
      list().querySelectorAll<HTMLElement>(".rbc-event")[3]!;

    // A block with a link of its own is no control of its own.
    expect(block).not.toHaveAttribute("role");
    expect(block).not.toHaveAttribute("tabindex");

    fireEvent.click(block);

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0]![0]!.title).toBe("Patch window 4");
  });

  test("a block with nothing of its own to press is a button the keyboard presses", async () => {
    const onEventClick: Mock<(event: CalendarEvent) => void> = jest.fn();
    renderBusyMonth({
      onEventClick: onEventClick as unknown as (event: CalendarEvent) => void,
    });
    await openList();

    const block: HTMLElement =
      list().querySelectorAll<HTMLElement>(".rbc-event")[0]!;

    expect(block).toHaveAttribute("role", "button");
    expect(block).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(block, { key: "Enter" });
    fireEvent.keyDown(block, { key: " " });

    expect(onEventClick).toHaveBeenCalledTimes(2);
  });

  test("a calendar that opens nothing draws blocks that open nothing", async () => {
    renderBusyMonth();
    await openList();

    const block: HTMLElement =
      list().querySelectorAll<HTMLElement>(".rbc-event")[0]!;

    expect(block).not.toHaveAttribute("role");
    expect(block).not.toHaveAttribute("tabindex");
  });

  test("moving to another month puts the list away", async () => {
    const onRangeChange: Mock<() => void> = jest.fn();
    renderBusyMonth({ onRangeChange: onRangeChange as unknown as () => void });
    await openList();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));

    expect(onRangeChange).toHaveBeenCalled();
    expect(screen.queryByTestId(BUSY_DAY_LIST_TEST_ID)).toBeNull();
  });
});
