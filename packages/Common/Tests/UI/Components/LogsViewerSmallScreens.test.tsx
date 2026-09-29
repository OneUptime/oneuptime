import { FacetData } from "../../../UI/Components/LogsViewer/types";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  TAILWIND_BREAKPOINTS_IN_PX,
  describeVisibility,
} from "../../ResponsiveVisibility";

/*
 * The logs explorer on a phone.
 *
 * LogsViewer renders its own facet sidebar rather than the shared
 * TelemetryViewer's, and it had the same bug that one had: a fixed 14rem card
 * beside the list at every width. At 390px that squeezed the list card to
 * ~120px. The toolbar row did not wrap either, so its two groups squeezed
 * each other, and the column picker hung a 24rem panel off its trigger's
 * right edge, wider than a 375px phone and past the left edge of a 390px one.
 *
 * Below md the sidebar now stacks above the list, folded behind a "Filters"
 * toggle, the toolbar groups wrap onto their own rows, and every popover in
 * the toolbar spans the row instead of hanging off its (now moved) trigger.
 * From md up every change is undone by an md: class, so the desktop layout is
 * the old one. jsdom has no stylesheet, so these tests
 * read the Tailwind classes, and ResponsiveVisibility resolves `display` per
 * width.
 *
 * The container loads services and log attributes on mount, so both API
 * surfaces are mocked out; nothing here depends on what they return beyond
 * their resolving.
 */

/*
 * Declared before jest.mock but dereferenced inside the factories: ts-jest
 * hoists the jest.mock calls above these initializers, so naming the mocks
 * directly in a factory would capture undefined.
 */
const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

getListMock.mockImplementation(() => {
  return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
});

postMock.mockImplementation(() => {
  return Promise.resolve({ data: {} });
});

// Imported after the mocks so the container picks them up.
import LogsViewer, {
  LOGS_VIEWER_LIST_TEST_ID,
  LOGS_VIEWER_MAIN_AREA_TEST_ID,
} from "../../../UI/Components/LogsViewer/LogsViewer";
import {
  LOGS_VIEWER_EXPORT_MENU_TEST_ID,
  LOGS_VIEWER_FILTERS_TOGGLE_TEST_ID,
  LOGS_VIEWER_TOOLBAR_TEST_ID,
} from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import { COLUMN_SELECTOR_PANEL_TEST_ID } from "../../../UI/Components/LogsViewer/components/ColumnSelector";
import { KEYBOARD_SHORTCUTS_HELP_TEST_ID } from "../../../UI/Components/LogsViewer/components/KeyboardShortcutsHelp";

const FACET_DATA: FacetData = {
  severityText: [
    { value: "Error", count: 3 },
    { value: "Information", count: 12 },
  ],
  "http.method": [{ value: "PATCH", count: 4 }],
};

interface RenderOptions {
  // No facet data at all, which is the other way a host has no sidebar.
  withoutFacetData?: boolean;
}

async function renderViewer(
  props: Partial<React.ComponentProps<typeof LogsViewer>> = {},
  options: RenderOptions = {},
): Promise<void> {
  render(
    <LogsViewer
      logs={[]}
      isLoading={false}
      filterData={{}}
      onFilterChanged={jest.fn()}
      showFilters={true}
      {...(options.withoutFacetData ? {} : { facetData: FACET_DATA })}
      showFacetSidebar={true}
      viewMode="list"
      onViewModeChange={jest.fn()}
      selectedColumns={["time", "severity", "body"]}
      onSelectedColumnsChange={jest.fn()}
      onShowDocumentation={jest.fn()}
      liveOptions={{ isLive: false, onToggle: jest.fn() }}
      {...props}
    />,
  );

  // The container renders a loader until its service lookup resolves.
  await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
}

function mainArea(): HTMLElement {
  return screen.getByTestId(LOGS_VIEWER_MAIN_AREA_TEST_ID);
}

function listCard(): HTMLElement {
  return screen.getByTestId(LOGS_VIEWER_LIST_TEST_ID);
}

function filtersToggle(): HTMLElement {
  return screen.getByTestId(LOGS_VIEWER_FILTERS_TOGGLE_TEST_ID);
}

