import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission, {
  ColumnKeptToLabels,
} from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import Query from "../../../../../Server/Types/Database/Query";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Runner from "../../../../../Models/DatabaseModels/Runner";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import FilterGroups, {
  FILTER_GROUPS_QUERY_KEY,
} from "../../../../../Types/BaseDatabase/FilterGroups";
import MultiSearch from "../../../../../Types/BaseDatabase/MultiSearch";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import {
  getLabelListsKeptTo,
  getLabelsKeptTo,
  withLabelJoinTables,
} from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PERMISSION NEVER TAKES AWAY WHAT THE READER READ WITHOUT IT (#11259).
 *
 * A customer's team held Viewer over the whole project and Project Member
 * on the monitors labelled X. A monitor's secret keys are read only by those
 * who may change the monitor, so the Dashboard asks for them whenever the
 * reader holds a role that may - and selecting a column read only on some
 * labels narrowed the whole read to those labels
 * (AccessControlPermission.getLabelGrantsForQuery). Every monitor outside X
 * answered "could not be found"; without the Project Member role the same
 * monitor opened read-only. A runner list that selects the key showed only
 * the labelled runners.
 *
 * Such a column is now kept to the records its grant reaches
 * (getColumnsKeptToLabels): a read by DatabaseService reads every record
 * its own grants reach and leaves the column out of the others
 * (withholdColumnsKeptToLabels), as a column kept to its owners is left out
 * (OwnedScopePermission.withholdColumnsKeptToOwners). What the column holds
 * is read no other way: a filter or a search on it still reaches only the
 * records it is read on, and an order by it is refused.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11259000-0000-4000-8000-000000000001",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "11259000-0000-4000-8000-000000000002",
);
const LABEL_X: ObjectID = new ObjectID("11259000-0000-4000-8000-0000000000a1");
const LABEL_Y: ObjectID = new ObjectID("11259000-0000-4000-8000-0000000000a2");
const TEAM_ID: ObjectID = new ObjectID("11259000-0000-4000-8000-0000000000b1");

const MONITOR_A: string = "11259000-0000-4000-8000-0000000000c1";
const MONITOR_B: string = "11259000-0000-4000-8000-0000000000c2";

const CREDENTIAL_COLUMNS: Array<string> = [
  "serverMonitorSecretKey",
  "incomingRequestSecretKey",
  "incomingEmailSecretKey",
  "incomingEmailCustomLocalPart",
];

function row(
  permission: Permission,
  data: {
    scope: PermissionScope;
    labelIds?: Array<ObjectID>;
    teamId?: ObjectID;
  },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: false,
    scope: data.scope,
    ...(data.teamId ? { teamId: data.teamId } : {}),
  };
}

function memberWith(
  rows: Array<UserPermission>,
  overrides?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
    ...(overrides || {}),
  } as DatabaseCommonInteractionProps;
}

// The customer's team, exactly: Viewer over the project, Project Member on X.
const CUSTOMER: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All }),
  row(Permission.ProjectMember, {
    scope: PermissionScope.Labels,
    labelIds: [LABEL_X],
  }),
];

// What the monitor's pages select: its name and every credential column.
const MONITOR_PAGE_SELECT: Dictionary<boolean> = {
  _id: true,
  name: true,
  ...Object.fromEntries(
    CREDENTIAL_COLUMNS.map((column: string): [string, boolean] => {
      return [column, true];
    }),
  ),
};

const keptColumns: (kept: Array<ColumnKeptToLabels>) => Array<string> = (
  kept: Array<ColumnKeptToLabels>,
): Array<string> => {
  return kept
    .map((each: ColumnKeptToLabels): string => {
      return each.column;
    })
    .sort();
};

