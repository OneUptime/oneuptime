import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import Runner from "../../../Models/DatabaseModels/Runner";
import Team from "../../../Models/DatabaseModels/Team";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import {
  LabelRefusal,
  LabelVerdict,
} from "../../../Types/LabelAccess/LabelAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { RecordOwnershipResult } from "../../../Types/RecordAccess/RecordOwnership";
import API from "../../../UI/Utils/API/API";
import {
  COLUMN_SORT_LOCK_REASONS,
  getColumnSortLock,
  getColumnSortLockSentence,
} from "../../../UI/Utils/ColumnSortLock";
import PermissionGate, {
  ModelAction,
  ModelPartLock,
  ModelRecordLock,
  RecordOwnershipFacts,
} from "../../../UI/Utils/PermissionGate";
import PermissionUtil from "../../../UI/Utils/Permission";
import {
  getRecordAccessGateOptions,
  isAnsweredAsPart,
  RecordAccessScope,
} from "../../../UI/Utils/RecordAccessScope";
import {
  clearLabelNames,
  getRecordLabelAccessScope,
  mergeRecordAccessScopes,
} from "../../../UI/Utils/RecordLabelLock";
import {
  getRecordOwnershipFacts,
  isRecordOwnershipWanted,
  readRecordOwnership,
} from "../../../UI/Utils/RecordOwnershipRead";
import {
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE DASHBOARD'S LOCKS BY WHO OWNS A RECORD, AND OF A RECORD'S PARTS
 * (#11435, #11436, #11437) - the rule as the Dashboard reads it, from the
 * permission snapshot and the server's answer of who owns a record:
 *
 *   - PermissionGate.getRecordLock: a record's update and delete, by its
 *     labels and its owners; nothing known of the owners, nothing locked by
 *     them; a label-less kind with owners (a team) weighed by its owners;
 *   - PermissionGate.getPartLock: a part's create, update and delete by the
 *     record's labels and owners - the record's labels deciding the grants
 *     only where the part's rows carry them alone;
 *   - the page's scope (getRecordLabelAccessScope): the record's refusals,
 *     what the owners decide held back while who owns it is read, its
 *     parts' answers when a gate asks;
 *   - the columns a reader may not sort by, and why;
 *   - the ownership read itself.
 */

const PROJECT_ID: string = "11436000-0000-4000-8000-000000000e01";
const LABEL_X: string = "11436000-0000-4000-8000-000000000ea1";
const TEAM_A: string = "11436000-0000-4000-8000-000000000eb1";
const TEAM_B: string = "11436000-0000-4000-8000-000000000eb2";
const RECORD: string = "11436000-0000-4000-8000-000000000ec1";

const translator: Translator = getGlobalTranslator();

const row: (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    teamId?: string;
    isBlock?: boolean;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    teamId?: string;
    isBlock?: boolean;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: Boolean(data?.isBlock),
    ...(data?.scope ? { scope: data.scope } : {}),
    ...(data?.teamId ? { teamId: new ObjectID(data.teamId) } : {}),
  };
};

const signInAs: (rows: Array<UserPermission>) => void = (
  rows: Array<UserPermission>,
): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [row(Permission.ProjectUser), ...rows],
  });
};

const ANSWER: (owners: {
  isOwnedByCaller: boolean;
  teamIds: Array<string>;
}) => RecordOwnershipResult = (owners: {
  isOwnedByCaller: boolean;
  teamIds: Array<string>;
}): RecordOwnershipResult => {
  return {
    tableName: "Monitor",
    tables: [
      {
        tableName: "Monitor",
        key: "_id",
        operations: ["read", "update", "delete"],
      },
      {
        tableName: "MonitorOwnerUser",
        key: "monitorId",
        operations: ["create", "update", "delete"],
      },
      {
        tableName: "MonitorProbe",
        key: "monitorId",
        operations: ["create", "read", "update", "delete"],
      },
    ],
    records: { [RECORD]: owners },
  };
};

