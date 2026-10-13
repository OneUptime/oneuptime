import { TurnContext } from "botbuilder";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "../WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceCommands, {
  WORKSPACE_COMMANDS,
  WorkspaceCommandMisspelling,
  WorkspaceCommandName,
  WorkspaceExtraCommand,
} from "../WorkspaceCommands";
import WorkspaceOnCallNow from "../WorkspaceOnCallNow";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "./Actions/Auth";
import MicrosoftTeamsActionAnswer from "./MicrosoftTeamsActionAnswer";
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
}> = [
  {
    command: MicrosoftTeamsListCommand.ActiveIncidents,
    spellings: ["show active incidents", "active incidents"],
    summary: "list the incidents that are open right now",
  },
  {
    command: MicrosoftTeamsListCommand.ActiveAlerts,
    spellings: ["show active alerts", "active alerts"],
    summary: "list the alerts that are open right now",
  },
  {
    command: MicrosoftTeamsListCommand.ScheduledMaintenance,
    spellings: ["show scheduled maintenance", "scheduled maintenance"],
    summary: "list the scheduled maintenance events still to come",
  },
  {
    command: MicrosoftTeamsListCommand.OngoingMaintenance,
    spellings: ["show ongoing maintenance", "ongoing maintenance"],
    summary: "list the maintenance events in progress",
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
      summary: "list upcoming and ongoing maintenance events",
    },
  ];

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
   * alone; the description says what follows it. Teams takes ten at most.
   */
  public static getManifestCommands(): Array<JSONObject> {
    const commands: Array<JSONObject> = [];

    for (const definition of WORKSPACE_COMMANDS) {
      if (definition.name === WorkspaceCommandName.Help) {
        for (const entry of LIST_COMMAND_SPELLINGS) {
          commands.push({
            title: entry.command,
            description: MicrosoftTeamsCommands.toSentence(entry.summary),
          });
        }
      }

      commands.push({
        title: definition.name,
        description: MicrosoftTeamsCommands.toSentence(
          WorkspaceCommands.getSummary(definition.name),
        ),
      });
    }

    return commands;
  }

  /*
   * The commands, with examples, as a reply that mentions whoever asked -
   * and, for text that started with a misspelt command, the one it looks
   * like.
   */
  @CaptureSpan()
  public static async replyHelp(data: {
    turnContext: TurnContext;
    misspelt?: WorkspaceCommandMisspelling | undefined;
  }): Promise<void> {
    await MicrosoftTeamsActionAnswer.reply({
      turnContext: data.turnContext,
      answer: MicrosoftTeamsCommands.getHelpAnswer(data.misspelt),
    });
  }

  // The help, as Microsoft Teams shows it (WorkspaceCommands.getHelpAnswer).
  public static getHelpAnswer(
    misspelt?: WorkspaceCommandMisspelling | undefined,
  ): WorkspaceAnswer {
    return WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      extraCommands: [...MICROSOFT_TEAMS_LIST_COMMANDS_IN_HELP],
      misspelt: misspelt,
    });
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

  // "Declare an incident.": a summary as a sentence of its own.
  private static toSentence(summary: string): string {
    const sentence: string =
      summary.charAt(0).toUpperCase() + summary.substring(1);

    return sentence.endsWith(".") ? sentence : `${sentence}.`;
  }
}
