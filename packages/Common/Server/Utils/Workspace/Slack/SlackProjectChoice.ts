import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceProjectChoiceStore, {
  WorkspaceProjectChoicePress,
  WorkspaceProjectChoiceRecord,
  WorkspaceProjectChoiceTaken,
} from "../WorkspaceProjectChoiceStore";
import WorkspaceProjectResolver, {
  WorkspaceProjectChoice,
  WorkspaceProjectResolution,
} from "../WorkspaceProjectResolution";
import SlackActionType from "./Actions/ActionTypes";
import SlackActionAnswer, {
  SlackAnswerDelivery,
  SlackAnswerPlace,
} from "./Actions/Answer";
import SlackUtil from "./Slack";
import SlackAiConversations, {
  SlackMessage,
  SlackMessageKind,
} from "./SlackAiConversations";

/*
 * WHICH PROJECT A REQUEST IS FOR, ASKED WITH A BUTTON FOR EACH.
 *
 * A Slack workspace can be connected to more than one OneUptime project. A
 * request that names no record, made in a channel no one project owns, by
 * somebody connected in several of them - /oneuptime oncall in #general, a
 * question in the app's direct messages, a shortcut from Slack's shortcuts
 * menu - cannot be told apart (WorkspaceProjectResolution). Its person was
 * told which projects they are in and to try again from a channel of the
 * one they meant: a direct message, or a shortcut, has no such channel.
 *
 * Now they are asked which, where they made it: a button for each project
 * their Slack account is connected in as a member, in the order the
 * projects were connected. The request is kept on the server, keyed by the
 * SHA-256 of an opaque random token the buttons carry - as a Connect
 * button's press is (WorkspaceConnectRequest) - with who made it and the
 * projects offered (WorkspaceProjectChoiceStore, which Microsoft Teams'
 * MicrosoftTeamsProjectChoice keeps its requests in too). A press of one
 * spends it, once, when it is the person who made it, in the workspace they
 * made it in, choosing a project that was offered; and the request is made
 * again, in that project:
 *
 *   - a command, a shortcut, an older app's /incident or a Home button is
 *     read again as a press is (SlackAuthAction), from what Slack sent of
 *     it, with the chosen project telling it apart, and answered where it
 *     would have been - a form it opens takes the place of the modal a
 *     shortcut's project was chosen in (SlackCommandActions);
 *   - a question for OneUptime AI is answered in that project, and a
 *     conversation with it keeps the choice: its follow-ups in the thread
 *     are answered there too, without asking again.
 *
 * The question becomes what was chosen ("Going ahead in IRM Non-Prod."),
 * and a press whose request is gone - expired, chosen already - is told so
 * in its place.
 *
 * The choice decides only where the request is read. What it does there it
 * does as the member the Slack account is connected to in that project,
 * held to their own permissions, all read again when the button is pressed:
 * somebody removed from a project since is refused as before. Somebody
 * connected in none of the projects is told how to connect, and a request
 * that cannot be recorded (the cache is down), or whose projects cannot all
 * be named, is answered as it was: with the projects, and where to try
 * again (WorkspaceProjectResolver.getAmbiguousAnswer).
 *
 * The app's Home tab shows such a person one project at a time, with a
 * Switch project menu of their others (SlackHome). The project they choose
 * there is kept here too, for each person in each workspace
 * (rememberHomeProject), so their later openings show it - while they are
 * still a member there, which the Home reads again each time.
 */

// What a request whose project its person chooses is, to make it again.
export enum SlackProjectChoiceKind {
  /*
   * A slash command, a shortcut, an older app's /incident or a Home button:
   * read again as a press is, from what Slack sent of it (getPressPayload).
   */
  Press = "Press",
  // `/oneuptime ask <question>`, or `/oneuptime <question>`.
  Question = "Question",
  /*
   * A message for OneUptime AI: an @mention, a direct message, a reply in a
   * conversation with it.
   */
  Message = "Message",
}

