import Realtime from "../../../Server/Utils/Realtime";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may listen to a model's realtime events: whoever may read the model,
 * by the table half of the rule its CRUD read follows - an allow row for
 * its read list (or, for an operational resource, Read All Operational
 * Resources), and no block with no labels on that list. A block row is
 * never a grant. An event carries only the id of the record that changed;
 * the record is read through the CRUD path, which weighs labels, so a
 * block with labels does not keep the member out of the room.
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

type RowsFunction = (rows: Array<UserPermission>) => UserTenantAccessPermission;

const tenant: RowsFunction = (
  rows: Array<UserPermission>,
): UserTenantAccessPermission => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };
};

const MONITOR: string = new Monitor().tableName!;
const PROJECT: string = new Project().tableName!;

describe("Realtime.hasPermissionsByModelName", () => {
  test.each([
    ["a grant", [row(Permission.ReadProjectMonitor)], true],
    [
      "a member whose only row is a block with no labels",
      [row(Permission.ReadProjectMonitor, { isBlock: true })],
      false,
    ],
    [
      "a member whose only row is a block with labels",
      [row(Permission.ReadProjectMonitor, { isBlock: true, labelled: true })],
      false,
    ],
    [
      "a grant and another team's block with no labels on the read list",
      [
        row(Permission.ReadProjectMonitor),
        row(Permission.ProjectOwner, { isBlock: true }),
      ],
      false,
    ],
    [
      "a grant and a block with labels: the records are read through the CRUD path",
      [
        row(Permission.ReadProjectMonitor),
        row(Permission.ReadProjectMonitor, { isBlock: true, labelled: true }),
      ],
      true,
    ],
    [
      "Read All Operational Resources, for an operational resource",
      [row(Permission.ReadAllOperationalResources)],
      true,
    ],
    [
      "Read All Operational Resources, blocked itself",
      [
        row(Permission.ReadAllOperationalResources),
        row(Permission.ReadAllOperationalResources, { isBlock: true }),
      ],
      false,
    ],
  ] as Array<[string, Array<UserPermission>, boolean]>)(
    "Monitor events: %s",
    (_who: string, rows: Array<UserPermission>, expected: boolean) => {
      expect(Realtime.hasPermissionsByModelName(tenant(rows), MONITOR)).toBe(
        expected,
      );
    },
  );

  test("the wildcard does not open a model that is not an operational resource", () => {
    expect(
      Realtime.hasPermissionsByModelName(
        tenant([row(Permission.ReadAllOperationalResources)]),
        PROJECT,
      ),
    ).toBe(false);
  });

  test("an unknown model is refused", () => {
    expect(
      Realtime.hasPermissionsByModelName(
        tenant([row(Permission.ProjectOwner)]),
        "NotAModel",
      ),
    ).toBe(false);
  });

  test("a flat list of permissions is held as plain grants", () => {
    expect(
      Realtime.hasPermissionsByModelName(
        [Permission.ReadProjectMonitor],
        MONITOR,
      ),
    ).toBe(true);
    expect(
      Realtime.hasPermissionsByModelName(
        [Permission.ManageProjectBilling],
        MONITOR,
      ),
    ).toBe(false);
  });
});
