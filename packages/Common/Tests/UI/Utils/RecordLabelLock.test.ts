import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission from "../../../Server/Types/Database/Permissions/AccessControlPermission";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Runner from "../../../Models/DatabaseModels/Runner";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import {
  LabelRefusal,
  LabelVerdict,
} from "../../../Types/LabelAccess/LabelAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import RecordLocks, { ModelLabelLock } from "../../../UI/Utils/RecordLocks";
import PermissionUtil from "../../../UI/Utils/Permission";
import {
  RecordAccessScope,
  getRecordAccessGateOptions,
} from "../../../UI/Utils/RecordAccessScope";
import {
  clearLabelNames,
  getKnownLabelNames,
  getLabelRefusalSentence,
  getRecordLabelAccessScope,
  getRecordLabelIds,
  getRecordLabelRefusal,
  mergeRecordAccessScopes,
  readLabelNames,
} from "../../../UI/Utils/RecordLabelLock";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";
import { getJestSpyOn } from "../../Spy";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";

/*
 * THE DASHBOARD LOCKS A RECORD'S CHANGES BY THE RULE THE SERVER REFUSES THEM
 * BY (#11259).
 *
 * The customer's team held Viewer over the whole project and Project Member
 * on the monitors labelled X. The Dashboard asked only whether the reader
 * held Delete Monitor somewhere, so monitor B - no labels - showed Delete
 * active, and confirming it failed: "You do not have permission to delete
 * Monitor without any labels." The Dashboard now reads the reader's rows
 * into the reach of their read, update and delete (PermissionGate
 * .getLabelLock) and weighs each record's labels by the very function the
 * server's one-record check decides with (Types/LabelAccess). The last
 * describe holds the two together: for a matrix of grants, blocks and
 * records, the Dashboard locks exactly what AccessControlPermission
 * .checkRecordByModel refuses.
 */

const PROJECT_ID: string = "11259000-0000-4000-8000-000000000101";
const USER_ID: string = "11259000-0000-4000-8000-000000000102";
const LABEL_X: string = "11259000-0000-4000-8000-0000000001a1";
const LABEL_Y: string = "11259000-0000-4000-8000-0000000001a2";
const LABEL_Z: string = "11259000-0000-4000-8000-0000000001a3";
const TEAM_ID: string = "11259000-0000-4000-8000-0000000001b1";
const MONITOR_B: string = "11259000-0000-4000-8000-0000000001c2";

const GLOBAL_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const row: (
  permission: Permission,
  options?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
    teamId?: string;
  },
) => UserPermission = (
  permission: Permission,
  options?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
    teamId?: string;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (options?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: Boolean(options?.isBlock),
    ...(options?.scope ? { scope: options.scope } : {}),
    ...(options?.teamId ? { teamId: new ObjectID(options.teamId) } : {}),
  };
};

// The customer's team, exactly.
const CUSTOMER: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All }),
  row(Permission.ProjectMember, {
    scope: PermissionScope.Labels,
    labelIds: [LABEL_X],
  }),
];

// The snapshot the API's permission headers leave in this tab.
const signInAs: (rows: Array<UserPermission>) => void = (
  rows: Array<UserPermission>,
): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: GLOBAL_PERMISSIONS,
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [row(Permission.ProjectUser), ...rows],
  });
};

const translator: Translator = getGlobalTranslator();

const NOUNS: { singularName: string; pluralName: string } = {
  singularName: "Monitor",
  pluralName: "Monitors",
};

