import Modal from "../../../UI/Components/Modal/Modal";
import Tooltip from "../../../UI/Components/Tooltip/Tooltip";
import {
  getTabbableElements,
  getTooltipLayer,
} from "../../../UI/Components/Tooltip/TooltipLayer";
import getJestMockFunction, { MockFunction } from "../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { Instance } from "tippy.js";

/*
 * A TOOLTIP IS DRAWN ON THE PAGE'S BODY, NEVER INSIDE WHAT HOLDS ITS
 * TRIGGER (#9769).
 *
 * Hovering an owner's avatar in the first row of the Monitors list showed a
 * tooltip with its left and top cut off. A rich tooltip is interactive, and
 * Tippy draws an interactive tooltip inside its trigger's parent: in a table
 * that is the cell, which clips its value across (overflow-x: clip,
 * TableLayout), inside a list that scrolls sideways and a card that rounds
 * its corners. Popper, which places it, cannot see an `overflow: clip` box,
 * so it never moved the tooltip away from that edge either.
 *
 * Now every tooltip is drawn on the body, interactive or not, and placed
 * against the window: it flips to the other side, or slides along, where
 * the window's edge leaves it no room. The keyboard still goes through one
 * with links or buttons as if it sat right after its trigger, inside a
 * dialog too, and a press inside one never dismisses the dialog its trigger
 * is in.
 *
 * Tippy under jsdom: the box is portalled to the body and found by its
 * text; its deferred work (a rich tooltip waits 120ms) runs after a short
 * real wait. jsdom lays nothing out, so the placement tests give the window,
 * the trigger and the tooltip their sizes.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.setTimeout(30000);

// Lets Tippy's deferred work run: a rich tooltip waits 120ms to show.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 250);
    });
  });
}

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await settle();
}

async function focusTrigger(trigger: HTMLElement): Promise<void> {
  act(() => {
    trigger.focus();
  });
  await settle();
}

// The tooltip's own element, Tippy's root, around the given words.
function tooltipRootOf(text: string): HTMLElement {
  const root: HTMLElement | null = screen
    .getByText(text)
    .closest<HTMLElement>("[data-tippy-root]");

  expect(root).not.toBeNull();

  return root as HTMLElement;
}

// Tab, or Shift+Tab, as the keyboard sends it to what has the focus.
function pressTab(options?: { shiftKey?: boolean }): boolean {
  const target: Element = document.activeElement || document.body;

  return fireEvent.keyDown(target, {
    key: "Tab",
    code: "Tab",
    shiftKey: Boolean(options?.shiftKey),
  });
}

function isTooltipShown(text: string): boolean {
  const element: HTMLElement | null = screen.queryByText(text);

  if (!element) {
    return false;
  }

  const root: HTMLElement | null =
    element.closest<HTMLElement>("[data-tippy-root]");

  return Boolean(root && root.style.visibility !== "hidden");
}

afterEach(() => {
  cleanup();
});

describe("Tooltip - drawn on the page's body (#9769)", () => {
  /*
   * Every kind of box that cuts off what is drawn inside it, as the
   * Dashboard has them around a trigger.
   */
  const CLIPPING_BOXES: Array<[string, React.CSSProperties]> = [
    ["a table cell's value, clipped across", { overflowX: "clip" }],
    ["a list that scrolls sideways", { overflowX: "auto" }],
    ["a panel that scrolls", { overflowY: "auto" }],
    ["a box that hides its overflow", { overflow: "hidden" }],
    ["a card that rounds its corners", { overflow: "clip" }],
    ["a box that paints only inside itself", { contain: "paint" }],
    ["an avatar lifted under the pointer", { transform: "translateY(-2px)" }],
  ];

  test.each(CLIPPING_BOXES)(
    "a rich tooltip inside %s is drawn on the body, outside it",
    async (_name: string, style: React.CSSProperties) => {
      render(
        <div data-testid="clipping-box" style={style}>
          <Tooltip richContent={<div>Ada Lovelace</div>}>
            <button type="button">AL</button>
          </Tooltip>
        </div>,
      );

      await hover(screen.getByRole("button", { name: "AL" }));

      const root: HTMLElement = tooltipRootOf("Ada Lovelace");

      expect(screen.getByTestId("clipping-box")).not.toContainElement(root);
      expect(root.parentElement).toBe(document.body);
    },
  );

  test("an owner avatar in the first row of a list: its tooltip leaves the table", async () => {
    // The Monitors list's first row, as the shared table draws it.
    render(
      <div data-testid="table-scroll" style={{ overflowX: "auto" }}>
        <table>
          <tbody>
            <tr>
              <td>
                <div data-testid="cell" style={{ overflowX: "clip" }}>
                  <div className="relative -ml-1.5 first:ml-0 hover:z-20 hover:-translate-y-0.5">
                    <Tooltip
                      richContent={
                        <div>
                          <div>Grace Hopper</div>
                          <div>grace@example.com</div>
                        </div>
                      }
                    >
                      <div className="cursor-default" data-testid="avatar">
                        GH
                      </div>
                    </Tooltip>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>,
    );

    await hover(screen.getByTestId("avatar"));

    const root: HTMLElement = tooltipRootOf("Grace Hopper");

    expect(screen.getByTestId("cell")).not.toContainElement(root);
    expect(screen.getByTestId("table-scroll")).not.toContainElement(root);
    expect(root.parentElement).toBe(document.body);
    expect(root).toHaveTextContent("grace@example.com");
  });

  test("it is still interactive: the pointer can move onto it", async () => {
    render(
      <div style={{ overflowX: "clip" }}>
        <Tooltip richContent={<div>Ada Lovelace</div>}>
          <button type="button">AL</button>
        </Tooltip>
      </div>,
    );

    await hover(screen.getByRole("button", { name: "AL" }));

    // Tippy lets the pointer through a tooltip that is not interactive.
    expect(tooltipRootOf("Ada Lovelace").style.pointerEvents).not.toBe("none");
  });

  test("its trigger is described by it, wherever it is drawn", async () => {
    render(
      <div style={{ overflowX: "clip" }}>
        <Tooltip richContent={<div>Ada Lovelace</div>}>
          <button type="button">AL</button>
        </Tooltip>
      </div>,
    );

    const trigger: HTMLElement = screen.getByRole("button", { name: "AL" });

    await hover(trigger);

    expect(trigger).toHaveAccessibleDescription("Ada Lovelace");
  });

  test("a lazy rich tooltip, made on first use, is drawn on the body too", async () => {
    render(
      <div data-testid="clipping-box" style={{ overflowX: "clip" }}>
        <Tooltip lazy={true} richContent={<div>One day of uptime</div>}>
          <button type="button">Day</button>
        </Tooltip>
      </div>,
    );

    await hover(screen.getByRole("button", { name: "Day" }));

    const root: HTMLElement = tooltipRootOf("One day of uptime");

    expect(screen.getByTestId("clipping-box")).not.toContainElement(root);
    expect(root.parentElement).toBe(document.body);
  });

  test("a tooltip of plain words is drawn on the body, as it always was", async () => {
    render(
      <div data-testid="clipping-box" style={{ overflow: "hidden" }}>
        <Tooltip text="Copies the monitor's ID">
          <button type="button">Copy ID</button>
        </Tooltip>
      </div>,
    );

    await hover(screen.getByRole("button", { name: "Copy ID" }));

    const root: HTMLElement = tooltipRootOf("Copies the monitor's ID");

    expect(screen.getByTestId("clipping-box")).not.toContainElement(root);
    expect(root.parentElement).toBe(document.body);
  });

  test("the layer is the body of the trigger's own document", () => {
    const frameDocument: Document =
      document.implementation.createHTMLDocument("frame");
    const trigger: HTMLElement = frameDocument.createElement("button");
    frameDocument.body.appendChild(trigger);

    expect(getTooltipLayer(trigger)).toBe(frameDocument.body);
  });

  test("a tooltip whose trigger scrolls out of sight is not drawn over the page", () => {
    // Tooltip.css hides the box Tippy marks when Popper says so.
    const css: string = fs.readFileSync(
      path.join(__dirname, "../../../UI/Components/Tooltip/Tooltip.css"),
      "utf8",
    );

    expect(css.replace(/\s+/g, " ")).toContain(
      ".tippy-box[data-reference-hidden] { visibility: hidden; pointer-events: none; }",
    );

    const tooltipSource: string = fs.readFileSync(
      path.join(__dirname, "../../../UI/Components/Tooltip/Tooltip.tsx"),
      "utf8",
    );

    expect(tooltipSource).toContain('import "./Tooltip.css";');
  });
});