// `/oneuptime ask <question>`, as answering it again needs it.
export interface SlackQuestionCommand {
  question: string;
  teamId: string;
  slackUserId: string;
  channelId?: string | undefined;
  // Where its answer goes: the command's own response_url.
  responseUrl: string;
  // The command as the workspace runs it, for "run /oneuptime help".
  command?: string | undefined;
}

export interface SlackProjectChoiceRequest {
  kind: SlackProjectChoiceKind;
  // A press: what Slack sent of it that reading it again needs.
  payload?: JSONObject | undefined;
  question?: SlackQuestionCommand | undefined;
  message?: SlackMessage | undefined;
}

export interface SlackProjectChoiceRecord {
  teamId: string;
  slackUserId: string;
  // The projects offered, named, in the order the buttons show them.
  choices: Array<WorkspaceProjectChoice>;
  request: SlackProjectChoiceRequest;
}

// What a press of one of the buttons names.
export type SlackProjectChoicePress = WorkspaceProjectChoicePress;

/*
 * A conversation with OneUptime AI - the thread a question is in, or
 * starts - and the person in it: what keeps the project they chose.
 */
export interface SlackConversationOfPerson {
  teamId: string;
  channelId: string;
  threadTs: string;
  slackUserId: string;
}

/*
 * Somebody's Home tab in a Slack workspace: what keeps the project they
 * chose for it (SlackHome).
 */
export interface SlackHomeOfPerson {
  teamId: string;
  slackUserId: string;
}

const NAMESPACE: string = "slack-project-choice";
const CONVERSATION_NAMESPACE: string = "slack-project-choice-conversation";
const HOME_NAMESPACE: string = "slack-project-choice-home";

// What of a press is kept to read it again: the fields SlackAuthAction reads.
const PRESS_FIELDS: ReadonlyArray<string> = [
  "type",
  "command",
  "text",
  "team_id",
  "user_id",
  "user_name",
  "channel_id",
  "channel_name",
  "response_url",
  "callback_id",
];

// ...and of the objects in it - never a message's or a view's blocks.
const PRESS_OBJECT_FIELDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  user: ["id", "username", "name"],
  team: ["id"],
  channel: ["id", "name"],
  container: ["is_ephemeral", "thread_ts"],
  message: ["ts", "thread_ts"],
  view: ["type", "callback_id", "private_metadata"],
};

export default class SlackProjectChoice {
  /*
   * Thirty minutes: as long as Slack takes answers at the response_url of
   * the request, where what it asked for is still answered once its project
   * is chosen.
   */
  public static readonly EXPIRES_IN_SECONDS: number =
    WorkspaceProjectChoiceStore.EXPIRES_IN_SECONDS;

  /*
   * The most projects offered: Slack takes 25 buttons in a row of them.
   * Somebody in more is answered as before, with the projects named.
   */
  public static readonly MAX_CHOICES: number =
    WorkspaceProjectChoiceStore.MAX_CHOICES;

  /*
   * What a command, a shortcut, an older app's /incident or a Home button
   * asks for that acts in a project and names no record: made again in the
   * chosen project (SlackCommandActions.runInChosenProject). A form's
   * submission is not one - its fields were filled in for one project.
   */
  public static readonly PRESSES_MADE_AGAIN: ReadonlyArray<SlackActionType> = [
    SlackActionType.NewIncident,
    SlackActionType.ShowIncident,
    SlackActionType.NewScheduledMaintenance,
    SlackActionType.ShowOnCall,
    SlackActionType.PageSomeone,
  ];

  // What the question becomes once a project is chosen.
  public static getChosenText(projectName: string): string {
    return `Going ahead in ${projectName}.`;
  }

  // What a press whose request is gone is told.
  public static readonly GONE_TEXT: string =
    "This choice has expired, or was already made. Please try again.";

  // Whether a Slack action id is one of the buttons' (ActionTypes.ChooseProject).
  public static isChoiceActionId(actionId: unknown): boolean {
    return (
      typeof actionId === "string" &&
      (actionId === SlackActionType.ChooseProject ||
        actionId.startsWith(`${SlackActionType.ChooseProject}:`))
    );
  }