const names: (entries: Array<[string, string]>) => Map<string, string> = (
  entries: Array<[string, string]>,
): Map<string, string> => {
  return new Map<string, string>(entries);
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearLabelNames();
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RecordLocks.getLabelLock: the reach of the reader's rows", () => {
  test("the customer may change and delete monitor A, labelled X, and neither monitor B nor one labelled Y", () => {
    signInAs(CUSTOMER);

    const lock: ModelLabelLock = RecordLocks.getLabelLock(new Monitor())!;

    expect(lock).not.toBeNull();
    expect(lock.labelsColumn).toBe("labels");
    expect(lock.labelIds).toEqual([LABEL_X]);

    for (const action of [ModelAction.Update, ModelAction.Delete] as const) {
      expect(lock.weigh(action, [LABEL_X]).isAllowed).toBe(true);
      expect(lock.weigh(action, [LABEL_X, LABEL_Y]).isAllowed).toBe(true);

      const outside: LabelVerdict = lock.weigh(action, []);
      expect(outside.isAllowed).toBe(false);
      expect(outside.refusal).toBe(LabelRefusal.Labels);
      expect(lock.weigh(action, [LABEL_Y]).refusal).toBe(LabelRefusal.Labels);
    }
  });

  test("nothing to lock by labels for a Project Member over the project, a Viewer alone, or no snapshot", () => {
    expect(RecordLocks.getLabelLock(new Monitor())).toBeNull();

    signInAs([row(Permission.ProjectMember, { scope: PermissionScope.All })]);
    expect(RecordLocks.getLabelLock(new Monitor())).toBeNull();

    signInAs([row(Permission.Viewer, { scope: PermissionScope.All })]);
    expect(RecordLocks.getLabelLock(new Monitor())).toBeNull();
  });

  test("a model that carries no labels has nothing for its labels to lock", () => {
    signInAs(CUSTOMER);

    expect(
      RecordLocks.getLabelLock({
        ...new Monitor(),
        singularName: "Thing",
        getAccessControlColumn: (): null => {
          return null;
        },
        getReadPermissions: (): Array<Permission> => {
          return [Permission.Viewer];
        },
        getUpdatePermissions: (): Array<Permission> => {
          return [Permission.ProjectMember];
        },
        getDeletePermissions: (): Array<Permission> => {
          return [Permission.ProjectMember];
        },
        getCreatePermissions: (): Array<Permission> => {
          return [];
        },
      } as never),
    ).toBeNull();
  });

  test("a team's block on label Y locks the monitors carrying Y, whatever grants them", () => {
    signInAs([
      row(Permission.ProjectMember, { scope: PermissionScope.All }),
      row(Permission.DeleteProjectMonitor, {
        isBlock: true,
        labelIds: [LABEL_Y],
      }),
    ]);

    const lock: ModelLabelLock = RecordLocks.getLabelLock(new Monitor())!;

    expect(lock.weigh(ModelAction.Delete, [LABEL_Y]).refusal).toBe(
      LabelRefusal.BlockedLabels,
    );
    expect(lock.weigh(ModelAction.Delete, []).isAllowed).toBe(true);
    // The block is on Delete only.
    expect(lock.weigh(ModelAction.Update, [LABEL_Y]).isAllowed).toBe(true);
  });

  test("a runner, a workflow: every labelled kind is weighed the same way", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.RunbookAdmin, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X],
      }),
      row(Permission.WorkflowAdmin, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_Y],
      }),
    ]);

    const runners: ModelLabelLock = RecordLocks.getLabelLock(new Runner())!;
    const workflows: ModelLabelLock = RecordLocks.getLabelLock(new Workflow())!;

    expect(runners.weigh(ModelAction.Delete, []).isAllowed).toBe(false);
    expect(runners.weigh(ModelAction.Delete, [LABEL_X]).isAllowed).toBe(true);
    expect(workflows.weigh(ModelAction.Update, [LABEL_X]).isAllowed).toBe(
      false,
    );
    expect(workflows.weigh(ModelAction.Update, [LABEL_Y]).isAllowed).toBe(true);
  });

  test("beside a grant scoped to Owned, a monitor outside the labels is the owners' to decide: not locked", () => {
    signInAs([
      ...CUSTOMER,
      row(Permission.MonitorAdmin, {
        scope: PermissionScope.Owned,
        teamId: TEAM_ID,
      }),
    ]);

    const verdict: LabelVerdict = RecordLocks.getLabelLock(
      new Monitor(),
    )!.weigh(ModelAction.Delete, []);

    expect(verdict.isAllowed).toBe(true);
    expect(verdict.isDecidedByOwners).toBe(true);
  });
});

