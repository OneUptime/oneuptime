import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import Table from "../../../UI/Components/Table/Table";
import List from "../../../UI/Components/List/List";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * The row actions of the plain Table, on desktop rows and on the mobile cards
 * it switches to below 768px, and of the other row surface that shares them -
 * List cards. Each draws one button and a ⋯ menu instead of a strip of
 * buttons; each has to keep acting on its own row.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.setTimeout(30000);

interface Row {
  _id: string;
  name: string;
  isVerified?: boolean;
}

const ROWS: Array<Row> = [
  { _id: "1", name: "status.acme.com", isVerified: false },
  { _id: "2", name: "status.globex.com", isVerified: true },
];

type OnClick = ActionButtonSchema<Row>["onClick"];

interface RowActionMocks {
  onShowId: Mock<OnClick>;
  onVerify: Mock<OnClick>;
  onView: Mock<OnClick>;
  onDelete: Mock<OnClick>;
  actions: Array<ActionButtonSchema<Row>>;
}

/*
 * Shaped like the status-page domains table: Show ID, a Verify that only
 * unverified domains get, View and Delete.
 */
const makeRowActions: () => RowActionMocks = (): RowActionMocks => {
  const onShowId: Mock<OnClick> = jest.fn<OnClick>();
  const onVerify: Mock<OnClick> = jest.fn<OnClick>();
  const onView: Mock<OnClick> = jest.fn<OnClick>();
  const onDelete: Mock<OnClick> = jest.fn<OnClick>();

  return {
    onShowId,
    onVerify,
    onView,
    onDelete,
    actions: [
      {
        title: "Show ID",
        buttonStyleType: ButtonStyleType.OUTLINE,
        hideOnMobile: true,
        placement: ActionButtonPlacement.MoreMenu,
        onClick: onShowId,
      },
      {
        title: "Verify",
        buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
        isVisible: (row: Row) => {
          return !row.isVerified;
        },
        onClick: onVerify,
      },
      {
        title: "View Domain",
        buttonStyleType: ButtonStyleType.NORMAL,
        placement: ActionButtonPlacement.Primary,
        onClick: onView,
      },
      {
        title: "Delete",
        icon: IconProp.Trash,
        buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
        onClick: onDelete,
      },
    ],
  };
};

const setViewportWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

type RenderTableFunction = (options: {
  actions: Array<ActionButtonSchema<Row>>;
  columns?: Columns<Row>;
}) => RenderResult;

const renderTable: RenderTableFunction = (options: {
  actions: Array<ActionButtonSchema<Row>>;
  columns?: Columns<Row>;
}): RenderResult => {
  return render(
    <Table<Row>
      id="domains-table"
      data={ROWS}
      columns={
        options.columns || [
          { title: "Domain", type: FieldType.Text, key: "name" },
          { title: "Actions", type: FieldType.Actions, key: null },
        ]
      }
      actionButtons={options.actions}
      currentPageNumber={1}
      totalItemsCount={ROWS.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Domain"
      pluralLabel="Domains"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
    />,
  );
};

const buttonLabels: (container: HTMLElement) => Array<string> = (
  container: HTMLElement,
): Array<string> => {
  return within(container)
    .getAllByRole("button")
    .map((button: HTMLElement) => {
      return (
        button.getAttribute("aria-label") || (button.textContent || "").trim()
      );
    });
};

const openMenuIn: (rowActions: HTMLElement) => HTMLElement = (
  rowActions: HTMLElement,
): HTMLElement => {
  fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
};

const menuLabels: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
};

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

