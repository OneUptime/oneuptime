import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import AcknowledgedStateUtil from "../../../Utils/AcknowledgedState";
import ResolvedStateUtil from "../../../Utils/ResolvedState";
import { StateListType } from "../../../Utils/StateOrder";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordKind,
} from "./OnCallAcknowledgementTimeout";

/*
 * WHERE THE RECORDS OF A PAGE OF ON-CALL RUNS STAND, READ TOGETHER.
 *
 * The on-call workers (OnCallDutyPolicyExecutionLog and UserOnCallLog
 * ExecutePendingExecutions) ask, every minute, of every run still paging:
 * is its incident, alert or episode acknowledged? resolved? Each asked on
 * its own - the record, then its project's states - two to four reads per
 * run, all at once: in an alert storm, thousands of queries at the same
 * moment on a pool of fifty connections, while on-call pages failed to
 * load.
 *
 * Here a page of runs is answered together: one query per kind of record
 * for the records the page names, and one per list of states for the
 * projects not read yet this run of the worker (OnCallStateCache). Each
 * record is then read by the same rule its own reads used
 * (AcknowledgedStateUtil, ResolvedStateUtil), and a record that is gone
 * fails its run with the message its own read gave.
 */

// A row that names the records it pages about: a run, or a person's log.
export interface OnCallRecordColumns {
  triggeredByIncidentId?: ObjectID | null | undefined;
  triggeredByAlertId?: ObjectID | null | undefined;
  triggeredByAlertEpisodeId?: ObjectID | null | undefined;
  triggeredByIncidentEpisodeId?: ObjectID | null | undefined;
}

// Where one record stands.
export interface OnCallRecordState {
  projectId: ObjectID;
  stateId: ObjectID | null;
  // The record's severity: an incident's or an alert's.
  severityId: ObjectID | null;
  // In a state that counts as acknowledged - resolved ones included.
  isAcknowledged: boolean;
  isResolved: boolean;
}

// How many records or projects one read asks for.
export const ON_CALL_RECORD_READ_CHUNK: number = 500;

interface RecordKindAccess {
  kind: OnCallTimeoutRecordKind;
  list: StateListType.IncidentState | StateListType.AlertState;
  // What the record's own acknowledged read said of a record that is gone.
  goneMessage: string;
  readRecords: (ids: Array<ObjectID>) => Promise<
    Array<{
      id: ObjectID | null;
      projectId: ObjectID | null;
      stateId: ObjectID | null;
      severityId: ObjectID | null;
    }>
  >;
}

const INCIDENT_ACCESS: RecordKindAccess = {
  kind: "incident",
  list: StateListType.IncidentState,
  goneMessage: "Incident not found",
  readRecords: async (ids: Array<ObjectID>) => {
    const incidents: Array<Incident> = await IncidentService.findBy({
      query: { _id: QueryHelper.any(ids) },
      select: {
        _id: true,
        projectId: true,
        currentIncidentStateId: true,
        incidentSeverityId: true,
      },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });

    return incidents.map((incident: Incident) => {
      return {
        id: incident.id || null,
        projectId: incident.projectId || null,
        stateId: incident.currentIncidentStateId || null,
        severityId: incident.incidentSeverityId || null,
      };
    });
  },
};

const ALERT_ACCESS: RecordKindAccess = {
  kind: "alert",
  list: StateListType.AlertState,
  goneMessage: "Alert not found",
  readRecords: async (ids: Array<ObjectID>) => {
    const alerts: Array<Alert> = await AlertService.findBy({
      query: { _id: QueryHelper.any(ids) },
      select: {
        _id: true,
        projectId: true,
        currentAlertStateId: true,
        alertSeverityId: true,
      },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });

    return alerts.map((alert: Alert) => {
      return {
        id: alert.id || null,
        projectId: alert.projectId || null,
        stateId: alert.currentAlertStateId || null,
        severityId: alert.alertSeverityId || null,
      };
    });
  },
};

