import ObjectID from "../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../Types/Permission";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";

describe("Permission", () => {
  test("Permission.ProjectMember should be ProjectMember", () => {
    expect(Permission.ProjectMember).toBe("ProjectMember");
  });

  test("Permission.Public should be Public", () => {
    expect(Permission.Public).toBe("Public");
  });
});

/*
 * Integrity of the permission catalogue itself.
 *
 * Both invariants below were violated in this file for a long time and neither
 * failure was visible from the outside:
 *
 *  - CreateScheduledMaintenanceTemplateOwnerUser and ...OwnerTeam were declared
 *    with the string values of their non-template counterparts, so two distinct
 *    capabilities were one permission wearing two names. Granting either
 *    conferred both, and owner rows feed the Owned permission scope, so it
 *    widened access to scheduled maintenance events the holder did not own.
 *
 *  - Sixteen permissions had their PermissionProps object listed twice, so the
 *    dashboard's granular picker offered each of them twice.
 *
 * A duplicate is silent by construction: TypeScript is happy, every lookup
 * still resolves, and the only symptom is a picker entry that does not do what
 * its label says. These tests are the tripwire.
 */
describe("Permission catalogue integrity", () => {
  test("no two enum members share a string value", () => {
    const seen: Map<string, string> = new Map();
    const collisions: Array<string> = [];

    for (const [name, value] of Object.entries(Permission)) {
      const previous: string | undefined = seen.get(value);

      if (previous) {
        collisions.push(`${previous} and ${name} both = "${value}"`);
        continue;
      }

      seen.set(value, name);
    }

    expect(collisions).toEqual([]);
  });

  test("getAllPermissionProps has no duplicate permission entries", () => {
    const counts: Map<Permission, number> = new Map();

    for (const props of PermissionHelper.getAllPermissionProps()) {
      counts.set(props.permission, (counts.get(props.permission) || 0) + 1);
    }

    const duplicates: Array<string> = [];
    for (const [permission, count] of counts) {
      if (count > 1) {
        duplicates.push(`${permission} x${count}`);
      }
    }

    expect(duplicates).toEqual([]);
  });

  test("every props entry round-trips through getTitle and getDescription", () => {
    /*
     * getTitle/getDescription take the FIRST match while
     * getAllPermissionPropsAsDictionary is last-wins. With duplicates present
     * those two disagree, and the dashboard and the API reference then show
     * different text for the same permission.
     */
    for (const props of PermissionHelper.getAllPermissionProps()) {
      expect(PermissionHelper.getTitle(props.permission)).toBe(props.title);
      expect(PermissionHelper.getDescription(props.permission)).toBe(
        props.description,
      );
    }
  });

  test("the props dictionary covers every props entry", () => {
    const dictionary: Record<string, PermissionProps> =
      PermissionHelper.getAllPermissionPropsAsDictionary() as Record<
        string,
        PermissionProps
      >;

    for (const props of PermissionHelper.getAllPermissionProps()) {
      expect(dictionary[props.permission]).toBeDefined();
      expect(dictionary[props.permission]!.title).toBe(props.title);
    }
  });

  test("no props entry is keyed to a permission from another resource family", () => {
    /*
     * The template-owner bug was a mis-keyed entry: the title said "Template"
     * while the permission pointed at the non-template member. Catch the shape
     * generically — a title containing "Template" must belong to a permission
     * whose name contains "Template", and vice versa.
     */
    const mismatched: Array<string> = [];

    for (const props of PermissionHelper.getAllPermissionProps()) {
      const titleSaysTemplate: boolean = props.title.includes("Template");
      const keySaysTemplate: boolean = props.permission
        .toString()
        .includes("Template");

      if (titleSaysTemplate !== keySaysTemplate) {
        mismatched.push(`${props.permission} titled "${props.title}"`);
      }
    }

    expect(mismatched).toEqual([]);
  });

  test("every tenant-assignable permission has a non-empty title and description", () => {
    const bad: Array<string> = [];

    for (const props of PermissionHelper.getTenantPermissionProps()) {
      if (!props.title.trim() || !props.description.trim()) {
        bad.push(props.permission.toString());
      }
    }

    expect(bad).toEqual([]);
  });

  test("roles and granular permissions partition the assignable set", () => {
    const assignable: Array<PermissionProps> =
      PermissionHelper.getTenantPermissionProps();
    const roles: Array<PermissionProps> =
      PermissionHelper.getRolePermissionProps();

    const granular: Array<PermissionProps> = assignable.filter(
      (props: PermissionProps) => {
        return !props.isRolePermission;
      },
    );

    expect(roles.length + granular.length).toBe(assignable.length);
    expect(roles.length).toBeGreaterThan(10);
    expect(granular.length).toBeGreaterThan(100);
  });
});

