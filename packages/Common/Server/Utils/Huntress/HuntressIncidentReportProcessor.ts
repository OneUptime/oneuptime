import HuntressConnection from "../../../Models/DatabaseModels/HuntressConnection";
import HuntressIncidentReport from "../../../Models/DatabaseModels/HuntressIncidentReport";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import HuntressIncidentReportOutcome, {
  didHuntressOutcomeOpenIncident,
  isHuntressOutcomeSkipped,
} from "../../../Types/Huntress/HuntressIncidentReportOutcome";
import {
  isHuntressOrganizationWatched,
  parseHuntressOrganizationFilter,
} from "../../../Types/Huntress/HuntressOrganizationFilter";
import HuntressSeverity, {
  HUNTRESS_SEVERITY_WHEN_UNKNOWN,
  isHuntressSeverity,
  isHuntressSeverityAtOrAbove,
} from "../../../Types/Huntress/HuntressSeverity";
import {
  HuntressIncidentReportEvent,
  HuntressWebhookEventType,
  isHuntressReportFinished,
  isHuntressReportStatusFinished,
} from "../../../Types/Huntress/HuntressWebhook";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  getHuntressAffectedName,
  getHuntressClosedNote,
  getHuntressCommentNote,
  getHuntressIncidentDescription,
  getHuntressIncidentTitle,
  getHuntressResolvedReason,
} from "../../../Utils/Huntress/HuntressIncidentReportText";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import HuntressIncidentReportService from "../../Services/HuntressIncidentReportService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import LabelService from "../../Services/LabelService";
import logger from "../Logger";

/*
 * What a Huntress incident report does in a project: the heart of the
 * Huntress integration, run by the webhook once the request's signature
 * has been verified (HuntressWebhookHandler).
 *
 * ONE INCIDENT PER REPORT. Huntress sends a report more than once - when it
 * is created, when someone comments, when it is closed - and Svix sends a
 * delivery again whenever the last attempt was not answered in time. So a
 * report is claimed before its incident is opened: a HuntressIncidentReport
 * row, unique by project, Huntress account and report id. Deliveries of one
 * report take turns (a Valkey lock per report); without the lock, the
 * unique row still lets one delivery through, and a claim younger than a
 * minute that has no incident yet is answered "try again later" rather
 * than opened twice. A claim older than that belongs to an attempt that
 * failed, and the next delivery finishes it.
 *
 * WHAT A REPORT OPENS. An incident titled after the report's subject, at
 * the severity the connection gives the report's Huntress severity (or the
 * project's severities in rank order), labelled with the report's
 * organization and the connection's labels, never shown on a status page,
 * and paging the connection's on-call policies when the report is at or
 * above its "Page On-Call For" severity. The project's incident rules
 * (on-call, owner, label, privacy) apply to it like to any other incident.
 *
 * WHAT HAPPENS NEXT. A comment added in Huntress becomes a private note on
 * the incident. When the report is closed or dismissed, the incident is
 * resolved (or, with the connection's switch off, a note says so) - once,
 * on the change from open to closed.
 *
 * NOT OPENED. A report from an organization the connection does not watch,
 * or one already closed the first time OneUptime hears of it, opens
 * nothing; its row says why, and later events about it change nothing.
 */

// A claim younger than this with no incident is another delivery's, still at work.
export const HUNTRESS_CLAIM_IN_PROGRESS_MS: number = 60 * 1000;

// How many webhook message ids a report remembers, to apply each once.
export const HUNTRESS_APPLIED_MESSAGE_IDS_KEPT: number = 25;

// The longest an organization's label can be: a label's name is short text.
export const HUNTRESS_MAX_LABEL_NAME_LENGTH: number = 100;

/*
 * Thrown when another delivery of the same report holds an unfinished
 * claim: the webhook answers 503 and Svix tries again a little later.
 */
export class HuntressReportBusyException extends Error {
  public constructor() {
    super(
      "Another delivery of this incident report is being handled. Huntress will send it again shortly.",
    );
  }
}

