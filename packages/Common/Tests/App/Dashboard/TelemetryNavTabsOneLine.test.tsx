import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import TelemetryNavTabs, {
  TELEMETRY_NAV_TABS_TEST_IDS,
  TelemetryTab,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/NavTabs";
import { TAB_BAR_FADE_CLASS_NAMES } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TabBarScroll";
import LogsNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsNavTabs";
import TracesNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesNavTabs";
import MetricsNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsNavTabs";
import ExceptionsNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsNavTabs";
import LlmNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmNavTabs";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A telemetry product's tabs stay on one line (Components/Telemetry/
 * NavTabs): on a phone Viewer, Insights, AI, Setup Guide and Settings do
 * not fit, and they used to wrap - Setup Guide alone on a second line, in
 * Logs, Traces, Metrics, Exceptions and AI / LLM alike. Now the line
 * scrolls sideways, its hidden edges fade, and the lit tab is scrolled to
 * the middle. jsdom lays nothing out, so the browser suite (packages/E2E/
 * LogsAi) measures the phone; this holds the markup that makes it so, in
 * every product, and what the bar does with what it measures.
 */

const TABS: Array<TelemetryTab> = [
  {
    key: "viewer",
    label: "Viewer",
    icon: IconProp.List,
    to: new Route("/viewer"),
  },
  {
    key: "insights",
    label: "Insights",
    icon: IconProp.ChartBar,
    to: new Route("/insights"),
  },
  { key: "ai", label: "AI", icon: IconProp.Sparkles, to: new Route("/ai") },
  {
    key: "setup",
    label: "Setup Guide",
    icon: IconProp.Book,
    to: new Route("/setup"),
  },
  {
    key: "settings",
    label: "Settings",
    icon: IconProp.Settings,
    to: new Route("/settings"),
  },
];

function scroller(): HTMLElement {
  return screen.getByTestId(TELEMETRY_NAV_TABS_TEST_IDS.scroller);
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

// What a phone measures: 509px of tabs in a 326px bar, scrolled `left`.
function lay(element: HTMLElement, data: { scrollLeft: number }): void {
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    value: 509,
  });
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: 326,
  });
  element.scrollLeft = data.scrollLeft;
}

