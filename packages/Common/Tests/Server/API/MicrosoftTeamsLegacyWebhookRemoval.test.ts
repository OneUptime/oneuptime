import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { UserTenantAccessPermission } from "../../../Types/Permission";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../../../Server/Utils/Express";
import {
  MicrosoftTeamsAlertActionType,
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsMonitorActionType,
} from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAuthAction from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsMonitorActions from "../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Monitor";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

jest.setTimeout(30_000);

type ExpressRouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{
      handle: ExpressRouteHandler;
    }>;
  };
};

type ExpressRouteHandler = (
  request: ExpressRequest,
  response: ExpressResponse,
) => Promise<void> | void;

const LEGACY_WEBHOOK_PATH: string = "/microsoft-teams/webhook";
const BOT_FRAMEWORK_PATH: string = "/microsoft-bot/messages";

const getRouterLayers: () => Array<ExpressRouterLayer> =
  (): Array<ExpressRouterLayer> => {
    const router: ExpressRouter = new MicrosoftTeamsAPI().getRouter();
    return (
      router as unknown as {
        stack: Array<ExpressRouterLayer>;
      }
    ).stack;
  };

const dispatchThroughRouter: (
  path: string,
  body: JSONObject,
) => Promise<void> = (path: string, body: JSONObject): Promise<void> => {
  return new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void): void => {
      const router: ExpressRouter = new MicrosoftTeamsAPI().getRouter();
      const request: ExpressRequest = {
        method: "POST",
        url: path,
        originalUrl: path,
        baseUrl: "",
        headers: {},
        body: body,
      } as unknown as ExpressRequest;
      const response: ExpressResponse = {} as ExpressResponse;

      router(request, response, (error?: unknown): void => {
        if (error) {
          reject(error as Error);
          return;
        }

        resolve();
      });
    },
  );
};

const getPostRouteHandler: (path: string) => ExpressRouteHandler = (
  path: string,
): ExpressRouteHandler => {
  const layer: ExpressRouterLayer | undefined = getRouterLayers().find(
    (routerLayer: ExpressRouterLayer): boolean => {
      return (
        routerLayer.route?.path === path &&
        routerLayer.route.methods["post"] === true
      );
    },
  );

  if (!layer?.route?.stack[0]) {
    throw new Error(`POST route handler not found for ${path}`);
  }

  return layer.route.stack[0].handle;
};

