import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeRequest,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import {
  AppApiClientUrl,
  DashboardClientUrl,
  DiscordAppClientId,
  DiscordAppClientSecret,
  DiscordBotToken,
  DiscordAppPublicKey,
} from "../EnvironmentConfig";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../Utils/Workspace/WorkspaceOAuthState";
import WorkspaceActionAuthorization from "../Utils/Workspace/WorkspaceActionAuthorization";
import DiscordOAuth, {
  DiscordGuildContext,
} from "../Utils/Workspace/Discord/DiscordOAuth";
import DiscordClient from "../Utils/Workspace/Discord/DiscordClient";
import DiscordInteractionSignature from "../Utils/Workspace/Discord/DiscordInteractionSignature";
import DiscordBindingService, {
  DiscordBindingSnapshot,
} from "../Services/DiscordBindingService";
import IncidentService from "../Services/IncidentService";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import WorkspaceResourceUpdateAuthorization from "../Utils/Workspace/WorkspaceResourceUpdateAuthorization";
import DiscordInteractionDispatcher, {
  DiscordPreparedInteraction,
} from "../Utils/Workspace/Discord/DiscordInteractionDispatcher";
import { DiscordIncidentActionModule } from "../Utils/Workspace/Discord/Actions/Incident";
import { DiscordAlertActionModule } from "../Utils/Workspace/Discord/Actions/Alert";
import { DiscordIncidentEpisodeActionModule } from "../Utils/Workspace/Discord/Actions/IncidentEpisode";
import { DiscordAlertEpisodeActionModule } from "../Utils/Workspace/Discord/Actions/AlertEpisode";
import { DiscordScheduledMaintenanceActionModule } from "../Utils/Workspace/Discord/Actions/ScheduledMaintenance";
import { DiscordMonitorActionModule } from "../Utils/Workspace/Discord/Actions/Monitor";
import PublicDashboardRateLimit, {
  PublicDashboardRateLimitBucket,
  PublicDashboardRateLimitDecision,
  PublicDashboardRateLimitOutcome,
} from "../Middleware/PublicDashboardRateLimit";

// PING (1) is answered inline; these are the types the dispatcher owns.
const DISPATCHED_INTERACTION_TYPES: ReadonlySet<unknown> = new Set<unknown>([
  2, 3, 4, 5,
]);