const factsOf: (owners: {
  isOwnedByCaller: boolean;
  teamIds: Array<string>;
}) => RecordOwnershipFacts = (owners: {
  isOwnedByCaller: boolean;
  teamIds: Array<string>;
}): RecordOwnershipFacts => {
  return getRecordOwnershipFacts(ANSWER(owners), RECORD)!;
};

const OWNED_ADMIN: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All }),
  row(Permission.MonitorAdmin, {
    scope: PermissionScope.Owned,
    teamId: TEAM_A,
  }),
];

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearLabelNames();
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getRecordLock: a record by its labels and its owners", () => {
  test("an Owned admin: a lock that says the owners decide; refused on a monitor nobody of theirs owns", () => {
    signInAs(OWNED_ADMIN);

    const lock: ModelRecordLock = PermissionGate.getRecordLock(new Monitor())!;

    expect(lock.isDecidedByOwners).toBe(true);
    expect(lock.labelsColumn).toBe("labels");
    expect(lock.labelIds).toEqual([]);

    expect(
      lock.weigh(
        ModelAction.Delete,
        [],
        factsOf({ isOwnedByCaller: false, teamIds: [] }),
      ).refusal,
    ).toBe(LabelRefusal.Owned);
    expect(
      lock.weigh(
        ModelAction.Delete,
        [],
        factsOf({ isOwnedByCaller: true, teamIds: [] }),
      ).isAllowed,
    ).toBe(true);
    expect(
      lock.weigh(
        ModelAction.Update,
        [],
        factsOf({ isOwnedByCaller: false, teamIds: [TEAM_A] }),
      ).isAllowed,
    ).toBe(true);
    // Another team of theirs owning it lends nothing to this grant.
    expect(
      lock.weigh(
        ModelAction.Update,
        [],
        factsOf({ isOwnedByCaller: false, teamIds: [TEAM_B] }),
      ).refusal,
    ).toBe(LabelRefusal.Owned);
  });

  test("while nobody has said who owns it: the owners decide, nothing is refused", () => {
    signInAs(OWNED_ADMIN);

    const verdict: LabelVerdict = PermissionGate.getRecordLock(
      new Monitor(),
    )!.weigh(ModelAction.Delete, [], null);

    expect(verdict.isAllowed).toBe(true);
    expect(verdict.isDecidedByOwners).toBe(true);
  });

  test("where the answer says the scope narrows nothing of the operation, the Owned grant reaches every record", () => {
    signInAs(OWNED_ADMIN);

    const answer: RecordOwnershipResult = {
      ...ANSWER({ isOwnedByCaller: false, teamIds: [] }),
      tables: [{ tableName: "Monitor", key: "_id", operations: ["read"] }],
    };

    expect(
      PermissionGate.getRecordLock(new Monitor())!.weigh(
        ModelAction.Delete,
        [],
        getRecordOwnershipFacts(answer, RECORD),
      ).isAllowed,
    ).toBe(true);
  });

  test("a team - a kind with owners and no labels - is weighed by its owners alone", () => {
    signInAs([
      row(Permission.ProjectUser),
      row(Permission.EditProjectTeam, {
        scope: PermissionScope.Owned,
        teamId: TEAM_A,
      }),
    ]);

    const lock: ModelRecordLock = PermissionGate.getRecordLock(new Team())!;

    expect(lock.labelsColumn).toBeNull();
    expect(lock.isDecidedByOwners).toBe(true);
    expect(
      lock.weigh(ModelAction.Update, [], {
        owners: { isOwnedByCaller: false, teamIds: [] },
        ownership: {
          tableName: "Team",
          tables: [
            { tableName: "Team", key: "_id", operations: ["update", "delete"] },
          ],
          records: { [RECORD]: { isOwnedByCaller: false, teamIds: [] } },
        },
      }).refusal,
    ).toBe(LabelRefusal.Owned);
  });

  test("nothing to lock: a Project Member over the project, a Viewer alone", () => {
    signInAs([row(Permission.ProjectMember, { scope: PermissionScope.All })]);
    expect(PermissionGate.getRecordLock(new Monitor())).toBeNull();

    signInAs([row(Permission.Viewer, { scope: PermissionScope.All })]);
    expect(PermissionGate.getRecordLock(new Monitor())).toBeNull();
  });

  test("a grant limited to labels locks by them, as getLabelLock does", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.ProjectMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X],
      }),
    ]);

    const lock: ModelRecordLock = PermissionGate.getRecordLock(new Monitor())!;

    expect(lock.isDecidedByOwners).toBe(false);
    expect(lock.labelIds).toEqual([LABEL_X]);
    expect(lock.weigh(ModelAction.Delete, []).refusal).toBe(
      LabelRefusal.Labels,
    );
    expect(lock.weigh(ModelAction.Delete, [LABEL_X]).isAllowed).toBe(true);
  });
});

