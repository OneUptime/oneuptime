import Incident from "../../Models/DatabaseModels/Incident";
import File from "../../Models/DatabaseModels/File";
import NotFoundException from "../../Types/Exception/NotFoundException";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import IncidentService, {
  Service as IncidentServiceType,
} from "../Services/IncidentService";
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
import LLMService, { LLMProviderConfig } from "../Utils/LLM/LLMService";
import IncidentAIContextBuilder, {
  AIGenerationContext,
  IncidentContextData,
} from "../Utils/AI/IncidentAIContextBuilder";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";
import LlmProviderService from "../Services/LlmProviderService";
import JSONFunctions from "../../Types/JSONFunctions";
import Permission from "../../Types/Permission";

export default class IncidentAPI extends BaseAPI<
  Incident,
  IncidentServiceType
> {
  public constructor() {
    super(Incident, IncidentService);

    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/postmortem/attachment/:projectId/:incidentId/:fileId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getPostmortemAttachment(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // Generate postmortem from AI
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/generate-postmortem-from-ai/:incidentId`,
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

  private async getPostmortemAttachment(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const projectIdParam: string | undefined = req.params["projectId"];
    const incidentIdParam: string | undefined = req.params["incidentId"];
    const fileIdParam: string | undefined = req.params["fileId"];

    if (!projectIdParam || !incidentIdParam || !fileIdParam) {
      throw new NotFoundException("Attachment not found");
    }

    let incidentId: ObjectID;
    let fileId: ObjectID;
    let projectId: ObjectID;

    try {
      incidentId = new ObjectID(incidentIdParam);
      fileId = new ObjectID(fileIdParam);
      projectId = new ObjectID(projectIdParam);
    } catch {
      throw new NotFoundException("Attachment not found");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const incident: Incident | null = await this.service.findOneBy({
      query: {
        _id: incidentId,
        projectId,
      },
      select: {
        postmortemAttachments: {
          _id: true,
          file: true,
          fileType: true,
          name: true,
        },
      },
      props,
    });

    if (!incident) {
      throw new NotFoundException("Attachment not found");
    }

    const attachment: File | undefined = incident.postmortemAttachments?.find(
      (file: File) => {
        const attachmentId: string | null = file._id
          ? file._id.toString()
          : file.id
            ? file.id.toString()
            : null;
        return attachmentId === fileId.toString();
      },
    );

    if (!attachment || !attachment.file) {
      throw new NotFoundException("Attachment not found");
    }

    Response.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, attachment);
  }

  private async generatePostmortemFromAI(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const incidentIdParam: string | undefined = req.params["incidentId"];

    if (!incidentIdParam) {
      throw new BadDataException("Incident ID is required");
    }

    let incidentId: ObjectID;

    try {
      incidentId = new ObjectID(incidentIdParam);
    } catch {
      throw new BadDataException("Invalid Incident ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    // Verify user has permission to edit the incident
    const permissions: Array<Permission> | undefined =
      props.userTenantAccessPermission?.["permissions"] as
        | Array<Permission>
        | undefined;

    const hasPermission: boolean = permissions
      ? permissions.some((p: Permission) => {
          return (
            p === Permission.ProjectOwner ||
            p === Permission.ProjectAdmin ||
            p === Permission.EditProjectIncident
          );
        })
      : false;

    if (!hasPermission && !props.isMasterAdmin) {
      throw new BadDataException(
        "You do not have permission to generate postmortem for this incident. You need to have one of these permissions: Project Owner, Project Admin, Edit Project Incident.",
      );
    }

    // Get the template from request body if provided
    const template: string | undefined = JSONFunctions.getJSONValueInPath(
      req.body,
      "template",
    ) as string | undefined;

    // Always include workspace messages for comprehensive context
    const includeWorkspaceMessages: boolean = true;

    // Get the incident to verify it exists and get the project ID
    const incident: Incident | null = await this.service.findOneById({
      id: incidentId,
      select: {
        _id: true,
        projectId: true,
      },
      props,
    });

    if (!incident || !incident.projectId) {
      throw new NotFoundException("Incident not found");
    }

    // Get LLM provider for the project
    const llmProvider: LlmProvider | null =
      await LlmProviderService.getLLMProviderForProject(incident.projectId);

    if (!llmProvider) {
      throw new BadDataException(
        "No LLM provider configured for this project. Please configure an LLM provider in Settings > AI > LLM Providers.",
      );
    }

    if (!llmProvider.llmType) {
      throw new BadDataException(
        "LLM provider type is not configured properly.",
      );
    }

    // Build incident context
    const contextData: IncidentContextData =
      await IncidentAIContextBuilder.buildIncidentContext({
        incidentId,
        includeWorkspaceMessages,
        workspaceMessageLimit: 500,
      });

    // Format context for postmortem generation
    const aiContext: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(contextData, template);

    // Generate postmortem using LLM
    const llmConfig: LLMProviderConfig = {
      llmType: llmProvider.llmType,
    };

    if (llmProvider.apiKey) {
      llmConfig.apiKey = llmProvider.apiKey;
    }

    if (llmProvider.baseUrl) {
      llmConfig.baseUrl = llmProvider.baseUrl.toString();
    }

    if (llmProvider.modelName) {
      llmConfig.modelName = llmProvider.modelName;
    }

    const response = await LLMService.getCompletion({
      llmProviderConfig: llmConfig,
      messages: aiContext.messages,
      maxTokens: 8192,
      temperature: 0.7,
    });

    return Response.sendJsonObjectResponse(req, res, {
      postmortemNote: response.content,

    });
  }
}