  // What a button's value names; null for anything that is not one.
  public static readChoice(value: unknown): SlackProjectChoicePress | null {
    return WorkspaceProjectChoiceStore.readChoice(value);
  }

  /*
   * Whether a press refused for want of its project can be made again once
   * it is chosen: it asks for one of PRESSES_MADE_AGAIN, and is not a form's
   * submission.
   */
  public static canMakeAgain(data: {
    actionType: SlackActionType | undefined;
    payloadType: string | undefined;
    payload: JSONObject | undefined;
  }): boolean {
    return (
      Boolean(data.payload) &&
      data.payloadType !== "view_submission" &&
      Boolean(data.actionType) &&
      SlackProjectChoice.PRESSES_MADE_AGAIN.includes(data.actionType!)
    );
  }

  /*
   * What of a press is kept to read it again: the fields SlackAuthAction
   * reads - who, where, the command and its text, the shortcut, the
   * buttons' ids and values - and nothing of the message or the view it
   * was made on.
   */
  public static getPressPayload(payload: JSONObject): JSONObject {
    const kept: JSONObject = WorkspaceProjectChoiceStore.pickText(
      payload,
      PRESS_FIELDS,
    );

    for (const [field, fields] of Object.entries(PRESS_OBJECT_FIELDS)) {
      const value: JSONObject | undefined =
        WorkspaceProjectChoiceStore.asObject(payload[field]);

      if (value) {
        kept[field] = WorkspaceProjectChoiceStore.pickText(value, fields);
      }
    }

    if (Array.isArray(payload["actions"])) {
      kept["actions"] = (payload["actions"] as JSONArray)
        .filter((action: unknown): boolean => {
          return Boolean(WorkspaceProjectChoiceStore.asObject(action));
        })
        .map((action: JSONObject): JSONObject => {
          const keptAction: JSONObject = WorkspaceProjectChoiceStore.pickText(
            action,
            ["action_id", "value"],
          );
          const selected: JSONObject | undefined =
            WorkspaceProjectChoiceStore.asObject(action["selected_option"]);

          if (selected) {
            keptAction["selected_option"] =
              WorkspaceProjectChoiceStore.pickText(selected, ["value"]);
          }

          return keptAction;
        });
    }

    return kept;
  }

  /*
   * Asks the person which project they mean, where they made the request
   * (`place`): a button for each project they are connected in as a member
   * (the resolution's memberProjectIds), the request recorded behind them.
   * Null when it is not asked - fewer than two such projects, more than
   * MAX_CHOICES, one that cannot be named, a request that cannot be
   * recorded - and the caller answers as before. Never throws.
   */
  @CaptureSpan()
  public static async offer(data: {
    place: SlackAnswerPlace;
    teamId: string | undefined;
    slackUserId: string | undefined;
    resolution: WorkspaceProjectResolution;
    request: SlackProjectChoiceRequest;
  }): Promise<SlackAnswerDelivery | null> {
    const projectIds: Array<ObjectID> = data.resolution.memberProjectIds;

    if (
      !data.teamId ||
      !data.slackUserId ||
      projectIds.length < 2 ||
      projectIds.length > SlackProjectChoice.MAX_CHOICES
    ) {
      return null;
    }

    let token: string;
    let choices: Array<WorkspaceProjectChoice> | null;

    try {
      choices = await WorkspaceProjectResolver.getProjectChoices(projectIds);

      if (!choices) {
        return null;
      }

      token = await WorkspaceProjectChoiceStore.keep({
        namespace: NAMESPACE,
        workspaceId: data.teamId,
        workspaceUserId: data.slackUserId,
        choices: choices,
        request: SlackProjectChoice.writeRequest(data.request),
      });
    } catch (err) {
      logger.error("Could not record a Slack request to ask its project of.");
      logger.error(err);
      return null;
    }

    const question: {
      messageBlocks: Array<WorkspaceMessageBlock>;
      text: string;
    } = SlackProjectChoice.getQuestion({ token: token, choices: choices });

    return await SlackActionAnswer.answerWithBlocks({
      place: data.place,
      messageBlocks: question.messageBlocks,
      text: question.text,
    });
  }

