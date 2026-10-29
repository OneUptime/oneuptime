import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A real BaseModelTable over incidents keeps itself current: when the
 * server announces that an incident was created, changed or deleted, the
 * table reads its page again - quietly, keeping its rows on screen while it
 * reads and when the read fails - unless the reader is in the middle of
 * something: rows ticked for a bulk action, or a dialog open. A table of a
 * kind the server does not announce, a table told to stay as loaded, and a
 * page with no live connection of its own listen to nothing.
 */

// A real BaseModelTable is a lot of tree; see BaseModelTableAttributeColumns.
configure({ asyncUtilTimeout: 15000 });

interface Subscription {
  modelName: string;
  eventType: string;
  tenantId: string;
  onEvent: (modelId: unknown) => void;
  isStopped: boolean;
}

const subscriptions: Array<Subscription> = [];
let isConnectionStarted: boolean = true;

jest.mock("../../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      isStarted: (): boolean => {
        return isConnectionStarted;
      },
      listenToModelEvent: (
        listen: {
          modelType: { new (): { tableName: string } };
          eventType: string;
          tenantId: { toString: () => string };
        },
        onEvent: (modelId: unknown) => void,
      ): (() => void) => {
        const subscription: Subscription = {
          modelName: new listen.modelType().tableName,
          eventType: listen.eventType,
          tenantId: listen.tenantId.toString(),
          onEvent: onEvent,
          isStopped: false,
        };
        subscriptions.push(subscription);
        return (): void => {
          subscription.isStopped = true;
        };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
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
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
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
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import ProjectUtil from "../../../../UI/Utils/Project";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../../Types/ObjectID";
import IconProp from "../../../../Types/Icon/IconProp";
import { JSONObject } from "../../../../Types/JSON";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

type Row = { _id: string; title: string };

const CHECKOUT: Row = {
  _id: "20000000-0000-4000-8000-000000000101",
  title: "Checkout API is returning 502 errors",
};
const STOREFRONT: Row = {
  _id: "20000000-0000-4000-8000-000000000102",
  title: "Storefront slow for EU visitors",
};
const LOGIN: Row = {
  _id: "20000000-0000-4000-8000-000000000103",
  title: "Login page down",
};

// What the server holds now: a test changes it, then announces the change.
let serverRows: Array<Row> = [];
let listCalls: number = 0;
let failNextRead: boolean = false;
let holdNextRead: { resolve: () => void } | null = null;
let isNextReadHeld: boolean = false;

const active: () => Array<Subscription> = (): Array<Subscription> => {
  return subscriptions.filter((subscription: Subscription): boolean => {
    return !subscription.isStopped;
  });
};

const announce: (eventType: string) => void = (eventType: string): void => {
  act((): void => {
    for (const subscription of active()) {
      if (subscription.eventType === eventType) {
        subscription.onEvent(LOGIN._id);
      }
    }
  });
};

type TableOptions = {
  modelType?: { new (): BaseModel } | undefined;
  isLive?: boolean | undefined;
  // The reader's own narrowing: the server answers with the login incident.
  isNarrowedToLogin?: boolean | undefined;
};

const makeProps: (options?: TableOptions) => BaseModelTableProps<Incident> = (
  options?: TableOptions,
): BaseModelTableProps<Incident> => {
  const callbacks: BaseTableCallbacks<Incident> = {
    deleteItem: async () => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject) => {
      return item as unknown as Incident;
    },
    getJSONFromModel: (item: Incident) => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown) => {
      return select;
    },
    getList: async (data: {
      limit: number;
      skip: number;
      query: JSONObject;
    }): Promise<ListResult<Incident>> => {
      listCalls += 1;

      const isNarrowed: boolean = Boolean(data.query && data.query["title"]);

      if (isNextReadHeld) {
        isNextReadHeld = false;
        await new Promise<void>((resolve: () => void) => {
          holdNextRead = { resolve };
        });
      }

      if (failNextRead) {
        failNextRead = false;
        throw new Error("The server could not be reached");
      }

      const rows: Array<Row> = isNarrowed ? [LOGIN] : serverRows;

      return {
        data: rows.map((row: Row) => {
          return { ...row };
        }) as unknown as Array<Incident>,
        count: rows.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    toJSONArray: () => {
      return [];
    },
    updateById: async () => {
      return undefined;
    },
    showCreateEditModal: () => {
      return <></>;
    },
  } as unknown as BaseTableCallbacks<Incident>;

  return {
    modelType: options?.modelType || Incident,
    id: "incidents-live-table",
    name: "Incidents",
    singularName: "Incident",
    pluralName: "Incidents",
    userPreferencesKey: "incidents-live-table",
    urlStateKey: "incidents-live-table",
    // A monitor is called by its name, an incident by its title.
    columns:
      options?.modelType === (Monitor as unknown as { new (): BaseModel })
        ? [{ field: { name: true }, title: "Name", type: FieldType.Text }]
        : [{ field: { title: true }, title: "Title", type: FieldType.Text }],
    filters: [],
    isDeleteable: false,
    isCreateable: false,
    isViewable: false,
    isEditable: false,
    callbacks: callbacks,
    bulkActions: {
      buttons: [
        {
          title: "Acknowledge",
          icon: IconProp.Check,
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: async (): Promise<void> => {
            return Promise.resolve();
          },
        },
      ],
    },
    ...(options?.isLive !== undefined ? { isLive: options.isLive } : {}),
    ...(options?.isNarrowedToLogin ? { query: { title: "Login" } } : {}),
  } as unknown as BaseModelTableProps<Incident>;
};

const renderTable: (options?: TableOptions) => Promise<void> = async (
  options?: TableOptions,
): Promise<void> => {
  render(<BaseModelTable<Incident> {...makeProps(options)} />);
  await screen.findByText(CHECKOUT.title);
};

beforeEach(() => {
  subscriptions.length = 0;
  isConnectionStarted = true;
  serverRows = [CHECKOUT, STOREFRONT];
  listCalls = 0;
  failNextRead = false;
  holdNextRead = null;
  isNextReadHeld = false;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  jest.restoreAllMocks();
});

describe("an incidents list keeps itself current", () => {
  test("it listens for the project's created, changed and deleted incidents", async () => {
    await renderTable();

    expect(
      active().map((subscription: Subscription): string => {
        return `${subscription.modelName} ${subscription.eventType} ${subscription.tenantId}`;
      }),
    ).toEqual([
      `Incident Create ${PROJECT_ID}`,
      `Incident Update ${PROJECT_ID}`,
      `Incident Delete ${PROJECT_ID}`,
    ]);
  });

  test("a new incident shows up without Refresh", async () => {
    await renderTable();
    const readsBefore: number = listCalls;

    serverRows = [LOGIN, CHECKOUT, STOREFRONT];
    announce("Create");

    expect(await screen.findByText(LOGIN.title)).toBeInTheDocument();
    expect(listCalls).toBe(readsBefore + 1);
  });

  test("a deleted incident leaves the list", async () => {
    await renderTable();

    serverRows = [CHECKOUT];
    announce("Delete");

    await waitFor(() => {
      expect(screen.queryByText(STOREFRONT.title)).not.toBeInTheDocument();
    });
    expect(screen.getByText(CHECKOUT.title)).toBeInTheDocument();
  });

  test("the rows stay on screen while the page is read again", async () => {
    await renderTable();

    isNextReadHeld = true;
    serverRows = [LOGIN, CHECKOUT, STOREFRONT];
    announce("Create");

    await waitFor(() => {
      expect(holdNextRead).not.toBeNull();
    });

    // Mid-read: the rows that were there are still there, and nothing loads.
    expect(screen.getByText(CHECKOUT.title)).toBeInTheDocument();
    expect(screen.getByText(STOREFRONT.title)).toBeInTheDocument();
    expect(document.querySelector('[data-testid="bar-loader"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="table-skeleton-loader"]'),
    ).toBeNull();
    // Not dimmed, and still answering clicks, as a read someone asked for is.
    expect(screen.getByTestId("table-content")).not.toHaveClass("opacity-60");
    expect(screen.getByTestId("table-content")).not.toHaveClass(
      "pointer-events-none",
    );

    await act(async () => {
      holdNextRead!.resolve();
    });

    expect(await screen.findByText(LOGIN.title)).toBeInTheDocument();
  });

  test("a read the list made itself never covers a read the reader asked for after it", async () => {
    const view: ReturnType<typeof render> = render(
      <BaseModelTable<Incident> {...makeProps()} />,
    );
    await screen.findByText(CHECKOUT.title);

    isNextReadHeld = true;
    announce("Update");

    await waitFor(() => {
      expect(holdNextRead).not.toBeNull();
    });
    const liveRead: { resolve: () => void } = holdNextRead!;

    // The reader narrows the list while the live read is still out.
    view.rerender(
      <BaseModelTable<Incident> {...makeProps({ isNarrowedToLogin: true })} />,
    );
    expect(await screen.findByText(LOGIN.title)).toBeInTheDocument();

    // The live read answers last, with the rows of the list as it was.
    await act(async () => {
      liveRead.resolve();
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 100);
      });
    });

    expect(screen.getByText(LOGIN.title)).toBeInTheDocument();
    expect(screen.queryByText(CHECKOUT.title)).not.toBeInTheDocument();
    expect(screen.queryByText(STOREFRONT.title)).not.toBeInTheDocument();
  });

  test("a read that fails keeps the rows and puts no error where they were", async () => {
    await renderTable();

    failNextRead = true;
    announce("Update");

    await waitFor(() => {
      expect(listCalls).toBeGreaterThanOrEqual(2);
    });

    // Let the failed read finish: whatever it would draw, it has drawn.
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 100);
      });
    });

    expect(screen.queryByTestId("incidents-live-table-load-error")).toBeNull();
    expect(screen.getByText(CHECKOUT.title)).toBeInTheDocument();
    expect(screen.getByText(STOREFRONT.title)).toBeInTheDocument();
    expect(
      screen.queryByText("The server could not be reached"),
    ).not.toBeInTheDocument();
  });
});

