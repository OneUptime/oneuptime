import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

configure({ asyncUtilTimeout: 15000 });

/*
 * A RECORD'S PARTS ARE LOCKED BY THE RECORD'S LABELS AND OWNERS, SAYING WHY
 * (#11435).
 *
 * A monitor's owners and its probes carry the monitor's labels and take its
 * owners: the server weighs adding or removing one against them. For the
 * customer's team - Viewer over the project, Project Member on the monitors
 * labelled Production - monitor B (no labels) showed Add owner and each
 * owner's remove button, and the server refused them after the click. On a
 * record's page every part's gate now takes what the record's labels and
 * owners leave of it (ModelPage's scope, PermissionGate.getPartLock):
 *
 *   - B's Owners card: Add owner locked - "You do not have permission to
 *     add owners. Your permission is limited to monitors labelled
 *     Production." - and no remove button; A's: as before;
 *   - for a Monitor Admin of what their team owns, the same on a monitor
 *     nobody of theirs owns: "... limited to monitors you or your teams
 *     own.";
 *   - B's probes list: a probe names its own probe, which may carry the
 *     label, so a grant limited to labels is left to the server; a team's
 *     block on the monitor's label, and a grant scoped to Owned, lock it;
 *   - a list of probes not kept to the page's monitor is weighed by none of
 *     this.
 */

let deletedIds: Array<string> = [];
const ownershipAsks: Array<Array<string>> = [];
let ownedBy: Record<string, { isOwnedByCaller: boolean; teamIds: Array<string> }> =
  {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: unknown;
        id: { toString: () => string };
      }): Promise<unknown> => {
        return fakeApi.getItem(data.modelType, data.id.toString());
      },
      getList: async (data: {
        modelType: unknown;
        skip?: number;
        limit?: number;
      }): Promise<unknown> => {
        const rows: Array<unknown> = fakeApi.getList(data.modelType);
        return {
          data: rows,
          count: rows.length,
          skip: data.skip || 0,
          limit: data.limit || 10,
        };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (data: {
        id: { toString: () => string };
      }): Promise<void> => {
        deletedIds.push(data.id.toString());
      },
      create: async (): Promise<void> => {
        // not exercised
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import OwnersCard from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard";
import ModelPage from "../../../UI/Components/Page/ModelPage";
import ModelTable from "../../../UI/Components/ModelTable/ModelTable";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import API from "../../../UI/Utils/API/API";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import PermissionUtil from "../../../UI/Utils/Permission";
import { clearLabelNames } from "../../../UI/Utils/RecordLabelLock";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import UniqueNamesApi from "../../../UI/Utils/UniqueNamesApi";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import Probe from "../../../Models/DatabaseModels/Probe";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";

const PROJECT_ID: string = "11435000-0000-4000-8000-000000000301";
const LABEL_ID: string = "11435000-0000-4000-8000-0000000003a1";
const SUPPORT_TEAM: string = "11435000-0000-4000-8000-0000000003b1";
const MONITOR_A: string = "11435000-0000-4000-8000-0000000003c1";
const MONITOR_B: string = "11435000-0000-4000-8000-0000000003c2";
const SUPPORTS: string = "11435000-0000-4000-8000-0000000003c3";
const BEN: string = "11435000-0000-4000-8000-0000000003d1";
const OWNER_ROW: string = "11435000-0000-4000-8000-0000000003e1";
const PROBE_ROW: string = "11435000-0000-4000-8000-0000000003f1";

const LIMITED_TO_LABEL: string =
  "Your permission is limited to monitors labelled Production.";
const LIMITED_TO_OWNED: string =
  "Your permission is limited to monitors you or your teams own.";
const BLOCKED: string =
  "A team you are on blocks this on monitors labelled Production.";

const label: () => Label = (): Label => {
  const value: Label = new Label();
  value._id = LABEL_ID;
  value.name = "Production";
  return value;
};

const monitor: (id: string) => Monitor = (id: string): Monitor => {
  const value: Monitor = new Monitor();
  value._id = id;
  value.name =
    id === MONITOR_A ? "Website A" : id === SUPPORTS ? "Support's" : "Website B";
  value.labels = id === MONITOR_A ? [label()] : [];
  return value;
};

const ownerRow: () => MonitorOwnerUser = (): MonitorOwnerUser => {
  const user: User = new User();
  user._id = BEN;
  user.name = new Name("Ben Ito");
  user.email = new Email("ben@example.com");

  const row: MonitorOwnerUser = new MonitorOwnerUser();
  row._id = OWNER_ROW;
  row.user = user;
  return row;
};

const probeRow: () => MonitorProbe = (): MonitorProbe => {
  const probe: Probe = new Probe();
  probe._id = "11435000-0000-4000-8000-0000000003f2";
  probe.name = "Frankfurt";

  const row: MonitorProbe = new MonitorProbe();
  row._id = PROBE_ROW;
  row.probe = probe;
  return row;
};

const fakeApi: {
  getItem: (modelType: unknown, id: string) => unknown;
  getList: (modelType: unknown) => Array<unknown>;
} = {
  getItem: (modelType: unknown, id: string): unknown => {
    return modelType === Monitor ? monitor(id.toLowerCase()) : null;
  },
  getList: (modelType: unknown): Array<unknown> => {
    if (modelType === Label) {
      return [label()];
    }

    if (modelType === MonitorOwnerUser) {
      return [ownerRow()];
    }

    if (modelType === MonitorProbe) {
      return [probeRow()];
    }

    return [];
  },
};

const row: (
  permission: Permission,
  options?: {
    labelIds?: Array<string>;
    scope?: PermissionScope;
    isBlock?: boolean;
  },
) => UserPermission = (
  permission: Permission,
  options?: { labelIds?: Array<string>; scope?: PermissionScope; isBlock?: boolean },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (options?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: Boolean(options?.isBlock),
    ...(options?.scope ? { scope: options.scope } : {}),
    teamId: new ObjectID(SUPPORT_TEAM),
  };
};

const CUSTOMER: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All }),
  row(Permission.ProjectMember, {
    scope: PermissionScope.Labels,
    labelIds: [LABEL_ID],
  }),
];

