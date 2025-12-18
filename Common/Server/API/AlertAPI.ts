import Alert from "../../Models/DatabaseModels/Alert";
import NotFoundException from "../../Types/Exception/NotFoundException";
import BadDataException from "../../Types/Exception/BadDataException";
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
import AIService, { AILogRequest, AILogResponse } from "../Services/AIService";
import AlertAIContextBuilder, {
  AIGenerationContext,
  AlertContextData,
} from "../Utils/AI/AlertAIContextBuilder";
import JSONFunctions from "../../Types/JSONFunctions";
import Permission from "../../Types/Permission";

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
            p === Permission.EditAlert ||
            p === Permission.CreateAlertInternalNote
          );
        })
      : false;

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
