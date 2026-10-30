import DataStoreOwnerTeam from "../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../Models/DatabaseModels/DataStoreOwnerUser";
import DataSecuritySetting from "../../../Models/DatabaseModels/DataSecuritySetting";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DataStoreOwnerTeamService from "../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../Services/DataStoreOwnerUserService";
import DataStoreService from "../../Services/DataStoreService";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import MailService from "../../Services/MailService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserService from "../../Services/UserService";
import SecurityDetectionService from "../../Services/SecurityDetectionService";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../SecurityCase/SecurityCaseIngest";
import {
  AlertableMatch,
  DedupedRecordOutcome,
  openDedupedAlerts,
  openDedupedIncidents,
  resolveAlertSeverityIdForProject,
  resolveIncidentSeverityIdForProject,
} from "../SecurityEvent/SecurityEventAlerting";
import { getDataSecurityIssueFingerprint } from "./DataSecurityIssueAlerts";
import logger from "../Logger";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import URL from "../../../Types/API/URL";
import { Blue500, Red500 } from "../../../Types/BrandColors";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import Includes from "../../../Types/BaseDatabase/Includes";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { dataStoreEntityValue } from "../../../Types/DataSecurity/DataStoreKey";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";

/*
 * WHAT HAPPENS ELSEWHERE IN ONEUPTIME WHEN AN ISSUE OPENS.
 *
 * Data Security does not run its own pager or SOC queue; it hands what it
 * finds to the parts of OneUptime that already do, as the project's
 * settings say (DataSecuritySetting):
 *
 *  - A Critical issue opens a security case (on by default), grouped by
 *    store: the store is the case's Data Store entity, so a second Critical
 *    issue on the same store joins the same case, and Entity Risk and
 *    playbooks see it like any other entity.
 *  - A Critical issue raises an alert (off by default), which pages
 *    whoever is on call through the alert's own rules. The alert ends with
 *    the issue: it is resolved once the issue is no longer open
 *    (DataSecurityIssueAlerts).
 *  - A Critical issue declares an incident (off by default), for a breach
 *    the project's incident process should run. Whoever runs it closes it.
 *  - Every new issue is emailed to its store's owners (on by default),
 *    with the issue and the data types - never a sample.
 *
 * The issue keeps a link to the case, the alert and the incident it
 * started (securityCaseId, alertId, incidentId), which its page shows.
 *
 * Each is best effort: an issue is already open and on its timeline, so
 * an integration that fails is logged and skipped, never retried into a
 * second case or a second page.
 */

export interface OpenedIssueForIntegrations {
  issueId: ObjectID;
  checkId: string;
  title: string;
  severity: SecuritySeverity;
  riskScore: number;
  dataStoreId: ObjectID;
  dataStoreName: string;
  dataStoreKey: string;
  dataStoreKind?: string | undefined;
  sensitivity: DataSensitivity;
}

const OCSF_SEVERITY: Readonly<Record<SecuritySeverity, OcsfSeverity>> = {
  [SecuritySeverity.Critical]: OcsfSeverity.Critical,
  [SecuritySeverity.High]: OcsfSeverity.High,
  [SecuritySeverity.Medium]: OcsfSeverity.Medium,
  [SecuritySeverity.Low]: OcsfSeverity.Low,
};

// The most owners one store's notice is sent to.
const MAX_NOTIFIED_OWNERS: number = 50;

/*
 * The most of an alert's or an incident's title: their title holds 500
 * characters, and a store's name alone may hold that many.
 */
const MAX_TITLE_LENGTH: number = 480;

// "1 new issue", "3 new issues".
function newIssuesPhrase(count: number): string {
  return count === 1 ? "1 new issue" : `${count} new issues`;
}

// The subject of the email a store's owners get when issues open on it.
export function getOwnerNoticeSubject(data: {
  dataStoreName: string;
  issueCount: number;
}): string {
  return `Data Security: ${newIssuesPhrase(data.issueCount)} on ${data.dataStoreName}`;
}