describe("getPartLock: a part by the record's labels and owners", () => {
  test("a monitor's owners, for the customer: refused outside Production, allowed in it", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.ProjectMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X],
      }),
    ]);

    const lock: ModelPartLock = PermissionGate.getPartLock(
      new MonitorOwnerUser(),
      new Monitor(),
    )!;

    expect(lock.tableName).toBe("MonitorOwnerUser");
    expect(lock.recordTableName).toBe("Monitor");

    for (const action of [ModelAction.Create, ModelAction.Delete] as const) {
      expect(lock.weigh(action, []).refusal).toBe(LabelRefusal.Labels);
      expect(lock.weigh(action, [LABEL_X]).isAllowed).toBe(true);
    }
  });

  test("a monitor's probes: a grant limited to labels is left to the server, a block on the record's label is not", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X],
      }),
    ]);

    expect(
      PermissionGate.getPartLock(new MonitorProbe(), new Monitor())!.weigh(
        ModelAction.Delete,
        [],
      ).isAllowed,
    ).toBe(true);

    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorProbe, {
        isBlock: true,
        labelIds: [LABEL_X],
      }),
    ]);

    expect(
      PermissionGate.getPartLock(new MonitorProbe(), new Monitor())!.weigh(
        ModelAction.Delete,
        [LABEL_X],
      ).refusal,
    ).toBe(LabelRefusal.BlockedLabels);
  });

  test("owners added only to what their team owns, by the record's owners", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.CreateMonitorOwnerUser, {
        scope: PermissionScope.Owned,
        teamId: TEAM_A,
      }),
    ]);

    const lock: ModelPartLock = PermissionGate.getPartLock(
      new MonitorOwnerUser(),
      new Monitor(),
    )!;

    expect(
      lock.weigh(
        ModelAction.Create,
        [],
        factsOf({ isOwnedByCaller: false, teamIds: [] }),
      ).refusal,
    ).toBe(LabelRefusal.Owned);
    expect(
      lock.weigh(
        ModelAction.Create,
        [],
        factsOf({ isOwnedByCaller: false, teamIds: [TEAM_A] }),
      ).isAllowed,
    ).toBe(true);
    // Nothing known yet: the owners decide.
    expect(lock.weigh(ModelAction.Create, []).isDecidedByOwners).toBe(true);
  });

  test("a part's change needs the record's own update, by its labels", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.EditMonitorProbe, { scope: PermissionScope.All }),
      row(Permission.ProjectMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X],
      }),
    ]);

    const lock: ModelPartLock = PermissionGate.getPartLock(
      new MonitorProbe(),
      new Monitor(),
    )!;

    expect(lock.weigh(ModelAction.Update, []).refusal).toBe(
      LabelRefusal.Labels,
    );
    expect(lock.weigh(ModelAction.Update, [LABEL_X]).isAllowed).toBe(true);
  });

  test("a model that is no part of the record has no part lock", () => {
    signInAs(OWNED_ADMIN);

    expect(
      PermissionGate.getPartLock(new MonitorProbe(), new Runner()),
    ).toBeNull();
    expect(
      PermissionGate.getPartLock(new Monitor() as never, new Monitor()),
    ).toBeNull();
  });
});