  /*
   * The question, and a button named for each project, in the order given:
   * "Which project is this for? This Slack workspace is connected to more
   * than one OneUptime project, and OneUptime can't tell which one you mean
   * here." Each button's value names its project and the request's token.
   */
  public static getQuestion(data: {
    token: string;
    choices: Array<WorkspaceProjectChoice>;
  }): { messageBlocks: Array<WorkspaceMessageBlock>; text: string } {
    const productName: string = ProductBrandingText.getProductName();
    const lead: string = WorkspaceProjectResolver.getAmbiguousLead(
      WorkspaceType.Slack,
    );

    const markdown: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: mdText`**Which project is this for?** ${lead}, and ${productName} can't tell which one you mean here.`.toString(),
    };

    const buttons: WorkspacePayloadButtons = {
      _type: "WorkspacePayloadButtons",
      buttons: data.choices.map(
        (
          choice: WorkspaceProjectChoice,
          index: number,
        ): WorkspaceMessagePayloadButton => {
          return {
            _type: "WorkspaceMessagePayloadButton",
            title: WorkspaceProjectChoiceStore.getButtonTitle(choice.name),
            value: WorkspaceProjectChoiceStore.getChoiceValue({
              projectId: choice.projectId,
              token: data.token,
            }),
            // Slack takes one action id once in a block.
            actionId: `${SlackActionType.ChooseProject}:${index}`,
          };
        },
      ),
    };

