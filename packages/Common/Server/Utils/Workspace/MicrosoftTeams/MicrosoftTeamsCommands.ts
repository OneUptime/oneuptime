import { TurnContext } from "botbuilder";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import URL from "../../../../Types/API/URL";
import DatabaseConfig from "../../../DatabaseConfig";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "../WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceCommands, {
  WORKSPACE_COMMANDS,
  WorkspaceCommandDefinition,
  WorkspaceCommandMisspelling,
  WorkspaceCommandName,
  WorkspaceExtraCommand,
} from "../WorkspaceCommands";
import WorkspaceOnCallNow from "../WorkspaceOnCallNow";
import WorkspaceOpenRecords from "../WorkspaceOpenRecords";
import WorkspaceOpenRecordKind from "../../../../Types/Workspace/WorkspaceOpenRecordKind";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "./Actions/Auth";
import MicrosoftTeamsActionAnswer, {
  MicrosoftTeamsAnswerLink,
} from "./MicrosoftTeamsActionAnswer";
import MicrosoftTeamsConnectPrompt from "./MicrosoftTeamsConnectPrompt";
import MicrosoftTeamsReplies from "./MicrosoftTeamsReplies";

/*
 * THE WORDS TYPED TO THE MICROSOFT TEAMS BOT.
 *
 * Teams has no slash commands, so OneUptime's commands are words typed to
 * the bot - in a personal chat, or after @OneUptime in a channel or a group
 * chat - and they are Slack's words after /oneuptime (WorkspaceCommands):
 * "incident Checkout is down", "maintenance", "oncall", "ask ...", "help".
 * Teams has four commands of its own besides, which list what is open
 * (MicrosoftTeamsListCommand). Anything else is a question for OneUptime AI.
 *
 * Every answer is a reply in the conversation that mentions whoever typed
 * the command (MicrosoftTeamsActionAnswer). The forms and who is on call act
 * as the OneUptime member the Teams account is connected to: somebody not
 * connected is asked to connect, with a Connect button, and to type the
 * command again (authorizeSender).
 */

// Microsoft Teams' own commands: lists of what is open.
export enum MicrosoftTeamsListCommand {
  ActiveIncidents = "show active incidents",
  ActiveAlerts = "show active alerts",
  ScheduledMaintenance = "show scheduled maintenance",
  OngoingMaintenance = "show ongoing maintenance",
}

// Each list command, and the shorter way to type it.
const LIST_COMMAND_SPELLINGS: ReadonlyArray<{
  command: MicrosoftTeamsListCommand;
  spellings: ReadonlyArray<string>;
  // What it does, completing "<command>: ...".
  summary: string;
  // What it lists (WorkspaceOpenRecords).
  kind: WorkspaceOpenRecordKind;
  /*
   * What somebody not connected is asked to connect for, completing
   * "Connect your Microsoft Teams account to ...".
   */
  purpose: string;
  // What a read that failed says, completing "Sorry, I couldn't ... just now."
  reads: string;
}> = [
  {
    command: MicrosoftTeamsListCommand.ActiveIncidents,
    spellings: ["show active incidents", "active incidents"],
    summary: "list the incidents that are open right now",
    kind: WorkspaceOpenRecordKind.Incidents,
    purpose: "see the open incidents",
    reads: "read the open incidents",
  },
  {
    command: MicrosoftTeamsListCommand.ActiveAlerts,
    spellings: ["show active alerts", "active alerts"],
    summary: "list the alerts that are open right now",
    kind: WorkspaceOpenRecordKind.Alerts,
    purpose: "see the open alerts",
    reads: "read the open alerts",
  },
  {
    command: MicrosoftTeamsListCommand.ScheduledMaintenance,
    spellings: ["show scheduled maintenance", "scheduled maintenance"],
    summary: "list the scheduled maintenance events still to come",
    kind: WorkspaceOpenRecordKind.UpcomingMaintenance,
    purpose: "see the scheduled maintenance coming up",
    reads: "read the scheduled maintenance coming up",
  },
  {
    command: MicrosoftTeamsListCommand.OngoingMaintenance,
    spellings: ["show ongoing maintenance", "ongoing maintenance"],
    summary: "list the maintenance events in progress",
    kind: WorkspaceOpenRecordKind.OngoingMaintenance,
    purpose: "see the maintenance in progress",
    reads: "read the maintenance in progress",
  },
];

/*
 * The list commands as the help names them: two lines, each two commands
 * that do alike.
 */
