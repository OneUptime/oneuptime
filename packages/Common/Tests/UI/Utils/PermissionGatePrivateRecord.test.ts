import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PRIVATE RECORD'S LOCKS (block 33). A private incident, alert or episode
 * is changed only with the permissions of the teams that own it and of the
 * people named as its owners. On its page, every gate that asks about it or
 * a part of it asks with what the reader holds on it (PrivateRecordScope),
 * and a change their own permissions would allow anywhere else is locked
 * saying why - in the record's words, not by naming a permission they hold.
 *
 * The snapshot is the real one: the rows the API's response headers leave
 * in storage, each naming the team it is granted on (UserPermission.teamId),
 * read back through PermissionUtil exactly as a page reads them.
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
  PermissionGateOptions,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);
const TEAM_1: string = "7e000000-0000-4000-8000-0000000000a1";
const TEAM_2: string = "7e000000-0000-4000-8000-0000000000a2";

const GLOBAL_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

// What the page says after the gate's first sentence (PrivateRecordScopeProvider's).
const REASON: string =
  "This incident is private, so it is changed only with the permissions of the teams that own it, and Team 2, your team that owns it, may not do this.";

type RowFunction = (
  permission: Permission,
  options?: { teamId?: string; isBlock?: boolean },
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  options?: { teamId?: string; isBlock?: boolean },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: Boolean(options?.isBlock),
    ...(options?.teamId ? { teamId: new ObjectID(options.teamId) } : {}),
  };
};

// The defaults every member holds, on no team's behalf.
const DEFAULT_ROWS: Array<UserPermission> = [
  row(Permission.CurrentUser),
  row(Permission.UnAuthorizedSsoUser),
  row(Permission.ProjectUser),
];

/*
 * Test User 2: Team 1 may change every incident (Project Member), Team 2
 * may only view (Viewer). INC-17 is private and owned by Team 2 alone.
 */
const MAINTAINERS_ROWS: Array<UserPermission> = [
  ...DEFAULT_ROWS,
  row(Permission.ProjectMember, { teamId: TEAM_1 }),
  row(Permission.Viewer, { teamId: TEAM_2 }),
];

type StoreFunction = (rows: Array<UserPermission>) => void;

// What the API's permission headers leave in storage for this project.
const store: StoreFunction = (rows: Array<UserPermission>): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: GLOBAL_PERMISSIONS,
    projectIds: [PROJECT_ID],
  });
  PermissionUtil.setProjectPermissions({
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  });
};

type OptionsFunction = (data: {
  owningTeamIds: Array<string>;
  isOwnedByReader?: boolean;
}) => PermissionGateOptions | undefined;

// What the page open on INC-17 hands its gates (PrivateRecordScope).
const privateRecordOptions: OptionsFunction = (data: {
  owningTeamIds: Array<string>;
  isOwnedByReader?: boolean;
}): PermissionGateOptions | undefined => {
  const held: HeldPermissions | null = PermissionGate.getHeldOnPrivateRecord({
    isPrivate: true,
    isOwnedByReader: Boolean(data.isOwnedByReader),
    owningTeamIds: data.owningTeamIds,
  });

  return held ? { held: held, privateRecordReason: REASON } : undefined;
};

beforeEach(() => {
  isMasterAdminForTest = false;
  localStorage.clear();
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  localStorage.clear();
});

