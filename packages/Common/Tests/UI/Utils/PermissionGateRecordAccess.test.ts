import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RECORD'S LOCKS, AS THE SERVER ANSWERS FOR THE RECORD (#10272).
 *
 * The reader's own permissions say what they may do somewhere in the
 * project. On a record's page the server's answer for that record
 * (RecordAccessScope) is read too: a change their permissions allow
 * anywhere is locked here when the server would refuse it here - their
 * grant is limited to labels the record does not carry, to records they
 * do not own, a team blocks it on the record's labels - with the server's
 * reason after the lock's first sentence. While the answer is read for a
 * reader it may narrow, the change is held back: not offered, nothing
 * said. The gate never refuses what the answer and their permissions both
 * allow, and never names a permission they hold.
 *
 * The snapshot is the real one, read back through PermissionUtil as a page
 * reads it.
 */

let isMasterAdminForTest: boolean = false;

jest.mock("../../../UI/Utils/User", () => {
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

import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { RecordAccessScope } from "../../../UI/Utils/RecordAccessScope";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission, { UserPermission } from "../../../Types/Permission";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";

const PROJECT_ID: ObjectID = new ObjectID(
  "10272000-0000-4000-8000-000000000001",
);
const PAYMENTS_LABEL: string = "10272000-0000-4000-8000-0000000000aa";

const GLOBAL_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const LABELS_REASON: string =
  "Your permission is limited to incidents labelled Payments.";
const ROLES_SENTENCE: string =
  "You do not have permission to change this incident's roles.";

const row: (
  permission: Permission,
  options?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
) => UserPermission = (
  permission: Permission,
  options?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
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
  };
};

const DEFAULT_ROWS: Array<UserPermission> = [
  row(Permission.CurrentUser),
  row(Permission.ProjectUser),
];

const store: (rows: Array<UserPermission>) => void = (
  rows: Array<UserPermission>,
): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: GLOBAL_PERMISSIONS,
    projectIds: [PROJECT_ID],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [...DEFAULT_ROWS, ...rows],
  });
};

// The page's scope: the incident's tables, and the refusals the server gave.
const scopeOf: (data: {
  refusals?: Record<
    string,
    Partial<Record<"create" | "update" | "delete", string>>
  >;
  isHeldBack?: boolean;
}) => RecordAccessScope = (data: {
  refusals?: Record<
    string,
    Partial<Record<"create" | "update" | "delete", string>>
  >;
  isHeldBack?: boolean;
}): RecordAccessScope => {
  const tables: RecordAccessScope["tables"] = {};

  for (const [table, refusals] of Object.entries(data.refusals || {})) {
    tables[table] = { isHeldBack: false, refusals: refusals };
  }

  return {
    tables: tables,
    tableNames: [
      "Incident",
      "IncidentMember",
      "IncidentInternalNote",
      "IncidentStateTimeline",
    ],
    isHeldBack: Boolean(data.isHeldBack),
  };
};

beforeEach(() => {
  isMasterAdminForTest = false;
  localStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  // Someone who may change any incident's roles, anywhere in the project.
  store([row(Permission.ProjectMember)]);
});

afterEach(() => {
  localStorage.clear();
});

describe("a change the reader's permissions allow, on a record the server refuses it on", () => {
  const refused: RecordAccessScope = scopeOf({
    refusals: { IncidentMember: { update: LABELS_REASON } },
  });

  test("is locked, saying what they tried and then why, in the server's words", () => {
    const gate: PermissionGateResult = PermissionGate.check(
      new IncidentMember(),
      ModelAction.Update,
      { sentence: ROLES_SENTENCE, recordAccess: refused },
    );

    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toBe(`${ROLES_SENTENCE} ${LABELS_REASON}`);
    expect(gate.isRefusedOnRecord).toBe(true);
  });

  test("without a sentence of its own, the lock's first sentence names the record's part", () => {
    expect(
      PermissionGate.check(new IncidentMember(), ModelAction.Update, {
        recordAccess: refused,
      }).disabledReason,
    ).toBe(
      `You do not have permission to update this Incident Member. ${LABELS_REASON}`,
    );
  });

  test("names no permission they hold", () => {
    expect(
      PermissionGate.check(new IncidentMember(), ModelAction.Update, {
        recordAccess: refused,
      }).disabledReason,
    ).not.toMatch(/You need/);
  });

  test("the other operations the server allows stay offered", () => {
    for (const action of [ModelAction.Create, ModelAction.Delete]) {
      expect(
        PermissionGate.check(new IncidentMember(), action, {
          recordAccess: refused,
        }),
      ).toEqual({ isAllowed: true });
    }
  });

  test("a change of one column of it - the role's person (Reassign) - is locked with the same reason, never narrowed to the column's permissions", () => {
    const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
      new IncidentMember(),
      "userId",
      { sentence: ROLES_SENTENCE, recordAccess: refused },
    );

    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toBe(`${ROLES_SENTENCE} ${LABELS_REASON}`);
  });

  test("an edit form over it is locked the same way", () => {
    const gate: PermissionGateResult = PermissionGate.checkFormUpdate(
      new Incident(),
      [{ field: { title: true } }],
      {
        recordAccess: scopeOf({
          refusals: { Incident: { update: LABELS_REASON } },
        }),
      },
    );

    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toBe(
      `You do not have permission to update this Incident. ${LABELS_REASON}`,
    );
  });

  test("a card's button is drawn locked, with the reason as its tooltip", () => {
    const button: ReturnType<typeof PermissionGate.gateCardButton> =
      PermissionGate.gateCardButton(
        { title: "Edit", onClick: () => {} } as never,
        new Incident(),
        ModelAction.Update,
        {
          recordAccess: scopeOf({
            refusals: { Incident: { update: LABELS_REASON } },
          }),
        },
      );

    expect(button?.disabled).toBe(true);
    expect(button?.tooltip).toBe(
      `You do not have permission to update this Incident. ${LABELS_REASON}`,
    );
  });
});