const INCIDENT_EPISODE_ACCESS: RecordKindAccess = {
  kind: "incident episode",
  list: StateListType.IncidentState,
  goneMessage: "Episode not found.",
  readRecords: async (ids: Array<ObjectID>) => {
    const episodes: Array<IncidentEpisode> =
      await IncidentEpisodeService.findBy({
        query: { _id: QueryHelper.any(ids) },
        select: {
          _id: true,
          projectId: true,
          currentIncidentStateId: true,
          incidentSeverityId: true,
        },
        skip: 0,
        limit: ids.length,
        props: { isRoot: true },
      });

    return episodes.map((episode: IncidentEpisode) => {
      return {
        id: episode.id || null,
        projectId: episode.projectId || null,
        stateId: episode.currentIncidentStateId || null,
        severityId: episode.incidentSeverityId || null,
      };
    });
  },
};

const ALERT_EPISODE_ACCESS: RecordKindAccess = {
  kind: "alert episode",
  list: StateListType.AlertState,
  goneMessage: "Episode not found.",
  readRecords: async (ids: Array<ObjectID>) => {
    const episodes: Array<AlertEpisode> = await AlertEpisodeService.findBy({
      query: { _id: QueryHelper.any(ids) },
      select: {
        _id: true,
        projectId: true,
        currentAlertStateId: true,
        alertSeverityId: true,
      },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });

    return episodes.map((episode: AlertEpisode) => {
      return {
        id: episode.id || null,
        projectId: episode.projectId || null,
        stateId: episode.currentAlertStateId || null,
        severityId: episode.alertSeverityId || null,
      };
    });
  },
};

const ACCESS_BY_KIND: Record<OnCallTimeoutRecordKind, RecordKindAccess> = {
  incident: INCIDENT_ACCESS,
  alert: ALERT_ACCESS,
  "incident episode": INCIDENT_EPISODE_ACCESS,
  "alert episode": ALERT_EPISODE_ACCESS,
};

/*
 * The record columns of a row, in the order the workers have always asked
 * whether a run's record is acknowledged.
 */
const ACKNOWLEDGED_ORDER: Array<{
  kind: OnCallTimeoutRecordKind;
  column: keyof OnCallRecordColumns;
}> = [
  { kind: "alert", column: "triggeredByAlertId" },
  { kind: "incident", column: "triggeredByIncidentId" },
  { kind: "alert episode", column: "triggeredByAlertEpisodeId" },
  { kind: "incident episode", column: "triggeredByIncidentEpisodeId" },
];

/*
 * The states of each project's incident and alert lists, read once a run of
 * a worker: a run reads many pages, and their records share projects.
 */
export class OnCallStateCache {
  private readonly statesByList: Map<
    StateListType,
    Map<string, Array<IncidentState | AlertState>>
  > = new Map();

  public get(
    list: StateListType,
    projectId: ObjectID,
  ): Array<IncidentState | AlertState> | undefined {
    return this.statesByList.get(list)?.get(projectId.toString());
  }

  public set(
    list: StateListType,
    projectId: ObjectID,
    states: Array<IncidentState | AlertState>,
  ): void {
    let byProject: Map<string, Array<IncidentState | AlertState>> | undefined =
      this.statesByList.get(list);

    if (!byProject) {
      byProject = new Map();
      this.statesByList.set(list, byProject);
    }

    byProject.set(projectId.toString(), states);
  }
}

export default class OnCallRecordStates {
  private readonly states: Map<string, OnCallRecordState | null>;

  private constructor(states: Map<string, OnCallRecordState | null>) {
    this.states = states;
  }

  public static key(kind: OnCallTimeoutRecordKind, recordId: ObjectID): string {
    return `${kind}:${recordId.toString().toLowerCase()}`;
  }

  // Answers made up front, for a test or a caller that read them already.
  public static of(
    states: Map<string, OnCallRecordState | null>,
  ): OnCallRecordStates {
    return new OnCallRecordStates(states);
  }

