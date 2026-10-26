import BadRequestException from "../../../../../Types/Exception/BadRequestException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import logger from "../../../Logger";
import ProductBrandingText from "../../../ProductBrandingText";
import Response from "../../../Response";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "../../WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceCommands, {
  WorkspaceCommandName,
} from "../../WorkspaceCommands";
import WorkspaceOnCallNow from "../../WorkspaceOnCallNow";
import SlackCommandParser, { SlackCommandRequest } from "../SlackCommandParser";
import SlackProjectChoice from "../SlackProjectChoice";
import SlackActionType from "./ActionTypes";
import SlackActionAnswer, { SlackAnswerPlace } from "./Answer";
import SlackAuthAction, { SlackAction, SlackRequest } from "./Auth";
import SlackIncidentActions from "./Incident";
import SlackPageActions from "./Page";
import SlackScheduledMaintenanceActions from "./ScheduledMaintenance";

/*
 * /oneuptime, AND EVERY WORD AFTER IT.
 *
 * Slack posts the command to /api/slack/command, and Slack must have an
 * answer within three seconds. What the text after /oneuptime asks for
 * (WorkspaceCommands):
 *
 *   help, or nothing                       the commands, answered at once,
 *                                          only to the person who ran it
 *   a command misspelt                     the command it looks like, at
 *                                          once, only to that person
 *   incident [title], maintenance [title]  the New Incident or New Scheduled
 *                                          Maintenance form, with the title
 *                                          filled in, as /incident and
 *                                          /maintenance opened it
 *   incident [number]                      that incident - 42, #42, INC-42 -
 *                                          with its buttons and menu, only
 *                                          to the person who ran it; plain
 *                                          `incident` in an incident's own
 *                                          channel shows that incident
 *                                          (SlackIncidentMoreActions)
 *   oncall                                 who is on call right now
 *   page [who] [message]                   pages the people @mentioned, or
 *                                          opens the Page someone form
 *                                          (SlackPageActions)
 *   ask [question], or any other text      a question for OneUptime AI
 *
 * The forms, who is on call and a page act as the OneUptime member the Slack
 * account is connected to, like every button (SlackAuthAction): somebody
 * not connected is asked to connect, with a Connect button, and to run the
 * command again - named as they typed it. In a workspace connected to more
 * than one project, a command that nothing ties to one of them is asked
 * which, with a button for each project its person is in, and run again in
 * the one they choose (SlackProjectChoice, runInChosenProject). A question
 * for OneUptime AI is answered as an @mention is (askQuestion).
 *
 * Apps created from an older manifest still have /incident and /maintenance
 * of their own. Slack sends those to /api/slack/interactive, where they are
 * read as the same forms (SlackCommandParser), until the app is updated.
 */
export default class SlackCommandActions {
  /*
   * What a command from a Slack workspace connected to no project is told,
   * only to the person who ran it.
   */
  public static getNotConnectedAnswer(): WorkspaceAnswer {
    const productName: string = ProductBrandingText.getProductName();
    const message: string = `This Slack workspace is not connected to a ${productName} project yet. A project admin can connect it in ${productName} under Project Settings → Workspace → Slack.`;

    return {
      markdown: mdText`${message}`.toString(),
      text: message,
    };
  }