export const MICROSOFT_TEAMS_LIST_COMMANDS_IN_HELP: ReadonlyArray<WorkspaceExtraCommand> =
  [
    {
      usages: [
        MicrosoftTeamsListCommand.ActiveIncidents,
        MicrosoftTeamsListCommand.ActiveAlerts,
      ],
      summary: "list what is open right now",
    },
    {
      usages: [
        MicrosoftTeamsListCommand.ScheduledMaintenance,
        MicrosoftTeamsListCommand.OngoingMaintenance,
      ],
      summary: "list upcoming and ongoing maintenance",
    },
  ];

// The longest description Teams takes in a manifest command (commandLists).
export const MICROSOFT_TEAMS_MANIFEST_COMMAND_DESCRIPTION_MAX_LENGTH: number = 128;

/*
 * The Microsoft Teams guide in the installation's own docs, and the two
 * sections of it the help links to: how to connect, and the commands.
 */
export const MICROSOFT_TEAMS_GUIDE_PATH: string =
  "/docs/workspace-connections/microsoft-teams";
const MICROSOFT_TEAMS_GUIDE_CONNECT_ANCHOR: string = "connect-microsoft-teams";
const MICROSOFT_TEAMS_GUIDE_COMMANDS_ANCHOR: string =
  "talking-to-the-oneuptime-bot";

// What the bot is told a command needs: who sent it, connected and a member.
export interface MicrosoftTeamsCommandSenderCheck {
  turnContext: TurnContext;
  activity: JSONObject;
  projectId: ObjectID;
  /*
   * What the command does, completing "so I can't ...": "open the form to
   * create an incident", "show who is on call".
   */
  does: string;
  // The command, for the log: "create", "oncall".
  commandName: string;
  /*
   * What a sender without a connected account is asked to connect for -
   * "declare an incident" - and the command they type again ("incident").
   */
  connect: {
    purpose: string;
    command: string;
  };
  // A kind of record the sender must also be allowed to create.
  createPermission?:
    | {
        modelType: DatabaseBaseModelType;
        action: string;
      }
    | undefined;
}

// What follows a command that opens a form (WORKSPACE_COMMANDS).
const TITLE_ARGUMENT: string = "title";
const TITLE_OR_NUMBER_ARGUMENT: string = "title or number";

// A word, as a sentence says one: "a create command", "an oncall command".
const STARTS_WITH_VOWEL: RegExp = /^[aeiou]/i;

export default class MicrosoftTeamsCommands {
  /*
   * The list command typed, exactly - "show active incidents" or "active
   * incidents" - or null: "show active incidents in eu-west-1" is a
   * question. `cleanText` is the message in lower case, without the
   * @mention.
   */
  public static getListCommand(
    cleanText: string,
  ): MicrosoftTeamsListCommand | null {
    const text: string = cleanText.trim().toLowerCase();

    for (const entry of LIST_COMMAND_SPELLINGS) {
      if (entry.spellings.includes(text)) {
        return entry.command;
      }
    }

    return null;
  }

  /*
   * The bot's commands as the Teams app manifest lists them (commandLists):
   * what Teams suggests once somebody types "@OneUptime". A title is what
   * Teams puts in the message when it is picked, so it is the command
   * alone; the description says what it does, and what to type after it.
   * Teams takes ten at most.
   */
  public static getManifestCommands(): Array<JSONObject> {
    const commands: Array<JSONObject> = [];

    for (const definition of WORKSPACE_COMMANDS) {
      if (definition.name === WorkspaceCommandName.Help) {
        for (const entry of LIST_COMMAND_SPELLINGS) {
          commands.push({
            title: entry.command,
            description: MicrosoftTeamsCommands.toManifestDescription([
              MicrosoftTeamsCommands.toSentence(entry.summary),
            ]),
          });
        }
      }

      commands.push({
        title: definition.name,
        description: MicrosoftTeamsCommands.getManifestDescription(definition),
      });
    }

    return commands;
  }

