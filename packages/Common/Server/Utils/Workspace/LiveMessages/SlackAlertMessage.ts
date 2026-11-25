import Alert from "../../../../Models/DatabaseModels/Alert";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import ObjectID from "../../../../Types/ObjectID";
import { NotificationRuleUpdateKind } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceLiveMessageKey from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../../DatabaseConfig";
import SlackAlertThreading from "../Slack/SlackAlertThreading";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
import WorkspaceLiveMessageService from "../../../Services/WorkspaceLiveMessageService";
import WorkspaceNotificationRuleService from "../../../Services/WorkspaceNotificationRuleService";
import LinkedAffectedResources, {
  LinkedAffectedResource,
} from "../../AffectedResources/LinkedAffectedResources";
import logger from "../../Logger";
import BlockedProjectNotifications from "../../Notification/BlockedProjectNotifications";
import SlackAlertMessages from "../Slack/Messages/Alert";
import WorkspaceNotificationText from "../WorkspaceNotificationText";
import WorkspaceLiveMessages from "./WorkspaceLiveMessages";

interface PendingOwnerTeams {
  teams: Map<string, string>;
  timer?: ReturnType<typeof setTimeout> | undefined;
}

export default class SlackAlertMessage {
  /*
   * The create chain flushes its own batch after posting the Slack parent
   * and waiting for the code that created the alert to assign its teams.
   */
  private static readonly initialOwnerTeams: Map<string, PendingOwnerTeams> =
    new Map();
  private static readonly laterOwnerTeams: Map<string, PendingOwnerTeams> =
    new Map();
  private static readonly initialPosts: Map<string, Promise<void>> = new Map();

  public static trackInitialPost(
    alertId: ObjectID,
    posting: Promise<void>,
  ): void {
    const key: string = alertId.toString();
    this.initialPosts.set(key, posting);
    void posting.then(() => {
      this.initialPosts.delete(key);
    });
  }

  public static async waitForInitialPost(alertId: ObjectID): Promise<void> {
    await this.initialPosts.get(alertId.toString());
  }

  public static startCollectingOwnerTeams(alertId: ObjectID): void {
    this.initialOwnerTeams.set(alertId.toString(), { teams: new Map() });
  }

  public static async finishCollectingOwnerTeams(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<void> {
    const key: string = data.alertId.toString();
    const batch: PendingOwnerTeams | undefined =
      this.initialOwnerTeams.get(key);
    this.initialOwnerTeams.delete(key);
    if (batch) {
      await this.sendOwnerTeams({ ...data, batch: batch });
    }
  }

  public static collectOwnerTeam(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    teamId: ObjectID;
    teamName: string;
  }): void {
    const key: string = data.alertId.toString();
    const initial: PendingOwnerTeams | undefined =
      this.initialOwnerTeams.get(key);
    if (initial) {
      initial.teams.set(data.teamId.toString(), data.teamName);
      return;
    }

    const batch: PendingOwnerTeams = this.laterOwnerTeams.get(key) || {
      teams: new Map(),
    };
    batch.teams.set(data.teamId.toString(), data.teamName);
    if (!batch.timer) {
      /*
       * ponytail: a short per-process window groups later assignments; a
       * durable queue would be needed to combine changes across workers.
       */
      batch.timer = setTimeout(() => {
        this.laterOwnerTeams.delete(key);
        void this.sendOwnerTeams({ ...data, batch: batch });
      }, 1000);
      batch.timer.unref();
      this.laterOwnerTeams.set(key, batch);
    }
  }