export enum HuntressReportAction {
  IncidentOpened = "incident-opened",
  IncidentResolved = "incident-resolved",
  NoteAdded = "note-added",
  Skipped = "skipped",
  Duplicate = "duplicate",
  NothingToDo = "nothing-to-do",
}

// What a report row records of the report, as Huntress last sent it.
export interface HuntressReportFacts {
  lastEventType: string;
  lastEventReceivedAt: Date;
  organizationId?: string;
  organizationName?: string;
  subject?: string;
  affectedName?: string;
  severity?: string;
  status?: string;
}

// What the processor writes to a report row after creating it.
interface HuntressReportRowUpdate extends HuntressReportFacts {
  huntressConnectionId?: ObjectID;
  outcome?: HuntressIncidentReportOutcome;
  incidentId?: ObjectID;
  pagedOnCall?: boolean;
  appliedMessageIds?: Array<string>;
}

export interface HuntressReportResult {
  action: HuntressReportAction;
  outcome: HuntressIncidentReportOutcome;
  incidentId: ObjectID | null;
}

/*
 * The connection as the processor reads it: its id and project, and the
 * settings that decide what a report does.
 */
export interface HuntressConnectionSettings {
  id: ObjectID;
  projectId: ObjectID;
  pageOnCallFor: HuntressSeverity;
  criticalIncidentSeverityId: ObjectID | null;
  highIncidentSeverityId: ObjectID | null;
  lowIncidentSeverityId: ObjectID | null;
  watchedOrganizations: Array<string>;
  onCallDutyPolicyIds: Array<ObjectID>;
  labelIds: Array<ObjectID>;
  resolveIncidentWhenReportCloses: boolean;
}

function toObjectIdOrNull(value: unknown): ObjectID | null {
  if (!value) {
    return null;
  }

  if (value instanceof ObjectID) {
    return value;
  }

  return new ObjectID(String(value));
}

function getIds(
  models: Array<{ _id?: string | undefined; id?: ObjectID | null }> | undefined,
): Array<ObjectID> {
  return (models || [])
    .map(
      (model: {
        _id?: string | undefined;
        id?: ObjectID | null;
      }): ObjectID | null => {
        if (model.id) {
          return model.id;
        }

        return model._id ? new ObjectID(model._id) : null;
      },
    )
    .filter((id: ObjectID | null): id is ObjectID => {
      return id !== null;
    });
}

export default class HuntressIncidentReportProcessor {
  /*
   * The columns of a connection the processor needs - for the webhook's
   * one read of it.
   */
  public static readonly CONNECTION_SELECT: Record<string, unknown> = {
    _id: true,
    projectId: true,
    pageOnCallFor: true,
    criticalIncidentSeverityId: true,
    highIncidentSeverityId: true,
    lowIncidentSeverityId: true,
    watchedOrganizations: true,
    resolveIncidentWhenReportCloses: true,
    onCallDutyPolicies: { _id: true },
    labels: { _id: true },
  };

  public static getSettings(
    connection: HuntressConnection,
  ): HuntressConnectionSettings {
    if (!connection.id || !connection.projectId) {
      throw new BadDataException("The Huntress connection has no project.");
    }

    const pageOnCallFor: HuntressSeverity = isHuntressSeverity(
      connection.pageOnCallFor,
    )
      ? connection.pageOnCallFor
      : HuntressSeverity.High;

    return {
      id: connection.id,
      projectId: connection.projectId,
      pageOnCallFor,
      criticalIncidentSeverityId: toObjectIdOrNull(
        connection.criticalIncidentSeverityId,
      ),
      highIncidentSeverityId: toObjectIdOrNull(
        connection.highIncidentSeverityId,
      ),
      lowIncidentSeverityId: toObjectIdOrNull(connection.lowIncidentSeverityId),
      watchedOrganizations: parseHuntressOrganizationFilter(
        connection.watchedOrganizations,
      ),
      onCallDutyPolicyIds: getIds(
        connection.onCallDutyPolicies as Array<OnCallDutyPolicy> | undefined,
      ),
      labelIds: getIds(connection.labels as Array<Label> | undefined),
      // On unless switched off: a missing value reads as the column's default.
      resolveIncidentWhenReportCloses:
        connection.resolveIncidentWhenReportCloses !== false,
    };
  }

