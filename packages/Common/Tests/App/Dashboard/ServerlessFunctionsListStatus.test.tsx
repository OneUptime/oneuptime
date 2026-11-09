import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Color from "../../../Types/Color";
import { Gray500, Green, Red } from "../../../Types/BrandColors";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";

/*
 * The Serverless Functions list's Status column (issue #6269). It said
 * "Connected" in green or "Disconnected" in red, and a function nothing had
 * invoked for a quarter of an hour - a nightly job between its runs, a
 * webhook handler on a quiet day - read red as if its link to OneUptime
 * were broken. It says what is true now, in green or grey, and hovering
 * says what that means.
 *
 * The page is rendered with its table recorded, so what the page really
 * hands the table - and what its Status cell draws for each record - is
 * what is tested.
 */

let modelTableCalls: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 3;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 50 };
      },
      getItem: async (): Promise<JSONObject> => {
        return {};
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      modelTableCalls.push(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: null,
          emptyState: undefined,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { rowActions: [], bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        archiveRowActions: [],
        unarchiveRowActions: [],
        archiveBulkActions: [],
      };
    },
  };
});

import ServerlessFunctions from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/ServerlessFunctions";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getServerlessFunctionStatusPillColor } from "../../../../App/FeatureSet/Dashboard/src/Components/Serverless/ServerlessFunctionStatusColor";
import {
  ServerlessFunctionStatus,
  ServerlessFunctionStatusTone,
  getServerlessFunctionStatusWords,
} from "../../../Types/Serverless/ServerlessFunctionStatus";

interface Column {
  title: string;
  field: Record<string, unknown>;
  getElement?: (item: ServerlessFunction) => React.ReactElement;
}

interface PillProps {
  text: string;
  color: Color;
  tooltip?: string;
}

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

async function tableProps(): Promise<Record<string, unknown>> {
  render(<ServerlessFunctions {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("model-table")).toBeInTheDocument();
  });

  return modelTableCalls[modelTableCalls.length - 1] as Record<string, unknown>;
}

async function statusColumn(): Promise<Column> {
  const columns: Array<Column> = (await tableProps())[
    "columns"
  ] as Array<Column>;
  const column: Column | undefined = columns.find(
    (candidate: Column): boolean => {
      return candidate.title === "Status";
    },
  );

  expect(column).toBeDefined();

  return column as Column;
}

function serverlessFunction(
  fields: Partial<ServerlessFunction>,
): ServerlessFunction {
  const item: ServerlessFunction = new ServerlessFunction();
  item._id = "84858d6c-2222-4aaa-8bbb-000000000001";
  item.name = "Checkout handler";
  item.functionIdentifier = "checkout-handler";
  Object.assign(item, fields);
  return item;
}

function pillOf(column: Column, item: ServerlessFunction): PillProps {
  return (
    column.getElement as (item: ServerlessFunction) => React.ReactElement
  )(item).props as PillProps;
}

beforeEach(() => {
  modelTableCalls = [];
});

afterEach(() => {
  cleanup();
});

