import { TurnContext } from "./Botbuilder";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "../WorkspaceActionAnswers";
import WorkspaceProjectChoiceStore, {
  WorkspaceProjectChoicePress,
  WorkspaceProjectChoiceRefusal,
  WorkspaceProjectChoiceTaken,
} from "../WorkspaceProjectChoiceStore";
import WorkspaceProjectResolver, {
  WorkspaceProjectChoice,
  WorkspaceProjectResolution,
} from "../WorkspaceProjectResolution";
import { MicrosoftTeamsProjectChoiceActionType } from "./Actions/ActionTypes";
import MicrosoftTeamsActionAnswer, {
  MicrosoftTeamsMention,
} from "./MicrosoftTeamsActionAnswer";
import MicrosoftTeamsHome from "./MicrosoftTeamsHome";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
} from "./MicrosoftTeamsReplies";

/*
 * WHICH PROJECT A MICROSOFT TEAMS REQUEST IS FOR, ASKED WITH A BUTTON FOR
 * EACH.
 *
 * A Microsoft 365 organization can be connected to more than one OneUptime
 * project. A message to the bot, or a press of a card's button, that names
 * no record, sent in a chat or a channel no one project owns, by somebody
 * connected in several of them - "oncall" in their chat with the bot, a
 * question for OneUptime AI, the Home's Declare incident on a card sent
 * before cards carried their project - cannot be told apart
 * (WorkspaceProjectResolution). Its sender was told which projects they are
 * in and to try again from a channel of the one they meant, and a personal
 * chat has no such channel.
 *
 * Now they are asked which, where they made it, as Slack asks
 * (SlackProjectChoice): a card that mentions them, with a button for each
 * project their Microsoft Teams account is connected in as a current
 * member, in the order the projects were connected. The request is kept on
 * the server behind an opaque random token the buttons carry, keyed by its
 * SHA-256, for thirty minutes (WorkspaceProjectChoiceStore). A press spends
 * it - once, by the person who made it, in their organization, choosing a
 * project that was offered - and the request is made again in that
 * project, as the member their account is connected to there, read in full
 * again: connected account, membership, permissions. The card becomes what
 * was chosen ("Going ahead in IRM Non-Prod."). Anyone in a channel or a
 * group chat can press a card's button: somebody else's press, one whose
 * request is gone - chosen already, expired - and an edited one are each
 * answered with a short line mentioning whoever pressed, and make nothing.
 *
 * A question for OneUptime AI keeps the choice for its conversation - the
 * chat, or the channel post's thread - and its follow-ups there are
 * answered in the same project without asking again, while the
 * conversation goes on (CONVERSATION_REMEMBERED_FOR_SECONDS).
 *
 * When the card cannot be offered - the person is in fewer than two of the
 * projects or more than a card lists, a project cannot be named, the
 * request cannot be kept (the cache is down), or Teams refuses the card -
 * they are answered as before: with the projects, and where to try again
 * (WorkspaceProjectResolver.getAmbiguousAnswer). Its first words,
 * TEAMS_AMBIGUOUS_LEAD, head the docs' troubleshooting entry.
 *
 * Every card made in the chosen project carries it on its buttons
 * (MicrosoftTeamsCardProject), so a form opened there is submitted there.
 */

// What a request whose project its person chooses is, to make it again.
export enum MicrosoftTeamsProjectChoiceKind {
  // A message typed to the bot: a command, or a question for OneUptime AI.
  Message = "Message",
  // A press of a card's button that names no record: one of the Home's.
  Press = "Press",
}

export interface MicrosoftTeamsProjectChoiceRequest {
  kind: MicrosoftTeamsProjectChoiceKind;
  // As much of the activity as making it again reads (getKeptActivity).
  activity: JSONObject;
  /*
   * A question for OneUptime AI: the project chosen holds for its
   * conversation's follow-ups.
   */
  isQuestion: boolean;
}

/*
 * A conversation with OneUptime AI, and the person in it: what keeps the
 * project they chose for it.
 */
