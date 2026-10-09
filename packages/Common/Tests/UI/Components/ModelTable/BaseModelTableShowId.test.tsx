import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import { SpyInstance } from "jest-mock";

/*
 * Show ID, in every table's ⋯ menu - on analytics (ClickHouse) rows too.
 *
 * Issue #4615: on AI / LLM > Overview, Show ID on a row of Recent LLM Calls
 * threw minified React error #31, "Objects are not valid as a React child
 * (found: object with keys {_id})", from a <code> inside the dialog's
 * ModalBody, under ConfirmModal, BaseModelTable, AnalyticsModelTable and
 * LlmCallsTable. A database model's `_id` is a string, but an analytics row's
 * is an ObjectID, and the shared table cast it to a string and put it in the
 * dialog as it was. Every AnalyticsModelTable with Show ID did the same:
 * spans, LLM calls, exception occurrences and profiles.
 *
 * These tests render the real AnalyticsModelTable over rows that come through
 * the real AnalyticsModelAPI from an HTTP response shaped like the server's,
 * so the rows hold exactly what the browser's did.
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

import AnalyticsModelTable from "../../../../UI/Components/ModelTable/AnalyticsModelTable";
import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { API_DOCS_URL } from "../../../../UI/Config";
import Navigation from "../../../../UI/Utils/Navigation";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Profile from "../../../../Models/AnalyticsModels/Profile";
import Span from "../../../../Models/AnalyticsModels/Span";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import URL from "../../../../Types/API/URL";
import {
  fakeListApi,
  ListApiFake,
  serializedObjectId,
} from "../../../Helpers/ListApiFake";

const CALL_IDS: Array<string> = [
  "0199c9b2-4f7e-7a10-9f1e-1234567890ab",
  "0199c9b2-5a11-7b22-8c33-abcdefabcdef",
];

// Two LLM calls, as the span list endpoint sends them.
const LLM_CALL_ROWS: Array<JSONObject> = [
  {
    _id: serializedObjectId(CALL_IDS[0]!),
    name: "chat gpt-4o-mini",
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    projectId: serializedObjectId("11111111-1111-4111-8111-111111111111"),
    primaryEntityId: serializedObjectId("22222222-2222-4222-8222-222222222222"),
  },
  {
    _id: serializedObjectId(CALL_IDS[1]!),
    name: "embeddings text-embedding-3-small",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    projectId: serializedObjectId("11111111-1111-4111-8111-111111111111"),
    primaryEntityId: serializedObjectId("22222222-2222-4222-8222-222222222222"),
  },
];

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

let api: ListApiFake;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;
let consoleErrorSpy: SpyInstance<typeof console.error>;
let fetchedRows: Array<AnalyticsBaseModel> = [];

function installClipboard(writeText: WriteTextMock): void {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

// What React logs when it is handed an object as a child.
function reactChildErrors(): Array<string> {
  return consoleErrorSpy.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .filter((message: string): boolean => {
      return message.includes("Objects are not valid as a React child");
    });
}

type AnalyticsTableOptions = {
  modelType: { new (): AnalyticsBaseModel };
  singularName: string;
  columnField: string;
};

/*
 * The table the way the LLM calls table is set up: View on the row, Show ID
 * in its ⋯ menu.
 */
function renderAnalyticsTable(options: AnalyticsTableOptions): void {
  render(
    <AnalyticsModelTable<AnalyticsBaseModel>
      modelType={options.modelType}
      id="show-id-analytics-table"
      name={options.singularName}
      singularName={options.singularName}
      pluralName={`${options.singularName}s`}
      userPreferencesKey="show-id-analytics-table"
      disableUrlState={true}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      onViewPage={async (): Promise<URL> => {
        return URL.fromString("https://oneuptime.example/trace");
      }}
      cardProps={{ title: options.singularName, description: "" }}
      query={{}}
      showViewIdButton={true}
      onFetchSuccess={(data: Array<AnalyticsBaseModel>) => {
        fetchedRows = data;
      }}
      filters={[]}
      columns={[
        {
          field: { [options.columnField]: true },
          title: "Name",
          type: FieldType.Text,
        },
      ]}
    />,
  );
}

async function waitForRows(count: number): Promise<Array<HTMLElement>> {
  await waitFor(() => {
    expect(screen.getAllByTestId("row-actions")).toHaveLength(count);
  });

  return screen.getAllByTestId("row-actions");
}

function menuItemNames(rowActions: HTMLElement): Array<string> {
  fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));

  const names: Array<string> = within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });

  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

  return names;
}

function clickShowId(rowActions: HTMLElement): void {
  fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", {
      name: "Show ID",
    }),
  );
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

function footerButtonNames(): Array<string> {
  return within(screen.getByTestId("modal-footer"))
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return (button.textContent || "").trim();
    });
}

beforeEach(() => {
  permissionsForTest = Object.values(Permission);
  fetchedRows = [];
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {
      return undefined;
    });
  consoleErrorSpy = jest.spyOn(console, "error");
});