describe("the maintainer's case: Test User 2 on INC-17, owned by Team 2 (Viewer) alone", () => {
  beforeEach(() => {
    store(MAINTAINERS_ROWS);
  });

  test("anywhere else their snapshot lets them update an incident, through Team 1", () => {
    expect(
      PermissionGate.check(new Incident(), ModelAction.Update).isAllowed,
    ).toBe(true);
  });

  test("on INC-17, Edit is locked, saying why", () => {
    const gate: PermissionGateResult = PermissionGate.check(
      new Incident(),
      ModelAction.Update,
      privateRecordOptions({ owningTeamIds: [TEAM_2] }),
    );

    expect(gate).toEqual({
      isAllowed: false,
      disabledReason: `You do not have permission to update this Incident. ${REASON}`,
    });
  });

  test("Acknowledge and Resolve are locked in the words of what was pressed, then why", () => {
    const gate: PermissionGateResult = PermissionGate.check(
      new IncidentStateTimeline(),
      ModelAction.Create,
      {
        sentence: "You do not have permission to change this incident's state.",
        ...privateRecordOptions({ owningTeamIds: [TEAM_2] }),
      },
    );

    expect(gate).toEqual({
      isAllowed: false,
      disabledReason: `You do not have permission to change this incident's state. ${REASON}`,
    });
  });

  test("a note is locked too, and so is deleting it", () => {
    for (const action of [ModelAction.Create, ModelAction.Delete]) {
      const gate: PermissionGateResult = PermissionGate.check(
        new IncidentInternalNote(),
        action,
        privateRecordOptions({ owningTeamIds: [TEAM_2] }),
      );

      expect(gate.isAllowed).toBe(false);
      expect(gate.disabledReason).toMatch(
        new RegExp(`^You do not have permission to ${action} this `),
      );
      expect(gate.disabledReason?.endsWith(REASON)).toBe(true);
    }
  });

  test("a form's Edit is locked by the record's gate first, saying why", () => {
    const gate: PermissionGateResult = PermissionGate.checkFormUpdate(
      new Incident(),
      [{ field: { description: true } }],
      privateRecordOptions({ owningTeamIds: [TEAM_2] }),
    );

    expect(gate.disabledReason).toBe(
      `You do not have permission to update this Incident. ${REASON}`,
    );
  });

  test("reading it is asked of their whole snapshot: who reads a private record is its owners, with any read of theirs", () => {
    const gate: PermissionGateResult = PermissionGate.check(
      new Incident(),
      ModelAction.Read,
      privateRecordOptions({ owningTeamIds: [TEAM_2] }),
    );

    expect(gate).toEqual({ isAllowed: true });
  });

  test("once Team 2 may change incidents, everything is offered again", () => {
    store([
      ...MAINTAINERS_ROWS,
      row(Permission.IncidentMember, { teamId: TEAM_2 }),
    ]);

    for (const [model, action] of [
      [new Incident(), ModelAction.Update],
      [new IncidentStateTimeline(), ModelAction.Create],
      [new IncidentInternalNote(), ModelAction.Create],
    ] as Array<[Incident, ModelAction]>) {
      expect(
        PermissionGate.check(
          model,
          action,
          privateRecordOptions({ owningTeamIds: [TEAM_2] }),
        ).isAllowed,
      ).toBe(true);
    }
  });

  test("on a private incident Team 1 owns, Team 1's permission is theirs", () => {
    expect(
      PermissionGate.check(
        new Incident(),
        ModelAction.Update,
        privateRecordOptions({ owningTeamIds: [TEAM_1] }),
      ).isAllowed,
    ).toBe(true);
  });

  test("once a project admin names them an owner of INC-17, nothing is narrowed", () => {
    expect(
      privateRecordOptions({ owningTeamIds: [TEAM_2], isOwnedByReader: true }),
    ).toBeUndefined();
  });

  test("a change their whole snapshot refuses too still names the permission that would allow it", () => {
    // Team 1 may edit incidents, and delete none.
    store([
      ...DEFAULT_ROWS,
      row(Permission.EditProjectIncident, { teamId: TEAM_1 }),
      row(Permission.Viewer, { teamId: TEAM_2 }),
    ]);

    const gate: PermissionGateResult = PermissionGate.check(
      new Incident(),
      ModelAction.Delete,
      privateRecordOptions({ owningTeamIds: [TEAM_2] }),
    );
    const anywhere: PermissionGateResult = PermissionGate.check(
      new Incident(),
      ModelAction.Delete,
    );

    // Deleting no incident at all is no private record's doing.
    expect(anywhere.isAllowed).toBe(false);
    expect(anywhere.disabledReason).toMatch(
      /^You do not have permission to delete this Incident\. /,
    );
    expect(gate.disabledReason).toBe(anywhere.disabledReason);
    expect(gate.disabledReason).not.toContain(REASON);

    // Editing it is theirs anywhere else, and so is locked here saying why.
    expect(
      PermissionGate.check(
        new Incident(),
        ModelAction.Update,
        privateRecordOptions({ owningTeamIds: [TEAM_2] }),
      ).disabledReason,
    ).toBe(`You do not have permission to update this Incident. ${REASON}`);
  });
});

