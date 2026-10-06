import {
  PRIVATE_RECORD_BYPASS_PERMISSIONS,
  shouldBypassRecordPrivacy,
} from "../../../Server/Utils/PrivacyFilterUtil";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Who sees every private incident, alert and episode of a project, not only
 * the ones they own: root and master-admin contexts, and project owners and
 * admins - held by the rule every permission check follows, so a block row
 * for either role is no grant and a block with no labels on either takes it
 * away. The incident, alert and episode privacy filters all ask this one
 * helper.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const LABEL_ID: ObjectID = ObjectID.generate();

type RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [LABEL_ID] : [],
    isBlockPermission: Boolean(options?.isBlock),
  };
};

function propsWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  };
}

describe("shouldBypassRecordPrivacy", () => {
  test("is decided by the project owner and admin roles", () => {
    expect(PRIVATE_RECORD_BYPASS_PERMISSIONS).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
  });

  test("root and master-admin contexts see every record", () => {
    expect(shouldBypassRecordPrivacy({ isRoot: true })).toBe(true);
    expect(shouldBypassRecordPrivacy({ isMasterAdmin: true })).toBe(true);
  });

  test("a caller with no project sees only their own", () => {
    expect(
      shouldBypassRecordPrivacy({
        userId: ObjectID.generate(),
        userTenantAccessPermission: {},
      }),
    ).toBe(false);
  });

  test.each([
    ["a project owner", [row(Permission.ProjectOwner)], true],
    ["a project admin", [row(Permission.ProjectAdmin)], true],
    ["a project member", [row(Permission.ProjectMember)], false],
    [
      "someone whose only owner row is a block with no labels",
      [row(Permission.ProjectOwner, { isBlock: true })],
      false,
    ],
    [
      "someone whose only admin row is a block with labels",
      [row(Permission.ProjectAdmin, { isBlock: true, labelled: true })],
      false,
    ],
    [
      "an admin another team blocks from being an admin",
      [
        row(Permission.ProjectAdmin),
        row(Permission.ProjectAdmin, { isBlock: true }),
      ],
      false,
    ],
    [
      "an admin another team blocks from being an owner",
      [
        row(Permission.ProjectAdmin),
        row(Permission.ProjectOwner, { isBlock: true }),
      ],
      false,
    ],
    [
      "an admin whose team blocks the role for some labels",
      [
        row(Permission.ProjectAdmin),
        row(Permission.ProjectAdmin, { isBlock: true, labelled: true }),
      ],
      true,
    ],
  ] as Array<[string, Array<UserPermission>, boolean]>)(
    "%s",
    (_who: string, rows: Array<UserPermission>, expected: boolean) => {
      expect(shouldBypassRecordPrivacy(propsWith(rows))).toBe(expected);
    },
  );
});
