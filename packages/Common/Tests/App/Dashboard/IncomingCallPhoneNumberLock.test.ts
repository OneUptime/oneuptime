import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The number picker of an incoming call policy (Add Phone Number, and
 * Release beside each number) is offered to exactly the people the
 * phone-number routes let in (Common/Utils/IncomingCall
 * /IncomingCallPhoneNumberAccess): adding a number looks numbers up and
 * then reserves or attaches one, so it needs the read of incoming call
 * policies and of call and SMS settings and the edit of incoming call
 * policies; releasing one needs the edit. The Settings roles that own
 * incoming call policies may; a Viewer or a Settings Viewer may not.
 *
 * For someone the dashboard knows may not, the button is locked, and its
 * tooltip says in one plain sentence what it takes. Someone it does not know
 * about yet (the permissions not loaded) keeps the button, and the server
 * decides. A team's block row is never a grant, and a block with no labels
 * takes the permission away. A master admin is never locked out.
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): string => {
        return "7c000000-0000-4000-8000-000000000001";
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import {
  getAddPhoneNumberLock,
  getReleasePhoneNumberLock,
  INCOMING_CALL_PHONE_NUMBER_LOCKED_TOOLTIPS,
  IncomingCallPhoneNumberLock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/IncomingCallPhoneNumberLock";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";

const PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000001",
);
const LABEL_ID: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000002");

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

function row(
  permission: Permission,
  isBlockPermission: boolean = false,
  labelIds?: Array<ObjectID>,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds || [],
    isBlockPermission: isBlockPermission,
  };
}

// What the API's permission headers leave in storage for this project.
function storeSnapshot(rows: Array<UserPermission>): void {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    projectIds: [PROJECT_ID],
    globalPermissions: [Permission.Public, Permission.CurrentUser],
  });

  PermissionUtil.setProjectPermissions({
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  });
}

const OPEN: IncomingCallPhoneNumberLock = { isLocked: false };
const ADD_LOCKED: IncomingCallPhoneNumberLock = {
  isLocked: true,
  tooltip: INCOMING_CALL_PHONE_NUMBER_LOCKED_TOOLTIPS.add,
};
const RELEASE_LOCKED: IncomingCallPhoneNumberLock = {
  isLocked: true,
  tooltip: INCOMING_CALL_PHONE_NUMBER_LOCKED_TOOLTIPS.release,
};

