import express, { Request, Response } from "express";
import { CloudAdapter, TurnContext, ConversationReference } from "botbuilder";
import {
  MicrosoftTeamsAppClientId,
  MicrosoftTeamsAppClientSecret,
} from "../EnvironmentConfig";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import logger from "../Utils/Logger";
import BadRequestException from "../../Types/Exception/BadRequestException";

// Router to handle incoming Microsoft Teams Bot messages
const router: express.Router = express.Router();

if (!MicrosoftTeamsAppClientId || !MicrosoftTeamsAppClientSecret) {
  logger.warn(
    "Microsoft Teams Bot credentials not set (MICROSOFT_TEAMS_APP_CLIENT_ID / MICROSOFT_TEAMS_APP_CLIENT_SECRET). Incoming endpoint will reject requests.",
  );
}

// -------------------------------------------------------------
// Action Dispatcher (Adaptive Card Action.Submit)
// -------------------------------------------------------------

export interface TeamsActionContext {
  turnContext: TurnContext;
  rawActivity: any; // underlying activity payload
  projectAuthTokens: Array<WorkspaceProjectAuthToken>; // matching tenant/team project auths (if available)
}

export type TeamsActionHandler = (params: {
  actionId: string;
  data: any;
  context: TeamsActionContext;
}) => Promise<{
  status?: number; // default 200
  message?: string;
  responseBody?: any; // extra JSON to return to client
}>;

// Registry for action handlers. Keyed by actionId prefix for flexible pattern matching.
// Example: register 'incident:' to catch 'incident:ack', 'incident:close', etc.
const teamsActionHandlers: Array<{
  prefix: string;
  handler: TeamsActionHandler;
}> = [];

export const registerTeamsActionHandler = (
  prefix: string,
  handler: TeamsActionHandler,
): void => {
  teamsActionHandlers.push({ prefix, handler });
  logger.debug(`Registered Teams action handler for prefix '${prefix}'`);
};

const dispatchTeamsAction = async (params: {
  actionId: string;
  data: any;
  context: TeamsActionContext;
}): Promise<{ status: number; body: any }> => {
  const { actionId, data, context } = params;
  // Find first matching handler by longest prefix match
  const sortedHandlers = [...teamsActionHandlers].sort((a, b) => {
    return b.prefix.length - a.prefix.length;
  });
  for (const entry of sortedHandlers) {
    if (actionId.startsWith(entry.prefix)) {
      try {
        const result = await entry.handler({ actionId, data, context });
        return {
          status: result.status || 200,
          body: {
            ok: true,
            actionId,
            message: result.message || "Action processed successfully.",
            ...(result.responseBody || {}),
          },
        };
      } catch (err) {
        logger.error(`Teams action handler failed for actionId='${actionId}'`);
        logger.error(err);
        return {
          status: 500,
          body: { ok: false, actionId, error: "Handler execution failed." },
        };
      }
    }
  }
  // No handler found
  return {
    status: 200,
    body: {
      ok: true,
      actionId,
      message:
        "No handler registered for this action. (Default acknowledgement)",
    },
  };
};

// Single CloudAdapter instance (new Bot Framework adapter) created only if credentials are present
let adapter: CloudAdapter | null = null;
if (MicrosoftTeamsAppClientId && MicrosoftTeamsAppClientSecret) {
  try {
    // CloudAdapter can accept an options object with credentials directly (simpler than custom factory for now)
    adapter = new CloudAdapter({
      MicrosoftAppId: MicrosoftTeamsAppClientId,
      MicrosoftAppPassword: MicrosoftTeamsAppClientSecret,
    } as any);
  } catch (err) {
    logger.error("Failed to initialize CloudAdapter for Microsoft Teams bot:");
    logger.error(err);
    adapter = null;
  }
}