  // The severity a report is handled at.
  public static getEffectiveSeverity(
    event: HuntressIncidentReportEvent,
  ): HuntressSeverity {
    return event.severity || HUNTRESS_SEVERITY_WHEN_UNKNOWN;
  }

  /*
   * Whether a report pages the connection's on-call policies: it has some,
   * and the report is at or above "Page On-Call For".
   */
  public static shouldPage(data: {
    settings: HuntressConnectionSettings;
    severity: HuntressSeverity;
  }): boolean {
    return (
      data.settings.onCallDutyPolicyIds.length > 0 &&
      isHuntressSeverityAtOrAbove(data.severity, data.settings.pageOnCallFor)
    );
  }

  /*
   * The incident severity a report opens at: the one the connection picked
   * for its Huntress severity, while the project still has it; otherwise
   * the project's severities in rank order - the most severe for critical,
   * the next for high, the one after for low (or the least severe there is,
   * when the project has fewer).
   */
  public static async getIncidentSeverityId(data: {
    settings: HuntressConnectionSettings;
    severity: HuntressSeverity;
  }): Promise<ObjectID> {
    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          projectId: data.settings.projectId,
        },
        select: {
          _id: true,
          order: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    if (severities.length === 0) {
      throw new BadDataException(
        "This project has no incident severities, so a Huntress report cannot open an incident. Add one under Incidents > Settings > Incident Severity.",
      );
    }

    const picked: ObjectID | null =
      data.severity === HuntressSeverity.Critical
        ? data.settings.criticalIncidentSeverityId
        : data.severity === HuntressSeverity.High
          ? data.settings.highIncidentSeverityId
          : data.settings.lowIncidentSeverityId;

    if (picked) {
      const stillThere: IncidentSeverity | undefined = severities.find(
        (severity: IncidentSeverity): boolean => {
          return severity.id?.toString() === picked.toString();
        },
      );

      if (stillThere?.id) {
        return stillThere.id;
      }
    }

    const rank: number =
      data.severity === HuntressSeverity.Critical
        ? 0
        : data.severity === HuntressSeverity.High
          ? 1
          : 2;

    return severities[Math.min(rank, severities.length - 1)]!.id!;
  }

