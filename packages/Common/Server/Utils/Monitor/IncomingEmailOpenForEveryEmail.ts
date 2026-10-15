import Alert from "../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import ObjectID from "../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import EmailReplyText from "../../../Utils/Email/EmailReplyText";
import EmailThreadHeaders from "../../../Utils/Email/EmailThreadHeaders";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import GlobalCache from "../../Infrastructure/GlobalCache";
import AlertInternalNoteService from "../../Services/AlertInternalNoteService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import Query from "../../Types/Database/Query";
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
 * records by): "email:" and a hash of its Message-ID. That is what tells an
 * email from another, so:
 *
 *   - the same email delivered twice - a retried delivery, a mailing list it
 *     reached the address through twice - opens one, as long as anything it
 *     opened is still there, open or resolved;
 *   - a reply - its In-Reply-To or References name an email of the thread -
 *     is added as a private note to what the thread opened while that is
 *     still open, and opens nothing: a "Same here" pages nobody. Once
 *     everything the thread opened is resolved, a reply is a new report and
 *     opens its own: "It's broken again" on an old thread is not lost;
 *   - an automatic reply (an out-of-office message, a bounce) opens nothing;
 *   - a monitor opens at most MAX_OPENED_FROM_EMAILS_PER_HOUR incidents (and
 *     as many alerts) from emails in an hour, so a mail loop, or a stranger
 *     who learnt the address, cannot page the team without end.
 *
 * A reply added as a note opened nothing to carry its fingerprint, so what
 * it was added to is remembered for REPLY_MEMORY_IN_DAYS (GlobalCache): a
 * second delivery of it adds nothing, and a reply to it finds the thread even
 * when its mail program named only the reply.
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
 * bound on what a mail loop or a flood of email can do. It is checked before
 * each email, which then opens one record per template of its criteria: with
 * more than one template, the email that reaches the bound can pass it by
 * the rest of its templates.
 */
export const MAX_OPENED_FROM_EMAILS_PER_HOUR: number = 20;

/*
 * The longest reply text a note holds: the reply's own text, the thread it
 * quotes taken away (EmailReplyText).
 */
export const MAX_REPLY_NOTE_TEXT_LENGTH: number = 10000;

const LINE_BREAK_PATTERN: RegExp = /\r\n|\r|\n/;

/*
 * How long what a reply was added to is remembered. Longer than a delivery
 * is retried for (SendGrid retries for three days), and than most threads
 * last; a reply to an older one is read by its References alone.
 */
export const REPLY_MEMORY_IN_DAYS: number = 30;

/*
 * What every fingerprint an email gives its records starts with: no series
 * fingerprint (MetricSeriesFingerprint, a bare hash) does, so an email's
 * records are told from anything else that keys records on the monitor -
 * and counted apart from them for the hourly bound.
 */
export const EMAIL_FINGERPRINT_PREFIX: string = "email:";

// The label an email's fingerprint is computed from.
export const EMAIL_MESSAGE_ID_FINGERPRINT_LABEL: string = "email.messageId";

// Where what a reply was added to is remembered (GlobalCache).
export const REPLY_MEMORY_NAMESPACE: string = "incoming-email-reply-notes";

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

type RecordKind = "incident" | "alert";

// An incident or an alert an email opened, read the same way for both.
interface EmailRecord {
  kind: RecordKind;
  id: ObjectID;
  title: string;
  number: number | undefined;
  numberWithPrefix: string | undefined;
  createdAt: Date | undefined;
  // The fingerprint of the email that opened it.
  fingerprint: string | undefined;
  // In a state of its project that is not resolved.
  isOpen: boolean;
}

// What a reply added as a note was added to, as remembered.
interface RememberedReply {
  incidentIds: Array<string>;
  alertIds: Array<string>;
}

// An event about an email, before its summary and criteria are filled in.
interface EmailEvent {
  kind: RecordKind;
  // The record it is about, when there is one.
  record?: EmailRecord | undefined;
  title: string;
  message: string;
}

export default class IncomingEmailOpenForEveryEmail {
  /*
   * An email's fingerprint: what the records it opens carry.
   * EMAIL_FINGERPRINT_PREFIX, then a hash of its Message-ID computed the way
   * a series' is (MetricSeriesFingerprint).
   */
  public static getEmailFingerprint(messageId: string): string {
    return `${EMAIL_FINGERPRINT_PREFIX}${MetricSeriesFingerprint.computeFingerprint(
      {
        [EMAIL_MESSAGE_ID_FINGERPRINT_LABEL]: messageId,
      },
    )}`;
  }

