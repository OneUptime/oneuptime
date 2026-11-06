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
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import TelemetryFacetSidebar from "../../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import LogsFacetSidebar from "../../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import TelemetryViewer, {
  TELEMETRY_VIEWER_LIST_TEST_ID,
  TELEMETRY_VIEWER_MAIN_AREA_TEST_ID,
} from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import FacetSidebarResizeHandle, {
  FACET_SIDEBAR_DOUBLE_PRESS_MS,
  FACET_SIDEBAR_RESIZE_HANDLE_CLASS_NAME,
  FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
  FACET_SIDEBAR_RESIZE_HINT,
  FACET_SIDEBAR_RESIZE_LINE_CLASS_NAME,
  FACET_SIDEBAR_RESIZE_NAME,
} from "../../../../UI/Components/TelemetryViewer/components/FacetSidebarResizeHandle";
import {
  FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX,
  FACET_SIDEBAR_MAX_WIDTH_IN_PX,
  FACET_SIDEBAR_MIN_WIDTH_IN_PX,
  FACET_SIDEBAR_WIDTH_CLASS_NAME,
  FACET_SIDEBAR_WIDTH_PROPERTY,
} from "../../../../UI/Components/TelemetryViewer/FacetSidebarWidth";
import { FACET_SIDEBAR_NAME_ATTRIBUTE } from "../../../../UI/Components/TelemetryViewer/FacetSidebarMeasure";
import { forgetFacetSidebarWidths } from "../../../../UI/Components/TelemetryViewer/useFacetSidebarWidth";
import {
  FacetConfig,
  FacetData,
} from "../../../../UI/Components/TelemetryViewer/types";
import { FacetData as LogsFacetData } from "../../../../UI/Components/LogsViewer/types";
import User from "../../../../UI/Utils/User";
import ObjectID from "../../../../Types/ObjectID";
import TimeRange from "../../../../Types/Time/TimeRange";
import { UserPreferenceType } from "../../../../Utils/UserPreferences";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  describeVisibility,
} from "../../../ResponsiveVisibility";
import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";

/*
 * "Allow users to resize the Metrics filter sidebar by dragging its
 * right-hand edge" (issue #5773). The filters sidebar beside every telemetry
 * list was a fixed 14rem, which cut long service names short. Its edge -
 * the gap between it and the list - now sizes it: a drag, a double-click
 * that fits the names it lists, and the keyboard. The width is kept for the
 * person, one width for every explorer, and the list always keeps at least
 * half the room.
 *
 * These drive the edge in both sidebars - the Logs one (LogsFacetSidebar)
 * and the shared one of Traces, Metrics, Exceptions and Security Events
 * (TelemetryFacetSidebar) - and through the shared explorer's shell. jsdom
 * lays nothing out, so the page is laid out here as a browser would: the
 * sidebar as wide as its kept width (else 14rem), never more than half the
 * facets + list area, and each name in a row that has 120px of other things
 * in it (the check box, the bar, the count, the padding).
 */

const PERSON: string = "8a3b0c3e-0000-4000-8000-0000000000aa";
const STORAGE_KEY: string = `${UserPreferenceType.FacetSidebarWidth}.${PERSON}`;

const SERVICE_A: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_B: string = "22222222-2222-4222-8222-222222222222";

const MIN: number = FACET_SIDEBAR_MIN_WIDTH_IN_PX;
const MAX: number = FACET_SIDEBAR_MAX_WIDTH_IN_PX;
const DEFAULT: number = FACET_SIDEBAR_DEFAULT_WIDTH_IN_PX;

// What a name's row holds besides the name.
const ROW_OVERHEAD_IN_PX: number = 120;

// How wide each name is whole, as a browser would measure its text.
const NAME_WIDTHS: Record<string, number> = {
  "payments-reconciliation-worker": 230,
  api: 30,
  "ip-10-0-0-1.eu-west-1.compute.internal": 280,
  Error: 34,
  Information: 78,
};

const CONFIGS: Array<FacetConfig> = [
  {
    key: "primaryEntityId",
    title: "Service",
    priority: 1,
    valueDisplayMap: {
      [SERVICE_A]: "payments-reconciliation-worker",
      [SERVICE_B]: "api",
    },
  },
  { key: "resource.host.name", title: "Host Name", priority: 2 },
];

const FACET_DATA: FacetData = {
  primaryEntityId: [
    { value: SERVICE_A, count: 120 },
    { value: SERVICE_B, count: 4 },
  ],
  "resource.host.name": [
    { value: "ip-10-0-0-1.eu-west-1.compute.internal", count: 7 },
  ],
};

const LOGS_FACET_DATA: LogsFacetData = {
  severityText: [
    { value: "Error", count: 12 },
    { value: "Information", count: 40 },
  ],
  primaryEntityId: [
    {
      value: SERVICE_A,
      count: 9,
      displayName: "payments-reconciliation-worker",
    },
  ],
};

let roomWidth: number = 1200;
let direction: "ltr" | "rtl" = "ltr";
let now: number = 1_000_000;

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

