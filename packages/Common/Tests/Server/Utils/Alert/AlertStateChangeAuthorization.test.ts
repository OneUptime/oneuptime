import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../../Models/DatabaseModels/AlertOwnerUser";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Label from "../../../../Models/DatabaseModels/Label";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import Query from "../../../../Server/Types/Database/Query";
import AlertStateChangeAuthorization from "../../../../Server/Utils/Alert/AlertStateChangeAuthorization";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";

/*
 * AlertStateChangeAuthorization decides whether a caller may change the state
 * of a set of alerts that are then acknowledged for them as root (declaring an
 * incident with "acknowledge these alerts" ticked). These tests run the REAL
 * permission layer (ModelPermission and everything under it) against realistic
 * interaction props. Only the root reads the permission layer cannot make
 * without a database are stubbed: AlertService.findBy (the helper's two reads)
 * and, for the Owned scope, the AlertOwnerUser / AlertOwnerTeam lookups. The
 * second AlertService.findBy stub plays the database: it returns the rows the
 * scoped query would match, and each test pins the scope that query carries.
 */

type PermissionInput = {
  permission: Permission;
  isBlockPermission?: boolean;
  labelIds?: Array<ObjectID>;
  scope?: PermissionScope;
};

type FindBySpy = SpyInstance<typeof AlertService.findBy>;

type FindByArgument = Parameters<typeof AlertService.findBy>[0];

type RawClause = {
  sql: string;
  params: Array<unknown>;
};

type WriteSpies = {
  alertCreate: SpyInstance<typeof AlertService.create>;
  alertUpdateOneById: SpyInstance<typeof AlertService.updateOneById>;
  alertUpdateOneBy: SpyInstance<typeof AlertService.updateOneBy>;
  alertUpdateBy: SpyInstance<typeof AlertService.updateBy>;
  alertChangeState: SpyInstance<typeof AlertService.changeAlertState>;
  alertAcknowledge: SpyInstance<typeof AlertService.acknowledgeAlert>;
  timelineCreate: SpyInstance<typeof AlertStateTimelineService.create>;
};

const REFUSAL_MESSAGE: string =
  "You do not have permission to change the state of one or more of these alerts.";

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function createDatabaseProps(
  permissions: Array<PermissionInput>,
  options?: {
    userTeamIds?: Array<ObjectID>;
    withoutUser?: boolean;
    userType?: UserType;
  },
): DatabaseCommonInteractionProps {
  const userPermissions: Array<UserPermission> = permissions.map(
    (permissionInput: PermissionInput): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permissionInput.permission,
        isBlockPermission: permissionInput.isBlockPermission || false,
        labelIds: permissionInput.labelIds || [],
        scope: permissionInput.scope,
      };
    },
  );

  const tenantAccessPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId,
    permissions: userPermissions,
  };

  const globalAccessPermission: UserGlobalAccessPermission = {
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [projectId],
  };

  const props: DatabaseCommonInteractionProps = {
    tenantId: projectId,
    userTeamIds: options?.userTeamIds || [],
    userGlobalAccessPermission: globalAccessPermission,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantAccessPermission,
    },
  };

  if (!options?.withoutUser) {
    props.userId = userId;
  }

  if (options?.userType) {
    props.userType = options.userType;
  }

  return props;
}

function createLabel(name: string): Label {
  const label: Label = new Label(ObjectID.generate());
  label.name = name;
  return label;
}

// A row as the helper's first (root) read returns it: _id plus labels.
function createAlertRow(alertId: ObjectID, labels: Array<Label> = []): Alert {
  const alert: Alert = new Alert();
  alert.id = alertId;
  alert.labels = labels;
  return alert;
}

// A row as the helper's second (scoped) read returns it: _id only.
function createPermittedRow(alertId: ObjectID | string): Alert {
  const alert: Alert = new Alert();
  alert._id = alertId.toString();
  return alert;
}

function asFindOperator(value: unknown): FindOperator<unknown> {
  expect(value).toBeInstanceOf(FindOperator);
  return value as FindOperator<unknown>;
}

// The ids (or other values) bound into a Raw FindOperator such as QueryHelper.any.
function getRawParameterValues(value: unknown): Array<unknown> {
  return Object.values(asFindOperator(value).objectLiteralParameters || {});
}

function getRawClause(value: unknown): RawClause {
  const operator: FindOperator<unknown> = asFindOperator(value);
  const getSql: ((aliasPath: string) => string) | undefined = operator.getSql;

  return {
    sql: getSql ? getSql("COLUMN") : "",
    params: Object.values(operator.objectLiteralParameters || {}),
  };
}