/*
 * The email itself, as Markdown: the store, how sensitive it is, each new
 * issue's severity and title, and the way to the store. The store's name
 * comes from a cloud or from a person, so it is placed as text (mdText),
 * never as Markdown or HTML. Never a sample.
 */
export function buildOwnerNoticeMarkdown(data: {
  dataStoreName: string;
  sensitivity: DataSensitivity;
  issues: ReadonlyArray<Pick<OpenedIssueForIntegrations, "severity" | "title">>;
  storeLink: URL;
}): MarkdownText {
  return FeedMarkdown.join(
    [
      data.issues.length === 1
        ? mdText`**${data.dataStoreName}** (${data.sensitivity} data), which you own, has a new Data Security issue:`
        : mdText`**${data.dataStoreName}** (${data.sensitivity} data), which you own, has ${String(data.issues.length)} new Data Security issues:`,
      FeedMarkdown.bulletList(
        data.issues.map(
          (
            issue: Pick<OpenedIssueForIntegrations, "severity" | "title">,
          ): MarkdownText => {
            return mdText`**${issue.severity}**: ${issue.title}`;
          },
        ),
      ),
      mdText`[Open the store](${data.storeLink.toString()}) to see each issue and how to fix it.`,
    ],
    "\n\n",
  );
}

export default class DataSecurityIntegrations {
  public static async onIssuesOpened(data: {
    projectId: ObjectID;
    setting: DataSecuritySetting;
    issues: Array<OpenedIssueForIntegrations>;
  }): Promise<void> {
    const critical: Array<OpenedIssueForIntegrations> = data.issues.filter(
      (issue: OpenedIssueForIntegrations) => {
        return issue.severity === SecuritySeverity.Critical;
      },
    );

    if (
      critical.length > 0 &&
      data.setting.openCasesForCriticalIssues !== false
    ) {
      await this.openSecurityCases(data.projectId, critical);
    }

    if (critical.length > 0 && data.setting.raiseAlertsForCriticalIssues) {
      await this.raiseAlerts(
        data.projectId,
        data.setting.alertSeverityId || undefined,
        critical,
      );
    }

    if (critical.length > 0 && data.setting.declareIncidentsForCriticalIssues) {
      await this.declareIncidents(
        data.projectId,
        data.setting.incidentSeverityId || undefined,
        critical,
      );
    }

    if (data.setting.notifyOwners !== false) {
      await this.notifyOwners(data.projectId, data.issues);
    }
  }

  // The entity a store is in Security Operations: its cloud id, or its key.
  public static entityValueOf(issue: OpenedIssueForIntegrations): string {
    return dataStoreEntityValue(
      issue.dataStoreKey || issue.dataStoreId.toString(),
    );
  }

