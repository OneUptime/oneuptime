import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import NotFoundException from "../../Types/Exception/NotFoundException";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import ScheduledMaintenanceService, {
  Service as ScheduledMaintenanceServiceType,
} from "../Services/ScheduledMaintenanceService";
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
import ScheduledMaintenanceAIContextBuilder, {
  AIGenerationContext,
  ScheduledMaintenanceContextData,
} from "../Utils/AI/ScheduledMaintenanceAIContextBuilder";
import JSONFunctions from "../../Types/JSONFunctions";
import Permission from "../../Types/Permission";

export default class ScheduledMaintenanceAPI extends BaseAPI<
  ScheduledMaintenance,
  ScheduledMaintenanceServiceType
> {
  public constructor() {
    super(ScheduledMaintenance, ScheduledMaintenanceService);

    // Generate note from AI
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/generate-note-from-ai/:scheduledMaintenanceId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.generateNoteFromAI(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async generateNoteFromAI(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const scheduledMaintenanceIdParam: string | undefined =
      req.params["scheduledMaintenanceId"];

    if (!scheduledMaintenanceIdParam) {
      throw new BadDataException("Scheduled Maintenance ID is required");
    }

    let scheduledMaintenanceId: ObjectID;

    try {
      scheduledMaintenanceId = new ObjectID(scheduledMaintenanceIdParam);
    } catch {
      throw new BadDataException("Invalid Scheduled Maintenance ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    // Verify user has permission
    const permissions: Array<Permission> | undefined = props
      .userTenantAccessPermission?.["permissions"] as
      | Array<Permission>
      | undefined;

    const hasPermission: boolean = permissions
      ? permissions.some((p: Permission) => {
          return (
            p === Permission.ProjectOwner ||
            p === Permission.ProjectAdmin ||
            p === Permission.EditProjectScheduledMaintenance ||
            p === Permission.CreateScheduledMaintenanceInternalNote ||
            p === Permission.CreateScheduledMaintenancePublicNote
          );
        })
      : false;

    if (!hasPermission && !props.isMasterAdmin) {
      throw new BadDataException(
        "You do not have permission to generate notes for this scheduled maintenance.",
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

    // Get the scheduled maintenance to verify it exists and get the project ID
    const scheduledMaintenance: ScheduledMaintenance | null =
      await this.service.findOneById({
        id: scheduledMaintenanceId,
        select: {
          _id: true,
          projectId: true,
        },
        props,
      });

    if (!scheduledMaintenance || !scheduledMaintenance.projectId) {
      throw new NotFoundException("Scheduled Maintenance not found");
    }

    // Build scheduled maintenance context
    const contextData: ScheduledMaintenanceContextData =
      await ScheduledMaintenanceAIContextBuilder.buildScheduledMaintenanceContext(
        {
          scheduledMaintenanceId,
        },
      );

    // Format context for note generation
    const aiContext: AIGenerationContext =
      ScheduledMaintenanceAIContextBuilder.formatScheduledMaintenanceContextForNote(
        contextData,
        noteType as "public" | "internal",
        template,
      );

    // Generate note using AIService (handles billing and logging)
    const aiLogRequest: AILogRequest = {
      projectId: scheduledMaintenance.projectId,
      feature:
        noteType === "public"
          ? "Scheduled Maintenance Public Note"
          : "Scheduled Maintenance Internal Note",
      scheduledMaintenanceId: scheduledMaintenanceId,
      messages: aiContext.messages,
      maxTokens: 4096,
      temperature: 0.7,
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