function toIdStrings(ids: Array<ObjectID>): Array<string> {
  return ids.map((id: ObjectID): string => {
    return id.toString();
  });
}

function getFindByArgument(
  findBySpy: FindBySpy,
  callIndex: number,
): FindByArgument {
  const argument: FindByArgument | undefined =
    findBySpy.mock.calls[callIndex]?.[0];

  if (!argument) {
    throw new Error(`AlertService.findBy call ${callIndex} was not made`);
  }

  return argument;
}

function getQueryValue(query: Query<Alert>, key: string): unknown {
  return (query as Record<string, unknown>)[key];
}

function stubAlertReads(
  firstReadRows: Array<Alert>,
  permittedRows: Array<Alert>,
): FindBySpy {
  return jest
    .spyOn(AlertService, "findBy")
    .mockResolvedValueOnce(firstReadRows)
    .mockResolvedValueOnce(permittedRows);
}

function spyOnWrites(): WriteSpies {
  const unexpectedWrite: Error = new Error(
    "AlertStateChangeAuthorization must not write anything",
  );

  return {
    alertCreate: jest
      .spyOn(AlertService, "create")
      .mockRejectedValue(unexpectedWrite),
    alertUpdateOneById: jest
      .spyOn(AlertService, "updateOneById")
      .mockRejectedValue(unexpectedWrite),
    alertUpdateOneBy: jest
      .spyOn(AlertService, "updateOneBy")
      .mockRejectedValue(unexpectedWrite),
    alertUpdateBy: jest
      .spyOn(AlertService, "updateBy")
      .mockRejectedValue(unexpectedWrite),
    alertChangeState: jest
      .spyOn(AlertService, "changeAlertState")
      .mockRejectedValue(unexpectedWrite),
    alertAcknowledge: jest
      .spyOn(AlertService, "acknowledgeAlert")
      .mockRejectedValue(unexpectedWrite),
    timelineCreate: jest
      .spyOn(AlertStateTimelineService, "create")
      .mockRejectedValue(unexpectedWrite),
  };
}

function expectNoWrites(writeSpies: WriteSpies): void {
  expect(writeSpies.alertCreate).not.toHaveBeenCalled();
  expect(writeSpies.alertUpdateOneById).not.toHaveBeenCalled();
  expect(writeSpies.alertUpdateOneBy).not.toHaveBeenCalled();
  expect(writeSpies.alertUpdateBy).not.toHaveBeenCalled();
  expect(writeSpies.alertChangeState).not.toHaveBeenCalled();
  expect(writeSpies.alertAcknowledge).not.toHaveBeenCalled();
  expect(writeSpies.timelineCreate).not.toHaveBeenCalled();
}