const OWNED_ADMIN: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All }),
  row(Permission.MonitorAdmin, { scope: PermissionScope.Owned }),
];

const signInAs: (rows: Array<UserPermission>) => void = (
  rows: Array<UserPermission>,
): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [Permission.Public, Permission.User, Permission.CurrentUser],
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [row(Permission.ProjectUser), ...rows],
  });
};

// What the server says the monitor's owners decide, and who owns each.
const ownershipJson: (ids: Array<string>) => JSONObject = (
  ids: Array<string>,
): JSONObject => {
  const records: JSONObject = {};

  for (const id of ids) {
    records[id.toLowerCase()] = ownedBy[id.toLowerCase()] || {
      isOwnedByCaller: false,
      teamIds: [],
    };
  }

  return {
    tableName: "Monitor",
    tables: [
      { tableName: "Monitor", key: "_id", operations: ["read", "update", "delete"] },
      {
        tableName: "MonitorOwnerUser",
        key: "monitorId",
        operations: ["create", "update", "delete"],
      },
      {
        tableName: "MonitorOwnerTeam",
        key: "monitorId",
        operations: ["create", "update", "delete"],
      },
      {
        tableName: "MonitorProbe",
        key: "monitorId",
        operations: ["create", "read", "update", "delete"],
      },
    ],
    records: records,
  };
};

const pageOf: (id: string, children: ReactElement) => ReactElement = (
  id: string,
  children: ReactElement,
): ReactElement => {
  return (
    <ModelPage
      title="Monitor"
      modelType={Monitor}
      modelId={new ObjectID(id)}
      modelNameField="name"
    >
      {children}
    </ModelPage>
  );
};

const ownersOf: (id: string) => ReactElement = (id: string): ReactElement => {
  return (
    <OwnersCard<MonitorOwnerUser, MonitorOwnerTeam>
      resourceId={new ObjectID(id)}
      resourceIdField="monitorId"
      resourceDisplayName="monitor"
      ownerUserModelType={MonitorOwnerUser}
      ownerTeamModelType={MonitorOwnerTeam}
    />
  );
};