beforeEach(() => {
  withLabelJoinTables();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which columns a caller reads on fewer records than the model", () => {
  test("the customer's monitor credentials are kept to label X", () => {
    const kept: Array<ColumnKeptToLabels> =
      AccessControlPermission.getColumnsKeptToLabels(
        Monitor,
        MONITOR_PAGE_SELECT,
        memberWith(CUSTOMER),
      );

    expect(keptColumns(kept)).toEqual([...CREDENTIAL_COLUMNS].sort());

    for (const each of kept) {
      expect(
        each.grant.labelIds.map((labelId: ObjectID): string => {
          return labelId.toString();
        }),
      ).toEqual([LABEL_X.toString()]);
      expect(each.grant.ownedTeamIds).toBeNull();
    }
  });

  test("nothing is kept for a Viewer alone: the column is not theirs to read at all", () => {
    expect(
      AccessControlPermission.getColumnsKeptToLabels(
        Monitor,
        MONITOR_PAGE_SELECT,
        memberWith([row(Permission.Viewer, { scope: PermissionScope.All })]),
      ),
    ).toEqual([]);
  });

  test("nothing is kept for a Project Member over the whole project", () => {
    expect(
      AccessControlPermission.getColumnsKeptToLabels(
        Monitor,
        MONITOR_PAGE_SELECT,
        memberWith([
          row(Permission.ProjectMember, { scope: PermissionScope.All }),
        ]),
      ),
    ).toEqual([]);
  });

  test("nothing is kept where the read keeps to the column's labels already", () => {
    expect(
      AccessControlPermission.getColumnsKeptToLabels(
        Monitor,
        MONITOR_PAGE_SELECT,
        memberWith([
          row(Permission.ProjectMember, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_X],
          }),
        ]),
      ),
    ).toEqual([]);
  });

  test("a read limited to one label and a change limited to another keeps the column to the second", () => {
    const kept: Array<ColumnKeptToLabels> =
      AccessControlPermission.getColumnsKeptToLabels(
        Monitor,
        MONITOR_PAGE_SELECT,
        memberWith([
          row(Permission.ReadProjectMonitor, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_X],
          }),
          row(Permission.EditProjectMonitor, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_Y],
          }),
        ]),
      );

    expect(keptColumns(kept)).toEqual([...CREDENTIAL_COLUMNS].sort());
    expect(kept[0]!.grant.labelIds[0]!.toString()).toBe(LABEL_Y.toString());
  });

  test("a grant scoped to Owned beside the labels keeps the column to the labels or the team's monitors", () => {
    const kept: Array<ColumnKeptToLabels> =
      AccessControlPermission.getColumnsKeptToLabels(
        Monitor,
        { _id: true, serverMonitorSecretKey: true },
        memberWith([
          ...CUSTOMER,
          row(Permission.MonitorAdmin, {
            scope: PermissionScope.Owned,
            teamId: TEAM_ID,
          }),
        ]),
      );

    expect(keptColumns(kept)).toEqual(["serverMonitorSecretKey"]);
    expect(
      (kept[0]!.grant.ownedTeamIds || []).map((teamId: ObjectID): string => {
        return teamId.toString();
      }),
    ).toEqual([TEAM_ID.toString()]);
  });

  test("a runner's key is kept to a Runbook Admin's labels beside a Viewer (the customer's runner case)", () => {
    expect(
      keptColumns(
        AccessControlPermission.getColumnsKeptToLabels(
          Runner,
          { _id: true, name: true, key: true },
          memberWith([
            row(Permission.Viewer, { scope: PermissionScope.All }),
            row(Permission.RunbookAdmin, {
              scope: PermissionScope.Labels,
              labelIds: [LABEL_X],
            }),
          ]),
        ),
      ),
    ).toEqual(["key"]);
  });

  test("a workflow's webhook key is kept to a Workflow Admin's labels beside a Viewer", () => {
    expect(
      keptColumns(
        AccessControlPermission.getColumnsKeptToLabels(
          Workflow,
          { _id: true, name: true, webhookSecretKey: true },
          memberWith([
            row(Permission.Viewer, { scope: PermissionScope.All }),
            row(Permission.WorkflowAdmin, {
              scope: PermissionScope.Labels,
              labelIds: [LABEL_X],
            }),
          ]),
        ),
      ),
    ).toEqual(["webhookSecretKey"]);
  });

  test("none for root, a master admin, a read across projects, a read with no project or no select", () => {
    for (const props of [
      { isRoot: true } as DatabaseCommonInteractionProps,
      memberWith(CUSTOMER, { isMasterAdmin: true }),
      memberWith(CUSTOMER, { isMultiTenantRequest: true }),
      memberWith(CUSTOMER, { tenantId: undefined }),
    ]) {
      expect(
        AccessControlPermission.getColumnsKeptToLabels(
          Monitor,
          MONITOR_PAGE_SELECT,
          props,
        ),
      ).toEqual([]);
    }

    expect(
      AccessControlPermission.getColumnsKeptToLabels(
        Monitor,
        null,
        memberWith(CUSTOMER),
      ),
    ).toEqual([]);
  });

  test("a relation's columns are not the model's to keep", () => {
    expect(
      AccessControlPermission.getColumnsKeptToLabels(
        Monitor,
        { _id: true, labels: { _id: true, name: true } } as Dictionary<unknown>,
        memberWith(CUSTOMER),
      ),
    ).toEqual([]);
  });
});

