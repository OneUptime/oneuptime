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
import ProjectService from "../../Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import {
  queueDataSecurityAiEvaluation,
  queueDataSecurityOwnerNotice,
} from "./DataSecurityJobs";
import OneUptimeDate from "../../../Types/Date";
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
import DatabaseConfig from "../../DatabaseConfig";
import { Blue500, Red500 } from "../../../Types/BrandColors";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import Includes from "../../../Types/BaseDatabase/Includes";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import {
  AiAffectedResourceKind,
  AiAffectedResourceRef,
} from "../../../Types/AI/AiAffectedResources";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { dataStoreEntityValue } from "../../../Types/DataSecurity/DataStoreKey";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { isTelemetryFindingCheck } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
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
 *    with the issue and the data types - never a sample. While OneUptime AI
 *    works on new issues, the email waits for its analysis - at most ten
 *    minutes - and carries each analyzed issue's verdict and shortest path,
 *    each owner reading only what they may read (DataSecurityOwnerNotice,
 *    #10369).
 *  - OneUptime AI works on every new and reopened issue, as the project's
 *    Data Security AI rules say, while its AI switches are on
 *    (DataSecurityAiEngine, #10364): one queued job per issue.
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
  /*
   * What the store is in OneUptime, when it was found there: the cloud
   * resource it was discovered from, the database server it is, the service
   * whose telemetry it is. The alert or incident raised for the issue is
   * linked to them, so its investigation reaches them and auto-remediation
   * can fix them through their AI agents.
   */
  cloudResourceId?: ObjectID | undefined;
  databaseServerId?: ObjectID | undefined;
  serviceId?: ObjectID | undefined;
}

/*
 * What an alert or incident for an issue is about: the store's records in
 * OneUptime (OpenedIssueForIntegrations), each one it has.
 */
export function getIssueAffectedResources(
  issue: Pick<
    OpenedIssueForIntegrations,
    "cloudResourceId" | "databaseServerId" | "serviceId"
  >,
): Array<AiAffectedResourceRef> {
  const refs: Array<AiAffectedResourceRef> = [];

  if (issue.cloudResourceId) {
    refs.push({
      kind: AiAffectedResourceKind.CloudResource,
      id: issue.cloudResourceId.toString(),
    });
  }

  if (issue.databaseServerId) {
    refs.push({
      kind: AiAffectedResourceKind.DatabaseServer,
      id: issue.databaseServerId.toString(),
    });
  }

  if (issue.serviceId) {
    refs.push({
      kind: AiAffectedResourceKind.Service,
      id: issue.serviceId.toString(),
    });
  }

  return refs;
}

const OCSF_SEVERITY: Readonly<Record<SecuritySeverity, OcsfSeverity>> = {
  [SecuritySeverity.Critical]: OcsfSeverity.Critical,
  [SecuritySeverity.High]: OcsfSeverity.High,
  [SecuritySeverity.Medium]: OcsfSeverity.Medium,
  [SecuritySeverity.Low]: OcsfSeverity.Low,
};

// The most owners one store's notice is sent to.
const MAX_NOTIFIED_OWNERS: number = 50;

// The most open issues of one store worked on again when new findings come.
const MAX_REWORKED_ISSUES: number = 20;

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
 *
 * Under an issue OneUptime AI analyzed, its analysis in two lines - the
 * verdict and the shortest path (#10369) - when the reader may read them:
 * `analysisLines`, by the issue's place in `issues`.
 */
export function buildOwnerNoticeMarkdown(data: {
  dataStoreName: string;
  sensitivity: DataSensitivity;
  issues: ReadonlyArray<Pick<OpenedIssueForIntegrations, "severity" | "title">>;
  storeLink: URL;
  analysisLines?: ReadonlyArray<ReadonlyArray<MarkdownText>> | undefined;
  /*
   * Data Security → AI, when OneUptime AI works on the project's new issues
   * on its own (#10364): the owners hear where what it proposes waits.
   */
  aiLink?: URL | undefined;
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
            index: number,
          ): MarkdownText => {
            const lines: ReadonlyArray<MarkdownText> =
              data.analysisLines?.[index] || [];

            // Each line under its issue: a hard break, then the bullet's indent.
            return FeedMarkdown.join(
              [mdText`**${issue.severity}**: ${issue.title}`, ...lines],
              "  \n  ",
            );
          },
        ),
      ),
      mdText`[Open the store](${data.storeLink.toString()}) to see each issue and how to fix it.`,
      ...(data.aiLink
        ? [
            mdText`OneUptime AI looks at new issues as your AI rules allow. Anything it proposes waits for you on [Data Security → AI](${data.aiLink.toString()}), and anything it does is on the issue's timeline.`,
          ]
        : []),
    ],
    "\n\n",
  );
}