const probesOf: (data: {
  id: string;
  isKeptToMonitor?: boolean;
}) => ReactElement = (data: {
  id: string;
  isKeptToMonitor?: boolean;
}): ReactElement => {
  return (
    <ModelTable<MonitorProbe>
      modelType={MonitorProbe}
      id={`monitor-probes-${data.id}`}
      name="Probes"
      userPreferencesKey={`monitor-probes-${data.id}`}
      urlStateKey={`monitor-probes-${data.id}`}
      query={
        data.isKeptToMonitor === false
          ? { projectId: new ObjectID(PROJECT_ID) }
          : { projectId: new ObjectID(PROJECT_ID), monitorId: data.id }
      }
      columns={[
        {
          field: { probe: { name: true } },
          title: "Probe",
          type: FieldType.Element,
          getElement: (item: MonitorProbe): ReactElement => {
            return <span>{item.probe?.name}</span>;
          },
        },
      ]}
      filters={[]}
      cardProps={{ title: "Probes", description: "Where this monitor checks from." }}
      isDeleteable={true}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      formFields={[
        {
          field: { probe: true },
          title: "Probe",
          fieldType: FormFieldSchemaType.Dropdown,
        },
      ]}
    />
  );
};

const answered: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const reasonOf: (item: HTMLElement) => string | null = (
  item: HTMLElement,
): string | null => {
  const describedBy: string | null = item.getAttribute("aria-describedby");
  return describedBy ? document.getElementById(describedBy)?.textContent || null : null;
};

/*
 * The Delete of the probes list's row - on the row itself when it is the
 * row's one action, else in its ⋯ menu - and whether it is locked, and why.
 */
const probeDelete: () => Promise<{
  isLocked: boolean;
  reason: string | null;
}> = async (): Promise<{ isLocked: boolean; reason: string | null }> => {
  let tableRow: HTMLElement | null = null;

  await waitFor(() => {
    tableRow = screen.getByText("Frankfurt").closest("tr");
    expect(tableRow).not.toBeNull();
  });

  const more: HTMLElement | null = within(tableRow!).queryByTestId(
    "row-actions-more-button",
  );

  if (more) {
    fireEvent.click(more);

    const item: HTMLElement = within(screen.getByRole("menu")).getByRole(
      "menuitem",
      { name: "Delete" },
    );

    return {
      isLocked: item.getAttribute("aria-disabled") === "true",
      reason: reasonOf(item),
    };
  }

  const button: HTMLButtonElement = within(tableRow!).getByRole("button", {
    name: "Delete",
  }) as HTMLButtonElement;

  if (!button.disabled) {
    return { isLocked: false, reason: null };
  }

  fireEvent.mouseEnter(button.parentElement as HTMLElement);

  return {
    isLocked: true,
    reason: (await screen.findByRole("tooltip")).textContent || null,
  };
};

// The Owners card's Add owner: its locked wrapper, or the live button.
const addOwner: () => Promise<HTMLElement> = async (): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(
      screen.queryByTestId("owners-add-locked") ||
        screen.queryByTestId("owners-add-circle") ||
        screen.queryByTestId("owners-add"),
    ).not.toBeNull();
  });

  return (screen.queryByTestId("owners-add-locked") ||
    screen.queryByTestId("owners-add-circle") ||
    screen.queryByTestId("owners-add"))!;
};

