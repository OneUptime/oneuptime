import {
  getAdminDashboardHealthLink,
  sendInstanceHealthNotificationToMasterAdmins,
} from "App/FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthNotification";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { Host } from "Common/Server/EnvironmentConfig";
import MailService from "Common/Server/Services/MailService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import URL from "Common/Types/API/URL";
import { getAuditLogExportDestinationTitle } from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";

/*
 * TELLING PEOPLE THAT AN AUDIT LOG EXPORT FAILS.
 *
 * A failing export only said so on its row, where nobody looks once it is
 * set up, and the entries it has not sent wait in the audit log only as
 * long as the audit log keeps them: each entry is deleted once it is older
 * than the retention it was recorded with (its retentionDate, set when it
 * is recorded), sent or not (#5232's follow-ups). So the people who can fix
 * it are emailed twice per run of failures:
 *
 *   - FAILING, once it has failed for 30 minutes without a success: what
 *     the destination answered, and that nothing is lost yet;
 *   - LOSING ENTRIES, a day before the oldest entry it has not sent is
 *     deleted, and never sooner than the first email: from when entries
 *     are lost, and that fixing the destination before then sends them. A
 *     longer retention keeps only the entries recorded after the change,
 *     so the email does not offer it as a way to keep these.
 *
 * A project's export emails the project's owners (ProjectService.getOwners,
 * as the other owner emails do); the instance's export, every master admin
 * (the instance health sender). Each email is due when its moment passes
 * between two tries of the export, so a run of failures sends each at most
 * once without anything stored for it, and the next success starts over.
 * Sending never throws: an email that fails is logged, and the export goes
 * on as before.
 */

// How long an export fails before its people are told.
export const AUDIT_LOG_EXPORT_FAILING_NOTICE_AFTER_IN_MINUTES: number = 30;

// How long before the oldest unsent entry is deleted that they are told again.
export const AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS: number = 24;

/*
 * The retention an entry is recorded with: the project's, 7 days when it
 * has none, and from 1 to 180 days (AuditLogRecorder's computeRetentionDate).
 */
export const AUDIT_LOG_EXPORT_DEFAULT_RETENTION_IN_DAYS: number = 7;
export const AUDIT_LOG_EXPORT_MAX_RETENTION_IN_DAYS: number = 180;

// Where each email's button opens.
export const AUDIT_LOG_EXPORT_PROJECT_PAGE_ROUTE: string =
  "settings/audit-logs/export";
export const AUDIT_LOG_EXPORT_INSTANCE_PAGE_ROUTE: string =
  "/settings/audit-log-export";

export enum AuditLogExportFailureNotice {
  Failing = "failing",
  LosingEntries = "losing-entries",
}

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;

export function toAuditLogExportRetentionInDays(
  value: number | null | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return AUDIT_LOG_EXPORT_DEFAULT_RETENTION_IN_DAYS;
  }

  return Math.max(1, Math.min(value, AUDIT_LOG_EXPORT_MAX_RETENTION_IN_DAYS));
}

// When the oldest entry the export has not sent is deleted from the audit log.
export function getAuditLogExportEntriesLostAt(data: {
  oldestUnsentAt: Date;
  retentionInDays: number;
}): Date {
  return OneUptimeDate.addRemoveDays(
    new Date(data.oldestUnsentAt),
    toAuditLogExportRetentionInDays(data.retentionInDays),
  );
}

/*
 * When the email saying entries are about to be lost is due: a day before
 * the oldest unsent entry is deleted, and never before the first email.
 * None while nothing waits to be sent.
 */
export function getAuditLogExportLosingNoticeAt(data: {
  failingSince: Date;
  oldestUnsentAt: Date | null;
  retentionInDays: number;
}): Date | null {
  if (!data.oldestUnsentAt) {
    return null;
  }

  const lostAt: number = getAuditLogExportEntriesLostAt({
    oldestUnsentAt: data.oldestUnsentAt,
    retentionInDays: data.retentionInDays,
  }).getTime();

  return new Date(
    Math.max(
      new Date(data.failingSince).getTime() +
        AUDIT_LOG_EXPORT_FAILING_NOTICE_AFTER_IN_MINUTES * MINUTE_IN_MS,
      lostAt - AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS * HOUR_IN_MS,
    ),
  );
}

/*
 * Which email a failure is due, if any: the one whose moment passed between
 * the previous try of this run of failures and this one. Both passed at once
 * (the worker was down for days) sends only the more pressing one. The
 * first failure of a run is due none: a destination that fails once and
 * works on the next try never emails anyone.
 */
