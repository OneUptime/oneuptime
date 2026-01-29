import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
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
import AIService, { AILogRequest, AILogResponse } from "../Services/AIService";
import IncidentEpisodeAIContextBuilder, {
  IncidentEpisodeContextData,
} from "../Utils/AI/IncidentEpisodeAIContextBuilder";
import { AIGenerationContext } from "../Utils/AI/IncidentAIContextBuilder";
import JSONFunctions from "../../Types/JSONFunctions";
import Permission from "../../Types/Permission";

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

    // Verify user has permission to edit the episode
    const permissions: Array<Permission> | undefined = props
      .userTenantAccessPermission?.["permissions"] as
      | Array<Permission>
      | undefined;

    const hasPermission: boolean = permissions
      ? permissions.some((p: Permission) => {
          return (
            p === Permission.ProjectOwner ||
            p === Permission.ProjectAdmin ||
            p === Permission.EditIncidentEpisode
          );
        })
      : false;

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
      temperature: 0.7,
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