describe("RecordLocks.mayReadColumnOnRecord: a key read on some labels only", () => {
  test("the customer sees monitor A's secret key and not monitor B's", () => {
    signInAs(CUSTOMER);

    expect(
      RecordLocks.mayReadColumnOnRecord(
        new Monitor(),
        "serverMonitorSecretKey",
        [LABEL_X],
      ),
    ).toBe(true);
    expect(
      RecordLocks.mayReadColumnOnRecord(
        new Monitor(),
        "serverMonitorSecretKey",
        [],
      ),
    ).toBe(false);
    // A column every reader reads is read on every record.
    expect(RecordLocks.mayReadColumnOnRecord(new Monitor(), "name", [])).toBe(
      true,
    );
  });

  test("a Viewer alone sees no key on any monitor; a record read without its labels is left to the server", () => {
    signInAs([row(Permission.Viewer, { scope: PermissionScope.All })]);

    expect(
      RecordLocks.mayReadColumnOnRecord(
        new Monitor(),
        "serverMonitorSecretKey",
        [LABEL_X],
      ),
    ).toBe(false);

    signInAs(CUSTOMER);

    expect(
      RecordLocks.mayReadColumnOnRecord(
        new Monitor(),
        "serverMonitorSecretKey",
        null,
      ),
    ).toBe(true);
  });
});

describe("the reason a lock gives, in the reader's words", () => {
  test("names the labels the permission is limited to", () => {
    signInAs(CUSTOMER);

    const refusal: string | null = getRecordLabelRefusal({
      lock: RecordLocks.getLabelLock(new Monitor()),
      action: ModelAction.Delete,
      recordLabelIds: [],
      nouns: NOUNS,
      labelNames: names([[LABEL_X, "Production"]]),
      translator: translator,
    });

    expect(refusal).toBe(
      "Your permission is limited to monitors labelled Production.",
    );
  });

  test("names several labels as a sentence lists them", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.MonitorMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X, LABEL_Y],
      }),
    ]);

    expect(
      getRecordLabelRefusal({
        lock: RecordLocks.getLabelLock(new Monitor()),
        action: ModelAction.Update,
        recordLabelIds: [LABEL_Z],
        nouns: NOUNS,
        labelNames: names([
          [LABEL_X, "Production"],
          [LABEL_Y, "Payments"],
        ]),
        translator: translator,
      }),
    ).toBe(
      "Your permission is limited to monitors labelled Production or Payments.",
    );
  });

  test("says a team's block, naming the record's labels it is on", () => {
    signInAs([
      row(Permission.ProjectMember, { scope: PermissionScope.All }),
      row(Permission.DeleteProjectMonitor, {
        isBlock: true,
        labelIds: [LABEL_Y],
      }),
    ]);

    expect(
      getRecordLabelRefusal({
        lock: RecordLocks.getLabelLock(new Monitor()),
        action: ModelAction.Delete,
        recordLabelIds: [LABEL_Y, LABEL_X],
        nouns: NOUNS,
        labelNames: names([[LABEL_Y, "Legacy"]]),
        translator: translator,
      }),
    ).toBe("A team you are on blocks this on monitors labelled Legacy.");
  });

  test("names the labels that still exist: one deleted since has no name, and no record carries it", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.MonitorMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X, LABEL_Y],
      }),
    ]);

    expect(
      getRecordLabelRefusal({
        lock: RecordLocks.getLabelLock(new Monitor()),
        action: ModelAction.Delete,
        recordLabelIds: [],
        nouns: NOUNS,
        // Y was deleted: its name was read as none.
        labelNames: names([
          [LABEL_X, "Production"],
          [LABEL_Y, ""],
        ]),
        translator: translator,
      }),
    ).toBe("Your permission is limited to monitors labelled Production.");
  });

  test("names no label while the names are not read, rather than an id", () => {
    signInAs(CUSTOMER);

    expect(
      getRecordLabelRefusal({
        lock: RecordLocks.getLabelLock(new Monitor()),
        action: ModelAction.Delete,
        recordLabelIds: [],
        nouns: NOUNS,
        labelNames: names([]),
        translator: translator,
      }),
    ).toBe("Your permission is limited to monitors with certain labels.");
  });

  test("says nothing of a record read without its labels, or one the labels allow", () => {
    signInAs(CUSTOMER);
    const lock: ModelLabelLock | null = RecordLocks.getLabelLock(new Monitor());

    for (const recordLabelIds of [null, [LABEL_X]]) {
      expect(
        getRecordLabelRefusal({
          lock: lock,
          action: ModelAction.Delete,
          recordLabelIds: recordLabelIds,
          nouns: NOUNS,
          labelNames: names([]),
          translator: translator,
        }),
      ).toBeNull();
    }
  });

  test("a record outside the read itself is said to be out of reach", () => {
    expect(
      getLabelRefusalSentence({
        verdict: {
          isAllowed: false,
          refusal: LabelRefusal.NotReadable,
          labelIds: [],
          blockedPermissions: [],
          isDecidedByOwners: false,
        },
        nouns: NOUNS,
        labelNames: names([]),
        translator: translator,
      }),
    ).toBe("Your permissions do not reach this monitor.");
  });
});

