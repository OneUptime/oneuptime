import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import ObjectID from "../../../Types/ObjectID";
import {
  UserFlowLoop,
  UserFlowPageStats,
  UserFlowPath,
} from "../../../Utils/Rum/UserFlow";
import UserFlowTables, {
  ComponentProps as UserFlowTablesProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowTables";

/*
 * The Pages tab of the User Flows tables used to end every row with two text
 * buttons, "Paths before" and "Paths after". It now ends like every other
 * table row: one button - "Paths after", because forward is what a click on a
 * page means everywhere else on the screen - and a ⋯ menu holding "Paths
 * before".
 *
 * These tests drive it the way a person does - look at a row, press its
 * button, open its ⋯, pick the item - and check that each row still re-anchors
 * the map on its OWN page, in the right direction, whatever order the table
 * is sorted in. The Top paths and Back and forth tabs have a single control
 * per row and are meant to stay that way, with no ⋯ of their own.
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

jest.setTimeout(60000);

type OnAnchor = UserFlowTablesProps["onAnchor"];

const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000002");

type MakePageFunction = (
  page: string,
  sessions: number,
  exitRate: number,
) => UserFlowPageStats;

const makePage: MakePageFunction = (
  page: string,
  sessions: number,
  exitRate: number,
): UserFlowPageStats => {
  return {
    page: page,
    sessions: sessions,
    views: sessions,
    entries: 0,
    exits: Math.round(sessions * exitRate),
    bounces: 0,
    exitRate: exitRate,
    errorSessions: 0,
    frustrationSessions: 0,
    next: [],
    previous: [],
    sampleSessionIds: [],
  };
};

/*
 * Handed over out of order on purpose. By Sessions (the default sort) the
 * table reads /home, /cart, /checkout; by Exit rate it reads the other way
 * round - so a re-sort moves every page to a different row.
 */
const PAGES: Array<UserFlowPageStats> = [
  makePage("/checkout", 3, 1),
  makePage("/home", 10, 0.2),
  makePage("/cart", 6, 0.5),
];

const PATHS: Array<UserFlowPath> = [
  {
    pages: ["/home", "/cart", "/checkout"],
    isTruncated: false,
    sessions: 3,
    share: 0.3,
    avgDurationMs: 60_000,
    errorSessions: 0,
    frustrationSessions: 0,
    sampleSessionIds: ["s1"],
  },
  {
    pages: ["/home"],
    isTruncated: false,
    sessions: 2,
    share: 0.2,
    avgDurationMs: 10_000,
    errorSessions: 0,
    frustrationSessions: 0,
    sampleSessionIds: ["s2"],
  },
];

const LOOPS: Array<UserFlowLoop> = [
  {
    pageA: "/home",
    pageB: "/cart",
    sessions: 1,
    share: 0.1,
    sampleSessionIds: ["s3"],
  },
];

type TablesElementFunction = (
  onAnchor: OnAnchor,
  pages?: Array<UserFlowPageStats>,
) => React.ReactElement;

const tablesElement: TablesElementFunction = (
  onAnchor: OnAnchor,
  pages?: Array<UserFlowPageStats>,
): React.ReactElement => {
  return (
    <MemoryRouter>
      <UserFlowTables
        paths={PATHS}
        pages={pages || PAGES}
        loops={LOOPS}
        rumApplicationId={APP_ID}
        onAnchor={onAnchor}
      />
    </MemoryRouter>
  );
};

type RenderTablesFunction = (
  onAnchor: OnAnchor,
  pages?: Array<UserFlowPageStats>,
) => RenderResult;

const renderTables: RenderTablesFunction = (
  onAnchor: OnAnchor,
  pages?: Array<UserFlowPageStats>,
): RenderResult => {
  return render(tablesElement(onAnchor, pages));
};

type OpenTabFunction = (id: "paths" | "pages" | "loops") => void;

const openTab: OpenTabFunction = (id: "paths" | "pages" | "loops"): void => {
  fireEvent.click(screen.getByTestId(`user-flow-tab-${id}`));
};

const pageRows: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.getAllByTestId("user-flow-page-row");
};

const pageOrder: () => Array<string> = (): Array<string> => {
  return pageRows().map((row: HTMLElement): string => {
    return row.getAttribute("data-page") || "";
  });
};

const pageRow: (page: string) => HTMLElement = (page: string): HTMLElement => {
  const row: HTMLElement | undefined = pageRows().find(
    (candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-page") === page;
    },
  );

  if (!row) {
    throw new Error(`No Pages row for ${page}.`);
  }

  return row;
};

const pathsAfterButton: (row: HTMLElement) => HTMLElement = (
  row: HTMLElement,
): HTMLElement => {
  return within(row).getByRole("button", { name: "Paths after" });
};

