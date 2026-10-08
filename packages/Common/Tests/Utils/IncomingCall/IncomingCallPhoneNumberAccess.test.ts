import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import IncomingCallPhoneNumberAccess, {
  INCOMING_CALL_PHONE_NUMBER_REFUSALS,
  IncomingCallPhoneNumberAction,
  IncomingCallPhoneNumberNeed,
} from "../../../Utils/IncomingCall/IncomingCallPhoneNumberAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may look up, add and release an incoming call policy's phone numbers
 * (Utils/IncomingCall/IncomingCallPhoneNumberAccess): the roles of the
 * policy the numbers serve, read from the models, by the one rule every
 * permission check follows (Types/HeldPermissions).
 *
 *  - Looking up (search Twilio, list the numbers the account has) needs the
 *    read of incoming call policies AND of call and SMS settings.
 *  - Changing them (reserve, attach, release) needs the edit of incoming
 *    call policies - the Settings roles that own the policies included.
 *
 * The server's route guard and the dashboard's number picker both read this
 * rule, so a role that may do one may do it in both.
 */

const LOOK_UP: Array<IncomingCallPhoneNumberAction> = [
  IncomingCallPhoneNumberAction.LookUp,
];
const CHANGE: Array<IncomingCallPhoneNumberAction> = [
  IncomingCallPhoneNumberAction.Change,
];
// What the dashboard's Add Phone Number asks: look up, then reserve or attach.
const ADD: Array<IncomingCallPhoneNumberAction> = [
  IncomingCallPhoneNumberAction.LookUp,
  IncomingCallPhoneNumberAction.Change,
];

function row(
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [ObjectID.generate()] : [],
    isBlockPermission: Boolean(options?.isBlock),
  };
}

function held(rows: Array<UserPermission | Permission>): HeldPermissions {
  return HeldPermissionsUtil.fromRows({
    rows: rows.map((entry: UserPermission | Permission): UserPermission => {
      return typeof entry === "string" ? row(entry) : entry;
    }),
  });
}

interface RoleCase {
  role: string;
  rows: Array<UserPermission | Permission>;
  lookUp: boolean;
  change: boolean;
}

const ROLE_CASES: Array<RoleCase> = [
  {
    role: "Project Owner",
    rows: [Permission.ProjectOwner],
    lookUp: true,
    change: true,
  },
  {
    role: "Project Admin",
    rows: [Permission.ProjectAdmin],
    lookUp: true,
    change: true,
  },
  {
    role: "Project Member",
    rows: [Permission.ProjectMember],
    lookUp: true,
    change: true,
  },
  {
    role: "Settings Admin, who owns incoming call policies",
    rows: [Permission.SettingsAdmin],
    lookUp: true,
    change: true,
  },
  {
    role: "Settings Member, who owns incoming call policies",
    rows: [Permission.SettingsMember],
    lookUp: true,
    change: true,
  },
  {
    role: "Settings Viewer: reads both, edits neither",
    rows: [Permission.SettingsViewer],
    lookUp: true,
    change: false,
  },
  {
    role: "Viewer: reads both, edits neither",
    rows: [Permission.Viewer],
    lookUp: true,
    change: false,
  },
  {
    role: "Read Incoming Call Policy alone: no read of call and SMS settings",
    rows: [Permission.ReadProjectIncomingCallPolicy],
    lookUp: false,
    change: false,
  },
  {
    role: "Read Call and SMS alone: no read of incoming call policies",
    rows: [Permission.ReadProjectCallSMSConfig],
    lookUp: false,
    change: false,
  },
  {
    role: "Read Incoming Call Policy and Read Call and SMS",
    rows: [
      Permission.ReadProjectIncomingCallPolicy,
      Permission.ReadProjectCallSMSConfig,
    ],
    lookUp: true,
    change: false,
  },
  {
    role: "Edit Incoming Call Policy alone",
    rows: [Permission.EditProjectIncomingCallPolicy],
    lookUp: false,
    change: true,
  },
  {
    role: "Edit Incoming Call Policy, Read Incoming Call Policy and Read Call and SMS",
    rows: [
      Permission.EditProjectIncomingCallPolicy,
      Permission.ReadProjectIncomingCallPolicy,
      Permission.ReadProjectCallSMSConfig,
    ],
    lookUp: true,
    change: true,
  },
  {
    role: "Incident Member: incoming call policies are not theirs",
    rows: [Permission.IncidentMember],
    lookUp: false,
    change: false,
  },
  {
    role: "On-Call Admin: incoming call policies take the Settings roles now",
    rows: [Permission.OnCallAdmin],
    lookUp: false,
    change: false,
  },
  {
    role: "a Settings Member whose grant is limited to some labels",
    rows: [row(Permission.SettingsMember, { labelled: true })],
    // The policy's own labels are checked when its update is (the route's record check).
    lookUp: true,
    change: true,
  },
  {
    role: "a Settings Member with a block with no labels on Edit Incoming Call Policy",
    rows: [
      Permission.SettingsMember,
      row(Permission.EditProjectIncomingCallPolicy, { isBlock: true }),
    ],
    lookUp: true,
    change: false,
  },
  {
    role: "a Settings Admin with a block with no labels on Read Call and SMS",
    rows: [
      Permission.SettingsAdmin,
      row(Permission.ReadProjectCallSMSConfig, { isBlock: true }),
    ],
    lookUp: false,
    change: true,
  },
  {
    role: "a Project Member with a block with labels on Edit Incoming Call Policy",
    rows: [
      Permission.ProjectMember,
      row(Permission.EditProjectIncomingCallPolicy, {
        isBlock: true,
        labelled: true,
      }),
    ],
    // A block with labels takes away the labelled policies, which the route's record check weighs.
    lookUp: true,
    change: true,
  },
  {
    role: "a Settings Member whose only row is a block",
    rows: [row(Permission.SettingsMember, { isBlock: true })],
    lookUp: false,
    change: false,
  },
  {
    role: "nobody: no rows",
    rows: [],
    lookUp: false,
    change: false,
  },
];

