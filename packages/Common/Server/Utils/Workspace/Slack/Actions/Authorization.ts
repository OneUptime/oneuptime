import { DatabaseBaseModelType } from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization, {
  WorkspaceActionResource,
} from "../../WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventRecord,
} from "../../WorkspaceMemberActions";
import { SlackRequest } from "./Auth";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import ObjectID from "../../../../../Types/ObjectID";
import SlackActionAnswer, { SlackAnswerPlace } from "./Answer";

/*
 * Who pressed, and where: the member they act as, and the channel, thread
 * and response_url their answer goes to (SlackActionAnswer).
 */
export type SlackActionRequester = Pick<
  SlackRequest,
  | "userId"
  | "projectId"
  | "projectAuthToken"
  | "slackUserId"
  | "slackUsername"
  | "slackChannelId"
  | "slackThreadTs"
  | "responseUrl"
  | "triggerId"
  | "payloadType"
  | "slackViewType"
  | "isFromPrivateMessage"
>;

// A Slack user who may press a button on a record, and the record as they read it.
export interface SlackAuthorizedEvent {
  props: DatabaseCommonInteractionProps;
  event: WorkspaceEventRecord;
}

export default class SlackActionAuthorization {
  /*
   * Runs WorkspaceActionAuthorization.authorize for the Slack user behind a
   * request. When they may not act, tells them why where they pressed
   * (sendRefusal) and returns null: the caller must stop without writing
   * anything.
   */
  @CaptureSpan()
  public static async authorize(data: {
    requester: SlackActionRequester;
    modelType: DatabaseBaseModelType;
    action: string;
    resources?: Array<WorkspaceActionResource> | undefined;
  }): Promise<DatabaseCommonInteractionProps | null> {
    return await this.refuseInPlace({
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
    return await this.refuseInPlace({
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
   * them where they pressed, and null comes back. A refusal for the plan -
   * a press of something the project's plan does not include - is told
   * too, as "Could not <action>: <the plan it needs>": it used to escape
   * the press unanswered.
   */
  private static async refuseInPlace<T>(data: {
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
      if (
        !(err instanceof NotAuthorizedException) &&
        !(err instanceof PaymentRequiredException)
      ) {
        throw err;
      }

      logger.debug("Slack action refused: " + err.message, {
        projectId: requester.projectId?.toString(),
        userId: requester.userId?.toString(),
      });

      await this.sendRefusal({
        requester: requester,
        message:
          err instanceof PaymentRequiredException
            ? `Could not ${data.action}: ${err.message}`
            : err.message,
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
   * told to them where they pressed, as `Could not <action>: <reason>`,
   * and null comes back. Anything else is thrown.
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

  /*
   * Tells the person why a press was refused, where they pressed: only they
   * see it, in the channel and thread they pressed in (SlackActionAnswer),
   * so it is not addressed to them by name.
   */
  @CaptureSpan()
  public static async sendRefusal(data: {
    requester: SlackActionRequester;
    message: string;
  }): Promise<void> {
    const place: SlackAnswerPlace | null = SlackActionAnswer.getPlace(
      data.requester,
    );

    if (!place) {
      return;
    }

    /*
     * The refusal is text - it can name a label, a record or a person - so
     * it is placed as text. The refusal stands whether or not Slack takes
     * the answer (answer never throws).
     */
    await SlackActionAnswer.answer({
      place: place,
      answer: {
        markdown: mdText`${data.message}`.toString(),
        text: data.message,
      },
    });
  }
}
