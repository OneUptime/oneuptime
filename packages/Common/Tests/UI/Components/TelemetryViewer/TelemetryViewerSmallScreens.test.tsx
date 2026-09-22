import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import TelemetryViewer, {
  TELEMETRY_VIEWER_FILTERS_TOGGLE_TEST_ID,
  TELEMETRY_VIEWER_LIST_TEST_ID,
  TELEMETRY_VIEWER_MAIN_AREA_TEST_ID,
  TELEMETRY_VIEWER_SEARCH_TEST_ID,
} from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import {
  FacetConfig,
  FacetData,
} from "../../../../UI/Components/TelemetryViewer/types";
import TimeRange from "../../../../Types/Time/TimeRange";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  describeVisibility,
} from "../../../ResponsiveVisibility";

/*
 * The shared telemetry shell (Traces, Metrics, Exceptions, Security Events)
 * on a phone.
 *
 * The facet sidebar is a fixed 14rem card, and it sat beside the list at every
 * width. At 390px that left the list card about 110px: the empty state wrapped
 * one word per line, its buttons turned into tall narrow slabs, and the
 * pagination footer stuck out of the card and scrolled the page sideways.
 * The toolbar broke as well. The search had a zero flex basis, so it shared
 * one row with every button and was squeezed to ~50px, and its input kept its
 * intrinsic width and painted its placeholder over "Past 1 Day" and "Paused".
 *
 * Below md the sidebar now stacks above the list, folded behind a "Filters"
 * toggle, and the search keeps a usable width on its own row. From md up the
 * layout is the old one. jsdom has no stylesheet, so these tests read the
 * Tailwind classes, and ResponsiveVisibility resolves `display` per width.
 */

interface Item {
  id: string;
}

const FACET_CONFIGS: Array<FacetConfig> = [
  { key: "severity", title: "Severity", priority: 1 },
  { key: "source", title: "Source", priority: 2 },
];

const FACET_DATA: FacetData = {
  severity: [
    { value: "High", count: 3 },
    { value: "Low", count: 1 },
  ],
  source: [{ value: "CrowdStrike", count: 4 }],
};

function renderViewer(
  props: Partial<React.ComponentProps<typeof TelemetryViewer<Item>>> = {},
): void {
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
      searchPlaceholder="Search security events"
      timeRange={{ range: TimeRange.PAST_ONE_DAY }}
      onTimeRangeChange={(): void => {}}
      live={{ isLive: false, onToggle: (): void => {} }}
      onRefresh={(): void => {}}
      facetConfigs={FACET_CONFIGS}
      facetData={FACET_DATA}
      page={1}
      pageSize={50}
      totalCount={0}
      onPageChange={(): void => {}}
      onPageSizeChange={(): void => {}}
      itemLabel="events"
      {...props}
    />,
  );
}

function mainArea(): HTMLElement {
  return screen.getByTestId(TELEMETRY_VIEWER_MAIN_AREA_TEST_ID);
}

function listCard(): HTMLElement {
  return screen.getByTestId(TELEMETRY_VIEWER_LIST_TEST_ID);
}

function filtersToggle(): HTMLElement {
  return screen.getByTestId(TELEMETRY_VIEWER_FILTERS_TOGGLE_TEST_ID);
}

// The sidebar is the main area's first child, the one the toggle points at.
function sidebar(): HTMLElement {
  const first: Element | null = mainArea().firstElementChild;

  if (!(first instanceof HTMLElement) || first === listCard()) {
    throw new Error("the facet sidebar was not rendered before the list");
  }

  return first;
}

