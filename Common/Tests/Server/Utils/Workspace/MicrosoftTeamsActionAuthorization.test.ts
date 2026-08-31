import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../../Models/DatabaseModels/IncidentOwnerTeam";
import Label from "../../../../Models/DatabaseModels/Label";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentOwnerTeamService from "../../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import MicrosoftTeamsAlertActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsActionAuthorization from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Authorization";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import {
  MicrosoftTeamsAlertActionType,
  MicrosoftTeamsIncidentActionType,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";

type PermissionInput = {
  permission: Permission;
  isBlockPermission?: boolean;
  labelIds?: Array<ObjectID>;
  scope?: PermissionScope;
};

type IncidentActionTestCase = {
  actionType: MicrosoftTeamsIncidentActionType;
  mutation: "acknowledgeIncident" | "resolveIncident";
};

type AlertActionTestCase = {
  actionType: MicrosoftTeamsAlertActionType;
  mutation: "acknowledgeAlert" | "resolveAlert";
};

type IncidentMutationSpy = SpyInstance<
  typeof IncidentService.acknowledgeIncident
>;

type AlertMutationSpy =
  | SpyInstance<typeof AlertService.acknowledgeAlert>
  | SpyInstance<typeof AlertService.resolveAlert>;

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function createDatabaseProps(
  permissions: Array<PermissionInput>,
  userTeamIds: Array<ObjectID> = [],
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

  return {
    userId,
    tenantId: projectId,
    userTeamIds,
    userGlobalAccessPermission: globalAccessPermission,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantAccessPermission,
    },
  };
}

function createIncident(incidentId: ObjectID): Incident {
  const incident: Incident = new Incident();
  incident.id = incidentId;
  incident.projectId = projectId;
  incident.labels = [];
  return incident;
}

function createAlert(alertId: ObjectID): Alert {
  const alert: Alert = new Alert();
  alert.id = alertId;
  alert.projectId = projectId;
  alert.labels = [];
  return alert;
}

function getRawParameterValues(value: unknown): Array<unknown> {
  const findOperator: FindOperator<unknown> = value as FindOperator<unknown>;
  return Object.values(findOperator.objectLiteralParameters || {});
}

