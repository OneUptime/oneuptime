import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import GoogleSecOpsConnection from "../../Models/DatabaseModels/GoogleSecOpsConnection";
import ThreatIntelFeed from "../../Models/DatabaseModels/ThreatIntelFeed";
import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import ThreatIntelIndicator from "../../Models/AnalyticsModels/ThreatIntelIndicator";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../Types/Dictionary";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * What the Security tiers unlock, and - more to the point - what nothing else
 * unlocks any more.
 *
 * The SIEM tables shipped with the same read list as Log: ProjectMember, the
 * project-wide Viewer, and the three Telemetry tiers. Every principal in a
 * project could therefore read every security event in it, and there was no
 * grant an administrator could withhold to change that. This file is the
 * regression guard on the split, at the declaration level: it reads the access
 * lists off the model classes and asserts both halves - the Security tiers are
 * present, and the broad roles are gone.
 *
 * The negative half is the one that matters. Adding Permission.ProjectMember
 * back to any one of these lists would restore the old behaviour completely and
 * break nothing else, so nothing but an assertion will catch it.
 */

/*
 * A uniform view over the two model kinds. Database models expose their access
 * lists as properties on the instance; analytics models expose them through
 * getters. The sweep below does not care which is which, and every SIEM table
 * has to be in here - a table left out is a table with no coverage at all.
 */
interface SecurityModel {
  name: string;
  read: Array<Permission>;
  create: Array<Permission>;
  update: Array<Permission>;
  delete: Array<Permission>;
  columns: Array<[string, ColumnAccessControl | null]>;
}

/*
 * getColumnAccessControlForAllColumns is the one accessor both base classes
 * declare - the database models build theirs from the @ColumnAccessControl
 * decorator, the analytics models from their column definitions - so the sweep
 * can walk a ClickHouse table and a Postgres one the same way.
 */
type ColumnsOfFunction = (model: {
  getColumnAccessControlForAllColumns: () => Dictionary<ColumnAccessControl>;
}) => Array<[string, ColumnAccessControl | null]>;

const columnsOf: ColumnsOfFunction = (model: {
  getColumnAccessControlForAllColumns: () => Dictionary<ColumnAccessControl>;
}): Array<[string, ColumnAccessControl | null]> => {
  const accessControlByColumn: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();

  return Object.keys(accessControlByColumn).map(
    (column: string): [string, ColumnAccessControl | null] => {
      return [column, accessControlByColumn[column] || null];
    },
  );
};

type BuildSecurityModelsFunction = () => Array<SecurityModel>;

const buildSecurityModels: BuildSecurityModelsFunction =
  (): Array<SecurityModel> => {
    const detectionRule: DetectionRule = new DetectionRule();
    const threatIntelFeed: ThreatIntelFeed = new ThreatIntelFeed();
    const googleSecOpsConnection: GoogleSecOpsConnection =
      new GoogleSecOpsConnection();
    const securityEvent: SecurityEvent = new SecurityEvent();
    const threatIntelIndicator: ThreatIntelIndicator =
      new ThreatIntelIndicator();

    return [
      {
        name: "DetectionRule",
        read: detectionRule.readRecordPermissions,
        create: detectionRule.createRecordPermissions,
        update: detectionRule.updateRecordPermissions,
        delete: detectionRule.deleteRecordPermissions,
        columns: columnsOf(detectionRule),
      },
      {
        name: "ThreatIntelFeed",
        read: threatIntelFeed.readRecordPermissions,
        create: threatIntelFeed.createRecordPermissions,
        update: threatIntelFeed.updateRecordPermissions,
        delete: threatIntelFeed.deleteRecordPermissions,
        columns: columnsOf(threatIntelFeed),
      },
      {
        name: "GoogleSecOpsConnection",
        read: googleSecOpsConnection.readRecordPermissions,
        create: googleSecOpsConnection.createRecordPermissions,
        update: googleSecOpsConnection.updateRecordPermissions,
        delete: googleSecOpsConnection.deleteRecordPermissions,
        columns: columnsOf(googleSecOpsConnection),
      },
      {
        name: "SecurityEvent",
        read: securityEvent.getReadPermissions(),
        create: securityEvent.getCreatePermissions(),
        update: securityEvent.getUpdatePermissions(),
        delete: securityEvent.getDeletePermissions(),
        columns: columnsOf(securityEvent),
      },
      {
        name: "ThreatIntelIndicator",
        read: threatIntelIndicator.getReadPermissions(),
        create: threatIntelIndicator.getCreatePermissions(),
        update: threatIntelIndicator.getUpdatePermissions(),
        delete: threatIntelIndicator.getDeletePermissions(),
        columns: columnsOf(threatIntelIndicator),
      },
    ];
  };

const SECURITY_MODELS: Array<SecurityModel> = buildSecurityModels();

/*
 * test.each needs the tuple type written down. Mapping to [name, model] infers
 * Array<Array<string | SecurityModel>>, and the per-case callback signature
 * then does not typecheck against it.
 */