export default class DiscordAPI {
  private static async rateLimit(
    req: ExpressRequest,
    res: ExpressResponse,
    interaction?: JSONObject,
  ): Promise<boolean> {
    const signed: boolean = Boolean(interaction);
    const decision: PublicDashboardRateLimitDecision =
      await PublicDashboardRateLimit.consume({
        bucket: PublicDashboardRateLimitBucket.Read,
        resourceKey: signed
          ? String(interaction!["guild_id"] || "ping")
          : req.path,
        clientIp: signed
          ? DiscordAppClientId!
          : PublicDashboardRateLimit.resolveClientIp(req),
        counterConfig: {
          keyPrefix: signed ? "discord:rl:verified:" : "discord:rl:setup:",
          windowSeconds: 60,
          perResourceLimit: signed ? 6000 : 600,
          perIpLimit: signed ? 18000 : 1800,
        },
      });
    if (decision.outcome === PublicDashboardRateLimitOutcome.Allowed) {
      return true;
    }
    if (decision.outcome === PublicDashboardRateLimitOutcome.RateLimited) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds || 60));
      res
        .status(429)
        .json({ error: "Too many Discord requests. Try again shortly." });
    } else {
      res.status(503).json({
        error: "Discord request limiting is temporarily unavailable.",
      });
    }
    return false;
  }

  private static callbackUrl(user: boolean): string {
    return (
      AppApiClientUrl.toString().replace(/\/$/, "") +
      "/discord/oauth/" +
      (user ? "user" : "install")
    );
  }

  private static enabled(): boolean {
    return Boolean(
      DiscordAppClientId &&
        DiscordAppClientSecret &&
        DiscordBotToken &&
        DiscordAppPublicKey,
    );
  }

  private static async authorize(
    req: ExpressRequest,
    manage: boolean,
  ): Promise<{ projectId: ObjectID; userId: ObjectID }> {
    const databaseProps: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectMember(databaseProps);
    const userId: ObjectID = databaseProps.userId!;
    await this.authorizeActor(projectId, userId, manage);
    if (!this.enabled()) {
      throw new BadDataException("Discord integration is not configured.");
    }
    return { projectId, userId };
  }

  public static async authorizeActor(
    projectId: ObjectID,
    userId: ObjectID,
    manage: boolean,
  ): Promise<void> {
    const databaseProps: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        projectId,
        userId,
      });
    if (manage) {
      CommonAPI.assertPermittedInProject({
        databaseProps,
        allowedPermissions: WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS,
        errorMessage:
          "You do not have permission to manage this Discord connection.",
      });
    }
  }

  public static async authorizeIncidentActionActor(data: {
    projectId: ObjectID;
    userId: ObjectID;
    incidentId: ObjectID;
    action: "acknowledge" | "resolve";
  }): Promise<void> {
    const databaseProps: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.authorize({
        projectId: data.projectId,
        userId: data.userId,
        modelType: IncidentStateTimeline,
        action: `${data.action} this incident`,
        resources: [{ service: IncidentService, id: data.incidentId }],
      });

    await WorkspaceResourceUpdateAuthorization.assertCanUpdateIncident({
      incidentId: data.incidentId,
      projectId: data.projectId,
      props: databaseProps,
    });
  }

  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();
    // Built on first use so a router with Discord disabled never loads the modules.
    let cachedDispatcher: DiscordInteractionDispatcher | undefined;
    const dispatcher: () => DiscordInteractionDispatcher =
      (): DiscordInteractionDispatcher => {
        cachedDispatcher ||= new DiscordInteractionDispatcher({
          applicationId: DiscordAppClientId!,
          modules: [
            DiscordIncidentActionModule,
            DiscordAlertActionModule,
            DiscordIncidentEpisodeActionModule,
            DiscordAlertEpisodeActionModule,
            DiscordScheduledMaintenanceActionModule,
            DiscordMonitorActionModule,
          ],
        });
        return cachedDispatcher;
      };
    router.use(
      "/discord",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        // Verified provider requests have their own application/guild budgets.
        if (
          req.path === "/interactions" ||
          (await DiscordAPI.rateLimit(req, res))
        ) {
          next();
        }
      },
    );

    router.get(
      "/discord/config",
      async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
        try {
          Response.sendJsonObjectResponse(req, res, {
            enabled: DiscordAPI.enabled(),
            applicationId: DiscordAppClientId || "",
            installCallbackUrl: DiscordAPI.callbackUrl(false),
            userCallbackUrl: DiscordAPI.callbackUrl(true),
            interactionUrl:
              AppApiClientUrl.toString().replace(/\/$/, "") +
              "/discord/interactions",
          });
        } catch (error) {
          Response.sendErrorResponse(req, res, error as Exception);
        }
      },
    );

    for (const user of [false, true]) {
      router.get(
        user ? "/discord/sign-in-url" : "/discord/install-url",
        UserMiddleware.getUserMiddleware,
        async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
          try {
            const actor: { projectId: ObjectID; userId: ObjectID } =
              await DiscordAPI.authorize(req, !user);
            const binding: DiscordBindingSnapshot =
              await DiscordBindingService.snapshot(
                actor.projectId,
                user ? actor.userId : undefined,
              );
            if (user && !binding.workspaceProjectId) {
              throw new BadDataException(
                "Connect this project's Discord server before linking your account.",
              );
            }
            const created: { state: string } = await WorkspaceOAuthState.create(
              {
                req,
                res,
                ...actor,
                flow: user
                  ? WorkspaceOAuthFlow.DiscordUserSignIn
                  : WorkspaceOAuthFlow.DiscordInstall,
                bindingSnapshot: binding.fingerprint,
                workspaceProjectId: binding.workspaceProjectId,
              },
            );
            const params: URLSearchParams = new URLSearchParams({
              client_id: DiscordAppClientId!,
              response_type: "code",
              redirect_uri: DiscordAPI.callbackUrl(user),
              state: created.state,
              scope: user
                ? "identify guilds.members.read"
                : "bot applications.commands identify guilds",
              ...(user
                ? {}
                : {
                    integration_type: "0",
                    permissions: DiscordOAuth.REQUIRED_PERMISSIONS.toString(),
                  }),
            });
            if (!user && binding.workspaceProjectId) {
              params.set("guild_id", binding.workspaceProjectId);
              params.set("disable_guild_select", "true");
            }
            Response.sendJsonObjectResponse(req, res, {
              authorizationUrl:
                "https://discord.com/oauth2/authorize?" + params.toString(),
            });
          } catch (error) {
            Response.sendErrorResponse(req, res, error as Exception);
          }
        },
      );

      router.get(
        user ? "/discord/oauth/user" : "/discord/oauth/install",
        async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
          let state: WorkspaceOAuthStateRecord | null = null;
          try {
            state = await WorkspaceOAuthState.consume({
              req,
              state:
                typeof req.query["state"] === "string"
                  ? req.query["state"]
                  : undefined,
              flows: [
                user
                  ? WorkspaceOAuthFlow.DiscordUserSignIn
                  : WorkspaceOAuthFlow.DiscordInstall,
              ],
            });
            if (!state || !state.bindingSnapshot) {
              throw new BadDataException(
                WorkspaceOAuthState.INVALID_STATE_MESSAGE,
              );
            }
            if (!DiscordAPI.enabled() || req.query["error"]) {
              throw new BadDataException(
                "Discord authorization was not completed.",
              );
            }
            await DiscordAPI.authorizeActor(
              state.projectId,
              state.userId,
              !user,
            );
            const token: JSONObject = await DiscordOAuth.exchange(
              typeof req.query["code"] === "string" ? req.query["code"] : "",
              DiscordAPI.callbackUrl(user),
            );
            const accessToken: string = token["access_token"] as string;
            const identity: JSONObject =
              await DiscordOAuth.identify(accessToken);
            if (user) {
              if (!state.workspaceProjectId) {
                throw new BadDataException(
                  "The project's Discord server changed. Start again.",
                );
              }
              await DiscordOAuth.assertUserMembership(
                accessToken,
                state.workspaceProjectId,
                identity["id"] as string,
              );
              await DiscordBindingService.link({ state, identity });
            } else {
              const guildId: string = DiscordClient.snowflake(
                String(
                  (token["guild"] as JSONObject | undefined)?.["id"] || "",
                ),
              );
              if (req.query["guild_id"] && req.query["guild_id"] !== guildId) {
                throw new BadDataException(
                  "Discord returned a different server. Start again.",
                );
              }
              await DiscordOAuth.assertInstaller(accessToken, guildId);
              const context: DiscordGuildContext =
                await DiscordOAuth.guildContext(guildId);
              // A binding without its commands would advertise actions Discord cannot deliver.
              await DiscordClient.upsertGuildCommands({
                authToken: DiscordBotToken!,
                applicationId: DiscordAppClientId!,
                guildId,
                commands: dispatcher().commandPayloads(),
              });
              await DiscordBindingService.install({
                state,
                guildId,
                guildName: String(context.guild["name"] || "Discord server"),
                botUserId: String(context.bot["id"]),
              });
            }
            res.redirect(DiscordAPI.settingsUrl(state, user) + "?success=true");
          } catch {
            if (state) {
              res.redirect(
                DiscordAPI.settingsUrl(state, user) +
                  "?error=" +
                  encodeURIComponent(
                    "Discord connection could not be verified. Start again from these settings.",
                  ),
              );
            } else {
              Response.sendErrorResponse(
                req,
                res,
                new BadDataException(WorkspaceOAuthState.INVALID_STATE_MESSAGE),
              );
            }
          }
        },
      );
    }

    router.get(
      "/discord/channels",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
        try {
          const actor: { projectId: ObjectID; userId: ObjectID } =
            await DiscordAPI.authorize(req, true);
          const binding: DiscordBindingSnapshot =
            await DiscordBindingService.snapshot(actor.projectId);
          if (!binding.workspaceProjectId) {
            throw new BadDataException(
              "Connect this project's Discord server first.",
            );
          }
          const context: DiscordGuildContext = await DiscordOAuth.guildContext(
            binding.workspaceProjectId,
          );
          const channels: Array<JSONObject> = (await DiscordOAuth.bot(
            `/guilds/${binding.workspaceProjectId}/channels`,
          )) as Array<JSONObject>;
          if (!Array.isArray(channels)) {
            throw new BadDataException("Discord returned invalid channels.");
          }
          Response.sendJsonObjectResponse(req, res, {
            channels: channels
              .filter((channel: JSONObject): boolean => {
                return DiscordOAuth.isEligibleParent(channel, context);
              })
              .map((channel: JSONObject): JSONObject => {
                return {
                  id: channel["id"]!,
                  name: channel["name"]!,
                };
              }),
          });
        } catch (error) {
          Response.sendErrorResponse(req, res, error as Exception);
        }
      },
    );

    router.put(
      "/discord/incident-channel",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
        try {
          const actor: { projectId: ObjectID; userId: ObjectID } =
            await DiscordAPI.authorize(req, true);
          const binding: DiscordBindingSnapshot =
            await DiscordBindingService.snapshot(actor.projectId);
          if (!binding.workspaceProjectId) {
            throw new BadDataException(
              "Connect this project's Discord server first.",
            );
          }
          const channelId: string = DiscordClient.snowflake(
            typeof req.body?.channelId === "string" ? req.body.channelId : "",
          );
          const context: DiscordGuildContext = await DiscordOAuth.guildContext(
            binding.workspaceProjectId,
          );
          const channel: JSONObject = (await DiscordOAuth.bot(
            `/channels/${channelId}`,
          )) as JSONObject;
          if (
            channel["id"] !== channelId ||
            !DiscordOAuth.isEligibleParent(channel, context)
          ) {
            throw new BadDataException(
              "Choose a text channel in the connected server where the bot can create, send to, and manage incident threads.",
            );
          }
          await DiscordBindingService.setParent({
            ...actor,
            binding,
            channelId,
          });
          Response.sendJsonObjectResponse(req, res, { channelId });
        } catch (error) {
          Response.sendErrorResponse(req, res, error as Exception);
        }
      },
    );

    router.post(
      "/discord/interactions",
      async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
        const rawBody: string | undefined = (req as OneUptimeRequest).rawBody;
        if (
          !rawBody ||
          !DiscordAppPublicKey ||
          !DiscordInteractionSignature.verify({
            publicKey: DiscordAppPublicKey,
            signature: String(req.headers["x-signature-ed25519"] || ""),
            timestamp: String(req.headers["x-signature-timestamp"] || ""),
            rawBody: Buffer.from(rawBody, "utf8"),
          })
        ) {
          if (!(await DiscordAPI.rateLimit(req, res))) {
            return;
          }
          res.status(401).json({ error: "Invalid Discord signature." });
          return;
        }
        try {
          const interaction: JSONObject = JSON.parse(rawBody) as JSONObject;
          if (interaction["application_id"] === DiscordAppClientId) {
            if (!(await DiscordAPI.rateLimit(req, res, interaction))) {
              return;
            }
          } else if (!(await DiscordAPI.rateLimit(req, res))) {
            return;
          }
          if (interaction["application_id"] !== DiscordAppClientId) {
            res
              .status(400)
              .json({ error: "Discord interaction is not supported." });
            return;
          }
          if (interaction["type"] === 1) {
            res.json({ type: 1 });
            return;
          }
          if (!DISPATCHED_INTERACTION_TYPES.has(interaction["type"])) {
            res
              .status(400)
              .json({ error: "Discord interaction is not supported." });
            return;
          }
          const prepared: DiscordPreparedInteraction =
            await dispatcher().prepare(interaction);
          res.json(prepared.initialResponse);
          if (prepared.runAfterResponse) {
            /*
             * Deferred work must start only after the initial callback is
             * committed; Discord fails the interaction if it waits on it.
             */
            prepared.runAfterResponse().catch((): void => {});
          }
        } catch {
          res.status(400).json({ error: "Invalid Discord interaction." });
        }
      },
    );
    return router;
  }

  private static settingsUrl(
    state: WorkspaceOAuthStateRecord,
    user: boolean,
  ): string {
    return (
      DashboardClientUrl.toString().replace(/\/$/, "") +
      "/" +
      state.projectId.toString() +
      (user ? "/user-settings/" : "/settings/") +
      "discord-integration"
    );
  }
}