describe("Tooltip - placed against the window's edges, not its box's", () => {
  const WINDOW_WIDTH: number = 1024;
  const WINDOW_HEIGHT: number = 768;
  const TOOLTIP_WIDTH: number = 240;
  const TOOLTIP_HEIGHT: number = 64;
  // Tippy keeps a tooltip 5px in from the window's sides.
  const EDGE_PADDING: number = 5;

  let restoreLayout: Array<() => void> = [];

  /*
   * A size for what jsdom does not lay out: the window, and the tooltip
   * (Popper reads its offsetWidth and offsetHeight).
   */
  const defineGetter: (
    target: HTMLElement,
    property: "clientWidth" | "clientHeight" | "offsetWidth" | "offsetHeight",
    getter: (this: HTMLElement) => number,
  ) => void = (
    target: HTMLElement,
    property: "clientWidth" | "clientHeight" | "offsetWidth" | "offsetHeight",
    getter: (this: HTMLElement) => number,
  ): void => {
    const original: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(target, property);

    Object.defineProperty(target, property, {
      configurable: true,
      get: getter,
    });

    restoreLayout.push(() => {
      if (original) {
        Object.defineProperty(target, property, original);
      } else {
        // An own getter on one element: the prototype's shows again.
        Reflect.deleteProperty(target, property);
      }
    });
  };

  beforeEach(() => {
    restoreLayout = [];

    defineGetter(document.documentElement, "clientWidth", () => {
      return WINDOW_WIDTH;
    });
    defineGetter(document.documentElement, "clientHeight", () => {
      return WINDOW_HEIGHT;
    });

    const isTooltipRoot: (element: HTMLElement) => boolean = (
      element: HTMLElement,
    ): boolean => {
      return element.hasAttribute("data-tippy-root");
    };

    defineGetter(HTMLElement.prototype, "offsetWidth", function () {
      return isTooltipRoot(this) ? TOOLTIP_WIDTH : 0;
    });
    defineGetter(HTMLElement.prototype, "offsetHeight", function () {
      return isTooltipRoot(this) ? TOOLTIP_HEIGHT : 0;
    });
  });

  afterEach(() => {
    for (const restore of restoreLayout.reverse()) {
      restore();
    }

    document.documentElement.removeAttribute("dir");
  });

  /*
   * Puts an element at a place in the window, as the browser would lay it
   * out - its inner size too, which Popper reads of a box that clips.
   */
  function placeAt(
    element: HTMLElement,
    box: { left: number; top: number; width: number; height: number },
  ): void {
    Object.defineProperty(element, "clientWidth", {
      configurable: true,
      value: box.width,
    });
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      value: box.height,
    });

    element.getBoundingClientRect = (): DOMRect => {
      return {
        x: box.left,
        y: box.top,
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON: () => {
          return {};
        },
      } as DOMRect;
    };
  }

  interface Shown {
    placement: string | null;
    left: number;
    top: number;
  }

  /*
   * Where the tooltip around the given words went: its side, and its top
   * left corner in the window - as Popper placed it, after flipping and
   * sliding. (Its style says the same in another form: one above its
   * trigger is held by its bottom edge.)
   */
  function shown(text: string): Shown {
    const root: HTMLElement = tooltipRootOf(text);
    const box: HTMLElement | null =
      root.querySelector<HTMLElement>(".tippy-box");
    const instance: Instance | undefined = (
      root as HTMLElement & { _tippy?: Instance }
    )._tippy;
    const corner: { x: number; y: number } | undefined =
      instance?.popperInstance?.state.modifiersData["popperOffsets"];

    expect(corner).toBeDefined();

    return {
      placement: box ? box.getAttribute("data-placement") : null,
      left: corner!.x,
      top: corner!.y,
    };
  }

  // An owner's avatar, in a list whose box clips and scrolls.
  async function showOwnerTooltipAt(
    avatar: { left: number; top: number },
    options?: {
      placement?: "top" | "bottom";
      box?: { left: number; top: number; width: number; height: number };
    },
  ): Promise<Shown> {
    render(
      <div data-testid="list" style={{ overflow: "auto" }}>
        <div style={{ overflowX: "clip" }}>
          <Tooltip
            richContent={<div>Ada Lovelace</div>}
            placement={options?.placement}
          >
            <button type="button">AL</button>
          </Tooltip>
        </div>
      </div>,
    );

    placeAt(screen.getByTestId("list"), {
      left: 0,
      top: 0,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      ...(options?.box || {}),
    });

    const trigger: HTMLElement = screen.getByRole("button", { name: "AL" });
    placeAt(trigger, { ...avatar, width: 24, height: 24 });

    await hover(trigger);

    return shown("Ada Lovelace");
  }

  test("with room above it, it opens above its trigger", async () => {
    const result: Shown = await showOwnerTooltipAt({ left: 500, top: 400 });

    expect(result.placement).toBe("top");
    expect(result.top + TOOLTIP_HEIGHT).toBeLessThanOrEqual(400);
  });

  test("on the first row, under the window's top edge, it flips below its trigger", async () => {
    const result: Shown = await showOwnerTooltipAt({ left: 500, top: 4 });

    expect(result.placement).toBe("bottom");
    expect(result.top).toBeGreaterThanOrEqual(4 + 24);
    expect(result.top + TOOLTIP_HEIGHT).toBeLessThanOrEqual(WINDOW_HEIGHT);
  });

  test("asked to open below, at the window's foot, it flips above", async () => {
    const result: Shown = await showOwnerTooltipAt(
      { left: 500, top: WINDOW_HEIGHT - 30 },
      { placement: "bottom" },
    );

    expect(result.placement).toBe("top");
    expect(result.top).toBeGreaterThanOrEqual(0);
  });

  test("at the window's left edge, it slides right until it is whole", async () => {
    const result: Shown = await showOwnerTooltipAt({ left: 0, top: 400 });

    expect(result.placement).toBe("top");
    expect(result.left).toBeGreaterThanOrEqual(EDGE_PADDING);
  });

  test("at the window's right edge, it slides left until it is whole", async () => {
    const result: Shown = await showOwnerTooltipAt({
      left: WINDOW_WIDTH - 24,
      top: 400,
    });

    expect(result.left + TOOLTIP_WIDTH).toBeLessThanOrEqual(
      WINDOW_WIDTH - EDGE_PADDING,
    );
  });

  test("on a page read right to left, it stays whole at either edge", async () => {
    document.documentElement.setAttribute("dir", "rtl");

    const atTheEnd: Shown = await showOwnerTooltipAt({ left: 0, top: 4 });

    expect(atTheEnd.placement).toBe("bottom");
    expect(atTheEnd.left).toBeGreaterThanOrEqual(EDGE_PADDING);

    cleanup();

    const atTheStart: Shown = await showOwnerTooltipAt({
      left: WINDOW_WIDTH - 24,
      top: 400,
    });

    expect(atTheStart.left + TOOLTIP_WIDTH).toBeLessThanOrEqual(
      WINDOW_WIDTH - EDGE_PADDING,
    );
  });

  test("it follows its trigger as the list around it scrolls", async () => {
    const before: Shown = await showOwnerTooltipAt({ left: 500, top: 400 });
    const trigger: HTMLElement = screen.getByRole("button", { name: "AL" });

    // The list scrolls 40px sideways, and 10px down: the avatar moves with it.
    placeAt(trigger, { left: 460, top: 390, width: 24, height: 24 });
    fireEvent.scroll(screen.getByTestId("list"));
    await settle();

    const after: Shown = shown("Ada Lovelace");

    expect(after.placement).toBe("top");
    expect(after.left).toBeCloseTo(before.left - 40, 5);
    expect(after.top).toBeCloseTo(before.top - 10, 5);
  });

  test("once the list has scrolled its trigger out of sight, it is marked to go", async () => {
    await showOwnerTooltipAt(
      { left: 100, top: 400 },
      { box: { left: 0, top: 300, width: 400, height: 200 } },
    );

    const box: HTMLElement = tooltipRootOf("Ada Lovelace").querySelector(
      ".tippy-box",
    ) as HTMLElement;

    expect(box).not.toHaveAttribute("data-reference-hidden");

    // Scrolled sideways past the list's right edge.
    placeAt(screen.getByRole("button", { name: "AL" }), {
      left: 600,
      top: 400,
      width: 24,
      height: 24,
    });
    fireEvent.scroll(screen.getByTestId("list"));
    await settle();

    // Tooltip.css hides a box marked so.
    expect(box).toHaveAttribute("data-reference-hidden");
  });

  test("the window decides, not the box its trigger is in: room above in the window, none in the box", async () => {
    /*
     * The list starts 300px down the window; its first row's avatar is 4px
     * inside it. Drawn inside the list, the tooltip would have had to go
     * below the avatar (or be cut off); drawn on the body it opens above,
     * where the window has room.
     */
    const result: Shown = await showOwnerTooltipAt(
      { left: 500, top: 304 },
      { box: { left: 0, top: 300, width: WINDOW_WIDTH, height: 200 } },
    );

    expect(result.placement).toBe("top");
    expect(result.top).toBeLessThan(300);
    expect(result.top).toBeGreaterThanOrEqual(0);
  });
});

