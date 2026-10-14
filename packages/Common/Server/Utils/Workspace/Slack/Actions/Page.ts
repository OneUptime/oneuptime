import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspaceLiveMessageDestinationType } from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import { OnCallPageTargets } from "../../../../Services/OnCallPageService";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { ExpressRequest, ExpressResponse } from "../../../Express";
import logger from "../../../Logger";
import ProductBrandingText from "../../../ProductBrandingText";
import Response from "../../../Response";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspacePage, {
  WORKSPACE_PAGE_ACTION,
  WorkspacePageCandidate,
  WorkspacePageChoice,
  WorkspacePageChoiceGroup,
  WorkspacePageFormPrefill,
  WorkspacePageOutcome,
  WorkspacePagePeople,
  WorkspacePagePlace,
} from "../../WorkspacePage";
import WorkspacePageTextReader, {
  WorkspacePagePerson,
  WorkspacePageText,
} from "../../WorkspacePageText";
import SlackUtil from "../Slack";
import SlackCommandParser from "../SlackCommandParser";
import SlackActionType from "./ActionTypes";
import SlackActionAnswer, { SlackAnswerPlace } from "./Answer";
import { SlackAction, SlackRequest } from "./Auth";
import SlackActionAuthorization from "./Authorization";

/*
 * `/oneuptime page` IN SLACK (WorkspacePage says what a page from a chat is).
 *
 *   /oneuptime page @nawaz The checkout API is throwing 500s
 *
 * Slack is answered at once (it waits three seconds at most), then:
 *
 *   - people @mentioned, OneUptime can tell them all, and a message: they
 *     are paged now. "📟 Paging Nawaz Dhandala…" only the person who ran it
 *     sees, then the page's message in the channel, edited as it goes;
 *   - anything else: the Page someone form (a modal), with what was typed
 *     filled in - who to page, picked from the project's on-call schedules,
 *     people, teams and on-call policies, and the message. Submitted, it
 *     pages the same way.
 *
 * Both act as the member the Slack account is connected to: somebody not
 * connected, not a member, or who may not page is told so where they ran
 * the command, and nobody is paged.
 *
 * A person is told apart by their Slack account: the OneUptime account it
 * is connected to, or the member with the email address Slack has for them
 * (the app's users:read.email scope). An app created from an older manifest
 * sends "@nawaz" as text, not as a person; that opens the form.
 */

// The fields of the Page someone form.
export const PAGE_FORM_WHO_FIELD: string = "pageTargets";
export const PAGE_FORM_MESSAGE_FIELD: string = "pageMessage";

// The longest a modal's text input takes.
const MAX_MESSAGE_LENGTH: number = 3000;

export default class SlackPageActions {
  // What the form is called, in Slack's 24 characters.
  public static readonly FORM_TITLE: string = "Page someone";

  @CaptureSpan()
  public static isPageAction(data: { actionType: SlackActionType }): boolean {
    return (
      data.actionType === SlackActionType.PageSomeone ||
      data.actionType === SlackActionType.SubmitPageSomeone
    );
  }

  @CaptureSpan()
  public static async handlePageAction(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    if (data.action.actionType === SlackActionType.SubmitPageSomeone) {
      return await SlackPageActions.submitPageForm(data);
    }

    return await SlackPageActions.handlePageCommand(data);
  }

  /*
   * `/oneuptime page [who] [message]`, from a member: pages at once, or
   * opens the form (see the header). Slack is answered first.
   */
  @CaptureSpan()
  public static async handlePageCommand(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest } = data;

    Response.sendTextResponse(data.req, data.res, "");

    const text: WorkspacePageText = WorkspacePageTextReader.read(
      SlackCommandParser.getPageTokens(data.action.actionValue || ""),
    );

    const props: DatabaseCommonInteractionProps | null =
      await SlackPageActions.authorize(slackRequest);

    if (!props) {
      return;
    }

    const people: WorkspacePagePeople = await WorkspacePage.resolvePeople({
      projectId: slackRequest.projectId!,
      workspaceType: WorkspaceType.Slack,
      candidates: await SlackPageActions.getCandidates({
        projectId: slackRequest.projectId!,
        projectAuthToken: slackRequest.projectAuthToken!,
        people: text.people,
      }),
    });

