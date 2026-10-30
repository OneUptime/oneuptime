import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import Includes from "../../../Types/BaseDatabase/Includes";
import { Green500 } from "../../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
import logger from "../Logger";

/*
 * AN ISSUE'S ALERT, RESOLVED ONCE THE ISSUE IS NO LONGER OPEN.
 *
 * A Critical issue can raise an alert (DataSecurityIntegrations), which
 * pages whoever is on call and escalates until somebody acknowledges it.
 * The alert is about the issue, so it ends with it: when the issue's check
 * passes, when the store is no longer checked that way, or when a person
 * marks it resolved, accepts its risk or says it is not an issue, its open
 * alert is resolved - nobody is paged for an exposure that is closed. An
 * issue that opens again raises a new alert.
 *
 * Its security case and its incident stay as they are: a case can hold
 * other detections, and an incident has its own people, status pages and
 * postmortem, so whoever runs them closes them.
 *
 * Everything Data Security opens elsewhere for an issue - the detection in
 * its case, its alert, its incident - carries the issue's fingerprint, so
 * each is found again by it. Best effort: an alert that cannot be resolved
 * is logged, never thrown, and the issue's own change stands.
 */

export function getDataSecurityIssueFingerprint(issueId: ObjectID): string {
  return `data-security-issue:${issueId.toString()}`;
}

export interface ClosedDataSecurityIssue {
  issueId: ObjectID;
  // Why it is no longer open, finishing "the issue is no longer open: ...".
  why: string;
}

const SAME_STATE_MESSAGE: string =
  "Alert state cannot be same as previous state.";

export default class DataSecurityIssueAlerts {
  // Resolves the open alerts of the issues that closed; how many it resolved.
  public static async resolveForClosedIssues(data: {
    projectId: ObjectID;
    issues: Array<ClosedDataSecurityIssue>;
  }): Promise<number> {
    if (data.issues.length === 0) {
      return 0;
    }

    const byFingerprint: Map<string, ClosedDataSecurityIssue> = new Map();

    for (const issue of data.issues) {
      byFingerprint.set(getDataSecurityIssueFingerprint(issue.issueId), issue);
    }

    let resolved: number = 0;

    try {
      const openAlerts: Array<Alert> = await AlertService.findBy({
        query: {
          projectId: data.projectId,
          seriesFingerprint: new Includes([...byFingerprint.keys()]),
          // Open: above the project's resolved state (Common/Utils/ResolvedState).
          currentAlertStateId: new Includes(
            await AlertStateService.getUnresolvedAlertStateIds(data.projectId),
          ),
        },
        select: {
          _id: true,
          seriesFingerprint: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      if (openAlerts.length === 0) {
        return 0;
      }

      const resolvedStateId: ObjectID =
        await AlertStateTimelineService.getResolvedStateIdForProject(
          data.projectId,
        );

      for (const alert of openAlerts) {
        const issue: ClosedDataSecurityIssue | undefined = byFingerprint.get(
          alert.seriesFingerprint || "",
        );

        if (!alert.id || !issue) {
          continue;
        }

        try {
          const timeline: AlertStateTimeline = new AlertStateTimeline();
          timeline.alertId = alert.id;
          timeline.alertStateId = resolvedStateId;
          timeline.projectId = data.projectId;
          timeline.rootCause = `Resolved by Data Security, as the issue it was raised for is no longer open: ${issue.why}.`;

          await AlertStateTimelineService.create({
            data: timeline,
            props: {
              isRoot: true,
            },
          });
          resolved++;

          await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
            projectId: data.projectId,
            dataSecurityIssueId: issue.issueId,
            eventType: DataSecurityIssueFeedEventType.AlertResolved,
            displayColor: Green500,
            feedInfoInMarkdown:
              mdText`Its alert was resolved, so nobody is paged for it any more: ${issue.why}.`.toString(),
          });
        } catch (error) {
          /*
           * Somebody resolved it a moment before: the alert is where this
           * would have put it.
           */
          if (
            error instanceof BadDataException &&
            error.message === SAME_STATE_MESSAGE
          ) {
            continue;
          }

          logger.error(
            `DataSecurity: could not resolve alert ${alert.id.toString()} of project ${data.projectId.toString()}:`,
          );
          logger.error(error);
        }
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not resolve the alerts of closed issues in project ${data.projectId.toString()}:`,
      );
      logger.error(error);
    }

    return resolved;
  }
}
