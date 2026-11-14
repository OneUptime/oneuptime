import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentService from "Common/Server/Services/IncidentService";
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordKind,
  OnCallTimeoutRecordState,
} from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import {
  OnCallRecordColumns,
  OnCallRecordState,
} from "Common/Server/Utils/OnCall/OnCallRecordStates";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";

/*
 * ONCALLRECORDSTATES, ANSWERED ONE RECORD AT A TIME.
 *
 * The on-call workers used to ask of each run or person's log, on its own,
 * where its record stands: IncidentService.isIncidentAcknowledged and its
 * kin, findOneById for a record's severity, and
 * OnCallAcknowledgementTimeout.readRecordState for whether it is resolved.
 * They now read a page's records together (OnCallRecordStates). The suites
 * that pin what a run does once its record is acknowledged, resolved or
 * gone mock those per-record reads; with this module in place of
 * OnCallRecordStates they go on pinning it, read for read:
 *
 *   jest.mock("Common/Server/Utils/OnCall/OnCallRecordStates", () => {
 *     return jest
 *       .requireActual("../Fixtures/OnCallRecordStatesPerRecord")
 *       .onCallRecordStatesReadPerRecord();
 *   });
 *
 * OnCallRecordStates.test.ts pins that the page's reads answer as these did.
 */

// The record columns, in the order the workers asked whether one is acknowledged.
const ACKNOWLEDGED_ORDER: Array<{
  kind: OnCallTimeoutRecordKind;
  column: keyof OnCallRecordColumns;
}> = [
  { kind: "alert", column: "triggeredByAlertId" },
  { kind: "incident", column: "triggeredByIncidentId" },
  { kind: "alert episode", column: "triggeredByAlertEpisodeId" },
  { kind: "incident episode", column: "triggeredByIncidentEpisodeId" },
];

async function isAcknowledgedOnItsOwn(
  kind: OnCallTimeoutRecordKind,
  recordId: ObjectID,
): Promise<boolean> {
  switch (kind) {
    case "incident":
      return await IncidentService.isIncidentAcknowledged({
        incidentId: recordId,
      });
    case "alert":
      return await AlertService.isAlertAcknowledged({ alertId: recordId });
    case "alert episode":
      return await AlertEpisodeService.isEpisodeAcknowledged({
        episodeId: recordId,
      });
    case "incident episode":
      return await IncidentEpisodeService.isEpisodeAcknowledged({
        episodeId: recordId,
      });
  }
}

// A record's severity, read as the person's-log worker read it.
async function readSeverityOnItsOwn(
  kind: OnCallTimeoutRecordKind,
  recordId: ObjectID,
): Promise<ObjectID | null | undefined> {
  switch (kind) {
    case "incident": {
      const incident: Incident | null = await IncidentService.findOneById({
        id: recordId,
        props: { isRoot: true },
        select: { incidentSeverityId: true },
      });
      return incident ? incident.incidentSeverityId || null : undefined;
    }
    case "alert": {
      const alert: Alert | null = await AlertService.findOneById({
        id: recordId,
        props: { isRoot: true },
        select: { alertSeverityId: true },
      });
      return alert ? alert.alertSeverityId || null : undefined;
    }
    case "alert episode": {
      const episode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
          id: recordId,
          props: { isRoot: true },
          select: { alertSeverityId: true },
        });
      return episode ? episode.alertSeverityId || null : undefined;
    }
    case "incident episode": {
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: recordId,
          props: { isRoot: true },
          select: { incidentSeverityId: true },
        });
      return episode ? episode.incidentSeverityId || null : undefined;
    }
  }
}

class OnCallRecordStatesPerRecord {
  public async getHandledRecordKind(
    row: OnCallRecordColumns,
  ): Promise<OnCallTimeoutRecordKind | null> {
    for (const { kind, column } of ACKNOWLEDGED_ORDER) {
      const recordId: ObjectID | null | undefined = row[column];

      if (recordId && (await isAcknowledgedOnItsOwn(kind, recordId))) {
        return kind;
      }
    }

    return null;
  }

  public async getResolvedRecordKind(
    row: OnCallRecordColumns,
  ): Promise<OnCallTimeoutRecordKind | null> {
    const record: { kind: OnCallTimeoutRecordKind; recordId: ObjectID } | null =
      OnCallAcknowledgementTimeout.getRunRecord(row);

    if (!record) {
      return null;
    }

    const state: OnCallTimeoutRecordState | null =
      await OnCallAcknowledgementTimeout.readRecordState(record);

    if (!state) {
      throw new BadDataException(
        `The ${record.kind} this page is about is gone.`,
      );
    }

    return state.isResolved ? record.kind : null;
  }

  public async isAcknowledged(
    kind: OnCallTimeoutRecordKind,
    recordId: ObjectID,
  ): Promise<boolean> {
    return await isAcknowledgedOnItsOwn(kind, recordId);
  }

  // The record's severity, as findOneById read it; null when it is gone.
  public async readRecord(
    kind: OnCallTimeoutRecordKind,
    recordId: ObjectID,
  ): Promise<OnCallRecordState | null> {
    const severityId: ObjectID | null | undefined = await readSeverityOnItsOwn(
      kind,
      recordId,
    );

    if (severityId === undefined) {
      return null;
    }

    return {
      projectId: ObjectID.generate(),
      stateId: null,
      severityId: severityId,
      isAcknowledged: false,
      isResolved: false,
    };
  }
}

// The module jest.mock puts in place of OnCallRecordStates.
export function onCallRecordStatesReadPerRecord(): Record<string, unknown> {
  return {
    __esModule: true,
    OnCallStateCache: class {
      // Nothing to keep: each record is read on its own.
    },
    default: {
      read: async (): Promise<OnCallRecordStatesPerRecord> => {
        return new OnCallRecordStatesPerRecord();
      },
    },
  };
}