const forgedInvokeBody: (action: string) => JSONObject = (
  action: string,
): JSONObject => {
  return {
    type: "invoke",
    from: {
      id: "attacker-controlled-linked-teams-user-id",
    },
    conversation: {
      id: "attacker-controlled-conversation-id",
    },
    channelData: {
      team: {
        id: "any-non-empty-team-id",
      },
      tenant: {
        id: "target-connected-tenant-id",
      },
    },
    value: {
      action: action,
      actionValue: "11111111-2222-4333-8444-555555555555",
    },
  };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Microsoft Teams inbound route authentication", () => {
  test("does not register the unauthenticated legacy webhook for any method", () => {
    const legacyLayers: Array<ExpressRouterLayer> = getRouterLayers().filter(
      (layer: ExpressRouterLayer): boolean => {
        return layer.route?.path === LEGACY_WEBHOOK_PATH;
      },
    );

    expect(legacyLayers).toEqual([]);
  });

  test("keeps exactly one POST route for the authenticated Bot Framework adapter", () => {
    /*
     * Counted by method rather than by layer. What must stay unique is the
     * inbound POST — a second one is how the unauthenticated legacy webhook
     * got in, and this test exists to keep it out. The path itself carries a
     * second layer on purpose since the 405 diagnostic landed: a GET handler
     * that answers a browser probe instead of letting it fall through to the
     * catch-all 404, which is what convinced the reporter of #3488 that the
     * route had been dropped from the build.
     *
     * So: exactly one layer accepts POST, and no other layer on this path
     * accepts POST either. The second assertion is the one doing the security
     * work — a layer registered with router.all() would accept POST while
     * reporting no `post` key of its own.
     */
    const botFrameworkLayers: Array<ExpressRouterLayer> =
      getRouterLayers().filter((layer: ExpressRouterLayer): boolean => {
        return layer.route?.path === BOT_FRAMEWORK_PATH;
      });

    const postLayers: Array<ExpressRouterLayer> = botFrameworkLayers.filter(
      (layer: ExpressRouterLayer): boolean => {
        return layer.route?.methods["post"] === true;
      },
    );

    expect(postLayers).toHaveLength(1);
    expect(postLayers[0]!.route!.methods).toEqual({ post: true });

    const otherLayerMethods: Array<string> = botFrameworkLayers
      .filter((layer: ExpressRouterLayer): boolean => {
        return layer !== postLayers[0];
      })
      .flatMap((layer: ExpressRouterLayer): Array<string> => {
        return Object.keys(layer.route!.methods);
      });

    expect(otherLayerMethods).not.toContain("post");
    expect(otherLayerMethods).not.toContain("_all");
  });

  test.each([
    MicrosoftTeamsIncidentActionType.AckIncident,
    MicrosoftTeamsIncidentActionType.ResolveIncident,
    MicrosoftTeamsAlertActionType.AckAlert,
    MicrosoftTeamsAlertActionType.ResolveAlert,
  ])(
    "falls through without lookup or mutation for unsigned forged %s",
    async (action: string) => {
      const projectLookupSpy: SpyInstance<
        typeof WorkspaceProjectAuthTokenService.findOneBy
      > = jest
        .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
        .mockResolvedValue(null);
      const userLookupSpy: SpyInstance<
        typeof WorkspaceUserAuthTokenService.findOneBy
      > = jest
        .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
        .mockResolvedValue(null);
      const acknowledgeIncidentSpy: SpyInstance<
        typeof IncidentService.acknowledgeIncident
      > = jest
        .spyOn(IncidentService, "acknowledgeIncident")
        .mockRejectedValue(new Error("unexpected incident mutation"));
      const resolveIncidentSpy: SpyInstance<
        typeof IncidentService.resolveIncident
      > = jest
        .spyOn(IncidentService, "resolveIncident")
        .mockRejectedValue(new Error("unexpected incident mutation"));
      const acknowledgeAlertSpy: SpyInstance<
        typeof AlertService.acknowledgeAlert
      > = jest
        .spyOn(AlertService, "acknowledgeAlert")
        .mockRejectedValue(new Error("unexpected alert mutation"));
      const resolveAlertSpy: SpyInstance<typeof AlertService.resolveAlert> =
        jest
          .spyOn(AlertService, "resolveAlert")
          .mockRejectedValue(new Error("unexpected alert mutation"));
      const botFrameworkSpy: SpyInstance<
        typeof MicrosoftTeamsUtil.processBotActivity
      > = jest.spyOn(MicrosoftTeamsUtil, "processBotActivity");

      await dispatchThroughRouter(
        LEGACY_WEBHOOK_PATH,
        forgedInvokeBody(action),
      );

      expect(projectLookupSpy).not.toHaveBeenCalled();
      expect(userLookupSpy).not.toHaveBeenCalled();
      expect(acknowledgeIncidentSpy).not.toHaveBeenCalled();
      expect(resolveIncidentSpy).not.toHaveBeenCalled();
      expect(acknowledgeAlertSpy).not.toHaveBeenCalled();
      expect(resolveAlertSpy).not.toHaveBeenCalled();
      expect(botFrameworkSpy).not.toHaveBeenCalled();
    },
  );

  test("delegates the supported endpoint to the Bot Framework adapter", async () => {
    const botFrameworkSpy: SpyInstance<
      typeof MicrosoftTeamsUtil.processBotActivity
    > = jest
      .spyOn(MicrosoftTeamsUtil, "processBotActivity")
      .mockResolvedValue();
    const request: ExpressRequest = {
      body: forgedInvokeBody(MicrosoftTeamsIncidentActionType.ResolveIncident),
    } as unknown as ExpressRequest;
    const response: ExpressResponse = {} as ExpressResponse;
    const handler: ExpressRouteHandler =
      getPostRouteHandler(BOT_FRAMEWORK_PATH);

    await handler(request, response);

    expect(botFrameworkSpy).toHaveBeenCalledTimes(1);
    expect(botFrameworkSpy).toHaveBeenCalledWith(request, response);
  });

  test("adds the linked user's accepted team IDs to the Bot invoke permission context", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();
    const teamIds: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = projectId;
    const tenantPermission: UserTenantAccessPermission = {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: [],
    };

    jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: projectAuth,
        isAmbiguous: false,
        candidateProjectIds: [projectId],
      });
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(userId);
    const membershipSpy: SpyInstance<typeof TeamMemberService.findBy> = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue(
        teamIds.map((teamId: ObjectID): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.teamId = teamId;
          return member;
        }),
      );
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(tenantPermission);
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);
    const handleIncidentSpy: SpyInstance<
      typeof MicrosoftTeamsIncidentActions.handleBotIncidentAction
    > = jest
      .spyOn(MicrosoftTeamsIncidentActions, "handleBotIncidentAction")
      .mockResolvedValue();

    const turnContext: TurnContext = {
      sendActivity: jest.fn(async (): Promise<void> => {}),
    } as unknown as TurnContext;

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: {
        channelData: {
          tenant: {
            id: "connected-tenant-id",
          },
        },
        from: {
          aadObjectId: "linked-teams-user-aad-object-id",
        },
        value: {
          action: MicrosoftTeamsIncidentActionType.AckIncident,
          actionValue: ObjectID.generate().toString(),
        },
      },
      turnContext: turnContext,
    });

    // Membership is read from TeamMember itself, accepted rows only.
    expect(membershipSpy.mock.calls[0]![0].query).toMatchObject({
      userId: userId,
      projectId: projectId,
      hasAcceptedInvitation: true,
    });
    expect(handleIncidentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: expect.objectContaining({
          userId: userId,
          tenantId: projectId,
          userTeamIds: teamIds,
          userTenantAccessPermission: {
            [projectId.toString()]: tenantPermission,
          },
        }),
        turnContext: turnContext,
      }),
    );
  });

  /*
   * A linked Teams account outlives the membership it was linked under. The
   * link alone must not let someone who has left the project act in it, from
   * any card - not only incident and alert ones.
   */
  test("refuses every Bot action from a linked user who is no longer a project member", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = projectId;

    jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: projectAuth,
        isAmbiguous: false,
        candidateProjectIds: [projectId],
      });
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(userId);
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
    const tenantPermissionSpy: SpyInstance<
      typeof AccessTokenService.getUserTenantAccessPermission
    > = jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockRejectedValue(new Error("a non-member's cached permission"));
    const handleIncidentSpy: SpyInstance<
      typeof MicrosoftTeamsIncidentActions.handleBotIncidentAction
    > = jest
      .spyOn(MicrosoftTeamsIncidentActions, "handleBotIncidentAction")
      .mockResolvedValue();
    const handleMonitorSpy: SpyInstance<
      typeof MicrosoftTeamsMonitorActions.handleBotMonitorAction
    > = jest
      .spyOn(MicrosoftTeamsMonitorActions, "handleBotMonitorAction")
      .mockResolvedValue();

    for (const action of [
      MicrosoftTeamsIncidentActionType.AckIncident,
      MicrosoftTeamsMonitorActionType.DisableMonitor,
    ]) {
      const turnContext: TurnContext = {
        sendActivity: jest.fn(async (): Promise<void> => {}),
      } as unknown as TurnContext;

      await MicrosoftTeamsUtil.handleBotInvokeActivity({
        activity: {
          channelData: {
            tenant: {
              id: "connected-tenant-id",
            },
          },
          from: {
            aadObjectId: "linked-teams-user-aad-object-id",
          },
          value: {
            action: action,
            actionValue: ObjectID.generate().toString(),
          },
        },
        turnContext: turnContext,
      });

      expect(turnContext.sendActivity).toHaveBeenCalledWith(
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
    }

    expect(tenantPermissionSpy).not.toHaveBeenCalled();
    expect(handleIncidentSpy).not.toHaveBeenCalled();
    expect(handleMonitorSpy).not.toHaveBeenCalled();
  });

  test("hands the member's props to monitor actions too", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();
    const teamId: ObjectID = ObjectID.generate();
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = projectId;

    jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: projectAuth,
        isAmbiguous: false,
        candidateProjectIds: [projectId],
      });
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(userId);
    const member: TeamMember = new TeamMember();
    member.teamId = teamId;
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([member]);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue({
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: [],
      });
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);
    const handleMonitorSpy: SpyInstance<
      typeof MicrosoftTeamsMonitorActions.handleBotMonitorAction
    > = jest
      .spyOn(MicrosoftTeamsMonitorActions, "handleBotMonitorAction")
      .mockResolvedValue();
    const turnContext: TurnContext = {
      sendActivity: jest.fn(async (): Promise<void> => {}),
    } as unknown as TurnContext;

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: {
        channelData: {
          tenant: {
            id: "connected-tenant-id",
          },
        },
        from: {
          aadObjectId: "linked-teams-user-aad-object-id",
        },
        value: {
          action: MicrosoftTeamsMonitorActionType.ViewMonitor,
          actionValue: ObjectID.generate().toString(),
        },
      },
      turnContext: turnContext,
    });

    expect(handleMonitorSpy).toHaveBeenCalledTimes(1);
    const databaseProps: DatabaseCommonInteractionProps =
      handleMonitorSpy.mock.calls[0]![0].databaseProps;
    expect(databaseProps.userId).toBe(userId);
    expect(databaseProps.tenantId).toBe(projectId);
    expect(databaseProps.userTeamIds).toEqual([teamId]);
  });
});