describe("PermissionGate.getHeldOnPrivateRecord", () => {
  test("reads the stored snapshot - teams and all - and leaves out another team's grant", () => {
    store(MAINTAINERS_ROWS);

    const held: HeldPermissions | null = PermissionGate.getHeldOnPrivateRecord({
      isPrivate: true,
      isOwnedByReader: false,
      owningTeamIds: [TEAM_2.toUpperCase()],
    });

    expect(held).not.toBeNull();
    expect(held!.allowed).toContain(Permission.Viewer);
    expect(held!.allowed).not.toContain(Permission.ProjectMember);
    expect(held!.allowed).toEqual(expect.arrayContaining(GLOBAL_PERMISSIONS));
    expect(HeldPermissionsUtil.isLoaded(held!)).toBe(true);
  });

  test("is everything (null) for a record that is not private, or one the reader owns", () => {
    store(MAINTAINERS_ROWS);

    expect(
      PermissionGate.getHeldOnPrivateRecord({
        isPrivate: false,
        isOwnedByReader: false,
        owningTeamIds: [TEAM_2],
      }),
    ).toBeNull();
    expect(
      PermissionGate.getHeldOnPrivateRecord({
        isPrivate: true,
        isOwnedByReader: true,
        owningTeamIds: [TEAM_2],
      }),
    ).toBeNull();
  });

  test("is everything (null) for a Project Admin over the whole project, and for a master admin", () => {
    store([
      ...MAINTAINERS_ROWS,
      row(Permission.ProjectAdmin, { teamId: TEAM_1 }),
    ]);

    expect(
      PermissionGate.getHeldOnPrivateRecord({
        isPrivate: true,
        isOwnedByReader: false,
        owningTeamIds: [TEAM_2],
      }),
    ).toBeNull();

    store(MAINTAINERS_ROWS);
    isMasterAdminForTest = true;

    expect(
      PermissionGate.getHeldOnPrivateRecord({
        isPrivate: true,
        isOwnedByReader: false,
        owningTeamIds: [TEAM_2],
      }),
    ).toBeNull();
  });

  test("a team's block refuses on the record whichever team it is on", () => {
    store([
      ...MAINTAINERS_ROWS,
      row(Permission.IncidentMember, { teamId: TEAM_2 }),
      row(Permission.EditProjectIncident, { teamId: TEAM_1, isBlock: true }),
    ]);

    const gate: PermissionGateResult = PermissionGate.check(
      new Incident(),
      ModelAction.Update,
      privateRecordOptions({ owningTeamIds: [TEAM_2] }),
    );

    expect(gate.isAllowed).toBe(false);
  });

  test("before the snapshot lands there is nothing to say: the record's changes stay hidden", () => {
    const held: HeldPermissions | null = PermissionGate.getHeldOnPrivateRecord({
      isPrivate: true,
      isOwnedByReader: false,
      owningTeamIds: [TEAM_2],
    });

    expect(held).not.toBeNull();
    expect(HeldPermissionsUtil.isLoaded(held!)).toBe(false);
    expect(
      PermissionGate.check(new Incident(), ModelAction.Update, {
        held: held!,
        privateRecordReason: REASON,
      }),
    ).toEqual({ isAllowed: false });
  });
});

describe("PermissionGate.getTeamIdsOfReader", () => {
  test("names each team the reader's permissions are granted on, once, as the snapshot stores them", () => {
    store([
      ...MAINTAINERS_ROWS,
      row(Permission.IncidentMember, { teamId: TEAM_2.toUpperCase() }),
      row(Permission.EditProjectIncident, { teamId: TEAM_1, isBlock: true }),
    ]);

    expect(PermissionGate.getTeamIdsOfReader()).toEqual([TEAM_1, TEAM_2]);
  });

  test("names none before the snapshot lands, nor for the rows no team grants", () => {
    expect(PermissionGate.getTeamIdsOfReader()).toEqual([]);

    store(DEFAULT_ROWS);

    expect(PermissionGate.getTeamIdsOfReader()).toEqual([]);
  });
});

describe("a private record's scope, while who owns it is being read", () => {
  const NOTHING_HELD: HeldPermissions = {
    allowed: [],
    allowedProjectWide: [],
    blocked: [],
    blockedForSomeLabels: [],
  };

  beforeEach(() => {
    store(MAINTAINERS_ROWS);
  });

  test("hides the record's changes rather than lock them with a reason not known yet", () => {
    expect(
      PermissionGate.check(new Incident(), ModelAction.Update, {
        held: NOTHING_HELD,
        privateRecordReason: "",
      }),
    ).toEqual({ isAllowed: false });
  });

  test("still reads the record by the whole snapshot", () => {
    expect(
      PermissionGate.check(new Incident(), ModelAction.Read, {
        held: NOTHING_HELD,
        privateRecordReason: "",
      }),
    ).toEqual({ isAllowed: true });
  });
});