describe("a read that withholds the columns is not narrowed by selecting them", () => {
  const scope: (data: {
    query?: Query<Monitor>;
    select: Dictionary<unknown>;
    withheld?: Array<string>;
    rows?: Array<UserPermission>;
  }) => Promise<Dictionary<unknown>> = async (data: {
    query?: Query<Monitor>;
    select: Dictionary<unknown>;
    withheld?: Array<string>;
    rows?: Array<UserPermission>;
  }): Promise<Dictionary<unknown>> => {
    return (await BasePermission.addRecordScopeToQuery(
      Monitor,
      data.query || {},
      data.select as never,
      memberWith(data.rows || CUSTOMER),
      DatabaseRequestType.Read,
      data.withheld ? { columnsWithheldPerRecord: data.withheld } : undefined,
    )) as Dictionary<unknown>;
  };

  test("the customer's monitor read reaches every monitor when the keys are withheld", async () => {
    const query: Dictionary<unknown> = await scope({
      select: MONITOR_PAGE_SELECT,
      withheld: CREDENTIAL_COLUMNS,
    });

    expect(getLabelsKeptTo(Monitor, query)).toEqual([]);
  });

  test("a read that does not withhold them narrows by them as before - every other reader of the rule", async () => {
    const query: Dictionary<unknown> = await scope({
      select: MONITOR_PAGE_SELECT,
    });

    expect(getLabelsKeptTo(Monitor, query)).toEqual([LABEL_X.toString()]);
  });

  test("a filter on a withheld column still keeps the read to its labels", async () => {
    const query: Dictionary<unknown> = await scope({
      query: { serverMonitorSecretKey: "a guess" } as Query<Monitor>,
      select: MONITOR_PAGE_SELECT,
      withheld: CREDENTIAL_COLUMNS,
    });

    expect(getLabelsKeptTo(Monitor, query)).toEqual([LABEL_X.toString()]);
  });

  test("a free-text search across a kept column keeps the read to its labels", async () => {
    const query: Dictionary<unknown> = await scope({
      query: {
        _multiFieldSearch: new MultiSearch({
          fields: ["name", "incomingEmailCustomLocalPart"],
          value: "billing",
        }),
      } as unknown as Query<Monitor>,
      select: { _id: true, name: true },
    });

    expect(getLabelsKeptTo(Monitor, query)).toEqual([LABEL_X.toString()]);
  });

  test("a search across columns every reader reads is left alone", async () => {
    const query: Dictionary<unknown> = await scope({
      query: {
        _multiFieldSearch: new MultiSearch({
          fields: ["name", "description"],
          value: "billing",
        }),
      } as unknown as Query<Monitor>,
      select: { _id: true, name: true },
    });

    expect(getLabelsKeptTo(Monitor, query)).toEqual([]);
  });

  test("a filter group that compares a kept column keeps the read to its labels", async () => {
    const groups: FilterGroups = new FilterGroups({
      groups: [{ incomingEmailCustomLocalPart: "billing" }],
    });

    expect(groups.columns).toEqual(["incomingEmailCustomLocalPart"]);

    const query: Dictionary<unknown> = await scope({
      query: {
        [FILTER_GROUPS_QUERY_KEY]: groups,
      } as unknown as Query<Monitor>,
      select: { _id: true, name: true },
    });

    expect(getLabelsKeptTo(Monitor, query)).toEqual([LABEL_X.toString()]);
  });

  test("an update is narrowed by its own grants, whatever a read withholds", async () => {
    const query: Dictionary<unknown> =
      (await BasePermission.addRecordScopeToQuery(
        Monitor,
        {},
        null,
        memberWith(CUSTOMER),
        DatabaseRequestType.Update,
        { columnsWithheldPerRecord: CREDENTIAL_COLUMNS },
      )) as Dictionary<unknown>;

    expect(getLabelListsKeptTo(Monitor, query)).toEqual([[LABEL_X.toString()]]);
  });
});

describe("getSelectNarrowingRead", () => {
  test("leaves the withheld columns out, but a filtered one in, and never changes the select", () => {
    const select: Dictionary<unknown> = {
      _id: true,
      name: true,
      serverMonitorSecretKey: true,
      incomingRequestSecretKey: true,
    };

    const narrowing: Dictionary<unknown> | null =
      AccessControlPermission.getSelectNarrowingRead(
        select as never,
        { incomingRequestSecretKey: "x" } as Query<Monitor>,
        ["serverMonitorSecretKey", "incomingRequestSecretKey"],
      ) as Dictionary<unknown> | null;

    expect(narrowing).toEqual({
      _id: true,
      name: true,
      incomingRequestSecretKey: true,
    });
    expect(Object.keys(select)).toHaveLength(4);
  });

  test("hands the select back as it is with nothing to withhold", () => {
    const select: Dictionary<unknown> = { _id: true };

    expect(
      AccessControlPermission.getSelectNarrowingRead(select as never, {}, []),
    ).toBe(select);
  });
});