beforeEach(() => {
  roomWidth = 1200;
  direction = "ltr";
  now = 1_000_000;
  window.localStorage.clear();
  forgetFacetSidebarWidths();

  jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
    return new ObjectID(PERSON);
  });

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  // A frame runs at once: one width a frame is one width a move here.
  jest
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback): number => {
      callback(now);
      return 1;
    });

  const realGetComputedStyle: typeof window.getComputedStyle =
    window.getComputedStyle.bind(window);

  jest
    .spyOn(window, "getComputedStyle")
    .mockImplementation((element: Element): CSSStyleDeclaration => {
      const style: CSSStyleDeclaration = realGetComputedStyle(element);

      return new Proxy(style, {
        get: (target: CSSStyleDeclaration, property: string | symbol) => {
          if (property === "direction") {
            return direction;
          }

          const value: unknown = Reflect.get(target, property, target);

          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  forgetFacetSidebarWidths();
});

const rectOf: (left: number, width: number) => DOMRect = (
  left: number,
  width: number,
): DOMRect => {
  return {
    x: left,
    y: 0,
    left: left,
    top: 0,
    width: width,
    height: 20,
    right: left + width,
    bottom: 20,
    toJSON: (): unknown => {
      return {};
    },
  } as DOMRect;
};

// The width the browser draws the sidebar at: its kept width, at most half the room.
const drawnWidthOf: (panel: HTMLElement) => number = (
  panel: HTMLElement,
): number => {
  const kept: number = parseFloat(
    panel.style.getPropertyValue(FACET_SIDEBAR_WIDTH_PROPERTY),
  );

  return Math.min(Number.isFinite(kept) ? kept : DEFAULT, roomWidth * 0.5);
};

// A name laid out in its row, as wide as the sidebar now leaves it.
const layOutName: (name: HTMLElement, panel: HTMLElement) => void = (
  name: HTMLElement,
  panel: HTMLElement,
): void => {
  const fullWidth: () => number = (): number => {
    return NAME_WIDTHS[name.textContent || ""] ?? 40;
  };
  const room: () => number = (): number => {
    return drawnWidthOf(panel) - ROW_OVERHEAD_IN_PX;
  };
  const boxWidth: () => number = (): number => {
    return Math.min(fullWidth(), room());
  };

  Object.defineProperty(name, "scrollWidth", {
    configurable: true,
    get: (): number => {
      return Math.round(fullWidth());
    },
  });
  Object.defineProperty(name, "clientWidth", {
    configurable: true,
    get: (): number => {
      return Math.round(boxWidth());
    },
  });
  name.getBoundingClientRect = (): DOMRect => {
    return rectOf(28, boxWidth());
  };
  name.getClientRects = (): DOMRectList => {
    return Object.assign([rectOf(28, boxWidth())], {
      item: (): DOMRect => {
        return rectOf(28, boxWidth());
      },
    }) as unknown as DOMRectList;
  };

  /*
   * The name's button: its 6px padding (px-1.5), the check box and its gap
   * (28px from the button's start, the padding in), the name's room, and
   * 6px of padding at its end. jsdom reads no Tailwind, and gives a button
   * a padding and a border of its own: the button's are written out here.
   */
  const button: HTMLElement | null = name.parentElement;

  if (button) {
    button.style.paddingLeft = "6px";
    button.style.paddingRight = "6px";
    button.style.borderLeftWidth = "0px";
    button.style.borderRightWidth = "0px";
    button.getBoundingClientRect = (): DOMRect => {
      return rectOf(0, 28 + room() + 6);
    };
  }
};

interface LaidOut {
  panel: HTMLElement;
  handle: HTMLElement;
}

// The page laid out as a browser would, around the sidebar's edge.
const layOutPage: () => LaidOut = (): LaidOut => {
  const handle: HTMLElement = screen.getByTestId(
    FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
  );
  const panel: HTMLElement = document.getElementById(
    handle.getAttribute("aria-controls") || "",
  ) as HTMLElement;
  const area: HTMLElement = panel.parentElement as HTMLElement;

  Object.defineProperty(area, "clientWidth", {
    configurable: true,
    get: (): number => {
      return roomWidth;
    },
  });
  panel.getBoundingClientRect = (): DOMRect => {
    return rectOf(0, drawnWidthOf(panel));
  };

  for (const name of Array.from(
    panel.querySelectorAll(`[${FACET_SIDEBAR_NAME_ATTRIBUTE}]`),
  )) {
    layOutName(name as HTMLElement, panel);
  }

  handle.setPointerCapture = jest.fn() as unknown as (id: number) => void;
  handle.releasePointerCapture = jest.fn() as unknown as (id: number) => void;

  return { panel, handle };
};

// The width written on the sidebar, or null while it is its own 14rem.
const writtenWidthOf: (panel: HTMLElement) => string | null = (
  panel: HTMLElement,
): string | null => {
  return panel.style.getPropertyValue(FACET_SIDEBAR_WIDTH_PROPERTY) || null;
};

const storedWidth: () => string | null = (): string | null => {
  return window.localStorage.getItem(STORAGE_KEY);
};

type PointerType =
  | "pointerDown"
  | "pointerMove"
  | "pointerUp"
  | "pointerCancel";

const pointer: (
  element: HTMLElement,
  type: PointerType,
  clientX: number,
  extra?: PointerEventInit,
) => void = (
  element: HTMLElement,
  type: PointerType,
  clientX: number,
  extra?: PointerEventInit,
): void => {
  act(() => {
    fireEvent[type](element, {
      clientX: clientX,
      clientY: 10,
      button: 0,
      pointerId: 7,
      ...(extra || {}),
    });
  });
};

// A drag from x, through each step, let go at the last.
const drag: (handle: HTMLElement, from: number, to: Array<number>) => void = (
  handle: HTMLElement,
  from: number,
  to: Array<number>,
): void => {
  pointer(handle, "pointerDown", from);

  for (const x of to) {
    pointer(handle, "pointerMove", x);
  }

  pointer(handle, "pointerUp", to[to.length - 1] ?? from);
};

// Two presses close together, in time and place.
const doublePress: (handle: HTMLElement, x?: number) => void = (
  handle: HTMLElement,
  x: number = 230,
): void => {
  pointer(handle, "pointerDown", x);
  pointer(handle, "pointerUp", x);
  now += 120;
  pointer(handle, "pointerDown", x + 1);
  pointer(handle, "pointerUp", x + 1);
};

// Whether a key on the edge was taken (its default prevented).
const pressKey: (
  handle: HTMLElement,
  key: string,
  extra?: KeyboardEventInit,
) => boolean = (
  handle: HTMLElement,
  key: string,
  extra?: KeyboardEventInit,
): boolean => {
  let isTaken: boolean = false;

  act(() => {
    isTaken = !fireEvent.keyDown(handle, { key: key, ...(extra || {}) });
  });

  return isTaken;
};

// As wide as the names the sidebar lists need, with the fit's pixel.
const fitOfListedNames: (panel: HTMLElement) => number = (
  panel: HTMLElement,
): number => {
  const widths: Array<number> = Array.from(
    panel.querySelectorAll(`[${FACET_SIDEBAR_NAME_ATTRIBUTE}]`),
  ).map((name: Element): number => {
    return NAME_WIDTHS[name.textContent || ""] ?? 40;
  });

  return Math.max(DEFAULT, Math.max(...widths) + ROW_OVERHEAD_IN_PX + 1);
};

const telemetrySidebar: () => ReactElement = (): ReactElement => {
  return (
    <TelemetryFacetSidebar
      facetData={FACET_DATA}
      facetConfigs={CONFIGS}
      isLoading={false}
      onIncludeFilter={(): void => {}}
      onRemoveFilter={(): void => {}}
    />
  );
};

const logsSidebar: () => ReactElement = (): ReactElement => {
  return (
    <LogsFacetSidebar
      facetData={LOGS_FACET_DATA}
      isLoading={false}
      serviceMap={{}}
      onIncludeFilter={(): void => {}}
      onRemoveFilter={(): void => {}}
    />
  );
};

const renderTelemetrySidebar: () => void = (): void => {
  render(telemetrySidebar());
};

const renderLogsSidebar: () => void = (): void => {
  render(logsSidebar());
};

const SIDEBARS: Array<[string, () => ReactElement]> = [
  [
    "the shared sidebar (Traces, Metrics, Exceptions, Security Events)",
    telemetrySidebar,
  ],
  ["the Logs sidebar", logsSidebar],
];

describe.each(SIDEBARS)("%s", (_name: string, sidebar: () => ReactElement) => {
  const renderSidebar: () => void = (): void => {
    render(sidebar());
  };

  describe("its edge", () => {
    test("stands right after the sidebar, as a vertical separator that sizes it", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();

      expect(panel.nextElementSibling).toBe(handle);
      expect(handle).toHaveAttribute("role", "separator");
      expect(handle).toHaveAttribute("aria-orientation", "vertical");
      expect(handle).toHaveAttribute("aria-controls", panel.id);
      expect(panel.id).not.toBe("");
      expect(handle).toHaveAttribute("tabindex", "0");
      expect(handle).toHaveAccessibleName("Resize the filters");
      expect(handle).toHaveAttribute(
        "title",
        "Drag to resize. Double-click to fit.",
      );
      expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT));
      expect(handle).toHaveAttribute("aria-valuemin", String(MIN));
      expect(handle).toHaveAttribute("aria-valuemax", String(MAX));
      expect(handle).toHaveAttribute("aria-valuetext", "224 pixels wide");
    });

    test("is found by a screen reader as the filters' separator", () => {
      renderSidebar();

      expect(
        screen.getByRole("separator", { name: "Resize the filters" }),
      ).toBe(screen.getByTestId(FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID));
    });

    test("until a person sizes it, the sidebar is its own 14rem", () => {
      renderSidebar();
      const { panel } = layOutPage();

      expect(writtenWidthOf(panel)).toBeNull();
      expect(panel).toHaveClass(...FACET_SIDEBAR_WIDTH_CLASS_NAME.split(" "));
      expect(panel).not.toHaveClass("md:w-56");
    });

    test("a width kept before is the sidebar's from the start", () => {
      window.localStorage.setItem(STORAGE_KEY, "320");

      renderSidebar();
      const { panel, handle } = layOutPage();

      expect(writtenWidthOf(panel)).toBe("320px");
      expect(handle).toHaveAttribute("aria-valuenow", "320");
      expect(handle).toHaveAttribute("aria-valuetext", "320 pixels wide");
    });

    test("every facet value's name is one the fit reads", () => {
      renderSidebar();
      const { panel } = layOutPage();

      const names: Array<string> = Array.from(
        panel.querySelectorAll(`[${FACET_SIDEBAR_NAME_ATTRIBUTE}]`),
      ).map((name: Element): string => {
        return name.textContent || "";
      });

      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("payments-reconciliation-worker");
    });
  });

  describe("a drag on its edge", () => {
    test("the sidebar follows the pointer, and keeps the width where it is let go", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();

      pointer(handle, "pointerDown", 230);
      expect(handle).toHaveAttribute("data-resizing", "true");

      pointer(handle, "pointerMove", 270);
      expect(writtenWidthOf(panel)).toBe("264px");
      expect(handle).toHaveAttribute("aria-valuenow", "264");

      pointer(handle, "pointerMove", 330);
      expect(writtenWidthOf(panel)).toBe("324px");

      // Nothing is kept while the edge is still held.
      expect(storedWidth()).toBeNull();

      pointer(handle, "pointerUp", 330);

      expect(storedWidth()).toBe("324");
      expect(writtenWidthOf(panel)).toBe("324px");
      expect(handle).not.toHaveAttribute("data-resizing");
      expect(handle).toHaveAttribute("aria-valuenow", "324");
    });

    test("narrower too: a drag to the left gives the list the room", () => {
      renderSidebar();
      const { handle } = layOutPage();

      drag(handle, 230, [210, 200]);

      expect(storedWidth()).toBe(String(DEFAULT - 30));
    });

    test("holds the pointer for the drag, and lets it go after", () => {
      renderSidebar();
      const { handle } = layOutPage();

      drag(handle, 230, [300]);

      expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
      expect(handle.releasePointerCapture).toHaveBeenCalledWith(7);
    });

    test("stops at 11rem, however far left the pointer goes", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();

      drag(handle, 230, [-400]);

      expect(storedWidth()).toBe(String(MIN));
      expect(writtenWidthOf(panel)).toBe(`${MIN}px`);
    });

    test("stops at half the room: the list always keeps the other half", () => {
      roomWidth = 700;
      renderSidebar();
      const { handle } = layOutPage();

      drag(handle, 230, [2000]);

      expect(storedWidth()).toBe("350");
      expect(handle).toHaveAttribute("aria-valuemax", "350");
    });

    test("stops at 40rem, however wide the room", () => {
      roomWidth = 3000;
      renderSidebar();
      const { handle } = layOutPage();

      drag(handle, 230, [5000]);

      expect(storedWidth()).toBe(String(MAX));
    });

    test("starts from the width drawn, when the room cuts a kept width short", () => {
      window.localStorage.setItem(STORAGE_KEY, "600");
      roomWidth = 1000;
      renderSidebar();
      const { handle } = layOutPage();

      // Drawn at 500 (half the room), not 600: 50px to the left is 450.
      drag(handle, 500, [450]);

      expect(storedWidth()).toBe("450");
    });

    test("a press that does not move the edge keeps nothing", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();

      drag(handle, 230, [231]);

      expect(storedWidth()).toBeNull();
      expect(writtenWidthOf(panel)).toBeNull();
    });

    test("Escape puts the sidebar back as it was, and keeps nothing", () => {
      window.localStorage.setItem(STORAGE_KEY, "320");
      renderSidebar();
      const { panel, handle } = layOutPage();

      pointer(handle, "pointerDown", 320);
      pointer(handle, "pointerMove", 420);
      expect(writtenWidthOf(panel)).toBe("420px");

      expect(pressKey(handle, "Escape")).toBe(true);

      expect(writtenWidthOf(panel)).toBe("320px");
      expect(handle).toHaveAttribute("aria-valuenow", "320");
      expect(handle).not.toHaveAttribute("data-resizing");

      // The drag is over: letting go now keeps nothing.
      pointer(handle, "pointerUp", 420);
      expect(storedWidth()).toBe("320");
    });

    test("REGRESSION: Escape puts it back wherever the focus is - a press on the edge does not take the focus", () => {
      window.localStorage.setItem(STORAGE_KEY, "320");
      renderSidebar();
      const { panel, handle } = layOutPage();
      const search: HTMLInputElement = document.createElement("input");
      document.body.appendChild(search);
      search.focus();

      pointer(handle, "pointerDown", 320);
      pointer(handle, "pointerMove", 420);

      // The search box still has the focus, and hears the key first in a browser.
      expect(document.activeElement).toBe(search);
      act(() => {
        fireEvent.keyDown(search, { key: "Escape" });
      });

      expect(writtenWidthOf(panel)).toBe("320px");
      expect(handle).not.toHaveAttribute("data-resizing");
      pointer(handle, "pointerUp", 420);
      expect(storedWidth()).toBe("320");

      search.remove();
    });

    test("Escape mid-drag is the drag's alone: a dialog the explorer stands in stays open", () => {
      renderSidebar();
      const { handle } = layOutPage();
      const dialogHears: Mock<(event: Event) => void> =
        jest.fn<(event: Event) => void>();
      document.addEventListener(
        "keydown",
        dialogHears as unknown as EventListener,
      );

      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerMove", 300);

      let isTaken: boolean = false;
      act(() => {
        isTaken = !fireEvent.keyDown(document.body, { key: "Escape" });
      });

      expect(isTaken).toBe(true);
      expect(dialogHears).not.toHaveBeenCalled();

      document.removeEventListener(
        "keydown",
        dialogHears as unknown as EventListener,
      );
    });

    test("once the drag is over, Escape is the page's again", () => {
      renderSidebar();
      const { handle } = layOutPage();
      const pageHears: Mock<(event: Event) => void> =
        jest.fn<(event: Event) => void>();
      document.addEventListener(
        "keydown",
        pageHears as unknown as EventListener,
      );

      drag(handle, 230, [300]);
      act(() => {
        fireEvent.keyDown(document.body, { key: "Escape" });
      });

      expect(pageHears).toHaveBeenCalledTimes(1);
      expect(storedWidth()).toBe("294");

      document.removeEventListener(
        "keydown",
        pageHears as unknown as EventListener,
      );
    });

    test("a sidebar that goes away mid-drag stops hearing Escape", () => {
      renderSidebar();
      const { handle } = layOutPage();
      const pageHears: Mock<(event: Event) => void> =
        jest.fn<(event: Event) => void>();
      document.addEventListener(
        "keydown",
        pageHears as unknown as EventListener,
      );

      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerMove", 300);
      cleanup();

      act(() => {
        fireEvent.keyDown(document.body, { key: "Escape" });
      });

      expect(pageHears).toHaveBeenCalledTimes(1);
      expect(storedWidth()).toBeNull();

      document.removeEventListener(
        "keydown",
        pageHears as unknown as EventListener,
      );
    });

    test("Escape gives a sidebar of its own width back its own width", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();

      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerMove", 400);
      pressKey(handle, "Escape");

      expect(writtenWidthOf(panel)).toBeNull();
      expect(storedWidth()).toBeNull();
    });

    test("a pointer the browser cancels (a scroll took it) puts the sidebar back", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();

      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerMove", 300);
      pointer(handle, "pointerCancel", 300);

      expect(writtenWidthOf(panel)).toBeNull();
      expect(storedWidth()).toBeNull();
    });

    test("a pointer the browser takes back mid-drag keeps what was dragged", () => {
      renderSidebar();
      const { handle } = layOutPage();

      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerMove", 300);
      act(() => {
        fireEvent.lostPointerCapture(handle, { pointerId: 7 });
      });

      expect(storedWidth()).toBe("294");
      expect(handle).not.toHaveAttribute("data-resizing");
    });

    test("only the main button drags: a right click opens the browser's menu", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();

      pointer(handle, "pointerDown", 230, { button: 2 });
      pointer(handle, "pointerMove", 400);
      pointer(handle, "pointerUp", 400);

      expect(handle).not.toHaveAttribute("data-resizing");
      expect(writtenWidthOf(panel)).toBeNull();
      expect(storedWidth()).toBeNull();
    });

    test("another pointer's moves are not this drag's", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();

      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerMove", 400, { pointerId: 99 });
      pointer(handle, "pointerUp", 400, { pointerId: 99 });

      expect(writtenWidthOf(panel)).toBeNull();
      expect(handle).toHaveAttribute("data-resizing", "true");

      pointer(handle, "pointerUp", 230);
      expect(handle).not.toHaveAttribute("data-resizing");
    });

    test("a press on the edge selects no text and clicks nothing under it", () => {
      const parentClick: Mock<() => void> = jest.fn<() => void>();
      // A card or a row the explorer stands in, listening for clicks.
      render(
        <div onClick={parentClick as unknown as () => void}>{sidebar()}</div>,
      );
      const { handle } = layOutPage();

      let isDefaultAllowed: boolean = true;
      act(() => {
        isDefaultAllowed = fireEvent.pointerDown(handle, {
          clientX: 230,
          button: 0,
          pointerId: 7,
        });
      });
      pointer(handle, "pointerUp", 230);
      act(() => {
        fireEvent.click(handle);
      });

      expect(isDefaultAllowed).toBe(false);
      expect(parentClick).not.toHaveBeenCalled();
    });

    test("on a page read right to left the sidebar stands at the right: a drag to the left widens it", () => {
      direction = "rtl";
      renderSidebar();
      const { handle } = layOutPage();

      drag(handle, 900, [850]);

      expect(storedWidth()).toBe(String(DEFAULT + 50));
    });
  });

  describe("a double-click on its edge", () => {
    test("widens the sidebar until its longest name shows whole", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();
      const fit: number = fitOfListedNames(panel);

      expect(fit).toBeGreaterThan(DEFAULT);

      doublePress(handle);

      expect(storedWidth()).toBe(String(fit));
      expect(writtenWidthOf(panel)).toBe(`${fit}px`);
      expect(handle).toHaveAttribute("aria-valuenow", String(fit));
    });

    test("again, leaves a fitted sidebar as it is", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();
      const fit: number = fitOfListedNames(panel);

      doublePress(handle);
      now += 2000;
      doublePress(handle);

      expect(storedWidth()).toBe(String(fit));
    });

    test("brings a sidebar wider than its names need back down", () => {
      window.localStorage.setItem(STORAGE_KEY, "600");
      renderSidebar();
      const { panel, handle } = layOutPage();
      const fit: number = fitOfListedNames(panel);

      doublePress(handle, 600);

      expect(fit).toBeLessThan(600);
      expect(storedWidth()).toBe(String(fit));
    });

    test("a name longer than the room allows leaves the sidebar as wide as the room allows", () => {
      roomWidth = 560;
      renderSidebar();
      const { handle } = layOutPage();

      doublePress(handle);

      expect(storedWidth()).toBe("280");
    });

    test("two presses too far apart in time are two clicks", () => {
      renderSidebar();
      const { handle } = layOutPage();

      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerUp", 230);
      now += FACET_SIDEBAR_DOUBLE_PRESS_MS + 1;
      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerUp", 230);

      expect(storedWidth()).toBeNull();
    });

    test("two presses too far apart in place are two clicks", () => {
      renderSidebar();
      const { handle } = layOutPage();

      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerUp", 230);
      now += 100;
      pointer(handle, "pointerDown", 250);
      pointer(handle, "pointerUp", 250);

      expect(storedWidth()).toBeNull();
    });

    test("a drag between two presses is no double-click", () => {
      renderSidebar();
      const { handle } = layOutPage();

      pointer(handle, "pointerDown", 230);
      pointer(handle, "pointerUp", 230);
      now += 100;
      drag(handle, 230, [260]);
      now += 100;
      pointer(handle, "pointerDown", 260);
      pointer(handle, "pointerUp", 260);

      // Only the drag is kept.
      expect(storedWidth()).toBe(String(DEFAULT + 30));
    });
  });

  describe("the keyboard on its edge", () => {
    test("the arrows move it 16px a press, and the width is kept", () => {
      renderSidebar();
      const { panel, handle } = layOutPage();

      expect(pressKey(handle, "ArrowRight")).toBe(true);
      expect(storedWidth()).toBe("240");
      expect(writtenWidthOf(panel)).toBe("240px");
      expect(handle).toHaveAttribute("aria-valuenow", "240");
      expect(handle).toHaveAttribute("aria-valuetext", "240 pixels wide");

      expect(pressKey(handle, "ArrowLeft")).toBe(true);
      expect(pressKey(handle, "ArrowLeft")).toBe(true);
      expect(storedWidth()).toBe("208");
    });

    test("with Shift, 64px a press", () => {
      renderSidebar();
      const { handle } = layOutPage();

      pressKey(handle, "ArrowRight", { shiftKey: true });

      expect(storedWidth()).toBe(String(DEFAULT + 64));
    });

    test("Home makes it as narrow as it goes", () => {
      renderSidebar();
      const { handle } = layOutPage();

      expect(pressKey(handle, "Home")).toBe(true);
      expect(storedWidth()).toBe(String(MIN));
    });

    test("End and Enter fit it to its names, as a double-click does", () => {
      for (const key of ["End", "Enter"]) {
        renderSidebar();
        const { panel, handle } = layOutPage();
        const fit: number = fitOfListedNames(panel);

        expect({ key, isTaken: pressKey(handle, key) }).toEqual({
          key,
          isTaken: true,
        });
        expect({ key, stored: storedWidth() }).toEqual({
          key,
          stored: String(fit),
        });

        cleanup();
        window.localStorage.clear();
        forgetFacetSidebarWidths();
      }
    });

    test("Delete and Backspace give it back its own width", () => {
      for (const key of ["Delete", "Backspace"]) {
        window.localStorage.setItem(STORAGE_KEY, "400");
        renderSidebar();
        const { panel, handle } = layOutPage();

        expect({ key, isTaken: pressKey(handle, key) }).toEqual({
          key,
          isTaken: true,
        });
        expect({ key, stored: storedWidth() }).toEqual({ key, stored: null });
        expect({ key, written: writtenWidthOf(panel) }).toEqual({
          key,
          written: null,
        });
        expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT));

        cleanup();
        forgetFacetSidebarWidths();
      }
    });

    test("an arrow at the room's end keeps nothing new", () => {
      roomWidth = 600;
      window.localStorage.setItem(STORAGE_KEY, "300");
      renderSidebar();
      const setItem: jest.SpiedFunction<typeof window.localStorage.setItem> =
        jest.spyOn(Storage.prototype, "setItem");
      const { handle } = layOutPage();

      expect(pressKey(handle, "ArrowRight")).toBe(true);

      expect(setItem).not.toHaveBeenCalled();
      expect(storedWidth()).toBe("300");
    });

    test("Tab and every other key go on to the page", () => {
      renderSidebar();
      const { handle } = layOutPage();

      for (const key of ["Tab", " ", "a", "ArrowUp", "ArrowDown", "Escape"]) {
        expect({ key, isTaken: pressKey(handle, key) }).toEqual({
          key,
          isTaken: false,
        });
      }

      expect(storedWidth()).toBeNull();
    });

    test("a key held with Ctrl, Alt or Meta is the page's shortcut, not the edge's", () => {
      renderSidebar();
      const { handle } = layOutPage();

      for (const modifier of ["ctrlKey", "altKey", "metaKey"]) {
        expect({
          modifier,
          isTaken: pressKey(handle, "ArrowRight", { [modifier]: true }),
        }).toEqual({ modifier, isTaken: false });
      }

      expect(storedWidth()).toBeNull();
    });

    test("on a page read right to left, the left arrow widens it", () => {
      direction = "rtl";
      renderSidebar();
      const { handle } = layOutPage();

      pressKey(handle, "ArrowLeft");

      expect(storedWidth()).toBe(String(DEFAULT + 16));
    });

    test("taking the focus reads the width drawn and the room's most", () => {
      window.localStorage.setItem(STORAGE_KEY, "600");
      roomWidth = 1000;
      renderSidebar();
      const { handle } = layOutPage();

      act(() => {
        handle.focus();
      });

      expect(handle).toHaveAttribute("aria-valuenow", "500");
      expect(handle).toHaveAttribute("aria-valuemax", "500");
    });
  });
});

