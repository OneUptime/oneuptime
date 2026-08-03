import IncidentFeedService from "../../../Services/IncidentFeedService";
import AlertFeedService from "../../../Services/AlertFeedService";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../../Models/DatabaseModels/AlertFeed";
import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * The analysis an AI investigation posted for a subject.
 *
 * The RootCause feed item is the only persisted copy — the runner's
 * postAnalysis is its sole writer, and the grader, the eval corpus and the
 * fix-from-incident recipe all read it. Anything else that wants the RCA
 * should come through here rather than re-deriving the query, so a change to
 * where the analysis lives moves one place.
 */
export default class PostedRootCause {
  @CaptureSpan()
  public static async getForIncident(
    incidentId: ObjectID,
  ): Promise<string | null> {
    const feedItem: IncidentFeed | null = await IncidentFeedService.findOneBy({
      query: {
        incidentId: incidentId,
        incidentFeedEventType: IncidentFeedEventType.RootCause,
      },
      select: {
        feedInfoInMarkdown: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: { isRoot: true },
    });

    const analysis: string = (feedItem?.feedInfoInMarkdown || "").trim();

    return analysis || null;
  }

  @CaptureSpan()
  public static async getForAlert(alertId: ObjectID): Promise<string | null> {
    const feedItem: AlertFeed | null = await AlertFeedService.findOneBy({
      query: {
        alertId: alertId,
        alertFeedEventType: AlertFeedEventType.RootCause,
      },
      select: {
        feedInfoInMarkdown: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: { isRoot: true },
    });

    const analysis: string = (feedItem?.feedInfoInMarkdown || "").trim();

    return analysis || null;
  }

  @CaptureSpan()
  public static async getForSubject(data: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<string | null> {
    if (data.incidentId) {
      return PostedRootCause.getForIncident(data.incidentId);
    }

    if (data.alertId) {
      return PostedRootCause.getForAlert(data.alertId);
    }

    return null;
  }
}
