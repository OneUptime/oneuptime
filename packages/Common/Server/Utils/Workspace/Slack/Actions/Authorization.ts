import { DatabaseBaseModelType } from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { WorkspacePayloadMarkdown } from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization, {
  WorkspaceActionResource,
} from "../../WorkspaceActionAuthorization";
import SlackUtil from "../Slack";
import { SlackRequest } from "./Auth";

export type SlackActionRequester = Pick<
  SlackRequest,
  "userId" | "projectId" | "projectAuthToken" | "slackUserId" | "slackUsername"
>;

export default class SlackActionAuthorization {
  /*
   * Runs WorkspaceActionAuthorization.authorize for the Slack user behind a
   * request. When they may not act, tells them why in a direct message and
   * returns null: the caller must stop without writing anything. Slack has
   * already been answered by then, so a DM is the only way left to reach them.
   */
  @CaptureSpan()
  public static async authorize(data: {
    requester: SlackActionRequester;
    modelType: DatabaseBaseModelType;
    action: string;
    resources?: Array<WorkspaceActionResource> | undefined;
  }): Promise<DatabaseCommonInteractionProps | null> {
    const { requester } = data;

    try {
      if (!requester.userId || !requester.projectId) {
        throw new NotAuthorizedException(
          `You do not have permission to ${data.action}.`,
        );
      }

      return await WorkspaceActionAuthorization.authorize({
        userId: requester.userId,
        projectId: requester.projectId,
        modelType: data.modelType,
        action: data.action,
        resources: data.resources,
      });
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        throw err;
      }

      logger.debug("Slack action refused: " + err.message, {
        projectId: requester.projectId?.toString(),
        userId: requester.userId?.toString(),
      });

      await this.sendRefusal({
        requester: requester,
        message: err.message,
      });

      return null;
    }
  }

  @CaptureSpan()
  public static async sendRefusal(data: {
    requester: SlackActionRequester;
    message: string;
  }): Promise<void> {
    const { requester } = data;

    if (!requester.projectAuthToken || !requester.slackUserId) {
      return;
    }

    const markdownPayload: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: requester.slackUsername
        ? `@${requester.slackUsername}, ${data.message}`
        : data.message,
    };

    try {
      await SlackUtil.sendDirectMessageToUser({
        authToken: requester.projectAuthToken,
        workspaceUserId: requester.slackUserId,
        messageBlocks: [markdownPayload],
      });
    } catch (err) {
      // The refusal stands whether or not Slack delivered the explanation.
      logger.error("Error sending Slack authorization refusal:", {
        projectId: requester.projectId?.toString(),
      });
      logger.error(err);
    }
  }
}
