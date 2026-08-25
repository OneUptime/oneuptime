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

/*
 * A real BaseModelTable mounts a card, a header, a full table and (in the
 * picker tests) a modal on top of that. That comfortably outruns the 1s
 * default when the whole Common suite is competing for the same box.
 */
configure({ asyncUtilTimeout: 15000 });

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * BaseModelTable pulls in permissions, the current project and the i18n
 * provider. None of those are what this suite is about.
 */
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
import Columns from "../../../../UI/Components/ModelTable/Columns";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import Query from "../../../../Types/BaseDatabase/Query";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import UserPreferences, {
  UserPreferenceType,
} from "../../../../Utils/UserPreferences";
import { JSONObject } from "../../../../Types/JSON";

/*
 * ---------------------------------------------------------------------------
 * Attribute columns, end to end through a real table
 * ---------------------------------------------------------------------------
 *
 * A security event's typed OCSF columns are only half of what it carries; the
 * rest of the source payload is flattened into an `attributes` map whose keys
 * differ per event class. Those cannot ship as columns, so the picker offers
 * them through a search box and whatever the viewer adds becomes an ordinary
 * column.
 *
 * What is pinned here is everything that only shows up once the pieces are
 * wired together:
 *
 *  - a column added from the picker actually renders a <th> and a cell;
 *  - it survives a reload, because the layout it lives in is the same layout
 *    every other column choice lives in;
 *  - removing it, or resetting the layout, takes it away;
 *  - the map column is on the wire from the FIRST request, since the table
 *    does not refetch when its column set changes - get that wrong and a
 *    freshly added column renders blank until something else reloads the page;
 *  - the key pool is fetched lazily, when the picker opens, not on mount.
 */

const PREFS_KEY: string = "security-events-table";

const ATTRIBUTE_KEYS: Array<string> = [
  "activity_name",
  "class_uid",
  "device.hostname",
  "finding_info.title",
  "metadata.product.name",
];

type GetListCall = {
  query: Query<SecurityEvent>;
  select: JSONObject;
};

type MakeColumnsFunction = () => Columns<SecurityEvent>;

const makeColumns: MakeColumnsFunction = (): Columns<SecurityEvent> => {
  return [
    { field: { message: true }, title: "Message", type: FieldType.Text },
    { field: { severityName: true }, title: "Severity", type: FieldType.Text },
    {
      field: { eventUid: true },
      title: "Event UID",
      type: FieldType.Text,
      isHiddenByDefault: true,
    },
  ] as unknown as Columns<SecurityEvent>;
};

type SeedPreferenceFunction = (data: {
  order: Array<string>;
  hidden: Array<string>;
}) => void;

const seedPreference: SeedPreferenceFunction = (data: {
  order: Array<string>;
  hidden: Array<string>;
}): void => {
  UserPreferences.saveUserPreferenceByTypeAsJSON({
    key: PREFS_KEY,
    userPreferenceType: UserPreferenceType.BaseModelTableColumns,
    value: { order: data.order, hidden: data.hidden },
  });
};

type ReadPreferenceFunction = () => JSONObject | null;

const readPreference: ReadPreferenceFunction = (): JSONObject | null => {
  return UserPreferences.getUserPreferenceByTypeAsJSON({
    key: PREFS_KEY,
    userPreferenceType: UserPreferenceType.BaseModelTableColumns,
  });
};

type GetHeadersFunction = () => Array<string>;

const getHeaders: GetHeadersFunction = (): Array<string> => {
  return screen.getAllByRole("columnheader").map((header: HTMLElement) => {
    return (header.textContent || "").trim();
  });
};