  /*
   * The commands, as a reply that mentions whoever asked. A channel's
   * readers reach the bot by @mentioning it, so the help names it as Teams
   * shows it: the name the message was sent to.
   *
   * The help works before the organization is connected to any project
   * (`isConnected` false) - it reads nothing in one - and then says how to
   * get started instead of where to learn more. Microsoft's store requires
   * the help to say what the app is for and to lead somewhere, connected or
   * not: it refused the app while "help" sent to an organization not
   * connected yet was answered "Sorry, I couldn't find your project
   * configuration".
   */
  @CaptureSpan()
  public static async replyHelp(data: {
    turnContext: TurnContext;
    // The sender's organization is connected to a project, or to several.
    isConnected?: boolean | undefined;
  }): Promise<void> {
    const isConnected: boolean = data.isConnected !== false;

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: MicrosoftTeamsCommands.getHelpAnswer(
        MicrosoftTeamsCommands.getBotName(data.turnContext),
        { isConnected: isConnected },
      ),
      links: await MicrosoftTeamsCommands.getHelpLinks({
        isConnected: isConnected,
      }),
    });
  }

  /*
   * Text that started with a command misspelt: the command it looks like,
   * and how to ask AI instead (WorkspaceCommands.getMisspellingAnswer), as
   * a reply that mentions whoever typed it.
   */
  @CaptureSpan()
  public static async replyMisspelling(data: {
    turnContext: TurnContext;
    misspelt: WorkspaceCommandMisspelling;
  }): Promise<void> {
    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: MicrosoftTeamsCommands.getMisspellingAnswer(data.misspelt),
    });
  }

  /*
   * The help, as Microsoft Teams shows it (WorkspaceCommands.getHelpAnswer):
   * what the app is for, the commands, and the way forward - how to get
   * started in an organization not connected yet, or else that each person
   * connects their own account. `botName` is the name to @mention the bot by.
   */
  public static getHelpAnswer(
    botName?: string | undefined,
    options?: { isConnected?: boolean | undefined } | undefined,
  ): WorkspaceAnswer {
    const productName: string = ProductBrandingText.getProductName();

    return WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      extraCommands: [...MICROSOFT_TEAMS_LIST_COMMANDS_IN_HELP],
      botName: botName,
      before: [
        mdText`**${productName}** is an observability and incident management platform. In Microsoft Teams, I post your project's incidents, alerts and scheduled maintenance to the channels and chats you pick, and your team acts on them right here.`,
      ],
      after: [
        options?.isConnected === false
          ? mdText`**To get started,** a project admin connects your organization in ${productName}, under **Project Settings → Workspace → Microsoft Teams**. Then everyone connects their own Microsoft Teams account the first time they use a command.`
          : mdText`The first time you use a command, I ask you to connect your Microsoft Teams account to ${productName}, so that I act as you, with your permissions.`,
      ],
    });
  }

  /*
   * The help's buttons: where to go next, on this installation - never
   * OneUptime Cloud's address. Before the organization is connected, the
   * guide's "Connect Microsoft Teams" steps and the sign-up page (unless
   * the installation takes no sign-ups); once it is, the guide's commands
   * and the product. A link whose address cannot be read is left out.
   */
  public static async getHelpLinks(data: {
    isConnected: boolean;
  }): Promise<Array<MicrosoftTeamsAnswerLink>> {
    const productName: string = ProductBrandingText.getProductName();
    const links: Array<MicrosoftTeamsAnswerLink> = [];

    try {
      const guide: URL = (await DatabaseConfig.getHomeUrl()).addRoute(
        MICROSOFT_TEAMS_GUIDE_PATH,
      );

      links.push({
        title: data.isConnected ? "Learn more" : "Get started",
        url: URL.fromString(
          `${guide.toString()}#${
            data.isConnected
              ? MICROSOFT_TEAMS_GUIDE_COMMANDS_ANCHOR
              : MICROSOFT_TEAMS_GUIDE_CONNECT_ANCHOR
          }`,
        ),
      });

      if (data.isConnected) {
        links.push({
          title: `Open ${productName}`,
          url: await DatabaseConfig.getDashboardUrl(),
        });
      } else if (!(await DatabaseConfig.shouldDisableSignup())) {
        links.push({
          title: "Sign up",
          url: (await DatabaseConfig.getAccountsUrl()).addRoute("/register"),
        });
      }
    } catch (err) {
      logger.debug("No address for a link of the Microsoft Teams help.");
      logger.debug(err);
    }

    return links;
  }

  // A misspelt command's answer, as Microsoft Teams shows it.
  public static getMisspellingAnswer(
    misspelt: WorkspaceCommandMisspelling,
  ): WorkspaceAnswer {
    return WorkspaceCommands.getMisspellingAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      misspelt: misspelt,
    });
  }

  /*
   * The help's list of commands, as Markdown a card shows: the bot's
   * welcome card lists the same lines as the help.
   */
  public static getCommandListMarkdown(): string {
    return FeedMarkdown.join(
      WorkspaceCommands.getCommandListLines({
        workspaceType: WorkspaceType.MicrosoftTeams,
        extraCommands: [...MICROSOFT_TEAMS_LIST_COMMANDS_IN_HELP],
      }),
      "\n",
    ).toString();
  }

  /*
   * The bot's name as Microsoft Teams shows it - what people @mention it
   * by - from the message it answers; empty when the message names none.
   */
  public static getBotName(turnContext: TurnContext): string {
    const name: unknown = (
      turnContext.activity?.recipient as { name?: unknown } | undefined
    )?.name;

    return typeof name === "string"
      ? MicrosoftTeamsActionAnswer.getMentionName(name)
      : "";
  }

  /*
   * "oncall": who is on call right now in each on-call schedule the sender
   * may read (WorkspaceOnCallNow), as a reply that mentions them - a card,
   * so each moment reads in each reader's own time.
   */
  @CaptureSpan()
  public static async handleOnCallCommand(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
  }): Promise<void> {
    const props: DatabaseCommonInteractionProps | null =
      await MicrosoftTeamsCommands.authorizeSender({
        turnContext: data.turnContext,
        activity: data.activity,
        projectId: data.projectId,
        does: "show who is on call",
        commandName: WorkspaceCommandName.OnCall,
        connect: {
          purpose: "see who is on call",
          command: WorkspaceCommandName.OnCall,
        },
      });

    if (!props) {
      return;
    }

    let answer: WorkspaceAnswer;

    try {
      answer = await WorkspaceOnCallNow.getOnCallNowAnswer({
        projectId: data.projectId,
        props: props,
      });
    } catch (error) {
      MicrosoftTeamsReplies.logFailure(
        "Could not read who is on call for a Microsoft Teams command",
        error,
        {
          projectId: data.projectId.toString(),
        },
      );

      const message: string =
        "Sorry, I couldn't read who is on call just now. Please try again in a minute.";

      answer = {
        markdown: mdText`${message}`.toString(),
        text: message,
      };
    }

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: answer,
    });
  }

  /*
   * One of Teams' own lists ("show active incidents"): what is open, as the
   * sender may see it (WorkspaceOpenRecords), as a reply that mentions them.
   * The lists read as the member the sender's account is connected to, as
   * oncall and the forms do: somebody not connected is asked to connect,
   * and somebody who may not read the records is told so - nobody else in
   * the Microsoft 365 organization reads the project's records through
   * the bot.
   */
  @CaptureSpan()
  public static async handleListCommand(data: {
    turnContext: TurnContext;
    activity: JSONObject;
    projectId: ObjectID;
    listCommand: MicrosoftTeamsListCommand;
  }): Promise<void> {
    const entry: (typeof LIST_COMMAND_SPELLINGS)[number] | undefined =
      LIST_COMMAND_SPELLINGS.find(
        (candidate: (typeof LIST_COMMAND_SPELLINGS)[number]): boolean => {
          return candidate.command === data.listCommand;
        },
      );

    if (!entry) {
      return;
    }

    const props: DatabaseCommonInteractionProps | null =
      await MicrosoftTeamsCommands.authorizeSender({
        turnContext: data.turnContext,
        activity: data.activity,
        projectId: data.projectId,
        does: entry.summary,
        commandName: entry.command,
        connect: {
          purpose: entry.purpose,
          command: entry.command,
        },
      });

    if (!props) {
      return;
    }

    let answer: WorkspaceAnswer;

    try {
      answer = await WorkspaceOpenRecords.getListAnswer({
        kind: entry.kind,
        projectId: data.projectId,
        props: props,
      });
    } catch (error) {
      MicrosoftTeamsReplies.logFailure(
        `Could not read the list for a Microsoft Teams "${entry.command}" command`,
        error,
        {
          projectId: data.projectId.toString(),
        },
      );

      const message: string = `Sorry, I couldn't ${entry.reads} just now. Please try again in a minute.`;

      answer = {
        markdown: mdText`${message}`.toString(),
        text: message,
      };
    }

    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: answer,
    });
  }

  /*
   * The sender's own props when they may run the command: a connected
   * account of a current member - who may create the thing, when the
   * command creates one. Otherwise the sender is told why (no connected
   * account, not a project member, no permission) and this returns null.
   */
  @CaptureSpan()
  public static async authorizeSender(
    data: MicrosoftTeamsCommandSenderCheck,
  ): Promise<DatabaseCommonInteractionProps | null> {
    const { turnContext, activity, projectId } = data;

    const teamsUserId: string =
      ((activity["from"] as JSONObject | undefined)?.["aadObjectId"] as
        | string
        | undefined) || "";

    const command: string = `${STARTS_WITH_VOWEL.test(data.commandName) ? "an" : "a"} ${data.commandName} command`;

    if (!teamsUserId) {
      logger.warn(
        `A Microsoft Teams ${data.commandName} command arrived without the sender's AAD object id`,
        {
          projectId: projectId.toString(),
        },
      );
      await MicrosoftTeamsReplies.sendBestEffort(
        turnContext,
        mdText`Sorry, I couldn't tell who sent this message, so I can't ${data.does}. Please try again.`.toString(),
      );
      return null;
    }

    try {
      const userId: ObjectID =
        await MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId({
          teamsUserId: teamsUserId,
          projectId: projectId,
        });

      const props: DatabaseCommonInteractionProps =
        await WorkspaceActionAuthorization.getProjectMemberProps({
          userId: userId,
          projectId: projectId,
        });

      if (data.createPermission) {
        await WorkspaceActionAuthorization.assertCanCreate({
          props: props,
          modelType: data.createPermission.modelType,
          action: data.createPermission.action,
        });
      }

      return props;
    } catch (error) {
      /*
       * Not connected: asked to connect, mentioning the sender, with a
       * Connect button - and to type the command again once they have.
       */
      if (error instanceof MicrosoftTeamsAccountNotLinkedException) {
        await MicrosoftTeamsConnectPrompt.prompt({
          turnContext: turnContext,
          projectId: projectId,
          description: MicrosoftTeamsConnectPrompt.describeCommand({
            purpose: data.connect.purpose,
            command: data.connect.command,
          }),
        });
        return null;
      }

      // Placed as text: a refusal can name a label, a record or a person.
      if (error instanceof NotAuthorizedException) {
        await MicrosoftTeamsActionAnswer.reply({
          turnContext: turnContext,
          answer: {
            markdown: mdText`${error.message}`.toString(),
            text: error.message,
          },
        });
        return null;
      }

      MicrosoftTeamsReplies.logFailure(
        `Could not check the Microsoft Teams sender of ${command}`,
        error,
        {
          projectId: projectId.toString(),
        },
      );
      await MicrosoftTeamsReplies.sendBestEffort(
        turnContext,
        mdText`Sorry, I couldn't ${data.does} because ${ProductBrandingText.getProductName()} could not check your account just now. Please try again in a minute.`.toString(),
      );
      return null;
    }
  }

  /*
   * "Declare an incident. Type a title after it.": what a command does, and
   * what the title Teams puts in the message cannot show - that a title may
   * follow it, to fill in the form. A question after "ask" goes without
   * saying.
   */
  private static getManifestDescription(
    definition: WorkspaceCommandDefinition,
  ): string {
    const sentence: string = MicrosoftTeamsCommands.toSentence(
      WorkspaceCommands.getSummary(definition.name),
    );
    const hint: string = MicrosoftTeamsCommands.getManifestHint(definition);

    return MicrosoftTeamsCommands.toManifestDescription(
      hint ? [`${sentence} ${hint}`, sentence] : [sentence],
    );
  }

  /*
   * What to type after a command, which the title Teams puts in the message
   * cannot show: a form's title, or who to page and why. Empty for a
   * command that needs nothing after it.
   */
  private static getManifestHint(
    definition: WorkspaceCommandDefinition,
  ): string {
    if (definition.argument === TITLE_ARGUMENT) {
      return "Type a title after it.";
    }

    // "incident": a title declares one; a number shows that incident.
    if (definition.argument === TITLE_OR_NUMBER_ARGUMENT) {
      return "Type a title or an incident's number after it.";
    }

    if (definition.name === WorkspaceCommandName.Page) {
      return "Mention who, then type a message.";
    }

    return "";
  }

  /*
   * The first of the descriptions, longest first, that Teams takes (128
   * characters): a long product name can push the longer one past it. The
   * last is cut when even it is too long.
   */
  private static toManifestDescription(descriptions: Array<string>): string {
    for (const description of descriptions) {
      if (
        description.length <=
        MICROSOFT_TEAMS_MANIFEST_COMMAND_DESCRIPTION_MAX_LENGTH
      ) {
        return description;
      }
    }

    const last: string = descriptions[descriptions.length - 1] || "";

    return `${last
      .substring(0, MICROSOFT_TEAMS_MANIFEST_COMMAND_DESCRIPTION_MAX_LENGTH - 1)
      .trimEnd()}…`;
  }

  // "Declare an incident.": a summary as a sentence of its own.
  private static toSentence(summary: string): string {
    const sentence: string =
      summary.charAt(0).toUpperCase() + summary.substring(1);

    return sentence.endsWith(".") ? sentence : `${sentence}.`;
  }
}
