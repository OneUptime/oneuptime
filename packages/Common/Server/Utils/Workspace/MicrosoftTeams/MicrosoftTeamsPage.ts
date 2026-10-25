import { TeamsChannelAccount, TeamsInfo, TurnContext } from "./Botbuilder";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspaceLiveMessageDestinationType } from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { OnCallPageTargets } from "../../../Services/OnCallPageService";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "../WorkspaceActionAnswers";
import { WorkspaceCommandName } from "../WorkspaceCommands";
import WorkspacePage, {
  WORKSPACE_PAGE_FORM_TEXT,
  WorkspacePageCandidate,
  WorkspacePageChoice,
  WorkspacePageChoiceGroup,
  WorkspacePageFormPrefill,
  WorkspacePageGroups,
  WorkspacePageOutcome,
  WorkspacePagePeople,
  WorkspacePagePlace,
  WorkspacePageTargetKind,
} from "../WorkspacePage";
import WorkspacePageTextReader, {
  WorkspacePagePerson,
  WorkspacePageText,
  WorkspacePageToken,
} from "../WorkspacePageText";
import { MicrosoftTeamsPageActionType } from "./Actions/ActionTypes";
import MicrosoftTeamsUtil from "./MicrosoftTeams";
import MicrosoftTeamsActionAnswer from "./MicrosoftTeamsActionAnswer";
import MicrosoftTeamsCardChoices, {
  MicrosoftTeamsCardChoice,
  MicrosoftTeamsCardChoiceList,
} from "./MicrosoftTeamsCardChoices";
import MicrosoftTeamsCommands from "./MicrosoftTeamsCommands";
import MicrosoftTeamsReplies from "./MicrosoftTeamsReplies";

/*
 * "page [who] [message]" TYPED TO THE MICROSOFT TEAMS BOT - Slack's
 * `/oneuptime page` (WorkspacePage says what a page from a chat is).
 *
 *   @OneUptime page @Nawaz Dhandala The checkout API is throwing 500s
 *
 * The people the message @mentions, besides the bot, are paged at once when
 * OneUptime can tell them all and there is a message: the bot shows it is
 * working, then the page's card follows in the conversation, edited as it
 * goes. A tag @mentioned that follows on-call schedules pages them -
 * whoever is on call in them now - the same way. Anything else gets the Page someone card - who to page, picked from
 * the project's on-call schedules, people, teams and on-call policies, and
 * the message - with what was typed filled in. Submitted, it pages the same
 * way, as whoever submits it, and the card goes, so it is not sent twice.
 *
 * A person is told apart by their Microsoft Teams account: the OneUptime
 * account it is connected to, or else the member with its email address,
 * which Teams gives for a member of the conversation.
 */

// The fields of the Page someone card.
export const MICROSOFT_TEAMS_PAGE_WHO_FIELD: string = "pageTargets";
export const MICROSOFT_TEAMS_PAGE_MESSAGE_FIELD: string = "pageMessage";

// A choice's kind, as a card with one list says it before its name.
const CHOICE_PREFIXES: Record<WorkspacePageTargetKind, string> = {
  [WorkspacePageTargetKind.Schedule]: "Schedule",
  [WorkspacePageTargetKind.Person]: "Person",
  [WorkspacePageTargetKind.Team]: "Team",
  [WorkspacePageTargetKind.Policy]: "Policy",
};

// A Teams activity's mention tag: <at>Nawaz Dhandala</at>.
const MENTION_OPEN: string = "<at";
const MENTION_CLOSE: string = "</at>";

// The longest message the card's text input takes: an alert's title.
const MAX_MESSAGE_LENGTH: number = 500;

// Bot Framework's typing indicator (ActivityTypes.Typing).
const TYPING_ACTIVITY_TYPE: string = "typing";

export default class MicrosoftTeamsPage {
  public static isPageAction(actionType: string): boolean {
    return actionType === MicrosoftTeamsPageActionType.SubmitPageSomeone;
  }