describe("one width for every explorer", () => {
  test("a width kept in one sidebar is drawn by every other on the page", () => {
    render(
      <>
        <div>
          <TelemetryFacetSidebar
            facetData={FACET_DATA}
            facetConfigs={CONFIGS}
            isLoading={false}
            onIncludeFilter={(): void => {}}
            onRemoveFilter={(): void => {}}
          />
        </div>
        <div>
          <LogsFacetSidebar
            facetData={LOGS_FACET_DATA}
            isLoading={false}
            serviceMap={{}}
            onIncludeFilter={(): void => {}}
            onRemoveFilter={(): void => {}}
          />
        </div>
      </>,
    );

    const handles: Array<HTMLElement> = screen.getAllByTestId(
      FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
    );
    expect(handles).toHaveLength(2);

    const panels: Array<HTMLElement> = handles.map(
      (handle: HTMLElement): HTMLElement => {
        return document.getElementById(
          handle.getAttribute("aria-controls") || "",
        ) as HTMLElement;
      },
    );

    pressKey(handles[0] as HTMLElement, "ArrowRight", { shiftKey: true });

    for (const panel of panels) {
      expect(writtenWidthOf(panel)).toBe(`${DEFAULT + 64}px`);
    }
    expect(handles[1]).toHaveAttribute("aria-valuenow", String(DEFAULT + 64));
  });

  test("a sidebar drawn later - another explorer - draws the width kept before", () => {
    renderTelemetrySidebar();
    const { handle } = layOutPage();
    pressKey(handle, "ArrowRight");
    cleanup();

    renderLogsSidebar();
    const { panel } = layOutPage();

    expect(writtenWidthOf(panel)).toBe(`${DEFAULT + 16}px`);
  });
});