    return {
      messageBlocks: [markdown, buttons],
      text: `Which project is this for: ${WorkspaceProjectChoiceStore.getNameList(
        data.choices,
      )}? ${lead}.`,
    };
  }

  /*
   * The request behind a press of one of the buttons, spent: once, by the
   * person who made it, in the workspace it was made in, for a project it
   * offered. Null for anything else - not one, expired, spent, somebody
   * else's, a project not offered - and nothing is spent then: the person
   * whose question it is can still choose. Never throws.
   */
  @CaptureSpan()
  public static async take(data: {
    press: SlackProjectChoicePress;
    teamId: string | undefined;
    slackUserId: string | undefined;
  }): Promise<SlackProjectChoiceRecord | null> {
    const taken: WorkspaceProjectChoiceTaken<SlackProjectChoiceRequest> =
      await WorkspaceProjectChoiceStore.take({
        namespace: NAMESPACE,
        press: data.press,
        workspaceId: data.teamId,
        workspaceUserId: data.slackUserId,
        readRequest: SlackProjectChoice.readRequest,
      });

    if (!taken.isTaken) {
      return null;
    }

    const record: WorkspaceProjectChoiceRecord<SlackProjectChoiceRequest> =
      taken.record;

    return {
      teamId: record.workspaceId,
      slackUserId: record.workspaceUserId,
      choices: record.choices,
      request: record.request,
    };
  }

  // The choice of `projectId` among a record's; undefined when not offered.
  public static getChoice(
    record: SlackProjectChoiceRecord,
    projectId: ObjectID,
  ): WorkspaceProjectChoice | undefined {
    return WorkspaceProjectChoiceStore.getChoice(record, projectId);
  }

  /*
   * The question becomes what was chosen - "Going ahead in IRM Non-Prod." -
   * in its place, through the press's response_url. Never throws: the
   * request is made again either way.
   */
  @CaptureSpan()
  public static async answerChosen(data: {
    responseUrl: string | undefined;
    projectName: string;
  }): Promise<void> {
    if (!data.responseUrl) {
      return;
    }

    const chosen: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: mdText`Going ahead in **${data.projectName}**.`.toString(),
    };

    try {
      await SlackUtil.replaceMessageAtResponseUrl({
        responseUrl: data.responseUrl,
        messageBlocks: [chosen],
        text: SlackProjectChoice.getChosenText(data.projectName),
      });
    } catch (err) {
      logger.debug("Slack did not take what a project choice became.");
      logger.debug(err);
    }
  }

  /*
   * A press whose request is gone - expired, chosen already - is told so in
   * the question's place: the message, through the press's response_url, or
   * the modal it was asked in (`viewId`). Never throws.
   */
  @CaptureSpan()
  public static async answerGone(data: {
    responseUrl: string | undefined;
    projectAuthToken: string | undefined;
    triggerId: string | undefined;
    viewId: string | undefined;
  }): Promise<void> {
    const gone: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: mdText`${SlackProjectChoice.GONE_TEXT}`.toString(),
    };
    const messageBlocks: Array<WorkspaceMessageBlock> = [gone];

    try {
      if (data.viewId && data.projectAuthToken) {
        await SlackUtil.showMessageInModal({
          authToken: data.projectAuthToken,
          triggerId: data.triggerId || "",
          title: ProductBrandingText.getProductName(),
          messageBlocks: messageBlocks,
          viewId: data.viewId,
        });
        return;
      }

      if (data.responseUrl) {
        await SlackUtil.replaceMessageAtResponseUrl({
          responseUrl: data.responseUrl,
          messageBlocks: messageBlocks,
          text: SlackProjectChoice.GONE_TEXT,
        });
      }
    } catch (err) {
      logger.debug("Slack did not take the answer to a spent project choice.");
      logger.debug(err);
    }
  }

  // The conversation with OneUptime AI a message is part of, of its author.
  public static getConversationOf(
    message: SlackMessage,
  ): SlackConversationOfPerson {
    return {
      teamId: message.teamId,
      channelId: message.channelId,
      threadTs: SlackAiConversations.getThreadTs(message),
      slackUserId: message.userId,
    };
  }

  /*
   * Remembers the project chosen in a conversation with OneUptime AI, while
   * it stays open (SlackAiConversations.OPEN_FOR_SECONDS): its follow-ups
   * are answered there. Never throws: without it, they are asked again.
   */
  @CaptureSpan()
  public static async rememberConversationProject(data: {
    conversation: SlackConversationOfPerson;
    projectId: ObjectID;
  }): Promise<void> {
    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: CONVERSATION_NAMESPACE,
      keyParts: SlackProjectChoice.getConversationKeyParts(data.conversation),
      projectId: data.projectId,
      expiresInSeconds: SlackAiConversations.OPEN_FOR_SECONDS,
    });
  }

  /*
   * The project chosen in a conversation with OneUptime AI, by its person;
   * null for none. Never throws: a cache that cannot be read is none.
   */
  @CaptureSpan()
  public static async getConversationProject(
    conversation: SlackConversationOfPerson,
  ): Promise<ObjectID | null> {
    return await WorkspaceProjectChoiceStore.getRememberedProject({
      namespace: CONVERSATION_NAMESPACE,
      keyParts: SlackProjectChoice.getConversationKeyParts(conversation),
    });
  }

  /*
   * How long the project chosen for somebody's Home is kept: ninety days
   * from the last time their Home was drawn for it - SlackHome keeps it
   * again each time it shows it, so it is kept while they use it.
   */
  public static readonly HOME_REMEMBERED_FOR_SECONDS: number =
    90 * 24 * 60 * 60;

  /*
   * Remembers the project somebody chose for their Home in a workspace
   * (SlackHome's Switch project): their later openings show it while they
   * are still a member there. Never throws: without it, the Home shows the
   * first of their projects.
   */
  @CaptureSpan()
  public static async rememberHomeProject(data: {
    person: SlackHomeOfPerson;
    projectId: ObjectID;
  }): Promise<void> {
    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: HOME_NAMESPACE,
      keyParts: SlackProjectChoice.getHomeKeyParts(data.person),
      projectId: data.projectId,
      expiresInSeconds: SlackProjectChoice.HOME_REMEMBERED_FOR_SECONDS,
    });
  }

  /*
   * The project somebody chose last for their Home in a workspace; null for
   * none. Whether they may still see it is read by the Home, every time.
   * Never throws: a cache that cannot be read is none.
   */
  @CaptureSpan()
  public static async getHomeProject(
    person: SlackHomeOfPerson,
  ): Promise<ObjectID | null> {
    return await WorkspaceProjectChoiceStore.getRememberedProject({
      namespace: HOME_NAMESPACE,
      keyParts: SlackProjectChoice.getHomeKeyParts(person),
    });
  }

  // A request as it is kept (WorkspaceProjectChoiceStore.keep).
  private static writeRequest(request: SlackProjectChoiceRequest): JSONObject {
    const written: JSONObject = { kind: request.kind };

    if (request.payload) {
      written["payload"] = request.payload;
    }

    if (request.question) {
      written["question"] = request.question as unknown as JSONObject;
    }

    if (request.message) {
      written["message"] = request.message as unknown as JSONObject;
    }

    return written;
  }

  // A kept request, read back: null for anything writeRequest did not write.
  private static readRequest(
    request: JSONObject,
  ): SlackProjectChoiceRequest | null {
    switch (request["kind"]) {
      case SlackProjectChoiceKind.Press: {
        const payload: JSONObject | undefined =
          WorkspaceProjectChoiceStore.asObject(request["payload"]);

        return payload
          ? { kind: SlackProjectChoiceKind.Press, payload: payload }
          : null;
      }
      case SlackProjectChoiceKind.Question: {
        const question: JSONObject | undefined =
          WorkspaceProjectChoiceStore.asObject(request["question"]);

        if (
          !question ||
          !WorkspaceProjectChoiceStore.isText(question["question"]) ||
          !WorkspaceProjectChoiceStore.isText(question["teamId"]) ||
          !WorkspaceProjectChoiceStore.isText(question["slackUserId"]) ||
          !WorkspaceProjectChoiceStore.isText(question["responseUrl"])
        ) {
          return null;
        }

        return {
          kind: SlackProjectChoiceKind.Question,
          question: {
            question: question["question"] as string,
            teamId: question["teamId"] as string,
            slackUserId: question["slackUserId"] as string,
            channelId: WorkspaceProjectChoiceStore.textOrUndefined(
              question["channelId"],
            ),
            responseUrl: question["responseUrl"] as string,
            command: WorkspaceProjectChoiceStore.textOrUndefined(
              question["command"],
            ),
          },
        };
      }
      case SlackProjectChoiceKind.Message: {
        const message: JSONObject | undefined =
          WorkspaceProjectChoiceStore.asObject(request["message"]);

        if (
          !message ||
          !(Object.values(SlackMessageKind) as Array<unknown>).includes(
            message["kind"],
          ) ||
          !WorkspaceProjectChoiceStore.isText(message["teamId"]) ||
          !WorkspaceProjectChoiceStore.isText(message["channelId"]) ||
          !WorkspaceProjectChoiceStore.isText(message["userId"]) ||
          !WorkspaceProjectChoiceStore.isText(message["text"]) ||
          !WorkspaceProjectChoiceStore.isText(message["ts"])
        ) {
          return null;
        }

        return {
          kind: SlackProjectChoiceKind.Message,
          message: {
            kind: message["kind"] as SlackMessageKind,
            teamId: message["teamId"] as string,
            channelId: message["channelId"] as string,
            userId: message["userId"] as string,
            text: message["text"] as string,
            ts: message["ts"] as string,
            threadTs: WorkspaceProjectChoiceStore.textOrUndefined(
              message["threadTs"],
            ),
          },
        };
      }
      default:
        return null;
    }
  }

  // The parts of a conversation's key: hashed, never kept as they are.
  private static getConversationKeyParts(
    conversation: SlackConversationOfPerson,
  ): Array<string> {
    return [
      conversation.teamId,
      conversation.channelId,
      conversation.threadTs,
      conversation.slackUserId,
    ];
  }

  // The parts of a Home's key: hashed, never kept as they are.
  private static getHomeKeyParts(person: SlackHomeOfPerson): Array<string> {
    return [person.teamId, person.slackUserId];
  }
}