function classTokens(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

afterEach(() => {
  cleanup();
});

describe("the facets + list area below md", () => {
  test("stacks the sidebar above the list below md, and puts them side by side from md up", () => {
    renderViewer();

    expect(mainArea()).toHaveClass("flex", "flex-col", "md:flex-row");
    // A bare flex-row would put the side-by-side layout back on phones.
    expect(classTokens(mainArea())).not.toContain("flex-row");

    // The sidebar comes first, so it stacks above the list rather than under it.
    const children: Array<Element> = Array.from(mainArea().children);
    expect(children).toEqual([sidebar(), listCard()]);
  });

  test("the stacked sidebar spans the width and is capped so it cannot bury the list", () => {
    renderViewer();

    expect(sidebar()).toHaveClass(
      "w-full",
      "max-h-80",
      "overflow-y-auto",
      "md:w-56",
      "md:h-full",
      "md:max-h-none",
    );

    /*
     * Unprefixed, these are the regression: a 14rem sidebar at every width,
     * and a full-height one once it is stacked.
     */
    expect(classTokens(sidebar())).not.toContain("w-56");
    expect(classTokens(sidebar())).not.toContain("h-full");

    expect(listCard()).toHaveClass("min-w-0", "flex-1");
  });

  test("on a phone the sidebar starts folded behind a Filters toggle, and the list is shown", () => {
    renderViewer();

    expect(filtersToggle()).toHaveTextContent("Filters");
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    expect(filtersToggle()).toHaveAttribute("aria-controls", sidebar().id);
    expect(sidebar().id).not.toBe("");

    expect(describeVisibility(filtersToggle(), PHONE_WIDTH_IN_PX)).toBe(
      `visible at ${PHONE_WIDTH_IN_PX}px`,
    );
    expect(describeVisibility(sidebar(), PHONE_WIDTH_IN_PX)).not.toBe(
      `visible at ${PHONE_WIDTH_IN_PX}px`,
    );
    expect(describeVisibility(listCard(), PHONE_WIDTH_IN_PX)).toBe(
      `visible at ${PHONE_WIDTH_IN_PX}px`,
    );
  });

  test("the toggle opens the stacked sidebar on a phone and folds it again", () => {
    renderViewer();

    fireEvent.click(filtersToggle());

    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");
    expect(describeVisibility(sidebar(), PHONE_WIDTH_IN_PX)).toBe(
      `visible at ${PHONE_WIDTH_IN_PX}px`,
    );
    expect(describeVisibility(listCard(), PHONE_WIDTH_IN_PX)).toBe(
      `visible at ${PHONE_WIDTH_IN_PX}px`,
    );

    fireEvent.click(filtersToggle());

    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    expect(describeVisibility(sidebar(), PHONE_WIDTH_IN_PX)).not.toBe(
      `visible at ${PHONE_WIDTH_IN_PX}px`,
    );
  });

  test("from md up the sidebar always shows and the toggle is hidden, open or not", () => {
    renderViewer();

    for (const isOpen of [false, true]) {
      if (isOpen) {
        fireEvent.click(filtersToggle());
      }

      for (const width of [TABLET_WIDTH_IN_PX, LAPTOP_WIDTH_IN_PX]) {
        expect({
          isOpen,
          sidebar: describeVisibility(sidebar(), width),
        }).toEqual({ isOpen, sidebar: `visible at ${width}px` });
        expect({ isOpen, list: describeVisibility(listCard(), width) }).toEqual(
          {
            isOpen,
            list: `visible at ${width}px`,
          },
        );
        expect({
          isOpen,
          toggle: describeVisibility(filtersToggle(), width),
        }).not.toEqual({ isOpen, toggle: `visible at ${width}px` });
      }
    }
  });

  test("folding is CSS only, so the facets stay mounted while hidden", () => {
    renderViewer();

    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("CrowdStrike")).toBeInTheDocument();
    expect(sidebar()).toContainElement(screen.getByText("CrowdStrike"));
  });

  test("there is no toggle when there is no sidebar to show", () => {
    renderViewer({ facetConfigs: [] });
    expect(
      screen.queryByTestId(TELEMETRY_VIEWER_FILTERS_TOGGLE_TEST_ID),
    ).toBeNull();
    cleanup();

    renderViewer({ showFacetSidebar: false });
    expect(
      screen.queryByTestId(TELEMETRY_VIEWER_FILTERS_TOGGLE_TEST_ID),
    ).toBeNull();
    cleanup();

    // An override (e.g. the analytics view) hides the whole facets + list area.
    renderViewer({ mainContentOverride: <p>Analytics</p> });
    expect(
      screen.queryByTestId(TELEMETRY_VIEWER_FILTERS_TOGGLE_TEST_ID),
    ).toBeNull();
  });
});

describe("the toolbar below md", () => {
  test("the search keeps a 12rem basis, so it is not squeezed between the buttons", () => {
    renderViewer();

    const search: HTMLElement = screen.getByTestId(
      TELEMETRY_VIEWER_SEARCH_TEST_ID,
    );

    expect(search.parentElement).toHaveClass("flex", "flex-wrap");
    expect(search).toHaveClass("min-w-0", "flex-[1_1_12rem]", "md:flex-1");
    /*
     * A bare flex-1 is a zero basis: the wrapping row then never breaks, and
     * the search gets whatever the buttons leave, which on a phone is ~50px.
     */
    expect(classTokens(search)).not.toContain("flex-1");
  });

  test("the input can shrink with its box instead of painting over the buttons", () => {
    renderViewer();

    const input: HTMLElement = screen.getByPlaceholderText(
      "Search security events",
    );

    expect(input).toHaveClass("min-w-0", "flex-1");
    /*
     * Only below md. From md up a crowded toolbar (Exceptions at 768px) can
     * squeeze the box to a sliver, and an input shrunk to fit it would leave
     * nothing to click, so there it keeps its intrinsic minimum as before.
     */
    expect(input).toHaveClass("md:min-w-[auto]");
  });

  test("the toggle sits right after the search, so on a phone it shares the search's row", () => {
    renderViewer({
      toolbarLeadingActions: <button type="button">Saved views</button>,
    });

    const search: HTMLElement = screen.getByTestId(
      TELEMETRY_VIEWER_SEARCH_TEST_ID,
    );
    expect(search.nextElementSibling).toBe(filtersToggle());

    const toolbarButtons: Array<string> = Array.from(
      search.parentElement!.querySelectorAll(":scope > button"),
    ).map((button: Element): string => {
      return button.textContent || "";
    });

    // Ahead of the caller's leading actions, and the built-in buttons after.
    expect(toolbarButtons).toEqual([
      "Filters",
      "Saved views",
      "Paused",
      "Refresh",
    ]);
  });
});

