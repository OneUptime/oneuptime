import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH } from "../../../../../Types/OnCallDutyPolicy/OnCallPersonPage";
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
  WORKSPACE_PAGE_FORM_TEXT,
  WorkspacePageCandidate,
  WorkspacePageChoice,
  WorkspacePageChoiceGroup,
  WorkspacePageFormPrefill,
  WorkspacePageGroups,
  WorkspacePageOutcome,
  WorkspacePagePeople,
  WorkspacePagePlace,
} from "../../WorkspacePage";
import WorkspacePageAbout, {
  WorkspacePageRecord,
  WorkspacePageSubject,
} from "../../WorkspacePageAbout";
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
 * Slack is answered at once (it waits three seconds at most). What the page
 * is about is the channel's (WorkspacePageAbout): in an incident's or an
 * alert's own channel, that incident or alert - the message is optional
 * there - and anywhere else a new alert, whose title is the message. Then:
 *
 *   - people @mentioned, OneUptime can tell them all, and a message where
 *     one is needed: they are paged now. "📟 Paging Nawaz Dhandala about
 *     Incident INC-42…" (or "... about a new alert…") only the person who
 *     ran it sees, then the page's message in the channel, edited as it
 *     goes. A user group @mentioned that follows on-call schedules pages
 *     them - whoever is on call in them now - the same way;
 *   - anything else: the Page someone form (a modal), with what was typed
 *     filled in - who to page, picked from the project's on-call schedules,
 *     people, teams and on-call policies, and the message - opening with
 *     the incident it is about, or saying its message becomes a new alert's
 *     title. Submitted, it pages the same way.
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
  public static readonly FORM_TITLE: string = WORKSPACE_PAGE_FORM_TEXT.title;

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

    /*
     * What the page is about: in an incident's or an alert's own channel,
     * that record; anywhere else, something new (WorkspacePageAbout).
     */
    const about: WorkspacePageSubject | null =
      await SlackPageActions.readAbout({
        slackRequest: slackRequest,
        props: props,
        read: (): Promise<WorkspacePageSubject> => {
          return WorkspacePageAbout.read({
            projectId: slackRequest.projectId!,
            channelId: slackRequest.slackChannelId,
            props: props,
          });
        },
      });

    if (!about) {
      return;
    }

    const [people, groups]: [WorkspacePagePeople, WorkspacePageGroups] =
      await Promise.all([
        (async (): Promise<WorkspacePagePeople> => {
          return await WorkspacePage.resolvePeople({
            projectId: slackRequest.projectId!,
            workspaceType: WorkspaceType.Slack,
            candidates: await SlackPageActions.getCandidates({
              projectId: slackRequest.projectId!,
              projectAuthToken: slackRequest.projectAuthToken!,
              people: text.people,
            }),
          });
        })(),
        WorkspacePage.resolveGroups({
          projectId: slackRequest.projectId!,
          workspaceType: WorkspaceType.Slack,
          groups: text.groups,
          props: props,
        }),
      ]);

    if (
      !WorkspacePage.isReadyToPage({
        text: text,
        people: people,
        groups: groups,
        about: about,
      })
    ) {
      return await SlackPageActions.openForm({
        slackRequest: slackRequest,
        props: props,
        text: text,
        people: people,
        groups: groups,
        about: about,
      });
    }

    const place: SlackAnswerPlace | null =
      SlackActionAnswer.getPlace(slackRequest);

    /*
     * Said at once, only to them: a page can take a few seconds, and a
     * command that seems to do nothing gets run again. It says what the
     * page is about - the channel's incident, or a new alert - before the
     * page makes anything.
     */
    if (place) {
      await SlackActionAnswer.answer({
        place: place,
        answer: SlackPageActions.getPagingAnswer(
          WorkspacePage.getPagedNames({ people: people, groups: groups }),
          about,
        ),
      });
    }

    await SlackPageActions.pageAndAnswer({
      slackRequest: slackRequest,
      props: props,
      targets: WorkspacePage.getTargets({ people: people, groups: groups }),
      message: text.message,
      about: about,
      channelName:
        typeof (data.req.body as JSONObject | undefined)?.["channel_name"] ===
        "string"
          ? ((data.req.body as JSONObject)["channel_name"] as string)
          : undefined,
    });
  }

  /*
   * What a page is about, read as the member (`read`); null - and they are
   * told why, where they asked - when the channel is a record's own that
   * they may not read: the page there would be about it, and nothing is
   * paged.
   */
  private static async readAbout(data: {
    slackRequest: SlackRequest;
    props: DatabaseCommonInteractionProps;
    read: () => Promise<WorkspacePageSubject>;
  }): Promise<WorkspacePageSubject | null> {
    try {
      return await data.read();
    } catch (err) {
      if (
        !(err instanceof NotAuthorizedException) &&
        !(err instanceof PaymentRequiredException)
      ) {
        throw err;
      }

      await SlackActionAuthorization.sendRefusal({
        requester: data.slackRequest,
        message: err.message,
      });

      return null;
    }
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

    /*
     * A form about an incident or an alert carries it (its value), and its
     * message is optional: told from the value alone, as Slack is answered
     * now. The record is read again below, as the member.
     */
    const isAboutRecord: boolean = Boolean(
      WorkspacePageAbout.parseValue(data.action.actionValue),
    );

    const problems: {
      who?: string | undefined;
      message?: string | undefined;
    } | null = WorkspacePage.getFormProblems({
      values: picked,
      message: message,
      isMessageRequired: !isAboutRecord,
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

    const about: WorkspacePageSubject | null =
      await SlackPageActions.readAbout({
        slackRequest: slackRequest,
        props: props,
        read: (): Promise<WorkspacePageSubject> => {
          return WorkspacePageAbout.readValue({
            value: data.action.actionValue,
            props: props,
          });
        },
      });

    if (!about) {
      return;
    }

    /*
     * Resolved since the form opened: there is nothing left to page about,
     * and the message left empty for it is no new alert's title.
     */
    if (isAboutRecord && !about.record) {
      return await SlackActionAuthorization.sendRefusal({
        requester: slackRequest,
        message: WorkspacePage.getResolvedSinceMessage(about),
      });
    }

    await SlackPageActions.pageAndAnswer({
      slackRequest: slackRequest,
      props: props,
      targets: WorkspacePage.readTargets(picked),
      message: message,
      about: about,
    });
  }

  /*
   * What the person who paged sees at once, only them, before anything is
   * made: who, and what the page is about - "📟 Paging **Nawaz Dhandala**
   * about Incident INC-42…" in the incident's own channel, "📟 Paging
   * **Nawaz Dhandala** about a new alert…" anywhere else
   * (WorkspacePageAbout). Without `about`, who alone.
   */
  public static getPagingAnswer(
    names: Array<string>,
    about?: WorkspacePageSubject | undefined,
  ): {
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

    const aboutWords: string = about
      ? ` ${WorkspacePageAbout.getAboutWords(about)}`
      : "";

    return {
      markdown: mdText`📟 Paging ${who}${aboutWords}…`.toString(),
      text: `Paging ${plainWho}${aboutWords}…`,
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
    about: WorkspacePageSubject;
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
            about: data.about,
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
    groups: WorkspacePageGroups;
    about: WorkspacePageSubject;
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
      groups: data.groups,
      choices: choices,
      workspaceType: WorkspaceType.Slack,
    });

    try {
      await SlackActionAnswer.showModal({
        source: slackRequest,
        modalBlock: SlackPageActions.getFormModal({
          choices: choices,
          prefill: prefill,
          about: data.about,
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
   * named that it cannot pick. A form about an incident or an alert opens
   * with it, as the incident's own forms do, and its message is optional;
   * one about something new says the message becomes a new alert's title
   * (WorkspacePage.getMessageHint). It carries what it is about, for its
   * submission (WorkspacePageAbout.toValue).
   */
  public static getFormModal(data: {
    choices: Array<WorkspacePageChoiceGroup>;
    prefill: WorkspacePageFormPrefill;
    // Something new when left out.
    about?: WorkspacePageSubject | undefined;
  }): WorkspaceModalBlock {
    const blocks: Array<WorkspaceMessageBlock> = [];
    const record: WorkspacePageRecord | null = data.about?.record || null;

    if (record) {
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: WorkspacePageAbout.getHeading(record).toString(),
      } as WorkspacePayloadMarkdown);
    }

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
      label: WORKSPACE_PAGE_FORM_TEXT.whoLabel,
      blockId: PAGE_FORM_WHO_FIELD,
      placeholder: WORKSPACE_PAGE_FORM_TEXT.whoPlaceholder,
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
      // And, past the list's hundred people, how to page the others.
      description: [
        WORKSPACE_PAGE_FORM_TEXT.whoHint,
        WorkspacePage.getNotShownNote(data.choices),
      ]
        .filter((sentence: string): boolean => {
          return sentence.length > 0;
        })
        .join(" "),
    };

    blocks.push(who);

    const message: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: WORKSPACE_PAGE_FORM_TEXT.messageLabel,
      blockId: PAGE_FORM_MESSAGE_FIELD,
      placeholder: WORKSPACE_PAGE_FORM_TEXT.messagePlaceholder,
      description: WorkspacePage.getMessageHint(data.about),
      /*
       * About an incident or an alert, the record says what it is about:
       * the message is the page's own, kept as long as an alert's title.
       */
      ...(record
        ? { optional: true, maxLength: ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH }
        : {}),
      ...(data.prefill.message
        ? {
            initialValue: data.prefill.message.substring(
              0,
              record ? ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH : MAX_MESSAGE_LENGTH,
            ),
          }
        : {}),
    };

    blocks.push(message);

    return {
      _type: "WorkspaceModalBlock",
      title: SlackPageActions.FORM_TITLE,
      submitButtonTitle: WORKSPACE_PAGE_FORM_TEXT.submit,
      cancelButtonTitle: "Cancel",
      actionId: SlackActionType.SubmitPageSomeone,
      actionValue: data.about ? WorkspacePageAbout.toValue(data.about) : "",
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
        async (
          person: WorkspacePagePerson,
        ): Promise<WorkspacePageCandidate> => {
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
