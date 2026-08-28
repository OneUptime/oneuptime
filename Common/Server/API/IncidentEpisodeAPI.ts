import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import ObjectID from "../../Types/ObjectID";
import IncidentEpisodeService, {
  Service as IncidentEpisodeServiceType,
} from "../Services/IncidentEpisodeService";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIService, {
  AILogRequest,
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../Services/AIService";
import IncidentEpisodeAIContextBuilder, {
  IncidentEpisodeContextData,
} from "../Utils/AI/IncidentEpisodeAIContextBuilder";
import { AIGenerationContext } from "../Utils/AI/IncidentAIContextBuilder";
import JSONFunctions from "../../Types/JSONFunctions";
import Permission, { UserPermission } from "../../Types/Permission";

export default class IncidentEpisodeAPI extends BaseAPI<
  IncidentEpisode,
  IncidentEpisodeServiceType
> {
  public constructor() {
    super(IncidentEpisode, IncidentEpisodeService);

    // Generate postmortem from AI
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/generate-postmortem-from-ai/:episodeId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.generatePostmortemFromAI(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async generatePostmortemFromAI(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const episodeIdParam: string | undefined = req.params["episodeId"];

    if (!episodeIdParam) {
      throw new BadDataException("Episode ID is required");
    }

    let episodeId: ObjectID;

    try {
      episodeId = new ObjectID(episodeIdParam);
    } catch {
      throw new BadDataException("Invalid Episode ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertTenantScoped(props);

    /*
     * Read through getUserPermissions(Allow) rather than off
     * userTenantAccessPermission directly. That dictionary is keyed by project
     * id and its entries hold GRANTS AND DENIALS together, discriminated only
     * by isBlockPermission, so the previous
     * `userTenantAccessPermission["permissions"]` read was always undefined
     * and denied every caller who was not a master admin. Mapping the array
     * raw would swing the other way and count a team's explicit block
     * entry for one of these permissions as a grant of it.
     */
    const permissions: Array<Permission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).map((userPermission: UserPermission) => {
        return userPermission.permission;
      });

    const hasPermission: boolean = permissions.some((p: Permission) => {
      return (
        p === Permission.ProjectOwner ||
        p === Permission.ProjectAdmin ||
        p === Permission.EditIncidentEpisode
      );
    });

    if (!hasPermission && !props.isMasterAdmin) {
      throw new BadDataException(
        "You do not have permission to generate postmortem for this episode. You need to have one of these permissions: Project Owner, Project Admin, Edit Incident Episode.",
      );
    }

    // Get the template from request body if provided
    const template: string | undefined = JSONFunctions.getJSONValueInPath(
      req.body,
      "template",
    ) as string | undefined;

    // Always include workspace messages for comprehensive context
    const includeWorkspaceMessages: boolean = true;

    // Get the episode to verify it exists and get the project ID
    const episode: IncidentEpisode | null = await this.service.findOneById({
      id: episodeId,
      select: {
        _id: true,
        projectId: true,
      },
      props,
    });

    if (!episode || !episode.projectId) {
      throw new NotFoundException("Episode not found");
    }

    // Build episode context
    const contextData: IncidentEpisodeContextData =
      await IncidentEpisodeAIContextBuilder.buildEpisodeContext({
        episodeId,
        includeWorkspaceMessages,
        workspaceMessageLimit: 500,
      });

    // Format context for postmortem generation
    const aiContext: AIGenerationContext =
      IncidentEpisodeAIContextBuilder.formatEpisodeContextForPostmortem(
        contextData,
        template,
      );

    // Generate postmortem using AIService (handles billing and logging)
    const aiLogRequest: AILogRequest = {
      projectId: episode.projectId,
      feature: "Incident Episode Postmortem",
      messages: aiContext.messages,
      maxTokens: 8192,
      temperature: 0.2,
      /*
       * This request holds the browser's connection open across the whole
       * completion, behind nginx's 300s budget for /api. Bound the provider
       * call below that and take a single attempt, so a slow or broken
       * provider answers with its own error instead of the proxy's gateway
       * timeout — see INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS.
       */
      requestTimeoutInMs: INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
      requestRetries: 0,
      /*
       * G8: the prompt embeds incident/alert/maintenance context whose read
       * ACLs are narrower than LlmLog's — do not store previews.
       */
      storeContentPreviews: false,
    };

    if (props.userId) {
      aiLogRequest.userId = props.userId;
    }

    const response: AILogResponse =
      await AIService.executeWithLogging(aiLogRequest);

    return Response.sendJsonObjectResponse(req, res, {
      postmortemNote: response.content,
    });
  }
}