  private static async sendOwnerTeams(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    batch: PendingOwnerTeams;
  }): Promise<void> {
    if (data.batch.teams.size === 0) {
      return;
    }

    try {
      const names: Array<MarkdownText> = [...data.batch.teams.values()].map(
        (name: string): MarkdownText => {
          return mdText`**${name}**`;
        },
      );
      const number: Awaited<ReturnType<typeof AlertService.getAlertNumber>> =
        await AlertService.getAlertNumber({ alertId: data.alertId });
      const link: Awaited<
        ReturnType<typeof AlertService.getAlertLinkInDashboard>
      > = await AlertService.getAlertLinkInDashboard(
        data.projectId,
        data.alertId,
      );
      await WorkspaceLiveMessages.withLock(
        WorkspaceLiveMessageKey.forSlackAlert(data.alertId),
        async () => {
          await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
            {
              projectId: data.projectId,
              notificationFor: { alertId: data.alertId },
              feedInfoInMarkdown:
                mdText`👥 Added ${FeedMarkdown.join(names)} as ${names.length === 1 ? "owner team" : "owner teams"} for [Alert ${number.numberWithPrefix || `#${number.number}`}](${link.toString()}).`.toString(),
              workspaceTypes: [WorkspaceType.Slack],
              workspaceNotification: {
                sendWorkspaceNotification: true,
                updateKinds: [NotificationRuleUpdateKind.Owners],
              },
            },
          );
        },
      );
    } catch (error) {
      logger.error(error, { alertId: data.alertId.toString() });
    }
  }

  public static stateLine(state: string, resolved: boolean = false): string {
    return `${resolved ? "🟢" : "🔴"} ${mdText`**Alert State**: ${state}`}`;
  }

  public static async findAlert(alertId: ObjectID): Promise<Alert | null> {
    return await AlertService.findOneById({
      id: alertId,
      select: {
        projectId: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        title: true,
        currentAlertStateId: true,
        currentAlertState: { name: true },
      },
      props: { isRoot: true },
    });
  }

  public static async compactBlock(
    alert: Alert,
  ): Promise<WorkspacePayloadMarkdown | undefined> {
    const state: string | undefined = alert.currentAlertState?.name;
    if (!alert.id || !alert.projectId || !state) {
      return undefined;
    }

    const resolved: boolean =
      Boolean(alert.currentAlertStateId) &&
      (await AlertStateService.isResolvedAlertState({
        projectId: alert.projectId,
        alertStateId: alert.currentAlertStateId!,
      }));
    const custom: string | undefined = this.customTemplate(state);
    if (!custom && !resolved) {
      return undefined;
    }

    const template: string =
      custom ||
      "#### ✅ Alert {{alertNumber}} {{state}}:\n\n**{{title}}**\n\n{{resourcesSection}}\n\n{{stateLine}}";
    let resources: string = "";
    const resourcePlaceholder: RegExp = /\{\{\s*resources(?:Section)?\s*\}\}/u;
    if (resourcePlaceholder.test(template)) {
      const affected: Array<LinkedAffectedResource> =
        await LinkedAffectedResources.readForAlert({
          service: AlertService,
          projectId: alert.projectId,
          alertId: alert.id,
        });
      if (affected.length > 0) {
        resources = LinkedAffectedResources.getMarkdownLines({
          dashboardUrl: await DatabaseConfig.getDashboardUrl(),
          projectId: alert.projectId,
          resources: affected,
        })
          .map((line: MarkdownText): string => {
            return line.toString();
          })
          .join("\n");
      }
    }

    const values: Map<string, string> = new Map([
      [
        "alertNumber",
        mdText`${alert.alertNumberWithPrefix ?? (alert.alertNumber === undefined ? "" : `#${alert.alertNumber}`)}`.toString(),
      ],
      ["title", mdText`${alert.title || "No title provided."}`.toString()],
      ["state", mdText`${state}`.toString()],
      ["stateLine", this.stateLine(state, resolved)],
      ["resources", resources],
      [
        "resourcesSection",
        resources ? `🌎 **Resources Affected**:\n\n${resources}` : "",
      ],
    ]);

    return {
      _type: "WorkspacePayloadMarkdown",
      text:
        template
          .replace(
            /\{\{\s*(\w+)\s*\}\}/gu,
            (token: string, key: string): string => {
              return values.get(key) ?? token;
            },
          )
          .trim() || this.stateLine(state, resolved),
    };
  }

  private static customTemplate(state: string): string | undefined {
    const config: string | undefined =
      process.env["SLACK_ALERT_STATE_TEMPLATES"];
    if (!config) {
      return undefined;
    }

    try {
      const templates: unknown = JSON.parse(config);
      if (
        templates &&
        typeof templates === "object" &&
        !Array.isArray(templates) &&
        Object.keys(templates).includes(state)
      ) {
        const template: unknown = (templates as Record<string, unknown>)[state];
        if (typeof template === "string") {
          return template.trim() || undefined;
        }
      }
    } catch {
      logger.warn("Invalid SLACK_ALERT_STATE_TEMPLATES JSON.");
    }

    return undefined;
  }

  public static async refresh(alertId: ObjectID): Promise<void> {
    try {
      await this.waitForInitialPost(alertId);
      await this.refreshPostedMessages(alertId);
    } catch (error) {
      logger.error(error, { alertId: alertId.toString() });
    }
  }

  public static async refreshPostedMessages(alertId: ObjectID): Promise<void> {
    const messageKey: string = WorkspaceLiveMessageKey.forSlackAlert(alertId);

    try {
      await WorkspaceLiveMessages.withLock(messageKey, async () => {
        const alert: Alert | null = await this.findAlert(alertId);

        if (
          !alert?.projectId ||
          !alert.currentAlertState?.name ||
          !(await SlackAlertThreading.forDelivery(alert.projectId)) ||
          (await BlockedProjectNotifications.isBlocked(alert.projectId))
        ) {
          return;
        }

        const stateLine: string = this.stateLine(alert.currentAlertState.name);
        const messages: Array<WorkspaceLiveMessage> =
          await WorkspaceLiveMessageService.findByMessageKey({
            projectId: alert.projectId,
            messageKey: messageKey,
          });
        if (messages.length === 0) {
          return;
        }

        const compact: WorkspacePayloadMarkdown | undefined =
          await this.compactBlock(alert);
        const actions: Array<WorkspaceMessageBlock> =
          await SlackAlertMessages.getAlertCreateMessageBlocks({
            alertId: alertId,
            projectId: alert.projectId,
          });

        for (const keptMessage of messages) {
          const firstBlock: WorkspaceMessageBlock | undefined =
            keptMessage.messageData?.leadBlocks?.[0];

          if (firstBlock?._type !== "WorkspacePayloadMarkdown") {
            continue;
          }

          const markdown: WorkspacePayloadMarkdown =
            firstBlock as WorkspacePayloadMarkdown;
          const text: string = markdown.text.replace(
            /^🔴 \*\*Alert State\*\*: [^\r\n]*/mu,
            (): string => {
              return stateLine;
            },
          );
          const blocks: Array<WorkspaceMessageBlock> = compact
            ? [compact, ...actions]
            : [
                { ...markdown, text: text } as WorkspacePayloadMarkdown,
                ...actions,
              ];

          try {
            await WorkspaceLiveMessages.updateKept({
              keptMessage: keptMessage,
              messageBlocks: blocks,
              text: WorkspaceNotificationText.fromBlocks(blocks),
            });
          } catch (error) {
            logger.error(error, { alertId: alertId.toString() });
          }
        }
      });
    } catch (error) {
      logger.error(error, { alertId: alertId.toString() });
    }
  }
}