  /*
   * "page [who] [message]": pages at once, or sends the Page someone card
   * (see the header). The sender acts as the member their account is
   * connected to: somebody not connected is asked to connect, and somebody
   * who may not page is told so.
   */
  @CaptureSpan()
  public static async handleCommand(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
  }): Promise<void> {
    const { turnContext, activity, projectId } = data;

    const props: DatabaseCommonInteractionProps | null =
      await MicrosoftTeamsCommands.authorizeSender({
        turnContext: turnContext,
        activity: activity,
        projectId: projectId,
        does: "page anybody",
        commandName: WorkspaceCommandName.Page,
        connect: {
          purpose: "page someone",
          command: WorkspaceCommandName.Page,
        },
      });

    if (!props || !(await MicrosoftTeamsPage.mayPage(turnContext, props))) {
      return;
    }

    const text: WorkspacePageText = WorkspacePageTextReader.read(
      MicrosoftTeamsPage.getPageTokens(activity),
    );

    const [people, groups]: [WorkspacePagePeople, WorkspacePageGroups] =
      await Promise.all([
        (async (): Promise<WorkspacePagePeople> => {
          return await WorkspacePage.resolvePeople({
            projectId: projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
            candidates: await MicrosoftTeamsPage.getCandidates({
              turnContext: turnContext,
              projectId: projectId,
              people: text.people,
            }),
          });
        })(),
        WorkspacePage.resolveGroups({
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
          groups: text.groups,
          props: props,
        }),
      ]);

    if (
      !WorkspacePage.isReadyToPage({
        text: text,
        people: people,
        groups: groups,
      })
    ) {
      await MicrosoftTeamsPage.sendForm({
        turnContext: turnContext,
        projectId: projectId,
        props: props,
        text: text,
        people: people,
        groups: groups,
      });
      return;
    }

    await MicrosoftTeamsPage.pageAndAnswer({
      turnContext: turnContext,
      activity: activity,
      projectId: projectId,
      props: props,
      targets: WorkspacePage.getTargets({ people: people, groups: groups }),
      message: text.message,
    });
  }

  /*
   * The Page someone card, submitted - as whoever submits it
   * (`databaseProps`, a current member, as the invoke handler reads them).
   * A card left wrong is answered and stays; one that paged goes.
   */
  @CaptureSpan()
  public static async handleSubmit(data: {
    turnContext: TurnContext;
    value: JSONObject;
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { turnContext, value, projectId, databaseProps } = data;

    if (!(await MicrosoftTeamsPage.mayPage(turnContext, databaseProps))) {
      return;
    }

    const picked: Array<string> = MicrosoftTeamsPage.readChoiceSet(
      value[MICROSOFT_TEAMS_PAGE_WHO_FIELD],
    );
    const message: string =
      typeof value[MICROSOFT_TEAMS_PAGE_MESSAGE_FIELD] === "string"
        ? (value[MICROSOFT_TEAMS_PAGE_MESSAGE_FIELD] as string)
        : "";

    const problems: {
      who?: string | undefined;
      message?: string | undefined;
    } | null = WorkspacePage.getFormProblems({
      values: picked,
      message: message,
    });

    if (problems) {
      const said: string = [problems.who, problems.message]
        .filter((problem: string | undefined): problem is string => {
          return Boolean(problem);
        })
        .join(" ");

      await MicrosoftTeamsActionAnswer.reply({
        turnContext: turnContext,
        answer: { markdown: mdText`${said}`.toString(), text: said },
      });
      return;
    }

    const isPaged: boolean = await MicrosoftTeamsPage.pageAndAnswer({
      turnContext: turnContext,
      activity: turnContext.activity as unknown as JSONObject,
      projectId: projectId,
      props: databaseProps,
      targets: WorkspacePage.readTargets(picked),
      message: message,
    });

    // The card that paged goes, so nobody pages with it twice.
    if (isPaged) {
      await MicrosoftTeamsReplies.deleteBestEffort(
        turnContext,
        turnContext.activity.replyToId,
      );
    }
  }

  /*
   * What followed "page" in a message to the bot, as tokens
   * (WorkspacePageText): each person the message @mentions besides the bot,
   * by their mention, and the text around them. Read with indexOf, in time
   * that grows with the message.
   */
  public static getPageTokens(activity: JSONObject): Array<WorkspacePageToken> {
    const text: string =
      typeof activity["text"] === "string" ? (activity["text"] as string) : "";
    const botId: string =
      ((activity["recipient"] as JSONObject | undefined)?.["id"] as string) ||
      "";
    const mentions: Array<JSONObject> = (
      (activity["entities"] as Array<JSONObject> | undefined) || []
    ).filter((entity: JSONObject): boolean => {
      return entity["type"] === "mention";
    });
    const used: Set<number> = new Set<number>();

    const tokens: Array<WorkspacePageToken> = [];

    const addText: (raw: string) => void = (raw: string): void => {
      const plain: string = MicrosoftTeamsPage.decodeEntities(raw);

      if (!plain) {
        return;
      }

      const last: WorkspacePageToken | undefined = tokens[tokens.length - 1];

      if (last && last.kind === "text") {
        last.text += plain;
        return;
      }

      tokens.push({ kind: "text", text: plain });
    };

    let position: number = 0;

    while (position < text.length) {
      const open: number = text.indexOf(MENTION_OPEN, position);

      if (open === -1) {
        break;
      }

      const openEnd: number = text.indexOf(">", open);
      const close: number =
        openEnd === -1 ? -1 : text.indexOf(MENTION_CLOSE, openEnd);

      // A tag that never ends: the rest is text.
      if (openEnd === -1 || close === -1) {
        break;
      }

      const tag: string = text.substring(open, close + MENTION_CLOSE.length);
      const name: string = text.substring(openEnd + 1, close);

      addText(text.substring(position, open));

      const index: number = mentions.findIndex(
        (entity: JSONObject, entityIndex: number): boolean => {
          return !used.has(entityIndex) && entity["text"] === tag;
        },
      );
      const mentioned: JSONObject | undefined =
        index === -1
          ? undefined
          : (mentions[index]!["mentioned"] as JSONObject | undefined);
      const mentionedId: string =
        typeof mentioned?.["id"] === "string"
          ? (mentioned["id"] as string)
          : "";

      if (index !== -1) {
        used.add(index);
      }

      if (mentionedId && mentionedId === botId) {
        // The bot itself: the message is to it, not about it.
      } else if (mentionedId && !MicrosoftTeamsPage.isPersonId(mentionedId)) {
        /*
         * A tag, a channel or a team: a group, with the id Teams mentioned.
         * A tag that follows on-call schedules is paged as them
         * (WorkspacePage.resolveGroups); anything else is named, not paged.
         */
        tokens.push({
          kind: "group",
          name: MicrosoftTeamsPage.decodeEntities(name).trim(),
          workspaceGroupId: mentionedId,
        });
      } else if (mentionedId) {
        tokens.push({
          kind: "person",
          person: {
            workspaceUserId: mentionedId,
            name: MicrosoftTeamsPage.decodeEntities(
              typeof mentioned?.["name"] === "string"
                ? (mentioned["name"] as string)
                : name,
            ).trim(),
          },
        });
      } else {
        addText(name);
      }

      position = close + MENTION_CLOSE.length;
    }

    addText(text.substring(position));

    return MicrosoftTeamsPage.withoutFirstWord(tokens);
  }

  /*
   * The Page someone card: who to page - one list, each choice led by its
   * kind - and the message, with what was typed filled in, and a note for
   * anybody named that it cannot pick. The lists are cut, longest first,
   * until the card fits `budgetInBytes`.
   */
  public static buildFormCard(data: {
    choices: Array<WorkspacePageChoiceGroup>;
    prefill: WorkspacePageFormPrefill;
    budgetInBytes: number;
  }): JSONObject {
    const lists: Record<string, MicrosoftTeamsCardChoiceList> = {};
    const keys: Array<string> = [];

    for (const group of data.choices) {
      keys.push(group.kind);
      lists[group.kind] = {
        choices: group.choices.map(
          (choice: WorkspacePageChoice): MicrosoftTeamsCardChoice => {
            return {
              title: `${CHOICE_PREFIXES[group.kind]} · ${choice.label}`,
              value: choice.value,
            };
          },
        ),
        totalCount: group.choices.length,
      };
    }

    return MicrosoftTeamsCardChoices.fitCardToBudget<string>({
      lists: lists,
      trimmableKeys: keys,
      budgetInBytes: data.budgetInBytes,
      buildCard: (
        shown: Record<string, MicrosoftTeamsCardChoiceList>,
      ): JSONObject => {
        const choices: Array<MicrosoftTeamsCardChoice> = keys.flatMap(
          (key: string): Array<MicrosoftTeamsCardChoice> => {
            return shown[key]?.choices || [];
          },
        );
        const values: Array<string> = data.prefill.values.filter(
          (value: string): boolean => {
            return choices.some((choice: MicrosoftTeamsCardChoice) => {
              return choice.value === value;
            });
          },
        );

        const body: Array<JSONObject> = [
          {
            type: "TextBlock",
            text: WORKSPACE_PAGE_FORM_TEXT.title,
            size: "Large",
            weight: "Bolder",
          },
        ];

        /*
         * In the card's own text colour: Teams draws "Warning" text as
         * yellow (#f8d22a) on its white light theme, which cannot be read.
         * The emoji says it is a warning. A note names what the message
         * named - a tag, a person - so it is placed as text, as Slack's are.
         */
        for (const note of data.prefill.notes) {
          body.push({
            type: "TextBlock",
            text: mdText`⚠️ ${note}`.toString(),
            wrap: true,
          });
        }

        body.push({
          type: "Input.ChoiceSet",
          id: MICROSOFT_TEAMS_PAGE_WHO_FIELD,
          label: WORKSPACE_PAGE_FORM_TEXT.whoLabel,
          placeholder: WORKSPACE_PAGE_FORM_TEXT.whoPlaceholder,
          style: "compact",
          isMultiSelect: true,
          isRequired: true,
          errorMessage: WORKSPACE_PAGE_FORM_TEXT.pickWho,
          choices: choices,
          ...(values.length > 0 ? { value: values.join(",") } : {}),
        });

        body.push(
          MicrosoftTeamsCardChoices.buildNoteElement(
            WORKSPACE_PAGE_FORM_TEXT.whoHint,
          ),
        );

        /*
         * What the list leaves out - to fit the card, or the people past
         * the hundred a list holds - said under the list itself.
         */
        const leftOut: number =
          keys.reduce((count: number, key: string) => {
            return (
              count +
              (lists[key]!.choices.length - (shown[key]?.choices.length || 0))
            );
          }, 0) +
          data.choices.reduce(
            (count: number, group: WorkspacePageChoiceGroup): number => {
              return count + (group.notShownCount || 0);
            },
            0,
          );

        if (leftOut > 0) {
          body.push(
            MicrosoftTeamsCardChoices.buildNoteElement(
              `${leftOut} more ${leftOut === 1 ? "choice" : "choices"} could not fit on this card. @mention a person to page them at once.`,
            ),
          );
        }

        body.push({
          type: "Input.Text",
          id: MICROSOFT_TEAMS_PAGE_MESSAGE_FIELD,
          label: WORKSPACE_PAGE_FORM_TEXT.messageLabel,
          placeholder: WORKSPACE_PAGE_FORM_TEXT.messagePlaceholder,
          isMultiline: true,
          isRequired: true,
          errorMessage: WORKSPACE_PAGE_FORM_TEXT.writeMessage,
          maxLength: MAX_MESSAGE_LENGTH,
          ...(data.prefill.message
            ? { value: data.prefill.message.substring(0, MAX_MESSAGE_LENGTH) }
            : {}),
        });

        body.push(
          MicrosoftTeamsCardChoices.buildNoteElement(
            WORKSPACE_PAGE_FORM_TEXT.messageHint,
          ),
        );

        return {
          type: "AdaptiveCard",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          version: "1.5",
          body: body,
          actions: [
            {
              type: "Action.Submit",
              title: WORKSPACE_PAGE_FORM_TEXT.submit,
              style: "positive",
              data: {
                action: MicrosoftTeamsPageActionType.SubmitPageSomeone,
              },
            },
          ],
        };
      },
    }).card;
  }

  /*
   * The people a message @mentioned, with what Teams can tell of each: the
   * OneUptime account their Microsoft Teams account is connected to in the
   * project, or else the email address Teams has for them - asked of the
   * conversation's members, as the bot is in it.
   */
  public static async getCandidates(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    people: Array<WorkspacePagePerson>;
  }): Promise<Array<WorkspacePageCandidate>> {
    if (data.people.length === 0) {
      return [];
    }

    const members: Array<TeamsChannelAccount | null> = await Promise.all(
      data.people.map(
        async (
          person: WorkspacePagePerson,
        ): Promise<TeamsChannelAccount | null> => {
          try {
            return await TeamsInfo.getMember(
              data.turnContext,
              person.workspaceUserId,
            );
          } catch (err) {
            logger.debug(
              "Microsoft Teams did not tell who a mentioned person is.",
              {
                projectId: data.projectId.toString(),
              },
            );
            logger.debug(err);
            return null;
          }
        },
      ),
    );

    const aadObjectIds: Array<string> = members
      .map((member: TeamsChannelAccount | null): string => {
        return member?.aadObjectId || "";
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      });

    const connected: Array<WorkspaceUserAuthToken> =
      aadObjectIds.length > 0
        ? await WorkspaceUserAuthTokenService.findBy({
            query: {
              projectId: data.projectId,
              workspaceType: WorkspaceType.MicrosoftTeams,
              workspaceUserId: QueryHelper.any(aadObjectIds),
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
          })
        : [];

    return data.people.map(
      (person: WorkspacePagePerson, index: number): WorkspacePageCandidate => {
        const member: TeamsChannelAccount | null = members[index] || null;
        const connection: WorkspaceUserAuthToken | undefined = connected.find(
          (token: WorkspaceUserAuthToken): boolean => {
            return (
              Boolean(member?.aadObjectId) &&
              token.workspaceUserId === member?.aadObjectId
            );
          },
        );

        if (connection?.userId) {
          return { person: person, connectedUserId: connection.userId };
        }

        const email: string = (
          member?.email ||
          member?.userPrincipalName ||
          ""
        ).trim();

        return {
          person: person,
          ...(email ? { email: email } : {}),
          ...(member?.name ? { chatName: member.name } : {}),
        };
      },
    );
  }

  /*
   * Where a message to the bot was sent, for the page to be shown there: a
   * chat, or a team's channel - with the team's Graph id, which a post to a
   * channel names its team by.
   */
  public static async getPlace(data: {
    turnContext: TurnContext;
    activity: JSONObject;
  }): Promise<WorkspacePagePlace | undefined> {
    const conversation: JSONObject =
      (data.activity["conversation"] as JSONObject | undefined) || {};
    const channelData: JSONObject =
      (data.activity["channelData"] as JSONObject | undefined) || {};
    const conversationType: string =
      (conversation["conversationType"] as string) || "";

    if (conversationType === "personal" || conversationType === "groupChat") {
      const chatId: string = (conversation["id"] as string) || "";

      return chatId
        ? {
            workspaceType: WorkspaceType.MicrosoftTeams,
            destinationType: WorkspaceLiveMessageDestinationType.Chat,
            channelId: chatId,
          }
        : undefined;
    }

    const channel: JSONObject | undefined = channelData["channel"] as
      | JSONObject
      | undefined;
    const channelId: string = (channel?.["id"] as string) || "";

    if (!channelId) {
      return undefined;
    }

    const teamId: string | undefined =
      await MicrosoftTeamsUtil.resolveGraphTeamIdFromBotActivity({
        team: channelData["team"] as JSONObject | undefined,
        turnContext: data.turnContext,
      });

    if (!teamId) {
      return undefined;
    }

    return {
      workspaceType: WorkspaceType.MicrosoftTeams,
      destinationType: WorkspaceLiveMessageDestinationType.Channel,
      channelId: channelId,
      teamId: teamId,
      ...(typeof channel?.["name"] === "string"
        ? { channelName: channel["name"] as string }
        : {}),
    };
  }

  /*
   * Whether the member may page; told why not, in the conversation, when
   * they may not.
   */
  private static async mayPage(
    turnContext: TurnContext,
    props: DatabaseCommonInteractionProps,
  ): Promise<boolean> {
    try {
      await WorkspacePage.assertMayPage(props);
      return true;
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        throw err;
      }

      // Placed as text: a refusal can name a permission or a role.
      await MicrosoftTeamsActionAnswer.reply({
        turnContext: turnContext,
        answer: {
          markdown: mdText`${err.message}`.toString(),
          text: err.message,
        },
      });

      return false;
    }
  }

  /*
   * Pages as the member, shows the page in the conversation, and tells them
   * what it does not show (WorkspacePage.page). A refusal or a page that
   * names nobody pageable is told to them. Whether anybody was paged.
   */
  private static async pageAndAnswer(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    targets: OnCallPageTargets;
    message: string;
  }): Promise<boolean> {
    // Paging takes a moment: Teams shows the bot is on it ("typing").
    await MicrosoftTeamsReplies.sendBestEffort(data.turnContext, {
      type: TYPING_ACTIVITY_TYPE,
    });

    let outcome: WorkspacePageOutcome;

    try {
      outcome = await WorkspacePage.page({
        projectId: data.projectId,
        props: data.props,
        workspaceType: WorkspaceType.MicrosoftTeams,
        targets: data.targets,
        message: data.message.substring(0, MAX_MESSAGE_LENGTH),
        place: await MicrosoftTeamsPage.getPlace({
          turnContext: data.turnContext,
          activity: data.activity,
        }),
      });
    } catch (err) {
      if (
        err instanceof NotAuthorizedException ||
        err instanceof BadDataException ||
        err instanceof PaymentRequiredException
      ) {
        const message: string = `Could not page: ${err.message}`;

        await MicrosoftTeamsActionAnswer.reply({
          turnContext: data.turnContext,
          answer: {
            markdown: mdText`${message}`.toString(),
            text: message,
          },
        });

        return false;
      }

      throw err;
    }

    if (outcome.answer) {
      await MicrosoftTeamsActionAnswer.reply({
        turnContext: data.turnContext,
        answer: outcome.answer,
      });
    }

    return true;
  }

  // Sends the Page someone card, with what was typed filled in.
  private static async sendForm(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    text: WorkspacePageText;
    people: WorkspacePagePeople;
    groups: WorkspacePageGroups;
  }): Promise<void> {
    let choices: Array<WorkspacePageChoiceGroup>;

    try {
      choices = await WorkspacePage.getChoices({
        projectId: data.projectId,
        props: data.props,
      });
    } catch (error) {
      MicrosoftTeamsReplies.logFailure(
        "Could not read what the Microsoft Teams Page someone card offers",
        error,
        { projectId: data.projectId.toString() },
      );

      await MicrosoftTeamsPage.replyText(
        data.turnContext,
        `Sorry, I couldn't open the form to page someone because ${ProductBrandingText.getProductName()} could not load the lists it needs just now. Please try again in a minute.`,
      );
      return;
    }

    if (choices.length === 0) {
      await MicrosoftTeamsPage.replyText(
        data.turnContext,
        "There is nobody you can page in this project yet: no on-call schedules, people, teams or on-call policies are available to you.",
      );
      return;
    }

    const prefill: WorkspacePageFormPrefill = WorkspacePage.getPrefill({
      text: data.text,
      people: data.people,
      groups: data.groups,
      choices: choices,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    try {
      await MicrosoftTeamsReplies.sendCardWithinSizeLimit({
        turnContext: data.turnContext,
        // What the chat list and a notification show of the card.
        summary: WORKSPACE_PAGE_FORM_TEXT.title,
        buildCard: (budgetInBytes: number): JSONObject => {
          return MicrosoftTeamsPage.buildFormCard({
            choices: choices,
            prefill: prefill,
            budgetInBytes: budgetInBytes,
          });
        },
      });
    } catch (error) {
      MicrosoftTeamsReplies.logFailure(
        "Microsoft Teams did not accept the Page someone card",
        error,
        { projectId: data.projectId.toString() },
      );

      await MicrosoftTeamsPage.replyText(
        data.turnContext,
        "Sorry, Microsoft Teams did not accept the form to page someone. @mention the people to page them at once.",
      );
    }
  }

  // An answer that is plain text, mentioning whoever it is for.
  private static async replyText(
    turnContext: TurnContext,
    text: string,
  ): Promise<void> {
    const answer: WorkspaceAnswer = {
      markdown: mdText`${text}`.toString(),
      text: text,
    };

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: turnContext,
      answer: answer,
    });
  }

  // A card's multi-select: its picks, which Teams sends as "a,b,c".
  private static readChoiceSet(value: unknown): Array<string> {
    if (Array.isArray(value)) {
      return value
        .map((item: unknown): string => {
          return typeof item === "string" ? item.trim() : "";
        })
        .filter((item: string): boolean => {
          return item.length > 0;
        });
    }

    if (typeof value !== "string") {
      return [];
    }

    return value
      .split(",")
      .map((item: string): string => {
        return item.trim();
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      });
  }

  /*
   * Whether a mention's id is a person's: Teams' "29:..." (and an
   * "8:orgid:..." user); a tag, a channel or a team has another kind.
   */
  private static isPersonId(id: string): boolean {
    return id.startsWith("29:") || id.startsWith("8:");
  }

  /*
   * The tokens without the first word of their text - "page" - and a
   * leading run of white space.
   */
  private static withoutFirstWord(
    tokens: Array<WorkspacePageToken>,
  ): Array<WorkspacePageToken> {
    const first: WorkspacePageToken | undefined = tokens[0];

    if (!first || first.kind !== "text") {
      return tokens;
    }

    const text: string = first.text.trimStart();
    let end: number = 0;

    while (end < text.length && !MicrosoftTeamsPage.isSpace(text[end]!)) {
      end++;
    }

    const rest: string = text.substring(end);

    return rest
      ? [{ kind: "text", text: rest }, ...tokens.slice(1)]
      : tokens.slice(1);
  }

  private static isSpace(character: string): boolean {
    return (
      character === " " ||
      character === "\n" ||
      character === "\t" ||
      character === "\r"
    );
  }

  /*
   * Text as typed, from a message's text as Teams sends it: the five
   * character references a message can carry, and a no-break space.
   */
  private static decodeEntities(text: string): string {
    return text
      .split("&nbsp;")
      .join(" ")
      .split("&lt;")
      .join("<")
      .split("&gt;")
      .join(">")
      .split("&quot;")
      .join('"')
      .split("&#39;")
      .join("'")
      .split("&amp;")
      .join("&");
  }
}
