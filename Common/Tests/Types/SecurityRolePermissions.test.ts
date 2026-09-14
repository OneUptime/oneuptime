import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The Security role family.
 *
 * Security events, the Sigma rules written over them, the threat-intel feeds
 * and the SecOps connector shipped reading through the Telemetry tiers, because
 * they arrived beside logs and traces in ClickHouse. That made one grant out of
 * two decisions: "may read every log in the project" and "may read the SIEM"
 * were the same checkbox, and there was no way to give somebody the first
 * without the second, or the second without making them a project admin.
 *
 * These tests are about the catalogue half of the split - that the three tiers
 * exist, are grantable, and are shaped like every other domain family so the
 * team permission picker renders them without knowing anything about security.
 * SecurityDomainAccessControl.test.ts covers what they actually unlock, and
 * SecurityRoleAccess.test.ts covers what they deny.
 */

type TierName = "Admin" | "Member" | "Viewer";

const SECURITY_TIERS: Array<[TierName, Permission]> = [
  ["Admin", Permission.SecurityAdmin],
  ["Member", Permission.SecurityMember],
  ["Viewer", Permission.SecurityViewer],
];

type PropsForFunction = (permission: Permission) => PermissionProps | undefined;

const propsFor: PropsForFunction = (
  permission: Permission,
): PermissionProps | undefined => {
  return PermissionHelper.getAllPermissionProps().find(
    (candidate: PermissionProps) => {
      return candidate.permission === permission;
    },
  );
};

describe("Security role family", () => {
  test.each(SECURITY_TIERS)(
    "Security%s exists in the catalogue",
    (_tier: TierName, permission: Permission) => {
      expect(propsFor(permission)).toBeDefined();
    },
  );

  test.each(SECURITY_TIERS)(
    "Security%s is a role, not a granular permission",
    (_tier: TierName, permission: Permission) => {
      const props: PermissionProps = propsFor(permission) as PermissionProps;

      expect(props.isRolePermission).toBe(true);
      expect(props.isAccessControlPermission).toBe(false);
    },
  );

  /*
   * A role nobody can be given is decoration. isAssignableToTenant is what puts
   * it in front of an administrator in Settings -> Teams -> Permissions; without
   * it the split would exist in the model layer and be unreachable from the UI.
   */
  test.each(SECURITY_TIERS)(
    "Security%s can actually be granted to a team",
    (_tier: TierName, permission: Permission) => {
      const props: PermissionProps = propsFor(permission) as PermissionProps;

      expect(props.isAssignableToTenant).toBe(true);
      expect(
        PermissionHelper.getTenantPermissionProps().map(
          (candidate: PermissionProps) => {
            return candidate.permission;
          },
        ),
      ).toContain(permission);
    },
  );

  test.each(SECURITY_TIERS)(
    "Security%s is filed under the Security group",
    (_tier: TierName, permission: Permission) => {
      expect((propsFor(permission) as PermissionProps).group).toBe(
        PermissionGroup.Security,
      );
    },
  );

  /*
   * The picker renders props.title and props.description verbatim. An empty one
   * is a blank card an administrator has to guess at.
   */
  test.each(SECURITY_TIERS)(
    "Security%s reads as a role in the picker",
    (tier: TierName, permission: Permission) => {
      const props: PermissionProps = propsFor(permission) as PermissionProps;

      expect(props.title).toBe(`Security ${tier}`);
      expect(props.description.trim().length).toBeGreaterThan(0);
      expect(PermissionHelper.getTitle(permission)).toBe(`Security ${tier}`);
      expect(PermissionHelper.getDescription(permission).trim().length).toBe(
        props.description.trim().length,
      );
    },
  );

  test("getRolePermissionProps offers all three tiers", () => {
    const roles: Array<Permission> =
      PermissionHelper.getRolePermissionProps().map(
        (props: PermissionProps) => {
          return props.permission;
        },
      );

    expect(roles).toContain(Permission.SecurityAdmin);
    expect(roles).toContain(Permission.SecurityMember);
    expect(roles).toContain(Permission.SecurityViewer);
  });

  /*
   * Every other domain in the product is Admin/Member/Viewer, and the dashboard
   * groups roles by deriving the family name from the permission string. A
   * family missing a tier - or spelled differently - falls out of that grouping
   * silently. This asserts Security is spelled like its eleven siblings.
   */
  test("Security is a complete three-tier family like every other domain", () => {
    const roleNames: Set<string> = new Set(
      PermissionHelper.getRolePermissionProps().map(
        (props: PermissionProps) => {
          return props.permission.toString();
        },
      ),
    );

    const families: Array<string> = [
      "Incident",
      "Alert",
      "Monitor",
      "StatusPage",
      "OnCall",
      "ScheduledMaintenance",
      "Telemetry",
      "Settings",
      "Billing",
      "Workflow",
      "Runbook",
      "Security",
    ];

    const incomplete: Array<string> = [];

    for (const family of families) {
      for (const tier of ["Admin", "Member", "Viewer"]) {
        if (!roleNames.has(`${family}${tier}`)) {
          incomplete.push(`${family}${tier}`);
        }
      }
    }

    expect(incomplete).toEqual([]);
  });

  /*
   * The Security tiers are a separate grant from the Telemetry ones - that
   * separation is the entire feature. Aliasing two enum members to one string
   * has happened in this file before (the ScheduledMaintenanceTemplateOwner
   * pair), and it is invisible: granting either would confer both, which here
   * would silently hand the SIEM back to every Telemetry Admin.
   */
  test("no Security tier is an alias of a Telemetry tier", () => {
    const securityValues: Array<string> = [
      Permission.SecurityAdmin.toString(),
      Permission.SecurityMember.toString(),
      Permission.SecurityViewer.toString(),
    ];

    const telemetryValues: Array<string> = [
      Permission.TelemetryAdmin.toString(),
      Permission.TelemetryMember.toString(),
      Permission.TelemetryViewer.toString(),
    ];

    for (const value of securityValues) {
      expect(telemetryValues).not.toContain(value);
    }

    expect(new Set(securityValues).size).toBe(3);
  });
});