const moreButton: (row: HTMLElement) => HTMLElement = (
  row: HTMLElement,
): HTMLElement => {
  return within(row).getByTestId("row-actions-more-button");
};

const openMenuOf: (row: HTMLElement) => HTMLElement = (
  row: HTMLElement,
): HTMLElement => {
  fireEvent.click(moreButton(row));

  return screen.getByRole("menu");
};

const menuItemLabels: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
};

const choosePathsBefore: (row: HTMLElement) => void = (
  row: HTMLElement,
): void => {
  fireEvent.click(
    within(openMenuOf(row)).getByRole("menuitem", { name: "Paths before" }),
  );
};

afterEach(() => {
  cleanup();
});

describe("User Flows Pages rows: one button and a ⋯ menu", () => {
  test("every row shows Paths after as its one button, with the ⋯ beside it and Paths before out of sight", () => {
    renderTables(jest.fn<OnAnchor>());
    openTab("pages");

    expect(pageOrder()).toEqual(["/home", "/cart", "/checkout"]);

    for (const row of pageRows()) {
      const cells: Array<HTMLTableCellElement> = Array.from(
        row.querySelectorAll("td"),
      );
      const actions: HTMLElement = within(row).getByTestId("row-actions");
      const buttons: Array<HTMLElement> =
        within(actions).getAllByRole("button");

      // Still the last column, under its blank header.
      expect(cells[cells.length - 1]).toContainElement(actions);
      expect(cells).toHaveLength(
        screen.getByTestId("user-flow-pages-table").querySelectorAll("thead th")
          .length,
      );

      // The row's button first, then the ⋯ - and nothing else.
      expect(buttons).toHaveLength(2);
      expect(buttons[0]).toBe(pathsAfterButton(row));
      expect(buttons[0]).toHaveTextContent(/^Paths after$/);
      expect(buttons[0]).toBeEnabled();
      expect(buttons[1]).toBe(moreButton(row));
      expect(buttons[1]).toHaveAttribute("aria-label", "More actions");
      expect(buttons[1]).toHaveAttribute("aria-haspopup", "menu");
      expect(buttons[1]).toHaveAttribute("aria-expanded", "false");

      // Besides those two, the row keeps only its page chip.
      expect(within(row).getAllByRole("button")).toHaveLength(3);
      expect(within(row).queryByText("Paths before")).toBeNull();
    }

    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("a row's ⋯ menu holds Paths before and nothing else, drawn outside the table", () => {
    renderTables(jest.fn<OnAnchor>());
    openTab("pages");

    const menu: HTMLElement = openMenuOf(pageRow("/cart"));

    expect(menuItemLabels(menu)).toEqual(["Paths before"]);

    const item: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Paths before",
    });

    // Neither direction is destructive, so neither is drawn in red.
    expect(item).not.toHaveClass("text-red-600");
    expect(item).not.toHaveAttribute("aria-disabled", "true");

    /*
     * The table sits in an overflow-x-auto scroller that would clip a menu
     * opened under its last rows, so the menu is portalled to the body.
     */
    expect(screen.getByTestId("user-flow-pages-table")).not.toContainElement(
      menu,
    );
    expect(menu.parentElement).toBe(document.body);

    // The menu belongs to the row that was clicked, and only that row.
    expect(moreButton(pageRow("/cart"))).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(moreButton(pageRow("/cart"))).toHaveAttribute(
      "aria-controls",
      menu.id,
    );
    expect(moreButton(pageRow("/home"))).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  test("Paths after anchors the map forward on the page of its own row", () => {
    const onAnchor: Mock<OnAnchor> = jest.fn<OnAnchor>();

    renderTables(onAnchor);
    openTab("pages");

    fireEvent.click(pathsAfterButton(pageRow("/cart")));

    expect(onAnchor).toHaveBeenCalledTimes(1);
    expect(onAnchor).toHaveBeenCalledWith("/cart", "forward");
  });

  test("Paths before, picked from a row's ⋯ menu, anchors the map backward on that row's page and closes the menu", () => {
    const onAnchor: Mock<OnAnchor> = jest.fn<OnAnchor>();

    renderTables(onAnchor);
    openTab("pages");

    choosePathsBefore(pageRow("/checkout"));

    expect(onAnchor).toHaveBeenCalledTimes(1);
    expect(onAnchor).toHaveBeenCalledWith("/checkout", "backward");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(moreButton(pageRow("/checkout"))).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("opening the ⋯ and closing it again anchors nothing", () => {
    const onAnchor: Mock<OnAnchor> = jest.fn<OnAnchor>();

    renderTables(onAnchor);
    openTab("pages");

    const row: HTMLElement = pageRow("/home");

    openMenuOf(row);
    fireEvent.click(moreButton(row));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onAnchor).not.toHaveBeenCalled();
  });

  test("every row's actions act on its own page, in both directions", () => {
    const onAnchor: Mock<OnAnchor> = jest.fn<OnAnchor>();

    renderTables(onAnchor);
    openTab("pages");

    for (const page of pageOrder()) {
      fireEvent.click(pathsAfterButton(pageRow(page)));
      choosePathsBefore(pageRow(page));
    }

    expect(onAnchor.mock.calls).toEqual([
      ["/home", "forward"],
      ["/home", "backward"],
      ["/cart", "forward"],
      ["/cart", "backward"],
      ["/checkout", "forward"],
      ["/checkout", "backward"],
    ]);
  });

  test("after a re-sort the actions follow their page, not the position of the row", () => {
    const onAnchor: Mock<OnAnchor> = jest.fn<OnAnchor>();

    renderTables(onAnchor);
    openTab("pages");

    const header: HTMLElement = screen
      .getByTestId("user-flow-pages-table")
      .querySelector("thead") as HTMLElement;

    fireEvent.click(within(header).getByRole("button", { name: "Exit rate" }));

    expect(pageOrder()).toEqual(["/checkout", "/cart", "/home"]);

    const [firstRow, , lastRow] = pageRows();

    fireEvent.click(pathsAfterButton(firstRow!));
    choosePathsBefore(lastRow!);

    expect(onAnchor.mock.calls).toEqual([
      ["/checkout", "forward"],
      ["/home", "backward"],
    ]);
  });

  /*
   * Re-anchoring re-renders the whole page around the table. An action that
   * never said it had finished would come back from that render as a disabled
   * spinner, and the row could not be asked again.
   */
  test("the row's button is ready again once the map has re-anchored", () => {
    const onAnchor: Mock<OnAnchor> = jest.fn<OnAnchor>();
    const { rerender }: RenderResult = renderTables(onAnchor);

    openTab("pages");

    fireEvent.click(pathsAfterButton(pageRow("/home")));
    rerender(tablesElement(onAnchor));

    const button: HTMLElement = pathsAfterButton(pageRow("/home"));

    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-disabled", "false");

    fireEvent.click(button);
    choosePathsBefore(pageRow("/home"));
    rerender(tablesElement(onAnchor));
    fireEvent.click(pathsAfterButton(pageRow("/home")));

    expect(onAnchor.mock.calls).toEqual([
      ["/home", "forward"],
      ["/home", "forward"],
      ["/home", "backward"],
      ["/home", "forward"],
    ]);
  });

  test("the page chip still anchors forward, the same way the row's button does", () => {
    const onAnchor: Mock<OnAnchor> = jest.fn<OnAnchor>();

    renderTables(onAnchor);
    openTab("pages");

    fireEvent.click(
      within(pageRow("/cart")).getByRole("button", { name: "/cart" }),
    );
    fireEvent.click(pathsAfterButton(pageRow("/cart")));

    expect(onAnchor.mock.calls).toEqual([
      ["/cart", "forward"],
      ["/cart", "forward"],
    ]);
  });

  test("with no pages there are no rows and no actions", () => {
    renderTables(jest.fn<OnAnchor>(), []);
    openTab("pages");

    expect(screen.queryAllByTestId("user-flow-page-row")).toHaveLength(0);
    expect(screen.queryByTestId("row-actions")).toBeNull();
  });
});

describe("the other User Flows tabs keep their one control per row", () => {
  test("Top paths rows carry only their Watch link, with no ⋯", () => {
    renderTables(jest.fn<OnAnchor>());

    const rows: Array<HTMLElement> =
      screen.getAllByTestId("user-flow-path-row");

    expect(rows).toHaveLength(PATHS.length);

    for (const row of rows) {
      expect(within(row).queryByTestId("row-actions")).toBeNull();
      expect(within(row).queryByTestId("row-actions-more-button")).toBeNull();

      const links: Array<HTMLElement> = within(row).getAllByRole("link");

      expect(links).toHaveLength(1);
      expect(links[0]).toHaveTextContent(/^Watch$/);
    }
  });

  test("Back and forth rows carry only their Watch link, with no ⋯", () => {
    renderTables(jest.fn<OnAnchor>());
    openTab("loops");

    const rows: Array<HTMLElement> =
      screen.getAllByTestId("user-flow-loop-row");

    expect(rows).toHaveLength(LOOPS.length);

    for (const row of rows) {
      expect(within(row).queryByTestId("row-actions")).toBeNull();
      expect(within(row).queryByTestId("row-actions-more-button")).toBeNull();

      const links: Array<HTMLElement> = within(row).getAllByRole("link");

      expect(links).toHaveLength(1);
      expect(links[0]).toHaveTextContent(/^Watch$/);
    }
  });
});