function createTurnContext(): TurnContext {
  return {
    activity: {},
    deleteActivity: jest.fn(async (): Promise<void> => {}),
    sendActivity: jest.fn(async (): Promise<void> => {}),
  } as unknown as TurnContext;
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsActionAuthorization", (): void => {
  test("allows an incident update when the user has an incident edit grant", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const incident: Incident = createIncident(incidentId);
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.EditProjectIncident },
      { permission: Permission.ReadProjectIncident },
    ]);
    const findOneBySpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId,
        projectId,
        props: databaseProps,
      }),
    ).resolves.toBeUndefined();

    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });

  test("denies an incident update to a viewer with no update grant", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.Viewer },
    ]);
    const findOneBySpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(createIncident(incidentId));

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);
  });

  test("honors an explicit incident update block even when another update grant exists", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.ProjectMember },
      {
        permission: Permission.EditProjectIncident,
        isBlockPermission: true,
      },
    ]);
    const findOneBySpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(createIncident(incidentId));

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);
  });

  test("allows an incident update when its label matches the user's scoped grant", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const permittedLabelId: ObjectID = ObjectID.generate();
    const incident: Incident = createIncident(incidentId);
    incident.labels = [new Label(permittedLabelId)];
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      {
        permission: Permission.EditProjectIncident,
        labelIds: [permittedLabelId],
      },
      {
        permission: Permission.ReadProjectIncident,
        labelIds: [permittedLabelId],
      },
    ]);
    const findOneBySpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId,
        projectId,
        props: databaseProps,
      }),
    ).resolves.toBeUndefined();

    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });

  test("honors an incident update block scoped to the incident's label", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const blockedLabelId: ObjectID = ObjectID.generate();
    const incident: Incident = createIncident(incidentId);
    incident.labels = [new Label(blockedLabelId)];
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.ProjectMember },
      {
        permission: Permission.EditProjectIncident,
        isBlockPermission: true,
        labelIds: [blockedLabelId],
      },
    ]);
    const findOneBySpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);
  });

  test("rejects an incident when the exact project and resource query is not permitted", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.EditProjectIncident },
      { permission: Permission.ReadProjectIncident },
    ]);
    const incident: Incident = createIncident(incidentId);
    incident.isPrivate = true;
    const queryPermissionSpy: SpyInstance<
      typeof ModelPermission.checkUpdateQueryPermissions
    > = jest.spyOn(ModelPermission, "checkUpdateQueryPermissions");
    const findOneBySpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValueOnce(incident)
      .mockResolvedValueOnce(null);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(queryPermissionSpy).toHaveBeenCalledWith(
      Incident,
      expect.objectContaining({
        _id: incidentId,
        projectId,
      }),
      expect.objectContaining({
        currentIncidentStateId: expect.any(ObjectID),
      }),
      databaseProps,
    );
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
    expect(findOneBySpy.mock.calls[0]?.[0].query).toEqual({
      _id: incidentId,
      projectId,
    });
    expect(findOneBySpy.mock.calls[1]?.[0].query).toEqual(
      expect.objectContaining({
        isPrivate: expect.anything(),
      }),
    );
    expect(findOneBySpy.mock.calls[1]?.[0].props).toEqual({ isRoot: true });
  });

  test("allows an alert update when the user has an alert edit grant", async (): Promise<void> => {
    const alertId: ObjectID = ObjectID.generate();
    const alert: Alert = createAlert(alertId);
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.EditAlert },
      { permission: Permission.ReadAlert },
    ]);
    const findOneBySpy: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alert);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateAlert({
        alertId,
        projectId,
        props: databaseProps,
      }),
    ).resolves.toBeUndefined();

    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });

  test("denies an alert update to a viewer with no update grant", async (): Promise<void> => {
    const alertId: ObjectID = ObjectID.generate();
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.Viewer },
    ]);
    const findOneBySpy: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(createAlert(alertId));

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateAlert({
        alertId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);
  });

  test("honors an explicit alert update block even when another update grant exists", async (): Promise<void> => {
    const alertId: ObjectID = ObjectID.generate();
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.ProjectMember },
      {
        permission: Permission.EditAlert,
        isBlockPermission: true,
      },
    ]);
    const findOneBySpy: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(createAlert(alertId));

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateAlert({
        alertId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);
  });

  test("denies an alert update when its label is outside the user's scoped grant", async (): Promise<void> => {
    const alertId: ObjectID = ObjectID.generate();
    const alert: Alert = createAlert(alertId);
    alert.labels = [new Label(ObjectID.generate())];
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      {
        permission: Permission.EditAlert,
        labelIds: [ObjectID.generate()],
      },
    ]);
    const findOneBySpy: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alert);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateAlert({
        alertId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);
  });

  test("rejects an alert when the exact project and resource query is not permitted", async (): Promise<void> => {
    const alertId: ObjectID = ObjectID.generate();
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.EditAlert },
      { permission: Permission.ReadAlert },
    ]);
    const alert: Alert = createAlert(alertId);
    alert.isPrivate = true;
    const queryPermissionSpy: SpyInstance<
      typeof ModelPermission.checkUpdateQueryPermissions
    > = jest.spyOn(ModelPermission, "checkUpdateQueryPermissions");
    const findOneBySpy: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValueOnce(alert)
      .mockResolvedValueOnce(null);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateAlert({
        alertId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(queryPermissionSpy).toHaveBeenCalledWith(
      Alert,
      expect.objectContaining({
        _id: alertId,
        projectId,
      }),
      expect.objectContaining({
        currentAlertStateId: expect.any(ObjectID),
      }),
      databaseProps,
    );
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
    expect(findOneBySpy.mock.calls[0]?.[0].query).toEqual({
      _id: alertId,
      projectId,
    });
    expect(findOneBySpy.mock.calls[1]?.[0].query).toEqual(
      expect.objectContaining({
        isPrivate: expect.anything(),
      }),
    );
    expect(findOneBySpy.mock.calls[1]?.[0].props).toEqual({ isRoot: true });
  });

  test("allows an incident owned by one of the user's accepted teams", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const teamId: ObjectID = ObjectID.generate();
    const incident: Incident = createIncident(incidentId);
    incident.isPrivate = true;
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps(
      [
        {
          permission: Permission.EditProjectIncident,
          scope: PermissionScope.Owned,
        },
        { permission: Permission.ReadProjectIncident },
      ],
      [teamId],
    );
    const ownerTeam: IncidentOwnerTeam = new IncidentOwnerTeam();
    ownerTeam.incidentId = incidentId;
    ownerTeam.projectId = projectId;
    ownerTeam.teamId = teamId;

    const ownerUserSpy: SpyInstance<typeof IncidentOwnerUserService.findBy> =
      jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue([]);
    const ownerTeamSpy: SpyInstance<typeof IncidentOwnerTeamService.findBy> =
      jest
        .spyOn(IncidentOwnerTeamService, "findBy")
        .mockResolvedValue([ownerTeam]);
    const findOneBySpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId,
        projectId,
        props: databaseProps,
      }),
    ).resolves.toBeUndefined();

    expect(ownerUserSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          userId,
          projectId,
        },
      }),
    );
    expect(ownerTeamSpy).toHaveBeenCalledTimes(1);
    expect(ownerTeamSpy.mock.calls[0]?.[0].query.projectId).toEqual(projectId);
    expect(
      getRawParameterValues(ownerTeamSpy.mock.calls[0]?.[0].query.teamId),
    ).toEqual([[teamId.toString()]]);
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
    expect(findOneBySpy.mock.calls[1]?.[0].query).toEqual(
      expect.objectContaining({
        isPrivate: expect.anything(),
      }),
    );
  });

  test("rejects an owned-scoped incident when neither the user nor an accepted team owns it", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const teamId: ObjectID = ObjectID.generate();
    const incident: Incident = createIncident(incidentId);
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps(
      [
        {
          permission: Permission.EditProjectIncident,
          scope: PermissionScope.Owned,
        },
        { permission: Permission.ReadProjectIncident },
      ],
      [teamId],
    );

    jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue([]);
    const ownerTeamSpy: SpyInstance<typeof IncidentOwnerTeamService.findBy> =
      jest.spyOn(IncidentOwnerTeamService, "findBy").mockResolvedValue([]);
    const findOneBySpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValueOnce(incident)
      .mockResolvedValueOnce(null);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateIncident({
        incidentId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(ownerTeamSpy).toHaveBeenCalledTimes(1);
    expect(
      getRawParameterValues(ownerTeamSpy.mock.calls[0]?.[0].query.teamId),
    ).toEqual([[teamId.toString()]]);
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });

  test("allows an alert owned by one of the user's accepted teams", async (): Promise<void> => {
    const alertId: ObjectID = ObjectID.generate();
    const teamId: ObjectID = ObjectID.generate();
    const alert: Alert = createAlert(alertId);
    alert.isPrivate = true;
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps(
      [
        {
          permission: Permission.EditAlert,
          scope: PermissionScope.Owned,
        },
        { permission: Permission.ReadAlert },
      ],
      [teamId],
    );
    const ownerTeam: AlertOwnerTeam = new AlertOwnerTeam();
    ownerTeam.alertId = alertId;
    ownerTeam.projectId = projectId;
    ownerTeam.teamId = teamId;

    const ownerUserSpy: SpyInstance<typeof AlertOwnerUserService.findBy> = jest
      .spyOn(AlertOwnerUserService, "findBy")
      .mockResolvedValue([]);
    const ownerTeamSpy: SpyInstance<typeof AlertOwnerTeamService.findBy> = jest
      .spyOn(AlertOwnerTeamService, "findBy")
      .mockResolvedValue([ownerTeam]);
    const findOneBySpy: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alert);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateAlert({
        alertId,
        projectId,
        props: databaseProps,
      }),
    ).resolves.toBeUndefined();

    expect(ownerUserSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          userId,
          projectId,
        },
      }),
    );
    expect(ownerTeamSpy).toHaveBeenCalledTimes(1);
    expect(ownerTeamSpy.mock.calls[0]?.[0].query.projectId).toEqual(projectId);
    expect(
      getRawParameterValues(ownerTeamSpy.mock.calls[0]?.[0].query.teamId),
    ).toEqual([[teamId.toString()]]);
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
    expect(findOneBySpy.mock.calls[1]?.[0].query).toEqual(
      expect.objectContaining({
        isPrivate: expect.anything(),
      }),
    );
  });

  test("rejects an owned-scoped alert when neither the user nor an accepted team owns it", async (): Promise<void> => {
    const alertId: ObjectID = ObjectID.generate();
    const teamId: ObjectID = ObjectID.generate();
    const alert: Alert = createAlert(alertId);
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps(
      [
        {
          permission: Permission.EditAlert,
          scope: PermissionScope.Owned,
        },
        { permission: Permission.ReadAlert },
      ],
      [teamId],
    );

    jest.spyOn(AlertOwnerUserService, "findBy").mockResolvedValue([]);
    const ownerTeamSpy: SpyInstance<typeof AlertOwnerTeamService.findBy> = jest
      .spyOn(AlertOwnerTeamService, "findBy")
      .mockResolvedValue([]);
    const findOneBySpy: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValueOnce(alert)
      .mockResolvedValueOnce(null);

    await expect(
      MicrosoftTeamsActionAuthorization.assertCanUpdateAlert({
        alertId,
        projectId,
        props: databaseProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(ownerTeamSpy).toHaveBeenCalledTimes(1);
    expect(
      getRawParameterValues(ownerTeamSpy.mock.calls[0]?.[0].query.teamId),
    ).toEqual([[teamId.toString()]]);
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });
});

describe("MicrosoftTeamsIncidentActions authorization", (): void => {
  const incidentActions: ReadonlyArray<IncidentActionTestCase> = [
    {
      actionType: MicrosoftTeamsIncidentActionType.AckIncident,
      mutation: "acknowledgeIncident",
    },
    {
      actionType: MicrosoftTeamsIncidentActionType.ResolveIncident,
      mutation: "resolveIncident",
    },
  ];

  test.each(incidentActions)(
    "$actionType does not mutate the incident when authorization is denied",
    async ({ actionType, mutation }: IncidentActionTestCase): Promise<void> => {
      const incidentId: ObjectID = ObjectID.generate();
      const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps(
        [{ permission: Permission.Viewer }],
      );
      const turnContext: TurnContext = createTurnContext();
      const authorizationError: NotAuthorizedException =
        new NotAuthorizedException("Not authorized");
      jest
        .spyOn(MicrosoftTeamsActionAuthorization, "assertCanUpdateIncident")
        .mockRejectedValue(authorizationError);
      const mutationSpy: IncidentMutationSpy = jest
        .spyOn(IncidentService, mutation)
        .mockResolvedValue(createIncident(incidentId));

      await expect(
        MicrosoftTeamsIncidentActions.handleBotIncidentAction({
          actionType,
          actionValue: incidentId.toString(),
          value: {},
          projectId,
          oneUptimeUserId: userId,
          databaseProps,
          turnContext,
        }),
      ).rejects.toBe(authorizationError);

      expect(mutationSpy).not.toHaveBeenCalled();
    },
  );

  test.each(incidentActions)(
    "$actionType mutates the incident exactly once after authorization succeeds",
    async ({ actionType, mutation }: IncidentActionTestCase): Promise<void> => {
      const incidentId: ObjectID = ObjectID.generate();
      const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps(
        [{ permission: Permission.EditProjectIncident }],
      );
      const turnContext: TurnContext = createTurnContext();
      const authorizationSpy: SpyInstance<
        typeof MicrosoftTeamsActionAuthorization.assertCanUpdateIncident
      > = jest
        .spyOn(MicrosoftTeamsActionAuthorization, "assertCanUpdateIncident")
        .mockResolvedValue();
      const mutationSpy: IncidentMutationSpy = jest
        .spyOn(IncidentService, mutation)
        .mockResolvedValue(createIncident(incidentId));

      await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
        actionType,
        actionValue: incidentId.toString(),
        value: {},
        projectId,
        oneUptimeUserId: userId,
        databaseProps,
        turnContext,
      });

      expect(authorizationSpy).toHaveBeenCalledTimes(1);
      expect(authorizationSpy).toHaveBeenCalledWith({
        incidentId,
        projectId,
        props: databaseProps,
      });
      expect(mutationSpy).toHaveBeenCalledTimes(1);
      expect(mutationSpy).toHaveBeenCalledWith(incidentId, userId);
    },
  );

  test("passes the authenticated user's database props when changing incident state", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const incidentStateId: ObjectID = ObjectID.generate();
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.EditProjectIncident },
    ]);
    const turnContext: TurnContext = createTurnContext();
    const updateSpy: SpyInstance<typeof IncidentService.updateOneById> = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(1);

    await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
      actionType: MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState,
      actionValue: incidentId.toString(),
      value: {
        incidentState: incidentStateId.toString(),
      },
      projectId,
      oneUptimeUserId: userId,
      databaseProps,
      turnContext,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const updateArgs: Parameters<typeof IncidentService.updateOneById>[0] =
      updateSpy.mock.calls[0]![0];
    expect(updateArgs.id).toEqual(incidentId);
    expect(updateArgs.data.currentIncidentStateId).toEqual(incidentStateId);
    expect(updateArgs.props).toBe(databaseProps);
  });
});

