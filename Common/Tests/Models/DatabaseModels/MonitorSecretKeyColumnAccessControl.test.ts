import Monitor from "../../../Models/DatabaseModels/Monitor";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/3360
 *
 * Monitor carries three bearer credentials as ordinary columns:
 *
 *   serverMonitorSecretKey    - authenticates every host agent reporting in
 *   incomingRequestSecretKey  - IS the heartbeat URL
 *   incomingEmailSecretKey    - IS the monitor's inbound address
 *
 * All three used to list Permission.Viewer in their read ACL. Viewer is the
 * least privilege OneUptime offers and is precisely what gets handed to a
 * dashboard, an auditor, a contractor or an automation -- so "read-only" also
 * meant "can read a live credential and then forge or suppress this monitor's
 * heartbeats". Redacting the secret out of MonitorLog.logBody (the other half
 * of the fix) does nothing about this path: it is a plain column select.
 *
 * The rule these tests encode is a single sentence: reading a monitor secret
 * requires the ability to ROTATE it. Anything weaker is a credential handed to
 * someone who cannot revoke it.
 */

const SECRET_KEY_COLUMNS: Array<string> = [
  "serverMonitorSecretKey",
  "incomingRequestSecretKey",
  "incomingEmailSecretKey",
];

/*
 * The read-only roles. Every one of these was on the read list before the fix,
 * and none of them can rotate a key.
 */
const READ_ONLY_PERMISSIONS: Array<Permission> = [
  Permission.Viewer,
  Permission.MonitorViewer,
  Permission.ReadProjectMonitor,
];

// The roles that can reset a monitor secret, and so may also see it.
const ROTATION_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.MonitorAdmin,
  Permission.MonitorMember,
  Permission.EditProjectMonitor,
];

const accessControl: Dictionary<ColumnAccessControl> =
  new Monitor().getColumnAccessControlForAllColumns();

type CanReadFunction = (
  columnName: string,
  userPermissions: Array<Permission>,
) => boolean;

/*
 * ColumnPermission.checkDataColumnPermissions, reduced to the question that
 * matters. Note what the server does when this is false: it THROWS
 * `User is not allowed to read on <column> column of Monitor` and the whole
 * request fails. There is no partial response -- which is why the dashboard
 * has to gate the select rather than the render.
 */
const canRead: CanReadFunction = (
  columnName: string,
  userPermissions: Array<Permission>,
): boolean => {
  const columnPermissions: Array<Permission> =
    accessControl[columnName]?.read || [];

  return PermissionHelper.doesPermissionsIntersect(
    userPermissions,
    columnPermissions,
  );
};

describe("Monitor secret key columns are not readable by read-only roles", () => {
  it.each(SECRET_KEY_COLUMNS)(
    "%s is unreadable by a Viewer-only principal",
    (columnName: string) => {
      /*
       * This is step 2 of the reproduction in the issue: an API key whose only
       * permission is Viewer.
       */
      expect(canRead(columnName, [Permission.Viewer])).toBe(false);
    },
  );

  it.each(SECRET_KEY_COLUMNS)(
    "%s is unreadable by every read-only role, individually",
    (columnName: string) => {
      for (const permission of READ_ONLY_PERMISSIONS) {
        expect(canRead(columnName, [permission])).toBe(false);
      }
    },
  );

  it.each(SECRET_KEY_COLUMNS)(
    "%s is unreadable even when all the read-only roles are held at once",
    (columnName: string) => {
      /*
       * Intersection semantics mean any single surviving read-only permission
       * re-opens the hole, so hold them all and assert the union is still
       * refused.
       */
      expect(canRead(columnName, READ_ONLY_PERMISSIONS)).toBe(false);
    },
  );

  it.each(SECRET_KEY_COLUMNS)(
    "%s names none of the read-only roles in its read ACL",
    (columnName: string) => {
      const readPermissions: Array<Permission> =
        accessControl[columnName]?.read || [];

      for (const permission of READ_ONLY_PERMISSIONS) {
        expect(readPermissions).not.toContain(permission);
      }
    },
  );
});

describe("Monitor secret key columns stay readable by the roles that can rotate them", () => {
  it.each(SECRET_KEY_COLUMNS)(
    "%s is readable by each rotation-capable role",
    (columnName: string) => {
      /*
       * The other failure mode. Locking these down too far breaks Monitor >
       * Settings for a project member, who legitimately needs the key to set
       * an agent up.
       */
      for (const permission of ROTATION_PERMISSIONS) {
        expect(canRead(columnName, [permission])).toBe(true);
      }
    },
  );

  it.each(SECRET_KEY_COLUMNS)(
    "%s gates read on exactly the same roles as update",
    (columnName: string) => {
      /*
       * The invariant, stated directly: you may see a monitor secret if and
       * only if you may replace it. If someone later widens read without
       * widening update, this is the test that should stop them and make them
       * say why.
       */
      const column: ColumnAccessControl | undefined = accessControl[columnName];

      expect(column).toBeDefined();
      expect([...(column?.read || [])].sort()).toEqual(
        [...(column?.update || [])].sort(),
      );
    },
  );

  it.each(SECRET_KEY_COLUMNS)(
    "%s is never writable on create",
    (columnName: string) => {
      // The keys are computed server-side by MonitorService, never supplied.
      expect(accessControl[columnName]?.create || []).toEqual([]);
    },
  );
});

describe("the rest of the monitor page still loads for a Viewer", () => {
  /*
   * Tightening the secret columns must not collaterally break the monitor view
   * for read-only users: an unreadable column in a select fails the WHOLE
   * request, so if any of these regressed, a Viewer would get an error screen
   * instead of a monitor. These are the other columns
   * Pages/Monitor/View/Index.tsx asks for.
   */
  const VIEWER_READABLE_COLUMNS: Array<string> = [
    "monitorType",
    "serverMonitorRequestReceivedAt",
    "incomingRequestMonitorHeartbeatCheckedAt",
    "incomingEmailMonitorHeartbeatCheckedAt",
    "incomingEmailMonitorLastEmailReceivedAt",
    "monitorSteps",
  ];

  it.each(VIEWER_READABLE_COLUMNS)(
    "%s is still readable by a Viewer",
    (columnName: string) => {
      expect(canRead(columnName, [Permission.Viewer])).toBe(true);
    },
  );
});

describe("the payload columns rely on redaction, not on access control", () => {
  /*
   * serverMonitorResponse and incomingMonitorRequest are the OTHER two places
   * the agent payload lands, and both remain Viewer-readable -- deliberately:
   * they are what the monitor page renders. That is exactly why the secret has
   * to be stripped at the ingest boundary (see MonitorPayloadRedaction) rather
   * than merely hidden behind a permission. If someone ever removes that
   * strip, no ACL here will catch it.
   *
   * This test is a signpost, not a guard. If these columns are deliberately
   * locked down later, delete it -- but do not delete the redaction.
   */
  it("serverMonitorResponse is readable by a Viewer", () => {
    expect(canRead("serverMonitorResponse", [Permission.Viewer])).toBe(true);
  });

  it("incomingMonitorRequest is readable by a Viewer", () => {
    expect(canRead("incomingMonitorRequest", [Permission.Viewer])).toBe(true);
  });
});