describe("Table row actions, desktop", () => {
  test("every row shows one button and a ⋯ menu instead of a strip of buttons", () => {
    const { actions } = makeRowActions();

    renderTable({ actions });

    const rowActions: Array<HTMLElement> = screen.getAllByTestId("row-actions");

    expect(rowActions).toHaveLength(2);
    expect(buttonLabels(rowActions[0]!)).toEqual([
      "View Domain",
      "More actions",
    ]);
    expect(buttonLabels(rowActions[1]!)).toEqual([
      "View Domain",
      "More actions",
    ]);
  });

  test("the row actions sit in the Actions cell of their own row", () => {
    const { actions } = makeRowActions();

    renderTable({ actions });

    const bodyRows: Array<HTMLElement> = screen
      .getAllByRole("row")
      .filter((row: HTMLElement) => {
        return row.closest("tbody") !== null;
      });

    expect(bodyRows).toHaveLength(2);
    expect(
      within(bodyRows[0]!).getByTestId("row-actions").closest("td"),
    ).toHaveStyle({ textAlign: "right" });
  });

  test("each row's menu lists only what applies to that row", () => {
    const { actions } = makeRowActions();

    renderTable({ actions });

    const rowActions: Array<HTMLElement> = screen.getAllByTestId("row-actions");

    expect(menuLabels(openMenuIn(rowActions[0]!))).toEqual([
      "Show ID",
      "Verify",
      "Delete",
    ]);

    fireEvent.click(
      within(rowActions[0]!).getByTestId("row-actions-more-button"),
    );

    expect(menuLabels(openMenuIn(rowActions[1]!))).toEqual([
      "Show ID",
      "Delete",
    ]);
  });

  test("a menu action runs for the row whose menu it came from", () => {
    const mocks: RowActionMocks = makeRowActions();

    renderTable({ actions: mocks.actions });

    const rowActions: Array<HTMLElement> = screen.getAllByTestId("row-actions");

    fireEvent.click(
      within(openMenuIn(rowActions[1]!)).getByRole("menuitem", {
        name: /Delete/,
      }),
    );

    expect(mocks.onDelete).toHaveBeenCalledTimes(1);
    expect(mocks.onDelete.mock.calls[0]?.[0]).toBe(ROWS[1]);
  });

  test("the row button runs for its own row", () => {
    const mocks: RowActionMocks = makeRowActions();

    renderTable({ actions: mocks.actions });

    fireEvent.click(
      within(screen.getAllByTestId("row-actions")[0]!).getByRole("button", {
        name: "View Domain",
      }),
    );

    expect(mocks.onView).toHaveBeenCalledTimes(1);
    expect(mocks.onView.mock.calls[0]?.[0]).toBe(ROWS[0]);
  });

  test("a custom element in the Actions column is kept, beside the row actions", () => {
    const { actions } = makeRowActions();

    renderTable({
      actions,
      columns: [
        { title: "Domain", type: FieldType.Text, key: "name" },
        {
          title: "Actions",
          type: FieldType.Actions,
          key: "_id",
          getElement: (row: Row) => {
            return <span data-testid="custom-action">custom {row._id}</span>;
          },
        },
      ],
    });

    const customActions: Array<HTMLElement> =
      screen.getAllByTestId("custom-action");

    expect(customActions).toHaveLength(2);
    expect(customActions[0]!.parentElement).toContainElement(
      screen.getAllByTestId("row-actions")[0]!,
    );
  });

  test("each ⋯ names its row when the table knows what its rows are", () => {
    const { actions } = makeRowActions();

    render(
      <Table<Row>
        id="named-domains-table"
        data={ROWS}
        columns={[
          { title: "Domain", type: FieldType.Text, key: "name" },
          { title: "Actions", type: FieldType.Actions, key: null },
        ]}
        actionButtons={actions}
        bulkItemToString={(row: Row) => {
          return `Domain: ${row.name}`;
        }}
        currentPageNumber={1}
        totalItemsCount={ROWS.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Domain"
        pluralLabel="Domains"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "More actions for Domain: status.acme.com",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "More actions for Domain: status.globex.com",
      }),
    ).toBeInTheDocument();
  });

  test("a table without actions draws no row actions at all", () => {
    renderTable({ actions: [] });

    expect(screen.queryByTestId("row-actions")).toBeNull();
    expect(screen.queryByTestId("row-actions-more-button")).toBeNull();
  });
});

describe("Table row actions, mobile cards", () => {
  test("a card shows the same one button and ⋯ menu, without mobile-hidden actions", () => {
    setViewportWidth(500);

    const { actions } = makeRowActions();

    renderTable({ actions });

    const rowActions: Array<HTMLElement> = screen.getAllByTestId("row-actions");

    expect(rowActions).toHaveLength(2);
    expect(document.querySelector("table")).toBeNull();
    expect(buttonLabels(rowActions[0]!)).toEqual([
      "View Domain",
      "More actions",
    ]);
    // Show ID is hideOnMobile, so the first card's menu is Verify and Delete.
    expect(menuLabels(openMenuIn(rowActions[0]!))).toEqual([
      "Verify",
      "Delete",
    ]);
  });

  test("a card whose only other action is mobile-hidden has no ⋯ at all", () => {
    setViewportWidth(500);

    const { actions } = makeRowActions();

    renderTable({
      actions: actions.filter((action: ActionButtonSchema<Row>) => {
        return action.title !== "Delete" && action.title !== "Verify";
      }),
    });

    for (const rowActions of screen.getAllByTestId("row-actions")) {
      expect(buttonLabels(rowActions)).toEqual(["View Domain"]);
    }
  });

  test("a card left-aligns its actions", () => {
    setViewportWidth(500);

    const { actions } = makeRowActions();

    renderTable({ actions });

    expect(screen.getAllByTestId("row-actions")[0]).toHaveClass(
      "justify-start",
    );
  });
});

