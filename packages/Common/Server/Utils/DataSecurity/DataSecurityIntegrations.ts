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
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../SecurityCase/SecurityCaseIngest";
import {
  AlertableMatch,
  openDedupedAlerts,
  resolveAlertSeverityIdForProject,
} from "../SecurityEvent/SecurityEventAlerting";
import logger from "../Logger";
import URL from "../../../Types/API/URL";
import { Blue500, Red500 } from "../../../Types/BrandColors";
import Includes from "../../../Types/BaseDatabase/Includes";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { dataStoreEntityValue } from "../../../Types/DataSecurity/DataStoreKey";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";

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
 *    whoever is on call through the alert's own rules.
 *  - Every new issue is emailed to its store's owners (on by default),
 *    with the issue and the data types - never a sample.
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

    if (critical.length > 0 && data.setting.openCasesForCriticalIssues !== false) {
      await this.openSecurityCases(data.projectId, critical);
    }

    if (critical.length > 0 && data.setting.raiseAlertsForCriticalIssues) {
      await this.raiseAlerts(
        data.projectId,
        data.setting.alertSeverityId || undefined,
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
        const link: URL = await DataSecurityIssueService.getIssueLinkInDashboard(
          projectId,
          issue.issueId,
        );
        const entityValue: string = this.entityValueOf(issue);

        signals.push({
          projectId,
          source: SecurityDetectionSource.DataSecurity,
          fingerprint: `data-security-issue:${issue.issueId.toString()}`,
          title: `${issue.title}: ${issue.dataStoreName}`.slice(0, 480),
          description: mdText`Data Security opened a **Critical** issue on ${issue.dataStoreName} (${issue.sensitivity} data): ${issue.title}. [Open the issue](${link.toString()}).`.toString(),
          severity: OCSF_SEVERITY[issue.severity],
          eventCount: 1,
          groupValue: entityValue,
          entities: [{ type: SecurityEntityType.DataStore, value: entityValue }],
          mitreTactics: [],
          mitreTechniques: [],
          ruleName: `Data Security: ${issue.checkId}`,
          seenAt: new Date(),
        });
      }

      await SecurityCaseIngest.recordDetections(signals);

      for (const issue of issues) {
        await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
          projectId,
          dataSecurityIssueId: issue.issueId,
          eventType: DataSecurityIssueFeedEventType.SecurityCaseOpened,
          displayColor: Red500,
          feedInfoInMarkdown: mdText`Sent to Security Operations: a security case about this store was opened, or the open one took this issue in.`.toString(),
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

        matches.push({
          fingerprint: `data-security-issue:${issue.issueId.toString()}`,
          title: `Data Security: ${issue.title} (${issue.dataStoreName})`,
          description: mdText`${issue.dataStoreName} holds ${issue.sensitivity} data and failed a Data Security check: ${issue.title}. [Open the issue](${link.toString()}).`.toString(),
          rootCause: mdText`The Data Security check "${issue.checkId}" failed on ${issue.dataStoreName}.`.toString(),
        });
      }

      const opened: number = await openDedupedAlerts({
        projectId,
        alertSeverityId: severityId,
        matches,
        logLabel: `DataSecurity: project ${projectId.toString()}`,
      });

      if (opened > 0) {
        for (const issue of issues) {
          await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
            projectId,
            dataSecurityIssueId: issue.issueId,
            eventType: DataSecurityIssueFeedEventType.AlertRaised,
            displayColor: Red500,
            feedInfoInMarkdown: mdText`An alert was raised, so whoever is on call is paged.`.toString(),
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
        const subject: string = `Data Security: ${storeIssues.length} new issue(s) on ${first.dataStoreName}`;
        const lines: Array<string> = storeIssues.map(
          (issue: OpenedIssueForIntegrations): string => {
            return `- ${issue.severity}: ${issue.title}`;
          },
        );
        const message: string = [
          `${first.dataStoreName} (${first.sensitivity} data), which you own, has new Data Security issues:`,
          "",
          ...lines,
          "",
          `Open the store to see each issue and how to fix it: ${link.toString()}`,
        ].join("\n");

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
            feedInfoInMarkdown: mdText`The store's ${owners.length} owner(s) were emailed about this issue.`.toString(),
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
