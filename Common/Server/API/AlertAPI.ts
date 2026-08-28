import Alert from "../../Models/DatabaseModels/Alert";
import NotFoundException from "../../Types/Exception/NotFoundException";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import ObjectID from "../../Types/ObjectID";
import AlertService, {
  Service as AlertServiceType,
} from "../Services/AlertService";
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
import AlertAIContextBuilder, {
  AIGenerationContext,
  AlertContextData,
} from "../Utils/AI/AlertAIContextBuilder";
import JSONFunctions from "../../Types/JSONFunctions";
import Permission, { UserPermission } from "../../Types/Permission";

export default class AlertAPI extends BaseAPI<Alert, AlertServiceType> {
  public constructor() {
    super(Alert, AlertService);

    // Generate note from AI
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/generate-note-from-ai/:alertId`,
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
    const alertIdParam: string | undefined = req.params["alertId"];

    if (!alertIdParam) {
      throw new BadDataException("Alert ID is required");
    }

    let alertId: ObjectID;

    try {
      alertId = new ObjectID(alertIdParam);
    } catch {
      throw new BadDataException("Invalid Alert ID");
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
        p === Permission.EditAlert ||
        p === Permission.CreateAlertInternalNote
      );
    });

    if (!hasPermission && !props.isMasterAdmin) {
      throw new BadDataException(
        "You do not have permission to generate notes for this alert.",
      );
    }

    // Get the template from request body
    const template: string | undefined = JSONFunctions.getJSONValueInPath(
      req.body,
      "template",
    ) as string | undefined;

    // Get the alert to verify it exists and get the project ID
    const alert: Alert | null = await this.service.findOneById({
      id: alertId,
      select: {
        _id: true,
        projectId: true,
      },
      props,
    });

    if (!alert || !alert.projectId) {
      throw new NotFoundException("Alert not found");
    }

    // Build alert context
    const contextData: AlertContextData =
      await AlertAIContextBuilder.buildAlertContext({
        alertId,
      });

    // Format context for note generation
    const aiContext: AIGenerationContext =
      AlertAIContextBuilder.formatAlertContextForNote(contextData, template);

    // Generate note using AIService (handles billing and logging)
    const aiLogRequest: AILogRequest = {
      projectId: alert.projectId,
      feature: "Alert Internal Note",
      alertId: alertId,
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
