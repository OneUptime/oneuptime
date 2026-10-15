import Alert from "../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import ObjectID from "../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import EmailThreadHeaders from "../../../Utils/Email/EmailThreadHeaders";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import AlertInternalNoteService from "../../Services/AlertInternalNoteService";
import AlertService from "../../Services/AlertService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentService from "../../Services/IncidentService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";

/*
 * AN INCIDENT FOR EVERY EMAIL.
 *
 * A monitor holds one incident open per criteria: while it is open, the
 * criteria matching again opens nothing new. That is right for a system whose
 * emails report one state - "the backup failed", then "the backup failed"
 * again - and wrong when every email is a report of its own: people raising
 * incidents by emailing an address, or a tool that sends one email per
 * problem. A criteria of an Incoming Email monitor can say so
 * (MonitorCriteriaInstance.openForEveryEmail), and then each email that
 * matches it opens an incident (and an alert) of its own.
 *
 * Each record such an email opens carries the email's fingerprint
 * (seriesFingerprint, the column grouped monitors key their per-series
 * records by): a hash of its Message-ID. That is what tells an email from
 * another, so:
 *
 *   - the same email delivered twice - a retried delivery, a mailing list it
 *     reached the address through twice - opens one, as long as anything it
 *     opened is still there, open or resolved;
 *   - a reply - its In-Reply-To or References name an email that opened an
 *     incident or an alert on this monitor - is added to that incident and
 *     alert as a private note, open or resolved, and opens nothing: a thread
 *     is one report, and a "Thanks!" pages nobody;
 *   - an automatic reply (an out-of-office message, a bounce) opens nothing;
 *   - a monitor opens at most MAX_OPENED_FROM_EMAILS_PER_HOUR incidents (and
 *     as many alerts) from emails in an hour, so a mail loop, or a stranger
 *     who learnt the address, cannot page the team without end.
 *
 * Only an email that has just arrived does any of this. A scheduled check -
 * the Email Received criteria's look for email that should have come - has
 * no email of its own, and its criteria opens one record at a time as
 * always.
 *
 * Nothing else changes: the records are created by the same creators, from
 * the same templates ({{emailSubject}}, {{emailBody}}, ...), and resolve the
 * same way - by hand, or with Auto Resolve on when a later email matches a
 * different criteria. A later email matching the same criteria never
 * resolves the earlier ones: it is a report of its own.
 */

/*
 * The most incidents - and, apart, the most alerts - one monitor opens from
 * emails in an hour. Far more than people report by email in an hour, and a
 * bound on what a mail loop or a flood of email can do.
 */
export const MAX_OPENED_FROM_EMAILS_PER_HOUR: number = 20;

/*
 * The longest reply text a note quotes. A reply quotes the whole thread
 * below it; the newest text is at the top.
 */
export const MAX_REPLY_NOTE_TEXT_LENGTH: number = 10000;

// The label an email's fingerprint is computed from.
export const EMAIL_MESSAGE_ID_FINGERPRINT_LABEL: string = "email.messageId";

/*
 * The most incidents (and, apart, alerts) read for one email: what it and
 * the emails it answers opened. Each opens one per template of its criteria.
 */
const MAX_RECORDS_READ_FOR_AN_EMAIL: number = 100;

/*
 * What the incident and alert creators are handed for one email. Each is the
 * email's own match (open one), an empty list (open none), or undefined: the
 * criteria opens one at a time, as it always has.
 */
export interface EveryEmailMatches {
  incidents?: Array<PerSeriesCriteriaMatch> | undefined;
  alerts?: Array<PerSeriesCriteriaMatch> | undefined;
}

// The incidents and alerts of a monitor that some emails opened.
interface OpenedByEmails {
  incidents: Array<Incident>;
  alerts: Array<Alert>;
}

type RecordKind = "incident" | "alert";

export default class IncomingEmailOpenForEveryEmail {
  /*
   * An email's fingerprint: what the records it opens carry, computed the
   * way a series' is (MetricSeriesFingerprint), from its Message-ID.
   */
  public static getEmailFingerprint(messageId: string): string {
    return MetricSeriesFingerprint.computeFingerprint({
      [EMAIL_MESSAGE_ID_FINGERPRINT_LABEL]: messageId,
    });
  }