describe("a change waits while the reader is in the middle of something", () => {
  test("rows ticked for a bulk action stay put until the reader unticks them", async () => {
    await renderTable();

    const boxes: Array<HTMLInputElement> = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    // The header box ticks every row on the page.
    fireEvent.click(boxes[0]!);

    const readsBefore: number = listCalls;
    serverRows = [LOGIN, CHECKOUT, STOREFRONT];
    announce("Create");

    // Well past the moment it would have read.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 2500);
    });
    expect(listCalls).toBe(readsBefore);
    expect(screen.queryByText(LOGIN.title)).not.toBeInTheDocument();

    fireEvent.click(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!,
    );

    expect(
      await screen.findByText(LOGIN.title, {}, { timeout: 6000 }),
    ).toBeInTheDocument();
  }, 20000);

  /*
   * A row read in above the one under the pointer would move it as it is
   * clicked, and the click open the next incident. The pointer moving over
   * the rows holds them; once it has rested, the list reads.
   */
  test("a pointer moving over the rows holds them until it rests", async () => {
    await renderTable();

    const body: HTMLElement = document.getElementById(
      "incidents-live-table-body",
    )!;
    const cell: HTMLElement = screen.getByText(STOREFRONT.title);

    expect(body).toContainElement(cell);
    fireEvent(cell, new Event("pointermove", { bubbles: true }));

    const readsBefore: number = listCalls;
    serverRows = [LOGIN, CHECKOUT, STOREFRONT];
    announce("Create");

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 2500);
    });
    expect(listCalls).toBe(readsBefore);
    expect(screen.queryByText(LOGIN.title)).not.toBeInTheDocument();

    expect(
      await screen.findByText(LOGIN.title, {}, { timeout: 6000 }),
    ).toBeInTheDocument();
  }, 20000);

  test("a pointer moving anywhere else holds nothing", async () => {
    await renderTable();

    fireEvent(document.body, new Event("pointermove", { bubbles: true }));

    serverRows = [LOGIN, CHECKOUT, STOREFRONT];
    announce("Create");

    expect(
      await screen.findByText(LOGIN.title, {}, { timeout: 1500 }),
    ).toBeInTheDocument();
  });

  test("an open dialog holds the rows until it closes", async () => {
    await renderTable();

    const dialog: HTMLDivElement = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    const readsBefore: number = listCalls;
    serverRows = [LOGIN, CHECKOUT, STOREFRONT];
    announce("Create");

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 2500);
    });
    expect(listCalls).toBe(readsBefore);

    dialog.remove();

    expect(
      await screen.findByText(LOGIN.title, {}, { timeout: 6000 }),
    ).toBeInTheDocument();
  }, 20000);
});