describe("MicrosoftTeamsAlertActions authorization", (): void => {
  const alertActions: ReadonlyArray<AlertActionTestCase> = [
    {
      actionType: MicrosoftTeamsAlertActionType.AckAlert,
      mutation: "acknowledgeAlert",
    },
    {
      actionType: MicrosoftTeamsAlertActionType.ResolveAlert,
      mutation: "resolveAlert",
    },
  ];

  test.each(alertActions)(
    "$actionType does not mutate the alert when authorization is denied",
    async ({ actionType, mutation }: AlertActionTestCase): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps(
        [{ permission: Permission.Viewer }],
      );
      const turnContext: TurnContext = createTurnContext();
      const authorizationError: NotAuthorizedException =
        new NotAuthorizedException("Not authorized");
      jest
        .spyOn(MicrosoftTeamsActionAuthorization, "assertCanUpdateAlert")
        .mockRejectedValue(authorizationError);
      const mutationSpy: AlertMutationSpy =
        mutation === "acknowledgeAlert"
          ? jest.spyOn(AlertService, mutation).mockResolvedValue()
          : jest
              .spyOn(AlertService, mutation)
              .mockResolvedValue(createAlert(alertId));

      await expect(
        MicrosoftTeamsAlertActions.handleBotAlertAction({
          actionType,
          actionValue: alertId.toString(),
          value: {},
          projectId,
          oneUptimeUserId: userId,
          databaseProps,
          turnContext,
        }),
      ).rejects.toBe(authorizationError);

      expect(mutationSpy).not.toHaveBeenCalled();
    },
  );

  test.each(alertActions)(
    "$actionType mutates the alert exactly once after authorization succeeds",
    async ({ actionType, mutation }: AlertActionTestCase): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps(
        [{ permission: Permission.EditAlert }],
      );
      const turnContext: TurnContext = createTurnContext();
      const authorizationSpy: SpyInstance<
        typeof MicrosoftTeamsActionAuthorization.assertCanUpdateAlert
      > = jest
        .spyOn(MicrosoftTeamsActionAuthorization, "assertCanUpdateAlert")
        .mockResolvedValue();
      const mutationSpy: AlertMutationSpy =
        mutation === "acknowledgeAlert"
          ? jest.spyOn(AlertService, mutation).mockResolvedValue()
          : jest
              .spyOn(AlertService, mutation)
              .mockResolvedValue(createAlert(alertId));

      await MicrosoftTeamsAlertActions.handleBotAlertAction({
        actionType,
        actionValue: alertId.toString(),
        value: {},
        projectId,
        oneUptimeUserId: userId,
        databaseProps,
        turnContext,
      });

      expect(authorizationSpy).toHaveBeenCalledTimes(1);
      expect(authorizationSpy).toHaveBeenCalledWith({
        alertId,
        projectId,
        props: databaseProps,
      });
      expect(mutationSpy).toHaveBeenCalledTimes(1);
      expect(mutationSpy).toHaveBeenCalledWith(alertId, userId);
    },
  );

  test("passes the authenticated user's database props when changing alert state", async (): Promise<void> => {
    const alertId: ObjectID = ObjectID.generate();
    const alertStateId: ObjectID = ObjectID.generate();
    const databaseProps: DatabaseCommonInteractionProps = createDatabaseProps([
      { permission: Permission.EditAlert },
    ]);
    const turnContext: TurnContext = createTurnContext();
    const updateSpy: SpyInstance<typeof AlertService.updateOneById> = jest
      .spyOn(AlertService, "updateOneById")
      .mockResolvedValue(1);

    await MicrosoftTeamsAlertActions.handleBotAlertAction({
      actionType: MicrosoftTeamsAlertActionType.SubmitChangeAlertState,
      actionValue: alertId.toString(),
      value: {
        alertState: alertStateId.toString(),
      },
      projectId,
      oneUptimeUserId: userId,
      databaseProps,
      turnContext,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const updateArgs: Parameters<typeof AlertService.updateOneById>[0] =
      updateSpy.mock.calls[0]![0];
    expect(updateArgs.id).toEqual(alertId);
    expect(updateArgs.data.currentAlertStateId).toEqual(alertStateId);
    expect(updateArgs.props).toBe(databaseProps);
  });
});