function toolbar(): HTMLElement {
  return screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
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

function visibleAt(width: number): string {
  return `visible at ${width}px`;
}

afterEach(() => {
  cleanup();
});

describe("the facets + list area below md", () => {
  test("stacks the sidebar above the list below md, and puts them side by side from md up", async () => {
    await renderViewer();

    expect(mainArea()).toHaveClass("flex", "flex-col", "md:flex-row");
    // A bare flex-row would put the side-by-side layout back on phones.
    expect(classTokens(mainArea())).not.toContain("flex-row");

    // The sidebar comes first, so it stacks above the list rather than under it.
    const children: Array<Element> = Array.from(mainArea().children);
    expect(children).toEqual([sidebar(), listCard()]);
  });

  test("the stacked sidebar spans the width and is capped so it cannot bury the list", async () => {
    await renderViewer();

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

  test("on a phone the sidebar starts folded behind a Filters toggle, and the list is shown", async () => {
    await renderViewer();

    expect(filtersToggle()).toHaveTextContent("Filters");
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    expect(filtersToggle()).toHaveAttribute("aria-controls", sidebar().id);
    expect(sidebar().id).not.toBe("");

    expect(describeVisibility(filtersToggle(), PHONE_WIDTH_IN_PX)).toBe(
      visibleAt(PHONE_WIDTH_IN_PX),
    );
    expect(describeVisibility(sidebar(), PHONE_WIDTH_IN_PX)).not.toBe(
      visibleAt(PHONE_WIDTH_IN_PX),
    );
    expect(describeVisibility(listCard(), PHONE_WIDTH_IN_PX)).toBe(
      visibleAt(PHONE_WIDTH_IN_PX),
    );
  });

  test("the toggle opens the stacked sidebar on a phone and folds it again", async () => {
    await renderViewer();

    fireEvent.click(filtersToggle());

    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");
    expect(describeVisibility(sidebar(), PHONE_WIDTH_IN_PX)).toBe(
      visibleAt(PHONE_WIDTH_IN_PX),
    );
    expect(describeVisibility(listCard(), PHONE_WIDTH_IN_PX)).toBe(
      visibleAt(PHONE_WIDTH_IN_PX),
    );

    fireEvent.click(filtersToggle());

    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    expect(describeVisibility(sidebar(), PHONE_WIDTH_IN_PX)).not.toBe(
      visibleAt(PHONE_WIDTH_IN_PX),
    );
  });

  test("from md up the sidebar always shows and the toggle is hidden, open or not", async () => {
    await renderViewer();

    for (const isOpen of [false, true]) {
      if (isOpen) {
        fireEvent.click(filtersToggle());
      }

      for (const width of [TABLET_WIDTH_IN_PX, LAPTOP_WIDTH_IN_PX]) {
        expect({
          isOpen,
          sidebar: describeVisibility(sidebar(), width),
        }).toEqual({ isOpen, sidebar: visibleAt(width) });
        expect({ isOpen, list: describeVisibility(listCard(), width) }).toEqual(
          { isOpen, list: visibleAt(width) },
        );
        expect({
          isOpen,
          toggle: describeVisibility(filtersToggle(), width),
        }).not.toEqual({ isOpen, toggle: visibleAt(width) });
      }
    }
  });

  test("folding is CSS only, so the facets stay mounted while hidden", async () => {
    await renderViewer();

    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");
    expect(sidebar()).toContainElement(screen.getByText("PATCH"));
  });

  test("the toggle also works when the toolbar sits in the list card instead of above it", async () => {
    // Embedded viewers (a service's or a pod's logs tab) pass showFilters=false.
    await renderViewer({ showFilters: false });

    expect(listCard()).toContainElement(filtersToggle());
    expect(filtersToggle()).toHaveAttribute("aria-controls", sidebar().id);

    fireEvent.click(filtersToggle());

    expect(describeVisibility(sidebar(), PHONE_WIDTH_IN_PX)).toBe(
      visibleAt(PHONE_WIDTH_IN_PX),
    );
  });

  test("there is no toggle when there is no sidebar to show", async () => {
    await renderViewer({ showFacetSidebar: false });
    expect(screen.queryByTestId(LOGS_VIEWER_FILTERS_TOGGLE_TEST_ID)).toBeNull();
    cleanup();

    await renderViewer({}, { withoutFacetData: true });
    expect(screen.queryByTestId(LOGS_VIEWER_FILTERS_TOGGLE_TEST_ID)).toBeNull();
    cleanup();

    // The analytics view replaces the whole facets + list area.
    await renderViewer({ viewMode: "analytics" });
    expect(screen.queryByTestId(LOGS_VIEWER_MAIN_AREA_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(LOGS_VIEWER_FILTERS_TOGGLE_TEST_ID)).toBeNull();
  });
});

describe("the toolbar row below md", () => {
  test("wraps its two groups onto their own rows below md, and is one row from md up", async () => {
    await renderViewer();

    expect(toolbar()).toHaveClass(
      "flex",
      "flex-wrap",
      "justify-between",
      "md:flex-nowrap",
    );
    // A bare flex-nowrap is the regression: both groups on one phone row.
    expect(classTokens(toolbar())).not.toContain("flex-nowrap");

    const groups: Array<Element> = Array.from(toolbar().children);
    expect(groups).toHaveLength(2);

    const [leftGroup, rightGroup] = groups as [Element, Element];
    expect(leftGroup).toHaveClass("flex", "flex-wrap");
    expect(rightGroup).toHaveClass(
      "flex",
      "flex-wrap",
      "justify-start",
      "md:justify-end",
    );
    // From md up the right group hugs the right edge, as it always did.
    expect(classTokens(rightGroup)).not.toContain("justify-end");
  });

  test("the toggle is the first control, so on a phone it sits right under the search", async () => {
    await renderViewer();

    const leftGroup: Element = toolbar().firstElementChild!;
    expect(leftGroup.firstElementChild).toBe(filtersToggle());
  });
});

/*
 * The CSS `position` a class attribute resolves to at a width, the way the
 * cascade would: the largest matching breakpoint wins, unprefixed applies
 * everywhere, and no position utility at all is `static`.
 */
const POSITION_UTILITIES: Array<string> = [
  "static",
  "relative",
  "absolute",
  "fixed",
  "sticky",
];

function resolvePosition(element: Element, width: number): string {
  let winner: string = "static";
  let winningMinWidth: number = -1;

  for (const token of classTokens(element)) {
    const parts: Array<string> = token.split(":");
    const utility: string = parts[parts.length - 1]!;

    if (!POSITION_UTILITIES.includes(utility) || parts.length > 2) {
      continue;
    }

    const minWidth: number | undefined =
      parts.length === 1 ? 0 : TAILWIND_BREAKPOINTS_IN_PX[parts[0]!];

    if (minWidth === undefined || minWidth > width) {
      continue;
    }

    if (minWidth >= winningMinWidth) {
      winner = utility;
      winningMinWidth = minWidth;
    }
  }

  return winner;
}

// The element an absolutely positioned box is laid out against, at a width.
function containingBlockAt(element: Element, width: number): Element | null {
  let node: Element | null = element.parentElement;

  while (node) {
    if (resolvePosition(node, width) !== "static") {
      return node;
    }

    node = node.parentElement;
  }

  return null;
}

interface ToolbarPopover {
  name: string;
  props?: Partial<React.ComponentProps<typeof LogsViewer>>;
  trigger: () => HTMLElement;
  panel: () => HTMLElement;
  // The classes that put the panel back where it always was from md up.
  mdPlacement: Array<string>;
}

/*
 * Every popover in the toolbar row. Wrapping the row below md moves their
 * triggers, so a panel hung off its trigger at a fixed width could run off
 * either side of a phone: the column picker's 24rem one already did, and the
 * 18rem saved-views and shortcuts panels started to once their triggers moved
 * mid-row.
 */
const TOOLBAR_POPOVERS: Array<ToolbarPopover> = [
  {
    name: "column picker",
    trigger: (): HTMLElement => {
      return screen.getByRole("button", { name: /Columns/ });
    },
    panel: (): HTMLElement => {
      return screen.getByTestId(COLUMN_SELECTOR_PANEL_TEST_ID);
    },
    mdPlacement: ["right-0", "md:left-auto", "md:w-96"],
  },
  {
    name: "saved views",
    props: {
      savedViews: [{ id: "errors", name: "Errors only" }],
      onSavedViewSelect: jest.fn(),
      // The sidebar lists saved views too; keep only the toolbar's trigger.
      showFacetSidebar: false,
    },
    trigger: (): HTMLElement => {
      return screen.getByRole("button", { name: /^Saved Views/ });
    },
    panel: (): HTMLElement => {
      return screen.getByRole("dialog", { name: "Saved views" });
    },
    mdPlacement: ["left-0", "md:right-auto", "md:w-72"],
  },
  {
    name: "keyboard shortcuts",
    trigger: (): HTMLElement => {
      return screen.getByTitle("Keyboard shortcuts (?)");
    },
    panel: (): HTMLElement => {
      return screen.getByTestId(KEYBOARD_SHORTCUTS_HELP_TEST_ID);
    },
    mdPlacement: ["right-0", "md:left-auto", "md:top-full", "md:w-72"],
  },
  {
    name: "export menu",
    trigger: (): HTMLElement => {
      // Exact, so the open menu's "Export as CSV" item does not match too.
      return screen.getByRole("button", { name: "Export" });
    },
    panel: (): HTMLElement => {
      return screen.getByTestId(LOGS_VIEWER_EXPORT_MENU_TEST_ID);
    },
    mdPlacement: ["right-0", "md:left-auto", "md:w-40"],
  },
];

describe.each(TOOLBAR_POPOVERS)(
  "the $name below md",
  (popover: ToolbarPopover) => {
    async function openPopover(): Promise<HTMLElement> {
      await renderViewer(popover.props || {});
      fireEvent.click(popover.trigger());
      return popover.panel();
    }

    test("spans the toolbar on a phone, instead of hanging off its trigger", async () => {
      const panel: HTMLElement = await openPopover();

      expect(panel).toHaveClass("absolute", "left-0", "right-0");
      // A fixed width below md is the regression: 384px on a 390px screen.
      expect(
        classTokens(panel).filter((token: string): boolean => {
          return token.startsWith("w-");
        }),
      ).toEqual([]);

      expect(resolvePosition(panel, PHONE_WIDTH_IN_PX)).toBe("absolute");
      expect(containingBlockAt(panel, PHONE_WIDTH_IN_PX)).toBe(toolbar());
    });

    test("from md up it is the old panel, hung off its trigger", async () => {
      const panel: HTMLElement = await openPopover();

      expect(panel).toHaveClass(...popover.mdPlacement);

      for (const width of [TABLET_WIDTH_IN_PX, LAPTOP_WIDTH_IN_PX]) {
        expect({ width, block: containingBlockAt(panel, width) }).toEqual({
          width,
          block: popover.trigger().parentElement,
        });
      }
    });
  },
);

describe("dark mode", () => {
  /*
   * Dark mode is Common/UI/Styles/Theme.css remapping light utility classes,
   * not dark: variants, and it has no rule for breakpoint-prefixed bg or text
   * colours. So every colour the new small-screen markup renders, in both
   * toggle states, must be a class that file remaps.
   */
  const THEME_CSS: string = fs
    .readFileSync(path.join(__dirname, "../../../UI/Styles/Theme.css"), "utf8")
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
    // Theme.css has no rule for a breakpoint-prefixed background.
    expect(isRemapped("md:bg-white")).toBe(false);
    // A made-up shade no stylesheet will ever remap.
    expect(isRemapped("bg-gray-55")).toBe(false);
  });

  test("the toggle, sidebar, toolbar and column picker use only colours Theme.css remaps", async () => {
    await renderViewer();

    const closed: Array<string> = colorTokens([
      filtersToggle(),
      sidebar(),
      mainArea(),
      listCard(),
      toolbar(),
    ]);
    fireEvent.click(filtersToggle());
    const open: Array<string> = colorTokens([filtersToggle()]);

    fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
    const panel: HTMLElement = screen.getByTestId(
      COLUMN_SELECTOR_PANEL_TEST_ID,
    );
    const picker: Array<string> = colorTokens([panel]);

    // Both toggle states and the panel were read, so this is not vacuous.
    expect(closed).toEqual(expect.arrayContaining(["bg-white"]));
    expect(open).toEqual(expect.arrayContaining(["bg-indigo-50"]));
    expect(picker).toEqual(expect.arrayContaining(["bg-white"]));

    const unmapped: Array<string> = [...closed, ...open, ...picker].filter(
      (token: string): boolean => {
        return !isRemapped(token);
      },
    );
    expect(unmapped).toEqual([]);

    for (const element of [
      filtersToggle(),
      sidebar(),
      mainArea(),
      toolbar(),
      panel,
    ]) {
      expect(element.getAttribute("class")).not.toContain("dark:");
    }
  });
});