describe("IncomingCallPhoneNumberAccess: the roles of the incoming call policy", () => {
  test.each(ROLE_CASES)(
    "$role: look up $lookUp, change $change",
    (roleCase: RoleCase) => {
      const caller: HeldPermissions = held(roleCase.rows);

      expect(IncomingCallPhoneNumberAccess.mayDo(caller, LOOK_UP)).toBe(
        roleCase.lookUp,
      );
      expect(IncomingCallPhoneNumberAccess.mayDo(caller, CHANGE)).toBe(
        roleCase.change,
      );
      // Adding a number from the picker needs both.
      expect(IncomingCallPhoneNumberAccess.mayDo(caller, ADD)).toBe(
        roleCase.lookUp && roleCase.change,
      );
    },
  );

  test("no action is held by nobody", () => {
    expect(
      IncomingCallPhoneNumberAccess.mayDo(held([Permission.ProjectOwner]), []),
    ).toBe(false);
  });
});

describe("IncomingCallPhoneNumberAccess reads the models' own lists", () => {
  function permissionsOf(action: IncomingCallPhoneNumberAction): Array<{
    table: string | null;
    permissions: Array<Permission>;
  }> {
    return IncomingCallPhoneNumberAccess.getNeeds(action).map(
      (need: IncomingCallPhoneNumberNeed) => {
        return {
          table: need.model.tableName,
          permissions: IncomingCallPhoneNumberAccess.getPermissions(need),
        };
      },
    );
  }

  test("looking up needs the read of incoming call policies and of call and SMS settings", () => {
    expect(permissionsOf(IncomingCallPhoneNumberAction.LookUp)).toEqual([
      {
        table: "IncomingCallPolicy",
        permissions: new IncomingCallPolicy().getReadPermissions(),
      },
      {
        table: "ProjectCallSMSConfig",
        permissions: new ProjectCallSMSConfig().getReadPermissions(),
      },
    ]);
  });

  test("changing needs the edit of incoming call policies", () => {
    expect(permissionsOf(IncomingCallPhoneNumberAction.Change)).toEqual([
      {
        table: "IncomingCallPolicy",
        permissions: new IncomingCallPolicy().getUpdatePermissions(),
      },
    ]);
  });

  test("the Settings roles that own incoming call policies may change their numbers", () => {
    const editors: Array<Permission> =
      new IncomingCallPolicy().getUpdatePermissions();

    expect(editors).toEqual(
      expect.arrayContaining([
        Permission.SettingsAdmin,
        Permission.SettingsMember,
        Permission.EditProjectIncomingCallPolicy,
      ]),
    );
    // A Settings Viewer reads policies and does not change them.
    expect(editors).not.toContain(Permission.SettingsViewer);
  });

  test("an incoming call policy is not an operational resource: no wildcard opens its numbers", () => {
    expect(new IncomingCallPolicy().isOperationalResource).toBeFalsy();
    expect(new ProjectCallSMSConfig().isOperationalResource).toBeFalsy();
    expect(
      IncomingCallPhoneNumberAccess.mayDo(
        held([
          Permission.ReadAllOperationalResources,
          Permission.EditAllOperationalResources,
        ]),
        ADD,
      ),
    ).toBe(false);
  });

  test("a refusal says what each action needs, in plain words", () => {
    expect(
      INCOMING_CALL_PHONE_NUMBER_REFUSALS[IncomingCallPhoneNumberAction.LookUp],
    ).toBe(
      "Looking up phone numbers needs permission to read incoming call policies and call and SMS settings.",
    );
    expect(
      INCOMING_CALL_PHONE_NUMBER_REFUSALS[IncomingCallPhoneNumberAction.Change],
    ).toBe(
      "Adding or releasing a phone number needs permission to edit incoming call policies.",
    );
  });
});