describe("the answer is read for the model the gate asks about", () => {
  test("options a page built for its record serve the gates of the record's parts", () => {
    const scope: RecordAccessScope = scopeOf({
      refusals: {
        Incident: { update: LABELS_REASON },
        IncidentStateTimeline: {
          create: "Your permissions do not reach this incident.",
        },
      },
    });

    // The incident page hands the same options to its state change's gate.
    expect(
      PermissionGate.check(new IncidentStateTimeline(), ModelAction.Create, {
        recordAccess: scope,
      }).disabledReason,
    ).toBe(
      "You do not have permission to create this Incident State Timeline. Your permissions do not reach this incident.",
    );

    // And the incident's own refusal locks nothing of its notes.
    expect(
      PermissionGate.check(new IncidentInternalNote(), ModelAction.Create, {
        recordAccess: scope,
      }),
    ).toEqual({ isAllowed: true });
  });

  test("a model the answer is not about - a monitor on the incident's page - is decided by the reader's permissions alone", () => {
    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update, {
        recordAccess: scopeOf({ isHeldBack: true }),
      }),
    ).toEqual({ isAllowed: true });
  });

  test("reading the record is never locked by it: whoever opened its page reads it", () => {
    expect(
      PermissionGate.check(new Incident(), ModelAction.Read, {
        recordAccess: scopeOf({ isHeldBack: true }),
      }),
    ).toEqual({ isAllowed: true });
  });
});

describe("while the answer is read", () => {
  test("a change is held back - not offered, nothing said - so nothing is offered and then locked", () => {
    expect(
      PermissionGate.check(new IncidentMember(), ModelAction.Update, {
        recordAccess: scopeOf({ isHeldBack: true }),
      }),
    ).toEqual({ isAllowed: false });
  });

  test("a change the reader's own permissions refuse says so at once, as everywhere", () => {
    store([row(Permission.Viewer)]);

    const gate: PermissionGateResult = PermissionGate.check(
      new IncidentMember(),
      ModelAction.Update,
      { recordAccess: scopeOf({ isHeldBack: true }) },
    );

    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toMatch(/You need/);
  });
});

describe("the reader's own permissions come first", () => {
  test("a permission they do not hold is named, whatever the server says of the record", () => {
    store([row(Permission.Viewer)]);

    const gate: PermissionGateResult = PermissionGate.check(
      new IncidentMember(),
      ModelAction.Update,
      {
        recordAccess: scopeOf({
          refusals: { IncidentMember: { update: LABELS_REASON } },
        }),
      },
    );

    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toMatch(/You need/);
    expect(gate.disabledReason).not.toMatch(/labelled/);
    expect(gate.isRefusedOnRecord).toBeUndefined();
  });

  test("before their permissions have landed nothing is offered and nobody is accused", () => {
    localStorage.clear();

    expect(
      PermissionGate.check(new IncidentMember(), ModelAction.Update, {
        recordAccess: scopeOf({
          refusals: { IncidentMember: { update: LABELS_REASON } },
        }),
      }),
    ).toEqual({ isAllowed: false });
  });

  test("a master admin may do everything, whatever the answer says", () => {
    isMasterAdminForTest = true;

    expect(
      PermissionGate.check(new IncidentMember(), ModelAction.Update, {
        recordAccess: scopeOf({
          refusals: { IncidentMember: { update: LABELS_REASON } },
          isHeldBack: true,
        }),
      }),
    ).toEqual({ isAllowed: true });
  });

  test("with no answer at all - a page open on no record - nothing changes", () => {
    expect(
      PermissionGate.check(new IncidentMember(), ModelAction.Update),
    ).toEqual({ isAllowed: true });
  });
});

describe("whose permissions the record's answer can narrow (mayReachSomeRecordsOnly)", () => {
  test.each([
    ["a role over the whole project", [row(Permission.ProjectMember)], false],
    ["a view of the whole project", [row(Permission.Viewer)], false],
    [
      "a grant limited to labels",
      [
        row(Permission.Viewer),
        row(Permission.EditIncidentMember, { labelIds: [PAYMENTS_LABEL] }),
      ],
      true,
    ],
    [
      "a grant limited to owned records",
      [
        row(Permission.Viewer),
        row(Permission.EditProjectIncident, { scope: PermissionScope.Owned }),
      ],
      true,
    ],
    [
      "a team's block on some labels",
      [
        row(Permission.ProjectMember),
        row(Permission.EditIncidentMember, {
          labelIds: [PAYMENTS_LABEL],
          isBlock: true,
        }),
      ],
      true,
    ],
    [
      "a team's block on every record",
      [
        row(Permission.ProjectMember),
        row(Permission.EditIncidentMember, { isBlock: true }),
      ],
      false,
    ],
  ])(
    "%s",
    (_name: string, rows: Array<UserPermission>, isNarrowed: boolean) => {
      store(rows);

      expect(PermissionGate.mayReachSomeRecordsOnly()).toBe(isNarrowed);
    },
  );

  test("a master admin's reach every record", () => {
    isMasterAdminForTest = true;
    store([row(Permission.EditIncidentMember, { labelIds: [PAYMENTS_LABEL] })]);

    expect(PermissionGate.mayReachSomeRecordsOnly()).toBe(false);
  });

  test("before the permissions land, it may be either: the page holds back", () => {
    localStorage.clear();

    expect(PermissionGate.mayReachSomeRecordsOnly()).toBe(true);
  });
});