describe("the page's scope, with who owns the record and its parts", () => {
  const scopeOf: (data: {
    ownership: { result: RecordOwnershipResult | null; isRead: boolean };
    labels?: Array<string>;
  }) => RecordAccessScope = (data: {
    ownership: { result: RecordOwnershipResult | null; isRead: boolean };
    labels?: Array<string>;
  }): RecordAccessScope => {
    return getRecordLabelAccessScope({
      tableName: "Monitor",
      recordId: RECORD.toUpperCase(),
      lock: PermissionGate.getRecordLock(new Monitor()),
      recordLabelIds: data.labels || [],
      nouns: { singularName: "Monitor", pluralName: "Monitors" },
      labelNames: new Map<string, string>([[LABEL_X, "Production"]]),
      translator: translator,
      recordModel: new Monitor(),
      ownership: data.ownership,
    })!;
  };

  test("while who owns it is read, its update and delete are held back; then refused with why", () => {
    signInAs(OWNED_ADMIN);

    const reading: RecordAccessScope = scopeOf({
      ownership: { result: null, isRead: false },
    });

    expect(reading.tables["Monitor"]).toEqual({
      isHeldBack: false,
      refusals: {},
      heldBackOperations: ["update", "delete"],
    });
    expect(
      PermissionGate.check(new Monitor(), ModelAction.Delete, {
        recordAccess: reading,
      }),
    ).toEqual({ isAllowed: false });

    const answered: RecordAccessScope = scopeOf({
      ownership: {
        result: ANSWER({ isOwnedByCaller: false, teamIds: [] }),
        isRead: true,
      },
    });

    expect(answered.tables["Monitor"]!.refusals["delete"]).toBe(
      "Your permission is limited to monitors you or your teams own.",
    );
    expect(
      PermissionGate.check(new Monitor(), ModelAction.Delete, {
        recordAccess: answered,
      }).disabledReason,
    ).toBe(
      "You do not have permission to delete this Monitor. Your permission is limited to monitors you or your teams own.",
    );
  });

  test("no answer could be read: nothing held back, nothing refused by the owners", () => {
    signInAs(OWNED_ADMIN);

    const scope: RecordAccessScope = scopeOf({
      ownership: { result: null, isRead: true },
    });

    expect(scope.tables["Monitor"]).toEqual({
      isHeldBack: false,
      refusals: {},
    });
  });

  test("a part is answered when a gate asks, by the record's owners", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.CreateMonitorOwnerUser, {
        scope: PermissionScope.Owned,
        teamId: TEAM_A,
      }),
    ]);

    const scope: RecordAccessScope = scopeOf({
      ownership: {
        result: ANSWER({ isOwnedByCaller: false, teamIds: [] }),
        isRead: true,
      },
    });

    expect(scope.tableNames).toEqual([]);
    expect(isAnsweredAsPart(scope, new MonitorOwnerUser())).toBe(true);
    expect(getRecordAccessGateOptions(scope, new MonitorOwnerUser())).toEqual({
      isHeldBack: false,
      refusals: {
        create: "Your permission is limited to monitors you or your teams own.",
      },
    });
    expect(
      PermissionGate.check(new MonitorOwnerUser(), ModelAction.Create, {
        recordAccess: scope,
      }).disabledReason,
    ).toBe(
      "You do not have permission to create this Monitor Team Owner. Your permission is limited to monitors you or your teams own.".replace(
        "Monitor Team Owner",
        new MonitorOwnerUser().singularName || "",
      ),
    );
  });

  test("a part's answer says why it cannot be read on the record, by the record's labels", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.DeleteMonitorOwnerUser, { scope: PermissionScope.All }),
      row(Permission.Viewer, { isBlock: true, labelIds: [LABEL_X] }),
    ]);

    const scope: RecordAccessScope = scopeOf({
      ownership: { result: null, isRead: true },
      labels: [LABEL_X],
    });

    expect(
      getRecordAccessGateOptions(scope, new MonitorOwnerUser())?.refusals[
        "delete"
      ],
    ).toBe("A team you are on blocks this on monitors labelled Production.");
  });

  test("a model that is no part of the record, or the record's own kind, is not answered as a part", () => {
    signInAs(OWNED_ADMIN);

    const scope: RecordAccessScope = scopeOf({
      ownership: { result: null, isRead: true },
    });

    expect(isAnsweredAsPart(scope, new Runner())).toBe(false);
    expect(getRecordAccessGateOptions(scope, new Runner())).toBeUndefined();
    expect(isAnsweredAsPart(scope, new Monitor())).toBe(false);
  });

  test("the server's answer for a record keeps the tables it answers; the labels' scope answers the parts", () => {
    signInAs(OWNED_ADMIN);

    const own: RecordAccessScope = scopeOf({
      ownership: { result: null, isRead: true },
    });
    const outer: RecordAccessScope = {
      tables: {
        Monitor: { isHeldBack: false, refusals: { update: "server" } },
      },
      tableNames: ["Monitor"],
      isHeldBack: false,
    };

    const merged: RecordAccessScope = mergeRecordAccessScopes(outer, own)!;

    expect(merged.tables["Monitor"]!.refusals).toEqual({ update: "server" });
    expect(merged.getPartAccess).toBe(own.getPartAccess);
  });
});