const MODEL_CASES: Array<[string, SecurityModel]> = SECURITY_MODELS.map(
  (model: SecurityModel): [string, SecurityModel] => {
    return [model.name, model];
  },
);

/*
 * The roles that used to reach this data and must not any more.
 *
 * ProjectUser is in the list for the reason its own declaration gives: every
 * principal who has accepted an invitation holds it, so it is reserved for the
 * dashboard's shared furniture (labels, teams, saved views) and must never
 * appear on a table one role should be able to keep from another.
 */
const ROLES_THAT_MUST_NOT_REACH_THE_SIEM: Array<Permission> = [
  Permission.ProjectMember,
  Permission.ProjectUser,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
];

const SECURITY_TIERS: Array<Permission> = [
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
];

describe("Security domain access control", () => {
  test("the sweep actually covers every SIEM table", () => {
    expect(
      SECURITY_MODELS.map((model: SecurityModel) => {
        return model.name;
      }).sort(),
    ).toEqual([
      "DetectionRule",
      "GoogleSecOpsConnection",
      "SecurityEvent",
      "ThreatIntelFeed",
      "ThreatIntelIndicator",
    ]);
  });

  test.each(MODEL_CASES)(
    "%s is readable by all three Security tiers",
    (_name: string, model: SecurityModel) => {
      expect(model.read).toEqual(expect.arrayContaining(SECURITY_TIERS));
    },
  );

  /*
   * The point of the whole change. If this passes for the wrong reason - say a
   * table's read list is empty - the positive test above catches it.
   */
  test.each(MODEL_CASES)(
    "%s is not readable by any broadly-held role",
    (name: string, model: SecurityModel) => {
      const leaked: Array<string> = ROLES_THAT_MUST_NOT_REACH_THE_SIEM.filter(
        (permission: Permission) => {
          return model.read.includes(permission);
        },
      ).map((permission: Permission) => {
        return `${name} is readable by ${permission}`;
      });

      expect(leaked).toEqual([]);
    },
  );

  test.each(MODEL_CASES)(
    "%s cannot be written by any broadly-held role either",
    (name: string, model: SecurityModel) => {
      const leaked: Array<string> = [];

      for (const permission of ROLES_THAT_MUST_NOT_REACH_THE_SIEM) {
        for (const [operation, list] of [
          ["create", model.create],
          ["update", model.update],
          ["delete", model.delete],
        ] as Array<[string, Array<Permission>]>) {
          if (list.includes(permission)) {
            leaked.push(`${name} can be ${operation}d by ${permission}`);
          }
        }
      }

      expect(leaked).toEqual([]);
    },
  );

  /*
   * A project must never be locked out of its own data. Owner and Admin are the
   * principals who grant the Security tiers in the first place; if they could
   * not read the tables, a project that had not yet created a security team
   * would have no way to see what its SIEM had collected and no way to find out
   * that it needed to.
   */
  test.each(MODEL_CASES)(
    "%s stays readable by the project's own administrators",
    (_name: string, model: SecurityModel) => {
      expect(model.read).toContain(Permission.ProjectOwner);
      expect(model.read).toContain(Permission.ProjectAdmin);
    },
  );

  /*
   * The table gate is the first of two. A list request also runs through the
   * per-column read lists, so a table a Security Viewer may open whose columns
   * they may not select turns into an error on whichever field the page asked
   * for. This is the same failure that produced issue #3305 one level down.
   */
  test.each(MODEL_CASES)(
    "%s columns follow the table into the Security tiers",
    (name: string, model: SecurityModel) => {
      const missing: Array<string> = [];

      for (const [column, accessControl] of model.columns) {
        /*
         * `read: []` is a deliberate "nobody reads this through the API" -
         * GoogleSecOpsConnection.serviceAccountJson is the one that matters.
         * Those must stay closed, which the credential test below asserts.
         */
        if (!accessControl?.read || accessControl.read.length === 0) {
          continue;
        }

        for (const tier of SECURITY_TIERS) {
          if (!accessControl.read.includes(tier)) {
            missing.push(`${name}.${column} is missing ${tier}`);
          }
        }
      }

      expect(missing).toEqual([]);
    },
  );

  test.each(MODEL_CASES)(
    "%s columns are not readable by a broadly-held role",
    (name: string, model: SecurityModel) => {
      const leaked: Array<string> = [];

      for (const [column, accessControl] of model.columns) {
        for (const permission of ROLES_THAT_MUST_NOT_REACH_THE_SIEM) {
          if (accessControl?.read?.includes(permission)) {
            leaked.push(`${name}.${column} is readable by ${permission}`);
          }
        }
      }

      expect(leaked).toEqual([]);
    },
  );

  /*
   * The connector's service-account key is a live Google Cloud credential. It
   * was already closed to everyone before the Security tiers existed, and
   * giving the SIEM its own admin role must not have quietly opened it -
   * SecurityAdmin administers the connection, which is not the same as being
   * able to read the key back out of it.
   */
  test("the SecOps service-account key stays unreadable by everyone", () => {
    const model: GoogleSecOpsConnection = new GoogleSecOpsConnection();
    const accessControl: ColumnAccessControl | null =
      model.getColumnAccessControlFor("serviceAccountJson");

    expect(accessControl).toBeDefined();
    expect(accessControl?.read).toEqual([]);
  });

  /*
   * Tier semantics, so "Viewer" keeps meaning read-only and the three tiers
   * stay distinguishable from each other. A family whose Viewer can delete is
   * three names for one role.
   */
  test("Security Viewer is read-only everywhere", () => {
    const writes: Array<string> = [];

    for (const model of SECURITY_MODELS) {
      for (const [operation, list] of [
        ["create", model.create],
        ["update", model.update],
        ["delete", model.delete],
      ] as Array<[string, Array<Permission>]>) {
        if (list.includes(Permission.SecurityViewer)) {
          writes.push(`${model.name} can be ${operation}d by SecurityViewer`);
        }
      }
    }

    expect(writes).toEqual([]);
  });

  /*
   * Deleting a security event destroys the record of something that happened,
   * which is the one thing a SIEM exists to keep. It sits on the Admin tier for
   * the same reason retention policy does, and the same applies to purging
   * ingested indicators.
   */
  test("deleting SIEM records is an Admin-tier action", () => {
    const securityEvent: SecurityEvent = new SecurityEvent();
    const threatIntelIndicator: ThreatIntelIndicator =
      new ThreatIntelIndicator();

    for (const deletePermissions of [
      securityEvent.getDeletePermissions(),
      threatIntelIndicator.getDeletePermissions(),
    ]) {
      expect(deletePermissions).toContain(Permission.SecurityAdmin);
      expect(deletePermissions).not.toContain(Permission.SecurityMember);
    }
  });

  /*
   * Pointing the project at a Chronicle instance, and holding the credential
   * that reads it, is administration of the SIEM rather than use of it.
   */
  test("only the Admin tier configures the SecOps connector", () => {
    const model: GoogleSecOpsConnection = new GoogleSecOpsConnection();

    for (const list of [
      model.createRecordPermissions,
      model.updateRecordPermissions,
      model.deleteRecordPermissions,
    ]) {
      expect(list).toContain(Permission.SecurityAdmin);
      expect(list).not.toContain(Permission.SecurityMember);
      expect(list).not.toContain(Permission.SecurityViewer);
    }

    expect(model.readRecordPermissions).toContain(Permission.SecurityMember);
    expect(model.readRecordPermissions).toContain(Permission.SecurityViewer);
  });

  /*
   * The Member tier is what makes the family usable without handing out admin:
   * an analyst writes and tunes detections and subscribes to feeds. If Member
   * lost these, every rule change would need a project administrator.
   */
  test("the Member tier can author detections and feeds", () => {
    for (const model of [new DetectionRule(), new ThreatIntelFeed()]) {
      expect(model.createRecordPermissions).toContain(
        Permission.SecurityMember,
      );
      expect(model.updateRecordPermissions).toContain(
        Permission.SecurityMember,
      );
      expect(model.deleteRecordPermissions).toContain(
        Permission.SecurityMember,
      );
    }
  });

  /*
   * The granular Read/Create/Edit/Delete permissions predate the tiers and are
   * how an API key is scoped to exactly one operation. The tiers are an
   * addition, not a replacement, and dropping one would silently break every
   * key already issued against it.
   */
  test("the granular security permissions still work on their own", () => {
    const securityEvent: SecurityEvent = new SecurityEvent();

    expect(securityEvent.getReadPermissions()).toContain(
      Permission.ReadSecurityEvent,
    );
    expect(securityEvent.getCreatePermissions()).toContain(
      Permission.CreateSecurityEvent,
    );
    expect(securityEvent.getUpdatePermissions()).toContain(
      Permission.EditSecurityEvent,
    );
    expect(securityEvent.getDeletePermissions()).toContain(
      Permission.DeleteSecurityEvent,
    );

    const detectionRule: DetectionRule = new DetectionRule();

    expect(detectionRule.readRecordPermissions).toContain(
      Permission.ReadProjectDetectionRule,
    );
    expect(detectionRule.createRecordPermissions).toContain(
      Permission.CreateProjectDetectionRule,
    );
    expect(detectionRule.updateRecordPermissions).toContain(
      Permission.EditProjectDetectionRule,
    );
    expect(detectionRule.deleteRecordPermissions).toContain(
      Permission.DeleteProjectDetectionRule,
    );

    const threatIntelFeed: ThreatIntelFeed = new ThreatIntelFeed();

    expect(threatIntelFeed.readRecordPermissions).toContain(
      Permission.ReadProjectThreatIntelFeed,
    );
    expect(threatIntelFeed.createRecordPermissions).toContain(
      Permission.CreateProjectThreatIntelFeed,
    );
  });
});