describe("through the shared explorer's shell", () => {
  interface Item {
    id: string;
  }

  const renderViewer: (
    props?: Partial<React.ComponentProps<typeof TelemetryViewer<Item>>>,
  ) => void = (
    props: Partial<React.ComponentProps<typeof TelemetryViewer<Item>>> = {},
  ): void => {
    render(
      <TelemetryViewer<Item>
        items={[]}
        isLoading={false}
        renderRow={(item: Item): React.ReactElement => {
          return <span>{item.id}</span>;
        }}
        getRowKey={(item: Item): string => {
          return item.id;
        }}
        searchValue=""
        onSearchChange={(): void => {}}
        onSearchSubmit={(): void => {}}
        searchPlaceholder="Search metrics"
        timeRange={{ range: TimeRange.PAST_ONE_DAY }}
        onTimeRangeChange={(): void => {}}
        live={{ isLive: false, onToggle: (): void => {} }}
        onRefresh={(): void => {}}
        facetConfigs={CONFIGS}
        facetData={FACET_DATA}
        page={1}
        pageSize={50}
        totalCount={0}
        onPageChange={(): void => {}}
        onPageSizeChange={(): void => {}}
        itemLabel="metrics"
        {...props}
      />,
    );
  };

  test("the edge stands between the sidebar and the list, which takes the rest of the room", () => {
    renderViewer();
    const { panel, handle } = layOutPage();
    const mainArea: HTMLElement = screen.getByTestId(
      TELEMETRY_VIEWER_MAIN_AREA_TEST_ID,
    );
    const list: HTMLElement = screen.getByTestId(TELEMETRY_VIEWER_LIST_TEST_ID);

    expect(Array.from(mainArea.children)).toEqual([panel, handle, list]);
    // The 12px gap the edge is drawn over, and a list that takes what is left.
    expect(mainArea).toHaveClass("gap-3", "md:flex-row");
    expect(list).toHaveClass("min-w-0", "flex-1");
  });

  test("a drag on the edge sizes the explorer's sidebar", () => {
    renderViewer();
    const { panel, handle } = layOutPage();

    drag(handle, 230, [330]);

    expect(writtenWidthOf(panel)).toBe(`${DEFAULT + 100}px`);
    expect(storedWidth()).toBe(String(DEFAULT + 100));
  });

  test("its sidebar's room is the facets + list area: half of it at most", () => {
    roomWidth = 800;
    renderViewer();
    const { handle } = layOutPage();

    drag(handle, 230, [2000]);

    expect(storedWidth()).toBe("400");
  });

  test("an explorer showing no sidebar has no edge", () => {
    renderViewer({ showFacetSidebar: false });
    expect(
      screen.queryByTestId(FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID),
    ).toBeNull();
    cleanup();

    renderViewer({ facetConfigs: [] });
    expect(
      screen.queryByTestId(FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID),
    ).toBeNull();
  });

  test("a view that replaces the list (analytics) hides the edge with the sidebar", () => {
    renderViewer({ mainContentOverride: <p>Analytics</p> });

    const mainArea: HTMLElement = screen.getByTestId(
      TELEMETRY_VIEWER_MAIN_AREA_TEST_ID,
    );

    expect(mainArea).toHaveClass("hidden");
    expect(mainArea).toContainElement(
      screen.getByTestId(FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID),
    );
  });
});