describe("a record's page hands its gates what its labels lock", () => {
  test("monitor B's page locks its update and delete, each with why, and a gate reads them as the server's answer", () => {
    signInAs(CUSTOMER);

    const scope: RecordAccessScope = getRecordLabelAccessScope({
      tableName: "Monitor",
      recordId: MONITOR_B.toUpperCase(),
      lock: RecordLocks.getLabelLock(new Monitor()),
      recordLabelIds: [],
      nouns: NOUNS,
      labelNames: names([[LABEL_X, "Production"]]),
      translator: translator,
    })!;

    expect(scope).toEqual({
      tables: {
        Monitor: {
          isHeldBack: false,
          refusals: {
            update:
              "Your permission is limited to monitors labelled Production.",
            delete:
              "Your permission is limited to monitors labelled Production.",
          },
        },
      },
      tableNames: ["Monitor"],
      isHeldBack: false,
      recordTableName: "Monitor",
      recordId: MONITOR_B,
    });

    const result: PermissionGateResult = PermissionGate.check(
      new Monitor(),
      ModelAction.Delete,
      { recordAccess: scope },
    );

    expect(result.isAllowed).toBe(false);
    expect(result.isRefusedOnRecord).toBe(true);
    expect(result.disabledReason).toBe(
      "You do not have permission to delete this Monitor. Your permission is limited to monitors labelled Production.",
    );

    // The scope says nothing of another kind.
    expect(getRecordAccessGateOptions(scope, { tableName: "Incident" })).toBe(
      undefined,
    );
  });

  test("monitor A's page locks nothing", () => {
    signInAs(CUSTOMER);

    const scope: RecordAccessScope = getRecordLabelAccessScope({
      tableName: "Monitor",
      recordId: MONITOR_B,
      lock: RecordLocks.getLabelLock(new Monitor()),
      recordLabelIds: [LABEL_X],
      nouns: NOUNS,
      labelNames: names([]),
      translator: translator,
    })!;

    expect(scope.tables["Monitor"]!.refusals).toEqual({});
    expect(
      PermissionGate.check(new Monitor(), ModelAction.Delete, {
        recordAccess: scope,
      }).isAllowed,
    ).toBe(true);
  });

  test("no scope where the labels lock nothing, or were not read", () => {
    signInAs(CUSTOMER);

    expect(
      getRecordLabelAccessScope({
        tableName: "Monitor",
        recordId: MONITOR_B,
        lock: null,
        recordLabelIds: [],
        nouns: NOUNS,
        labelNames: names([]),
        translator: translator,
      }),
    ).toBeNull();
    expect(
      getRecordLabelAccessScope({
        tableName: "Monitor",
        recordId: MONITOR_B,
        lock: RecordLocks.getLabelLock(new Monitor()),
        recordLabelIds: null,
        nouns: NOUNS,
        labelNames: names([]),
        translator: translator,
      }),
    ).toBeNull();
  });

  test("the server's answer for a record stands for the tables it answers; the labels' for the rest", () => {
    const outer: RecordAccessScope = {
      tables: {
        Incident: { isHeldBack: false, refusals: { update: "server says" } },
      },
      tableNames: ["Incident", "IncidentInternalNote"],
      isHeldBack: false,
      recordTableName: "Incident",
      recordId: "a",
    };
    const own: RecordAccessScope = {
      tables: {
        Incident: { isHeldBack: false, refusals: { update: "labels say" } },
      },
      tableNames: ["Incident"],
      isHeldBack: false,
      recordTableName: "Incident",
      recordId: "a",
    };

    expect(mergeRecordAccessScopes(outer, own)).toEqual({
      tables: {
        Incident: { isHeldBack: false, refusals: { update: "server says" } },
      },
      tableNames: ["Incident", "IncidentInternalNote"],
      isHeldBack: false,
      recordTableName: "Incident",
      recordId: "a",
    });
    expect(mergeRecordAccessScopes(null, own)).toBe(own);
    expect(mergeRecordAccessScopes(outer, null)).toBe(outer);
    expect(mergeRecordAccessScopes(null, null)).toBeNull();
  });
});