/*
 * A row stays itself when a live read moves it: keyed by its position, the
 * View the keyboard was on became the next incident's, and Enter opened
 * that one.
 */
describe("a row stays itself when the rows move", () => {
  const rowOf: (element: Element | null) => HTMLElement | null = (
    element: Element | null,
  ): HTMLElement | null => {
    return element ? (element.closest("tr") as HTMLElement | null) : null;
  };

  test("the keyboard stays on the incident it was on when a new one is read in above it", async () => {
    await renderTable();

    const checkoutRow: HTMLElement = rowOf(screen.getByText(CHECKOUT.title))!;
    const box: HTMLInputElement = checkoutRow.querySelector(
      'input[type="checkbox"]',
    )!;

    act((): void => {
      box.focus();
    });
    expect(document.activeElement).toBe(box);

    serverRows = [LOGIN, CHECKOUT, STOREFRONT];
    announce("Create");
    await screen.findByText(LOGIN.title);

    // Still on Checkout's row, which moved down one: not on the new row.
    const focusedRow: HTMLElement | null = rowOf(document.activeElement);
    expect(focusedRow).not.toBeNull();
    expect(focusedRow).toHaveTextContent(CHECKOUT.title);
    expect(focusedRow).not.toHaveTextContent(LOGIN.title);
  });
});

