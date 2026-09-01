import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import DetectionRule from "../../../../../Models/DatabaseModels/DetectionRule";
import GoogleSecOpsConnection from "../../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../../Models/DatabaseModels/Label";
import TableView from "../../../../../Models/DatabaseModels/TableView";
import Team from "../../../../../Models/DatabaseModels/Team";
import ThreatIntelFeed from "../../../../../Models/DatabaseModels/ThreatIntelFeed";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The Security tiers as the API actually sees them.
 *
 * SecurityDomainAccessControl.test.ts reads the access lists off the model
 * classes; this drives the two gates a real request passes through -
 * TablePermission for the table and ColumnPermissions for the fields the page
 * selects - for principals built the way AccessTokenService builds them.
 *
 * The question behind the whole change: an operator asked whether the security
 * side of the product could be kept from people who have the rest of it. Before
 * the Security tiers the answer was no, because ProjectMember was on every SIEM
 * table's read list and every member of a project holds it. The "cannot"
 * assertions below are that answer changing.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * The permission set a signed-in member carries: whatever their teams grant,
 * plus the three the platform adds to anyone with a session inside a project.
 * ProjectUser is deliberately included - it is what makes this a fair test.
 * Every principal below is a real project member, so if a SIEM table were
 * readable through ProjectUser these tests would pass for the wrong reason and
 * the isolation would not exist.
 */
type MakePropsFunction = (
  grantedByTeams: Array<Permission>,
) => DatabaseCommonInteractionProps;

const makeProps: MakePropsFunction = (
  grantedByTeams: Array<Permission>,
): DatabaseCommonInteractionProps => {
  const permissions: Array<Permission> = [
    Permission.CurrentUser,
    Permission.UnAuthorizedSsoUser,
    Permission.ProjectUser,
    ...grantedByTeams,
  ];

  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
};

type ModelType = { new (): any };

type CanFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
  requestType: DatabaseRequestType,
) => boolean;

const can: CanFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
  requestType: DatabaseRequestType,
): boolean => {
  try {
    TablePermission.checkTableLevelPermissions(modelType, props, requestType);
    return true;
  } catch {
    return false;
  }
};

type CanReadFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
) => boolean;

const canRead: CanReadFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
): boolean => {
  return can(modelType, props, DatabaseRequestType.Read);
};

type ReadableColumnsFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
) => Array<string>;

const readableColumns: ReadableColumnsFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
): Array<string> => {
  return ColumnPermissions.getModelColumnsByPermissions(
    modelType,
    DatabaseCommonInteractionPropsUtil.getUserPermissions(
      props,
      PermissionType.Allow,
    ),
    DatabaseRequestType.Read,
  ).columns;
};

const SIEM_MODELS: Array<[string, ModelType]> = [
  ["DetectionRule", DetectionRule],
  ["ThreatIntelFeed", ThreatIntelFeed],
  ["GoogleSecOpsConnection", GoogleSecOpsConnection],
];