describe("withholdColumnsKeptToLabels", () => {
  const monitorWithKeys: (id: string) => Monitor = (id: string): Monitor => {
    const monitor: Monitor = new Monitor();
    monitor._id = id;
    monitor.name = id;
    monitor.serverMonitorSecretKey = new ObjectID(
      "11259000-0000-4000-8000-0000000000d1",
    );
    monitor.incomingRequestSecretKey = new ObjectID(
      "11259000-0000-4000-8000-0000000000d2",
    );
    return monitor;
  };

  test("the keys stay on the monitor labelled X and leave monitor B, which is read all the same", async () => {
    const rows: Array<Monitor> = [
      monitorWithKeys(MONITOR_A),
      monitorWithKeys(MONITOR_B),
    ];
    const asked: Array<Dictionary<unknown>> = [];

    await AccessControlPermission.withholdColumnsKeptToLabels({
      modelType: Monitor,
      rows: rows,
      kept: AccessControlPermission.getColumnsKeptToLabels(
        Monitor,
        MONITOR_PAGE_SELECT,
        memberWith(CUSTOMER),
      ),
      props: memberWith(CUSTOMER),
      findIds: async (query: Query<Monitor>): Promise<Array<string>> => {
        asked.push(query as Dictionary<unknown>);
        // Only A carries label X.
        return [MONITOR_A];
      },
    });

    // One lookup for all four columns: they share one grant.
    expect(asked).toHaveLength(1);
    expect(getLabelsKeptTo(Monitor, asked[0])).toEqual([LABEL_X.toString()]);

    expect(
      rows.map((monitor: Monitor) => {
        return [
          monitor._id,
          monitor.name,
          Boolean(monitor.serverMonitorSecretKey),
          Boolean(monitor.incomingRequestSecretKey),
        ];
      }),
    ).toEqual([
      [MONITOR_A, MONITOR_A, true, true],
      [MONITOR_B, MONITOR_B, false, false],
    ]);
  });

  test("a row read without its id is left without the columns", async () => {
    const monitor: Monitor = monitorWithKeys(MONITOR_A);
    monitor._id = undefined as unknown as string;

    await AccessControlPermission.withholdColumnsKeptToLabels({
      modelType: Monitor,
      rows: [monitor],
      kept: [
        {
          column: "serverMonitorSecretKey",
          grant: { labelIds: [LABEL_X], ownedTeamIds: null },
        },
      ],
      props: memberWith(CUSTOMER),
      findIds: async (): Promise<Array<string>> => {
        return [MONITOR_A];
      },
    });

    expect(monitor.serverMonitorSecretKey).toBeUndefined();
  });

  test("nothing is looked up with nothing kept, or no rows", async () => {
    const findIds: jest.Mock<() => Promise<Array<string>>> = jest.fn(
      async (): Promise<Array<string>> => {
        return [];
      },
    );

    await AccessControlPermission.withholdColumnsKeptToLabels({
      modelType: Monitor,
      rows: [monitorWithKeys(MONITOR_A)],
      kept: [],
      props: memberWith(CUSTOMER),
      findIds: findIds,
    });

    await AccessControlPermission.withholdColumnsKeptToLabels({
      modelType: Monitor,
      rows: [],
      kept: [
        {
          column: "serverMonitorSecretKey",
          grant: { labelIds: [LABEL_X], ownedTeamIds: null },
        },
      ],
      props: memberWith(CUSTOMER),
      findIds: findIds,
    });

    expect(findIds).not.toHaveBeenCalled();
  });
});

describe("an order by a column kept to labels is refused", () => {
  test("ordering the customer's monitors by a secret key says why", () => {
    let refusal: unknown = null;

    try {
      AccessControlPermission.checkSortOnColumnsKeptToLabels(
        Monitor,
        { serverMonitorSecretKey: "ASC" },
        memberWith(CUSTOMER),
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(
      "Your access lets you read the Server Monitor Secret Key only of the Monitors carrying some labels, so you cannot sort Monitors by it.",
    );
  });

  test("an order by a column every reader reads, or through a relation, is left alone", () => {
    expect(() => {
      AccessControlPermission.checkSortOnColumnsKeptToLabels(
        Monitor,
        { name: "ASC", createdAt: "DESC", project: { name: "ASC" } },
        memberWith(CUSTOMER),
      );
    }).not.toThrow();
  });

  test("a reader who reads the keys on every monitor may order by them", () => {
    expect(() => {
      AccessControlPermission.checkSortOnColumnsKeptToLabels(
        Monitor,
        { serverMonitorSecretKey: "ASC" },
        memberWith([
          row(Permission.ProjectMember, { scope: PermissionScope.All }),
        ]),
      );
    }).not.toThrow();
  });
});