  /*
   * What this criteria's incident and alert creators are to do with the
   * email being evaluated. Empty (both undefined) - "as before" - unless the
   * criteria opens an incident for every email and an email has just
   * arrived.
   *
   * Adds a reply to what its thread opened as it goes, and says in the
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

    // The kinds of record the criteria opens.
    const kinds: Array<RecordKind> = [
      ...(input.criteriaInstance.data?.createIncidents === true
        ? ["incident" as RecordKind]
        : []),
      ...(input.criteriaInstance.data?.createAlerts === true
        ? ["alert" as RecordKind]
        : []),
    ];

    if (kinds.length === 0) {
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

    const opensNothing: EveryEmailMatches = {};

    for (const kind of kinds) {
      opensNothing[IncomingEmailOpenForEveryEmail.listOf(kind)] = [];
    }

    const criteriaId: string | undefined =
      input.criteriaInstance.data?.id?.toString();

    const recordEvent: (event: EmailEvent) => void = (
      event: EmailEvent,
    ): void => {
      IncomingEmailOpenForEveryEmail.recordEvent({
        ...event,
        evaluationSummary: input.evaluationSummary,
        criteriaId: criteriaId,
      });
    };

    if (EmailThreadHeaders.isAutomaticReply(email.emailHeaders)) {
      for (const kind of kinds) {
        recordEvent({
          kind: kind,
          title: `${IncomingEmailOpenForEveryEmail.noun(kind)} creation skipped`,
          message: `This email is an automatic reply, such as an out-of-office message, so it opened no ${kind}.`,
        });
      }

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

    // The fingerprints of the emails it answers, the one it replies to first.
    const answeredFingerprints: Array<string> =
      EmailThreadHeaders.getReferencedMessageIds(email.emailHeaders).map(
        (id: string): string => {
          return IncomingEmailOpenForEveryEmail.getEmailFingerprint(id);
        },
      );

    // What this email and the emails it answers opened, open or resolved.
    const opened: Array<EmailRecord> =
      await IncomingEmailOpenForEveryEmail.findRecords({
        monitorId: monitorId,
        projectId: projectId,
        incidentQuery: {
          seriesFingerprint: QueryHelper.any([
            fingerprint,
            ...answeredFingerprints,
          ]),
        },
        alertQuery: {
          seriesFingerprint: QueryHelper.any([
            fingerprint,
            ...answeredFingerprints,
          ]),
        },
      });

    // This very email was delivered before, and opened something...
    const openedByThisEmail: Array<EmailRecord> = opened.filter(
      (record: EmailRecord): boolean => {
        return record.fingerprint === fingerprint;
      },
    );

    if (openedByThisEmail.length > 0) {
      for (const record of openedByThisEmail) {
        recordEvent({
          kind: record.kind,
          record: record,
          title: `${IncomingEmailOpenForEveryEmail.noun(record.kind)} already opened for this email: ${record.title}`,
          message: `This email was delivered before and already opened this ${record.kind}.`,
        });
      }

      return opensNothing;
    }

    const [rememberedThisEmail, ...rememberedAnswered] =
      await IncomingEmailOpenForEveryEmail.recallReplies({
        monitorId: monitorId,
        fingerprints: [fingerprint, ...answeredFingerprints],
      });

    // ...or was a reply, and was added as a note.
    if (rememberedThisEmail) {
      for (const kind of kinds) {
        recordEvent({
          kind: kind,
          title: `${IncomingEmailOpenForEveryEmail.noun(kind)} creation skipped`,
          message: `This reply was delivered before and was already added as a note, so it opened no ${kind}.`,
        });
      }

      return opensNothing;
    }

    /*
     * A reply: what its thread opened - by the fingerprints the emails it
     * answers gave their records, and through the thread's replies that were
     * added as notes - is added to while it is open.
     */
    const thread: Array<EmailRecord> = [
      ...opened,
      ...(await IncomingEmailOpenForEveryEmail.findRemembered({
        monitorId: monitorId,
        projectId: projectId,
        replies: rememberedAnswered,
        alreadyFound: opened,
      })),
    ];

    const answered: Array<EmailRecord> =
      IncomingEmailOpenForEveryEmail.getAnswered(thread);