/*
 * The rows a live read brings in are tinted for a moment (Theme.css,
 * data-row-arrived), so the eye finds the new incident among the rows that
 * moved down for it. A read the reader asked for tints nothing.
 */
describe("a row a live read brought in is marked for a moment", () => {
  const isMarked: (title: string) => boolean = (title: string): boolean => {
    const row: HTMLElement | null = screen
      .getByText(title)
      .closest("tr") as HTMLElement | null;

    return row?.getAttribute("data-row-arrived") === "true";
  };

  test("the new incident is marked, the rows that were there are not, and the mark goes", async () => {
    await renderTable();

    serverRows = [LOGIN, CHECKOUT, STOREFRONT];
    announce("Create");
    await screen.findByText(LOGIN.title);

    expect(isMarked(LOGIN.title)).toBe(true);
    expect(isMarked(CHECKOUT.title)).toBe(false);
    expect(isMarked(STOREFRONT.title)).toBe(false);

    await waitFor(
      () => {
        expect(isMarked(LOGIN.title)).toBe(false);
      },
      { timeout: 5000 },
    );
  }, 15000);

  test("the first page drawn marks nothing", async () => {
    await renderTable();

    expect(document.querySelector("[data-row-arrived]")).toBeNull();
  });

  test("a row that comes into the page without being created is not marked", async () => {
    await renderTable();

    // Login was there all along, below the page; Storefront left it.
    serverRows = [CHECKOUT, LOGIN];
    announce("Delete");

    await screen.findByText(LOGIN.title);
    expect(document.querySelector("[data-row-arrived]")).toBeNull();
  });

  test("a change to a row already there marks nothing", async () => {
    await renderTable();

    serverRows = [
      { ...CHECKOUT, title: "Checkout API is returning 502 errors (EU)" },
      STOREFRONT,
    ];
    announce("Update");

    await screen.findByText("Checkout API is returning 502 errors (EU)");
    expect(document.querySelector("[data-row-arrived]")).toBeNull();
  });

  test("the rows of a read the reader asked for are not marked", async () => {
    const view: ReturnType<typeof render> = render(
      <BaseModelTable<Incident> {...makeProps()} />,
    );
    await screen.findByText(CHECKOUT.title);

    view.rerender(
      <BaseModelTable<Incident> {...makeProps({ isNarrowedToLogin: true })} />,
    );
    expect(await screen.findByText(LOGIN.title)).toBeInTheDocument();

    expect(document.querySelector("[data-row-arrived]")).toBeNull();
  });
});

describe("lists that stay as they were loaded", () => {
  test("a Monitors list: monitors do not announce their changes", async () => {
    render(
      <BaseModelTable<Incident>
        {...makeProps({
          modelType: Monitor as unknown as { new (): BaseModel },
        })}
      />,
    );
    await waitFor(() => {
      expect(listCalls).toBeGreaterThan(0);
    });
    expect(active()).toEqual([]);
  });

  test("a list told to stay as loaded", async () => {
    await renderTable({ isLive: false });
    expect(active()).toEqual([]);
  });

  test("a page with no live connection of its own", async () => {
    isConnectionStarted = false;
    await renderTable();
    expect(subscriptions).toEqual([]);
  });

  test("a list outside a project", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    await renderTable();
    expect(subscriptions).toEqual([]);
  });

  test("a list that goes stops listening", async () => {
    await renderTable();
    expect(active()).toHaveLength(3);
    cleanup();
    expect(active()).toEqual([]);
  });
});
