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
import RumApplication from "../../../Models/DatabaseModels/RumApplication";

/*
 * The RUM Applications list's Status column (issue #6191). It said
 * "Connected" in green or "Disconnected" in red, and an application nobody
 * had visited for a quarter of an hour - or one added by hand that had not
 * sent anything yet - read red as if its link to OneUptime were broken. It
 * says what is true now, in green or grey, and hovering says what that means.
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

import RumApplications from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/RumApplications";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

interface Column {
  title: string;
  field: Record<string, unknown>;
  getElement?: (item: RumApplication) => React.ReactElement;
}

interface PillProps {
  text: string;
  color: Color;
  tooltip?: string;
}

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

async function tableProps(): Promise<Record<string, unknown>> {
  render(<RumApplications {...PAGE_PROPS} />);

  await waitFor(() => {
    expect(screen.getByTestId("model-table")).toBeInTheDocument();
  });

  return modelTableCalls[modelTableCalls.length - 1] as Record<
    string,
    unknown
  >;
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

function application(fields: Partial<RumApplication>): RumApplication {
  const item: RumApplication = new RumApplication();
  item._id = "84858d6c-1111-4aaa-8bbb-000000000001";
  item.name = "Storefront";
  item.appIdentifier = "storefront-web";
  Object.assign(item, fields);
  return item;
}

function pillOf(column: Column, item: RumApplication): PillProps {
  return (column.getElement as (item: RumApplication) => React.ReactElement)(
    item,
  ).props as PillProps;
}

beforeEach(() => {
  modelTableCalls = [];
});

afterEach(() => {
  cleanup();
});

describe("the RUM Applications list's Status column", () => {
  test("is read from the stored status, and the list always loads when data last arrived", async () => {
    const props: Record<string, unknown> = await tableProps();
    const column: Column | undefined = (
      props["columns"] as Array<Column>
    ).find((candidate: Column): boolean => {
      return candidate.title === "Status";
    });

    expect(column?.field).toEqual({ otelCollectorStatus: true });
    /*
     * Its Last Seen column can be hidden, and the status still needs to
     * tell "nothing yet" from "nothing lately".
     */
    expect(props["selectMoreFields"]).toMatchObject({ lastSeenAt: true });
  });

  test("an application whose data arrives reads Receiving data, in green", async () => {
    const column: Column = await statusColumn();
    const pill: PillProps = pillOf(
      column,
      application({
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(),
      }),
    );

    expect(pill.text).toBe("Receiving data");
    expect(pill.color).toBe(Green);
    expect(pill.tooltip).toBe(
      "Data has arrived from this application in the last 15 minutes.",
    );
  });

  test("one nobody has used for a while reads No recent traffic, in grey, and says that is normal", async () => {
    const column: Column = await statusColumn();
    const pill: PillProps = pillOf(
      column,
      application({
        otelCollectorStatus: "disconnected",
        lastSeenAt: new Date("2026-11-07T03:00:00.000Z"),
      }),
    );

    expect(pill.text).toBe("No recent traffic");
    expect(pill.color).toBe(Gray500);
    expect(pill.tooltip).toBe(
      "Nothing has arrived in the last 15 minutes. An application sends data only while people use it, so this is normal when nobody is, for example overnight. If people are using it right now, its Overview lists what to check.",
    );
  });

  test("one added by hand, before its first data, reads Waiting for data, in grey, and says how to start", async () => {
    const column: Column = await statusColumn();

    for (const fields of [
      { otelCollectorStatus: undefined, lastSeenAt: undefined },
      { otelCollectorStatus: "disconnected", lastSeenAt: undefined },
    ] as Array<Partial<RumApplication>>) {
      const pill: PillProps = pillOf(column, application(fields));

      expect(pill.text).toBe("Waiting for data");
      expect(pill.color).toBe(Gray500);
      expect(pill.tooltip).toBe(
        "Nothing has arrived from this application yet. Add the OpenTelemetry SDK or the Session Replay snippet to your app; its Documentation tab shows how.",
      );
    }
  });

  test("no record reads Connected or Disconnected, and none is red", async () => {
    const column: Column = await statusColumn();

    for (const fields of [
      { otelCollectorStatus: "connected", lastSeenAt: new Date() },
      { otelCollectorStatus: "Connected", lastSeenAt: new Date() },
      { otelCollectorStatus: "disconnected", lastSeenAt: new Date() },
      { otelCollectorStatus: "disconnected", lastSeenAt: undefined },
      { otelCollectorStatus: undefined, lastSeenAt: undefined },
      { otelCollectorStatus: "something new", lastSeenAt: new Date() },
    ] as Array<Partial<RumApplication>>) {
      const pill: PillProps = pillOf(column, application(fields));

      expect(pill.text).not.toMatch(/connected/i);
      expect(pill.tooltip || "").not.toMatch(/disconnect/i);
      expect(pill.color.toString()).not.toBe(Red.toString());
    }
  });

  test("its pill renders the words, with the meaning on hover", async () => {
    const column: Column = await statusColumn();

    await act(async () => {
      render(
        (column.getElement as (item: RumApplication) => React.ReactElement)(
          application({
            otelCollectorStatus: "disconnected",
            lastSeenAt: new Date(),
          }),
        ),
      );
    });

    expect(screen.getByTestId("pill")).toHaveTextContent("No recent traffic");
  });
});