  /*
   * Reads where every record the rows name stands: one query per kind of
   * record, and one per list of states for the projects `cache` has not
   * read yet. A record that is gone is read as null.
   */
  @CaptureSpan()
  public static async read(data: {
    rows: Array<OnCallRecordColumns>;
    cache?: OnCallStateCache | undefined;
  }): Promise<OnCallRecordStates> {
    const cache: OnCallStateCache = data.cache || new OnCallStateCache();
    const idsByKind: Map<
      OnCallTimeoutRecordKind,
      Map<string, ObjectID>
    > = new Map();

    for (const row of data.rows) {
      for (const { kind, column } of ACKNOWLEDGED_ORDER) {
        const recordId: ObjectID | null | undefined = row[column];

        if (!recordId) {
          continue;
        }

        let ids: Map<string, ObjectID> | undefined = idsByKind.get(kind);

        if (!ids) {
          ids = new Map();
          idsByKind.set(kind, ids);
        }

        ids.set(recordId.toString().toLowerCase(), recordId);
      }
    }

    const states: Map<string, OnCallRecordState | null> = new Map();

    for (const [kind, ids] of idsByKind) {
      const access: RecordKindAccess = ACCESS_BY_KIND[kind];
      const records: Array<{
        id: ObjectID | null;
        projectId: ObjectID | null;
        stateId: ObjectID | null;
        severityId: ObjectID | null;
      }> = [];

      for (const chunk of chunked([...ids.values()])) {
        records.push(...(await access.readRecords(chunk)));
      }

      await readStatesOfProjects({
        list: access.list,
        projectIds: records
          .map((record: { projectId: ObjectID | null }) => {
            return record.projectId;
          })
          .filter((projectId: ObjectID | null): projectId is ObjectID => {
            return Boolean(projectId);
          }),
        cache,
      });

      // Gone until read: a record the query did not return is gone.
      for (const recordId of ids.values()) {
        states.set(OnCallRecordStates.key(kind, recordId), null);
      }

      for (const record of records) {
        if (!record.id || !record.projectId) {
          continue;
        }

        const projectStates: Array<IncidentState | AlertState> =
          cache.get(access.list, record.projectId) || [];

        states.set(OnCallRecordStates.key(kind, record.id), {
          projectId: record.projectId,
          stateId: record.stateId,
          severityId: record.severityId,
          isAcknowledged: record.stateId
            ? AcknowledgedStateUtil.isAcknowledged({
                list: access.list,
                states: projectStates,
                stateId: record.stateId,
              })
            : false,
          isResolved: record.stateId
            ? ResolvedStateUtil.isResolved({
                list: access.list,
                states: projectStates,
                stateId: record.stateId,
              })
            : false,
        });
      }
    }

    return new OnCallRecordStates(states);
  }

  /*
   * Where a record stands: null when it is gone, undefined when it was not
   * read (none of the rows named it).
   */
  public get(
    kind: OnCallTimeoutRecordKind,
    recordId: ObjectID,
  ): OnCallRecordState | null | undefined {
    return this.states.get(OnCallRecordStates.key(kind, recordId));
  }

  /*
   * Where a record stands, as its own read answered: throws, with the
   * message that read gave, for a record that is gone.
   */
  public getOrThrow(
    kind: OnCallTimeoutRecordKind,
    recordId: ObjectID,
  ): OnCallRecordState {
    const state: OnCallRecordState | null | undefined = this.get(
      kind,
      recordId,
    );

    if (state === undefined) {
      throw new Error(
        `The ${kind} ${recordId.toString()} was not read with its page of runs.`,
      );
    }

    if (state === null) {
      throw new BadDataException(ACCESS_BY_KIND[kind].goneMessage);
    }

    return state;
  }

  /*
   * The kind of the first of the row's records that is acknowledged - an
   * alert, an incident, an alert episode, an incident episode, asked in that
   * order as the worker always asked - or null when none is. A record that
   * is gone throws, as its own read did. Async for its callers' sake: they
   * read what one record at a time used to answer.
   */
  public async getHandledRecordKind(
    row: OnCallRecordColumns,
  ): Promise<OnCallTimeoutRecordKind | null> {
    for (const { kind, column } of ACKNOWLEDGED_ORDER) {
      const recordId: ObjectID | null | undefined = row[column];

      if (recordId && this.getOrThrow(kind, recordId).isAcknowledged) {
        return kind;
      }
    }

    return null;
  }