afterEach(() => {
  cleanup();
  api?.restore();
  jest.restoreAllMocks();
});

describe("Show ID on an LLM call (issue #4615)", () => {
  beforeEach(() => {
    api = fakeListApi({ "/span/get-list": LLM_CALL_ROWS });
  });

  test("the rows hold ObjectIDs, the shape that crashed", async () => {
    renderAnalyticsTable({
      modelType: Span,
      singularName: "LLM Call",
      columnField: "name",
    });

    await waitForRows(2);

    expect(
      api.requests.some((url: string): boolean => {
        return url.endsWith("/span/get-list");
      }),
    ).toBe(true);
    expect(fetchedRows).toHaveLength(2);

    for (const row of fetchedRows) {
      expect(row._id).toBeInstanceOf(ObjectID);
      expect(typeof row._id).not.toBe("string");
    }
  });

  test("opens the call's ID instead of crashing", async () => {
    renderAnalyticsTable({
      modelType: Span,
      singularName: "LLM Call",
      columnField: "name",
    });

    const rows: Array<HTMLElement> = await waitForRows(2);

    expect(() => {
      clickShowId(rows[1]!);
    }).not.toThrow();

    await waitFor(() => {
      expect(dialog()).toBeInTheDocument();
    });

    expect(screen.getByTestId("modal-title")).toHaveTextContent("LLM Call ID");
    expect(screen.getByTestId("record-id-value").textContent).toBe(CALL_IDS[1]);
    expect(dialog()).not.toHaveTextContent(CALL_IDS[0]!);
    expect(dialog()).not.toHaveTextContent("[object Object]");
    expect(reactChildErrors()).toEqual([]);

    // The table is still there behind it: nothing unmounted the page.
    expect(screen.getAllByTestId("row-actions")).toHaveLength(2);
  });

  test("the copy button copies the ID's text", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);

    renderAnalyticsTable({
      modelType: Span,
      singularName: "LLM Call",
      columnField: "name",
    });

    const rows: Array<HTMLElement> = await waitForRows(2);
    clickShowId(rows[0]!);

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Copy ID to clipboard" }),
      );
    });

    expect(writeText).toHaveBeenCalledWith(CALL_IDS[0]);
  });

  test("Go to API Docs opens the span API's page, where the ID can be used", async () => {
    renderAnalyticsTable({
      modelType: Span,
      singularName: "LLM Call",
      columnField: "name",
    });

    const rows: Array<HTMLElement> = await waitForRows(2);
    clickShowId(rows[0]!);

    expect(await screen.findByTestId("record-id-api-reference")).toBeVisible();
    expect(footerButtonNames()).toEqual(["Close", "Go to API Docs"]);

    fireEvent.click(screen.getByRole("button", { name: "Go to API Docs" }));

    expect(navigateSpy).toHaveBeenCalledWith(
      URL.fromString(API_DOCS_URL.toString()).addRoute("/span"),
      { openInNewTab: true },
    );
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("closes, and shows the next row's own ID when opened from it", async () => {
    renderAnalyticsTable({
      modelType: Span,
      singularName: "LLM Call",
      columnField: "name",
    });

    const rows: Array<HTMLElement> = await waitForRows(2);

    clickShowId(rows[0]!);
    expect((await screen.findByTestId("record-id-value")).textContent).toBe(
      CALL_IDS[0],
    );

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    clickShowId(rows[1]!);
    expect((await screen.findByTestId("record-id-value")).textContent).toBe(
      CALL_IDS[1],
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("Escape closes it", async () => {
    renderAnalyticsTable({
      modelType: Span,
      singularName: "LLM Call",
      columnField: "name",
    });

    const rows: Array<HTMLElement> = await waitForRows(2);
    clickShowId(rows[0]!);
    await screen.findByTestId("record-id-value");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
  });
});

describe("Show ID on every analytics model a table offers it on", () => {
  const ID: string = "0199c9b2-6b77-7c88-9d99-0123456789ab";

  const CASES: Array<{
    name: string;
    modelType: { new (): AnalyticsBaseModel };
    listPath: string;
    singularName: string;
    columnField: string;
    // The API Reference page, or null where it has none.
    apiReferencePagePath: string | null;
  }> = [
    {
      name: "a span (Traces)",
      modelType: Span,
      listPath: "/span/get-list",
      singularName: "Span",
      columnField: "name",
      apiReferencePagePath: "span",
    },
    {
      name: "an exception occurrence",
      modelType: ExceptionInstance,
      listPath: "/exceptions/get-list",
      singularName: "Occurrence",
      columnField: "message",
      apiReferencePagePath: "exceptions",
    },
    {
      // The API Reference has no Profile page.
      name: "a profile",
      modelType: Profile,
      listPath: "/profile/get-list",
      singularName: "Profile",
      columnField: "profileType",
      apiReferencePagePath: null,
    },
  ];

  test.each(CASES)(
    "shows the ID of $name",
    async (testCase: (typeof CASES)[number]) => {
      api = fakeListApi({
        [testCase.listPath]: [
          {
            _id: serializedObjectId(ID),
            [testCase.columnField]: "row",
          },
        ],
      });

      renderAnalyticsTable({
        modelType: testCase.modelType,
        singularName: testCase.singularName,
        columnField: testCase.columnField,
      });

      const rows: Array<HTMLElement> = await waitForRows(1);
      clickShowId(rows[0]!);

      expect((await screen.findByTestId("record-id-value")).textContent).toBe(
        ID,
      );
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        `${testCase.singularName} ID`,
      );
      expect(reactChildErrors()).toEqual([]);

      if (testCase.apiReferencePagePath) {
        expect(footerButtonNames()).toEqual(["Close", "Go to API Docs"]);
        fireEvent.click(screen.getByRole("button", { name: "Go to API Docs" }));
        expect(navigateSpy).toHaveBeenCalledWith(
          URL.fromString(API_DOCS_URL.toString()).addRoute(
            "/" + testCase.apiReferencePagePath,
          ),
          { openInNewTab: true },
        );
      } else {
        // No page to go to: no sentence about the API, no button to a 404.
        expect(screen.queryByTestId("record-id-api-reference")).toBeNull();
        expect(footerButtonNames()).toEqual(["Close"]);
      }
    },
  );
});

describe("rows with no ID", () => {
  test("are not offered Show ID; rows with one still are", async () => {
    api = fakeListApi({
      "/span/get-list": [
        { _id: serializedObjectId(CALL_IDS[0]!), name: "with an id" },
        { _id: null, name: "without one" },
      ],
    });

    renderAnalyticsTable({
      modelType: Span,
      singularName: "LLM Call",
      columnField: "name",
    });

    const rows: Array<HTMLElement> = await waitForRows(2);

    expect(menuItemNames(rows[0]!)).toContain("Show ID");
    expect(
      within(rows[1]!).queryByTestId("row-actions-more-button") === null ||
        !menuItemNames(rows[1]!).includes("Show ID"),
    ).toBe(true);
  });
});

describe("Show ID on a database model's row", () => {
  type Row = { _id: unknown; name: string };

  const renderDatabaseTable: (rows: Array<Row>) => void = (
    rows: Array<Row>,
  ): void => {
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
          data: rows as unknown as Array<Monitor>,
          count: rows.length,
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
        return <div />;
      },
    } as unknown as BaseTableCallbacks<Monitor>;

    render(
      <BaseModelTable<Monitor>
        {...({
          modelType: Monitor,
          id: "show-id-database-table",
          name: "Monitors",
          singularName: "Monitor",
          pluralName: "Monitors",
          userPreferencesKey: "show-id-database-table",
          disableUrlState: true,
          columns: [
            { field: { name: true }, title: "Name", type: FieldType.Text },
          ],
          filters: [],
          cardProps: { title: "Monitors", description: "" },
          isCreateable: false,
          isEditable: false,
          isDeleteable: false,
          isViewable: false,
          showViewIdButton: true,
          callbacks: callbacks,
        } as unknown as BaseModelTableProps<Monitor>)}
      />,
    );
  };

  test("a string ID, as every database model holds it, shows as before", async () => {
    renderDatabaseTable([
      { _id: "monitor-1", name: "Checkout API" },
      { _id: "monitor-2", name: "Billing Worker" },
    ]);

    const rows: Array<HTMLElement> = await waitForRows(2);
    clickShowId(rows[1]!);

    expect((await screen.findByTestId("record-id-value")).textContent).toBe(
      "monitor-2",
    );
    expect(screen.getByTestId("modal-title")).toHaveTextContent("Monitor ID");
    expect(screen.getByTestId("record-id")).toHaveTextContent(
      "ID of this Monitor:",
    );
    // Monitors are in the API Reference.
    expect(footerButtonNames()).toEqual(["Close", "Go to API Docs"]);

    fireEvent.click(screen.getByRole("button", { name: "Go to API Docs" }));

    expect(navigateSpy).toHaveBeenCalledWith(
      URL.fromString(API_DOCS_URL.toString()).addRoute("/monitor"),
      { openInNewTab: true },
    );
  });

  test("an ID still in its JSON shape shows as its text", async () => {
    renderDatabaseTable([
      {
        _id: { _type: "ObjectID", value: "monitor-json" },
        name: "From JSON",
      },
    ]);

    const rows: Array<HTMLElement> = await waitForRows(1);
    clickShowId(rows[0]!);

    expect((await screen.findByTestId("record-id-value")).textContent).toBe(
      "monitor-json",
    );
    expect(reactChildErrors()).toEqual([]);
  });

  test("an ObjectID shows as its text", async () => {
    renderDatabaseTable([
      { _id: new ObjectID("monitor-object"), name: "An ObjectID" },
    ]);

    const rows: Array<HTMLElement> = await waitForRows(1);
    clickShowId(rows[0]!);

    expect((await screen.findByTestId("record-id-value")).textContent).toBe(
      "monitor-object",
    );
    expect(reactChildErrors()).toEqual([]);
  });
});
