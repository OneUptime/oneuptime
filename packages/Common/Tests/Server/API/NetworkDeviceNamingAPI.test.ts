import {
  assertCanApplyNamingRules,
  canReadNamingRules,
  previewForPerson,
  readPlanDeviceIds,
  readRenames,
} from "../../../Server/API/NetworkDeviceNamingAPI";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import {
  DeviceNamingOutcome,
  DeviceNamingPreview,
  MAX_DEVICES_PER_NAMING_PLAN,
  MAX_RENAMES_PER_NAMING_APPLY,
} from "../../../Types/NetworkDevice/DeviceNaming";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The naming rules' HTTP endpoints (OneUptime issue #6619) check what they
 * are asked before the engine reads anything as root:
 *
 *   - applying the rules, and its preview, rename devices across the
 *     project, so they take what every network rule's Run now takes: edit on
 *     the naming rules, and edit on every network device by a grant that
 *     reaches the whole project;
 *   - an import's preview says which rule named a host only to someone who
 *     may read the rules;
 *   - a plan's devices and an apply's renames are read strictly: a wrong
 *     shape is refused with a sentence, never half-read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const DEVICE_ID: string = "00000000-0000-4000-8000-000000000001";

function userWith(
  permissions: Array<Permission>,
  labelIds: Array<ObjectID> = [],
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: labelIds,
        isBlockPermission: false,
      };
    }),
  } as UserTenantAccessPermission;

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

describe("who may apply the naming rules", () => {
  test("a project admin may", () => {
    expect(() => {
      assertCanApplyNamingRules(userWith([Permission.ProjectAdmin]));
    }).not.toThrow();
  });

  test("editing the rules and every device, by project-wide grants, is enough", () => {
    expect(() => {
      assertCanApplyNamingRules(
        userWith([
          Permission.EditNetworkDeviceNamingRule,
          Permission.EditNetworkDevice,
        ]),
      );
    }).not.toThrow();
  });

  test("editing devices without editing the rules is not", () => {
    expect(() => {
      assertCanApplyNamingRules(userWith([Permission.EditNetworkDevice]));
    }).toThrow(NotAuthorizedException);
  });

  test("editing the rules without editing devices is not", () => {
    expect(() => {
      assertCanApplyNamingRules(
        userWith([Permission.EditNetworkDeviceNamingRule]),
      );
    }).toThrow(NotAuthorizedException);
  });

  test("a grant limited to some labels does not reach every device", () => {
    expect(() => {
      assertCanApplyNamingRules(
        userWith(
          [
            Permission.EditNetworkDeviceNamingRule,
            Permission.EditNetworkDevice,
          ],
          [new ObjectID("55555555-5555-4555-8555-555555555555")],
        ),
      );
    }).toThrow(NotAuthorizedException);
  });

  test("a viewer may not", () => {
    expect(() => {
      assertCanApplyNamingRules(userWith([Permission.Viewer]));
    }).toThrow(NotAuthorizedException);
  });

  test("a master admin may, as the write path lets them", () => {
    expect(() => {
      assertCanApplyNamingRules({ isMasterAdmin: true });
    }).not.toThrow();
  });
});

describe("an import's preview, as the person may see it", () => {
  const preview: DeviceNamingPreview = {
    hasRules: true,
    items: [
      {
        key: "10.48.145.51",
        discoveredName: "dmb-1",
        outcome: DeviceNamingOutcome.Named,
        name: "UN1216MNUPLR01",
        ruleId: "rule-1",
        ruleName: "Menu boards",
      },
    ],
  };

  test("someone who may read the rules sees which rule named each host", () => {
    expect(previewForPerson(preview, true)).toBe(preview);
    expect(canReadNamingRules(userWith([Permission.ProjectMember]))).toBe(
      true,
    );
    expect(
      canReadNamingRules(userWith([Permission.ReadNetworkDeviceNamingRule])),
    ).toBe(true);
  });

  test("someone who may not sees the names, not the rules", () => {
    expect(previewForPerson(preview, false)).toEqual({
      hasRules: true,
      items: [
        {
          key: "10.48.145.51",
          discoveredName: "dmb-1",
          outcome: DeviceNamingOutcome.Named,
          name: "UN1216MNUPLR01",
        },
      ],
    });
    expect(
      canReadNamingRules(userWith([Permission.ReadNetworkDeviceDiscoveryScan])),
    ).toBe(false);
  });
});

describe("reading a plan's devices", () => {
  test("none is every device of the project", () => {
    expect(readPlanDeviceIds(undefined)).toBeUndefined();
    expect(readPlanDeviceIds(null)).toBeUndefined();
  });

  test("a list of ids, trimmed", () => {
    expect(readPlanDeviceIds([` ${DEVICE_ID} `])).toEqual([DEVICE_ID]);
  });

  test("anything else is refused", () => {
    for (const value of ["all", [42], ["not-an-id"], { ids: [DEVICE_ID] }]) {
      expect(() => {
        readPlanDeviceIds(value);
      }).toThrow(BadDataException);
    }

    expect(() => {
      readPlanDeviceIds(
        Array.from({ length: MAX_DEVICES_PER_NAMING_PLAN + 1 }, () => {
          return DEVICE_ID;
        }),
      );
    }).toThrow(BadDataException);
  });
});

describe("reading an apply's renames", () => {
  test("each with the device, the name it has and the name it gets; a device listed twice once", () => {
    expect(
      readRenames([
        { deviceId: DEVICE_ID, fromName: "dmb-5", toName: "UN1216DRTPLR02" },
        { deviceId: DEVICE_ID, fromName: "dmb-5", toName: "OTHER" },
      ]),
    ).toEqual([
      { deviceId: DEVICE_ID, fromName: "dmb-5", toName: "UN1216DRTPLR02" },
    ]);
  });

  test("an empty list, a wrong shape and too many are refused", () => {
    for (const value of [
      [],
      "rename",
      [{ deviceId: "x", fromName: "a", toName: "b" }],
      [{ deviceId: DEVICE_ID, fromName: "a" }],
      [{ deviceId: DEVICE_ID, fromName: "a", toName: "  " }],
      [null],
    ]) {
      expect(() => {
        readRenames(value);
      }).toThrow(BadDataException);
    }

    expect(() => {
      readRenames(
        Array.from({ length: MAX_RENAMES_PER_NAMING_APPLY + 1 }, () => {
          return { deviceId: DEVICE_ID, fromName: "a", toName: "b" };
        }),
      );
    }).toThrow(BadDataException);
  });
});