describe("the columns a list is not sorted by, and why", () => {
  test("a monitor's key for the customer: kept to Production; named once read", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.ProjectMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X],
      }),
    ]);

    const lock: ReturnType<typeof getColumnSortLock> = getColumnSortLock(
      new Monitor(),
      "serverMonitorSecretKey",
    );

    expect(lock).toEqual({
      column: "serverMonitorSecretKey",
      labelIds: [LABEL_X],
      isKeptToOwners: false,
    });
    expect(
      getColumnSortLockSentence({
        lock: lock!,
        pluralName: "Monitors",
        labelNames: new Map<string, string>([[LABEL_X, "Production"]]),
        translator: translator,
      }),
    ).toBe(
      "You can read this only on monitors labelled Production, so the list cannot be sorted by it.",
    );
    expect(
      getColumnSortLockSentence({
        lock: lock!,
        pluralName: "Monitors",
        labelNames: new Map<string, string>(),
        translator: translator,
      }),
    ).toBe(
      COLUMN_SORT_LOCK_REASONS.labelsUnnamed.replace("{{items}}", "monitors"),
    );

    // The name, the relation, and a column the reader reads wherever the monitor: no lock.
    expect(getColumnSortLock(new Monitor(), "name")).toBeNull();
    expect(getColumnSortLock(new Monitor(), "labels.name")).toBeNull();
  });

  test("a runner's key for a Runbook Admin of what their team owns beside a Viewer: kept to owners", () => {
    signInAs([
      row(Permission.Viewer, { scope: PermissionScope.All }),
      row(Permission.RunbookAdmin, {
        scope: PermissionScope.Owned,
        teamId: TEAM_A,
      }),
    ]);

    const lock: ReturnType<typeof getColumnSortLock> = getColumnSortLock(
      new Runner(),
      "key",
    );

    // Only if the key is a column only Runner's changers read.
    if (PermissionGate.isColumnKeptToOwners(new Runner(), "key")) {
      expect(lock).toEqual({
        column: "key",
        labelIds: [],
        isKeptToOwners: true,
      });
      expect(
        getColumnSortLockSentence({
          lock: lock!,
          pluralName: "Runners",
          labelNames: new Map<string, string>(),
          translator: translator,
        }),
      ).toBe(
        "You can read this only on runners you or your teams own, so the list cannot be sorted by it.",
      );
    } else {
      expect(lock).toBeNull();
    }
  });

  test("a Project Member over the project sorts by every column", () => {
    signInAs([row(Permission.ProjectMember, { scope: PermissionScope.All })]);

    expect(
      getColumnSortLock(new Monitor(), "serverMonitorSecretKey"),
    ).toBeNull();
  });
});