describe("Tooltip - the keyboard goes through it as if it sat after its trigger", () => {
  // A day's bar on an uptime graph: its tooltip lists the day's incidents.
  function DayWithIncidents(props: {
    interactive?: boolean;
    onIncidentClick?: (id: string) => void;
  }): ReactElement {
    return (
      <div>
        <button type="button">Before</button>
        <div style={{ overflowX: "auto" }}>
          <Tooltip
            interactive={props.interactive}
            richContent={
              <div>
                <p>Tuesday</p>
                <button
                  type="button"
                  onClick={() => {
                    props.onIncidentClick?.("first");
                  }}
                >
                  Database down
                </button>
                <button type="button">Disk full</button>
              </div>
            }
          >
            <button type="button">Tuesday&apos;s bar</button>
          </Tooltip>
        </div>
        <button type="button">After</button>
      </div>
    );
  }

  const bar: () => HTMLElement = (): HTMLElement => {
    return screen.getByRole("button", { name: "Tuesday's bar" });
  };

  test("Tab on the trigger goes to the tooltip's first button", async () => {
    render(<DayWithIncidents />);

    await focusTrigger(bar());
    expect(isTooltipShown("Database down")).toBe(true);

    // Taken: the browser's own Tab would have gone to After.
    expect(pressTab()).toBe(false);
    expect(screen.getByRole("button", { name: "Database down" })).toHaveFocus();
  });

  test("Tab and Shift+Tab go through the tooltip's own buttons, in order", async () => {
    render(<DayWithIncidents />);

    await focusTrigger(bar());
    pressTab();

    expect(pressTab()).toBe(false);
    expect(screen.getByRole("button", { name: "Disk full" })).toHaveFocus();

    expect(pressTab({ shiftKey: true })).toBe(false);
    expect(screen.getByRole("button", { name: "Database down" })).toHaveFocus();
    expect(isTooltipShown("Database down")).toBe(true);
  });

  test("Shift+Tab on the tooltip's first button goes back to the trigger, and the tooltip stays", async () => {
    render(<DayWithIncidents />);

    await focusTrigger(bar());
    pressTab();

    expect(pressTab({ shiftKey: true })).toBe(false);
    expect(bar()).toHaveFocus();
    await settle();
    expect(isTooltipShown("Database down")).toBe(true);
  });

  test("Tab past the tooltip's last button puts it away and goes on from the trigger", async () => {
    render(<DayWithIncidents />);

    await focusTrigger(bar());
    pressTab();
    pressTab();

    /*
     * Not taken: the browser's own Tab moves on from the trigger, to After
     * - which jsdom does not do, so the focus is left on the trigger here.
     */
    expect(pressTab()).toBe(true);
    expect(bar()).toHaveFocus();
    expect(isTooltipShown("Database down")).toBe(false);

    // The show the trigger's focus asked for is dropped: it stays away.
    await settle();
    expect(isTooltipShown("Database down")).toBe(false);
  });

  test("Shift+Tab on the trigger goes back as it always did", async () => {
    render(<DayWithIncidents />);

    await focusTrigger(bar());

    expect(pressTab({ shiftKey: true })).toBe(true);
    expect(bar()).toHaveFocus();
  });

  test("the focus leaving the tooltip for the rest of the page puts it away", async () => {
    render(<DayWithIncidents />);

    await focusTrigger(bar());
    pressTab();

    act(() => {
      screen.getByRole("button", { name: "After" }).focus();
    });
    await settle();

    expect(isTooltipShown("Database down")).toBe(false);
  });

  test("a press of a button in the tooltip reaches it", async () => {
    const onIncidentClick: MockFunction = getJestMockFunction();
    render(
      <DayWithIncidents
        onIncidentClick={onIncidentClick as (id: string) => void}
      />,
    );

    await hover(bar());
    fireEvent.click(screen.getByRole("button", { name: "Database down" }));

    expect(onIncidentClick).toHaveBeenCalledWith("first");
  });

  test("a tooltip with nothing to press is not in the Tab order", async () => {
    render(
      <div>
        <Tooltip richContent={<div>Ada Lovelace</div>}>
          <button type="button">AL</button>
        </Tooltip>
        <button type="button">After</button>
      </div>,
    );

    const trigger: HTMLElement = screen.getByRole("button", { name: "AL" });

    await focusTrigger(trigger);
    expect(isTooltipShown("Ada Lovelace")).toBe(true);

    expect(pressTab()).toBe(true);
    expect(trigger).toHaveFocus();
  });

  test("a tooltip that is not interactive is not in the Tab order", async () => {
    render(<DayWithIncidents interactive={false} />);

    await focusTrigger(bar());
    expect(isTooltipShown("Database down")).toBe(true);

    expect(pressTab()).toBe(true);
    expect(bar()).toHaveFocus();
  });

  test("Tab with a modifier, or one something else took, is left alone", async () => {
    render(<DayWithIncidents />);

    await focusTrigger(bar());

    expect(
      fireEvent.keyDown(bar(), { key: "Tab", code: "Tab", ctrlKey: true }),
    ).toBe(true);
    expect(bar()).toHaveFocus();

    expect(
      fireEvent.keyDown(bar(), { key: "Tab", code: "Tab", altKey: true }),
    ).toBe(true);
    expect(bar()).toHaveFocus();
  });
});