export interface MicrosoftTeamsConversationOfPerson {
  tenantId: string;
  /*
   * A personal or group chat's id, or a channel post's thread:
   * "<channel>;messageid=<post>".
   */
  conversationId: string;
  // The person's Microsoft Entra object id.
  aadObjectId: string;
}

const NAMESPACE: string = "microsoft-teams-project-choice";
const CONVERSATION_NAMESPACE: string =
  "microsoft-teams-project-choice-conversation";

// What of an activity is kept to make it again: what the bot reads of it.
const ACTIVITY_FIELDS: ReadonlyArray<string> = [
  "type",
  "id",
  "text",
  "textFormat",
  "locale",
  "localTimezone",
  "rawLocalTimestamp",
  "serviceUrl",
  "channelId",
  "replyToId",
];

// ...and of the objects in it.
const ACTIVITY_OBJECT_FIELDS: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    from: ["id", "name", "aadObjectId", "role"],
    recipient: ["id", "name"],
    conversation: ["id", "conversationType", "tenantId", "isGroup", "name"],
  };

// ...of its channelData: the organization, the team and the channel.
const CHANNEL_DATA_FIELDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  tenant: ["id"],
  team: ["id", "name", "aadGroupId"],
  channel: ["id", "name"],
};

// ...and of its entities: who it mentions, and the client's time zone.
const ENTITY_FIELDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  mention: ["type", "text"],
  clientInfo: ["type", "locale", "country", "platform", "timezone"],
};

export default class MicrosoftTeamsProjectChoice {
  /*
   * How long a project chosen for a question is kept for its conversation's
   * follow-ups: an hour from the last question answered there. A chat with
   * the bot is one conversation that never ends, so a choice kept for days
   * would answer a new question, about another project, in the old one.
   */
  public static readonly CONVERSATION_REMEMBERED_FOR_SECONDS: number = 60 * 60;

  // What a press whose request is gone - chosen already, expired - is told.
  public static readonly GONE_TEXT: string =
    "This choice has expired, or was already made. Please try again.";

  // What somebody pressing another person's question is told.
  public static readonly NOT_THEIRS_TEXT: string =
    "Only the person who asked can choose which project this is for.";

  // What the question becomes once a project is chosen.
  public static getChosenText(projectName: string): string {
    return `Going ahead in ${projectName}.`;
  }

  // Whether a card's button is one of the question's.
  public static isChoiceAction(actionType: string | undefined): boolean {
    return actionType === MicrosoftTeamsProjectChoiceActionType.ChooseProject;
  }

  /*
   * Whether a press refused for want of its project can be made again once
   * it is chosen: a button of the Home, which names no record and opens a
   * form, a list or the Home again. A form's submission never is: its fields
   * were filled in for one project.
   */
  public static canMakeAgain(actionType: string | undefined): boolean {
    return MicrosoftTeamsHome.isHomeAction(actionType);
  }

  /*
   * What of an activity is kept to make it again: who sent it, where, its
   * text and whom it mentions, the client's time zone, the card it was
   * pressed on and which button - nothing of its attachments.
   */
  public static getKeptActivity(activity: JSONObject): JSONObject {
    const kept: JSONObject = WorkspaceProjectChoiceStore.pickText(
      activity,
      ACTIVITY_FIELDS,
    );

    for (const [field, fields] of Object.entries(ACTIVITY_OBJECT_FIELDS)) {
      const value: JSONObject | undefined =
        WorkspaceProjectChoiceStore.asObject(activity[field]);

      if (value) {
        kept[field] = WorkspaceProjectChoiceStore.pickText(value, fields);
      }
    }

    const channelData: JSONObject | undefined =
      WorkspaceProjectChoiceStore.asObject(activity["channelData"]);

    if (channelData) {
      const keptChannelData: JSONObject = {};

      for (const [field, fields] of Object.entries(CHANNEL_DATA_FIELDS)) {
        const value: JSONObject | undefined =
          WorkspaceProjectChoiceStore.asObject(channelData[field]);

        if (value) {
          keptChannelData[field] = WorkspaceProjectChoiceStore.pickText(
            value,
            fields,
          );
        }
      }

      kept["channelData"] = keptChannelData;
    }

    if (Array.isArray(activity["entities"])) {
      kept["entities"] = MicrosoftTeamsProjectChoice.getKeptEntities(
        activity["entities"] as JSONArray,
      );
    }

    const value: JSONObject | undefined = WorkspaceProjectChoiceStore.asObject(
      activity["value"],
    );

    if (value) {
      kept["value"] = MicrosoftTeamsProjectChoice.getPressedButton(value);
    }

    return kept;
  }

