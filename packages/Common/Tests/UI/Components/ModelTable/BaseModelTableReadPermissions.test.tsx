import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { ReactElement } from "react";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EnterpriseLicenseInstance from "../../../../Models/DatabaseModels/EnterpriseLicenseInstance";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<Permission> = [];
let permissionSourceForTest: "global" | "project" = "global";

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return permissionsForTest;
      },
      getGlobalPermissions: (): {
        globalPermissions: Array<Permission>;
      } => {
        return {
          globalPermissions:
            permissionSourceForTest === "global" ? permissionsForTest : [],
        };
      },
      getProjectPermissions: (): {
        permissions: Array<{ permission: Permission }>;
      } => {
        return {
          permissions:
            permissionSourceForTest === "project"
              ? permissionsForTest.map((permission: Permission) => {
                  return { permission };
                })
              : [],
        };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
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

const REPORTED_AT: string = "2026-09-17T08:00:00.000Z";
const CREATED_AT: string = "2026-08-01T10:00:00.000Z";
const MONITOR_SECRET: string = "6a57db08-2f63-48bf-ae9e-a19ecb8d3c9f";

const INSTANCE_ROW: JSONObject = {
  _id: "instance-1",
  host: "oneuptime.example.com",
  createdAt: CREATED_AT,
  lastReportedAt: REPORTED_AT,
};

const MONITOR_ROW: JSONObject = {
  _id: "monitor-1",
  name: "Checkout API",
  description: "Checks the payment service",
  serverMonitorSecretKey: MONITOR_SECRET,
};

const ACTIVITY_COLUMNS: Columns<EnterpriseLicenseInstance> = [
  {
    field: { host: true },
    title: "Host",
    type: FieldType.Text,
  },
  {
    // This is the field shape used by the enterprise license Instances table.
    field: { _id: true, createdAt: true, lastReportedAt: true },
    title: "Last Activity",
    type: FieldType.Text,
    getElement: (item: EnterpriseLicenseInstance): ReactElement => {
      return (
        <span>
          {item.lastReportedAt
            ? `Reported ${String(item.lastReportedAt)}`
            : "Never communicated"}
          {"; "}
          {item.createdAt
            ? `Created ${String(item.createdAt)}`
            : "Creation time unavailable"}
        </span>
      );
    },
  },
];

const MONITOR_COLUMNS: Columns<Monitor> = [
  {
    field: {
      name: true,
      description: true,
      serverMonitorSecretKey: true,
    },
    title: "Monitor Details",
    type: FieldType.Text,
    getElement: (item: Monitor): ReactElement => {
      return (
        <span>
          {item.name}; {item.description || "Description unavailable"};{" "}
          {item.serverMonitorSecretKey
            ? String(item.serverMonitorSecretKey)
            : "Secret unavailable"}
        </span>
      );
    },
  },
];

describe("BaseModelTable read permissions", () => {
  let selects: Array<JSONObject> = [];

  function renderTable<TModel extends BaseModel>(data: {
    modelType: new () => TModel;
    columns: Columns<TModel>;
    rows: Array<JSONObject>;
  }): ReturnType<typeof render> {
    const callbacks: BaseTableCallbacks<TModel> = {
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      getModelFromJSON: (item: JSONObject): TModel => {
        return item as unknown as TModel;
      },
      getJSONFromModel: (item: TModel): JSONObject => {
        return item as unknown as JSONObject;
      },
      addSlugToSelect: (select: unknown): unknown => {
        return select;
      },
      getList: async (request: {
        skip: number;
        limit: number;
        select: JSONObject;
      }): Promise<ListResult<TModel>> => {
        selects.push(request.select);

        return {
          /*
           * Only return requested fields, as the API does. Returning complete
           * rows would conceal the missing secondary fields behind this bug.
           */
          data: data.rows.map((row: JSONObject) => {
            const projected: JSONObject = {};

            for (const key of Object.keys(request.select)) {
              if (request.select[key] && row[key] !== undefined) {
                projected[key] = row[key];
              }
            }

            return projected as unknown as TModel;
          }),
          count: data.rows.length,
          skip: request.skip,
          limit: request.limit,
        };
      },
      toJSONArray: (): Array<JSONObject> => {
        return [];
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      showCreateEditModal: (): ReactElement => {
        return <></>;
      },
    } as unknown as BaseTableCallbacks<TModel>;

    const props: BaseModelTableProps<TModel> = {
      modelType: data.modelType,
      id: "read-permissions-table",
      name: "Records",
      columns: data.columns,
      filters: [],
      cardProps: { title: "Records" },
      isCreateable: false,
      isEditable: false,
      isDeleteable: false,
      isViewable: false,
      disableUrlState: true,
      callbacks: callbacks,
    } as unknown as BaseModelTableProps<TModel>;

    return render(<BaseModelTable<TModel> {...props} />);
  }

  async function waitForRows(): Promise<void> {
    await waitFor(() => {
      expect(selects.length).toBeGreaterThan(0);
      expect(screen.queryByText("Loading...", { exact: false })).toBeNull();
      expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
    });
  }

  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [];
    permissionSourceForTest = "global";
    selects = [];
    PermissionGate.clearPermissionPropsCache();
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test.each([
    { name: "an empty permission snapshot", permissions: [] },
    { name: "ordinary user permissions", permissions: [Permission.User] },
    {
      name: "project admin permissions",
      permissions: [Permission.ProjectAdmin],
    },
  ])(
    "selects and renders master-admin-only secondary timestamps with $name",
    async ({ permissions }: { permissions: Array<Permission> }) => {
      isMasterAdminForTest = true;
      permissionsForTest = permissions;

      renderTable({
        modelType: EnterpriseLicenseInstance,
        columns: ACTIVITY_COLUMNS,
        rows: [INSTANCE_ROW],
      });

      await waitForRows();

      expect(selects[0]).toEqual({
        _id: true,
        host: true,
        createdAt: true,
        lastReportedAt: true,
      });
      expect(
        screen.getByText(`Reported ${REPORTED_AT}; Created ${CREATED_AT}`),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Never communicated/)).toBeNull();
    },
  );

  test("keeps the never-communicated fallback when the API has no report timestamp", async () => {
    isMasterAdminForTest = true;

    renderTable({
      modelType: EnterpriseLicenseInstance,
      columns: ACTIVITY_COLUMNS,
      rows: [{ ...INSTANCE_ROW, lastReportedAt: null }],
    });

    await waitForRows();

    expect(selects[0]?.["lastReportedAt"]).toBe(true);
    expect(
      screen.getByText(`Never communicated; Created ${CREATED_AT}`),
    ).toBeInTheDocument();
  });

  test("keeps master-admin-only primary columns selected and visible", async () => {
    isMasterAdminForTest = true;

    renderTable({
      modelType: EnterpriseLicenseInstance,
      columns: [
        {
          field: { lastReportedAt: true },
          title: "Last Reported At",
          type: FieldType.Text,
        },
      ],
      rows: [INSTANCE_ROW],
    });

    await waitForRows();

    expect(selects[0]).toEqual({ _id: true, lastReportedAt: true });
    expect(screen.getByRole("columnheader")).toHaveTextContent(
      "Last Reported At",
    );
    expect(screen.getByText(REPORTED_AT)).toBeInTheDocument();
  });

  test.each([Permission.Viewer, Permission.ProjectAdmin])(
    "does not grant master-admin-only secondary fields to an ordinary %s",
    async (permission: Permission) => {
      permissionsForTest = [permission];

      renderTable({
        modelType: EnterpriseLicenseInstance,
        columns: ACTIVITY_COLUMNS,
        rows: [INSTANCE_ROW],
      });

      await waitFor(() => {
        expect(selects.length).toBeGreaterThan(0);
      });

      /*
       * The existing primary-field selection contract is unchanged; fields
       * added to compose a cell must still pass their own read check.
       */
      expect(selects[0]).toEqual({ _id: true, host: true });
      expect(screen.queryByText("Last Activity")).toBeNull();
      expect(screen.queryByText(REPORTED_AT, { exact: false })).toBeNull();
    },
  );

  test.each(["global", "project"] as const)(
    "omits a restricted secondary secret while retaining readable secondary fields from %s permissions",
    async (source: "global" | "project") => {
      permissionsForTest = [Permission.Viewer];
      permissionSourceForTest = source;

      renderTable({
        modelType: Monitor,
        columns: MONITOR_COLUMNS,
        rows: [MONITOR_ROW],
      });

      await waitForRows();

      expect(selects[0]).toEqual({
        _id: true,
        name: true,
        description: true,
      });
      expect(
        screen.getByText(
          "Checkout API; Checks the payment service; Secret unavailable",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(MONITOR_SECRET, { exact: false })).toBeNull();
    },
  );

  test.each(["global", "project"] as const)(
    "includes restricted secondary fields authorized by %s permissions",
    async (source: "global" | "project") => {
      permissionsForTest = [Permission.ProjectAdmin];
      permissionSourceForTest = source;

      renderTable({
        modelType: Monitor,
        columns: MONITOR_COLUMNS,
        rows: [MONITOR_ROW],
      });

      await waitForRows();

      expect(selects[0]).toEqual({
        _id: true,
        name: true,
        description: true,
        serverMonitorSecretKey: true,
      });
      expect(
        screen.getByText(
          `Checkout API; Checks the payment service; ${MONITOR_SECRET}`,
        ),
      ).toBeInTheDocument();
    },
  );

  test("allows a master admin to read restricted secondary fields on ordinary models", async () => {
    isMasterAdminForTest = true;

    renderTable({
      modelType: Monitor,
      columns: MONITOR_COLUMNS,
      rows: [MONITOR_ROW],
    });

    await waitForRows();

    expect(selects[0]).toEqual({
      _id: true,
      name: true,
      description: true,
      serverMonitorSecretKey: true,
    });
    expect(
      screen.getByText(
        `Checkout API; Checks the payment service; ${MONITOR_SECRET}`,
      ),
    ).toBeInTheDocument();
  });
});