describe("a telemetry product's tab bar is one line", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/logs`);
    // Exceptions counts its unresolved exceptions for its tab's badge.
    jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("its tabs never wrap: the line scrolls sideways, its scrollbar out of sight", () => {
    render(
      <MemoryRouter>
        <TelemetryNavTabs tabs={TABS} activeKey="ai" />
      </MemoryRouter>,
    );

    const line: Array<string> = classesOf(scroller());

    expect(line).toContain("flex");
    expect(line).toContain("overflow-x-auto");
    expect(line).not.toContain("flex-wrap");
    // The bar hides its scrollbar in every engine: the fade says there is more.
    expect(line).toContain("[scrollbar-width:none]");
    expect(line).toContain("[&::-webkit-scrollbar]:hidden");
    // It may shrink to the page, never push it wider.
    expect(line).toContain("min-w-0");

    const bar: Array<string> = classesOf(
      screen.getByTestId(TELEMETRY_NAV_TABS_TEST_IDS.bar),
    );

    expect(bar).toContain("min-w-0");
    expect(bar).toContain("max-w-full");
    expect(bar).not.toContain("flex-wrap");

    for (const link of Array.from(scroller().querySelectorAll("a"))) {
      // Each tab keeps its width and its words on one line.
      expect(classesOf(link)).toEqual(
        expect.arrayContaining(["flex-none", "whitespace-nowrap"]),
      );
    }
  });

  test("the lit tab, and only it, is announced as the current page", () => {
    render(
      <MemoryRouter>
        <TelemetryNavTabs tabs={TABS} activeKey="setup" />
      </MemoryRouter>,
    );

    const links: Array<HTMLAnchorElement> = Array.from(
      scroller().querySelectorAll("a"),
    );

    expect(
      links
        .filter((link: HTMLAnchorElement): boolean => {
          return link.getAttribute("aria-current") === "page";
        })
        .map((link: HTMLAnchorElement): string => {
          return link.textContent || "";
        }),
    ).toEqual(["Setup Guide"]);
    expect(screen.getByText("Setup Guide").closest("a")).toHaveClass(
      "bg-indigo-50",
    );
  });

  test("tabs that fit fade nothing", () => {
    render(
      <MemoryRouter>
        <TelemetryNavTabs tabs={TABS} activeKey="ai" />
      </MemoryRouter>,
    );

    expect(scroller()).toHaveAttribute("data-hidden-left", "false");
    expect(scroller()).toHaveAttribute("data-hidden-right", "false");

    for (const className of Object.values(TAB_BAR_FADE_CLASS_NAMES)) {
      expect(scroller().getAttribute("class")).not.toContain(className);
    }
  });

  test("as the reader scrolls a phone's bar, the edge that hides tabs fades, and only it", () => {
    render(
      <MemoryRouter>
        <TelemetryNavTabs tabs={TABS} activeKey="viewer" />
      </MemoryRouter>,
    );

    lay(scroller(), { scrollLeft: 0 });
    fireEvent.scroll(scroller());

    expect(scroller()).toHaveAttribute("data-hidden-left", "false");
    expect(scroller()).toHaveAttribute("data-hidden-right", "true");
    expect(scroller().getAttribute("class")).toContain(
      TAB_BAR_FADE_CLASS_NAMES.right,
    );

    lay(scroller(), { scrollLeft: 90 });
    fireEvent.scroll(scroller());

    expect(scroller()).toHaveAttribute("data-hidden-left", "true");
    expect(scroller()).toHaveAttribute("data-hidden-right", "true");
    expect(scroller().getAttribute("class")).toContain(
      TAB_BAR_FADE_CLASS_NAMES.both,
    );

    lay(scroller(), { scrollLeft: 183 });
    fireEvent.scroll(scroller());

    expect(scroller()).toHaveAttribute("data-hidden-left", "true");
    expect(scroller()).toHaveAttribute("data-hidden-right", "false");
    expect(scroller().getAttribute("class")).toContain(
      TAB_BAR_FADE_CLASS_NAMES.left,
    );
  });

  test("the bar is measured again when the window changes size", () => {
    render(
      <MemoryRouter>
        <TelemetryNavTabs tabs={TABS} activeKey="viewer" />
      </MemoryRouter>,
    );

    expect(scroller()).toHaveAttribute("data-hidden-right", "false");

    lay(scroller(), { scrollLeft: 0 });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(scroller()).toHaveAttribute("data-hidden-right", "true");
  });

  test("the lit tab is scrolled to the middle of the bar when the page opens", () => {
    /*
     * Settings, the last tab, sits past a 326px bar's edge at 470..572; the
     * bar is at 32..358. The bar scrolls by the distance between their
     * middles, and only the bar: the page is not asked to scroll.
     */
    const boxes: Map<string, { left: number; right: number }> = new Map([
      ["Settings", { left: 470, right: 572 }],
    ]);
    const originalRect: () => DOMRect =
      HTMLElement.prototype.getBoundingClientRect;
    const scrollIntoView: ReturnType<typeof jest.fn> = jest.fn();

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    HTMLElement.prototype.getBoundingClientRect = function (
      this: HTMLElement,
    ): DOMRect {
      const box: { left: number; right: number } | undefined =
        this.getAttribute("data-testid") ===
        TELEMETRY_NAV_TABS_TEST_IDS.scroller
          ? { left: 32, right: 358 }
          : boxes.get(this.textContent || "");

      if (!box) {
        return originalRect.call(this);
      }

      return {
        left: box.left,
        right: box.right,
        width: box.right - box.left,
        top: 0,
        bottom: 32,
        height: 32,
        x: box.left,
        y: 0,
        toJSON: (): string => {
          return "";
        },
      } as DOMRect;
    };

    try {
      render(
        <MemoryRouter>
          <TelemetryNavTabs tabs={TABS} activeKey="settings" />
        </MemoryRouter>,
      );

      expect(scroller().scrollLeft).toBe((470 + 572) / 2 - (32 + 358) / 2);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown })
        .scrollIntoView;
    }
  });

  test.each([
    ["Logs", <LogsNavTabs key="logs" active="ai" />],
    ["Traces", <TracesNavTabs key="traces" active="ai" />],
    ["Metrics", <MetricsNavTabs key="metrics" active="ai" />],
    ["Exceptions", <ExceptionsNavTabs key="exceptions" active="ai" />],
    ["AI / LLM", <LlmNavTabs key="llm" active="conversations" />],
  ])(
    "%s draws its tabs in the one-line bar",
    async (product: string, element: React.ReactElement) => {
      render(<MemoryRouter>{element}</MemoryRouter>);

      expect(
        screen.getByTestId(TELEMETRY_NAV_TABS_TEST_IDS.bar),
      ).toBeInTheDocument();
      expect(scroller().querySelectorAll("a").length).toBeGreaterThanOrEqual(4);
      expect(scroller().querySelectorAll("a[aria-current='page']").length).toBe(
        1,
      );

      // Exceptions reads its tab's count as it opens: let it land.
      if (product === "Exceptions") {
        await waitFor(() => {
          expect(ModelAPI.count).toHaveBeenCalled();
        });
      }
    },
  );
});
