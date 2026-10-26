import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import type { SpyInstance } from "jest-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A row of a ModelTable whose rows open their records opens on a click
 * anywhere on it (model-table-ui): the way a list in Linear, GitHub or
 * Stripe does. Not a click on a link, a button or a box in it; Cmd, Ctrl or
 * Shift, or the middle button, open the record in a new tab; View stays the
 * row's button and the way in from the keyboard, and opens the same page.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Navigation from "../../../../UI/Utils/Navigation";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import { TABLE_CLICKABLE_ROW_CLASS_NAME } from "../../../../UI/Components/Table/TableLayout";

const CHECKOUT_ID: string = "60000000-0000-4000-8000-000000000001";
const BILLING_ID: string = "60000000-0000-4000-8000-000000000002";

type MakeMonitorFunction = (id: string, name: string) => Monitor;

const makeMonitor: MakeMonitorFunction = (
  id: string,
  name: string,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.name = name;
  return monitor;
};

const COLUMNS: Array<unknown> = [
  { field: { name: true }, title: "Name", type: FieldType.Text },
];

type TableOptions = {
  isViewable?: boolean | undefined;
  viewPageRoute?: Route | undefined;
  onViewPage?: ((item: Monitor) => Promise<Route | URL>) | undefined;
  onBeforeView?: ((item: Monitor) => Promise<Monitor>) | undefined;
  onViewComplete?: ((item: Monitor) => void) | undefined;
  isDeleteable?: boolean | undefined;
  viewButtonText?: string | undefined;
};

type NavigateCall = [Route | URL, { openInNewTab?: boolean } | undefined];