describe("the histogram header below md", () => {
  test("wraps rather than running off the side of a phone", () => {
    renderViewer({
      histogramBuckets: [],
      histogramSeries: [{ key: "high", label: "High", color: "#ea580c" }],
      histogramTitle: "Security Event Volume",
      histogramHeaderActions: <span>0 events</span>,
    });

    const titleGroup: HTMLElement = screen.getByText(
      "Security Event Volume",
    ).parentElement!;
    const header: HTMLElement = titleGroup.parentElement!;
    const trailingGroup: HTMLElement =
      screen.getByText("0 events").parentElement!;

    expect(header).toHaveClass("flex", "flex-wrap", "justify-between");
    expect(titleGroup).toHaveClass("flex", "flex-wrap");
    expect(trailingGroup).toHaveClass("flex", "flex-wrap");

    // From md up it is the single row it always was.
    expect(header).toHaveClass("md:flex-nowrap", "md:gap-x-0");
    expect(titleGroup).toHaveClass("md:flex-nowrap");
    expect(trailingGroup).toHaveClass("md:flex-nowrap");
  });
});

describe("dark mode", () => {
  /*
   * Dark mode is Common/UI/Styles/Theme.css remapping light utility classes,
   * not dark: variants, and it has no rule for breakpoint-prefixed bg or text
   * colours. So every colour the new small-screen markup renders, in both
   * toggle states, must be a class that file remaps.
   */
  const THEME_CSS: string = fs
    .readFileSync(
      path.join(__dirname, "../../../../UI/Styles/Theme.css"),
      "utf8",
    )
    // Comments name classes too, and must not count as a remap.
    .replace(/\/\*[\s\S]*?\*\//g, "");

  /*
   * The selector list of every rule that only applies in dark mode. The
   * selector is the text before a rule's own "{" (a rule nested in @media
   * has the at-rule's "{" before it).
   */
  const DARK_SELECTORS: Array<string> = THEME_CSS.split("}")
    .map((rule: string): string => {
      const parts: Array<string> = rule.split("{");
      return parts.length >= 2 ? parts[parts.length - 2]! : "";
    })
    .filter((selector: string): boolean => {
      return selector.includes("html.dark");
    });

  const COLOR_TOKEN: RegExp =
    /^(?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|violet)-\d{2,3})(?:\/\d+)?$/;

  const isRemapped: (token: string) => boolean = (token: string): boolean => {
    /*
     * CSS escaping, as Theme.css writes the class: backslashes first, so the
     * ones added for ":" and "/" are not escaped a second time.
     */
    const escaped: string = token
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/\//g, "\\/");
    // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
    const asClass: RegExp = new RegExp(
      `\\.${escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`,
    );

    return DARK_SELECTORS.some((selector: string): boolean => {
      return selector.includes(`[class~="${token}"]`) || asClass.test(selector);
    });
  };

  function colorTokens(elements: Array<Element>): Array<string> {
    return elements.flatMap((element: Element): Array<string> => {
      return classTokens(element).filter((token: string): boolean => {
        return COLOR_TOKEN.test(token);
      });
    });
  }

  test("the guard tells a remapped class from one that is not", () => {
    expect(DARK_SELECTORS.length).toBeGreaterThan(0);
    expect(isRemapped("bg-white")).toBe(true);
    expect(isRemapped("border-gray-200")).toBe(true);
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    expect(isRemapped("bg-gray-50/50")).toBe(true);
    // Theme.css has no rule for a breakpoint-prefixed background.
    expect(isRemapped("md:bg-white")).toBe(false);
    // A made-up shade no stylesheet will ever remap.
    expect(isRemapped("bg-gray-55")).toBe(false);
  });

  test("the toggle, sidebar and list use only colours Theme.css remaps", () => {
    renderViewer();

    const closed: Array<string> = colorTokens([
      filtersToggle(),
      sidebar(),
      listCard(),
    ]);
    fireEvent.click(filtersToggle());
    const open: Array<string> = colorTokens([filtersToggle()]);

    // Both toggle states were read, so this is not vacuous.
    expect(closed).toEqual(expect.arrayContaining(["bg-white"]));
    expect(open).toEqual(expect.arrayContaining(["bg-indigo-50"]));

    const unmapped: Array<string> = [...closed, ...open].filter(
      (token: string): boolean => {
        return !isRemapped(token);
      },
    );
    expect(unmapped).toEqual([]);

    for (const element of [filtersToggle(), sidebar(), mainArea()]) {
      expect(element.getAttribute("class")).not.toContain("dark:");
    }
  });
});
