import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
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
    const botFrameworkLayers: Array<ExpressRouterLayer> =
      getRouterLayers().filter((layer: ExpressRouterLayer): boolean => {
        return layer.route?.path === BOT_FRAMEWORK_PATH;
      });

    expect(botFrameworkLayers).toHaveLength(1);
    expect(botFrameworkLayers[0]!.route!.methods).toEqual({ post: true });
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

    const databaseProps: DatabaseCommonInteractionProps = {
      userId: userId,
      tenantId: projectId,
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
    jest
      .spyOn(
        AccessTokenService,
        "getDatabaseCommonInteractionPropsByUserAndProject",
      )
      .mockResolvedValue(databaseProps);
    const getTeamIdsSpy: SpyInstance<
      typeof TeamMemberService.getTeamIdsForUser
    > = jest
      .spyOn(TeamMemberService, "getTeamIdsForUser")
      .mockResolvedValue(teamIds);
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

    expect(getTeamIdsSpy).toHaveBeenCalledWith(userId, projectId);
    expect(databaseProps.userTeamIds).toEqual(teamIds);
    expect(handleIncidentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: expect.objectContaining({
          userTeamIds: teamIds,
        }),
        turnContext: turnContext,
      }),
    );
  });

  test("does not load incident or alert permissions for an unrelated Bot action", async () => {
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
    const databasePropsSpy: SpyInstance<
      typeof AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject
    > = jest
      .spyOn(
        AccessTokenService,
        "getDatabaseCommonInteractionPropsByUserAndProject",
      )
      .mockRejectedValue(new Error("unexpected permission lookup"));
    const getTeamIdsSpy: SpyInstance<
      typeof TeamMemberService.getTeamIdsForUser
    > = jest
      .spyOn(TeamMemberService, "getTeamIdsForUser")
      .mockRejectedValue(new Error("unexpected team lookup"));
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

    expect(databasePropsSpy).not.toHaveBeenCalled();
    expect(getTeamIdsSpy).not.toHaveBeenCalled();
    expect(handleMonitorSpy).toHaveBeenCalledTimes(1);
  });
});
