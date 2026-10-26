import crypto from "crypto";
import GlobalCache from "../../../Infrastructure/GlobalCache";
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
 * projects were connected. The request is recorded here, on the server,
 * keyed by the SHA-256 of an opaque random token the buttons carry - as a
 * Connect button's press is (WorkspaceConnectRequest) - with who made it and
 * the projects offered. A press of one spends it, once, when it is the
 * person who made it, in the workspace they made it in, choosing a project
 * that was offered; and the request is made again, in that project:
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
export interface SlackProjectChoicePress {
  projectId: ObjectID;
  // The recorded request's token.
  token: string;
}

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

const NAMESPACE: string = "slack-project-choice";
const CONVERSATION_NAMESPACE: string = "slack-project-choice-conversation";

// 32 random bytes, as base64url writes them.
const TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

// The most a button's text holds.
const BUTTON_TITLE_MAX_LENGTH: number = 75;

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
  public static readonly EXPIRES_IN_SECONDS: number = 30 * 60;

  /*
   * The most projects offered: Slack takes 25 buttons in a row of them.
   * Somebody in more is answered as before, with the projects named.
   */
  public static readonly MAX_CHOICES: number = 25;

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
    if (typeof value !== "string") {
      return null;
    }

    const separator: number = value.indexOf(":");

    if (separator < 0) {
      return null;
    }

    const projectId: string = value.substring(0, separator);
    const token: string = value.substring(separator + 1);

    if (!ObjectID.isValidUUID(projectId) || !TOKEN_PATTERN.test(token)) {
      return null;
    }

    return { projectId: new ObjectID(projectId), token: token };
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
    const kept: JSONObject = SlackProjectChoice.pick(payload, PRESS_FIELDS);

    for (const [field, fields] of Object.entries(PRESS_OBJECT_FIELDS)) {
      const value: unknown = payload[field];

      if (value && typeof value === "object" && !Array.isArray(value)) {
        kept[field] = SlackProjectChoice.pick(value as JSONObject, fields);
      }
    }

    if (Array.isArray(payload["actions"])) {
      kept["actions"] = (payload["actions"] as JSONArray)
        .filter((action: unknown): boolean => {
          return Boolean(
            action && typeof action === "object" && !Array.isArray(action),
          );
        })
        .map((action: JSONObject): JSONObject => {
          const keptAction: JSONObject = SlackProjectChoice.pick(action, [
            "action_id",
            "value",
          ]);
          const selected: unknown = action["selected_option"];

          if (
            selected &&
            typeof selected === "object" &&
            !Array.isArray(selected)
          ) {
            keptAction["selected_option"] = SlackProjectChoice.pick(
              selected as JSONObject,
              ["value"],
            );
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

      token = crypto.randomBytes(32).toString("base64url");

      await GlobalCache.setString(
        NAMESPACE,
        SlackProjectChoice.hash(token),
        JSON.stringify(
          SlackProjectChoice.write({
            teamId: data.teamId,
            slackUserId: data.slackUserId,
            choices: choices,
            request: data.request,
          }),
        ),
        { expiresInSeconds: SlackProjectChoice.EXPIRES_IN_SECONDS },
      );
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
    const names: Array<string> = data.choices.map(
      (choice: WorkspaceProjectChoice): string => {
        return choice.name;
      },
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
            title: SlackProjectChoice.getButtonTitle(choice.name),
            value: `${choice.projectId.toString()}:${data.token}`,
            // Slack takes one action id once in a block.
            actionId: `${SlackActionType.ChooseProject}:${index}`,
          };
        },
      ),
    };

    const list: string =
      names.length > 1
        ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]!}`
        : names[0] || "";

    return {
      messageBlocks: [markdown, buttons],
      text: `Which project is this for: ${list}? ${lead}.`,
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
    const key: string = SlackProjectChoice.hash(data.press.token);

    try {
      const record: SlackProjectChoiceRecord | null = SlackProjectChoice.parse(
        await GlobalCache.getString(NAMESPACE, key),
      );

      if (
        !record ||
        !data.teamId ||
        !data.slackUserId ||
        record.teamId !== data.teamId ||
        record.slackUserId !== data.slackUserId ||
        !SlackProjectChoice.getChoice(record, data.press.projectId)
      ) {
        return null;
      }

      // Spent in one atomic step: a second press finds nothing.
      return SlackProjectChoice.parse(
        await GlobalCache.getAndDeleteString(NAMESPACE, key),
      );
    } catch (err) {
      logger.error("Could not read the request a Slack project choice is for.");
      logger.error(err);
      return null;
    }
  }

  // The choice of `projectId` among a record's; undefined when not offered.
  public static getChoice(
    record: SlackProjectChoiceRecord,
    projectId: ObjectID,
  ): WorkspaceProjectChoice | undefined {
    return record.choices.find((choice: WorkspaceProjectChoice): boolean => {
      return (
        choice.projectId.toString().toLowerCase() ===
        projectId.toString().toLowerCase()
      );
    });
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
    try {
      await GlobalCache.setString(
        CONVERSATION_NAMESPACE,
        SlackProjectChoice.getConversationKey(data.conversation),
        data.projectId.toString(),
        { expiresInSeconds: SlackAiConversations.OPEN_FOR_SECONDS },
      );
    } catch (err) {
      logger.debug(
        "Could not remember the project chosen in a conversation with OneUptime AI.",
      );
      logger.debug(err);
    }
  }

  /*
   * The project chosen in a conversation with OneUptime AI, by its person;
   * null for none. Never throws: a cache that cannot be read is none.
   */
  @CaptureSpan()
  public static async getConversationProject(
    conversation: SlackConversationOfPerson,
  ): Promise<ObjectID | null> {
    try {
      const projectId: string | null = await GlobalCache.getString(
        CONVERSATION_NAMESPACE,
        SlackProjectChoice.getConversationKey(conversation),
      );

      return projectId && ObjectID.isValidUUID(projectId)
        ? new ObjectID(projectId)
        : null;
    } catch (err) {
      logger.debug(
        "Could not read the project chosen in a conversation with OneUptime AI.",
      );
      logger.debug(err);
      return null;
    }
  }

  // A button's text: the project's name, cut to what Slack takes.
  private static getButtonTitle(name: string): string {
    return name.length > BUTTON_TITLE_MAX_LENGTH
      ? `${name.substring(0, BUTTON_TITLE_MAX_LENGTH - 1)}…`
      : name;
  }

  // A record as it is stored.
  private static write(record: SlackProjectChoiceRecord): JSONObject {
    const request: JSONObject = { kind: record.request.kind };

    if (record.request.payload) {
      request["payload"] = record.request.payload;
    }

    if (record.request.question) {
      request["question"] = record.request.question as unknown as JSONObject;
    }

    if (record.request.message) {
      request["message"] = record.request.message as unknown as JSONObject;
    }

    return {
      teamId: record.teamId,
      slackUserId: record.slackUserId,
      choices: record.choices.map(
        (choice: WorkspaceProjectChoice): JSONObject => {
          return {
            projectId: choice.projectId.toString(),
            name: choice.name,
          };
        },
      ),
      request: request,
    };
  }

  // A stored record, read back: null for anything write did not write.
  private static parse(raw: string | null): SlackProjectChoiceRecord | null {
    if (!raw) {
      return null;
    }

    let stored: unknown;

    try {
      stored = JSON.parse(raw);
    } catch {
      return null;
    }

    const record: JSONObject | undefined = SlackProjectChoice.asObject(stored);
    const request: JSONObject | undefined = SlackProjectChoice.asObject(
      record?.["request"],
    );

    if (
      !record ||
      !request ||
      typeof record["teamId"] !== "string" ||
      !record["teamId"] ||
      typeof record["slackUserId"] !== "string" ||
      !record["slackUserId"] ||
      !Array.isArray(record["choices"])
    ) {
      return null;
    }

    const choices: Array<WorkspaceProjectChoice> = [];

    for (const entry of record["choices"] as JSONArray) {
      const choice: JSONObject | undefined = SlackProjectChoice.asObject(entry);

      if (
        !choice ||
        typeof choice["projectId"] !== "string" ||
        !ObjectID.isValidUUID(choice["projectId"]) ||
        typeof choice["name"] !== "string" ||
        !choice["name"]
      ) {
        return null;
      }

      choices.push({
        projectId: new ObjectID(choice["projectId"]),
        name: choice["name"],
      });
    }

    const parsedRequest: SlackProjectChoiceRequest | null =
      SlackProjectChoice.parseRequest(request);

    if (choices.length === 0 || !parsedRequest) {
      return null;
    }

    return {
      teamId: record["teamId"],
      slackUserId: record["slackUserId"],
      choices: choices,
      request: parsedRequest,
    };
  }

  private static parseRequest(
    request: JSONObject,
  ): SlackProjectChoiceRequest | null {
    switch (request["kind"]) {
      case SlackProjectChoiceKind.Press: {
        const payload: JSONObject | undefined = SlackProjectChoice.asObject(
          request["payload"],
        );

        return payload
          ? { kind: SlackProjectChoiceKind.Press, payload: payload }
          : null;
      }
      case SlackProjectChoiceKind.Question: {
        const question: JSONObject | undefined = SlackProjectChoice.asObject(
          request["question"],
        );

        if (
          !question ||
          !SlackProjectChoice.isText(question["question"]) ||
          !SlackProjectChoice.isText(question["teamId"]) ||
          !SlackProjectChoice.isText(question["slackUserId"]) ||
          !SlackProjectChoice.isText(question["responseUrl"])
        ) {
          return null;
        }

        return {
          kind: SlackProjectChoiceKind.Question,
          question: {
            question: question["question"] as string,
            teamId: question["teamId"] as string,
            slackUserId: question["slackUserId"] as string,
            channelId: SlackProjectChoice.textOrUndefined(
              question["channelId"],
            ),
            responseUrl: question["responseUrl"] as string,
            command: SlackProjectChoice.textOrUndefined(question["command"]),
          },
        };
      }
      case SlackProjectChoiceKind.Message: {
        const message: JSONObject | undefined = SlackProjectChoice.asObject(
          request["message"],
        );

        if (
          !message ||
          !(Object.values(SlackMessageKind) as Array<unknown>).includes(
            message["kind"],
          ) ||
          !SlackProjectChoice.isText(message["teamId"]) ||
          !SlackProjectChoice.isText(message["channelId"]) ||
          !SlackProjectChoice.isText(message["userId"]) ||
          !SlackProjectChoice.isText(message["text"]) ||
          !SlackProjectChoice.isText(message["ts"])
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
            threadTs: SlackProjectChoice.textOrUndefined(message["threadTs"]),
          },
        };
      }
      default:
        return null;
    }
  }

  // The fields of `object` named, those that hold text or a yes or no.
  private static pick(
    object: JSONObject,
    fields: ReadonlyArray<string>,
  ): JSONObject {
    const picked: JSONObject = {};

    for (const field of fields) {
      const value: unknown = object[field];

      if (typeof value === "string" || typeof value === "boolean") {
        picked[field] = value;
      }
    }

    return picked;
  }

  private static asObject(value: unknown): JSONObject | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : undefined;
  }

  private static isText(value: unknown): boolean {
    return typeof value === "string" && value.length > 0;
  }

  private static textOrUndefined(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
  }

  private static getConversationKey(
    conversation: SlackConversationOfPerson,
  ): string {
    return SlackProjectChoice.hash(
      JSON.stringify([
        conversation.teamId,
        conversation.channelId,
        conversation.threadTs,
        conversation.slackUserId,
      ]),
    );
  }

  private static hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }
}
