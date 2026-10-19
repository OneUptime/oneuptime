import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { Indigo500 } from "../../../../Types/BrandColors";
import { CallSummary } from "../../../../Types/VideoCall/CallSummary";
import CallSummaryFeedMarkdown from "../../../../Utils/VideoCall/CallSummaryFeedMarkdown";
import TranscriptText from "../../../../Utils/VideoCall/TranscriptText";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import logger, { LogAttributes } from "../../Logger";

/*
 * WHAT ONEUPTIME AI READ IN A CALL, POSTED TO THE INCIDENT'S FEED.
 *
 * Once OneUptime AI has read a call's transcript (IncidentCallSummary), what
 * it read is the incident's next feed item, written as
 * CallSummaryFeedMarkdown says it, and from the feed it goes to the
 * incident's Slack and Microsoft Teams channels like the incident's other
 * updates. It is OneUptime AI's, not a person's: no one is named as its
 * author.
 */
export default class IncidentCallSummaryFeed {
  /*
   * Posts what was read to the incident's feed and channels. Never throws:
   * the reading is stored either way, and the card shows it.
   */
  public static async post(data: {
    call: Pick<
      IncidentVideoCall,
      "projectId" | "incidentId" | "transcriptInfo"
    >;
    callLabel: string;
    summary: CallSummary;
  }): Promise<void> {
    try {
      const info: ReturnType<typeof TranscriptText.readInfo> =
        TranscriptText.readInfo(data.call.transcriptInfo);

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: data.call.incidentId!,
        projectId: data.call.projectId!,
        incidentFeedEventType: IncidentFeedEventType.VideoCallSummary,
        displayColor: Indigo500,
        feedInfoInMarkdown: CallSummaryFeedMarkdown.getFeedMarkdown({
          callLabel: data.callLabel,
          summary: data.summary,
          details: info ? TranscriptText.describeInfo(info) : undefined,
        }).toString(),
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    } catch (error) {
      logger.error(
        `Could not post what OneUptime AI read in a call to the incident's feed: ${error}`,
        {
          projectId: data.call.projectId?.toString(),
          incidentId: data.call.incidentId?.toString(),
        } as LogAttributes,
      );
    }
  }
}