describe("the Serverless Functions list's Status column", () => {
  test("is read from the stored status, and the list always loads when data last arrived", async () => {
    const props: Record<string, unknown> = await tableProps();
    const column: Column | undefined = (props["columns"] as Array<Column>).find(
      (candidate: Column): boolean => {
        return candidate.title === "Status";
      },
    );

    expect(column?.field).toEqual({ otelCollectorStatus: true });
    /*
     * Its Last Seen column can be hidden, and the status still needs to
     * tell "nothing yet" from "nothing lately".
     */
    expect(props["selectMoreFields"]).toMatchObject({ lastSeenAt: true });
  });

  test("a function whose data arrives reads Receiving data, in green", async () => {
    const column: Column = await statusColumn();
    const pill: PillProps = pillOf(
      column,
      serverlessFunction({
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(),
      }),
    );

    expect(pill.text).toBe("Receiving data");
    expect(pill.color).toBe(Green);
    expect(pill.tooltip).toBe(
      "Data has arrived from this function in the last 15 minutes.",
    );
  });

  test("one nothing has invoked for a while reads No recent invocations, in grey, and says that is normal", async () => {
    const column: Column = await statusColumn();
    const pill: PillProps = pillOf(
      column,
      serverlessFunction({
        otelCollectorStatus: "disconnected",
        lastSeenAt: new Date("2026-11-07T03:00:00.000Z"),
      }),
    );

    expect(pill.text).toBe("No recent invocations");
    expect(pill.color).toBe(Gray500);
    expect(pill.tooltip).toBe(
      "Nothing has arrived in the last 15 minutes. A function sends data only while it runs, so this is normal when nothing has invoked it, for example between scheduled runs. If it should be running, its Overview lists what to check.",
    );
  });

  test("one added through the API, before its first data, reads Waiting for data, in grey, and says how to start", async () => {
    const column: Column = await statusColumn();

    for (const fields of [
      { otelCollectorStatus: undefined, lastSeenAt: undefined },
      { otelCollectorStatus: "disconnected", lastSeenAt: undefined },
    ] as Array<Partial<ServerlessFunction>>) {
      const pill: PillProps = pillOf(column, serverlessFunction(fields));

      expect(pill.text).toBe("Waiting for data");
      expect(pill.color).toBe(Gray500);
      expect(pill.tooltip).toBe(
        "Nothing has arrived from this function yet. Add the OpenTelemetry SDK to it and invoke it once; its Documentation tab shows how.",
      );
    }
  });

  test("no record reads Connected or Disconnected, and none is red", async () => {
    const column: Column = await statusColumn();

    for (const fields of [
      { otelCollectorStatus: "connected", lastSeenAt: new Date() },
      { otelCollectorStatus: "Connected", lastSeenAt: new Date() },
      { otelCollectorStatus: "ACTIVE", lastSeenAt: new Date() },
      { otelCollectorStatus: "disconnected", lastSeenAt: new Date() },
      { otelCollectorStatus: "disconnected", lastSeenAt: undefined },
      { otelCollectorStatus: undefined, lastSeenAt: undefined },
      { otelCollectorStatus: "something new", lastSeenAt: new Date() },
    ] as Array<Partial<ServerlessFunction>>) {
      const pill: PillProps = pillOf(column, serverlessFunction(fields));

      expect(pill.text).not.toMatch(/connected/i);
      expect(pill.tooltip || "").not.toMatch(/disconnect/i);
      expect(pill.color.toString()).not.toBe(Red.toString());
    }
  });

  /*
   * The column reads the stored value the way the function's Overview and
   * its connection card do: "connected" in any case, or "active", is data
   * arriving - not just a lower-case "connected", as the column used to.
   */
  test("reads 'Connected' and 'active' as data arriving, as the Overview does", async () => {
    const column: Column = await statusColumn();

    for (const otelCollectorStatus of ["Connected", "CONNECTED", "active"]) {
      expect(
        pillOf(
          column,
          serverlessFunction({ otelCollectorStatus, lastSeenAt: new Date() }),
        ).text,
      ).toBe("Receiving data");
    }
  });

  test("its pill renders the words, with the meaning on hover", async () => {
    const column: Column = await statusColumn();

    await act(async () => {
      render(
        (column.getElement as (item: ServerlessFunction) => React.ReactElement)(
          serverlessFunction({
            otelCollectorStatus: "disconnected",
            lastSeenAt: new Date(),
          }),
        ),
      );
    });

    expect(screen.getByTestId("pill")).toHaveTextContent(
      "No recent invocations",
    );
  });
});

describe("the list's pill colours", () => {
  test("green while data arrives, grey otherwise, red never", () => {
    expect(getServerlessFunctionStatusPillColor("positive")).toBe(Green);
    expect(getServerlessFunctionStatusPillColor("neutral")).toBe(Gray500);

    for (const status of [
      ServerlessFunctionStatus.ReceivingData,
      ServerlessFunctionStatus.NoRecentInvocations,
      ServerlessFunctionStatus.WaitingForData,
    ]) {
      const tone: ServerlessFunctionStatusTone =
        getServerlessFunctionStatusWords(status).tone;

      expect(getServerlessFunctionStatusPillColor(tone).toString()).not.toBe(
        Red.toString(),
      );
    }
  });
});