  /*
   * Asks the sender which project they mean, where they made the request: a
   * card that mentions them, with a button for each project they are
   * connected in as a member (the resolution's memberProjectIds), the request
   * kept behind them. False when it is not asked - fewer than two such
   * projects, more than WorkspaceProjectChoiceStore.MAX_CHOICES, one that
   * cannot be named, a request that cannot be kept, a card Teams refuses -
   * and the caller answers as before. Never throws.
   */
  @CaptureSpan()
  public static async offer(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    resolution: WorkspaceProjectResolution | undefined;
    kind: MicrosoftTeamsProjectChoiceKind;
    isQuestion?: boolean | undefined;
  }): Promise<boolean> {
    const tenantId: string = MicrosoftTeamsProjectChoice.getTenantId(
      data.activity,
    );
    const aadObjectId: string = MicrosoftTeamsProjectChoice.getAadObjectId(
      data.activity,
    );
    const projectIds: Array<ObjectID> = data.resolution?.memberProjectIds || [];

    if (
      !tenantId ||
      !aadObjectId ||
      projectIds.length < 2 ||
      projectIds.length > WorkspaceProjectChoiceStore.MAX_CHOICES
    ) {
      return false;
    }

    let token: string;
    let choices: Array<WorkspaceProjectChoice> | null;

    try {
      choices = await WorkspaceProjectResolver.getProjectChoices(projectIds);

      if (!choices) {
        return false;
      }

      token = await WorkspaceProjectChoiceStore.keep({
        namespace: NAMESPACE,
        workspaceId: tenantId,
        workspaceUserId: aadObjectId,
        choices: choices,
        request: {
          kind: data.kind,
          activity: MicrosoftTeamsProjectChoice.getKeptActivity(data.activity),
          isQuestion: Boolean(data.isQuestion),
        },
      });
    } catch (err) {
      logger.error(
        "Could not record a Microsoft Teams request to ask its project of.",
      );
      logger.error(err);
      return false;
    }

    const question: { card: JSONObject; summary: string } =
      MicrosoftTeamsProjectChoice.getQuestion({
        token: token,
        choices: choices,
        mention: MicrosoftTeamsActionAnswer.getMention(
          data.turnContext.activity as unknown as JSONObject,
        ),
      });

    return await MicrosoftTeamsReplies.sendBestEffort(data.turnContext, {
      attachments: [
        {
          contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
          content: question.card,
        },
      ],
      summary: question.summary,
    });
  }

  /*
   * The question, mentioning the person, and a button named for each
   * project, one under another, in the order given: "Which project is this
   * for? This Microsoft 365 organization is connected to more than one
   * OneUptime project, and I can't tell which one you mean here." Each
   * button carries its project and the request's token.
   */
  public static getQuestion(data: {
    token: string;
    choices: Array<WorkspaceProjectChoice>;
    mention?: MicrosoftTeamsMention | null | undefined;
  }): { card: JSONObject; summary: string } {
    const productName: string = ProductBrandingText.getProductName();
    const summary: string = `Which project is this for: ${WorkspaceProjectChoiceStore.getNameList(
      data.choices,
    )}?`;

    const card: JSONObject = MicrosoftTeamsActionAnswer.buildCard({
      answer: {
        markdown:
          mdText`**Which project is this for?** This Microsoft 365 organization is connected to more than one ${productName} project, and I can't tell which one you mean here.`.toString(),
        text: summary,
      },
      mention: data.mention,
    });

    /*
     * One button a row, each a set of its own: a row of them would cut a
     * long project's name short, as Teams draws the actions of one set side
     * by side - and shows no more than six. The rows sit as close as the
     * buttons of one row do.
     */
    const body: Array<JSONObject> = card["body"] as Array<JSONObject>;

    for (const [index, choice] of data.choices.entries()) {
      body.push({
        type: "ActionSet",
        ...(index > 0 ? { spacing: "Small" } : {}),
        actions: [
          {
            type: "Action.Submit",
            title: WorkspaceProjectChoiceStore.getButtonTitle(choice.name),
            data: {
              action: MicrosoftTeamsProjectChoiceActionType.ChooseProject,
              actionValue: WorkspaceProjectChoiceStore.getChoiceValue({
                projectId: choice.projectId,
                token: data.token,
              }),
            },
          },
        ],
      });
    }

    return { card: card, summary: summary };
  }

  /*
   * The request behind a press of one of the buttons, spent: once, by the
   * person who made it, in their organization, for a project it offered.
   * Anything else spends nothing and says why. Never throws.
   */
  @CaptureSpan()
  public static async take(data: {
    activity: JSONObject;
    actionValue: string | undefined;
  }): Promise<WorkspaceProjectChoiceTaken<MicrosoftTeamsProjectChoiceRequest>> {
    const press: WorkspaceProjectChoicePress | null =
      WorkspaceProjectChoiceStore.readChoice(data.actionValue);

    if (!press) {
      return { isTaken: false, refusal: WorkspaceProjectChoiceRefusal.Gone };
    }

    return await WorkspaceProjectChoiceStore.take({
      namespace: NAMESPACE,
      press: press,
      workspaceId:
        MicrosoftTeamsProjectChoice.getTenantId(data.activity) || undefined,
      workspaceUserId:
        MicrosoftTeamsProjectChoice.getAadObjectId(data.activity) || undefined,
      readRequest: MicrosoftTeamsProjectChoice.readRequest,
    });
  }

  /*
   * What a press that spent nothing is told: somebody else's, that only the
   * person who asked can choose; any other - chosen already, expired,
   * edited - that it has expired or was made already.
   */
  public static getRefusalAnswer(
    refusal: WorkspaceProjectChoiceRefusal,
  ): WorkspaceAnswer {
    const text: string =
      refusal === WorkspaceProjectChoiceRefusal.NotTheirs
        ? MicrosoftTeamsProjectChoice.NOT_THEIRS_TEXT
        : MicrosoftTeamsProjectChoice.GONE_TEXT;

    return { markdown: mdText`${text}`.toString(), text: text };
  }

  /*
   * The question becomes what was chosen - "Going ahead in IRM Non-Prod." -
   * in its place (`replyToId`, the card pressed), still mentioning the
   * person. Never throws: the request is made again either way.
   */
  @CaptureSpan()
  public static async answerChosen(data: {
    turnContext: TurnContext;
    replyToId: string | undefined;
    projectName: string;
  }): Promise<void> {
    if (!data.replyToId) {
      return;
    }

    const text: string = MicrosoftTeamsProjectChoice.getChosenText(
      data.projectName,
    );

    const card: JSONObject = MicrosoftTeamsActionAnswer.buildCard({
      answer: {
        markdown: mdText`Going ahead in **${data.projectName}**.`.toString(),
        text: text,
      },
      mention: MicrosoftTeamsActionAnswer.getMention(
        data.turnContext.activity as unknown as JSONObject,
      ),
    });

    try {
      await data.turnContext.updateActivity({
        type: "message",
        id: data.replyToId,
        attachments: [
          {
            contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
            content: card,
          },
        ],
        summary: text,
      });
    } catch (err) {
      logger.debug(
        "Microsoft Teams did not put what a project choice became in its place.",
      );
      logger.debug(err);
    }
  }

  /*
   * The conversation an activity is part of, with its sender: the chat, or
   * the channel post's thread. Null when it names no organization,
   * conversation or person.
   */
  public static getConversationOf(
    activity: JSONObject,
  ): MicrosoftTeamsConversationOfPerson | null {
    const tenantId: string = MicrosoftTeamsProjectChoice.getTenantId(activity);
    const conversationId: string = MicrosoftTeamsProjectChoice.getText(
      WorkspaceProjectChoiceStore.asObject(activity["conversation"])?.["id"],
    );
    const aadObjectId: string =
      MicrosoftTeamsProjectChoice.getAadObjectId(activity);

    if (!tenantId || !conversationId || !aadObjectId) {
      return null;
    }

    return {
      tenantId: tenantId,
      conversationId: conversationId,
      aadObjectId: aadObjectId,
    };
  }

  /*
   * Remembers the project chosen for a question in its conversation, for
   * CONVERSATION_REMEMBERED_FOR_SECONDS: its follow-ups there are answered
   * in it, and each one keeps it for as long again. Never throws: without
   * it, they are asked again.
   */
  @CaptureSpan()
  public static async rememberConversationProject(data: {
    activity: JSONObject;
    projectId: ObjectID;
  }): Promise<void> {
    const conversation: MicrosoftTeamsConversationOfPerson | null =
      MicrosoftTeamsProjectChoice.getConversationOf(data.activity);

    if (!conversation) {
      return;
    }

    await WorkspaceProjectChoiceStore.rememberProject({
      namespace: CONVERSATION_NAMESPACE,
      keyParts:
        MicrosoftTeamsProjectChoice.getConversationKeyParts(conversation),
      projectId: data.projectId,
      expiresInSeconds:
        MicrosoftTeamsProjectChoice.CONVERSATION_REMEMBERED_FOR_SECONDS,
    });
  }

  /*
   * The project chosen for a question in the activity's conversation, by
   * its sender; null for none. Never throws.
   */
  @CaptureSpan()
  public static async getConversationProject(
    activity: JSONObject,
  ): Promise<ObjectID | null> {
    const conversation: MicrosoftTeamsConversationOfPerson | null =
      MicrosoftTeamsProjectChoice.getConversationOf(activity);

    if (!conversation) {
      return null;
    }

    return await WorkspaceProjectChoiceStore.getRememberedProject({
      namespace: CONVERSATION_NAMESPACE,
      keyParts:
        MicrosoftTeamsProjectChoice.getConversationKeyParts(conversation),
    });
  }

  /*
   * The connection of the project chosen earlier in the activity's
   * conversation, for a question nothing else ties to one project
   * (`resolution`, ambiguous) - while its sender is still a member there,
   * as the resolution read again. Null otherwise. Never throws.
   */
  @CaptureSpan()
  public static async findConversationProject(data: {
    activity: JSONObject;
    resolution: WorkspaceProjectResolution | undefined;
  }): Promise<WorkspaceProjectAuthToken | null> {
    if (!data.resolution?.isAmbiguous) {
      return null;
    }

    const remembered: ObjectID | null =
      await MicrosoftTeamsProjectChoice.getConversationProject(data.activity);

    if (!remembered) {
      return null;
    }

    const isMember: boolean = data.resolution.memberProjectIds.some(
      (projectId: ObjectID): boolean => {
        return MicrosoftTeamsProjectChoice.isSameId(projectId, remembered);
      },
    );

    if (!isMember) {
      return null;
    }

    return (
      data.resolution.connections.find(
        (connection: WorkspaceProjectAuthToken): boolean => {
          return MicrosoftTeamsProjectChoice.isSameId(
            connection.projectId,
            remembered,
          );
        },
      ) || null
    );
  }

  // The Microsoft 365 organization an activity was sent in.
  public static getTenantId(activity: JSONObject): string {
    const channelData: JSONObject | undefined =
      WorkspaceProjectChoiceStore.asObject(activity["channelData"]);

    return (
      MicrosoftTeamsProjectChoice.getText(
        WorkspaceProjectChoiceStore.asObject(channelData?.["tenant"])?.["id"],
      ) ||
      MicrosoftTeamsProjectChoice.getText(
        WorkspaceProjectChoiceStore.asObject(activity["conversation"])?.[
          "tenantId"
        ],
      )
    );
  }

  // Its sender's Microsoft Entra object id.
  public static getAadObjectId(activity: JSONObject): string {
    return MicrosoftTeamsProjectChoice.getText(
      WorkspaceProjectChoiceStore.asObject(activity["from"])?.["aadObjectId"],
    );
  }

  // A kept request, read back: null for anything offer did not keep.
  private static readRequest(
    request: JSONObject,
  ): MicrosoftTeamsProjectChoiceRequest | null {
    const kind: unknown = request["kind"];
    const activity: JSONObject | undefined =
      WorkspaceProjectChoiceStore.asObject(request["activity"]);

    if (
      !(
        Object.values(MicrosoftTeamsProjectChoiceKind) as Array<unknown>
      ).includes(kind) ||
      !activity ||
      !MicrosoftTeamsProjectChoice.getTenantId(activity) ||
      !MicrosoftTeamsProjectChoice.getAadObjectId(activity) ||
      typeof request["isQuestion"] !== "boolean"
    ) {
      return null;
    }

    return {
      kind: kind as MicrosoftTeamsProjectChoiceKind,
      activity: activity,
      isQuestion: request["isQuestion"] as boolean,
    };
  }

  /*
   * The button a press was made with, in the shapes Teams sends a submit
   * in (MicrosoftTeamsUtil.extractActionFromValue): its action and value,
   * and nothing a form around it held.
   */
  private static getPressedButton(value: JSONObject): JSONObject {
    const shapes: Array<JSONObject | undefined> = [
      value,
      WorkspaceProjectChoiceStore.asObject(value["data"]),
      WorkspaceProjectChoiceStore.asObject(
        WorkspaceProjectChoiceStore.asObject(value["action"])?.["data"],
      ),
    ];

    for (const shape of shapes) {
      if (shape && WorkspaceProjectChoiceStore.isText(shape["action"])) {
        return WorkspaceProjectChoiceStore.pickText(shape, [
          "action",
          "actionValue",
        ]);
      }
    }

    return {};
  }

  // The mentions and the client's details an activity carries, as kept.
  private static getKeptEntities(entities: JSONArray): JSONArray {
    const kept: JSONArray = [];

    for (const entry of entities) {
      const entity: JSONObject | undefined =
        WorkspaceProjectChoiceStore.asObject(entry);
      const fields: ReadonlyArray<string> | undefined =
        typeof entity?.["type"] === "string"
          ? ENTITY_FIELDS[entity["type"] as string]
          : undefined;

      if (!entity || !fields) {
        continue;
      }

      const keptEntity: JSONObject = WorkspaceProjectChoiceStore.pickText(
        entity,
        fields,
      );
      const mentioned: JSONObject | undefined =
        WorkspaceProjectChoiceStore.asObject(entity["mentioned"]);

      if (mentioned) {
        keptEntity["mentioned"] = WorkspaceProjectChoiceStore.pickText(
          mentioned,
          ["id", "name"],
        );
      }

      kept.push(keptEntity);
    }

    return kept;
  }

  // The parts of a conversation's key: hashed, never kept as they are.
  private static getConversationKeyParts(
    conversation: MicrosoftTeamsConversationOfPerson,
  ): Array<string> {
    return [
      conversation.tenantId,
      conversation.conversationId,
      conversation.aadObjectId,
    ];
  }

  private static getText(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private static isSameId(
    a: ObjectID | string | null | undefined,
    b: ObjectID | string | null | undefined,
  ): boolean {
    if (!a || !b) {
      return false;
    }

    return a.toString().toLowerCase() === b.toString().toLowerCase();
  }
}