  /*
   * Answers a slash command posted to /api/slack/command (see the header).
   * `askQuestion` answers a question for OneUptime AI.
   */
  @CaptureSpan()
  public static async handleCommand(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    askQuestion: (question: string) => Promise<void>;
  }): Promise<void> {
    const body: JSONObject = (data.req.body as JSONObject | undefined) || {};

    const request: SlackCommandRequest = SlackCommandParser.read({
      command: body["command"],
      text: body["text"],
    });

    switch (request.input.command) {
      case WorkspaceCommandName.Incident:
      case WorkspaceCommandName.Maintenance:
      case WorkspaceCommandName.OnCall:
      case WorkspaceCommandName.Page:
        return await SlackCommandActions.runAsMember(data);
      case WorkspaceCommandName.Ask:
        return await data.askQuestion(request.input.text);
      case WorkspaceCommandName.Help:
        return SlackCommandActions.answerAtOnce({
          ...data,
          answer: WorkspaceCommands.getHelpAnswer({
            workspaceType: WorkspaceType.Slack,
            slackCommand: request.baseCommand,
          }),
        });
      case null:
        if (request.input.misspelt) {
          return SlackCommandActions.answerAtOnce({
            ...data,
            answer: WorkspaceCommands.getMisspellingAnswer({
              workspaceType: WorkspaceType.Slack,
              slackCommand: request.baseCommand,
              misspelt: request.input.misspelt,
            }),
          });
        }

        return await data.askQuestion(request.input.text);
    }
  }

  /*
   * Who is on call right now, for `/oneuptime oncall`: Slack is answered at
   * once, and the person where they ran it, once the schedules are read.
   */
  @CaptureSpan()
  public static async showOnCall(data: {
    slackRequest: SlackRequest;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    Response.sendTextResponse(data.req, data.res, "");

    const place: SlackAnswerPlace | null = SlackActionAnswer.getPlace(
      data.slackRequest,
    );

    if (!place) {
      return;
    }

    await SlackActionAnswer.answer({
      place: place,
      answer: await SlackCommandActions.getOnCallAnswer(data.slackRequest),
    });
  }

  /*
   * An answer that reads nothing - the help, a misspelt command's - as the
   * HTTP response itself: at once, only to the person who ran the command.
   */
  private static answerAtOnce(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    answer: WorkspaceAnswer;
  }): void {
    return Response.sendJsonObjectResponse(
      data.req,
      data.res,
      SlackActionAnswer.getCommandResponse(data.answer),
    );
  }

  /*
   * A command that acts as the member the Slack account is connected to:
   * read as a press is (SlackAuthAction), then answered by what it asks
   * for.
   */
  private static async runAsMember(data: {
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    return await SlackCommandActions.run({
      req: data.req,
      res: data.res,
      slackRequest: await SlackAuthAction.isAuthorized({
        req: data.req,
      }),
    });
  }

  /*
   * A request whose person chose its project (SlackProjectChoice) - a
   * command, a shortcut, an older app's /incident or a Home button - made
   * again: read from what Slack first sent of it (`payload`, with the
   * trigger_id of the button they chose with, good for three seconds), in
   * the chosen project, and answered by what it asks for as it would have
   * been. A form it opens takes the place of `replaceViewId`, the modal
   * they chose in.
   */
  @CaptureSpan()
  public static async runInChosenProject(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    payload: JSONObject;
    chosenProjectId: ObjectID;
    replaceViewId?: string | undefined;
  }): Promise<void> {
    return await SlackCommandActions.run({
      req: data.req,
      res: data.res,
      slackRequest: await SlackAuthAction.isAuthorized({
        req: data.req,
        payload: data.payload,
        chosenProjectId: data.chosenProjectId,
        replaceViewId: data.replaceViewId,
      }),
    });
  }

  /*
   * A request read as a press: its refusal told, or what it asks for - one
   * of SlackProjectChoice.PRESSES_MADE_AGAIN - answered.
   */
  private static async run(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    slackRequest: SlackRequest;
  }): Promise<void> {
    const { slackRequest } = data;

    if (!slackRequest.isAuthorized) {
      if (slackRequest.refusal) {
        // Slack first, within its three seconds; then the person.
        Response.sendTextResponse(data.req, data.res, "");
        await SlackAuthAction.answerRefusal(slackRequest);
        return;
      }

      // No project is connected to this Slack workspace.
      return Response.sendJsonObjectResponse(
        data.req,
        data.res,
        SlackActionAnswer.getCommandResponse(
          SlackCommandActions.getNotConnectedAnswer(),
        ),
      );
    }

    /*
     * What it asks for: the command's word, a shortcut's form, a Home
     * button's press.
     */
    const action: SlackAction | undefined = (slackRequest.actions || []).find(
      (candidate: SlackAction): boolean => {
        return (
          Boolean(candidate.actionType) &&
          SlackProjectChoice.PRESSES_MADE_AGAIN.includes(candidate.actionType!)
        );
      },
    );

    switch (action?.actionType) {
      // And `/oneuptime incident 42`: that incident, with its buttons.
      case SlackActionType.NewIncident:
      case SlackActionType.ShowIncident:
        return await SlackIncidentActions.handleIncidentAction({
          slackRequest: slackRequest,
          action: action,
          req: data.req,
          res: data.res,
        });
      case SlackActionType.NewScheduledMaintenance:
        return await SlackScheduledMaintenanceActions.handleScheduledMaintenanceAction(
          {
            slackRequest: slackRequest,
            action: action,
            req: data.req,
            res: data.res,
          },
        );
      case SlackActionType.ShowOnCall:
        return await SlackCommandActions.showOnCall({
          slackRequest: slackRequest,
          req: data.req,
          res: data.res,
        });
      case SlackActionType.PageSomeone:
        return await SlackPageActions.handlePageCommand({
          slackRequest: slackRequest,
          action: action,
          req: data.req,
          res: data.res,
        });
      default:
        return Response.sendErrorResponse(
          data.req,
          data.res,
          new BadRequestException("Invalid request"),
        );
    }
  }

  /*
   * Who is on call, read as the member the Slack account is connected to;
   * why not, when it cannot be read. Never throws.
   */
  private static async getOnCallAnswer(
    slackRequest: SlackRequest,
  ): Promise<WorkspaceAnswer> {
    try {
      const props: DatabaseCommonInteractionProps =
        await WorkspaceActionAuthorization.getProjectMemberProps({
          userId: slackRequest.userId!,
          projectId: slackRequest.projectId!,
        });

      return await WorkspaceOnCallNow.getOnCallNowAnswer({
        projectId: slackRequest.projectId!,
        props: props,
      });
    } catch (err) {
      // Not a member of the project any more: placed as text.
      if (err instanceof NotAuthorizedException) {
        return {
          markdown: mdText`${err.message}`.toString(),
          text: err.message,
        };
      }

      logger.error("Could not read who is on call for a Slack command.", {
        projectId: slackRequest.projectId?.toString(),
      });
      logger.error(err, { projectId: slackRequest.projectId?.toString() });

      const message: string = `${ProductBrandingText.getProductName()} couldn't read who is on call just now. Please try again in a minute.`;

      return {
        markdown: mdText`${message}`.toString(),
        text: message,
      };
    }
  }
}
