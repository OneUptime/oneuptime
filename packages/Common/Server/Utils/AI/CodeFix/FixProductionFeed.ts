import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { IncidentAlertAiSubjectKind } from "../../../../Types/AI/IncidentAlertAiLogs";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import AlertFeedService from "../../../Services/AlertFeedService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import logger from "../../Logger";

/*
 * What a production check says on an incident's or an alert's feed once a
 * fix opened from it is decided (RecurrenceFixWatch, TelemetryFixWatch): a
 * note beside the investigation that asked for the fix, so the incident's
 * own timeline shows whether its fix worked. Posted like the other notes
 * OneUptime's fixes leave (RemediationVerifier), with no chat message: the
 * incident is usually long resolved.
 */
export default class FixProductionFeed {
  /*
   * Posts a note on the incident's or alert's feed. Best-effort: a failed
   * note is logged, and the verdict it reports stands.
   */
  public static async postNote(data: {
    fix: AIAgentTaskPullRequest;
    kind: IncidentAlertAiSubjectKind;
    subjectId: ObjectID;
    color: Color;
    markdown: MarkdownText;
  }): Promise<void> {
    try {
      if (data.kind === "incident") {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.subjectId,
          projectId: data.fix.projectId!,
          incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
          displayColor: data.color,
          feedInfoInMarkdown: data.markdown.toString(),
        });
      } else {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.subjectId,
          projectId: data.fix.projectId!,
          alertFeedEventType: AlertFeedEventType.AutoRemediation,
          displayColor: data.color,
          feedInfoInMarkdown: data.markdown.toString(),
        });
      }
    } catch (error) {
      logger.error(
        `Fix verification: could not post the verdict of fix pull request ${data.fix.id?.toString()} on ${data.kind} ${data.subjectId.toString()}: ${error}`,
      );
    }
  }

  // "[Pull request #123](…)", or the words alone when there is no address.
  public static pullRequestLink(fix: AIAgentTaskPullRequest): MarkdownText {
    const label: string = fix.pullRequestNumber
      ? `Pull request #${fix.pullRequestNumber}`
      : "The pull request";

    return fix.pullRequestUrl
      ? FeedMarkdown.link(label, fix.pullRequestUrl.toString())
      : mdText`${label}`;
  }
}