describe("List cards", () => {
  test("a list card shows one button and a ⋯ menu with the rest", () => {
    const mocks: RowActionMocks = makeRowActions();

    render(
      <List<Row>
        id="domains-list"
        data={ROWS}
        fields={[{ title: "Domain", key: "name", fieldType: FieldType.Text }]}
        actionButtons={mocks.actions}
        onNavigateToPage={() => {}}
        currentPageNumber={1}
        totalItemsCount={ROWS.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Domain"
        pluralLabel="Domains"
      />,
    );

    const rowActions: Array<HTMLElement> = screen.getAllByTestId("row-actions");

    expect(rowActions).toHaveLength(2);
    expect(buttonLabels(rowActions[1]!)).toEqual([
      "View Domain",
      "More actions",
    ]);

    fireEvent.click(
      within(openMenuIn(rowActions[1]!)).getByRole("menuitem", {
        name: "Show ID",
      }),
    );

    expect(mocks.onShowId).toHaveBeenCalledTimes(1);
    expect(mocks.onShowId.mock.calls[0]?.[0]).toBe(ROWS[1]);
  });
});

/*
 * The ⋯ on every one of these surfaces is a bare icon, like the one in a card
 * header - no border, fill or shadow boxing it in beside the row's button.
 * RowActionsTrigger.test.tsx covers the trigger in detail; this checks that
 * each surface really draws that trigger and not one of its own.
 */
const expectBareMoreTrigger: (rowActions: HTMLElement) => void = (
  rowActions: HTMLElement,
): void => {
  const trigger: HTMLElement = within(rowActions).getByTestId(
    "row-actions-more-button",
  );
  const rowButton: HTMLElement = within(rowActions).getByRole("button", {
    name: "View Domain",
  });

  expect(trigger).not.toHaveClass("border-gray-300");
  expect(trigger).not.toHaveClass("bg-white");
  expect(trigger).not.toHaveClass("shadow-sm");
  expect(trigger).toHaveClass("border-transparent");
  expect(trigger).toHaveClass("bg-transparent");
  expect(trigger).toHaveClass("hover:bg-gray-100");
  expect(trigger).toHaveClass("focus-visible:ring-2");

  // The row's own button is still a bordered button.
  expect(rowButton).toHaveClass("border-gray-300");
};

describe("the ⋯ on every row surface has no border", () => {
  test("on every desktop table row", () => {
    const { actions } = makeRowActions();

    renderTable({ actions });

    const rowActions: Array<HTMLElement> = screen.getAllByTestId("row-actions");

    expect(rowActions).toHaveLength(2);
    rowActions.forEach(expectBareMoreTrigger);
  });

  test("while a row's menu is open", () => {
    const { actions } = makeRowActions();

    renderTable({ actions });

    const rowActions: HTMLElement = screen.getAllByTestId("row-actions")[0]!;

    openMenuIn(rowActions);

    expect(
      within(rowActions).getByTestId("row-actions-more-button"),
    ).toHaveAttribute("aria-expanded", "true");
    expectBareMoreTrigger(rowActions);
  });

  test("on every mobile card", () => {
    setViewportWidth(500);

    const { actions } = makeRowActions();

    renderTable({ actions });

    const rowActions: Array<HTMLElement> = screen.getAllByTestId("row-actions");

    expect(document.querySelector("table")).toBeNull();
    expect(rowActions).toHaveLength(2);
    rowActions.forEach(expectBareMoreTrigger);
  });

  test("on every list card", () => {
    const { actions } = makeRowActions();

    render(
      <List<Row>
        id="domains-list"
        data={ROWS}
        fields={[{ title: "Domain", key: "name", fieldType: FieldType.Text }]}
        actionButtons={actions}
        onNavigateToPage={() => {}}
        currentPageNumber={1}
        totalItemsCount={ROWS.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Domain"
        pluralLabel="Domains"
      />,
    );

    const rowActions: Array<HTMLElement> = screen.getAllByTestId("row-actions");

    expect(rowActions).toHaveLength(2);
    rowActions.forEach(expectBareMoreTrigger);
  });
});
