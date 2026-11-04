import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import URL from "../../../Types/API/URL";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../Types/AI/AIChatPageContext";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import DatabaseConfig from "../../DatabaseConfig";
import AlertService from "../../Services/AlertService";
import IncidentService from "../../Services/IncidentService";
import { OnCallPageRecordType } from "../../Services/OnCallPageService";
import type { ObservabilityChatApp } from "../AI/Chat/ObservabilityChatPrompt";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceCommands, { WorkspaceCommandName } from "./WorkspaceCommands";
import WorkspacePageAbout from "./WorkspacePageAbout";

/*
 * WHAT ONEUPTIME AI KNOWS ABOUT WHERE A CHAT QUESTION IS ASKED.
 *
 * OneUptime AI answers questions in Slack and Microsoft Teams with the same
 * tools as Ask AI in the Dashboard, read-only (ObservabilityAssistant). Two
 * things it lacked there, which Ask AI in the Dashboard has:
 *
 *   - HOW TO ACT FROM THERE. Asked to create an incident, the answer said
 *     "switch modes", which means nothing in a chat app (#5315's
 *     follow-up). The model is now told the chat's own ways: its incident
 *     and page commands, typed as the chat's help types them
 *     (WorkspaceCommands.getUsage), the buttons on OneUptime's messages,
 *     and - for anything else - Ask AI in the Dashboard, by its link
 *     (getChatApp).
 *
 *   - WHAT THE CHANNEL IS ABOUT. Asked in an incident's or an alert's own
 *     channel - the one OneUptime made for it, which WorkspacePageAbout
 *     tells - "why did this happen?" means that incident, as it does on the
 *     incident's page in the Dashboard. The record is read as the person
 *     who asked: one they may not read is not named to the model, and the
 *     question is answered as if asked anywhere else (getChannelRecord).
 *
 * Slack and Microsoft Teams both ask here, so the two cannot drift apart.
 */
export default class WorkspaceAiContext {
  // The chat app, by the name its people know it by.
  public static getChatAppName(workspaceType: WorkspaceType): string {
    return workspaceType === WorkspaceType.MicrosoftTeams
      ? "Microsoft Teams"
      : "Slack";
  }

  // Ask AI in the Dashboard: the dialog, opened over the project's Home.
  @CaptureSpan()
  public static async getAskAiUrl(projectId: ObjectID): Promise<string> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString())
      .addRoute(`/${projectId.toString()}/ai/chat`)
      .toString();
  }

  /*
   * The chat app the answer is posted to, as the model names its ways to
   * act: "/oneuptime incident" in Slack (with the command the workspace
   * runs OneUptime with), "incident" typed to the Microsoft Teams bot,
   * which is mentioned first in a channel (`botName`).
   */
  @CaptureSpan()
  public static async getChatApp(data: {
    workspaceType: WorkspaceType;
    projectId: ObjectID;
    // The command a Slack workspace runs OneUptime with: "/oneuptime".
    slackCommand?: string | undefined;
    // The bot's name as Microsoft Teams shows it.
    botName?: string | undefined;
  }): Promise<ObservabilityChatApp> {
    const botName: string = (data.botName || "").trim();
    const productName: string = ProductBrandingText.getProductName();

    return {
      name: WorkspaceAiContext.getChatAppName(data.workspaceType),
      incidentCommand: WorkspaceCommands.getUsage({
        workspaceType: data.workspaceType,
        command: WorkspaceCommandName.Incident,
        slackCommand: data.slackCommand,
      }),
      pageCommand: WorkspaceCommands.getUsage({
        workspaceType: data.workspaceType,
        command: WorkspaceCommandName.Page,
        slackCommand: data.slackCommand,
      }),
      ...(data.workspaceType === WorkspaceType.MicrosoftTeams
        ? {
            commandNote: botName
              ? `typed to the ${productName} bot; in a channel or a group chat, mention @${botName} first`
              : `typed to the ${productName} bot; in a channel or a group chat, mention it first`,
          }
        : {}),
      askAiUrl: await WorkspaceAiContext.getAskAiUrl(data.projectId),
    };
  }

  /*
   * The incident or alert a channel was made for, as Ask AI opened on its
   * page knows it: its ID and its number and title, read as the person who
   * asked. Undefined for any other channel, for a record the person may
   * not read, and when it cannot be read: the question is then answered as
   * if asked anywhere else. Never throws - a context must never stand
   * between a person and an answer.
   */
  @CaptureSpan()
  public static async getChannelRecord(data: {
    projectId: ObjectID;
    channelId: string | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<AIChatPageContext | undefined> {
    // A direct message or a chat is no record's channel: nothing to look up.
    if (!(data.channelId || "").trim()) {
      return undefined;
    }

    try {
      const owner: { type: OnCallPageRecordType; id: ObjectID } | null =
        await WorkspacePageAbout.findChannelRecord({
          projectId: data.projectId,
          channelId: data.channelId,
        });

      if (!owner) {
        return undefined;
      }

      if (owner.type === OnCallPageRecordType.Incident) {
        const incident: Incident | null = await IncidentService.findOneById({
          id: owner.id,
          select: {
            _id: true,
            title: true,
            incidentNumber: true,
            incidentNumberWithPrefix: true,
          },
          props: data.props,
        });

        return incident
          ? {
              type: AIChatPageContextType.Incident,
              entityId: owner.id.toString(),
              entityTitle: WorkspaceAiContext.getRecordTitle({
                number:
                  incident.incidentNumberWithPrefix ||
                  (typeof incident.incidentNumber === "number"
                    ? `#${incident.incidentNumber}`
                    : ""),
                title: incident.title,
              }),
            }
          : undefined;
      }

      const alert: Alert | null = await AlertService.findOneById({
        id: owner.id,
        select: {
          _id: true,
          title: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
        },
        props: data.props,
      });

      return alert
        ? {
            type: AIChatPageContextType.Alert,
            entityId: owner.id.toString(),
            entityTitle: WorkspaceAiContext.getRecordTitle({
              number:
                alert.alertNumberWithPrefix ||
                (typeof alert.alertNumber === "number"
                  ? `#${alert.alertNumber}`
                  : ""),
              title: alert.title,
            }),
          }
        : undefined;
    } catch (err) {
      logger.debug(
        "Could not read the record of the chat channel a question was asked in; answering it without that.",
      );
      logger.debug(err);
      return undefined;
    }
  }

  // "INC-42 Checkout is down": the record as its channel's people know it.
  private static getRecordTitle(data: {
    number: string;
    title: string | undefined;
  }): string {
    return [data.number, (data.title || "").trim()]
      .filter((part: string): boolean => {
        return Boolean(part);
      })
      .join(" ");
  }
}