/*
 * What OneUptime AI's analysis of an issue adds to one owner's email
 * (#10369): its lines, or none - no analysis, or nothing of it the owner
 * may read.
 */
export type OwnerNoticeAnalysisLines = (
  owner: User,
  issue: OpenedIssueForIntegrations,
) => Promise<Array<MarkdownText>>;

// Data Security → AI in the Dashboard, for a project.
export async function getDataSecurityAiLinkInDashboard(
  projectId: ObjectID,
): Promise<URL> {
  const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

  return URL.fromString(dashboardUrl.toString()).addRoute(
    `/${projectId.toString()}/data-security/ai`,
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

    // Nothing opened, nothing to read: the project's switches are left alone.
    const isAiWorking: boolean =
      data.issues.length > 0
        ? await this.isAutomaticAiOn(data.projectId)
        : false;

    if (data.setting.notifyOwners !== false) {
      /*
       * While OneUptime AI works on new issues, the owners' email waits for
       * its analysis, so it carries it (#10369); with it off, the email
       * goes now, as it always did.
       */
      if (isAiWorking) {
        await this.holdOwnerNotices(data.projectId, data.issues);
      } else {
        await this.notifyOwners(data.projectId, data.issues, false);
      }
    }

    if (isAiWorking) {
      await this.queueAiWork(data.projectId, data.issues);
    }
  }

  /*
   * Whether OneUptime AI works on the project's new issues on its own:
   * Enable AI on, and "Work on new Data Security issues" on. Read once per
   * batch of opened issues; a read that fails is off, and the issues open
   * and their owners hear of them either way.
   */
  public static async isAutomaticAiOn(projectId: ObjectID): Promise<boolean> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          _id: true,
          enableAi: true,
          enableAutomaticDataSecurityAi: true,
        },
        props: { isRoot: true },
      });

      return Boolean(
        project &&
          project.enableAi !== false &&
          project.enableAutomaticDataSecurityAi === true,
      );
    } catch (error) {
      logger.error(
        `DataSecurity: could not read whether OneUptime AI works on the new issues of project ${projectId.toString()}:`,
      );
      logger.error(error);
      return false;
    }
  }

  /*
   * Each store's owners' email, held while OneUptime AI works on its new
   * issues (#10369): one queued job per store, which waits for the work and
   * then sends (DataSecurityOwnerNotice). One that cannot be queued is
   * sent now, without the analysis.
   */
  private static async holdOwnerNotices(
    projectId: ObjectID,
    issues: Array<OpenedIssueForIntegrations>,
  ): Promise<void> {
    const openedAt: Date = OneUptimeDate.getCurrentDate();
    const byStore: Map<string, Array<OpenedIssueForIntegrations>> = new Map();

    for (const issue of issues) {
      const key: string = issue.dataStoreId.toString();
      byStore.set(key, [...(byStore.get(key) || []), issue]);
    }

    for (const storeIssues of byStore.values()) {
      const isHeld: boolean = await queueDataSecurityOwnerNotice({
        projectId,
        dataStoreId: storeIssues[0]!.dataStoreId,
        issueIds: storeIssues.map(
          (issue: OpenedIssueForIntegrations): ObjectID => {
            return issue.issueId;
          },
        ),
        openedAt,
        attempt: 1,
      });

      if (!isHeld) {
        await this.notifyOwners(projectId, storeIssues, true);
      }
    }
  }

  /*
   * New findings on a store: each of its telemetry issues that is open
   * already is worked on again by OneUptime AI (#10366), so a secret that
   * starts showing up in another attribute of a service is contained as
   * one in an issue that just opened would be. Only while OneUptime AI
   * works on issues on its own; one job per issue, however many scans.
   */
  public static async onNewTelemetryFindings(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<void> {
    try {
      if (!(await this.isAutomaticAiOn(data.projectId))) {
        return;
      }

      const issues: Array<DataSecurityIssue> =
        await DataSecurityIssueService.findBy({
          query: {
            projectId: data.projectId,
            dataStoreId: data.dataStoreId,
            status: DataSecurityIssueStatus.Open,
          },
          select: { _id: true, checkId: true },
          skip: 0,
          limit: MAX_REWORKED_ISSUES,
          props: { isRoot: true },
        });

      for (const issue of issues) {
        if (issue.id && isTelemetryFindingCheck(issue.checkId)) {
          await queueDataSecurityAiEvaluation({
            projectId: data.projectId,
            dataSecurityIssueId: issue.id,
          });
        }
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not have OneUptime AI work again on the telemetry issues of store ${data.dataStoreId.toString()}:`,
      );
      logger.error(error);
    }
  }

  /*
   * OneUptime AI works on every issue that opened, or opened again, as the
   * project's Data Security AI rules say (DataSecurityAiEngine, #10364) -
   * while Enable AI and "Work on new Data Security issues" are on
   * (isAutomaticAiOn). Each issue is its own job; with either switch off
   * nothing is queued, and Data Security runs as it always did.
   */
  private static async queueAiWork(
    projectId: ObjectID,
    issues: Array<OpenedIssueForIntegrations>,
  ): Promise<void> {
    if (issues.length === 0) {
      return;
    }

    try {
      for (const issue of issues) {
        await queueDataSecurityAiEvaluation({
          projectId,
          dataSecurityIssueId: issue.issueId,
        });
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not queue OneUptime AI's work on the new issues of project ${projectId.toString()}:`,
      );
      logger.error(error);
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
      affectedResources: getIssueAffectedResources(issue),
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

  /*
   * A store's owners who may be told about it: the people getOwnerUsers
   * names who have joined the project. A direct owner row can name someone
   * only invited (ProjectScopedReferenceValidator takes a pending
   * membership, and the people pickers offer invitees), and nobody is
   * emailed about a project's data before they join it - as a record's
   * owner-added notices tell accepted members only
   * (TeamMemberService.filterUsersToProjectMembers, #10697). An owner
   * through a team is one already: getOwnerUsers reads accepted members.
   */
  public static async getOwnersToNotify(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<Array<User>> {
    const owners: Array<User> = await this.getOwnerUsers(data.dataStoreId);

    if (owners.length === 0) {
      return [];
    }

    return await TeamMemberService.filterUsersToProjectMembers({
      projectId: data.projectId,
      users: owners,
    });
  }

  /*
   * Emails each store's owners about its new issues: one email per owner,
   * the same for all of them - or, with `getAnalysisLines` (a notice held
   * for OneUptime AI's analysis, #10369), each owner's own, with the
   * analysis lines they may read under each issue. While OneUptime AI works
   * on new issues (`isAiWorking`), it says where what AI proposes waits.
   */
  public static async notifyOwners(
    projectId: ObjectID,
    issues: Array<OpenedIssueForIntegrations>,
    isAiWorking: boolean,
    getAnalysisLines?: OwnerNoticeAnalysisLines | undefined,
  ): Promise<void> {
    const aiLink: URL | undefined = isAiWorking
      ? await getDataSecurityAiLinkInDashboard(projectId)
      : undefined;

    const byStore: Map<string, Array<OpenedIssueForIntegrations>> = new Map();

    for (const issue of issues) {
      const key: string = issue.dataStoreId.toString();
      byStore.set(key, [...(byStore.get(key) || []), issue]);
    }

    for (const storeIssues of byStore.values()) {
      const first: OpenedIssueForIntegrations = storeIssues[0]!;

      try {
        // Its owners who have joined the project: never someone only invited.
        const owners: Array<User> = await this.getOwnersToNotify({
          projectId,
          dataStoreId: first.dataStoreId,
        });

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
        const messageWith: (
          analysisLines?: ReadonlyArray<ReadonlyArray<MarkdownText>>,
        ) => Promise<string> = async (
          analysisLines?: ReadonlyArray<ReadonlyArray<MarkdownText>>,
        ): Promise<string> => {
          return await Markdown.convertToHTML(
            buildOwnerNoticeMarkdown({
              dataStoreName: first.dataStoreName,
              sensitivity: first.sensitivity,
              issues: storeIssues,
              storeLink: link,
              analysisLines,
              aiLink,
            }).toString(),
            MarkdownContentType.Email,
          );
        };
        const sharedMessage: string = await messageWith();

        for (const owner of owners) {
          if (!owner.email || !owner.id) {
            continue;
          }

          const message: string = getAnalysisLines
            ? await messageWith(
                await Promise.all(
                  storeIssues.map(
                    (
                      issue: OpenedIssueForIntegrations,
                    ): Promise<Array<MarkdownText>> => {
                      return getAnalysisLines(owner, issue).catch(
                        (error: Error): Array<MarkdownText> => {
                          logger.error(error);
                          return [];
                        },
                      );
                    },
                  ),
                ),
              )
            : sharedMessage;

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