export function getAuditLogExportFailureNotice(data: {
  failingSince: Date;
  // The try before this one, while the export was already failing; else null.
  previousFailureAt: Date | null | undefined;
  now: Date;
  // When the oldest entry the export has not sent was recorded; null for none.
  oldestUnsentAt: Date | null;
  retentionInDays: number;
}): AuditLogExportFailureNotice | null {
  const since: number = new Date(data.failingSince).getTime();
  const before: number =
    data.previousFailureAt &&
    new Date(data.previousFailureAt).getTime() >= since
      ? new Date(data.previousFailureAt).getTime()
      : Number.NEGATIVE_INFINITY;
  const now: number = new Date(data.now).getTime();

  const losingAt: Date | null = getAuditLogExportLosingNoticeAt({
    failingSince: data.failingSince,
    oldestUnsentAt: data.oldestUnsentAt,
    retentionInDays: data.retentionInDays,
  });

  if (losingAt && before < losingAt.getTime() && now >= losingAt.getTime()) {
    return AuditLogExportFailureNotice.LosingEntries;
  }

  const failingAt: number =
    since + AUDIT_LOG_EXPORT_FAILING_NOTICE_AFTER_IN_MINUTES * MINUTE_IN_MS;

  if (before < failingAt && now >= failingAt) {
    return AuditLogExportFailureNotice.Failing;
  }

  return null;
}

export interface AuditLogExportFailureEmail {
  subject: string;
  badgeType: "warning" | "critical";
  badgeText: string;
  details: Array<{ title: string; text: string }>;
  remediation: string;
  buttonText: string;
}

const formatDate: (date: Date) => string = (date: Date): string => {
  return OneUptimeDate.getDateAsUserFriendlyFormattedString(new Date(date));
};

/*
 * The email's words, for a project's export or the instance's. Every value
 * a person wrote (the export's name, the destination's answer) goes in as
 * text: the template escapes it.
 */
export function buildAuditLogExportFailureEmail(data: {
  notice: AuditLogExportFailureNotice;
  exportName: string;
  destinationTitle: string;
  isInstanceExport: boolean;
  failingSince: Date;
  oldestUnsentAt: Date | null;
  error: string;
  retentionInDays: number;
}): AuditLogExportFailureEmail {
  const product: string = ProductBrandingText.getProductName();
  const retentionInDays: number = toAuditLogExportRetentionInDays(
    data.retentionInDays,
  );
  const lostAt: Date | null = data.oldestUnsentAt
    ? getAuditLogExportEntriesLostAt({
        oldestUnsentAt: data.oldestUnsentAt,
        retentionInDays,
      })
    : null;
  const isLosing: boolean =
    data.notice === AuditLogExportFailureNotice.LosingEntries &&
    Boolean(lostAt);
  const name: string = data.exportName.trim() || "audit log export";
  const retention: string = data.isInstanceExport
    ? "each project's audit log retention"
    : `the audit log's retention of ${retentionInDays} ${
        retentionInDays === 1 ? "day" : "days"
      }`;

  const subject: string = data.isInstanceExport
    ? isLosing
      ? `The audit log export of your ${product} instance will start losing entries`
      : `The audit log export of your ${product} instance is failing`
    : isLosing
      ? `The audit log export ${name} will start losing entries`
      : `The audit log export ${name} is failing`;

  const details: Array<{ title: string; text: string }> = [
    { title: "Export: ", text: name },
    { title: "Destination: ", text: data.destinationTitle },
    { title: "Failing since: ", text: formatDate(data.failingSince) },
  ];

  if (data.oldestUnsentAt) {
    details.push({
      title: "Oldest entry not sent: ",
      text: formatDate(data.oldestUnsentAt),
    });
  }

  if (isLosing && lostAt) {
    details.push({
      title: "Entries lost from: ",
      text: `about ${formatDate(lostAt)}`,
    });
  }

  details.push({ title: "Why: ", text: data.error });

  const longerRetention: string = data.isInstanceExport
    ? "A longer retention in a project's Settings > Audit Logs > Settings keeps that project's entries recorded from then on for longer; it does not change when the ones already recorded are deleted."
    : "A longer retention under Project Settings > Audit Logs > Settings keeps the entries recorded from then on for longer; it does not change when the ones already recorded are deleted.";

  const remediation: string =
    isLosing && lostAt
      ? `The entries this export has not sent are deleted from the audit log once they are older than ${retention}, the first of them from about ${formatDate(
          lostAt,
        )}, and are then never sent. Fix the destination before then, and the export sends them, oldest first. ${longerRetention}`
      : `Open the export to see what the destination answered, and fix it there. Nothing is lost yet: the entries it has not sent wait in the audit log and are sent, oldest first, once the destination works again - for as long as the audit log keeps them (${retention}).`;

  return {
    subject,
    badgeType: isLosing ? "critical" : "warning",
    badgeText: isLosing ? "Entries about to be lost" : "Export failing",
    details,
    remediation,
    buttonText: "Open Audit Log Export",
  };
}

/*
 * The audit log retention that decides when this export's unsent entries
 * are deleted: its project's, or for the instance's export the shortest of
 * the projects that record an audit log (the soonest any entry it waits to
 * send can be deleted). A read that fails is reckoned with the default.
 */
