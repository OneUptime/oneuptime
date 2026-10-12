import { DatabaseBaseModelType } from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { WorkspacePayloadMarkdown } from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization, {
  WorkspaceActionResource,
} from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventRecord,
} from "../../WorkspaceMemberActions";
import SlackUtil from "../Slack";
import { SlackRequest } from "./Auth";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import ObjectID from "../../../../../Types/ObjectID";

export type SlackActionRequester = Pick<
  SlackRequest,
  "userId" | "projectId" | "projectAuthToken" | "slackUserId" | "slackUsername"
>;

// A Slack user who may press a button on a record, and the record as they read it.
export interface SlackAuthorizedEvent {
  props: DatabaseCommonInteractionProps;
  event: WorkspaceEventRecord;
}

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
    return await this.refuseInDirectMessage({
      requester: data.requester,
      action: data.action,
      run: async (
        userId: ObjectID,
        projectId: ObjectID,
      ): Promise<DatabaseCommonInteractionProps> => {
        return await WorkspaceActionAuthorization.authorize({
          userId: userId,
          projectId: projectId,
          modelType: data.modelType,
          action: data.action,
          resources: data.resources,
        });
      },
    });
  }

  /*
   * authorize, for a button that changes a record (`event`): the same
   * checks, refused the same way, and the record as the check read it
   * (WorkspaceMemberActions.authorize) - for the button's own answer
   * ("already acknowledged") and for the write, so the press reads it once.
   */
  @CaptureSpan()
  public static async authorizeEvent(data: {
    requester: SlackActionRequester;
    modelType: DatabaseBaseModelType;
    action: string;
    event: WorkspaceEvent;
    resources?: Array<WorkspaceActionResource> | undefined;
  }): Promise<SlackAuthorizedEvent | null> {
    return await this.refuseInDirectMessage({
      requester: data.requester,
      action: data.action,
      run: async (
        userId: ObjectID,
        projectId: ObjectID,
      ): Promise<SlackAuthorizedEvent> => {
        const props: DatabaseCommonInteractionProps =
          await WorkspaceActionAuthorization.getProjectMemberProps({
            userId: userId,
            projectId: projectId,
          });

        return {
          props: props,
          event: await WorkspaceMemberActions.authorize({
            props: props,
            modelType: data.modelType,
            action: data.action,
            event: data.event,
            resources: data.resources,
          }),
        };
      },
    });
  }

  /*
   * A check of the Slack user behind a request; a refusal of it is told to
   * them in a direct message, and null comes back.
   */
  private static async refuseInDirectMessage<T>(data: {
    requester: SlackActionRequester;
    action: string;
    run: (userId: ObjectID, projectId: ObjectID) => Promise<T>;
  }): Promise<T | null> {
    const { requester } = data;

    try {
      if (!requester.userId || !requester.projectId) {
        throw new NotAuthorizedException(
          `You do not have permission to ${data.action}.`,
        );
      }

      return await data.run(requester.userId, requester.projectId);
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

  /*
   * Runs a write the Slack user behind a request asked for, made with their
   * own props, so it is refused where the dashboard would refuse them: a
   * permission they lack, a plan the project is not on, a record they may
   * not name (answered like one that is not there), a value that is not
   * valid. Such a refusal is written for whoever made the request; it is
   * told to them in a direct message, as `Could not <action>: <reason>`,
   * and null comes back - Slack has been answered already, so a DM is the
   * only way left to reach them. Anything else is thrown.
   */
  @CaptureSpan()
  public static async runForRequester<T>(data: {
    requester: SlackActionRequester;
    // Completes "Could not ...", e.g. "declare the incident".
    action: string;
    run: () => Promise<T>;
  }): Promise<T | null> {
    try {
      return await data.run();
    } catch (err) {
      if (
        !(err instanceof NotAuthorizedException) &&
        !(err instanceof BadDataException) &&
        !(err instanceof PaymentRequiredException)
      ) {
        throw err;
      }

      logger.debug(`Slack request refused: ${err.message}`, {
        projectId: data.requester.projectId?.toString(),
        userId: data.requester.userId?.toString(),
      });

      await this.sendRefusal({
        requester: data.requester,
        message: `Could not ${data.action}: ${err.message}`,
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

    /*
     * The refusal is text - it can name a label, a record or a person - so
     * it is placed as text, as the name before it is.
     */
    const markdownPayload: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: requester.slackUsername
        ? mdText`@${requester.slackUsername}, ${data.message}`.toString()
        : mdText`${data.message}`.toString(),
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
