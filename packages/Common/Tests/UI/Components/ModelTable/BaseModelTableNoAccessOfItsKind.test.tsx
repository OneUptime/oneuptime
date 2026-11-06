import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
 * The Probes list, for someone who may read none of it (#5485's
 * follow-up): its no-access state named the 22 permissions of its read
 * list - every monitor's, network device's, discovery scan's, network
 * site's and vCenter's that let a picker show probes - and now names the
 * one to ask for, Read Probe (PermissionGate.getReadPermissionsOfItsKind).
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
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Probe from "../../../../Models/DatabaseModels/Probe";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const TABLE_ID: string = "probes-table";

let listCalls: number = 0;

const makeProps: () => BaseModelTableProps<Probe> =
  (): BaseModelTableProps<Probe> => {
    const callbacks: BaseTableCallbacks<Probe> = {
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      getModelFromJSON: (item: JSONObject): Probe => {
        return item as unknown as Probe;
      },
      getJSONFromModel: (item: Probe): JSONObject => {
        return item as unknown as JSONObject;
      },
      addSlugToSelect: (select: unknown): unknown => {
        return select;
      },
      getList: async (data: {
        skip: number;
        limit: number;
      }): Promise<ListResult<Probe>> => {
        listCalls++;

        return {
          data: [],
          count: 0,
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
    } as unknown as BaseTableCallbacks<Probe>;

    return {
      modelType: Probe,
      id: TABLE_ID,
      name: "Probes",
      singularName: "Probe",
      pluralName: "Probes",
      userPreferencesKey: TABLE_ID,
      urlStateKey: TABLE_ID,
      columns: [
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.LongText,
        },
      ],
      filters: [],
      searchableFields: ["name"],
      cardProps: {
        title: "Custom Probes",
        description: "Probes your team runs in its own network.",
      },
      isCreateable: true,
      isEditable: true,
      isDeleteable: true,
      isViewable: false,
      callbacks: callbacks,
    } as unknown as BaseModelTableProps<Probe>;
  };

beforeEach(() => {
  permissionsForTest = [];
  listCalls = 0;
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/probes");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Probes list, for someone who may read none of it", () => {
  test("names Read Probe, then who to ask - not the 22 permissions that read probes", async () => {
    // Holds something, so the snapshot has landed - but nothing that reads a probe.
    permissionsForTest = [Permission.ReadProjectIncident];

    render(<BaseModelTable<Probe> {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId(`${TABLE_ID}-no-access`)).toBeInTheDocument();
    });

    const block: HTMLElement = screen.getByTestId(`${TABLE_ID}-no-access`);

    expect(block).toHaveTextContent(
      "You need this permission: Read Probe. Ask a project admin for access.",
    );
    expect(block).not.toHaveTextContent("one of these permissions");
    for (const other of [
      "Create Monitor",
      "Read Network Device",
      "Read vCenter",
      "Read All Operational Resources",
    ]) {
      expect(block).not.toHaveTextContent(other);
    }
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("while someone who may create monitors - and so pick a probe - reads the list", async () => {
    permissionsForTest = [Permission.CreateProjectMonitor];

    render(<BaseModelTable<Probe> {...makeProps()} />);

    await waitFor(() => {
      expect(listCalls).toBeGreaterThan(0);
    });

    expect(screen.queryByTestId(`${TABLE_ID}-no-access`)).toBeNull();
  });
});
