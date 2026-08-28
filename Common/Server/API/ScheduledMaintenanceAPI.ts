import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import NotFoundException from "../../Types/Exception/NotFoundException";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
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
import Permission, { UserPermission } from "../../Types/Permission";

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
        p === Permission.EditProjectScheduledMaintenance ||
        p === Permission.CreateScheduledMaintenanceInternalNote ||
        p === Permission.CreateScheduledMaintenancePublicNote
      );
    });

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

    /*
     * Project AI kill switch. Checked here: after the row that names the
     * project is in hand, and before the context builder runs or any provider
     * tokens are spent. executeWithLogging meters and bills this call but does
     * not consult Project.enableAi, so this is the only thing standing between
     * a project that has switched AI off and a provider bill.
     */
    await AIService.assertProjectAIEnabled(scheduledMaintenance.projectId);

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
      temperature: 0.2,
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