    const isReadyToPage: boolean =
      text.people.length > 0 &&
      people.people.length > 0 &&
      people.notTold.length === 0 &&
      text.groups.length === 0 &&
      text.unknownNames.length === 0 &&
      text.message.length > 0;

    if (!isReadyToPage) {
      return await SlackPageActions.openForm({
        slackRequest: slackRequest,
        props: props,
        text: text,
        people: people,
      });
    }

    const place: SlackAnswerPlace | null =
      SlackActionAnswer.getPlace(slackRequest);

    /*
     * Said at once, only to them: a page can take a few seconds, and a
     * command that seems to do nothing gets run again.
     */
    if (place) {
      await SlackActionAnswer.answer({
        place: place,
        answer: SlackPageActions.getPagingAnswer(
          people.people.map((person: { name: string }): string => {
            return person.name;
          }),
        ),
      });
    }

    await SlackPageActions.pageAndAnswer({
      slackRequest: slackRequest,
      props: props,
      targets: {
        userIds: people.people.map(
          (person: { userId: ObjectID }): ObjectID => {
            return person.userId;
          },
        ),
      },
      message: text.message,
      channelName:
        typeof (data.req.body as JSONObject | undefined)?.["channel_name"] ===
        "string"
          ? ((data.req.body as JSONObject)["channel_name"] as string)
          : undefined,
    });
  }

  /*
   * The Page someone form, submitted: checked at once - a field left wrong
   * is answered on the form, which stays open - then the form closes and
   * the page goes out, as the member who submitted it.
   */
  @CaptureSpan()
  public static async submitPageForm(data: {
    slackRequest: SlackRequest;
    action: SlackAction;
    req: ExpressRequest;
    res: ExpressResponse;
  }): Promise<void> {
    const { slackRequest } = data;
    const values: JSONObject = (slackRequest.viewValues ||
      {}) as unknown as JSONObject;

    const picked: Array<string> = SlackPageActions.toStrings(
      values[PAGE_FORM_WHO_FIELD],
    );
    const message: string =
      typeof values[PAGE_FORM_MESSAGE_FIELD] === "string"
        ? (values[PAGE_FORM_MESSAGE_FIELD] as string)
        : "";

    const problems: {
      who?: string | undefined;
      message?: string | undefined;
    } | null = WorkspacePage.getFormProblems({
      values: picked,
      message: message,
    });

    if (problems) {
      const errors: JSONObject = {};

      if (problems.who) {
        errors[PAGE_FORM_WHO_FIELD] = problems.who;
      }

      if (problems.message) {
        errors[PAGE_FORM_MESSAGE_FIELD] = problems.message;
      }

      return Response.sendJsonObjectResponse(data.req, data.res, {
        response_action: "errors",
        errors: errors,
      });
    }

    Response.sendJsonObjectResponse(data.req, data.res, {
      response_action: "clear",
    });

    const props: DatabaseCommonInteractionProps | null =
      await SlackPageActions.authorize(slackRequest);

    if (!props) {
      return;
    }

    await SlackPageActions.pageAndAnswer({
      slackRequest: slackRequest,
      props: props,
      targets: WorkspacePage.readTargets(picked),
      message: message,
    });
  }

  /*
   * What the person who paged sees at once, only them: "📟 Paging Nawaz
   * Dhandala…".
   */
  public static getPagingAnswer(names: Array<string>): {
    markdown: string;
    text: string;
  } {
    const bold: Array<MarkdownText> = names.map(
      (name: string): MarkdownText => {
        return mdText`**${name}**`;
      },
    );

    const who: MarkdownText =
      bold.length <= 1
        ? bold[0] || mdText`them`
        : mdText`${FeedMarkdown.join(bold.slice(0, -1), ", ")} and ${bold[bold.length - 1]!}`;

    const plainWho: string =
      names.length <= 1
        ? names[0] || "them"
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;

    return {
      markdown: mdText`📟 Paging ${who}…`.toString(),
      text: `Paging ${plainWho}…`,
    };
  }

  /*
   * The member the Slack account is connected to, when they may page;
   * otherwise they are told why where they ran it, and null comes back.
   */
  private static async authorize(
    slackRequest: SlackRequest,
  ): Promise<DatabaseCommonInteractionProps | null> {
    // A member of the project, who may start an on-call run...
    const props: DatabaseCommonInteractionProps | null =
      await SlackActionAuthorization.authorize({
        requester: slackRequest,
        modelType: OnCallDutyPolicyExecutionLog,
        action: WORKSPACE_PAGE_ACTION,
      });

    if (!props) {
      return null;
    }

    // ... and do all a page asks of them.
    try {
      await WorkspacePage.assertMayPage(props);
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        throw err;
      }

      await SlackActionAuthorization.sendRefusal({
        requester: slackRequest,
        message: err.message,
      });

      return null;
    }

    return props;
  }

  /*
   * Pages, as the member, and answers them where they paged when the
   * channel does not show it all (WorkspacePage.page). A refusal or a page
   * that names nobody pageable is told to them, as "Could not page: ...".
   */
  private static async pageAndAnswer(data: {
    slackRequest: SlackRequest;
    props: DatabaseCommonInteractionProps;
    targets: OnCallPageTargets;
    message: string;
    channelName?: string | undefined;
  }): Promise<void> {
    const { slackRequest } = data;

    const outcome: WorkspacePageOutcome | null =
      await SlackActionAuthorization.runForRequester({
        requester: slackRequest,
        action: "page",
        run: async (): Promise<WorkspacePageOutcome> => {
          return await WorkspacePage.page({
            projectId: slackRequest.projectId!,
            props: data.props,
            workspaceType: WorkspaceType.Slack,
            targets: data.targets,
            message: data.message.substring(0, MAX_MESSAGE_LENGTH),
            place: SlackPageActions.getPlace(slackRequest, data.channelName),
          });
        },
      });

    if (!outcome || !outcome.answer) {
      return;
    }

    const place: SlackAnswerPlace | null =
      SlackActionAnswer.getPlace(slackRequest);

    if (place) {
      await SlackActionAnswer.answer({
        place: place,
        answer: outcome.answer,
      });
    }
  }

  /*
   * Opens the Page someone form, with what was typed filled in. Slack lets a
   * command open a form for three seconds; a form that took longer is told
   * to run the command again.
   */
  private static async openForm(data: {
    slackRequest: SlackRequest;
    props: DatabaseCommonInteractionProps;
    text: WorkspacePageText;
    people: WorkspacePagePeople;
  }): Promise<void> {
    const { slackRequest } = data;

    let choices: Array<WorkspacePageChoiceGroup>;

    try {
      choices = await WorkspacePage.getChoices({
        projectId: slackRequest.projectId!,
        props: data.props,
      });
    } catch (err) {
      logger.error("Could not read what the Page someone form offers.", {
        projectId: slackRequest.projectId?.toString(),
      });
      logger.error(err, { projectId: slackRequest.projectId?.toString() });

      return await SlackActionAuthorization.sendRefusal({
        requester: slackRequest,
        message: `${ProductBrandingText.getProductName()} couldn't open the form to page someone just now. Please try again in a minute.`,
      });
    }

    if (choices.length === 0) {
      return await SlackActionAuthorization.sendRefusal({
        requester: slackRequest,
        message:
          "There is nobody you can page in this project yet: no on-call schedules, people, teams or on-call policies are available to you.",
      });
    }

    const prefill: WorkspacePageFormPrefill = WorkspacePage.getPrefill({
      text: data.text,
      people: data.people,
      choices: choices,
    });

    try {
      await SlackActionAnswer.showModal({
        source: slackRequest,
        modalBlock: SlackPageActions.getFormModal({
          choices: choices,
          prefill: prefill,
        }),
      });
    } catch (err) {
      logger.debug("Slack did not open the Page someone form.", {
        projectId: slackRequest.projectId?.toString(),
      });
      logger.debug(err);

      await SlackActionAuthorization.sendRefusal({
        requester: slackRequest,
        message: `${ProductBrandingText.getProductName()} couldn't open the form to page someone in time. Please run the command again.`,
      });
    }
  }

  /*
   * The Page someone form: who to page - the project's on-call schedules,
   * people, teams and on-call policies, each kind under its own heading -
   * and the message, with what was typed filled in and a note for anybody
   * named that it cannot pick.
   */
  public static getFormModal(data: {
    choices: Array<WorkspacePageChoiceGroup>;
    prefill: WorkspacePageFormPrefill;
  }): WorkspaceModalBlock {
    const blocks: Array<WorkspaceMessageBlock> = [];

    if (data.prefill.notes.length > 0) {
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: FeedMarkdown.join(
          data.prefill.notes.map((note: string): MarkdownText => {
            return mdText`⚠️ ${note}`;
          }),
          "\n",
        ).toString(),
      } as WorkspacePayloadMarkdown);
    }

    const who: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: "Who to page",
      blockId: PAGE_FORM_WHO_FIELD,
      placeholder: "Pick people, a team or a schedule",
      options: [],
      optionGroups: data.choices.map((group: WorkspacePageChoiceGroup) => {
        return {
          label: group.label,
          options: group.choices.map((choice: WorkspacePageChoice) => {
            return {
              label: choice.label,
              value: choice.value,
            };
          }),
        };
      }),
      multiSelect: true,
      initialValues: data.prefill.values,
      description:
        "A schedule pages whoever is on call in it now. Everybody you pick is paged at once.",
    };

    blocks.push(who);

    const message: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: "Message",
      blockId: PAGE_FORM_MESSAGE_FIELD,
      placeholder: "What should they look at?",
      description:
        "What the people you page are told: the title of the alert the page is about.",
      ...(data.prefill.message
        ? { initialValue: data.prefill.message.substring(0, MAX_MESSAGE_LENGTH) }
        : {}),
    };

    blocks.push(message);

    return {
      _type: "WorkspaceModalBlock",
      title: SlackPageActions.FORM_TITLE,
      submitButtonTitle: "Page",
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitPageSomeone,
      actionValue: "",
      blocks: blocks,
    };
  }

  /*
   * The people a command @mentioned, with what Slack can tell of each: the
   * OneUptime account their Slack account is connected to in the project,
   * or else their name and the email address Slack has for them.
   */
  private static async getCandidates(data: {
    projectId: ObjectID;
    projectAuthToken: string;
    people: Array<WorkspacePagePerson>;
  }): Promise<Array<WorkspacePageCandidate>> {
    if (data.people.length === 0) {
      return [];
    }

    const connected: Array<WorkspaceUserAuthToken> =
      await WorkspaceUserAuthTokenService.findBy({
        query: {
          projectId: data.projectId,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: QueryHelper.any(
            data.people.map((person: WorkspacePagePerson): string => {
              return person.workspaceUserId;
            }),
          ),
        },
        select: {
          userId: true,
          workspaceUserId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    return await Promise.all(
      data.people.map(
        async (person: WorkspacePagePerson): Promise<WorkspacePageCandidate> => {
          const connection: WorkspaceUserAuthToken | undefined = connected.find(
            (token: WorkspaceUserAuthToken): boolean => {
              return token.workspaceUserId === person.workspaceUserId;
            },
          );

          if (connection?.userId) {
            return { person: person, connectedUserId: connection.userId };
          }

          const profile: { name: string; email: string } | null =
            await SlackUtil.getUserProfile({
              authToken: data.projectAuthToken,
              userId: person.workspaceUserId,
            });

          return {
            person: person,
            ...(profile?.email ? { email: profile.email } : {}),
            ...(profile?.name ? { chatName: profile.name } : {}),
          };
        },
      ),
    );
  }

  // Where the command was run, for the page to be shown there.
  private static getPlace(
    slackRequest: SlackRequest,
    channelName?: string | undefined,
  ): WorkspacePagePlace | undefined {
    if (!slackRequest.slackChannelId) {
      return undefined;
    }

    return {
      workspaceType: WorkspaceType.Slack,
      destinationType: WorkspaceLiveMessageDestinationType.Channel,
      channelId: slackRequest.slackChannelId,
      ...(channelName ? { channelName: channelName } : {}),
    };
  }

  // A form's value as a list of strings: a multi-select's picks.
  private static toStrings(value: unknown): Array<string> {
    if (Array.isArray(value)) {
      return value
        .map((item: unknown): string => {
          return typeof item === "string" || typeof item === "number"
            ? String(item)
            : "";
        })
        .filter((item: string): boolean => {
          return item.length > 0;
        });
    }

    return typeof value === "string" && value ? [value] : [];
  }
}