describe("how the edge looks", () => {
  const tokensOf: (className: string) => Array<string> = (
    className: string,
  ): Array<string> => {
    return className.split(/\s+/).filter(Boolean);
  };

  test("its hit area covers the 12px gap and 4px of the sidebar, and adds nothing to the row", () => {
    const tokens: Array<string> = tokensOf(
      FACET_SIDEBAR_RESIZE_HANDLE_CLASS_NAME,
    );

    // 16px wide, pulled 16px back over the gap and the sidebar's edge, and 12px off the list.
    expect(tokens).toEqual(
      expect.arrayContaining([
        "-ml-4",
        "w-4",
        "-mr-3",
        "flex-none",
        "self-stretch",
      ]),
    );
    // -16 + 16 - 12 = -12: the row's gap-3 is all that stands between sidebar and list.
    expect(-16 + 16 - 12 + 12).toBe(0);
  });

  test("it shows the resize cursor, takes a finger's drag, and selects no text", () => {
    expect(tokensOf(FACET_SIDEBAR_RESIZE_HANDLE_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "cursor-col-resize",
        "touch-none",
        "select-none",
        "relative",
      ]),
    );
  });

  test("its line shows only while it is pointed at, has the focus or is dragged", () => {
    const tokens: Array<string> = tokensOf(
      FACET_SIDEBAR_RESIZE_LINE_CLASS_NAME,
    );

    expect(tokens).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "bg-indigo-500",
        "pointer-events-none",
        "group-hover/edge:opacity-100",
        "group-focus-visible/edge:opacity-100",
        "group-data-[resizing=true]/edge:opacity-100",
      ]),
    );
    expect(tokensOf(FACET_SIDEBAR_RESIZE_HANDLE_CLASS_NAME)).toContain(
      "group/edge",
    );
  });

  test("its line runs down the middle of the gap, the same on a page read either way", () => {
    // 9px into a 16px edge whose first 4px are the sidebar's: 5px into the 12px gap.
    expect(tokensOf(FACET_SIDEBAR_RESIZE_LINE_CLASS_NAME)).toEqual(
      expect.arrayContaining(["left-[9px]", "w-0.5"]),
    );
    // A 2px line 5px from either side of a 12px gap sits in its middle.
    expect(5 + 2 + 5).toBe(12);
  });

  test("it is drawn only where the sidebar stands beside the list: from md up", () => {
    render(
      <FacetSidebarResizeHandle
        panelRef={React.createRef<HTMLElement>()}
        width={null}
        onWidthChange={(): void => {}}
      />,
    );
    const handle: HTMLElement = screen.getByTestId(
      FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
    );

    expect(describeVisibility(handle, PHONE_WIDTH_IN_PX)).not.toBe(
      `visible at ${PHONE_WIDTH_IN_PX}px`,
    );
    expect(describeVisibility(handle, TABLET_WIDTH_IN_PX)).toBe(
      `visible at ${TABLET_WIDTH_IN_PX}px`,
    );
    expect(describeVisibility(handle, LAPTOP_WIDTH_IN_PX)).toBe(
      `visible at ${LAPTOP_WIDTH_IN_PX}px`,
    );
  });

  test("it never carries a bare hidden, which a foreign stylesheet's .hidden would pin", () => {
    expect(tokensOf(FACET_SIDEBAR_RESIZE_HANDLE_CLASS_NAME)).not.toContain(
      "hidden",
    );
    expect(tokensOf(FACET_SIDEBAR_RESIZE_HANDLE_CLASS_NAME)).toEqual(
      expect.arrayContaining(["max-md:hidden", "md:block"]),
    );
  });

  test("an edge with no sidebar to size does nothing", () => {
    const onWidthChange: Mock<(width: number | null) => void> =
      jest.fn<(width: number | null) => void>();
    render(
      <FacetSidebarResizeHandle
        panelRef={React.createRef<HTMLElement>()}
        width={null}
        onWidthChange={
          onWidthChange as unknown as (width: number | null) => void
        }
      />,
    );
    const handle: HTMLElement = screen.getByTestId(
      FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
    );

    drag(handle, 230, [400]);
    expect(pressKey(handle, "ArrowRight")).toBe(false);
    act(() => {
      handle.focus();
    });

    expect(onWidthChange).not.toHaveBeenCalled();
  });

  test("its words are the ones looked up in every language", () => {
    expect(FACET_SIDEBAR_RESIZE_NAME).toBe("Resize the filters");
    expect(FACET_SIDEBAR_RESIZE_HINT).toBe(
      "Drag to resize. Double-click to fit.",
    );
  });
});

describe("the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: [
      "Components/TelemetryViewer/components/FacetSidebarResizeHandle.tsx",
      "Components/TelemetryViewer/components/FacetSidebarPanel.tsx",
      "Components/TelemetryViewer/FacetSidebarWidth.ts",
    ],
  });

  test("reads the colours it means to", () => {
    for (const token of ["bg-indigo-500", "border-gray-200", "bg-white"]) {
      expect([token, scan.colorTokens.includes(token)]).toEqual([token, true]);
    }
  });

  test("every colour class has its dark rule in Theme.css", () => {
    expect(scan.unmapped).toEqual([]);
  });

  test("no dark: variant, which the theme does not go by", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
  });

  test("no colour class built from a template, which no scan could check", () => {
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });
});
