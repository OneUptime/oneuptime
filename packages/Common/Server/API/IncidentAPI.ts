import Incident from "../../Models/DatabaseModels/Incident";
import File from "../../Models/DatabaseModels/File";
import NotFoundException from "../../Types/Exception/NotFoundException";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
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
import AIService, {
  AILogRequest,
  AILogResponse,
  INTERACTIVE_AI_GENERATION_TIMEOUT_IN_MS,
} from "../Services/AIService";
import IncidentAIContextBuilder, {
  AIGenerationContext,
  IncidentContextData,
} from "../Utils/AI/IncidentAIContextBuilder";
import JSONFunctions from "../../Types/JSONFunctions";
import Permission, { UserPermission } from "../../Types/Permission";
import { JSONObject } from "../../Types/JSON";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceResult,
} from "../../Types/StatusPage/IncidentSubscriberAudience";
import IncidentSubscriberAudienceBuilder, {
  IncidentSubscriberAudienceRequest,
} from "../Utils/StatusPage/IncidentSubscriberAudienceBuilder";

export default class IncidentAPI extends BaseAPI<
  Incident,
  IncidentServiceType
> {
  /*
   * The roles that may see who an incident's notifications would reach: the
   * ones that may declare an incident, edit one, or post a public note on
   * one - the three places the audience is shown. Which incident, monitors
   * and status pages the answer covers is then bounded by what the caller
   * may read (IncidentSubscriberAudienceBuilder, which the notification
   * preview checks against too).
   */
  public static readonly SUBSCRIBER_AUDIENCE_PERMISSIONS: ReadonlyArray<Permission> =
    IncidentSubscriberAudienceBuilder.PERMISSIONS;

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
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.generatePostmortemFromAI(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // Generate note from AI
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/generate-note-from-ai/:incidentId`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.generateNoteFromAI(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Who an incident's status page notifications would reach, before it is
     * declared or a public note is posted (see IncidentSubscriberAudience).
     * A POST because the monitors and status pages of an incident being
     * declared travel in the body.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/subscriber-audience`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getSubscriberAudience(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async getSubscriberAudience(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    /*
     * The project is the caller's tenant. Project API keys are admitted like
     * signed-in members: the permission check below and the reads the
     * answer is built from are what bound it.
     */
    const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

    // One of the roles that may see the audience (read as Allow grants).
    IncidentSubscriberAudienceBuilder.assertCallerMaySeeAudience(props);

    const request: IncidentSubscriberAudienceRequest =
      IncidentAPI.parseSubscriberAudienceRequest({
        body: req.body,
        projectId: projectId,
        props: props,
      });

    const audience: IncidentSubscriberAudienceResult =
      await IncidentSubscriberAudienceBuilder.build(request);

    Response.setNoCacheHeaders(res);

    return Response.sendJsonObjectResponse(
      req,
      res,
      IncidentSubscriberAudience.toJSON(audience),
    );
  }

  /*
   * The request body: {incidentId} for an incident that exists, or
   * {monitorIds, statusPageIds} for one being declared - never both. With
   * incidentId, excludeStatusPagesNotifiedOnCreation asks who a Retry of
   * its 'created' notification reaches.
   */
  public static parseSubscriberAudienceRequest(data: {
    body: unknown;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): IncidentSubscriberAudienceRequest {
    const body: JSONObject =
      data.body && typeof data.body === "object" && !Array.isArray(data.body)
        ? (data.body as JSONObject)
        : {};

    const hasIncidentId: boolean =
      body["incidentId"] !== undefined && body["incidentId"] !== null;
    const hasDraft: boolean =
      (body["monitorIds"] !== undefined && body["monitorIds"] !== null) ||
      (body["statusPageIds"] !== undefined && body["statusPageIds"] !== null);

    if (hasIncidentId && hasDraft) {
      throw new BadDataException(
        "Send either incidentId, or monitorIds and statusPageIds - not both.",
      );
    }

    if (hasIncidentId) {
      return {
        projectId: data.projectId,
        props: data.props,
        incidentId: IncidentAPI.parseObjectID(body["incidentId"], "incidentId"),
        // Who a Retry of its 'created' notification reaches: only a real yes.
        ...(body["excludeStatusPagesNotifiedOnCreation"] === true
          ? { excludeStatusPagesNotifiedOnCreation: true }
          : {}),
      };
    }

    if (!hasDraft) {
      throw new BadDataException(
        "Send incidentId, or monitorIds and statusPageIds.",
      );
    }

    return {
      projectId: data.projectId,
      props: data.props,
      monitorIds: IncidentAPI.parseObjectIDs(body["monitorIds"], "monitorIds"),
      statusPageIds: IncidentAPI.parseObjectIDs(
        body["statusPageIds"],
        "statusPageIds",
      ),
    };
  }

  // An id as a string or a serialized ObjectID.
  private static parseObjectID(value: unknown, name: string): ObjectID {
    let id: string = "";

    if (typeof value === "string") {
      id = value;
    } else if (value instanceof ObjectID) {
      id = value.toString();
    } else if (value && typeof value === "object") {
      id = new ObjectID(value as JSONObject).toString();
    }

    id = id.trim();

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException(`${name} must be a valid ID.`);
    }

    return new ObjectID(id);
  }

  private static parseObjectIDs(value: unknown, name: string): Array<ObjectID> {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadDataException(`${name} must be a list of IDs.`);
    }

    if (value.length > IncidentSubscriberAudience.maxIdsPerRequest) {
      throw new BadDataException(
        `${name} can list at most ${IncidentSubscriberAudience.maxIdsPerRequest} IDs.`,
      );
    }

    return value.map((item: unknown): ObjectID => {
      return IncidentAPI.parseObjectID(item, name);
    });
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
        p === Permission.EditProjectIncident
      );
    });

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

    /*
     * Project AI kill switch. Checked here: after the row that names the
     * project is in hand, and before the context builder runs or any provider
     * tokens are spent. executeWithLogging meters and bills this call but does
     * not consult Project.enableAi, so this is the only thing standing between
     * a project that has switched AI off and a provider bill.
     */
    await AIService.assertProjectAIEnabled(incident.projectId);

    // Build incident context
    const contextData: IncidentContextData =
      await IncidentAIContextBuilder.buildIncidentContext({
        incidentId,
        includeWorkspaceMessages,
        workspaceMessageLimit: 500,
      });

    // Format context for postmortem generation
    const aiContext: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        contextData,
        template,
      );

    // Generate postmortem using AIService (handles billing and logging)
    const aiLogRequest: AILogRequest = {
      projectId: incident.projectId,
      feature: "Incident Postmortem",
      incidentId: incidentId,
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

  private async generateNoteFromAI(
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
        p === Permission.EditProjectIncident ||
        p === Permission.CreateIncidentInternalNote ||
        p === Permission.CreateIncidentPublicNote
      );
    });

    if (!hasPermission && !props.isMasterAdmin) {
      throw new BadDataException(
        "You do not have permission to generate notes for this incident.",
      );
    }

    // Get the template and note type from request body
    const template: string | undefined = JSONFunctions.getJSONValueInPath(
      req.body,
      "template",
    ) as string | undefined;

    const noteType: string =
      (JSONFunctions.getJSONValueInPath(req.body, "noteType") as string) ||
      "internal";

    if (noteType !== "public" && noteType !== "internal") {
      throw new BadDataException("Note type must be 'public' or 'internal'");
    }

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

    /*
     * Project AI kill switch. Checked here: after the row that names the
     * project is in hand, and before the context builder runs or any provider
     * tokens are spent. executeWithLogging meters and bills this call but does
     * not consult Project.enableAi, so this is the only thing standing between
     * a project that has switched AI off and a provider bill.
     */
    await AIService.assertProjectAIEnabled(incident.projectId);

    // Build incident context
    const contextData: IncidentContextData =
      await IncidentAIContextBuilder.buildIncidentContext({
        incidentId,
        includeWorkspaceMessages,
        workspaceMessageLimit: 300,
      });

    // Format context for note generation
    const aiContext: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForNote(
        contextData,
        noteType as "public" | "internal",
        template,
      );

    // Generate note using AIService (handles billing and logging)
    const aiLogRequest: AILogRequest = {
      projectId: incident.projectId,
      feature:
        noteType === "public"
          ? "Incident Public Note"
          : "Incident Internal Note",
      incidentId: incidentId,
      messages: aiContext.messages,
      maxTokens: 4096,
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
      note: response.content,
    });
  }
}