  /*
   * What this criteria's incident and alert creators are to do with the
   * email being evaluated. Empty (both undefined) - "as before" - unless the
   * criteria opens an incident for every email and an email has just
   * arrived.
   *
   * Notes a reply on what its thread opened as it goes, and says in the
   * evaluation summary why an email opened nothing.
   */
  @CaptureSpan()
  public static async getMatches(input: {
    monitor: Monitor;
    criteriaInstance: MonitorCriteriaInstance;
    dataToProcess: DataToProcess;
    // The criteria's root cause, which every record it opens is created with.
    rootCause: string;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
  }): Promise<EveryEmailMatches> {
    if (
      !MonitorCriteriaInstance.isOpenForEveryEmail({
        monitorType: input.monitor.monitorType,
        criteriaInstance: input.criteriaInstance,
      })
    ) {
      return {};
    }

    const createsIncidents: boolean =
      input.criteriaInstance.data?.createIncidents === true;
    const createsAlerts: boolean =
      input.criteriaInstance.data?.createAlerts === true;

    if (!createsIncidents && !createsAlerts) {
      return {};
    }

    const email: IncomingEmailMonitorRequest =
      input.dataToProcess as IncomingEmailMonitorRequest;

    // A scheduled check has no email of its own: one at a time, as always.
    if (email.onlyCheckForIncomingEmailReceivedAt) {
      return {};
    }

    const monitorId: ObjectID | null = input.monitor.id;
    const projectId: ObjectID | undefined = input.monitor.projectId;

    if (!monitorId || !projectId) {
      return {};
    }

    const opensNothing: EveryEmailMatches = {
      incidents: createsIncidents ? [] : undefined,
      alerts: createsAlerts ? [] : undefined,
    };

    const criteriaId: string | undefined =
      input.criteriaInstance.data?.id?.toString();

    if (EmailThreadHeaders.isAutomaticReply(email.emailHeaders)) {
      IncomingEmailOpenForEveryEmail.recordSkipped({
        evaluationSummary: input.evaluationSummary,
        criteriaId: criteriaId,
        createsIncidents: createsIncidents,
        createsAlerts: createsAlerts,
        incidentMessage:
          "This email is an automatic reply, such as an out-of-office message, so it opened no incident.",
        alertMessage:
          "This email is an automatic reply, such as an out-of-office message, so it opened no alert.",
      });

      return opensNothing;
    }

    const messageId: string | null = EmailThreadHeaders.getMessageId(
      email.emailHeaders,
    );

    /*
     * Mail without a Message-ID - rare, as mail servers add one - cannot be
     * told from a second delivery of itself, nor answered: it opens its own.
     */
    const fingerprint: string =
      IncomingEmailOpenForEveryEmail.getEmailFingerprint(
        messageId || `no-message-id:${ObjectID.generate().toString()}`,
      );

    const answeredFingerprints: Array<string> =
      EmailThreadHeaders.getReferencedMessageIds(email.emailHeaders).map(
        (id: string): string => {
          return IncomingEmailOpenForEveryEmail.getEmailFingerprint(id);
        },
      );

    const opened: OpenedByEmails =
      await IncomingEmailOpenForEveryEmail.findOpenedByEmails({
        monitorId: monitorId,
        projectId: projectId,
        fingerprints: [
          ...(messageId ? [fingerprint] : []),
          ...answeredFingerprints,
        ],
      });

    // This very email was delivered before.
    const openedByThisEmail: OpenedByEmails = {
      incidents: opened.incidents.filter((incident: Incident): boolean => {
        return incident.seriesFingerprint === fingerprint;
      }),
      alerts: opened.alerts.filter((alert: Alert): boolean => {
        return alert.seriesFingerprint === fingerprint;
      }),
    };

    if (
      openedByThisEmail.incidents.length > 0 ||
      openedByThisEmail.alerts.length > 0
    ) {
      IncomingEmailOpenForEveryEmail.recordAlreadyOpened({
        evaluationSummary: input.evaluationSummary,
        criteriaId: criteriaId,
        opened: openedByThisEmail,
      });

      return opensNothing;
    }

    /*
     * A reply: it is added to what the email it answers opened - the newest
     * of the thread's emails that opened something, as a thread has one in
     * the usual case - and opens nothing.
     */
    const answered: OpenedByEmails =
      IncomingEmailOpenForEveryEmail.getAnswered(opened);

    if (answered.incidents.length > 0 || answered.alerts.length > 0) {
      const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
        from: email.emailFrom,
        body: email.emailBody,
      });

      for (const incident of answered.incidents) {
        await IncomingEmailOpenForEveryEmail.addIncidentNote({
          projectId: projectId,
          incident: incident,
          note: note,
          evaluationSummary: input.evaluationSummary,
          criteriaId: criteriaId,
        });
      }