describe("a record's label ids, as it was read", () => {
  test("from the labels it was read with, in any form", () => {
    const monitor: Monitor = new Monitor();
    const label: Label = new Label();
    label._id = LABEL_X.toUpperCase();
    monitor.labels = [label];

    expect(getRecordLabelIds(monitor, "labels")).toEqual([LABEL_X]);
    expect(
      getRecordLabelIds({ labels: [{ _id: LABEL_Y }, LABEL_Z] }, "labels"),
    ).toEqual([LABEL_Y, LABEL_Z]);
  });

  test("no labels is an empty list; labels never read is null", () => {
    expect(getRecordLabelIds({ labels: [] }, "labels")).toEqual([]);
    expect(getRecordLabelIds({ name: "B" }, "labels")).toBeNull();
    expect(getRecordLabelIds(null, "labels")).toBeNull();
  });
});

describe("label names, read once for the page", () => {
  test("each label is asked for once, however many locks name it", async () => {
    const getList: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ModelAPI,
      "getList",
    ).mockImplementation((async () => {
      const label: Label = new Label();
      label._id = LABEL_X;
      label.name = "Production";
      return { data: [label], count: 1, skip: 0, limit: 1 };
    }) as never);

    await Promise.all([
      readLabelNames([LABEL_X]),
      readLabelNames([LABEL_X.toUpperCase()]),
    ]);
    await readLabelNames([LABEL_X]);

    expect(getList).toHaveBeenCalledTimes(1);
    expect(getKnownLabelNames([LABEL_X])).toEqual(
      names([[LABEL_X, "Production"]]),
    );
  });

  test("a label that cannot be read is not asked for again, and has no name", async () => {
    const getList: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ModelAPI,
      "getList",
    ).mockImplementation((async () => {
      return { data: [], count: 0, skip: 0, limit: 1 };
    }) as never);

    await readLabelNames([LABEL_Y]);
    await readLabelNames([LABEL_Y]);

    expect(getList).toHaveBeenCalledTimes(1);
    expect(getKnownLabelNames([LABEL_Y]).size).toBe(0);
  });
});

/*
 * ONE RULE, NOT TWO COPIES: for every grant, block and record below, the
 * Dashboard offers a change or a delete exactly where the server's own check
 * of one record (AccessControlPermission.checkRecordByModel, the check an
 * update or a delete by id runs) lets it through - by the table's
 * permissions (PermissionGate.check) and the record's labels
 * (RecordLocks.getLabelLock).
 */