export async function getAuditLogExportRetentionInDays(
  item: AuditLogExport,
): Promise<number> {
  try {
    if (item.projectId) {
      const project: Project | null = await ProjectService.findOneById({
        id: item.projectId,
        select: { auditLogsRetentionInDays: true },
        props: { isRoot: true },
      });

      return toAuditLogExportRetentionInDays(project?.auditLogsRetentionInDays);
    }

    const shortest: Project | null = await ProjectService.findOneBy({
      query: { enableAuditLogs: true },
      select: { auditLogsRetentionInDays: true },
      sort: { auditLogsRetentionInDays: SortOrder.Ascending },
      props: { isRoot: true },
    });

    return toAuditLogExportRetentionInDays(shortest?.auditLogsRetentionInDays);
  } catch (error) {
    logger.warn(
      "AuditLogExport: could not read the audit log retention; reckoning with the default.",
    );
    logger.warn(error);
    return AUDIT_LOG_EXPORT_DEFAULT_RETENTION_IN_DAYS;
  }
}

export interface AuditLogExportFailureNotification {
  item: AuditLogExport;
  notice: AuditLogExportFailureNotice;
  failingSince: Date;
  oldestUnsentAt: Date | null;
  error: string;
  retentionInDays: number;
}

// Who is told, and how: the seam the exporter's tests replace.
export interface AuditLogExportNotifier {
  getRetentionInDays(item: AuditLogExport): Promise<number>;
  notifyFailure(data: AuditLogExportFailureNotification): Promise<void>;
}

const emailVars: (
  email: AuditLogExportFailureEmail,
  extra: Dictionary<string>,
) => Dictionary<string> = (
  email: AuditLogExportFailureEmail,
  extra: Dictionary<string>,
): Dictionary<string> => {
  const vars: Dictionary<string> = {
    subject: email.subject,
    badgeType: email.badgeType,
    badgeText: email.badgeText,
    oneuptimeHost: Host,
    remediation: email.remediation,
    healthPageButtonText: email.buttonText,
    ...extra,
  };

  email.details
    .slice(0, 6)
    .forEach((detail: { title: string; text: string }, index: number): void => {
      vars[`detail${index + 1}Title`] = detail.title;
      vars[`detail${index + 1}Text`] = detail.text;
    });

  return vars;
};

export const auditLogExportEmailNotifier: AuditLogExportNotifier = {
  getRetentionInDays: getAuditLogExportRetentionInDays,

  notifyFailure: async (
    data: AuditLogExportFailureNotification,
  ): Promise<void> => {
    const email: AuditLogExportFailureEmail = buildAuditLogExportFailureEmail({
      notice: data.notice,
      exportName: data.item.name || "",
      destinationTitle:
        getAuditLogExportDestinationTitle(data.item.destinationType) ||
        String(data.item.destinationType || ""),
      isInstanceExport: !data.item.projectId,
      failingSince: data.failingSince,
      oldestUnsentAt: data.oldestUnsentAt,
      error: data.error,
      retentionInDays: data.retentionInDays,
    });

    try {
      if (!data.item.projectId) {
        await sendInstanceHealthNotificationToMasterAdmins({
          templateType: EmailTemplateType.AuditLogExportFailed,
          check: {
            isBreaching: true,
            isCritical: email.badgeType === "critical",
            subject: email.subject,
            badgeText: email.badgeText,
            details: email.details,
            remediation: email.remediation,
            breachMessage: data.error,
            resolvedMessage: "",
          },
          healthPageLink: getAdminDashboardHealthLink(
            AUDIT_LOG_EXPORT_INSTANCE_PAGE_ROUTE,
          ),
          healthPageButtonText: email.buttonText,
        });
        return;
      }

      const projectId: ObjectID = data.item.projectId;
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: { name: true },
        props: { isRoot: true },
      });
      const owners: Array<User> = await ProjectService.getOwners(projectId);
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
      const link: string = URL.fromString(dashboardUrl.toString())
        .addRoute(
          `/${projectId.toString()}/${AUDIT_LOG_EXPORT_PROJECT_PAGE_ROUTE}`,
        )
        .toString();
      const vars: Dictionary<string> = emailVars(email, {
        healthPageLink: link,
        reasonText: `You are receiving this email because you are an owner of the project ${
          project?.name || projectId.toString()
        }, which exports its audit log.`,
      });

      for (const owner of owners) {
        if (!owner.email) {
          continue;
        }

        try {
          await MailService.sendMail(
            {
              toEmail: owner.email,
              templateType: EmailTemplateType.AuditLogExportFailed,
              subject: email.subject,
              isSubjectLiteral: true,
              vars,
            },
            {
              projectId: projectId,
              userId: owner.id || undefined,
            },
          );
        } catch (error) {
          logger.error(
            "AuditLogExport: could not email a project owner about a failing export.",
          );
          logger.error(error);
        }
      }
    } catch (error) {
      logger.error(
        "AuditLogExport: could not tell anyone that an export is failing.",
      );
      logger.error(error);
    }
  },
};
