import ObjectID from "../../../../Types/ObjectID";
import { Blue500 } from "../../../../Types/BrandColors";
import Incident from "../../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentService from "../../../Services/IncidentService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import SentinelInvestigationEngine from "./SentinelInvestigationEngine";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — auto-draft postmortem on resolve (Phase 3, "close the loop").
 *
 * When an incident moves to a resolved state, Sentinel drafts a postmortem from
 * the incident timeline + telemetry (reusing the existing
 * IncidentService.generatePostmortemFromAI) and saves it to the incident for a
 * human to review and edit — turning a ~90-minute manual writeup into a review.
 *
 * It NEVER overwrites a postmortem that already exists (human work wins), is
 * gated by the same per-project opt-in + LLM provider as investigations, and is
 * fire-and-forget: failures are logged, never surfaced to the resolve flow.
 */
const MAX_FEED_PREVIEW_CHARS: number = 6000;

export default class SentinelIncidentPostmortemRunner {
  @CaptureSpan()
  public static async draftPostmortemOnResolve(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { incidentId, projectId } = data;

    try {
      if (
        !(await SentinelInvestigationEngine.isEnabledForProject(
          projectId,
          "Incident",
        ))
      ) {
        return;
      }

      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: {
          _id: true,
          incidentNumber: true,
          postmortemNote: true,
        },
        props: { isRoot: true },
      });

      if (!incident) {
        return;
      }

      // Never clobber an existing postmortem (human or previously drafted).
      if (
        incident.postmortemNote &&
        incident.postmortemNote.trim().length > 0
      ) {
        return;
      }

      const draft: string = await IncidentService.generatePostmortemFromAI({
        incidentId,
      });

      if (!draft || !draft.trim()) {
        return;
      }

      await IncidentService.updateOneById({
        id: incidentId,
        data: {
          postmortemNote: draft,
        },
        props: { isRoot: true },
      });

      await IncidentFeedService.createIncidentFeedItem({
        incidentId,
        projectId,
        incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
        displayColor: Blue500,
        feedInfoInMarkdown: `## 🧠 AI — Draft Postmortem\n\nOneUptime AI drafted a postmortem for incident #${incident.incidentNumber} from the incident timeline and telemetry. It has been saved on the incident for you to review and edit.`,
        moreInformationInMarkdown:
          draft.length > MAX_FEED_PREVIEW_CHARS
            ? `${draft.substring(0, MAX_FEED_PREVIEW_CHARS)}\n\n…(truncated — the full draft is saved on the incident.)`
            : draft,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });

      logger.debug(
        `Sentinel: drafted postmortem for incident ${incidentId.toString()}.`,
      );
    } catch (error) {
      logger.error(
        `Sentinel: failed to draft postmortem for incident ${incidentId.toString()}: ${error}`,
      );
    }
  }
}
