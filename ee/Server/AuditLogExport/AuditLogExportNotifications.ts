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
import {
  AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS,
  getAuditLogRetentionDate,
  readAuditLogRetentionInDays,
} from "Common/Types/AuditLog/AuditLogRetention";
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
 *   - LOSING ENTRIES, a day before the first of the entries it has not sent
 *     is deleted, and never sooner than the first email: from when entries
 *     are lost, and that fixing the destination before then sends them. A
 *     longer retention keeps only the entries recorded after the change,
 *     so the email does not offer it as a way to keep these.
 *
 * When that moment has already passed by the try the email goes on - the
 * export waits to send entries older than the retention they were recorded
 * with, which the audit log keeps until a whole part of it has expired -
 * the "losing entries" email says they are being lost now, and asks to fix
 * the destination now rather than "before then" (#7185).
 *
 * When that first entry is deleted is read from the entries themselves:
 * the soonest retentionDate stamped on the ones the export has not sent
 * (AuditLogService.findSoonestRetentionDateForExport). Reckoned from the
 * retention as it is now, a retention lengthened from 7 days to 30 while
 * entries waited put the email 22 days after they were gone (#6563). Only
 * when the stamps cannot be read is it reckoned that way, from the oldest
 * entry waiting (getAuditLogExportEntriesLostAt). So the emails say when
 * the entries waiting are deleted, never "a retention of N days" that they
 * may not have been recorded with.
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

// How long before the first unsent entry is deleted that they are told again.
export const AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS: number = 24;

/*
 * The retention an entry is recorded with, and when it is deleted, are the
 * recorder's own (Common/Types/AuditLog/AuditLogRetention): the project's,
 * from 7 to 180 days, and 7 when it has none. Reckoning them the same way,
 * when the stamps cannot be read, is the whole point: for a retention the
 * API took outside that range, the recorder and this module once disagreed,
 * and the "losing entries" email came after the entries were gone (#6383).
 */

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

/*
 * When the first of the entries the export has not sent is deleted from the
 * audit log: the soonest retentionDate stamped on them, as the audit log
 * answered it (soonestRetentionDate). Each entry is deleted on its own
 * stamp, so a retention changed since they were recorded changes nothing
 * here.
 *
 * Without the stamps - the audit log could not answer, or answered that
 * none waits while a batch had just been read - it is reckoned as it was
 * before #6563: the retentionDate the recorder stamps on an entry recorded
 * when the oldest one waiting was, with the retention as it is now. That
 * is the same moment while the retention has not changed; lengthened, it
 * is later than the real one, so it is the reckoning of last resort.
 */
export function getAuditLogExportEntriesLostAt(data: {
  oldestUnsentAt: Date;
  retentionInDays: number;
  soonestRetentionDate?: Date | null | undefined;
}): Date {
  if (data.soonestRetentionDate) {
    return new Date(data.soonestRetentionDate);
  }

  return getAuditLogRetentionDate({
    recordedAt: data.oldestUnsentAt,
    retentionInDays: data.retentionInDays,
  });
}

/*
 * When the email saying entries are about to be lost is due: a day before
 * the first unsent entry is deleted (entriesLostAt), and never before the
 * first email. None while nothing waits to be sent.
 */
export function getAuditLogExportLosingNoticeAt(data: {
  failingSince: Date;
  // When the first of the entries the export has not sent is deleted; null while none waits.
  entriesLostAt: Date | null;
}): Date | null {
  if (!data.entriesLostAt) {
    return null;
  }

  const lostAt: number = new Date(data.entriesLostAt).getTime();

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
  // When the first of the entries the export has not sent is deleted; null for none waiting.
  entriesLostAt: Date | null;
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
    entriesLostAt: data.entriesLostAt,
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
 * Which of the three emails the words are: the export is failing and
 * nothing is lost yet; it will start losing entries from a date still
 * ahead; or it is losing them, since a date that has passed.
 */
type AuditLogExportEmailStage = "failing" | "losing" | "lost";

// What the subject says the export does, after its name.
const SUBJECT_ENDINGS: Record<AuditLogExportEmailStage, string> = {
  failing: "is failing",
  losing: "will start losing entries",
  lost: "is losing entries",
};

const BADGE_TEXTS: Record<AuditLogExportEmailStage, string> = {
  failing: "Export failing",
  losing: "Entries about to be lost",
  lost: "Entries being lost",
};

/*
 * The email's words, for a project's export or the instance's. Every value
 * a person wrote (the export's name, the destination's answer) goes in as
 * text: the template escapes it.
 *
 * The subject names the export in quotes - an instance can have several
 * exports, and a name such as SIEM webhook ran into the sentence around it
 * - and an export with no name is "an audit log export", never "the audit
 * log export audit log export". The remediation says what to do first,
 * then what happens if nobody does (fu-platform's review).
 *
 * How long the entries waiting are kept is said as a date - when the first
 * of them is deleted - never as the retention's days: they keep the
 * retention they were recorded with, which a project may have changed since
 * (#6563). Only with nothing waiting does the "failing" email give the days
 * the audit log keeps an entry recorded from now on.
 *
 * That date can already have passed by the try the email goes on (`now`):
 * the audit log drops a whole part of its entries only once every entry in
 * it has passed its stamp, so the export can be waiting to send entries
 * older than their retention. Then the email says entries are being lost,
 * since about that date, and to fix the destination now so the export sends
 * the ones still kept - never "will start losing entries" or "fix it before
 * then" for a date nobody can still act before (#7185). Any email with such
 * a date says so, the "failing" one too, which could otherwise say nothing
 * is lost yet. A date still ahead, even by a second, keeps the words it had.
 */
export function buildAuditLogExportFailureEmail(data: {
  notice: AuditLogExportFailureNotice;
  exportName: string;
  destinationTitle: string;
  isInstanceExport: boolean;
  failingSince: Date;
  oldestUnsentAt: Date | null;
  // When the first of the entries the export has not sent is deleted (getAuditLogExportEntriesLostAt); null while none waits.
  entriesLostAt: Date | null;
  // The time of the try the email goes on: whether entriesLostAt has passed.
  now: Date;
  error: string;
  // The project's retention as it is now: how long an entry recorded from now on is kept.
  retentionInDays: number;
}): AuditLogExportFailureEmail {
  const product: string = ProductBrandingText.getProductName();
  // Never under 7: "days", never "day".
  const retentionInDays: number = readAuditLogRetentionInDays(
    data.retentionInDays,
  );
  const lostAt: Date | null = data.entriesLostAt
    ? new Date(data.entriesLostAt)
    : null;
  /*
   * Nothing waiting cannot say from when, so it reads as failing. The first
   * of the entries waiting at or past its stamp by the try is being lost
   * now, whichever notice is due.
   */
  const stage: AuditLogExportEmailStage = !lostAt
    ? "failing"
    : lostAt.getTime() <= new Date(data.now).getTime()
      ? "lost"
      : data.notice === AuditLogExportFailureNotice.LosingEntries
        ? "losing"
        : "failing";
  const givenName: string = data.exportName.trim();
  const name: string = givenName || "audit log export";
  const days: string = `${retentionInDays} days`;

  // "The audit log export "SIEM webhook"", or "An audit log export".
  const which: string = givenName
    ? `The audit log export "${givenName}"`
    : "An audit log export";
  const whose: string = data.isInstanceExport
    ? ` of your ${product} instance`
    : "";
  const subject: string = `${which}${whose} ${SUBJECT_ENDINGS[stage]}`;

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

  if (stage !== "failing" && lostAt) {
    details.push({
      title: stage === "lost" ? "Entries lost since: " : "Entries lost from: ",
      text: `about ${formatDate(lostAt)}`,
    });
  }

  details.push({ title: "Why: ", text: data.error });

  const longerRetention: string = data.isInstanceExport
    ? "A longer retention in a project's Settings > Audit Logs > Settings only keeps that project's entries recorded after the change."
    : "A longer retention (Project Settings > Audit Logs > Settings) only keeps the entries recorded after the change.";

  /*
   * Why nothing is lost yet: when the entries waiting start to be deleted,
   * or - with none waiting - how long an entry recorded from now on is kept.
   */
  const keptFor: string = lostAt
    ? `the audit log starts deleting them from about ${formatDate(lostAt)}.`
    : data.isInstanceExport
      ? "entries stay in each project's audit log for as long as that project's retention."
      : `the audit log keeps each entry for ${days}.`;

  /*
   * Failing: what to do, then why nothing is lost yet. Losing entries: from
   * when, what to do before then, and why a longer retention does not help
   * the entries already waiting. Being lost already: what to do now, which
   * cannot wait, then since when, and the same about a longer retention.
   */
  const remediation: string =
    stage === "lost" && lostAt
      ? `Fix the destination now, and the export sends the entries the audit log still keeps, oldest first. Since about ${formatDate(lostAt)}, the entries this export has not sent are being deleted as they pass the audit log retention they were recorded with, and are never sent. ${longerRetention}`
      : stage === "losing" && lostAt
        ? `From about ${formatDate(lostAt)}, the entries this export has not sent are deleted as they pass the audit log retention they were recorded with, and are never sent. Fix the destination before then, and the export sends them, oldest first. ${longerRetention}`
        : `Fix the destination, and the export sends every entry waiting for it, oldest first. Nothing is lost yet: ${keptFor}`;

  return {
    subject,
    badgeType: stage === "failing" ? "warning" : "critical",
    badgeText: BADGE_TEXTS[stage],
    details,
    remediation,
    buttonText: "Open Audit Log Export",
  };
}

/*
 * The audit log retention as it is now, which entries recorded from now on
 * are kept for: its project's, or for the instance's export the shortest of
 * the projects that record an audit log (the soonest any entry it waits to
 * send can be deleted). The entries already waiting keep the retention they
 * were recorded with, read from their stamps; this one is what the
 * "failing" email gives when none waits, and what the moment they are lost
 * is reckoned from when the stamps cannot be read
 * (getAuditLogExportEntriesLostAt). Each is read by the recorder's rule, so
 * a value the API once took outside 7 to 180 is reckoned as the recorder
 * keeps it; the rule never reads a smaller stored value as a longer
 * retention, so the smallest stored value is the shortest retention. A read
 * that fails is reckoned with the default.
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

      return readAuditLogRetentionInDays(project?.auditLogsRetentionInDays);
    }

    const shortest: Project | null = await ProjectService.findOneBy({
      query: { enableAuditLogs: true },
      select: { auditLogsRetentionInDays: true },
      sort: { auditLogsRetentionInDays: SortOrder.Ascending },
      props: { isRoot: true },
    });

    return readAuditLogRetentionInDays(shortest?.auditLogsRetentionInDays);
  } catch (error) {
    logger.warn(
      "AuditLogExport: could not read the audit log retention; reckoning with the default.",
    );
    logger.warn(error);
    return AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS;
  }
}

export interface AuditLogExportFailureNotification {
  item: AuditLogExport;
  notice: AuditLogExportFailureNotice;
  failingSince: Date;
  oldestUnsentAt: Date | null;
  // When the first of the entries the export has not sent is deleted; null while none waits.
  entriesLostAt: Date | null;
  // The time of the try the notice is due on: the email says whether entriesLostAt has passed by then.
  now: Date;
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
      entriesLostAt: data.entriesLostAt,
      now: data.now,
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