describe("BaseModelTable attribute columns", () => {
  let calls: Array<GetListCall> = [];
  let rows: Array<JSONObject> = [];
  let fetchCallCount: number = 0;
  let fetchResult: () => Promise<Array<string>> = async () => {
    return ATTRIBUTE_KEYS;
  };

  type MakeCallbacksFunction = () => BaseTableCallbacks<SecurityEvent>;

  const makeCallbacks: MakeCallbacksFunction =
    (): BaseTableCallbacks<SecurityEvent> => {
      return {
        deleteItem: async () => {
          return undefined;
        },
        getModelFromJSON: (item: JSONObject) => {
          return item as unknown as SecurityEvent;
        },
        getJSONFromModel: (item: SecurityEvent) => {
          return item as unknown as JSONObject;
        },
        addSlugToSelect: (select: unknown) => {
          return select;
        },
        getList: async (data: {
          query: Query<SecurityEvent>;
          limit: number;
          select: JSONObject;
        }): Promise<ListResult<SecurityEvent>> => {
          calls.push({
            query: data.query,
            select: (data.select || {}) as unknown as JSONObject,
          });
          return {
            data: rows as unknown as Array<SecurityEvent>,
            count: rows.length,
            skip: 0,
            limit: data.limit,
          };
        },
        toJSONArray: () => {
          return rows;
        },
        updateById: async () => {
          return undefined;
        },
        showCreateEditModal: () => {
          return <></>;
        },
      } as unknown as BaseTableCallbacks<SecurityEvent>;
    };

  type RenderTableOptions = {
    columns?: Columns<SecurityEvent> | undefined;
    attributeColumnKey?: string | undefined;
    withoutAttributeColumns?: boolean | undefined;
  };

  type RenderTableFunction = (
    options?: RenderTableOptions,
  ) => ReturnType<typeof render>;

  const renderTable: RenderTableFunction = (
    options: RenderTableOptions = {},
  ): ReturnType<typeof render> => {
    const props: BaseModelTableProps<SecurityEvent> = {
      modelType: SecurityEvent,
      id: "security-events-table",
      name: "Security Events",
      userPreferencesKey: PREFS_KEY,
      cardProps: { title: "Security Events" },
      columns: options.columns || makeColumns(),
      filters: [],
      isDeleteable: false,
      isCreateable: false,
      isViewable: false,
      isEditable: false,
      disableUrlState: true,
      callbacks: makeCallbacks(),
      ...(options.withoutAttributeColumns
        ? {}
        : {
            attributeColumnsProps: {
              columnKey: options.attributeColumnKey || "attributes",
              title: "Add Attribute Column",
              emptyMessage: "No attributes seen on recent events.",
              fetchAttributeKeys: (): Promise<Array<string>> => {
                fetchCallCount++;
                return fetchResult();
              },
            },
          }),
    } as unknown as BaseModelTableProps<SecurityEvent>;

    return render(<BaseModelTable<SecurityEvent> {...props} />);
  };

  type WaitForTableFunction = () => Promise<void>;

  const waitForTable: WaitForTableFunction = async (): Promise<void> => {
    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
    });
  };

  type ClickFunction = (element: HTMLElement) => Promise<void>;

  const click: ClickFunction = async (element: HTMLElement): Promise<void> => {
    await act(async () => {
      fireEvent.click(element);
    });
  };

  type OpenPickerFunction = () => Promise<void>;

  const openPicker: OpenPickerFunction = async (): Promise<void> => {
    await click(screen.getByRole("button", { name: "More options" }));
    await click(screen.getByText("Columns"));

    await waitFor(() => {
      expect(screen.queryByTestId("column-customization-modal")).not.toBeNull();
    });
  };

  type SavePickerFunction = () => Promise<void>;

  const savePicker: SavePickerFunction = async (): Promise<void> => {
    await click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("column-customization-modal")).toBeNull();
    });
  };

  type WaitForPoolFunction = () => Promise<void>;

  const waitForPool: WaitForPoolFunction = async (): Promise<void> => {
    await waitFor(() => {
      expect(
        screen.queryByTestId("add-column-attributes.device.hostname"),
      ).not.toBeNull();
    });
  };

  beforeEach(() => {
    calls = [];
    rows = [];
    fetchCallCount = 0;
    fetchResult = async () => {
      return ATTRIBUTE_KEYS;
    };
    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/security-events",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("the map column is always requested", () => {
    /*
     * The table does not refetch when its column set changes, so a column the
     * viewer adds from the picker appears against rows that were fetched
     * before it existed. If the map were only selected because a column reads
     * it, every freshly added attribute column would render blank until
     * something else happened to reload the page.
     */
    test("the very first request selects the map column, with no attribute columns yet", async () => {
      renderTable();

      await waitForTable();

      expect(calls[0]!.select["attributes"]).toBe(true);
    });

    test("a table that did not opt in does not select the map column", async () => {
      renderTable({ withoutAttributeColumns: true });

      await waitForTable();

      expect(calls[0]!.select["attributes"]).toBeUndefined();
    });

    /*
     * A misconfigured columnKey must cost the feature, not the page:
     * getSelectFromColumns throws a BadDataException for a field the model
     * does not have, which would blank the whole table.
     */
    test("a column key that is not on the model is ignored rather than fatal", async () => {
      renderTable({ attributeColumnKey: "notAColumn" });

      await waitForTable();

      expect(getHeaders()).toContain("Message");
      expect(calls[0]!.select["notAColumn"]).toBeUndefined();
    });
  });

  describe("the key pool", () => {
    test("is not fetched on mount", async () => {
      renderTable();

      await waitForTable();

      expect(fetchCallCount).toBe(0);
    });

    test("is fetched when the picker opens, and offered as searchable rows", async () => {
      renderTable();

      await waitForTable();
      await openPicker();
      await waitForPool();

      expect(fetchCallCount).toBe(1);
      expect(screen.getAllByTestId(/^add-column-attributes\./)).toHaveLength(
        ATTRIBUTE_KEYS.length,
      );
    });

    test("is fetched once, not again on every open", async () => {
      renderTable();

      await waitForTable();
      await openPicker();
      await waitForPool();
      await click(screen.getByTestId("modal-footer-close-button"));
      await openPicker();
      await waitForPool();

      expect(fetchCallCount).toBe(1);
    });

    test("is normalized: blanks dropped, duplicates collapsed, sorted", async () => {
      fetchResult = async () => {
        return ["zeta", "  alpha  ", "", "alpha"] as Array<string>;
      };

      renderTable();

      await waitForTable();
      await openPicker();

      await waitFor(() => {
        expect(
          screen.queryByTestId("add-column-attributes.alpha"),
        ).not.toBeNull();
      });

      const offered: Array<string> = screen
        .getAllByTestId(/^add-column-attributes\./)
        .map((element: HTMLElement) => {
          return (element.getAttribute("data-testid") || "").replace(
            "add-column-attributes.",
            "",
          );
        });

      expect(offered).toEqual(["alpha", "zeta"]);
    });

    /*
     * A failed pool costs the search box and nothing else. It must not take
     * the picker, or the columns already added, down with it.
     */
    test("a failure is surfaced without breaking the rest of the picker", async () => {
      fetchResult = async () => {
        throw new Error("clickhouse said no");
      };

      renderTable();

      await waitForTable();
      await openPicker();

      await waitFor(() => {
        expect(screen.queryByTestId("add-column-error")).not.toBeNull();
      });

      expect(screen.getByTestId("add-column-error")).toHaveTextContent(
        "clickhouse said no",
      );
      // The ordinary checklist is untouched.
      expect(screen.getByTestId("column-toggle-message")).toBeInTheDocument();
    });

    test("a failed fetch is retried the next time the picker opens", async () => {
      fetchResult = async () => {
        throw new Error("clickhouse said no");
      };

      renderTable();

      await waitForTable();
      await openPicker();

      await waitFor(() => {
        expect(screen.queryByTestId("add-column-error")).not.toBeNull();
      });

      fetchResult = async () => {
        return ATTRIBUTE_KEYS;
      };

      await click(screen.getByTestId("modal-footer-close-button"));
      await openPicker();
      await waitForPool();

      expect(fetchCallCount).toBe(2);
    });

    test("an empty pool says so in the caller's words", async () => {
      fetchResult = async () => {
        return [];
      };

      renderTable();

      await waitForTable();
      await openPicker();

      await waitFor(() => {
        expect(screen.queryByTestId("add-column-empty")).not.toBeNull();
      });

      expect(screen.getByTestId("add-column-empty")).toHaveTextContent(
        "No attributes seen on recent events.",
      );
    });
  });

  describe("adding a column from the picker", () => {
    test("renders it as a new header once saved", async () => {
      renderTable();

      await waitForTable();

      expect(getHeaders()).toEqual(["Message", "Severity"]);

      await openPicker();
      await waitForPool();
      await click(screen.getByTestId("add-column-attributes.device.hostname"));
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).toContain("device.hostname");
      });

      expect(getHeaders()).toEqual(["Message", "Severity", "device.hostname"]);
    });

    test("renders the value out of the row's map", async () => {
      rows = [
        {
          _id: "1",
          message: "Suspicious logon",
          severityName: "High",
          attributes: { "device.hostname": "web-1", class_uid: "3002" },
        },
      ];

      renderTable();

      await waitForTable();
      await openPicker();
      await waitForPool();
      await click(screen.getByTestId("add-column-attributes.device.hostname"));
      await savePicker();

      await waitFor(() => {
        expect(screen.queryByText("web-1")).not.toBeNull();
      });
    });

    test("stores the choice so it survives a reload", async () => {
      renderTable();

      await waitForTable();
      await openPicker();
      await waitForPool();
      await click(screen.getByTestId("add-column-attributes.device.hostname"));
      await savePicker();

      const stored: JSONObject | null = readPreference();

      expect(stored).not.toBeNull();
      expect(stored!["order"]).toContain("attributes.device.hostname");
    });

    test("a stored attribute column is rebuilt on the next mount", async () => {
      seedPreference({
        order: ["message", "severityName", "attributes.device.hostname"],
        hidden: [],
      });

      rows = [
        {
          _id: "1",
          message: "Suspicious logon",
          severityName: "High",
          attributes: { "device.hostname": "web-1" },
        },
      ];

      renderTable();

      await waitForTable();

      /*
       * Rebuilt during render off the stored layout - not after an effect, and
       * without waiting on the key pool, which is not even fetched yet.
       */
      expect(getHeaders()).toEqual(["Message", "Severity", "device.hostname"]);
      expect(fetchCallCount).toBe(0);

      // Headers render off the column set; the cells wait on the first page.
      await waitFor(() => {
        expect(screen.queryByText("web-1")).not.toBeNull();
      });
    });

    test("a stored attribute column that is also hidden stays a column", async () => {
      seedPreference({
        order: ["message", "severityName", "attributes.device.hostname"],
        hidden: ["attributes.device.hostname"],
      });

      renderTable();

      await waitForTable();

      expect(getHeaders()).toEqual(["Message", "Severity"]);

      await openPicker();

      // Still in the picker, so switching it back on is one click.
      expect(
        screen.getByTestId("column-toggle-attributes.device.hostname"),
      ).not.toBeChecked();
    });

    test("adding several keeps them in the order they were added", async () => {
      renderTable();

      await waitForTable();
      await openPicker();
      await waitForPool();
      await click(screen.getByTestId("add-column-attributes.device.hostname"));
      await click(screen.getByTestId("add-column-attributes.class_uid"));
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).toContain("class_uid");
      });

      expect(getHeaders()).toEqual([
        "Message",
        "Severity",
        "device.hostname",
        "class_uid",
      ]);
    });

    test("an added column can be reordered like any other", async () => {
      renderTable();

      await waitForTable();
      await openPicker();
      await waitForPool();
      await click(screen.getByTestId("add-column-attributes.device.hostname"));
      await click(
        screen.getByTestId("column-move-up-attributes.device.hostname"),
      );
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).toContain("device.hostname");
      });

      /*
       * "Event UID" is hidden by default, so it sits between Severity and the
       * added column in the picker but never reaches the header row.
       */
      expect(getHeaders()).toEqual(["Message", "Severity", "device.hostname"]);

      expect(readPreference()!["order"]).toEqual([
        "message",
        "severityName",
        "attributes.device.hostname",
        "eventUid",
      ]);
    });
  });

  describe("removing an attribute column", () => {
    type SeedAndRenderFunction = () => Promise<void>;

    const seedAndRender: SeedAndRenderFunction = async (): Promise<void> => {
      seedPreference({
        order: ["message", "severityName", "attributes.device.hostname"],
        hidden: [],
      });

      renderTable();

      await waitForTable();
    };

    test("takes the header away", async () => {
      await seedAndRender();

      expect(getHeaders()).toContain("device.hostname");

      await openPicker();
      await click(
        screen.getByTestId("column-remove-attributes.device.hostname"),
      );
      await savePicker();

      await waitFor(() => {
        expect(getHeaders()).not.toContain("device.hostname");
      });
    });

    test("takes it out of the stored layout, not just out of view", async () => {
      await seedAndRender();

      await openPicker();
      await click(
        screen.getByTestId("column-remove-attributes.device.hostname"),
      );
      await savePicker();

      /*
       * With nothing left that differs from the table's own layout, the stored
       * preference is cleared entirely rather than pinning this release's
       * column set forever.
       */
      expect(readPreference()).toBeNull();
    });

    test("a removed column goes back into the pool it came from", async () => {
      await seedAndRender();

      await openPicker();

      /*
       * Waits on a DIFFERENT key: device.hostname is already a column, so it
       * is precisely the one the pool must not be offering yet.
       */
      await waitFor(() => {
        expect(
          screen.queryByTestId("add-column-attributes.class_uid"),
        ).not.toBeNull();
      });

      expect(
        screen.queryByTestId("add-column-attributes.device.hostname"),
      ).toBeNull();

      await click(
        screen.getByTestId("column-remove-attributes.device.hostname"),
      );

      expect(
        screen.getByTestId("add-column-attributes.device.hostname"),
      ).toBeInTheDocument();
    });

    test("declared columns have no remove button at all", async () => {
      await seedAndRender();

      await openPicker();

      expect(screen.queryByTestId("column-remove-message")).toBeNull();
      expect(screen.queryByTestId("column-remove-severityName")).toBeNull();
    });

    test("Reset to default drops every attribute column", async () => {
      await seedAndRender();

      await openPicker();
      await click(screen.getByTestId("column-customization-reset"));

      await waitFor(() => {
        expect(getHeaders()).not.toContain("device.hostname");
      });

      expect(readPreference()).toBeNull();
      expect(getHeaders()).toEqual(["Message", "Severity"]);
    });
  });

  describe("stored layouts that name things this table does not have", () => {
    /*
     * Attribute keys are recovered from the RAW stored layout rather than the
     * sanitized one, which is the only way a column can exist because its id
     * is in there. The flip side is that a key nobody has ingested for a while
     * still rebuilds - deliberately: it renders empty cells the viewer can see
     * and remove, rather than silently discarding a column they chose.
     */
    test("a key the pool no longer knows about still rebuilds its column", async () => {
      fetchResult = async () => {
        return ["class_uid"];
      };

      seedPreference({
        order: ["message", "severityName", "attributes.long.gone"],
        hidden: [],
      });

      renderTable();

      await waitForTable();

      expect(getHeaders()).toContain("long.gone");
    });

    test("an unknown non-attribute id is still dropped", async () => {
      seedPreference({
        order: ["message", "severityName", "someColumnWeRemoved"],
        hidden: ["someColumnWeRemoved"],
      });

      renderTable();

      await waitForTable();

      expect(getHeaders()).toEqual(["Message", "Severity"]);
    });
  });
});