const tooltipOf: (element: HTMLElement) => Promise<string> = async (
  element: HTMLElement,
): Promise<string> => {
  fireEvent.mouseEnter(element);

  return (await screen.findByRole("tooltip")).textContent || "";
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  PermissionGate.clearPermissionPropsCache();
  clearLabelNames();
  deletedIds = [];
  ownershipAsks.length = 0;
  ownedBy = {
    [SUPPORTS]: { isOwnedByCaller: false, teamIds: [SUPPORT_TEAM] },
  };

  jest.spyOn(UniqueNamesApi, "readSharedNames").mockResolvedValue({
    groups: [],
    createdAt: {},
  });

  jest.spyOn(API, "post").mockImplementation((async (data: {
    data: { ids: Array<string> };
  }) => {
    ownershipAsks.push([...data.data.ids]);
    return new HTTPResponse<JSONObject>(200, ownershipJson(data.data.ids), {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a monitor's Owners card, for the customer's team", () => {
  test("on B, Add owner is locked, saying the permission is limited to Production, and no owner can be removed", async () => {
    signInAs(CUSTOMER);
    render(pageOf(MONITOR_B, ownersOf(MONITOR_B)));
    await screen.findByText(/1 person/);

    const add: HTMLElement = await addOwner();
    expect(add).toHaveAttribute("data-testid", "owners-add-locked");
    expect(await tooltipOf(add)).toBe(
      `You do not have permission to add owners. ${LIMITED_TO_LABEL}`,
    );

    expect(screen.queryByRole("button", { name: "Remove Ben Ito" })).toBeNull();

    // The customer holds no grant scoped to Owned: nothing asks who owns B.
    expect(ownershipAsks).toEqual([]);
  });

  test("on A, labelled Production, owners are added and removed as before", async () => {
    signInAs(CUSTOMER);
    render(pageOf(MONITOR_A, ownersOf(MONITOR_A)));
    await screen.findByText(/1 person/);

    expect(await addOwner()).toHaveAttribute("data-testid", "owners-add-circle");
    expect(screen.getByRole("button", { name: "Remove Ben Ito" })).toBeInTheDocument();
  });

  test("a Project Member over the whole project adds and removes owners on B, as before", async () => {
    signInAs([row(Permission.ProjectMember, { scope: PermissionScope.All })]);
    render(pageOf(MONITOR_B, ownersOf(MONITOR_B)));
    await screen.findByText(/1 person/);

    expect(await addOwner()).toHaveAttribute("data-testid", "owners-add-circle");
    expect(screen.getByRole("button", { name: "Remove Ben Ito" })).toBeInTheDocument();
  });
});

describe("a monitor's Owners card, for a Monitor Admin of what their team owns", () => {
  test("on a monitor nobody of theirs owns, Add owner is locked, saying so", async () => {
    signInAs(OWNED_ADMIN);
    render(pageOf(MONITOR_B, ownersOf(MONITOR_B)));
    await screen.findByText(/1 person/);
    await answered();

    expect(ownershipAsks).toEqual([[MONITOR_B]]);

    const add: HTMLElement = await addOwner();
    expect(add).toHaveAttribute("data-testid", "owners-add-locked");
    expect(await tooltipOf(add)).toBe(
      `You do not have permission to add owners. ${LIMITED_TO_OWNED}`,
    );
    expect(screen.queryByRole("button", { name: "Remove Ben Ito" })).toBeNull();
  });

  test("on a monitor their team owns, owners are added and removed", async () => {
    signInAs(OWNED_ADMIN);
    render(pageOf(SUPPORTS, ownersOf(SUPPORTS)));
    await screen.findByText(/1 person/);
    await answered();

    expect(await addOwner()).toHaveAttribute("data-testid", "owners-add-circle");
    expect(screen.getByRole("button", { name: "Remove Ben Ito" })).toBeInTheDocument();
  });
});

describe("a monitor's probes list", () => {
  test("a grant limited to labels is left to the server: a probe may carry the label", async () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_ID],
      }),
    ]);
    render(pageOf(MONITOR_B, probesOf({ id: MONITOR_B })));

    expect(await probeDelete()).toEqual({ isLocked: false, reason: null });
  });

  test("a team's block on the monitor's label takes its probes' Delete away, saying why", async () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, { isBlock: true, labelIds: [LABEL_ID] }),
    ]);
    render(pageOf(MONITOR_A, probesOf({ id: MONITOR_A })));

    expect(await probeDelete()).toEqual({
      isLocked: true,
      reason: `You do not have permission to delete this Monitor Probe. ${BLOCKED}`,
    });
  });

  test("the same block leaves the probes of a monitor without the label alone", async () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, { isBlock: true, labelIds: [LABEL_ID] }),
    ]);
    render(pageOf(MONITOR_B, probesOf({ id: MONITOR_B })));

    expect(await probeDelete()).toEqual({ isLocked: false, reason: null });
  });

  test("probes of what their team owns: locked on a monitor nobody of theirs owns", async () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, { scope: PermissionScope.Owned }),
    ]);
    render(pageOf(MONITOR_B, probesOf({ id: MONITOR_B })));
    await screen.findByText("Frankfurt");
    await answered();

    expect(await probeDelete()).toEqual({
      isLocked: true,
      reason: `You do not have permission to delete this Monitor Probe. ${LIMITED_TO_OWNED}`,
    });
  });

  test("probes of what their team owns: offered on a monitor it owns", async () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, { scope: PermissionScope.Owned }),
    ]);
    render(pageOf(SUPPORTS, probesOf({ id: SUPPORTS })));
    await screen.findByText("Frankfurt");
    await answered();

    expect(await probeDelete()).toEqual({ isLocked: false, reason: null });
  });

  test("a list of probes not kept to the page's monitor is not weighed by it", async () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, { isBlock: true, labelIds: [LABEL_ID] }),
    ]);
    render(pageOf(MONITOR_A, probesOf({ id: MONITOR_A, isKeptToMonitor: false })));

    expect(await probeDelete()).toEqual({ isLocked: false, reason: null });
  });
});
