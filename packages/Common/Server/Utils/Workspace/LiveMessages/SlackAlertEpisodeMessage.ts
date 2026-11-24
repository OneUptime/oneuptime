import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceLiveMessageKey from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import AlertEpisodeService from "../../../Services/AlertEpisodeService";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceLiveMessageService from "../../../Services/WorkspaceLiveMessageService";
import logger from "../../Logger";
import BlockedProjectNotifications from "../../Notification/BlockedProjectNotifications";
import SlackAlertEpisodeMessages from "../Slack/Messages/AlertEpisode";
import SlackAlertThreading from "../Slack/SlackAlertThreading";
import WorkspaceNotificationText from "../WorkspaceNotificationText";
import WorkspaceLiveMessages from "./WorkspaceLiveMessages";

export default class SlackAlertEpisodeMessage {
  public static stateLine(state: string, isResolved: boolean): string {
    return mdText`${isResolved ? "🟢" : "🔴"} **Episode State**: ${state}`.toString();
  }

  public static async refresh(
    projectId: ObjectID,
    episodeId: ObjectID,
  ): Promise<void> {
    const key: string = WorkspaceLiveMessageKey.forSlackAlertEpisode(episodeId);
    try {
      if (
        !(await SlackAlertThreading.forDelivery(projectId)) ||
        (await BlockedProjectNotifications.isBlocked(projectId))
      ) {
        return;
      }

      await WorkspaceLiveMessages.withLock(key, async () => {
        const messages: Array<WorkspaceLiveMessage> =
          await WorkspaceLiveMessageService.findByMessageKey({
            projectId: projectId,
            messageKey: key,
          });
        if (messages.length === 0) {
          return;
        }

        const episode: AlertEpisode | null =
          await AlertEpisodeService.findOneById({
            id: episodeId,
            select: {
              projectId: true,
              episodeNumber: true,
              episodeNumberWithPrefix: true,
              title: true,
              resolvedAt: true,
              currentAlertState: { name: true },
            },
            props: { isRoot: true },
          });
        if (
          !episode?.projectId?.equals(projectId) ||
          !episode.currentAlertState?.name
        ) {
          return;
        }

        const state: string = episode.currentAlertState.name;
        const stateLine: string = this.stateLine(
          state,
          Boolean(episode.resolvedAt),
        );
        const number: string =
          episode.episodeNumberWithPrefix || `#${episode.episodeNumber}`;
        const actions: Array<WorkspaceMessageBlock> =
          await SlackAlertEpisodeMessages.getAlertEpisodeCreateMessageBlocks({
            alertEpisodeId: episodeId,
            projectId: projectId,
          });

        for (const message of messages) {
          const lead: WorkspaceMessageBlock | undefined =
            message.messageData?.leadBlocks?.[0];
          if (lead?._type !== "WorkspacePayloadMarkdown") {
            continue;
          }
          const markdown: WorkspacePayloadMarkdown =
            lead as WorkspacePayloadMarkdown;
          const pattern: RegExp = /^[🔴🟢] \*\*Episode State\*\*: [^\r\n]*/mu;
          const text: string = episode.resolvedAt
            ? `${mdText`#### ✅ Episode ${number} ${state}:\n\n**${episode.title || "No title provided."}**\n\n`}${stateLine}`
            : pattern.test(markdown.text)
              ? markdown.text.replace(pattern, (): string => {
                  return stateLine;
                })
              : `${markdown.text}\n\n${stateLine}`;
          const leadBlock: WorkspacePayloadMarkdown = {
            ...markdown,
            text: text,
          };
          const blocks: Array<WorkspaceMessageBlock> = [leadBlock, ...actions];
          try {
            await WorkspaceLiveMessages.updateKept({
              keptMessage: message,
              messageBlocks: blocks,
              text: WorkspaceNotificationText.fromBlocks(blocks),
            });
          } catch (error) {
            logger.error(error, { alertEpisodeId: episodeId.toString() });
          }
        }
      });
    } catch (error) {
      logger.error(error, { alertEpisodeId: episodeId.toString() });
    }
  }
}