router.post("/messages", async (req: Request, res: Response) => {
  if (!adapter) {
    res.status(503).json({
      error:
        "Teams bot not configured. Set MICROSOFT_TEAMS_APP_CLIENT_ID and MICROSOFT_TEAMS_APP_CLIENT_SECRET.",
    });
    return;
  }

  try {
    await adapter.process(req, res, async (context: TurnContext) => {
      const activity: any = context.activity;
      if (!activity) {
        return;
      }

      // Capture conversation reference for channel or personal (1:1) messages
      if (activity.channelId === "msteams") {
        try {
          // getConversationReference returns Partial<ConversationReference> under strict optional settings
          const convRef: Partial<ConversationReference> =
            TurnContext.getConversationReference(activity);
          const teamId: string | undefined =
            activity?.channelData?.team?.id || activity?.conversation?.tenantId;
          const channelId: string | undefined =
            activity?.channelData?.channel?.id || activity?.conversation?.id;
          const isPersonal: boolean =
            activity?.conversation?.conversationType === "personal";

          if (teamId && channelId) {
            // Find matching WorkspaceProjectAuthToken by teamId in miscData
            const projectAuths: Array<WorkspaceProjectAuthToken> =
              await WorkspaceProjectAuthTokenService.findBy({
                query: {
                  workspaceType: WorkspaceType.MicrosoftTeams,
                },
                select: {
                  miscData: true,
                },
                limit: 100,
                skip: 0,
                props: { isRoot: true },
              });

            for (const auth of projectAuths) {
              const misc: MicrosoftTeamsMiscData | undefined =
                auth.miscData as MicrosoftTeamsMiscData;
              if (misc && misc.teamId === teamId) {
                misc.botInstalled = true;
                misc.botConversationReferences =
                  misc.botConversationReferences || {};
                if (isPersonal) {
                  // personal chat: store under user id
                  const userAadId: string | undefined =
                    activity?.from?.aadObjectId || activity?.from?.id;
                  if (userAadId) {
                    misc.botUserConversationReferences =
                      misc.botUserConversationReferences || {};
                    misc.botUserConversationReferences[userAadId] =
                      convRef as ConversationReference;
                    logger.debug(
                      `Stored personal conversation reference for user ${userAadId} in team ${teamId}`,
                    );
                  } else {
                    logger.warn(
                      "Could not determine AAD user id for personal conversation reference.",
                    );
                  }
                } else {
                  misc.botConversationReferences[channelId] =
                    convRef as ConversationReference;
                  logger.debug(
                    `Stored conversation reference for team ${teamId}, channel ${channelId}`,
                  );
                }
                try {
                  await WorkspaceProjectAuthTokenService.updateOneById({
                    id: auth.id!,
                    data: { miscData: misc },
                    props: { isRoot: true },
                  });
                } catch (updateErr) {
                  logger.error(
                    "Failed to persist Teams conversation reference:",
                  );
                  logger.error(updateErr);
                }
              }
            }
          }
        } catch (convErr) {
          logger.error(
            "Error capturing/storing Microsoft Teams conversation reference:",
          );
          logger.error(convErr);
        }
      }

      // Basic echo / acknowledgement for messages so user sees bot is active
      if (activity.type === "message" && activity.text) {
        await context.sendActivity(
          "OneUptime bot registered this channel for notifications.",
        );
      }

      // Handle Adaptive Card Action.Submit (invoke) activities
      if (activity.type === "invoke") {
        try {
          const name: string | undefined = activity.name;
          const value: any = activity.value;
          // We treat any submit as an acknowledgement for now; future: route by actionId
          const actionId: string | undefined =
            value?.data?.actionId || value?.actionId || value?.actionID;
          logger.debug("Received Action.Submit invoke from Teams bot:");
          logger.debug({ name, actionId, value });

          if (!actionId) {
            await context.sendActivity({
              type: "invokeResponse",
              value: {
                status: 400,
                body: { ok: false, error: "Missing actionId" },
              },
            });
            return;
          }

          // Gather matching project auth tokens by tenant/team if possible for handler context
          let projectAuthMatches: Array<WorkspaceProjectAuthToken> = [];
          try {
            const teamId: string | undefined =
              activity?.channelData?.team?.id ||
              activity?.conversation?.tenantId;
            if (teamId) {
              projectAuthMatches =
                await WorkspaceProjectAuthTokenService.findBy({
                  query: { workspaceType: WorkspaceType.MicrosoftTeams },
                  select: {
                    _id: true,
                    miscData: true,
                    authToken: true,
                    projectId: true,
                  },
                  limit: 50,
                  skip: 0,
                  props: { isRoot: true },
                });
              projectAuthMatches = projectAuthMatches.filter((pa) => {
                return (
                  (pa.miscData as MicrosoftTeamsMiscData)?.teamId === teamId
                );
              });
            }
          } catch (matchErr) {
            logger.error(
              "Error matching project auth tokens for action handler context:",
            );
            logger.error(matchErr);
          }

          const dispatchResult = await dispatchTeamsAction({
            actionId,
            data: value?.data || value,
            context: {
              turnContext: context,
              rawActivity: activity,
              projectAuthTokens: projectAuthMatches,
            },
          });

          await context.sendActivity({
            type: "invokeResponse",
            value: { status: dispatchResult.status, body: dispatchResult.body },
          });
        } catch (invokeErr) {
          logger.error("Error handling Teams invoke activity:");
          logger.error(invokeErr);
          await context.sendActivity({
            type: "invokeResponse",
            value: { status: 500, body: { ok: false } },
          });
        }
      }
    });
  } catch (err) {
    logger.error("Error processing Teams bot activity:");
    logger.error(err);
    if (err instanceof BadRequestException) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: "Internal bot processing error" });
    }
  }
});

export default router;