  /*
   * The kind of the row's record (OnCallAcknowledgementTimeout.getRunRecord)
   * when it is resolved; null when it is not, or the row pages about none.
   * A record that is gone throws "The <kind> this page is about is gone.",
   * as the worker always said.
   */
  public async getResolvedRecordKind(
    row: OnCallRecordColumns,
  ): Promise<OnCallTimeoutRecordKind | null> {
    const record: { kind: OnCallTimeoutRecordKind; recordId: ObjectID } | null =
      OnCallAcknowledgementTimeout.getRunRecord(row);

    if (!record) {
      return null;
    }

    const state: OnCallRecordState | null | undefined = this.get(
      record.kind,
      record.recordId,
    );

    if (!state) {
      throw new BadDataException(
        `The ${record.kind} this page is about is gone.`,
      );
    }

    return state.isResolved ? record.kind : null;
  }

  /*
   * Where a record stands, or null when it is gone - what reading the record
   * on its own answered. Async for its callers' sake, like the others.
   */
  public async readRecord(
    kind: OnCallTimeoutRecordKind,
    recordId: ObjectID,
  ): Promise<OnCallRecordState | null> {
    const state: OnCallRecordState | null | undefined = this.get(
      kind,
      recordId,
    );

    if (state === undefined) {
      throw new Error(
        `The ${kind} ${recordId.toString()} was not read with its page of runs.`,
      );
    }

    return state;
  }

  // Whether a record is acknowledged; throws, as its own read did, when gone.
  public async isAcknowledged(
    kind: OnCallTimeoutRecordKind,
    recordId: ObjectID,
  ): Promise<boolean> {
    return this.getOrThrow(kind, recordId).isAcknowledged;
  }
}

function chunked<T>(items: Array<T>): Array<Array<T>> {
  const chunks: Array<Array<T>> = [];

  for (
    let start: number = 0;
    start < items.length;
    start += ON_CALL_RECORD_READ_CHUNK
  ) {
    chunks.push(items.slice(start, start + ON_CALL_RECORD_READ_CHUNK));
  }

  return chunks;
}

/*
 * Reads, in one query per chunk, the states of the projects `cache` has not
 * read yet, in each project's order - what getAllIncidentStates and
 * getAllAlertStates read for one project.
 */
async function readStatesOfProjects(data: {
  list: StateListType.IncidentState | StateListType.AlertState;
  projectIds: Array<ObjectID>;
  cache: OnCallStateCache;
}): Promise<void> {
  const unread: Map<string, ObjectID> = new Map();

  for (const projectId of data.projectIds) {
    if (!data.cache.get(data.list, projectId)) {
      unread.set(projectId.toString(), projectId);
    }
  }

  if (unread.size === 0) {
    return;
  }

  for (const chunk of chunked([...unread.values()])) {
    const states: Array<IncidentState | AlertState> =
      data.list === StateListType.IncidentState
        ? await IncidentStateService.findBy({
            query: { projectId: QueryHelper.any(chunk) },
            select: {
              _id: true,
              projectId: true,
              isResolvedState: true,
              isAcknowledgedState: true,
              isCreatedState: true,
              order: true,
              name: true,
            },
            sort: { order: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_MAX,
            props: { isRoot: true },
          })
        : await AlertStateService.findBy({
            query: { projectId: QueryHelper.any(chunk) },
            select: {
              _id: true,
              projectId: true,
              isResolvedState: true,
              isAcknowledgedState: true,
              isCreatedState: true,
              order: true,
              name: true,
            },
            sort: { order: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_MAX,
            props: { isRoot: true },
          });

    const byProject: Map<string, Array<IncidentState | AlertState>> = new Map();

    for (const projectId of chunk) {
      byProject.set(projectId.toString(), []);
    }

    for (const state of states) {
      const key: string | undefined = state.projectId?.toString();

      if (key && byProject.has(key)) {
        byProject.get(key)!.push(state);
      }
    }

    for (const projectId of chunk) {
      data.cache.set(
        data.list,
        projectId,
        byProject.get(projectId.toString()) || [],
      );
    }
  }
}