describe("a row opens its record", () => {
  let navigateSpy: SpyInstance<typeof Navigation.navigate>;

  const makeProps: (options: TableOptions) => BaseModelTableProps<Monitor> = (
    options: TableOptions,
  ): BaseModelTableProps<Monitor> => {
    const callbacks: BaseTableCallbacks<Monitor> = {
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      getModelFromJSON: (item: JSONObject): Monitor => {
        return item as unknown as Monitor;
      },
      getJSONFromModel: (item: Monitor): JSONObject => {
        return item as unknown as JSONObject;
      },
      addSlugToSelect: (select: unknown): unknown => {
        return select;
      },
      getList: async (data: {
        skip: number;
        limit: number;
      }): Promise<ListResult<Monitor>> => {
        return {
          data: [
            makeMonitor(CHECKOUT_ID, "Checkout API"),
            makeMonitor(BILLING_ID, "Billing Worker"),
          ],
          count: 2,
          skip: data.skip,
          limit: data.limit,
        };
      },
      toJSONArray: (): Array<JSONObject> => {
        return [];
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      showCreateEditModal: (): React.ReactElement => {
        return <div data-testid="create-edit-modal" />;
      },
    } as unknown as BaseTableCallbacks<Monitor>;

    return {
      modelType: Monitor,
      id: "monitors-open-table",
      name: "Monitors",
      singularName: "Monitor",
      pluralName: "Monitors",
      userPreferencesKey: "monitors-open-table",
      urlStateKey: "monitors-open-table",
      columns: COLUMNS,
      filters: [],
      cardProps: { title: "Monitors" },
      isCreateable: false,
      isEditable: false,
      isDeleteable: options.isDeleteable ?? false,
      isViewable: options.isViewable ?? true,
      viewPageRoute:
        "viewPageRoute" in options
          ? options.viewPageRoute
          : new Route("/dashboard/monitors"),
      onViewPage: options.onViewPage,
      onBeforeView: options.onBeforeView,
      onViewComplete: options.onViewComplete,
      viewButtonText: options.viewButtonText,
      callbacks: callbacks,
    } as unknown as BaseModelTableProps<Monitor>;
  };

  const renderTable: (options?: TableOptions) => void = (
    options?: TableOptions,
  ): void => {
    render(<BaseModelTable<Monitor> {...makeProps(options || {})} />);
  };

  type RowOfFunction = (name: string) => Promise<HTMLElement>;

  const rowOf: RowOfFunction = async (name: string): Promise<HTMLElement> => {
    const text: HTMLElement = await screen.findByText(name);
    return text.closest("tr") as HTMLElement;
  };

  type CallsFunction = () => Array<NavigateCall>;

  const calls: CallsFunction = (): Array<NavigateCall> => {
    return navigateSpy.mock.calls as unknown as Array<NavigateCall>;
  };

  beforeEach(() => {
    permissionsForTest = [Permission.ProjectAdmin];
    navigateSpy = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("a click on a row's value opens its record, as View does", async () => {
    const viewed: Array<string> = [];

    renderTable({
      onViewComplete: (item: Monitor): void => {
        viewed.push(item.name || "");
      },
    });

    fireEvent.click(await screen.findByText("Checkout API"));

    await waitFor(() => {
      expect(calls()).toHaveLength(1);
    });

    const [route, options] = calls()[0]!;

    expect(route.toString()).toBe(`/dashboard/monitors/${CHECKOUT_ID}`);
    expect(options).toEqual({ openInNewTab: false });
    expect(viewed).toEqual(["Checkout API"]);
  });

  test("the row takes the pointer's hand and says it opens a record", async () => {
    renderTable();

    const row: HTMLElement = await rowOf("Checkout API");

    expect(row).toHaveClass(TABLE_CLICKABLE_ROW_CLASS_NAME);
    expect(row).toHaveAttribute("data-row-opens-record", "true");
  });

  test.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }],
  ])(
    "%s held opens it in a new tab, and leaves this page as it is",
    async (_key: string, modifier: Record<string, boolean>) => {
      const viewed: Array<string> = [];

      renderTable({
        onViewComplete: (item: Monitor): void => {
          viewed.push(item.name || "");
        },
      });

      fireEvent.click(await screen.findByText("Billing Worker"), modifier);

      await waitFor(() => {
        expect(calls()).toHaveLength(1);
      });

      const [route, options] = calls()[0]!;

      expect(route.toString()).toBe(`/dashboard/monitors/${BILLING_ID}`);
      expect(options).toEqual({ openInNewTab: true });
      // Nothing on this page closes for a record opened elsewhere.
      expect(viewed).toEqual([]);
    },
  );

  test("the middle button opens it in a new tab", async () => {
    renderTable();

    const row: HTMLElement = await rowOf("Checkout API");

    fireEvent(
      within(row).getByText("Checkout API"),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );

    await waitFor(() => {
      expect(calls()).toHaveLength(1);
    });
    expect(calls()[0]![1]).toEqual({ openInNewTab: true });
  });

  test("the right button (a context menu) opens nothing", async () => {
    renderTable();

    const row: HTMLElement = await rowOf("Checkout API");

    fireEvent(
      within(row).getByText("Checkout API"),
      new MouseEvent("auxclick", { bubbles: true, button: 2 }),
    );

    // Give an async open the time it would need.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });
    expect(calls()).toHaveLength(0);
  });

  /*
   * "View" on every row, not "View Monitor": the row names its record and
   * the list its kind, and "View Scheduled Maintenance Template" took the
   * room of two columns on every row (ActionButtonSchema's
   * rowButtonTitle). The kind is still in the button's name.
   */
  test("View says View on the row, and is named by what it views", async () => {
    renderTable();

    const row: HTMLElement = await rowOf("Checkout API");
    const view: HTMLElement = within(row).getByRole("button", {
      name: "View Monitor",
    });

    expect(view).toHaveTextContent(/^View$/);
    expect(view).toHaveAttribute("aria-label", "View Monitor");
  });

  test("a page's own words for View are kept, on the row and in its name", async () => {
    renderTable({ viewButtonText: "View Timeline" });

    const row: HTMLElement = await rowOf("Checkout API");
    const view: HTMLElement = within(row).getByRole("button", {
      name: "View Timeline",
    });

    expect(view).toHaveTextContent(/^View Timeline$/);
    expect(view).not.toHaveAttribute("aria-label");
  });

  test("View still opens the record, once - its click is the button's, not the row's", async () => {
    renderTable();

    const row: HTMLElement = await rowOf("Checkout API");

    fireEvent.click(within(row).getByRole("button", { name: "View Monitor" }));

    await waitFor(() => {
      expect(calls()).toHaveLength(1);
    });

    // The View action navigates with no options of its own.
    expect(calls()[0]![0].toString()).toBe(
      `/dashboard/monitors/${CHECKOUT_ID}`,
    );
    expect(calls()[0]![1]).toBeUndefined();

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });
    expect(calls()).toHaveLength(1);
  });

  test("the row's ⋯ and the menu it opens are theirs, not the row's", async () => {
    renderTable({ isDeleteable: true });

    const row: HTMLElement = await rowOf("Checkout API");

    fireEvent.click(within(row).getByTestId("row-actions-more-button"));

    const menu: HTMLElement = await screen.findByRole("menu");
    // A click inside the menu, which is drawn in document.body.
    fireEvent.click(within(menu).getAllByRole("menuitem")[0]!);

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });
    expect(calls()).toHaveLength(0);
  });

  test("a table that does not open its rows: no hand, and a click does nothing", async () => {
    renderTable({ isViewable: false });

    const row: HTMLElement = await rowOf("Checkout API");

    expect(row).not.toHaveClass(TABLE_CLICKABLE_ROW_CLASS_NAME);
    expect(row).not.toHaveAttribute("data-row-opens-record");

    fireEvent.click(within(row).getByText("Checkout API"));

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });
    expect(calls()).toHaveLength(0);
  });

  test("a viewable table with nowhere to go (no route) does not pretend its rows open", async () => {
    renderTable({ viewPageRoute: undefined });

    const row: HTMLElement = await rowOf("Checkout API");

    expect(row).not.toHaveClass(TABLE_CLICKABLE_ROW_CLASS_NAME);
  });

  test("a page's own route for a record is the one the row opens", async () => {
    renderTable({
      viewPageRoute: undefined,
      onViewPage: async (item: Monitor): Promise<Route> => {
        return new Route(`/dashboard/monitors/${item._id}/overview`);
      },
    });

    fireEvent.click(await screen.findByText("Billing Worker"));

    await waitFor(() => {
      expect(calls()).toHaveLength(1);
    });
    expect(calls()[0]![0].toString()).toBe(
      `/dashboard/monitors/${BILLING_ID}/overview`,
    );
  });

  test("when the record cannot be opened, the reader is told why", async () => {
    renderTable({
      onBeforeView: async (): Promise<Monitor> => {
        throw new Error("This monitor was deleted.");
      },
    });

    fireEvent.click(await screen.findByText("Checkout API"));

    expect(await screen.findByText("This monitor was deleted.")).toBeVisible();
    expect(calls()).toHaveLength(0);
  });

  test("a value selected to copy it is not a request to leave", async () => {
    renderTable();

    const text: HTMLElement = await screen.findByText("Checkout API");
    const range: Range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.click(text);

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });
    expect(calls()).toHaveLength(0);
    window.getSelection()?.removeAllRanges();
  });
});