describe("Security roles reach the SIEM", () => {
  const securityViewer: DatabaseCommonInteractionProps = makeProps([
    Permission.SecurityViewer,
  ]);
  const securityMember: DatabaseCommonInteractionProps = makeProps([
    Permission.SecurityMember,
  ]);
  const securityAdmin: DatabaseCommonInteractionProps = makeProps([
    Permission.SecurityAdmin,
  ]);

  test.each(SIEM_MODELS)(
    "Security Viewer can read %s",
    (_name: string, modelType: ModelType) => {
      expect(canRead(modelType, securityViewer)).toBe(true);
    },
  );

  test.each(SIEM_MODELS)(
    "Security Member can read %s",
    (_name: string, modelType: ModelType) => {
      expect(canRead(modelType, securityMember)).toBe(true);
    },
  );

  test.each(SIEM_MODELS)(
    "Security Admin can read %s",
    (_name: string, modelType: ModelType) => {
      expect(canRead(modelType, securityAdmin)).toBe(true);
    },
  );

  /*
   * The columns the Detection Rules page selects. A table gate that passes and
   * a column gate that does not is a page that renders an error over itself,
   * which is how issue #3305 presented.
   */
  test("Security Viewer can select the columns the detection rules table reads", () => {
    const columns: Array<string> = readableColumns(
      DetectionRule,
      securityViewer,
    );

    for (const column of [
      "name",
      "description",
      "isEnabled",
      "projectId",
      "createdAt",
    ]) {
      expect(columns).toContain(column);
    }
  });

  test("Security Viewer cannot write anything", () => {
    const writes: Array<string> = [];

    for (const [name, modelType] of SIEM_MODELS) {
      for (const requestType of [
        DatabaseRequestType.Create,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        if (can(modelType, securityViewer, requestType)) {
          writes.push(`SecurityViewer can ${requestType} ${name}`);
        }
      }
    }

    expect(writes).toEqual([]);
  });

  test("Security Member can author detections and threat intel feeds", () => {
    for (const modelType of [DetectionRule, ThreatIntelFeed]) {
      for (const requestType of [
        DatabaseRequestType.Create,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        expect(can(modelType, securityMember, requestType)).toBe(true);
      }
    }
  });

  /*
   * Connecting the project to someone's Chronicle instance, and storing the
   * service-account key that reads it, is administration of the SIEM. A Member
   * uses the SIEM; they do not get to repoint it at another source.
   */
  test("Security Member cannot configure the SecOps connector", () => {
    expect(canRead(GoogleSecOpsConnection, securityMember)).toBe(true);

    for (const requestType of [
      DatabaseRequestType.Create,
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect(can(GoogleSecOpsConnection, securityMember, requestType)).toBe(
        false,
      );
    }
  });

  test("Security Admin can configure the SecOps connector", () => {
    for (const requestType of [
      DatabaseRequestType.Create,
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect(can(GoogleSecOpsConnection, securityAdmin, requestType)).toBe(
        true,
      );
    }
  });

  /*
   * A Sigma rule and a threat-intel feed each choose the severity of the alert
   * or incident they open, so both forms select from the severity tables. The
   * Security tiers hold no alert or incident permission, so without an explicit
   * read grant the dropdown fails and the rule cannot be configured - the same
   * shape of bug as the saved-views one, reached from a different direction.
   */
  test("Security roles can populate the severity dropdowns their forms use", () => {
    for (const props of [securityViewer, securityMember, securityAdmin]) {
      expect(canRead(AlertSeverity, props)).toBe(true);
      expect(canRead(IncidentSeverity, props)).toBe(true);

      expect(readableColumns(AlertSeverity, props)).toContain("name");
      expect(readableColumns(IncidentSeverity, props)).toContain("name");
    }
  });

  /*
   * That grant is read-only and stops at the severity list. A security role
   * must not become a back door into administering the alert domain.
   */
  test("the severity grant does not let a Security role edit severities", () => {
    for (const modelType of [AlertSeverity, IncidentSeverity]) {
      for (const requestType of [
        DatabaseRequestType.Create,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        expect(can(modelType, securityAdmin, requestType)).toBe(false);
      }
    }
  });

  /*
   * The Security tiers are a domain scope like any other, so the dashboard
   * furniture every page mounts has to keep working for someone who holds
   * nothing else - otherwise the security pages error the way the monitor pages
   * did in #3305.
   */
  test("a Security-only user can still use the dashboard around the page", () => {
    for (const modelType of [TableView, Label, Team]) {
      expect(canRead(modelType, securityViewer)).toBe(true);
    }
  });
});

describe("Nobody else reaches the SIEM", () => {
  /*
   * The regression guard. Each of these principals could read every security
   * event, detection rule and threat-intel feed in the project before the
   * Security tiers existed, and the request behind this change was to be able
   * to stop that.
   */
  const excluded: Array<[string, Permission]> = [
    ["Project Member", Permission.ProjectMember],
    ["project-wide Viewer", Permission.Viewer],
    ["Telemetry Admin", Permission.TelemetryAdmin],
    ["Telemetry Member", Permission.TelemetryMember],
    ["Telemetry Viewer", Permission.TelemetryViewer],
    ["Monitor Admin", Permission.MonitorAdmin],
    ["Incident Admin", Permission.IncidentAdmin],
    ["Settings Admin", Permission.SettingsAdmin],
  ];

  test.each(excluded)(
    "a %s cannot read the SIEM",
    (_label: string, permission: Permission) => {
      const props: DatabaseCommonInteractionProps = makeProps([permission]);
      const reachable: Array<string> = [];

      for (const [name, modelType] of SIEM_MODELS) {
        if (canRead(modelType, props)) {
          reachable.push(name);
        }
      }

      expect(reachable).toEqual([]);
    },
  );

  test.each(excluded)(
    "a %s cannot write to the SIEM either",
    (_label: string, permission: Permission) => {
      const props: DatabaseCommonInteractionProps = makeProps([permission]);
      const reachable: Array<string> = [];

      for (const [name, modelType] of SIEM_MODELS) {
        for (const requestType of [
          DatabaseRequestType.Create,
          DatabaseRequestType.Update,
          DatabaseRequestType.Delete,
        ]) {
          if (can(modelType, props, requestType)) {
            reachable.push(`${requestType} ${name}`);
          }
        }
      }

      expect(reachable).toEqual([]);
    },
  );

  /*
   * The exact pairing the operator asked about, stated in one place: the person
   * with the run of every log, metric and trace in the project, and the person
   * with the SIEM, can now be two different people - in both directions.
   */
  test("Telemetry and Security are independent grants", () => {
    const telemetryAdmin: DatabaseCommonInteractionProps = makeProps([
      Permission.TelemetryAdmin,
    ]);
    const securityAdmin: DatabaseCommonInteractionProps = makeProps([
      Permission.SecurityAdmin,
    ]);

    expect(canRead(TelemetryException, telemetryAdmin)).toBe(true);
    expect(canRead(DetectionRule, telemetryAdmin)).toBe(false);

    expect(canRead(DetectionRule, securityAdmin)).toBe(true);
    expect(canRead(TelemetryException, securityAdmin)).toBe(false);
  });

  /*
   * Owner and Admin keep their access: they are who grants the Security tiers,
   * so locking them out would leave a project with a SIEM nobody could open and
   * no way to discover why.
   */
  test("the project's own administrators are not locked out", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]) {
      const props: DatabaseCommonInteractionProps = makeProps([permission]);

      for (const [, modelType] of SIEM_MODELS) {
        expect(canRead(modelType, props)).toBe(true);
      }
    }
  });

  /*
   * An API key scoped to one granular permission is how integrations read the
   * SIEM without holding a role. The tiers were added beside these, not in
   * place of them.
   */
  test("a granular-only principal still reaches the table it was granted", () => {
    const detectionRuleReader: DatabaseCommonInteractionProps = makeProps([
      Permission.ReadProjectDetectionRule,
    ]);

    expect(canRead(DetectionRule, detectionRuleReader)).toBe(true);
    expect(canRead(ThreatIntelFeed, detectionRuleReader)).toBe(false);
    expect(canRead(GoogleSecOpsConnection, detectionRuleReader)).toBe(false);
  });
});