  public static async process(data: {
    settings: HuntressConnectionSettings;
    event: HuntressIncidentReportEvent;
    // The webhook message's id (svix-id): the same on every retry.
    messageId: string;
    now?: Date | undefined;
  }): Promise<HuntressReportResult> {
    const settings: HuntressConnectionSettings = data.settings;
    const event: HuntressIncidentReportEvent = data.event;
    const accountId: string = event.account.id || "";

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: `${settings.projectId.toString()}:${accountId}:${event.reportId}`,
        namespace: "HuntressIncidentReportProcessor.process",
        lockTimeout: 30000,
        acquireTimeout: 10000,
      });
    } catch (err) {
      /*
       * Valkey unavailable, or another delivery of this report held the
       * lock for ten seconds. The claim row still lets only one delivery
       * open the incident; go on without the lock.
       */
      logger.debug(
        `HuntressIncidentReportProcessor: going on without the report lock: ${err}`,
      );
    }

    try {
      return await this.processLocked({
        settings,
        event,
        accountId,
        messageId: data.messageId,
        now: data.now || OneUptimeDate.getCurrentDate(),
      });
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.debug(
            `HuntressIncidentReportProcessor: could not release the report lock: ${err}`,
          );
        }
      }
    }
  }

  private static async processLocked(data: {
    settings: HuntressConnectionSettings;
    event: HuntressIncidentReportEvent;
    accountId: string;
    messageId: string;
    now: Date;
  }): Promise<HuntressReportResult> {
    const settings: HuntressConnectionSettings = data.settings;
    const event: HuntressIncidentReportEvent = data.event;

    const existing: HuntressIncidentReport | null =
      await HuntressIncidentReportService.findOneBy({
        query: {
          projectId: settings.projectId,
          huntressAccountId: data.accountId,
          huntressIncidentReportId: event.reportId,
        },
        select: {
          _id: true,
          huntressConnectionId: true,
          outcome: true,
          status: true,
          incidentId: true,
          updatedAt: true,
          appliedMessageIds: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!existing) {
      return await this.receiveNewReport(data);
    }

    const appliedMessageIds: Array<string> = this.readAppliedMessageIds(
      existing.appliedMessageIds,
    );

    if (appliedMessageIds.includes(data.messageId)) {
      return {
        action: HuntressReportAction.Duplicate,
        outcome: existing.outcome!,
        incidentId: existing.incidentId || null,
      };
    }

    const outcome: HuntressIncidentReportOutcome = existing.outcome!;

    if (outcome === HuntressIncidentReportOutcome.Opening) {
      const claimedAt: Date = existing.updatedAt || data.now;

      if (
        data.now.getTime() - new Date(claimedAt).getTime() <
        HUNTRESS_CLAIM_IN_PROGRESS_MS
      ) {
        throw new HuntressReportBusyException();
      }

      // The attempt that claimed the report failed: finish it.
      return await this.openIncidentForClaim({
        ...data,
        reportRowId: existing.id!,
        appliedMessageIds,
      });
    }

    const wasFinished: boolean =
      outcome === HuntressIncidentReportOutcome.IncidentResolved ||
      isHuntressReportStatusFinished(existing.status);

    const appliedAfter: Array<string> = this.withMessageId(
      appliedMessageIds,
      data.messageId,
    );

    let action: HuntressReportAction = HuntressReportAction.NothingToDo;
    let newOutcome: HuntressIncidentReportOutcome = outcome;

    if (isHuntressOutcomeSkipped(outcome)) {
      action = HuntressReportAction.Skipped;
    } else if (didHuntressOutcomeOpenIncident(outcome) && existing.incidentId) {
      const incidentId: ObjectID = existing.incidentId;

      if (
        event.eventType ===
          HuntressWebhookEventType.IncidentReportCommentAdded &&
        event.comment
      ) {
        await this.addNote({
          settings,
          incidentId,
          note: getHuntressCommentNote(event.comment),
        });
        action = HuntressReportAction.NoteAdded;
      }

      if (isHuntressReportFinished(event) && !wasFinished) {
        if (settings.resolveIncidentWhenReportCloses) {
          const resolved: boolean = await this.resolveIncident({
            settings,
            incidentId,
            event,
          });

          newOutcome = HuntressIncidentReportOutcome.IncidentResolved;

          if (resolved) {
            action = HuntressReportAction.IncidentResolved;
          }
        } else {
          await this.addNote({
            settings,
            incidentId,
            note: getHuntressClosedNote(event),
          });
          action = HuntressReportAction.NoteAdded;
        }
      }
    }

    await this.updateReportRow(existing.id!, {
      ...this.getLatestFacts(data),
      // A report whose connection was deleted belongs to the one receiving it now.
      ...(existing.huntressConnectionId
        ? {}
        : { huntressConnectionId: settings.id }),
      outcome: newOutcome,
      appliedMessageIds: appliedAfter,
    });

    return {
      action,
      outcome: newOutcome,
      incidentId: existing.incidentId || null,
    };
  }

  private static async receiveNewReport(data: {
    settings: HuntressConnectionSettings;
    event: HuntressIncidentReportEvent;
    accountId: string;
    messageId: string;
    now: Date;
  }): Promise<HuntressReportResult> {
    const settings: HuntressConnectionSettings = data.settings;
    const event: HuntressIncidentReportEvent = data.event;

    let outcome: HuntressIncidentReportOutcome =
      HuntressIncidentReportOutcome.Opening;

    if (isHuntressReportFinished(event)) {
      outcome = HuntressIncidentReportOutcome.ClosedBeforeReceived;
    } else if (
      !isHuntressOrganizationWatched({
        filter: settings.watchedOrganizations,
        organization: event.organization,
      })
    ) {
      outcome = HuntressIncidentReportOutcome.OrganizationNotWatched;
    }

    const row: HuntressIncidentReport = new HuntressIncidentReport();
    row.projectId = settings.projectId;
    row.huntressConnectionId = settings.id;
    row.huntressAccountId = data.accountId;
    row.huntressIncidentReportId = event.reportId;
    row.outcome = outcome;
    row.pagedOnCall = false;
    Object.assign(row, this.getLatestFacts(data));

    /*
     * A skipped report is decided now; a claim takes its message id when
     * the incident is open, so a delivery that fails half way is applied
     * again when Huntress retries it.
     */
    row.appliedMessageIds = (outcome === HuntressIncidentReportOutcome.Opening
      ? []
      : [data.messageId]) as unknown as JSONArray;

    const created: HuntressIncidentReport =
      await HuntressIncidentReportService.create({
        data: row,
        props: {
          isRoot: true,
        },
      });

    if (outcome !== HuntressIncidentReportOutcome.Opening) {
      return {
        action: HuntressReportAction.Skipped,
        outcome,
        incidentId: null,
      };
    }

    return await this.openIncidentForClaim({
      ...data,
      reportRowId: created.id!,
      appliedMessageIds: [],
    });
  }

  /*
   * Open the incident for a claimed report, and record it on the claim.
   * A report that is already over by now opens none.
   */
  private static async openIncidentForClaim(data: {
    settings: HuntressConnectionSettings;
    event: HuntressIncidentReportEvent;
    reportRowId: ObjectID;
    appliedMessageIds: Array<string>;
    messageId: string;
    now: Date;
  }): Promise<HuntressReportResult> {
    const settings: HuntressConnectionSettings = data.settings;
    const event: HuntressIncidentReportEvent = data.event;

    if (isHuntressReportFinished(event)) {
      await this.updateReportRow(data.reportRowId, {
        ...this.getLatestFacts(data),
        outcome: HuntressIncidentReportOutcome.ClosedBeforeReceived,
        appliedMessageIds: this.withMessageId(
          data.appliedMessageIds,
          data.messageId,
        ),
      });

      return {
        action: HuntressReportAction.Skipped,
        outcome: HuntressIncidentReportOutcome.ClosedBeforeReceived,
        incidentId: null,
      };
    }

    const severity: HuntressSeverity = this.getEffectiveSeverity(event);
    const page: boolean = this.shouldPage({ settings, severity });

    const incident: Incident = new Incident();
    incident.projectId = settings.projectId;
    incident.title = getHuntressIncidentTitle(event);
    incident.description = getHuntressIncidentDescription({ event, severity });
    incident.incidentSeverityId = await this.getIncidentSeverityId({
      settings,
      severity,
    });
    incident.isCreatedAutomatically = true;
    // A security incident is never news for a public status page.
    incident.isVisibleOnStatusPage = false;

    incident.onCallDutyPolicies = page
      ? settings.onCallDutyPolicyIds.map((id: ObjectID): OnCallDutyPolicy => {
          const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
          policy._id = id.toString();
          return policy;
        })
      : [];

    const labelIds: Array<ObjectID> = [...settings.labelIds];

    if (event.organization.name) {
      const organizationLabelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: settings.projectId,
          labelNames: [
            event.organization.name.slice(0, HUNTRESS_MAX_LABEL_NAME_LENGTH),
          ],
        });

      for (const labelId of organizationLabelIds) {
        if (
          !labelIds.some((id: ObjectID): boolean => {
            return id.toString() === labelId.toString();
          })
        ) {
          labelIds.push(labelId);
        }
      }
    }

    incident.labels = labelIds.map((id: ObjectID): Label => {
      const label: Label = new Label();
      label._id = id.toString();
      return label;
    });

    const created: Incident = await IncidentService.create({
      data: incident,
      props: {
        isRoot: true,
      },
    });

    await this.updateReportRow(data.reportRowId, {
      ...this.getLatestFacts(data),
      incidentId: created.id!,
      outcome: HuntressIncidentReportOutcome.IncidentOpened,
      pagedOnCall: page,
      appliedMessageIds: this.withMessageId(
        data.appliedMessageIds,
        data.messageId,
      ),
    });

    // A report first heard of through a comment keeps the comment too.
    if (
      event.eventType === HuntressWebhookEventType.IncidentReportCommentAdded &&
      event.comment
    ) {
      await this.addNote({
        settings,
        incidentId: created.id!,
        note: getHuntressCommentNote(event.comment),
      });
    }

    return {
      action: HuntressReportAction.IncidentOpened,
      outcome: HuntressIncidentReportOutcome.IncidentOpened,
      incidentId: created.id!,
    };
  }

  // The facts of the report as Huntress last sent them.
  public static getLatestFacts(data: {
    event: HuntressIncidentReportEvent;
    now: Date;
  }): HuntressReportFacts {
    const event: HuntressIncidentReportEvent = data.event;
    const facts: HuntressReportFacts = {
      lastEventType: event.eventType,
      lastEventReceivedAt: data.now,
    };

    if (event.organization.id) {
      facts.organizationId = event.organization.id;
    }

    if (event.organization.name) {
      facts.organizationName = event.organization.name;
    }

    if (event.subject) {
      facts.subject = event.subject;
    }

    const affectedName: string | null = getHuntressAffectedName(event);

    if (affectedName) {
      facts.affectedName = affectedName;
    }

    if (event.severity) {
      facts.severity = event.severity;
    }

    if (event.status) {
      facts.status = event.status;
    }

    return facts;
  }

  private static async updateReportRow(
    id: ObjectID,
    update: HuntressReportRowUpdate,
  ): Promise<void> {
    await HuntressIncidentReportService.updateOneById({
      id,
      data: update as unknown as QueryDeepPartialEntity<HuntressIncidentReport>,
      props: {
        isRoot: true,
      },
    });
  }

  private static readAppliedMessageIds(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((id: unknown): id is string => {
      return typeof id === "string";
    });
  }

  // The ids with this one added, keeping the latest few.
  private static withMessageId(
    ids: Array<string>,
    messageId: string,
  ): Array<string> {
    return [
      ...ids.filter((id: string): boolean => {
        return id !== messageId;
      }),
      messageId,
    ].slice(-HUNTRESS_APPLIED_MESSAGE_IDS_KEPT);
  }

  private static async addNote(data: {
    settings: HuntressConnectionSettings;
    incidentId: ObjectID;
    note: string;
  }): Promise<void> {
    const note: IncidentInternalNote = new IncidentInternalNote();
    note.projectId = data.settings.projectId;
    note.incidentId = data.incidentId;
    note.note = data.note;

    await IncidentInternalNoteService.create({
      data: note,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Resolve the report's incident. Returns false when there was nothing to
   * do: the incident is gone, or someone resolved it already.
   */
  private static async resolveIncident(data: {
    settings: HuntressConnectionSettings;
    incidentId: ObjectID;
    event: HuntressIncidentReportEvent;
  }): Promise<boolean> {
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        _id: true,
        currentIncidentStateId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      return false;
    }

    const unresolvedStateIds: Array<ObjectID> =
      await IncidentStateService.getUnresolvedIncidentStateIds(
        data.settings.projectId,
      );

    const isOpen: boolean = unresolvedStateIds.some(
      (stateId: ObjectID): boolean => {
        return (
          stateId.toString() === incident.currentIncidentStateId?.toString()
        );
      },
    );

    if (!isOpen) {
      return false;
    }

    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.projectId = data.settings.projectId;
    timeline.incidentId = data.incidentId;
    timeline.incidentStateId =
      await IncidentStateTimelineService.getResolvedStateIdForProject(
        data.settings.projectId,
      );
    timeline.rootCause = getHuntressResolvedReason(data.event);

    try {
      await IncidentStateTimelineService.create({
        data: timeline,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      // Resolved by someone else in the meantime.
      if (
        err instanceof BadDataException &&
        err.message === "Incident state cannot be same as previous state."
      ) {
        return false;
      }

      throw err;
    }

    return true;
  }
}