beforeEach(() => {
  isMasterAdminForTest = false;
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

interface RoleCase {
  role: string;
  rows: Array<UserPermission>;
  add: IncomingCallPhoneNumberLock;
  release: IncomingCallPhoneNumberLock;
}

const ROLES: Array<RoleCase> = [
  {
    role: "Project Owner",
    rows: [row(Permission.ProjectOwner)],
    add: OPEN,
    release: OPEN,
  },
  {
    role: "Project Admin",
    rows: [row(Permission.ProjectAdmin)],
    add: OPEN,
    release: OPEN,
  },
  {
    role: "Project Member",
    rows: [row(Permission.ProjectMember)],
    add: OPEN,
    release: OPEN,
  },
  {
    role: "Settings Admin",
    rows: [row(Permission.SettingsAdmin)],
    add: OPEN,
    release: OPEN,
  },
  {
    role: "Settings Member",
    rows: [row(Permission.SettingsMember)],
    add: OPEN,
    release: OPEN,
  },
  {
    role: "Settings Viewer",
    rows: [row(Permission.SettingsViewer)],
    add: ADD_LOCKED,
    release: RELEASE_LOCKED,
  },
  {
    role: "Viewer",
    rows: [row(Permission.Viewer)],
    add: ADD_LOCKED,
    release: RELEASE_LOCKED,
  },
  {
    role: "Edit Incoming Call Policy alone: may release, may not look numbers up",
    rows: [row(Permission.EditProjectIncomingCallPolicy)],
    add: ADD_LOCKED,
    release: OPEN,
  },
  {
    role: "a Settings Member limited to some labels: the server checks the policy",
    rows: [row(Permission.SettingsMember, false, [LABEL_ID])],
    add: OPEN,
    release: OPEN,
  },
  {
    role: "a Settings Member whose team blocks Edit Incoming Call Policy",
    rows: [
      row(Permission.SettingsMember),
      row(Permission.EditProjectIncomingCallPolicy, true),
    ],
    add: ADD_LOCKED,
    release: RELEASE_LOCKED,
  },
  {
    role: "a Settings Admin whose team blocks Read Call and SMS",
    rows: [
      row(Permission.SettingsAdmin),
      row(Permission.ReadProjectCallSMSConfig, true),
    ],
    add: ADD_LOCKED,
    release: OPEN,
  },
  {
    role: "a Project Member whose team blocks Edit Incoming Call Policy for some labels",
    rows: [
      row(Permission.ProjectMember),
      row(Permission.EditProjectIncomingCallPolicy, true, [LABEL_ID]),
    ],
    add: OPEN,
    release: OPEN,
  },
  {
    role: "a member whose only row is a block",
    rows: [row(Permission.SettingsMember, true)],
    add: ADD_LOCKED,
    release: RELEASE_LOCKED,
  },
  {
    role: "Incident Member",
    rows: [row(Permission.IncidentMember)],
    add: ADD_LOCKED,
    release: RELEASE_LOCKED,
  },
];

describe("the number picker is offered to the incoming call policy's roles", () => {
  test.each(ROLES)("$role", (roleCase: RoleCase) => {
    storeSnapshot(roleCase.rows);

    expect(getAddPhoneNumberLock()).toEqual(roleCase.add);
    expect(getReleasePhoneNumberLock()).toEqual(roleCase.release);
  });

  test("a snapshot handed in is read the same way as the stored one", () => {
    expect(
      getAddPhoneNumberLock({
        held: HeldPermissionsUtil.fromRows({
          rows: [row(Permission.SettingsViewer)],
        }),
      }),
    ).toEqual(ADD_LOCKED);
    expect(
      getReleasePhoneNumberLock({
        held: HeldPermissionsUtil.fromRows({
          rows: [row(Permission.SettingsMember)],
        }),
      }),
    ).toEqual(OPEN);
  });

  test("before the permissions have loaded nothing is locked: the server decides", () => {
    expect(getAddPhoneNumberLock()).toEqual(OPEN);
    expect(getReleasePhoneNumberLock()).toEqual(OPEN);
  });

  test("a master admin is never locked out", () => {
    isMasterAdminForTest = true;
    storeSnapshot([row(Permission.Viewer)]);

    expect(getAddPhoneNumberLock()).toEqual(OPEN);
    expect(getReleasePhoneNumberLock()).toEqual(OPEN);
  });

  test("the tooltips say what each button takes, in one sentence", () => {
    expect(INCOMING_CALL_PHONE_NUMBER_LOCKED_TOOLTIPS).toEqual({
      add: "Adding a phone number needs permission to edit incoming call policies and to read call and SMS settings.",
      release:
        "Releasing a phone number needs permission to edit incoming call policies.",
    });
  });
});

describe("PhoneNumberPurchase locks its buttons with the picker's rule", () => {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, "Components/CallSMS/PhoneNumberPurchase.tsx"),
    "utf8",
  );

  test("it reads both locks", () => {
    expect(source).toContain(
      "const addLock: IncomingCallPhoneNumberLock = getAddPhoneNumberLock();",
    );
    expect(source).toContain(
      "const releaseLock: IncomingCallPhoneNumberLock = getReleasePhoneNumberLock();",
    );
  });

  test("Release is disabled with its tooltip, and does nothing while locked", () => {
    expect(source).toContain("disabled={releaseLock.isLocked}");
    expect(source).toContain("tooltip={releaseLock.tooltip}");
    expect(source).toMatch(
      /if \(releaseLock\.isLocked\) \{\s*return;\s*\}\s*setPhoneNumberToRelease\(phoneNumber\);/,
    );
  });

  test("both Add Phone Number buttons lock, and the picker never opens while locked", () => {
    // The inline button and the card's button.
    expect(source).toContain(
      "disabled={!props.projectCallSMSConfigId || addLock.isLocked}",
    );
    expect(source).toContain(
      "disabled: !props.projectCallSMSConfigId || addLock.isLocked,",
    );
    expect(source.match(/getAddButtonTooltip\(\)/g)?.length).toBe(2);
    expect(source).toMatch(
      /const openConfigureModal: \(\) => void = \(\): void => \{\s*if \(addLock\.isLocked\) \{\s*return;\s*\}/,
    );
  });

  test("the tooltip names what the caller lacks before a missing Twilio configuration", () => {
    const tooltipBody: string =
      source.split("const getAddButtonTooltip")[1]?.split("};")[0] || "";

    expect(tooltipBody.indexOf("addLock.isLocked")).toBeGreaterThan(-1);
    expect(tooltipBody.indexOf("addLock.isLocked")).toBeLessThan(
      tooltipBody.indexOf("!props.projectCallSMSConfigId"),
    );
  });
});