  private static async openSecurityCases(
    projectId: ObjectID,
    issues: Array<OpenedIssueForIntegrations>,
  ): Promise<void> {
    const signals: Array<SecurityDetectionSignal> = [];

    try {
      for (const issue of issues) {
        const link: URL =
          await DataSecurityIssueService.getIssueLinkInDashboard(
            projectId,
            issue.issueId,
          );
        const entityValue: string = this.entityValueOf(issue);

        signals.push({
          projectId,
          source: SecurityDetectionSource.DataSecurity,
          fingerprint: getDataSecurityIssueFingerprint(issue.issueId),
          title: `${issue.title}: ${issue.dataStoreName}`.slice(0, 480),
          description:
            mdText`Data Security opened a **Critical** issue on ${issue.dataStoreName} (${issue.sensitivity} data): ${issue.title}. [Open the issue](${link.toString()}).`.toString(),
          severity: OCSF_SEVERITY[issue.severity],
          eventCount: 1,
          groupValue: entityValue,
          entities: [
            { type: SecurityEntityType.DataStore, value: entityValue },
          ],
          mitreTactics: [],
          mitreTechniques: [],
          ruleName: `Data Security: ${issue.checkId}`,
          seenAt: new Date(),
        });
      }

      await SecurityCaseIngest.recordDetections(signals);
      await this.linkIssuesToCases(projectId, issues);

      for (const issue of issues) {
        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId,
          dataSecurityIssueId: issue.issueId,
          eventType: DataSecurityIssueFeedEventType.SecurityCaseOpened,
          displayColor: Red500,
          feedInfoInMarkdown:
            mdText`Sent to Security Operations: a security case about this store was opened, or the open one took this issue in.`.toString(),
        });
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not open security cases for project ${projectId.toString()}:`,
      );
      logger.error(error);
    }
  }

  private static async raiseAlerts(
    projectId: ObjectID,
    alertSeverityId: ObjectID | undefined,
    issues: Array<OpenedIssueForIntegrations>,
  ): Promise<void> {
    try {
      const severityId: ObjectID | null =
        await resolveAlertSeverityIdForProject({
          projectId,
          explicitSeverityId: alertSeverityId,
          severityLabel: "Critical",
          isSevere: true,
        });

      if (!severityId) {
        return;
      }

      const matches: Array<AlertableMatch> = [];

      for (const issue of issues) {
        const link: URL =
          await DataSecurityIssueService.getIssueLinkInDashboard(
            projectId,
            issue.issueId,
          );

        matches.push(this.matchOf(issue, link));
      }

      const outcomes: Array<DedupedRecordOutcome> = [];

      await openDedupedAlerts({
        projectId,
        alertSeverityId: severityId,
        matches,
        logLabel: `DataSecurity: project ${projectId.toString()}`,
        onOutcome: (outcome: DedupedRecordOutcome): void => {
          outcomes.push(outcome);
        },
      });

      for (const issue of issues) {
        const outcome: DedupedRecordOutcome | undefined = this.outcomeOf(
          issue,
          outcomes,
        );

        if (!outcome) {
          continue;
        }

        await this.linkIssue(issue.issueId, { alertId: outcome.recordId });

        if (outcome.isNew) {
          await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
            projectId,
            dataSecurityIssueId: issue.issueId,
            eventType: DataSecurityIssueFeedEventType.AlertRaised,
            displayColor: Red500,
            feedInfoInMarkdown:
              mdText`An alert was raised, so whoever is on call is paged. It is resolved once the issue is no longer open.`.toString(),
          });
        }
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not raise alerts for project ${projectId.toString()}:`,
      );
      logger.error(error);
    }
  }

  /*
   * An incident for each Critical issue, for a breach the project's
   * incident process should run: on-call, workspace channels, status pages
   * and a postmortem. Deduplicated like the alerts - one open incident per
   * issue - and never resolved by Data Security.
   */
  private static async declareIncidents(
    projectId: ObjectID,
    incidentSeverityId: ObjectID | undefined,
    issues: Array<OpenedIssueForIntegrations>,
  ): Promise<void> {
    try {
      const severityId: ObjectID | null =
        await resolveIncidentSeverityIdForProject({
          projectId,
          explicitSeverityId: incidentSeverityId,
          severityLabel: "Critical",
          isSevere: true,
        });

      if (!severityId) {
        logger.warn(
          `DataSecurity: project ${projectId.toString()} has no incident severities; no incident was declared.`,
        );
        return;
      }

      const matches: Array<AlertableMatch> = [];

      for (const issue of issues) {
        const link: URL =
          await DataSecurityIssueService.getIssueLinkInDashboard(
            projectId,
            issue.issueId,
          );

        matches.push(this.matchOf(issue, link));
      }

      const outcomes: Array<DedupedRecordOutcome> = [];

      await openDedupedIncidents({
        projectId,
        incidentSeverityId: severityId,
        matches,
        logLabel: `DataSecurity: project ${projectId.toString()}`,
        onOutcome: (outcome: DedupedRecordOutcome): void => {
          outcomes.push(outcome);
        },
      });

      for (const issue of issues) {
        const outcome: DedupedRecordOutcome | undefined = this.outcomeOf(
          issue,
          outcomes,
        );

        if (!outcome) {
          continue;
        }

        await this.linkIssue(issue.issueId, { incidentId: outcome.recordId });

        if (outcome.isNew) {
          await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
            projectId,
            dataSecurityIssueId: issue.issueId,
            eventType: DataSecurityIssueFeedEventType.IncidentDeclared,
            displayColor: Red500,
            feedInfoInMarkdown:
              mdText`An incident was declared, so your incident process takes over: on-call, workspace channels and status pages.`.toString(),
          });
        }
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not declare incidents for project ${projectId.toString()}:`,
      );
      logger.error(error);
    }
  }

  // What an alert or an incident for an issue says.
  private static matchOf(
    issue: OpenedIssueForIntegrations,
    link: URL,
  ): AlertableMatch {
    return {
      fingerprint: getDataSecurityIssueFingerprint(issue.issueId),
      title: `Data Security: ${issue.title} (${issue.dataStoreName})`.slice(
        0,
        MAX_TITLE_LENGTH,
      ),
      description:
        mdText`${issue.dataStoreName} holds ${issue.sensitivity} data and failed a Data Security check: ${issue.title}. [Open the issue](${link.toString()}).`.toString(),
      rootCause:
        mdText`The Data Security check "${issue.checkId}" failed on ${issue.dataStoreName}.`.toString(),
    };
  }

  private static outcomeOf(
    issue: OpenedIssueForIntegrations,
    outcomes: Array<DedupedRecordOutcome>,
  ): DedupedRecordOutcome | undefined {
    const fingerprint: string = getDataSecurityIssueFingerprint(issue.issueId);

    return outcomes.find((outcome: DedupedRecordOutcome): boolean => {
      return outcome.fingerprint === fingerprint;
    });
  }

  /*
   * The case each issue's detection is in now: the newest detection of its
   * fingerprint - an issue that opens again after its case closed is a
   * detection of a new case. Best effort: an issue without its link is
   * still in its case.
   */
  private static async linkIssuesToCases(
    projectId: ObjectID,
    issues: Array<OpenedIssueForIntegrations>,
  ): Promise<void> {
    try {
      const detections: Array<SecurityDetection> =
        await SecurityDetectionService.findBy({
          query: {
            projectId,
            fingerprint: new Includes(
              issues.map((issue: OpenedIssueForIntegrations): string => {
                return getDataSecurityIssueFingerprint(issue.issueId);
              }),
            ),
          },
          select: { fingerprint: true, securityCaseId: true },
          sort: { createdAt: SortOrder.Descending },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });
      const caseOf: Map<string, ObjectID> = new Map();

      for (const detection of detections) {
        if (
          detection.fingerprint &&
          detection.securityCaseId &&
          !caseOf.has(detection.fingerprint)
        ) {
          caseOf.set(detection.fingerprint, detection.securityCaseId);
        }
      }

      for (const issue of issues) {
        const securityCaseId: ObjectID | undefined = caseOf.get(
          getDataSecurityIssueFingerprint(issue.issueId),
        );

        if (securityCaseId) {
          await this.linkIssue(issue.issueId, { securityCaseId });
        }
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not link issues to their security cases in project ${projectId.toString()}:`,
      );
      logger.error(error);
    }
  }

  /*
   * The issue's link to what it started: OneUptime's own columns, no
   * hooks. Best effort, like the rest: the case, alert or incident is
   * there whether or not the issue links to it.
   */
  private static async linkIssue(
    issueId: ObjectID,
    data: Partial<
      Pick<DataSecurityIssue, "securityCaseId" | "alertId" | "incidentId">
    >,
  ): Promise<void> {
    try {
      await DataSecurityIssueService.updateColumnsByIdWithoutHooks({
        id: issueId,
        data: data as never,
      });
    } catch (error) {
      logger.error(
        `DataSecurity: could not link issue ${issueId.toString()} to what it started:`,
      );
      logger.error(error);
    }
  }

  // The people who own a store, directly or through a team.
  public static async getOwnerUsers(
    dataStoreId: ObjectID,
  ): Promise<Array<User>> {
    const userIds: Set<string> = new Set();
    const ownerUsers: Array<DataStoreOwnerUser> =
      await DataStoreOwnerUserService.findBy({
        query: { dataStoreId },
        select: { userId: true },
        skip: 0,
        limit: MAX_NOTIFIED_OWNERS,
        props: { isRoot: true },
      });

    for (const owner of ownerUsers) {
      if (owner.userId) {
        userIds.add(owner.userId.toString());
      }
    }

    const ownerTeams: Array<DataStoreOwnerTeam> =
      await DataStoreOwnerTeamService.findBy({
        query: { dataStoreId },
        select: { teamId: true },
        skip: 0,
        limit: MAX_NOTIFIED_OWNERS,
        props: { isRoot: true },
      });

    const teamIds: Array<ObjectID> = ownerTeams
      .map((owner: DataStoreOwnerTeam): ObjectID | undefined => {
        return owner.teamId || undefined;
      })
      .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
        return Boolean(teamId);
      });

    if (teamIds.length > 0) {
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: { teamId: new Includes(teamIds), hasAcceptedInvitation: true },
        select: { userId: true },
        skip: 0,
        limit: MAX_NOTIFIED_OWNERS,
        props: { isRoot: true },
      });

      for (const member of members) {
        if (member.userId) {
          userIds.add(member.userId.toString());
        }
      }
    }

    if (userIds.size === 0) {
      return [];
    }

    return UserService.findBy({
      query: {
        _id: new Includes(
          [...userIds].slice(0, MAX_NOTIFIED_OWNERS).map((id: string) => {
            return new ObjectID(id);
          }),
        ),
      },
      select: { _id: true, email: true, name: true },
      skip: 0,
      limit: MAX_NOTIFIED_OWNERS,
      props: { isRoot: true },
    });
  }

  private static async notifyOwners(
    projectId: ObjectID,
    issues: Array<OpenedIssueForIntegrations>,
  ): Promise<void> {
    const byStore: Map<string, Array<OpenedIssueForIntegrations>> = new Map();

    for (const issue of issues) {
      const key: string = issue.dataStoreId.toString();
      byStore.set(key, [...(byStore.get(key) || []), issue]);
    }

    for (const storeIssues of byStore.values()) {
      const first: OpenedIssueForIntegrations = storeIssues[0]!;

      try {
        const owners: Array<User> = await this.getOwnerUsers(first.dataStoreId);

        if (owners.length === 0) {
          continue;
        }

        const link: URL = await DataStoreService.getDataStoreLinkInDashboard(
          projectId,
          first.dataStoreId,
        );
        const subject: string = getOwnerNoticeSubject({
          dataStoreName: first.dataStoreName,
          issueCount: storeIssues.length,
        });
        // The template places the message as HTML: written from Markdown, never as it is.
        const message: string = await Markdown.convertToHTML(
          buildOwnerNoticeMarkdown({
            dataStoreName: first.dataStoreName,
            sensitivity: first.sensitivity,
            issues: storeIssues,
            storeLink: link,
          }).toString(),
          MarkdownContentType.Email,
        );

        for (const owner of owners) {
          if (!owner.email || !owner.id) {
            continue;
          }

          MailService.sendMail(
            {
              toEmail: owner.email,
              templateType: EmailTemplateType.SimpleMessage,
              vars: { subject, message },
              subject,
              isSubjectLiteral: true,
            },
            { projectId, userId: owner.id },
          ).catch((error: Error) => {
            logger.error(error);
          });
        }

        for (const issue of storeIssues) {
          await DataSecurityIssueService.updateColumnsByIdWithoutHooks({
            id: issue.issueId,
            data: { isOwnerNotified: true },
          });

          await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
            projectId,
            dataSecurityIssueId: issue.issueId,
            eventType: DataSecurityIssueFeedEventType.OwnersNotified,
            displayColor: Blue500,
            feedInfoInMarkdown: (owners.length === 1
              ? mdText`The store's owner was emailed about this issue.`
              : mdText`The store's ${String(owners.length)} owners were emailed about this issue.`
            ).toString(),
          });
        }
      } catch (error) {
        logger.error(
          `DataSecurity: could not notify the owners of store ${first.dataStoreId.toString()}:`,
        );
        logger.error(error);
      }
    }
  }
}