describe("the snapshot as the pages read it", () => {
  test("whether the reader holds a grant scoped to Owned at all", () => {
    signInAs(OWNED_ADMIN);
    expect(PermissionGate.hasOwnedScopedGrants()).toBe(true);

    signInAs([row(Permission.ProjectAdmin, { scope: PermissionScope.Owned })]);
    expect(PermissionGate.hasOwnedScopedGrants()).toBe(false);
  });

  test("every label the reader's grants are limited to or blocked on", () => {
    signInAs([
      row(Permission.ProjectMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_X.toUpperCase()],
      }),
      row(Permission.Viewer, { isBlock: true, labelIds: [TEAM_B] }),
      row(Permission.Viewer, { scope: PermissionScope.All }),
    ]);

    expect(PermissionGate.getSnapshotLabelIds().sort()).toEqual(
      [LABEL_X, TEAM_B].sort(),
    );
  });

  test("the snapshot's key moves when the snapshot does", () => {
    signInAs(OWNED_ADMIN);
    const first: string = PermissionGate.getSnapshotKey();
    signInAs([row(Permission.Viewer, { scope: PermissionScope.All })]);

    expect(PermissionGate.getSnapshotKey()).not.toBe(first);
  });
});

describe("reading who owns the records", () => {
  test("asks the kind's route with the ids, and reads the answer", async () => {
    const post: ReturnType<typeof jest.spyOn> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          {
            tableName: "Monitor",
            tables: [
              { tableName: "Monitor", key: "_id", operations: ["delete"] },
            ],
            records: { [RECORD]: { isOwnedByCaller: true, teamIds: [] } },
          },
          {},
        ) as never,
      );

    const result: RecordOwnershipResult = await readRecordOwnership({
      modelType: Monitor,
      ids: [RECORD],
    });

    const call: { url: { toString: () => string }; data: JSONObject } = post
      .mock.calls[0]![0] as never;
    expect(call.url.toString()).toContain("/monitor/record-ownership");
    expect(call.data).toEqual({ ids: [RECORD] });
    expect(result.records[RECORD]).toEqual({
      isOwnedByCaller: true,
      teamIds: [],
    });
  });

  test("a refusal, or an answer it cannot read, is thrown: the owners then decide", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(500, { message: "x" }, {}) as never,
      );

    await expect(
      readRecordOwnership({ modelType: Monitor, ids: [RECORD] }),
    ).rejects.toBeTruthy();

    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { nope: true }, {}) as never,
      );

    await expect(
      readRecordOwnership({ modelType: Monitor, ids: [RECORD] }),
    ).rejects.toThrow("Who owns these records could not be read");
  });

  test("asked only of a kind with owner tables, by a reader with a grant scoped to Owned", () => {
    signInAs(OWNED_ADMIN);
    expect(isRecordOwnershipWanted(Monitor)).toBe(true);
    expect(isRecordOwnershipWanted(MonitorProbe)).toBe(false);

    signInAs([row(Permission.Viewer, { scope: PermissionScope.All })]);
    expect(isRecordOwnershipWanted(Monitor)).toBe(false);
    expect(isRecordOwnershipWanted(null)).toBe(false);
  });

  test("the facts of one record: none for a record the answer leaves out", () => {
    expect(
      getRecordOwnershipFacts(
        ANSWER({ isOwnedByCaller: true, teamIds: [] }),
        RECORD.toUpperCase(),
      )?.owners,
    ).toEqual({ isOwnedByCaller: true, teamIds: [] });
    expect(
      getRecordOwnershipFacts(
        ANSWER({ isOwnedByCaller: true, teamIds: [] }),
        "11436000-0000-4000-8000-000000000ec9",
      ),
    ).toBeNull();
    expect(getRecordOwnershipFacts(null, RECORD)).toBeNull();
  });
});
