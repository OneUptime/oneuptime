import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import Log from "../../../../Models/AnalyticsModels/Log";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import ThreatIntelIndicator from "../../../../Models/AnalyticsModels/ThreatIntelIndicator";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The SIEM's ClickHouse tables go through a different gate from the Postgres
 * ones - AnalyticsDatabase/ModelPermission rather than TablePermission - and it
 * is the gate the /security-events CRUD API and the AI security tools both run
 * through. The Security tiers have to hold on this path too, and one thing that
 * only exists on this path has to be checked here: the
 * *AllOperationalResources wildcards.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ModelPermission as any).checkModelLevelPermissions(
      modelType,
      props,
      requestType,
    );
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

const ANALYTICS_SIEM_MODELS: Array<[string, ModelType]> = [
  ["SecurityEvent", SecurityEvent],
  ["ThreatIntelIndicator", ThreatIntelIndicator],
];

describe("Security events through the analytics permission gate", () => {
  test.each(ANALYTICS_SIEM_MODELS)(
    "a Security Viewer can read %s",
    (_name: string, modelType: ModelType) => {
      expect(canRead(modelType, makeProps([Permission.SecurityViewer]))).toBe(
        true,
      );
    },
  );

  test.each(ANALYTICS_SIEM_MODELS)(
    "a Telemetry Admin cannot read %s",
    (_name: string, modelType: ModelType) => {
      expect(canRead(modelType, makeProps([Permission.TelemetryAdmin]))).toBe(
        false,
      );
    },
  );

  test.each(ANALYTICS_SIEM_MODELS)(
    "a plain project member cannot read %s",
    (_name: string, modelType: ModelType) => {
      expect(canRead(modelType, makeProps([Permission.ProjectMember]))).toBe(
        false,
      );
    },
  );

  test.each(ANALYTICS_SIEM_MODELS)(
    "the project-wide Viewer cannot read %s",
    (_name: string, modelType: ModelType) => {
      expect(canRead(modelType, makeProps([Permission.Viewer]))).toBe(false);
    },
  );

  /*
   * The pairing the split exists for, on the analytics path: the same principal
   * that reads every log in the project reads no security events, and the
   * security principal reads no logs.
   */
  test("logs and security events are separate grants", () => {
    const telemetryViewer: DatabaseCommonInteractionProps = makeProps([
      Permission.TelemetryViewer,
    ]);
    const securityViewer: DatabaseCommonInteractionProps = makeProps([
      Permission.SecurityViewer,
    ]);

    expect(canRead(Log, telemetryViewer)).toBe(true);
    expect(canRead(SecurityEvent, telemetryViewer)).toBe(false);

    expect(canRead(SecurityEvent, securityViewer)).toBe(true);
    expect(canRead(Log, securityViewer)).toBe(false);
  });

  /*
   * The wildcard door.
   *
   * @OperationalResource() widens an analytics table's permission list with
   * ReadAllOperationalResources and its siblings, and SecurityEvent carried the
   * decorator because it was written as a copy of Log. That grant's own
   * description is "all operational resources in this project (Monitor,
   * Incident, Alert, StatusPage, etc.)" - somebody handing it to an integration
   * is not deciding to hand over the SIEM, and it is a granular permission
   * rather than a role, so none of the role-level assertions elsewhere would
   * have noticed it staying open.
   *
   * Log keeps the decorator, which is what makes this a real assertion rather
   * than a check that the wildcard mechanism is broken.
   */
  test("the operational-resource wildcards do not reach security events", () => {
    const wildcardHolder: DatabaseCommonInteractionProps = makeProps([
      Permission.ReadAllOperationalResources,
      Permission.EditAllOperationalResources,
      Permission.DeleteAllOperationalResources,
      Permission.CreateAllOperationalResources,
    ]);

    expect(canRead(Log, wildcardHolder)).toBe(true);

    for (const requestType of [
      DatabaseRequestType.Read,
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
      DatabaseRequestType.Create,
    ]) {
      expect(can(SecurityEvent, wildcardHolder, requestType)).toBe(false);
    }
  });

  /*
   * Owned-scope filtering keys off @OwnedThrough, not @OperationalResource, so
   * dropping the latter must not have taken "this team only sees the services
   * it owns" with it.
   */
  test("security events are still ownable through their primary entity", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((new SecurityEvent() as any).ownedThrough).toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((new SecurityEvent() as any).isOperationalResource).toBeFalsy();
  });

  test("Security Viewer is read-only on the analytics tables too", () => {
    const securityViewer: DatabaseCommonInteractionProps = makeProps([
      Permission.SecurityViewer,
    ]);

    for (const requestType of [
      DatabaseRequestType.Create,
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect(can(SecurityEvent, securityViewer, requestType)).toBe(false);
    }
  });

  test("Security Admin can purge security events, Security Member cannot", () => {
    expect(
      can(
        SecurityEvent,
        makeProps([Permission.SecurityAdmin]),
        DatabaseRequestType.Delete,
      ),
    ).toBe(true);

    expect(
      can(
        SecurityEvent,
        makeProps([Permission.SecurityMember]),
        DatabaseRequestType.Delete,
      ),
    ).toBe(false);
  });

  test("the project's own administrators still reach the analytics tables", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]) {
      for (const [, modelType] of ANALYTICS_SIEM_MODELS) {
        expect(canRead(modelType, makeProps([permission]))).toBe(true);
      }
    }
  });

  test("a granular ReadSecurityEvent key still works on its own", () => {
    expect(
      canRead(SecurityEvent, makeProps([Permission.ReadSecurityEvent])),
    ).toBe(true);
  });
});
