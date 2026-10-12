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
import Select from "../../../../Types/BaseDatabase/Select";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Probe from "../../../../Models/DatabaseModels/Probe";
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

/*
 * A TABLE ASKS FOR THE EXTRA FIELDS A VIEWER MAY READ, AND NO OTHERS.
 *
 * A table's selectMoreFields are fields its cells and actions read besides
 * its columns - a probe's key for the "Show ID and Key" action, say. The
 * API refuses the whole list for one column the caller may not read
 * (SelectPermission), so asking every viewer for a key only owners and
 * admins read blanked the table for everyone else. getSelect now leaves out
 * the extra fields this viewer may not read, by the rule every select
 * follows (PermissionGate.canReadColumn).
 */

const PROBE_ROW: JSONObject = {
  _id: "probe-1",
  name: "Office probe",
  key: "probe-key-value",
  iconFileId: "icon-1",
};

const PROBE_COLUMNS: Columns<Probe> = [
  {
    field: { name: true },
    title: "Name",
    type: FieldType.Text,
  },
];

const PROVIDER_ROW: JSONObject = {
  _id: "provider-1",
  name: "Project provider",
  apiKey: "sk-value",
  additionalParams: { temperature: 0.2 },
  hasAdditionalParams: true,
};

const PROVIDER_COLUMNS: Columns<LlmProvider> = [
  {
    field: { name: true },
    title: "Name",
    type: FieldType.Text,
  },
];

describe("BaseModelTable extra fields and read permissions", () => {
  let selects: Array<JSONObject> = [];

  function renderTable<TModel extends BaseModel>(data: {
    modelType: new () => TModel;
    columns: Columns<TModel>;
    rows: Array<JSONObject>;
    selectMoreFields: Select<TModel>;
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
      id: "extra-fields-table",
      name: "Records",
      columns: data.columns,
      filters: [],
      cardProps: { title: "Records" },
      isCreateable: false,
      isEditable: false,
      isDeleteable: false,
      isViewable: false,
      disableUrlState: true,
      selectMoreFields: data.selectMoreFields,
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
    permissionSourceForTest = "project";
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
    Permission.MonitorViewer,
    Permission.SettingsAdmin,
    Permission.Viewer,
  ])(
    "a member holding %s is not asked for a probe's key, and the table loads",
    async (permission: Permission) => {
      permissionsForTest = [permission];

      renderTable({
        modelType: Probe,
        columns: PROBE_COLUMNS,
        rows: [PROBE_ROW],
        selectMoreFields: { key: true, iconFileId: true },
      });

      await waitForRows();

      expect(selects[0]?.["key"]).toBeUndefined();
      expect(selects[0]?.["iconFileId"]).toBe(true);
      expect(screen.getByText("Office probe")).toBeInTheDocument();
    },
  );

  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "a member holding %s is still asked for a probe's key",
    async (permission: Permission) => {
      permissionsForTest = [permission];

      renderTable({
        modelType: Probe,
        columns: PROBE_COLUMNS,
        rows: [PROBE_ROW],
        selectMoreFields: { key: true, iconFileId: true },
      });

      await waitForRows();

      expect(selects[0]?.["key"]).toBe(true);
    },
  );

  test("a settings viewer is asked for whether parameters are saved, not for them or the key", async () => {
    permissionsForTest = [Permission.SettingsViewer];

    renderTable({
      modelType: LlmProvider,
      columns: PROVIDER_COLUMNS,
      rows: [PROVIDER_ROW],
      selectMoreFields: {
        apiKey: true,
        additionalParams: true,
        hasAdditionalParams: true,
      },
    });

    await waitForRows();

    expect(selects[0]?.["apiKey"]).toBeUndefined();
    expect(selects[0]?.["additionalParams"]).toBeUndefined();
    expect(selects[0]?.["hasAdditionalParams"]).toBe(true);
  });

  /*
   * Until the permission snapshot has landed - the first paint after a login
   * or a project switch - nothing tells a field the viewer may not read from
   * one they may, so every extra field is asked for, as it always was, and
   * the server decides: a drag-ordered table's order field is never left out
   * on a guess.
   */
  test("before the permission snapshot lands, every extra field is asked for", async () => {
    permissionsForTest = [];

    renderTable({
      modelType: Probe,
      columns: PROBE_COLUMNS,
      rows: [PROBE_ROW],
      selectMoreFields: { key: true, iconFileId: true },
    });

    await waitFor(() => {
      expect(selects.length).toBeGreaterThan(0);
    });

    expect(selects[0]?.["key"]).toBe(true);
    expect(selects[0]?.["iconFileId"]).toBe(true);
  });

  test("a server admin is asked for every extra field", async () => {
    isMasterAdminForTest = true;

    renderTable({
      modelType: Probe,
      columns: PROBE_COLUMNS,
      rows: [PROBE_ROW],
      selectMoreFields: { key: true },
    });

    await waitForRows();

    expect(selects[0]?.["key"]).toBe(true);
  });
});