    if (answered.length > 0) {
      const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
        from: email.emailFrom,
        body: email.emailBody,
      });

      await Promise.all(
        answered.map((record: EmailRecord): Promise<void> => {
          return IncomingEmailOpenForEveryEmail.addNote({
            projectId: projectId,
            record: record,
            note: note,
          });
        }),
      );

      for (const record of answered) {
        recordEvent({
          kind: record.kind,
          record: record,
          title: `Reply added to the ${record.kind} as a note: ${record.title}`,
          message: `This email is a reply in the thread that opened this ${record.kind}, so it was added to the ${record.kind} as a private note instead of opening a new one.`,
        });
      }

      if (messageId) {
        await IncomingEmailOpenForEveryEmail.rememberReply({
          monitorId: monitorId,
          fingerprint: fingerprint,
          records: answered,
        });
      }

      return opensNothing;
    }

    /*
     * A new email - or a reply whose thread opened nothing still open, which
     * is a new report: it opens its own, while the monitor is under its
     * hourly bound.
     */
    const match: PerSeriesCriteriaMatch = {
      criteriaMetId: criteriaId || "",
      fingerprint: fingerprint,
      // No labels: they would be added to the title as "which series".
      labels: {},
      rootCause: input.rootCause,
    };

    const allowed: Array<boolean> = await Promise.all(
      kinds.map((kind: RecordKind): Promise<boolean> => {
        return IncomingEmailOpenForEveryEmail.isUnderHourlyLimit({
          kind: kind,
          monitorId: monitorId,
          projectId: projectId,
        });
      }),
    );

    const matches: EveryEmailMatches = {};

    kinds.forEach((kind: RecordKind, index: number): void => {
      if (allowed[index]) {
        matches[IncomingEmailOpenForEveryEmail.listOf(kind)] = [match];
        return;
      }

      logger.debug(
        `${monitorId.toString()} - Opened ${MAX_OPENED_FROM_EMAILS_PER_HOUR} ${kind}s from emails in the past hour; this email opens none.`,
      );

      recordEvent({
        kind: kind,
        title: `${IncomingEmailOpenForEveryEmail.noun(kind)} creation skipped`,
        message: `This monitor opened ${MAX_OPENED_FROM_EMAILS_PER_HOUR} ${kind}s from emails in the past hour, the most it opens in an hour, so this email opened none.`,
      });

      matches[IncomingEmailOpenForEveryEmail.listOf(kind)] = [];
    });

    return matches;
  }

  /*
   * The private note a reply leaves on what its thread opened, as a person
   * reads a reply in their mail program: who sent it, then what they wrote -
   * without the earlier emails it quotes (EmailReplyText), which the
   * incident and its notes hold already, and with its lines and paragraphs
   * as they were written. Everything the sender wrote is text: nothing in
   * it is read as Markdown, a link or a chat mention. The rest of a long
   * reply is cut.
   */
  public static getReplyNote(input: {
    from: string | null | undefined;
    body: string | null | undefined;
  }): string {
    const from: string = (input.from || "").trim();
    const text: string = EmailReplyText.getOwnText(input.body);

    // Who replied leads, as a chat message's sender does.
    const heading: MarkdownText = mdText`**${from || "Someone"}** replied by email:`;

    if (!text) {
      return mdText`${heading}

_The reply has no text to show._`.toString();
    }

    if (text.length <= MAX_REPLY_NOTE_TEXT_LENGTH) {
      return mdText`${heading}

${IncomingEmailOpenForEveryEmail.getLinesMarkdown(text)}`.toString();
    }

    let end: number = MAX_REPLY_NOTE_TEXT_LENGTH;
    const lastCharCode: number = text.charCodeAt(end - 1);

    // Never end on the first half of a surrogate pair, such as an emoji.
    if (lastCharCode >= 0xd800 && lastCharCode <= 0xdbff) {
      end -= 1;
    }

    return mdText`${heading}

${IncomingEmailOpenForEveryEmail.getLinesMarkdown(text.slice(0, end))}

_The rest of this reply is not shown._`.toString();
  }

  /*
   * Plain text as Markdown that keeps its lines: each line ends with a hard
   * break, as a form's multi-line answer does (FormSubmissionNote) - a bare
   * line break is read as a space, so "Thanks,\nPriya" read "Thanks,
   * Priya" - and a blank line, or a run of them, starts a new paragraph.
   * Each line is text, escaped where it stands (FeedMarkdown.join).
   */
  private static getLinesMarkdown(text: string): MarkdownText {
    const paragraphs: Array<MarkdownText> = [];
    let lines: Array<string> = [];

    const endParagraph: () => void = (): void => {
      if (lines.length > 0) {
        paragraphs.push(FeedMarkdown.join(lines, "  \n"));
        lines = [];
      }
    };

    for (const line of text.split(LINE_BREAK_PATTERN)) {
      const words: string = line.trim();

      if (words) {
        lines.push(words);
      } else {
        endParagraph();
      }
    }

    endParagraph();

    return FeedMarkdown.join(paragraphs, "\n\n");
  }

  /*
   * What a reply is added to: the open records the newest email of its
   * thread opened - a criteria with two incident templates opens two
   * incidents from one email, each carrying it. Nothing when all the thread
   * opened is resolved.
   */
  private static getAnswered(thread: Array<EmailRecord>): Array<EmailRecord> {
    const open: Array<EmailRecord> = thread.filter(
      (record: EmailRecord): boolean => {
        return record.isOpen;
      },
    );

    if (open.length === 0) {
      return [];
    }

    const createdAtOf: (record: EmailRecord) => number = (
      record: EmailRecord,
    ): number => {
      return record.createdAt ? new Date(record.createdAt).getTime() || 0 : 0;
    };

    const newest: EmailRecord = open.reduce(
      (newestSoFar: EmailRecord, record: EmailRecord): EmailRecord => {
        return createdAtOf(record) > createdAtOf(newestSoFar)
          ? record
          : newestSoFar;
      },
    );

    const added: Set<string> = new Set<string>();

    return open.filter((record: EmailRecord): boolean => {
      const key: string = IncomingEmailOpenForEveryEmail.keyOf(record);

      if (added.has(key) || record.fingerprint !== newest.fingerprint) {
        return false;
      }

      added.add(key);
      return true;
    });
  }

  /*
   * The records the remembered replies were added to (rememberReply), but
   * those in `alreadyFound`.
   */
  private static async findRemembered(input: {
    monitorId: ObjectID;
    projectId: ObjectID;
    replies: Array<RememberedReply | null>;
    alreadyFound: Array<EmailRecord>;
  }): Promise<Array<EmailRecord>> {
    const found: Set<string> = new Set<string>(
      input.alreadyFound.map((record: EmailRecord): string => {
        return IncomingEmailOpenForEveryEmail.keyOf(record);
      }),
    );

    const idsOf: (kind: RecordKind) => Array<string> = (
      kind: RecordKind,
    ): Array<string> => {
      const ids: Set<string> = new Set<string>();

      for (const reply of input.replies) {
        const replyIds: Array<string> =
          (kind === "incident" ? reply?.incidentIds : reply?.alertIds) || [];

        for (const id of replyIds) {
          if (!found.has(`${kind}:${id}`)) {
            ids.add(id);
          }
        }
      }

      return Array.from(ids);
    };

    const incidentIds: Array<string> = idsOf("incident");
    const alertIds: Array<string> = idsOf("alert");

    if (incidentIds.length === 0 && alertIds.length === 0) {
      return [];
    }

    return await IncomingEmailOpenForEveryEmail.findRecords({
      monitorId: input.monitorId,
      projectId: input.projectId,
      incidentQuery:
        incidentIds.length > 0 ? { _id: QueryHelper.any(incidentIds) } : null,
      alertQuery:
        alertIds.length > 0 ? { _id: QueryHelper.any(alertIds) } : null,
    });
  }

  /*
   * This monitor's incidents and alerts that match each query (null: none of
   * that kind), newest first, each read as open or not by its project's
   * states.
   */
  private static async findRecords(input: {
    monitorId: ObjectID;
    projectId: ObjectID;
    incidentQuery: Query<Incident> | null;
    alertQuery: Query<Alert> | null;
  }): Promise<Array<EmailRecord>> {
    const [incidents, alerts] = await Promise.all([
      input.incidentQuery
        ? IncidentService.findBy({
            query: {
              ...input.incidentQuery,
              projectId: input.projectId,
              monitors: [input.monitorId],
            },
            select: {
              _id: true,
              title: true,
              createdAt: true,
              incidentNumber: true,
              incidentNumberWithPrefix: true,
              seriesFingerprint: true,
              currentIncidentStateId: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            },
            skip: 0,
            limit: MAX_RECORDS_READ_FOR_AN_EMAIL,
            props: {
              isRoot: true,
            },
          })
        : Promise.resolve([]),
      input.alertQuery
        ? AlertService.findBy({
            query: {
              ...input.alertQuery,
              projectId: input.projectId,
              monitorId: input.monitorId,
            },
            select: {
              _id: true,
              title: true,
              createdAt: true,
              alertNumber: true,
              alertNumberWithPrefix: true,
              seriesFingerprint: true,
              currentAlertStateId: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            },
            skip: 0,
            limit: MAX_RECORDS_READ_FOR_AN_EMAIL,
            props: {
              isRoot: true,
            },
          })
        : Promise.resolve([]),
    ]);

    // Open: in a state of the project's that is not resolved.
    const [unresolvedIncidentStateIds, unresolvedAlertStateIds] =
      await Promise.all([
        incidents.length > 0
          ? IncidentStateService.getUnresolvedIncidentStateIds(input.projectId)
          : Promise.resolve([]),
        alerts.length > 0
          ? AlertStateService.getUnresolvedAlertStateIds(input.projectId)
          : Promise.resolve([]),
      ]);

    const isOneOf: (
      stateId: ObjectID | undefined,
      stateIds: Array<ObjectID>,
    ) => boolean = (
      stateId: ObjectID | undefined,
      stateIds: Array<ObjectID>,
    ): boolean => {
      const value: string | undefined = stateId?.toString();

      return (
        Boolean(value) &&
        stateIds.some((id: ObjectID): boolean => {
          return id.toString() === value;
        })
      );
    };

    return [
      ...incidents.map((incident: Incident): EmailRecord => {
        return {
          kind: "incident",
          id: incident.id!,
          title: incident.title || "",
          number: incident.incidentNumber,
          numberWithPrefix: incident.incidentNumberWithPrefix,
          createdAt: incident.createdAt,
          fingerprint: incident.seriesFingerprint || undefined,
          isOpen: isOneOf(
            incident.currentIncidentStateId,
            unresolvedIncidentStateIds,
          ),
        };
      }),
      ...alerts.map((alert: Alert): EmailRecord => {
        return {
          kind: "alert",
          id: alert.id!,
          title: alert.title || "",
          number: alert.alertNumber,
          numberWithPrefix: alert.alertNumberWithPrefix,
          createdAt: alert.createdAt,
          fingerprint: alert.seriesFingerprint || undefined,
          isOpen: isOneOf(alert.currentAlertStateId, unresolvedAlertStateIds),
        };
      }),
    ];
  }

  /*
   * Whether this monitor may open one more incident (or alert) from an
   * email: it opened fewer than MAX_OPENED_FROM_EMAILS_PER_HOUR of them in
   * the past hour - its records whose fingerprint is an email's.
   */
  private static async isUnderHourlyLimit(input: {
    kind: RecordKind;
    monitorId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const since: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -1,
    );

    const openedInTheHour: number = (
      input.kind === "incident"
        ? await IncidentService.countBy({
            query: {
              projectId: input.projectId,
              monitors: [input.monitorId],
              seriesFingerprint: QueryHelper.startsWith(
                EMAIL_FINGERPRINT_PREFIX,
              ),
              createdAt: QueryHelper.greaterThanEqualTo(since),
            },
            limit: MAX_OPENED_FROM_EMAILS_PER_HOUR,
            props: {
              isRoot: true,
            },
          })
        : await AlertService.countBy({
            query: {
              projectId: input.projectId,
              monitorId: input.monitorId,
              seriesFingerprint: QueryHelper.startsWith(
                EMAIL_FINGERPRINT_PREFIX,
              ),
              createdAt: QueryHelper.greaterThanEqualTo(since),
            },
            limit: MAX_OPENED_FROM_EMAILS_PER_HOUR,
            props: {
              isRoot: true,
            },
          })
    ).toNumber();

    return openedInTheHour < MAX_OPENED_FROM_EMAILS_PER_HOUR;
  }

  // Adds the reply to the incident or alert as a private note.
  private static async addNote(input: {
    projectId: ObjectID;
    record: EmailRecord;
    note: string;
  }): Promise<void> {
    if (input.record.kind === "incident") {
      const note: IncidentInternalNote = new IncidentInternalNote();
      note.projectId = input.projectId;
      note.incidentId = input.record.id;
      note.note = input.note;

      await IncidentInternalNoteService.create({
        data: note,
        props: {
          isRoot: true,
        },
      });

      return;
    }

    const note: AlertInternalNote = new AlertInternalNote();
    note.projectId = input.projectId;
    note.alertId = input.record.id;
    note.note = input.note;

    await AlertInternalNoteService.create({
      data: note,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Remembers what a reply was added to, by its fingerprint, for
   * REPLY_MEMORY_IN_DAYS. Without the cache the notes stay, and a second
   * delivery of the reply adds them again.
   */
  private static async rememberReply(input: {
    monitorId: ObjectID;
    fingerprint: string;
    records: Array<EmailRecord>;
  }): Promise<void> {
    const idsOf: (kind: RecordKind) => Array<string> = (
      kind: RecordKind,
    ): Array<string> => {
      return input.records
        .filter((record: EmailRecord): boolean => {
          return record.kind === kind;
        })
        .map((record: EmailRecord): string => {
          return record.id.toString();
        });
    };

    const remembered: RememberedReply = {
      incidentIds: idsOf("incident"),
      alertIds: idsOf("alert"),
    };

    try {
      await GlobalCache.setString(
        REPLY_MEMORY_NAMESPACE,
        IncomingEmailOpenForEveryEmail.replyMemoryKey(
          input.monitorId,
          input.fingerprint,
        ),
        JSON.stringify(remembered),
        {
          expiresInSeconds:
            OneUptimeDate.getSecondsInDays(REPLY_MEMORY_IN_DAYS),
        },
      );
    } catch (error) {
      logger.debug(
        `${input.monitorId.toString()} - Could not remember an email reply: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /*
   * What the replies with these fingerprints were added to, in their order
   * (null: not remembered). Without the cache, nothing is remembered.
   */
  private static async recallReplies(input: {
    monitorId: ObjectID;
    fingerprints: Array<string>;
  }): Promise<Array<RememberedReply | null>> {
    try {
      const values: Array<string | null> = await GlobalCache.getStrings(
        REPLY_MEMORY_NAMESPACE,
        input.fingerprints.map((fingerprint: string): string => {
          return IncomingEmailOpenForEveryEmail.replyMemoryKey(
            input.monitorId,
            fingerprint,
          );
        }),
      );

      return input.fingerprints.map(
        (_fingerprint: string, index: number): RememberedReply | null => {
          return IncomingEmailOpenForEveryEmail.readRememberedReply(
            values[index] || null,
          );
        },
      );
    } catch (error) {
      logger.debug(
        `${input.monitorId.toString()} - Could not read remembered email replies: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return input.fingerprints.map((): null => {
        return null;
      });
    }
  }

  // A remembered reply as stored, or null for anything else.
  private static readRememberedReply(
    value: string | null,
  ): RememberedReply | null {
    if (!value) {
      return null;
    }

    let parsed: unknown = null;

    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const idsOf: (list: unknown) => Array<string> = (
      list: unknown,
    ): Array<string> => {
      return Array.isArray(list)
        ? list.filter((id: unknown): id is string => {
            return typeof id === "string" && ObjectID.isValidUUID(id);
          })
        : [];
    };

    return {
      incidentIds: idsOf((parsed as JSONObject)["incidentIds"]),
      alertIds: idsOf((parsed as JSONObject)["alertIds"]),
    };
  }

  private static replyMemoryKey(
    monitorId: ObjectID,
    fingerprint: string,
  ): string {
    return `${monitorId.toString()}:${fingerprint}`;
  }

  private static keyOf(record: EmailRecord): string {
    return `${record.kind}:${record.id.toString()}`;
  }

  private static listOf(kind: RecordKind): keyof EveryEmailMatches {
    return kind === "incident" ? "incidents" : "alerts";
  }

  private static noun(kind: RecordKind): string {
    return kind === "incident" ? "Incident" : "Alert";
  }

  // Adds an event to the evaluation summary, about a record when there is one.
  private static recordEvent(input: {
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    criteriaId: string | undefined;
    kind: RecordKind;
    record?: EmailRecord | undefined;
    title: string;
    message: string;
  }): void {
    const event: MonitorEvaluationEvent = {
      type: input.kind === "incident" ? "incident-skipped" : "alert-skipped",
      title: input.title,
      message: input.message,
      relatedCriteriaId: input.criteriaId,
      at: OneUptimeDate.getCurrentDate(),
    };

    if (input.record?.kind === "incident") {
      event.relatedIncidentId = input.record.id.toString();
      event.relatedIncidentNumber = input.record.number;
      event.relatedIncidentNumberWithPrefix = input.record.numberWithPrefix;
      event.relatedIncidentCreatedAt = input.record.createdAt;
    }

    if (input.record?.kind === "alert") {
      event.relatedAlertId = input.record.id.toString();
      event.relatedAlertNumber = input.record.number;
      event.relatedAlertNumberWithPrefix = input.record.numberWithPrefix;
      event.relatedAlertCreatedAt = input.record.createdAt;
    }

    input.evaluationSummary?.events.push(event);
  }
}