      for (const alert of answered.alerts) {
        await IncomingEmailOpenForEveryEmail.addAlertNote({
          projectId: projectId,
          alert: alert,
          note: note,
          evaluationSummary: input.evaluationSummary,
          criteriaId: criteriaId,
        });
      }

      return opensNothing;
    }

    const match: PerSeriesCriteriaMatch = {
      criteriaMetId: criteriaId || "",
      fingerprint: fingerprint,
      // No labels: they would be added to the title as "which series".
      labels: {},
      rootCause: input.rootCause,
    };

    const matches: EveryEmailMatches = {};

    if (createsIncidents) {
      matches.incidents =
        (await IncomingEmailOpenForEveryEmail.isUnderHourlyLimit({
          kind: "incident",
          monitorId: monitorId,
          projectId: projectId,
          evaluationSummary: input.evaluationSummary,
          criteriaId: criteriaId,
        }))
          ? [match]
          : [];
    }

    if (createsAlerts) {
      matches.alerts = (await IncomingEmailOpenForEveryEmail.isUnderHourlyLimit(
        {
          kind: "alert",
          monitorId: monitorId,
          projectId: projectId,
          evaluationSummary: input.evaluationSummary,
          criteriaId: criteriaId,
        },
      ))
        ? [match]
        : [];
    }

    return matches;
  }

  /*
   * The private note a reply leaves on what its thread opened: who sent it,
   * and what they wrote, as text - nothing in it is read as Markdown, a link
   * or a chat mention - with its lines kept and the rest of a long reply cut.
   */
  public static getReplyNote(input: {
    from: string | null | undefined;
    body: string | null | undefined;
  }): string {
    const from: string = (input.from || "").trim();
    const body: string = (input.body || "").trim();

    const heading: MarkdownText = from
      ? mdText`**Reply by email from ${from}**`
      : mdText`**Reply by email**`;

    if (!body) {
      return mdText`${heading}

The reply has no plain text.`.toString();
    }

    if (body.length <= MAX_REPLY_NOTE_TEXT_LENGTH) {
      return mdText`${heading}

${FeedMarkdown.multilineText(body)}`.toString();
    }

    let end: number = MAX_REPLY_NOTE_TEXT_LENGTH;
    const lastCharCode: number = body.charCodeAt(end - 1);

    // Never end on the first half of a surrogate pair, such as an emoji.
    if (lastCharCode >= 0xd800 && lastCharCode <= 0xdbff) {
      end -= 1;
    }

    return mdText`${heading}

${FeedMarkdown.multilineText(body.slice(0, end))}

_The rest of this reply is not shown._`.toString();
  }

  /*
   * Of the records a reply's thread opened, those the email it answers
   * opened: the newest record's email - a criteria with two incident
   * templates opens two incidents from one email, each carrying it.
   */
  private static getAnswered(opened: OpenedByEmails): OpenedByEmails {
    const newestIncident: Incident | undefined = opened.incidents[0];
    const newestAlert: Alert | undefined = opened.alerts[0];

    const createdAtOf: (record: Incident | Alert) => number = (
      record: Incident | Alert,
    ): number => {
      return record.createdAt ? new Date(record.createdAt).getTime() || 0 : 0;
    };

    const newest: Incident | Alert | undefined =
      newestIncident && newestAlert
        ? createdAtOf(newestAlert) > createdAtOf(newestIncident)
          ? newestAlert
          : newestIncident
        : newestIncident || newestAlert;

    const answeredFingerprint: string | undefined =
      newest?.seriesFingerprint || undefined;

    if (!answeredFingerprint) {
      return { incidents: [], alerts: [] };
    }

    return {
      incidents: opened.incidents.filter((incident: Incident): boolean => {
        return incident.seriesFingerprint === answeredFingerprint;
      }),
      alerts: opened.alerts.filter((alert: Alert): boolean => {
        return alert.seriesFingerprint === answeredFingerprint;
      }),
    };
  }

  /*
   * The incidents and alerts of this monitor that the emails with these
   * fingerprints opened, open or resolved, newest first.
   */
  private static async findOpenedByEmails(input: {
    monitorId: ObjectID;
    projectId: ObjectID;
    fingerprints: Array<string>;
  }): Promise<OpenedByEmails> {
    if (input.fingerprints.length === 0) {
      return { incidents: [], alerts: [] };
    }

    const [incidents, alerts] = await Promise.all([
      IncidentService.findBy({
        query: {
          projectId: input.projectId,
          monitors: [input.monitorId],
          seriesFingerprint: QueryHelper.any(input.fingerprints),
        },
        select: {
          _id: true,
          title: true,
          createdAt: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          seriesFingerprint: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        skip: 0,
        limit: MAX_RECORDS_READ_FOR_AN_EMAIL,
        props: {
          isRoot: true,
        },
      }),
      AlertService.findBy({
        query: {
          projectId: input.projectId,
          monitorId: input.monitorId,
          seriesFingerprint: QueryHelper.any(input.fingerprints),
        },
        select: {
          _id: true,
          title: true,
          createdAt: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          seriesFingerprint: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        skip: 0,
        limit: MAX_RECORDS_READ_FOR_AN_EMAIL,
        props: {
          isRoot: true,
        },
      }),
    ]);

    return { incidents: incidents, alerts: alerts };
  }

  /*
   * Whether this monitor may open one more incident (or alert) from an
   * email: it opened fewer than MAX_OPENED_FROM_EMAILS_PER_HOUR in the past
   * hour. Records opened from emails are the monitor's records with a
   * fingerprint - an Incoming Email monitor has no others. Says so in the
   * evaluation summary when it may not.
   */
  private static async isUnderHourlyLimit(input: {
    kind: RecordKind;
    monitorId: ObjectID;
    projectId: ObjectID;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    criteriaId: string | undefined;
  }): Promise<boolean> {
    const since: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -1,
    );

    const openedInTheHour: number =
      input.kind === "incident"
        ? (
            await IncidentService.findBy({
              query: {
                projectId: input.projectId,
                monitors: [input.monitorId],
                seriesFingerprint: QueryHelper.notNull(),
                createdAt: QueryHelper.greaterThanEqualTo(since),
              },
              select: {
                _id: true,
              },
              skip: 0,
              limit: MAX_OPENED_FROM_EMAILS_PER_HOUR,
              props: {
                isRoot: true,
              },
            })
          ).length
        : (
            await AlertService.findBy({
              query: {
                projectId: input.projectId,
                monitorId: input.monitorId,
                seriesFingerprint: QueryHelper.notNull(),
                createdAt: QueryHelper.greaterThanEqualTo(since),
              },
              select: {
                _id: true,
              },
              skip: 0,
              limit: MAX_OPENED_FROM_EMAILS_PER_HOUR,
              props: {
                isRoot: true,
              },
            })
          ).length;

    if (openedInTheHour < MAX_OPENED_FROM_EMAILS_PER_HOUR) {
      return true;
    }

    logger.debug(
      `${input.monitorId.toString()} - Opened ${MAX_OPENED_FROM_EMAILS_PER_HOUR} ${input.kind}s from emails in the past hour; this email opens none.`,
    );

    input.evaluationSummary?.events.push({
      type: input.kind === "incident" ? "incident-skipped" : "alert-skipped",
      title:
        input.kind === "incident"
          ? "Incident creation skipped"
          : "Alert creation skipped",
      message:
        input.kind === "incident"
          ? `This monitor opened ${MAX_OPENED_FROM_EMAILS_PER_HOUR} incidents from emails in the past hour, the most it opens in an hour, so this email opened none.`
          : `This monitor opened ${MAX_OPENED_FROM_EMAILS_PER_HOUR} alerts from emails in the past hour, the most it opens in an hour, so this email opened none.`,
      relatedCriteriaId: input.criteriaId,
      at: OneUptimeDate.getCurrentDate(),
    });

    return false;
  }

  /*
   * Adds the reply to the incident as a private note, unless the same note
   * is already there: the reply was delivered twice.
   */
  private static async addIncidentNote(input: {
    projectId: ObjectID;
    incident: Incident;
    note: string;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    criteriaId: string | undefined;
  }): Promise<void> {
    const incidentId: ObjectID = input.incident.id!;

    const alreadyNoted: IncidentInternalNote | null =
      await IncidentInternalNoteService.findOneBy({
        query: {
          projectId: input.projectId,
          incidentId: incidentId,
          note: input.note,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!alreadyNoted) {
      const note: IncidentInternalNote = new IncidentInternalNote();
      note.projectId = input.projectId;
      note.incidentId = incidentId;
      note.note = input.note;

      await IncidentInternalNoteService.create({
        data: note,
        props: {
          isRoot: true,
        },
      });
    }

    input.evaluationSummary?.events.push({
      type: "incident-skipped",
      title: alreadyNoted
        ? `Reply already added to the incident as a note: ${input.incident.title || ""}`
        : `Reply added to the incident as a note: ${input.incident.title || ""}`,
      message: alreadyNoted
        ? "This reply was delivered before and is already a note on this incident, so nothing was added."
        : "This email replies to an email that opened this incident, so it was added to the incident as a note instead of opening a new one.",
      relatedCriteriaId: input.criteriaId,
      relatedIncidentId: incidentId.toString(),
      relatedIncidentNumber: input.incident.incidentNumber,
      relatedIncidentNumberWithPrefix: input.incident.incidentNumberWithPrefix,
      relatedIncidentCreatedAt: input.incident.createdAt,
      at: OneUptimeDate.getCurrentDate(),
    });
  }

  // The same, for an alert.
  private static async addAlertNote(input: {
    projectId: ObjectID;
    alert: Alert;
    note: string;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    criteriaId: string | undefined;
  }): Promise<void> {
    const alertId: ObjectID = input.alert.id!;

    const alreadyNoted: AlertInternalNote | null =
      await AlertInternalNoteService.findOneBy({
        query: {
          projectId: input.projectId,
          alertId: alertId,
          note: input.note,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!alreadyNoted) {
      const note: AlertInternalNote = new AlertInternalNote();
      note.projectId = input.projectId;
      note.alertId = alertId;
      note.note = input.note;

      await AlertInternalNoteService.create({
        data: note,
        props: {
          isRoot: true,
        },
      });
    }

    input.evaluationSummary?.events.push({
      type: "alert-skipped",
      title: alreadyNoted
        ? `Reply already added to the alert as a note: ${input.alert.title || ""}`
        : `Reply added to the alert as a note: ${input.alert.title || ""}`,
      message: alreadyNoted
        ? "This reply was delivered before and is already a note on this alert, so nothing was added."
        : "This email replies to an email that opened this alert, so it was added to the alert as a note instead of opening a new one.",
      relatedCriteriaId: input.criteriaId,
      relatedAlertId: alertId.toString(),
      relatedAlertNumber: input.alert.alertNumber,
      relatedAlertNumberWithPrefix: input.alert.alertNumberWithPrefix,
      relatedAlertCreatedAt: input.alert.createdAt,
      at: OneUptimeDate.getCurrentDate(),
    });
  }

  // "Already opened" for each record a second delivery of an email finds.
  private static recordAlreadyOpened(input: {
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    criteriaId: string | undefined;
    opened: OpenedByEmails;
  }): void {
    for (const incident of input.opened.incidents) {
      input.evaluationSummary?.events.push({
        type: "incident-skipped",
        title: `Incident already opened for this email: ${incident.title || ""}`,
        message:
          "This email was delivered before and already opened this incident. An email opens one incident, however often it is delivered.",
        relatedCriteriaId: input.criteriaId,
        relatedIncidentId: incident.id?.toString(),
        relatedIncidentNumber: incident.incidentNumber,
        relatedIncidentNumberWithPrefix: incident.incidentNumberWithPrefix,
        relatedIncidentCreatedAt: incident.createdAt,
        at: OneUptimeDate.getCurrentDate(),
      });
    }

    for (const alert of input.opened.alerts) {
      input.evaluationSummary?.events.push({
        type: "alert-skipped",
        title: `Alert already opened for this email: ${alert.title || ""}`,
        message:
          "This email was delivered before and already opened this alert. An email opens one alert, however often it is delivered.",
        relatedCriteriaId: input.criteriaId,
        relatedAlertId: alert.id?.toString(),
        relatedAlertNumber: alert.alertNumber,
        relatedAlertNumberWithPrefix: alert.alertNumberWithPrefix,
        relatedAlertCreatedAt: alert.createdAt,
        at: OneUptimeDate.getCurrentDate(),
      });
    }
  }

  // Why an email opened nothing, for each kind of record the criteria opens.
  private static recordSkipped(input: {
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    criteriaId: string | undefined;
    createsIncidents: boolean;
    createsAlerts: boolean;
    incidentMessage: string;
    alertMessage: string;
  }): void {
    if (input.createsIncidents) {
      input.evaluationSummary?.events.push({
        type: "incident-skipped",
        title: "Incident creation skipped",
        message: input.incidentMessage,
        relatedCriteriaId: input.criteriaId,
        at: OneUptimeDate.getCurrentDate(),
      });
    }

    if (input.createsAlerts) {
      input.evaluationSummary?.events.push({
        type: "alert-skipped",
        title: "Alert creation skipped",
        message: input.alertMessage,
        relatedCriteriaId: input.criteriaId,
        at: OneUptimeDate.getCurrentDate(),
      });
    }
  }
}