const makeRow: (
  permission: Permission,
  scope: PermissionScope | undefined,
  labelIds?: Array<ObjectID>,
) => UserPermission = (
  permission: Permission,
  scope: PermissionScope | undefined,
  labelIds: Array<ObjectID> = [],
): UserPermission => {
  return {
    _type: "UserPermission",
    permission,
    labelIds,
    scope,
  };
};

describe("PermissionHelper label/scope filtering", () => {
  /*
   * Regression coverage for the bug where a team permission with
   * scope=Labels on a role permission (IncidentViewer, MonitorViewer,
   * Viewer, …) was treated as an unconditional grant because the
   * legacy filter consulted the per-permission `isAccessControlPermission`
   * flag instead of the explicit scope on the row.
   */

  test("getNonAccessControlPermissions: scope=All counts as unrestricted", () => {
    const rows: Array<UserPermission> = [
      makeRow(Permission.IncidentViewer, PermissionScope.All, []),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([
      Permission.IncidentViewer,
    ]);
  });

  test("getNonAccessControlPermissions: scope=Labels with labels is restricted (NOT included)", () => {
    const labelId: ObjectID = ObjectID.generate();
    const rows: Array<UserPermission> = [
      makeRow(Permission.IncidentViewer, PermissionScope.Labels, [labelId]),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([]);
  });

  test("getNonAccessControlPermissions: scope=Labels with empty labels is treated as unrestricted (legacy parity)", () => {
    const rows: Array<UserPermission> = [
      makeRow(Permission.IncidentViewer, PermissionScope.Labels, []),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([
      Permission.IncidentViewer,
    ]);
  });

  test("getNonAccessControlPermissions: scope=Owned is excluded (OwnedScope handles it)", () => {
    const rows: Array<UserPermission> = [
      makeRow(Permission.IncidentViewer, PermissionScope.Owned, []),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([]);
  });

  test("getNonAccessControlPermissions: legacy row (scope undefined, no labels) is unrestricted", () => {
    const rows: Array<UserPermission> = [
      makeRow(Permission.CurrentUser, undefined, []),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([
      Permission.CurrentUser,
    ]);
  });

  test("getAccessControlPermissions: role permission with scope=Labels + labels is collected", () => {
    const labelId: ObjectID = ObjectID.generate();
    const row: UserPermission = makeRow(
      Permission.IncidentViewer,
      PermissionScope.Labels,
      [labelId],
    );
    expect(PermissionHelper.getAccessControlPermissions([row])).toEqual([row]);
  });

  test("getAccessControlPermissions: granular permission with scope=Labels + labels is collected", () => {
    const labelId: ObjectID = ObjectID.generate();
    const row: UserPermission = makeRow(
      Permission.ReadProjectIncident,
      PermissionScope.Labels,
      [labelId],
    );
    expect(PermissionHelper.getAccessControlPermissions([row])).toEqual([row]);
  });

  test("getAccessControlPermissions: scope=All with labels is NOT collected (All wins over labels)", () => {
    const labelId: ObjectID = ObjectID.generate();
    const row: UserPermission = makeRow(
      Permission.IncidentViewer,
      PermissionScope.All,
      [labelId],
    );
    expect(PermissionHelper.getAccessControlPermissions([row])).toEqual([]);
  });

  test("getAccessControlPermissions: scope=Owned never contributes a label filter", () => {
    const labelId: ObjectID = ObjectID.generate();
    const row: UserPermission = makeRow(
      Permission.IncidentViewer,
      PermissionScope.Owned,
      [labelId],
    );
    expect(PermissionHelper.getAccessControlPermissions([row])).toEqual([]);
  });

  test("Mixed: All row on a different permission does NOT suppress a Labels row's filter", () => {
    const labelId: ObjectID = ObjectID.generate();
    const rows: Array<UserPermission> = [
      makeRow(Permission.MonitorViewer, PermissionScope.All, []),
      makeRow(Permission.IncidentViewer, PermissionScope.Labels, [labelId]),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([
      Permission.MonitorViewer,
    ]);
    expect(PermissionHelper.getAccessControlPermissions(rows)).toEqual([
      rows[1],
    ]);
  });
});