describe("Tooltip - inside a dialog", () => {
  function DialogWithDay(props: {
    onClose: () => void;
    onIncidentClick?: () => void;
  }): ReactElement {
    return (
      <Modal title="Monitor uptime" onClose={props.onClose}>
        <div>
          <Tooltip
            richContent={
              <div>
                <button type="button" onClick={props.onIncidentClick}>
                  Database down
                </button>
                <button type="button">Disk full</button>
              </div>
            }
          >
            <button type="button">Tuesday&apos;s bar</button>
          </Tooltip>
          <input aria-label="Note" />
        </div>
      </Modal>
    );
  }

  test("Tab goes through the tooltip's buttons; the dialog does not pull the focus back", async () => {
    const onClose: MockFunction = getJestMockFunction();
    render(<DialogWithDay onClose={onClose as () => void} />);

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Tuesday's bar",
    });

    await focusTrigger(trigger);
    expect(isTooltipShown("Database down")).toBe(true);
    expect(tooltipRootOf("Database down").parentElement).toBe(document.body);

    pressTab();
    expect(screen.getByRole("button", { name: "Database down" })).toHaveFocus();

    pressTab();
    expect(screen.getByRole("button", { name: "Disk full" })).toHaveFocus();

    // Past the last: back to the trigger in the dialog, for Tab to go on.
    pressTab();
    expect(trigger).toHaveFocus();
    expect(isTooltipShown("Database down")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a press inside the tooltip is not a press outside the dialog", async () => {
    const onClose: MockFunction = getJestMockFunction();
    const onIncidentClick: MockFunction = getJestMockFunction();
    render(
      <DialogWithDay
        onClose={onClose as () => void}
        onIncidentClick={onIncidentClick as () => void}
      />,
    );

    await hover(screen.getByRole("button", { name: "Tuesday's bar" }));

    const incident: HTMLElement = screen.getByRole("button", {
      name: "Database down",
    });

    fireEvent.mouseDown(incident);
    fireEvent.mouseUp(incident);
    fireEvent.click(incident);

    expect(onIncidentClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("getTabbableElements", () => {
  test("lists what Tab lands on, in order, and leaves out what it skips", () => {
    const container: HTMLDivElement = document.createElement("div");
    container.innerHTML = [
      '<a href="/incidents/1" id="link">Incident</a>',
      "<a id='bare'>No address</a>",
      '<button type="button" id="button">Open</button>',
      '<button type="button" id="disabled" disabled>Locked</button>',
      '<fieldset disabled><input id="in-disabled-fieldset" /></fieldset>',
      '<input type="hidden" id="hidden" />',
      '<input id="input" />',
      '<div tabindex="0" id="focusable-div">Item</div>',
      '<div tabindex="-1" id="script-only">Roving</div>',
      '<div inert><button type="button" id="inert">Inert</button></div>',
    ].join("");

    expect(
      getTabbableElements(container).map((element: HTMLElement) => {
        return element.id;
      }),
    ).toEqual(["link", "button", "input", "focusable-div"]);
  });
});