describe("AlertStateChangeAuthorization.assertCanChangeStateOfAlerts", (): void => {
  let writeSpies: WriteSpies;
  let createPermissionSpy: SpyInstance<
    typeof ModelPermission.checkCreatePermissions
  >;
  let updateByModelSpy: SpyInstance<
    typeof ModelPermission.checkUpdatePermissionByModel
  >;
  let updateQuerySpy: SpyInstance<
    typeof ModelPermission.checkUpdateQueryPermissions
  >;
  let findOneBySpy: SpyInstance<typeof AlertService.findOneBy>;

  beforeEach((): void => {
    writeSpies = spyOnWrites();
    // Pass-through spies: the real permission layer still runs.
    createPermissionSpy = jest.spyOn(ModelPermission, "checkCreatePermissions");
    updateByModelSpy = jest.spyOn(
      ModelPermission,
      "checkUpdatePermissionByModel",
    );
    updateQuerySpy = jest.spyOn(ModelPermission, "checkUpdateQueryPermissions");
    findOneBySpy = jest
      .spyOn(AlertService, "findOneBy")
      .mockRejectedValue(new Error("the helper reads alerts with findBy only"));
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  describe("short circuits", (): void => {
    test("a root caller is let through without a permission check or any read", async (): Promise<void> => {
      const findBySpy: FindBySpy = jest
        .spyOn(AlertService, "findBy")
        .mockRejectedValue(new Error("root must not read alerts"));

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [ObjectID.generate(), ObjectID.generate()],
          props: { isRoot: true },
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy).not.toHaveBeenCalled();
      expect(findOneBySpy).not.toHaveBeenCalled();
      expect(createPermissionSpy).not.toHaveBeenCalled();
      expect(updateByModelSpy).not.toHaveBeenCalled();
      expect(updateQuerySpy).not.toHaveBeenCalled();
      expectNoWrites(writeSpies);
    });

    test("an empty alert list is let through without a permission check or any read, whoever the caller is", async (): Promise<void> => {
      const findBySpy: FindBySpy = jest
        .spyOn(AlertService, "findBy")
        .mockRejectedValue(new Error("no alerts means no read"));

      // A Viewer could not change any alert's state; with no alerts it does not matter.
      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [],
          props: createDatabaseProps([{ permission: Permission.Viewer }]),
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy).not.toHaveBeenCalled();
      expect(createPermissionSpy).not.toHaveBeenCalled();
      expect(updateByModelSpy).not.toHaveBeenCalled();
      expect(updateQuerySpy).not.toHaveBeenCalled();
      expectNoWrites(writeSpies);
    });
  });

  describe("the AlertStateTimeline create half", (): void => {
    test.each([
      { name: "Viewer", permissions: [Permission.Viewer] },
      { name: "AlertViewer", permissions: [Permission.AlertViewer] },
      {
        name: "ReadAlert with ReadAlertStateTimeline",
        permissions: [Permission.ReadAlert, Permission.ReadAlertStateTimeline],
      },
      {
        name: "EditAlert without CreateAlertStateTimeline",
        permissions: [Permission.EditAlert, Permission.ReadAlert],
      },
    ])(
      "$name is refused before any alert is read",
      async ({
        permissions,
      }: {
        name: string;
        permissions: Array<Permission>;
      }): Promise<void> => {
        const findBySpy: FindBySpy = jest
          .spyOn(AlertService, "findBy")
          .mockRejectedValue(
            new Error("must not read before the create check"),
          );

        const promise: Promise<void> =
          AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
            projectId,
            alertIds: [ObjectID.generate()],
            props: createDatabaseProps(
              permissions.map((permission: Permission): PermissionInput => {
                return { permission };
              }),
            ),
          });

        await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
        await expect(promise).rejects.toThrow(
          "You do not have permissions to create Alert State Timeline.",
        );

        expect(createPermissionSpy).toHaveBeenCalledTimes(1);
        expect(findBySpy).not.toHaveBeenCalled();
        expect(updateByModelSpy).not.toHaveBeenCalled();
        expect(updateQuerySpy).not.toHaveBeenCalled();
        expectNoWrites(writeSpies);
      },
    );

    test("a table-wide block on CreateAlertStateTimeline wins over ProjectMember, before any alert is read", async (): Promise<void> => {
      const findBySpy: FindBySpy = jest
        .spyOn(AlertService, "findBy")
        .mockRejectedValue(new Error("must not read before the create check"));

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [ObjectID.generate()],
          props: createDatabaseProps([
            { permission: Permission.ProjectMember },
            {
              permission: Permission.CreateAlertStateTimeline,
              isBlockPermission: true,
            },
          ]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(
        "because CreateAlertStateTimeline is in your team's permission block list.",
      );

      expect(findBySpy).not.toHaveBeenCalled();
      expectNoWrites(writeSpies);
    });

    test("a caller with no credentials keeps the 401 (NotAuthenticatedException) and nothing is read", async (): Promise<void> => {
      const findBySpy: FindBySpy = jest
        .spyOn(AlertService, "findBy")
        .mockRejectedValue(new Error("must not read for an anonymous caller"));

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [ObjectID.generate()],
          props: createDatabaseProps([{ permission: Permission.AlertMember }], {
            withoutUser: true,
          }),
        }),
      ).rejects.toBeInstanceOf(NotAuthenticatedException);

      expect(findBySpy).not.toHaveBeenCalled();
      expectNoWrites(writeSpies);
    });

    test("the probe is an AlertStateTimeline in the project, for the first alert, with an alert state id", async (): Promise<void> => {
      const firstAlertId: ObjectID = ObjectID.generate();
      const secondAlertId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = createDatabaseProps([
        { permission: Permission.AlertMember },
      ]);
      stubAlertReads(
        [createAlertRow(firstAlertId), createAlertRow(secondAlertId)],
        [createPermittedRow(firstAlertId), createPermittedRow(secondAlertId)],
      );

      await AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
        projectId,
        alertIds: [firstAlertId, secondAlertId],
        props,
      });

      expect(createPermissionSpy).toHaveBeenCalledTimes(1);
      const [modelType, probe, probeProps] = createPermissionSpy.mock
        .calls[0] as unknown as [
        typeof AlertStateTimeline,
        AlertStateTimeline,
        DatabaseCommonInteractionProps,
      ];
      expect(modelType).toBe(AlertStateTimeline);
      expect(probe).toBeInstanceOf(AlertStateTimeline);
      expect(probe.projectId?.toString()).toBe(projectId.toString());
      expect(probe.alertId?.toString()).toBe(firstAlertId.toString());
      expect(probe.alertStateId).toBeInstanceOf(ObjectID);
      expect(probe.alertStateId?.toString()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(probeProps).toBe(props);
      expectNoWrites(writeSpies);
    });
  });

  describe("the Alert update half", (): void => {
    test("an AlertMember with project-wide access may change every alert the scoped read returns", async (): Promise<void> => {
      const alertIds: Array<ObjectID> = [
        ObjectID.generate(),
        ObjectID.generate(),
        ObjectID.generate(),
      ];
      const props: DatabaseCommonInteractionProps = createDatabaseProps([
        { permission: Permission.AlertMember },
      ]);
      const firstReadRows: Array<Alert> = alertIds.map(
        (alertId: ObjectID): Alert => {
          return createAlertRow(alertId);
        },
      );
      // The database may return the permitted rows in any order.
      const findBySpy: FindBySpy = stubAlertReads(firstReadRows, [
        createPermittedRow(alertIds[2]!),
        createPermittedRow(alertIds[0]!),
        createPermittedRow(alertIds[1]!),
      ]);

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds,
          props,
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy).toHaveBeenCalledTimes(2);

      // Read 1: the alerts and their labels, as root, bounded per project.
      const firstRead: FindByArgument = getFindByArgument(findBySpy, 0);
      expect(firstRead.select).toEqual({
        _id: true,
        labels: {
          _id: true,
          name: true,
        },
      });
      expect(firstRead.limit).toBe(LIMIT_PER_PROJECT);
      expect(firstRead.skip).toBe(0);
      expect(firstRead.props).toEqual({ isRoot: true });
      expect(Object.keys(firstRead.query).sort()).toEqual(["_id", "projectId"]);
      expect(getQueryValue(firstRead.query, "projectId")).toBe(projectId);
      expect(
        getRawParameterValues(getQueryValue(firstRead.query, "_id")),
      ).toEqual([toIdStrings(alertIds)]);

      // Every row read is checked against the caller's update rules.
      expect(updateByModelSpy).toHaveBeenCalledTimes(3);
      for (let index: number = 0; index < firstReadRows.length; index++) {
        const call: Parameters<
          typeof ModelPermission.checkUpdatePermissionByModel
        >[0] = updateByModelSpy.mock.calls[index]![0] as Parameters<
          typeof ModelPermission.checkUpdatePermissionByModel
        >[0];
        expect(call.modelType).toBe(Alert);
        expect(call.props).toBe(props);
        await expect(call.fetchModelWithAccessControlIds()).resolves.toBe(
          firstReadRows[index],
        );
      }

      // Read 2: the caller's update scope, as root, bounded per project.
      const permittedRead: FindByArgument = getFindByArgument(findBySpy, 1);
      expect(permittedRead.select).toEqual({ _id: true });
      expect(permittedRead.limit).toBe(LIMIT_PER_PROJECT);
      expect(permittedRead.skip).toBe(0);
      expect(permittedRead.props).toEqual({ isRoot: true });
      expect(
        getRawParameterValues(getQueryValue(permittedRead.query, "_id")),
      ).toEqual([toIdStrings(alertIds)]);
      expect(
        getRawParameterValues(getQueryValue(permittedRead.query, "projectId")),
      ).toEqual([projectId.toString()]);
      // Project-wide access adds no label scope.
      expect(getQueryValue(permittedRead.query, "labels")).toBeUndefined();

      /*
       * Order: the create probe, read 1, the per-alert checks, the scoped
       * update query, then read 2.
       */
      const probeOrder: number =
        createPermissionSpy.mock.invocationCallOrder[0]!;
      const firstReadOrder: number = findBySpy.mock.invocationCallOrder[0]!;
      const perAlertOrders: Array<number> =
        updateByModelSpy.mock.invocationCallOrder;
      const updateQueryOrder: number =
        updateQuerySpy.mock.invocationCallOrder[0]!;
      const permittedReadOrder: number = findBySpy.mock.invocationCallOrder[1]!;
      expect(probeOrder).toBeLessThan(firstReadOrder);
      expect(Math.min(...perAlertOrders)).toBeGreaterThan(firstReadOrder);
      expect(Math.max(...perAlertOrders)).toBeLessThan(updateQueryOrder);
      expect(updateQueryOrder).toBeLessThan(permittedReadOrder);

      expect(findOneBySpy).not.toHaveBeenCalled();
      expectNoWrites(writeSpies);
    });

    test("the update check is asked about {_id: any(ids), projectId} writing a zero currentAlertStateId", async (): Promise<void> => {
      const alertIds: Array<ObjectID> = [
        ObjectID.generate(),
        ObjectID.generate(),
      ];
      const props: DatabaseCommonInteractionProps = createDatabaseProps([
        { permission: Permission.AlertMember },
      ]);
      const findBySpy: FindBySpy = stubAlertReads(
        alertIds.map((alertId: ObjectID): Alert => {
          return createAlertRow(alertId);
        }),
        alertIds.map((alertId: ObjectID): Alert => {
          return createPermittedRow(alertId);
        }),
      );

      await AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
        projectId,
        alertIds,
        props,
      });

      expect(updateQuerySpy).toHaveBeenCalledTimes(1);
      const [modelType, query, data, queryProps] = updateQuerySpy.mock
        .calls[0] as unknown as [
        typeof Alert,
        Query<Alert>,
        Record<string, unknown>,
        DatabaseCommonInteractionProps,
      ];
      expect(modelType).toBe(Alert);
      expect(queryProps).toBe(props);
      expect(data).toEqual({ currentAlertStateId: ObjectID.getZeroObjectID() });
      expect(Object.keys(data)).toEqual(["currentAlertStateId"]);
      expect(Object.keys(query).sort()).toEqual(["_id", "projectId"]);
      expect(getQueryValue(query, "projectId")).toBe(projectId);
      expect(getRawParameterValues(getQueryValue(query, "_id"))).toEqual([
        toIdStrings(alertIds),
      ]);
      // The same {_id, projectId} query the rows were read with.
      expect(query).toBe(getFindByArgument(findBySpy, 0).query);
      // The permission layer works on a copy: the caller's query is not scoped in place.
      expect(getQueryValue(query, "isPrivate")).toBeUndefined();
      expectNoWrites(writeSpies);
    });

    test("CreateAlertStateTimeline without any Alert update permission is refused after the first read", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(alertId)],
        [createPermittedRow(alertId)],
      );

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: createDatabaseProps([
            { permission: Permission.CreateAlertStateTimeline },
            { permission: Permission.ReadAlert },
          ]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(
        "You do not have permissions to update Alert.",
      );

      expect(createPermissionSpy).toHaveBeenCalledTimes(1);
      expect(findBySpy).toHaveBeenCalledTimes(1);
      // Refused by the per-alert update check, before the scoped query.
      expect(updateByModelSpy).toHaveBeenCalledTimes(1);
      expect(updateQuerySpy).not.toHaveBeenCalled();
      expectNoWrites(writeSpies);
    });

    test("CreateAlertStateTimeline without Alert update is still refused when the first read finds none of the alerts", async (): Promise<void> => {
      // No rows means no per-alert check; the scoped update query must refuse by itself.
      const findBySpy: FindBySpy = stubAlertReads([], []);

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [ObjectID.generate()],
          props: createDatabaseProps([
            { permission: Permission.CreateAlertStateTimeline },
            { permission: Permission.ReadAlert },
          ]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(
        "You do not have permissions to update Alert.",
      );

      expect(updateByModelSpy).not.toHaveBeenCalled();
      expect(updateQuerySpy).toHaveBeenCalledTimes(1);
      expect(findBySpy).toHaveBeenCalledTimes(1);
      expectNoWrites(writeSpies);
    });

    test("a custom role with CreateAlertStateTimeline and EditAlert may change the alerts", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(alertId)],
        [createPermittedRow(alertId)],
      );

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: createDatabaseProps([
            { permission: Permission.CreateAlertStateTimeline },
            { permission: Permission.EditAlert },
            { permission: Permission.ReadAlert },
          ]),
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy).toHaveBeenCalledTimes(2);
      expectNoWrites(writeSpies);
    });

    test("an alert id the project does not have (neither read returns it) is refused", async (): Promise<void> => {
      const ownAlertId: ObjectID = ObjectID.generate();
      const foreignAlertId: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(ownAlertId)],
        [createPermittedRow(ownAlertId)],
      );

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [ownAlertId, foreignAlertId],
          props: createDatabaseProps([{ permission: Permission.ProjectOwner }]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(REFUSAL_MESSAGE);

      expect(findBySpy).toHaveBeenCalledTimes(2);
      expect(updateByModelSpy).toHaveBeenCalledTimes(1);
      expectNoWrites(writeSpies);
    });
  });

  describe("label scope", (): void => {
    test("Viewer plus AlertMember for label A is refused by the permission layer when one alert carries only label B", async (): Promise<void> => {
      const labelA: Label = createLabel("team-a");
      const labelB: Label = createLabel("team-b");
      const alertA: ObjectID = ObjectID.generate();
      const alertB: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(alertA, [labelA]), createAlertRow(alertB, [labelB])],
        [createPermittedRow(alertA)],
      );

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertA, alertB],
          props: createDatabaseProps([
            { permission: Permission.Viewer },
            { permission: Permission.AlertMember, labelIds: [labelA.id!] },
          ]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(
        "You do not have permission to update this Alert. You need to have one of the following labels: team-b.",
      );

      // alert A passed, alert B was refused, and the scoped read never ran.
      expect(updateByModelSpy).toHaveBeenCalledTimes(2);
      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(updateQuerySpy).not.toHaveBeenCalled();
      expectNoWrites(writeSpies);
    });

    test("an AlertMember for label A is refused an unlabelled alert", async (): Promise<void> => {
      const labelA: Label = createLabel("team-a");
      const alertId: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(alertId, [])],
        [],
      );

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: createDatabaseProps([
            { permission: Permission.AlertMember, labelIds: [labelA.id!] },
          ]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(
        "You do not have permission to update Alert without any labels.",
      );

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expectNoWrites(writeSpies);
    });

    test("Viewer plus AlertMember for label A may change alerts that all carry label A, and the scoped read is narrowed to label A", async (): Promise<void> => {
      const labelA: Label = createLabel("team-a");
      const labelB: Label = createLabel("team-b");
      const firstAlert: ObjectID = ObjectID.generate();
      const secondAlert: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [
          createAlertRow(firstAlert, [labelA]),
          // Carrying another label as well does not matter.
          createAlertRow(secondAlert, [labelB, labelA]),
        ],
        [createPermittedRow(firstAlert), createPermittedRow(secondAlert)],
      );

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [firstAlert, secondAlert],
          props: createDatabaseProps([
            { permission: Permission.Viewer },
            { permission: Permission.AlertMember, labelIds: [labelA.id!] },
          ]),
        }),
      ).resolves.toBeUndefined();

      const permittedQuery: Query<Alert> = getFindByArgument(
        findBySpy,
        1,
      ).query;
      const labelFilter: unknown = getQueryValue(permittedQuery, "labels");
      expect(labelFilter).toEqual({ _id: expect.any(FindOperator) });
      expect(
        getRawParameterValues((labelFilter as Record<string, unknown>)["_id"]),
      ).toEqual([[labelA.id!.toString()]]);
      expect(
        getRawParameterValues(getQueryValue(permittedQuery, "_id")),
      ).toEqual([toIdStrings([firstAlert, secondAlert])]);
      expectNoWrites(writeSpies);
    });

    test("an alert that passes the per-alert label check but is missing from the label-scoped read is refused", async (): Promise<void> => {
      // e.g. relabelled between the two reads: the scoped read is the final word.
      const labelA: Label = createLabel("team-a");
      const firstAlert: ObjectID = ObjectID.generate();
      const secondAlert: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [
          createAlertRow(firstAlert, [labelA]),
          createAlertRow(secondAlert, [labelA]),
        ],
        [createPermittedRow(firstAlert)],
      );

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [firstAlert, secondAlert],
          props: createDatabaseProps([
            { permission: Permission.AlertMember, labelIds: [labelA.id!] },
          ]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(REFUSAL_MESSAGE);

      expect(findBySpy).toHaveBeenCalledTimes(2);
      expectNoWrites(writeSpies);
    });

    test("an EditAlert block for label B refuses an alert labelled B even for a ProjectMember", async (): Promise<void> => {
      const labelB: Label = createLabel("team-b");
      const alertA: ObjectID = ObjectID.generate();
      const alertB: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(alertA, []), createAlertRow(alertB, [labelB])],
        [createPermittedRow(alertA), createPermittedRow(alertB)],
      );

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertA, alertB],
          props: createDatabaseProps([
            { permission: Permission.ProjectMember },
            {
              permission: Permission.EditAlert,
              isBlockPermission: true,
              labelIds: [labelB.id!],
            },
          ]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(
        "You are not authorized to update this Alert because EditAlert is in your team's permission block list.",
      );

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(updateQuerySpy).not.toHaveBeenCalled();
      expectNoWrites(writeSpies);
    });
  });

  describe("Owned scope", (): void => {
    test("AlertViewer plus Owned AlertMember is refused when the scoped read leaves out an alert they do not own", async (): Promise<void> => {
      const teamId: ObjectID = ObjectID.generate();
      const ownedAlert: ObjectID = ObjectID.generate();
      const otherAlert: ObjectID = ObjectID.generate();
      const ownerUser: AlertOwnerUser = new AlertOwnerUser();
      ownerUser.alertId = ownedAlert;
      const ownerUserSpy: SpyInstance<typeof AlertOwnerUserService.findBy> =
        jest
          .spyOn(AlertOwnerUserService, "findBy")
          .mockResolvedValue([ownerUser]);
      const ownerTeamSpy: SpyInstance<typeof AlertOwnerTeamService.findBy> =
        jest.spyOn(AlertOwnerTeamService, "findBy").mockResolvedValue([]);
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(ownedAlert), createAlertRow(otherAlert)],
        [createPermittedRow(ownedAlert)],
      );

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [ownedAlert, otherAlert],
          props: createDatabaseProps(
            [
              { permission: Permission.AlertViewer },
              {
                permission: Permission.AlertMember,
                scope: PermissionScope.Owned,
              },
            ],
            { userTeamIds: [teamId] },
          ),
        });

      // The per-alert check cannot see ownership; the scoped read is what refuses.
      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(REFUSAL_MESSAGE);

      expect(updateByModelSpy).toHaveBeenCalledTimes(2);
      expect(ownerUserSpy).toHaveBeenCalledTimes(1);
      expect(ownerUserSpy.mock.calls[0]?.[0].query).toEqual({
        userId,
        projectId,
      });
      expect(ownerTeamSpy).toHaveBeenCalledTimes(1);
      expect(
        getRawParameterValues(ownerTeamSpy.mock.calls[0]?.[0].query.teamId),
      ).toEqual([[teamId.toString()]]);

      // The scoped read is narrowed to {requested ids} AND {owned ids}.
      const idFilter: FindOperator<unknown> = asFindOperator(
        getQueryValue(getFindByArgument(findBySpy, 1).query, "_id"),
      );
      expect(idFilter.type).toBe("and");
      const conditions: Array<unknown> = idFilter.value as Array<unknown>;
      expect(conditions).toHaveLength(2);
      expect(getRawParameterValues(conditions[0])).toEqual([
        toIdStrings([ownedAlert, otherAlert]),
      ]);
      expect(getRawParameterValues(conditions[1])).toEqual([
        [ownedAlert.toString()],
      ]);
      expectNoWrites(writeSpies);
    });

    test("an Owned AlertMember may change alerts their team owns", async (): Promise<void> => {
      const teamId: ObjectID = ObjectID.generate();
      const alertId: ObjectID = ObjectID.generate();
      const ownerTeam: AlertOwnerTeam = new AlertOwnerTeam();
      ownerTeam.alertId = alertId;
      ownerTeam.teamId = teamId;
      jest.spyOn(AlertOwnerUserService, "findBy").mockResolvedValue([]);
      jest
        .spyOn(AlertOwnerTeamService, "findBy")
        .mockResolvedValue([ownerTeam]);
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(alertId)],
        [createPermittedRow(alertId)],
      );

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: createDatabaseProps(
            [
              {
                permission: Permission.AlertMember,
                scope: PermissionScope.Owned,
              },
            ],
            { userTeamIds: [teamId] },
          ),
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy).toHaveBeenCalledTimes(2);
      expectNoWrites(writeSpies);
    });
  });

  describe("alert privacy", (): void => {
    test("a private alert the caller does not own is refused: the scoped read carries the self-privacy filter", async (): Promise<void> => {
      const publicAlert: ObjectID = ObjectID.generate();
      const privateAlert: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(publicAlert), createAlertRow(privateAlert)],
        // What the database returns once the privacy clause hides the private alert.
        [createPermittedRow(publicAlert)],
      );

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [publicAlert, privateAlert],
          props: createDatabaseProps([{ permission: Permission.AlertMember }]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(REFUSAL_MESSAGE);

      // The first read is the unscoped root read: no privacy clause there.
      expect(
        getQueryValue(getFindByArgument(findBySpy, 0).query, "isPrivate"),
      ).toBeUndefined();

      const privacy: RawClause = getRawClause(
        getQueryValue(getFindByArgument(findBySpy, 1).query, "isPrivate"),
      );
      expect(privacy.sql).toContain("COLUMN IS NULL OR COLUMN = FALSE");
      expect(privacy.sql).toContain('FROM "AlertOwnerUser"');
      expect(privacy.sql).toContain('FROM "AlertOwnerTeam"');
      expect(privacy.params).toEqual([userId.toString()]);
      expectNoWrites(writeSpies);
    });

    test("an API key (no user) gets the no-owner privacy clause, which hides every private alert", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(alertId)],
        [],
      );

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: createDatabaseProps([{ permission: Permission.AlertMember }], {
            withoutUser: true,
            userType: UserType.API,
          }),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(REFUSAL_MESSAGE);

      const privacy: RawClause = getRawClause(
        getQueryValue(getFindByArgument(findBySpy, 1).query, "isPrivate"),
      );
      expect(privacy.sql).toBe("(COLUMN IS NULL OR COLUMN = FALSE)");
      expect(privacy.params).toEqual([]);
      expectNoWrites(writeSpies);
    });

    test("a ProjectOwner bypasses alert privacy: the scoped read has no privacy clause", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(alertId)],
        [createPermittedRow(alertId)],
      );

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: createDatabaseProps([{ permission: Permission.ProjectOwner }]),
        }),
      ).resolves.toBeUndefined();

      const permittedQuery: Query<Alert> = getFindByArgument(
        findBySpy,
        1,
      ).query;
      expect(Object.keys(permittedQuery)).not.toContain("isPrivate");
      expect(
        getRawParameterValues(getQueryValue(permittedQuery, "_id")),
      ).toEqual([[alertId.toString()]]);
      expectNoWrites(writeSpies);
    });
  });

  describe("matching the scoped read to the requested ids", (): void => {
    test("ids are compared case-insensitively: upper-case requested ids match lower-case rows", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      const upperCaseId: ObjectID = new ObjectID(
        alertId.toString().toUpperCase(),
      );
      stubAlertReads(
        [createAlertRow(alertId)],
        [createPermittedRow(alertId.toString().toLowerCase())],
      );

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [upperCaseId],
          props: createDatabaseProps([{ permission: Permission.AlertMember }]),
        }),
      ).resolves.toBeUndefined();
      expectNoWrites(writeSpies);
    });

    test("ids are compared case-insensitively: lower-case requested ids match upper-case rows", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      stubAlertReads(
        [createAlertRow(alertId)],
        [createPermittedRow(alertId.toString().toUpperCase())],
      );

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: createDatabaseProps([{ permission: Permission.AlertMember }]),
        }),
      ).resolves.toBeUndefined();
      expectNoWrites(writeSpies);
    });

    test("a repeated id needs only one permitted row", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      stubAlertReads([createAlertRow(alertId)], [createPermittedRow(alertId)]);

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId, new ObjectID(alertId.toString())],
          props: createDatabaseProps([{ permission: Permission.AlertMember }]),
        }),
      ).resolves.toBeUndefined();
    });

    test("a permitted row without an _id does not stand in for any alert", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      stubAlertReads([createAlertRow(alertId)], [new Alert()]);

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: createDatabaseProps([{ permission: Permission.AlertMember }]),
        }),
      ).rejects.toThrow(REFUSAL_MESSAGE);
    });

    test("an empty scoped read refuses even a ProjectOwner", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      stubAlertReads([createAlertRow(alertId)], []);

      const promise: Promise<void> =
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: createDatabaseProps([{ permission: Permission.ProjectOwner }]),
        });

      await expect(promise).rejects.toBeInstanceOf(NotAuthorizedException);
      await expect(promise).rejects.toThrow(REFUSAL_MESSAGE);
      expectNoWrites(writeSpies);
    });
  });

  describe("master admin", (): void => {
    test("a master admin (not root) still goes through both reads, and the permission layer lets every check through", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      const findBySpy: FindBySpy = stubAlertReads(
        [createAlertRow(alertId)],
        [createPermittedRow(alertId)],
      );

      await expect(
        AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId,
          alertIds: [alertId],
          props: {
            isMasterAdmin: true,
            userId,
            userType: UserType.MasterAdmin,
            tenantId: projectId,
          },
        }),
      ).resolves.toBeUndefined();

      expect(findBySpy).toHaveBeenCalledTimes(2);
      // No privacy clause for a master admin.
      expect(
        getQueryValue(getFindByArgument(findBySpy, 1).query, "isPrivate"),
      ).toBeUndefined();
      expectNoWrites(writeSpies);
    });
  });
});