describe("the Dashboard and the server decide each record alike", () => {
  const SETS: Array<[string, Array<UserPermission>]> = [
    ["the customer: Viewer over the project, Project Member on X", CUSTOMER],
    [
      "Project Member on X alone",
      [
        row(Permission.ProjectMember, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_X],
        }),
      ],
    ],
    [
      "Project Member over the project",
      [row(Permission.ProjectMember, { scope: PermissionScope.All })],
    ],
    ["Viewer alone", [row(Permission.Viewer, { scope: PermissionScope.All })]],
    [
      "Viewer, Edit Monitor on X, Delete Monitor on Y",
      [
        row(Permission.Viewer, { scope: PermissionScope.All }),
        row(Permission.EditProjectMonitor, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_X],
        }),
        row(Permission.DeleteProjectMonitor, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_Y],
        }),
      ],
    ],
    [
      "Project Member over the project, Delete Monitor blocked on Y",
      [
        row(Permission.ProjectMember, { scope: PermissionScope.All }),
        row(Permission.DeleteProjectMonitor, {
          isBlock: true,
          labelIds: [LABEL_Y],
        }),
      ],
    ],
    [
      "Project Member over the project, blocked on Y",
      [
        row(Permission.ProjectMember, { scope: PermissionScope.All }),
        row(Permission.ProjectMember, { isBlock: true, labelIds: [LABEL_Y] }),
      ],
    ],
    [
      "Viewer, the operational wildcards on X",
      [
        row(Permission.Viewer, { scope: PermissionScope.All }),
        row(Permission.EditAllOperationalResources, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_X],
        }),
        row(Permission.DeleteAllOperationalResources, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_X],
        }),
      ],
    ],
    [
      "Viewer, Monitor Admin on X as a row stored with no scope",
      [
        row(Permission.Viewer, { scope: PermissionScope.All }),
        row(Permission.MonitorAdmin, { labelIds: [LABEL_X] }),
      ],
    ],
    [
      "Viewer, Monitor Member on X and on Z",
      [
        row(Permission.Viewer, { scope: PermissionScope.All }),
        row(Permission.MonitorMember, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_X],
        }),
        row(Permission.MonitorMember, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_Z],
        }),
      ],
    ],
  ];

  const RECORDS: Array<Array<string>> = [
    [],
    [LABEL_X],
    [LABEL_Y],
    [LABEL_X, LABEL_Y],
    [LABEL_Z],
  ];

  const serverProps: (
    rows: Array<UserPermission>,
  ) => DatabaseCommonInteractionProps = (
    rows: Array<UserPermission>,
  ): DatabaseCommonInteractionProps => {
    return {
      userId: new ObjectID(USER_ID),
      userType: UserType.User,
      tenantId: new ObjectID(PROJECT_ID),
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [new ObjectID(PROJECT_ID)],
        globalPermissions: [...GLOBAL_PERMISSIONS],
      },
      userTenantAccessPermission: {
        [PROJECT_ID]: {
          _type: "UserTenantAccessPermission",
          projectId: new ObjectID(PROJECT_ID),
          permissions: [row(Permission.ProjectUser), ...rows],
        },
      },
      ...ON_HIGHEST_PLAN,
    } as DatabaseCommonInteractionProps;
  };

  const monitorWith: (labelIds: Array<string>) => Monitor = (
    labelIds: Array<string>,
  ): Monitor => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_B;
    monitor.projectId = new ObjectID(PROJECT_ID);
    monitor.labels = labelIds.map((labelId: string): Label => {
      const label: Label = new Label();
      label._id = labelId;
      label.name = labelId;
      return label;
    });
    return monitor;
  };

  const serverAllows: (data: {
    rows: Array<UserPermission>;
    recordLabelIds: Array<string>;
    type: DatabaseRequestType;
  }) => Promise<boolean> = async (data: {
    rows: Array<UserPermission>;
    recordLabelIds: Array<string>;
    type: DatabaseRequestType;
  }): Promise<boolean> => {
    try {
      await AccessControlPermission.checkRecordByModel({
        fetchModelWithAccessControlIds: async (): Promise<Monitor> => {
          return monitorWith(data.recordLabelIds);
        },
        modelType: Monitor,
        props: serverProps(data.rows),
        type: data.type,
      });
      return true;
    } catch {
      return false;
    }
  };

  const dashboardAllows: (data: {
    action: ModelAction.Update | ModelAction.Delete;
    recordLabelIds: Array<string>;
  }) => boolean = (data: {
    action: ModelAction.Update | ModelAction.Delete;
    recordLabelIds: Array<string>;
  }): boolean => {
    if (!PermissionGate.check(new Monitor(), data.action).isAllowed) {
      return false;
    }

    const lock: ModelLabelLock | null = RecordLocks.getLabelLock(new Monitor());

    return lock ? lock.weigh(data.action, data.recordLabelIds).isAllowed : true;
  };

  for (const [name, rows] of SETS) {
    test(`${name}: every record, update and delete`, async () => {
      signInAs(rows);

      const disagreements: Array<string> = [];

      for (const recordLabelIds of RECORDS) {
        for (const [action, type] of [
          [ModelAction.Update, DatabaseRequestType.Update],
          [ModelAction.Delete, DatabaseRequestType.Delete],
        ] as Array<
          [ModelAction.Update | ModelAction.Delete, DatabaseRequestType]
        >) {
          const server: boolean = await serverAllows({
            rows: rows,
            recordLabelIds: recordLabelIds,
            type: type,
          });
          const dashboard: boolean = dashboardAllows({
            action: action,
            recordLabelIds: recordLabelIds,
          });

          if (server !== dashboard) {
            disagreements.push(
              `${action} of a monitor labelled [${recordLabelIds.join(", ")}]: server ${server}, Dashboard ${dashboard}`,
            );
          }
        }
      }

      expect(disagreements).toEqual([]);
    });
  }

  test("the customer's monitor B, decided by both: refused, and so locked", async () => {
    signInAs(CUSTOMER);

    expect(
      await serverAllows({
        rows: CUSTOMER,
        recordLabelIds: [],
        type: DatabaseRequestType.Delete,
      }),
    ).toBe(false);
    expect(
      dashboardAllows({ action: ModelAction.Delete, recordLabelIds: [] }),
    ).toBe(false);
  });
});
