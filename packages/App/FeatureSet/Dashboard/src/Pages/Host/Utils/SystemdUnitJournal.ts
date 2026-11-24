import Log from "Common/Models/AnalyticsModels/Log";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE,
  JOURNALD_SYSTEMD_RESULT_ATTRIBUTE,
  JOURNALD_SYSTEMD_UNIT_ATTRIBUTE,
} from "Common/Utils/HostCollector/HostCollectorDefaultConfig";
import {
  HOST_NAME_LOG_ATTRIBUTE,
  SYSTEMD_UNIT_JOURNAL_READ_LIMIT,
  SYSTEMD_UNIT_JOURNAL_WINDOW_DAYS,
  SystemdUnitJournalLine,
} from "./SystemdUnitFailure";

/*
 * A unit's journal, as its page reads it (#9748): the host's log lines the
 * collector filed under the unit (systemd.unit.name), its own and what
 * systemd said about it, the newest SYSTEMD_UNIT_JOURNAL_READ_LIMIT of the
 * last SYSTEMD_UNIT_JOURNAL_WINDOW_DAYS days - newest first. A failed unit
 * prints nothing after it failed, so its failure is among them.
 *
 * And the failed units of the Systemd Units list (#9960), all at once: only
 * the lines that say why a unit failed - systemd's result
 * (systemd.unit.result) and how its process ended (systemd.unit.exit_code) -
 * of those units, so another unit's chatter, or one crash-looping, never
 * pushes a failure out of the read.
 */

export interface SystemdUnitJournalWindow {
  startTime: Date;
  endTime: Date;
}

export function getSystemdUnitJournalWindow(
  now: Date,
): SystemdUnitJournalWindow {
  return {
    startTime: OneUptimeDate.addRemoveDays(
      now,
      -SYSTEMD_UNIT_JOURNAL_WINDOW_DAYS,
    ),
    endTime: now,
  };
}

/*
 * How many of the lines that say why units failed one read of the list's
 * failed units takes, of each kind: systemd writes a result and an exit
 * per failure, so this holds many failures of every unit listed.
 */
export const SYSTEMD_FAILED_UNITS_JOURNAL_READ_LIMIT: number = 500;

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

// The host's lines of the window that match `attributes`, newest first.
async function readHostJournalLines(data: {
  hostIdentifier: string;
  attributes: Record<string, unknown>;
  window: SystemdUnitJournalWindow;
  limit: number;
}): Promise<Array<SystemdUnitJournalLine>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  /*
   * `any`-typed, as the pages' own reads: the attributes filter with the
   * generic select is a TS2589 deep instantiation otherwise.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request: any = {
    modelType: Log,
    query: {
      projectId: projectId.toString(),
      time: new InBetween<Date>(data.window.startTime, data.window.endTime),
      attributes: {
        [HOST_NAME_LOG_ATTRIBUTE]: data.hostIdentifier,
        ...data.attributes,
      },
    },
    limit: data.limit,
    skip: 0,
    select: {
      time: true,
      body: true,
      severityText: true,
      attributes: true,
    },
    sort: {
      time: SortOrder.Descending,
    },
    requestOptions: {},
  };

  const result: ListResult<Log> = await AnalyticsModelAPI.getList<Log>(request);

  const lines: Array<SystemdUnitJournalLine> = [];

  for (const log of result.data) {
    const time: Date | null = toDate(log.time);

    if (!time) {
      continue;
    }

    lines.push({
      time: time,
      body: typeof log.body === "string" ? log.body : "",
      severityText:
        typeof log.severityText === "string" ? log.severityText : undefined,
      attributes: (log.attributes as Record<string, unknown>) || {},
    });
  }

  return lines;
}

export async function readSystemdUnitJournal(data: {
  hostIdentifier: string;
  unitName: string;
  window: SystemdUnitJournalWindow;
}): Promise<Array<SystemdUnitJournalLine>> {
  return await readHostJournalLines({
    hostIdentifier: data.hostIdentifier,
    attributes: {
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: data.unitName,
    },
    window: data.window,
    limit: SYSTEMD_UNIT_JOURNAL_READ_LIMIT,
  });
}

/*
 * What systemd said of why these units failed, in the window: its result
 * lines and its process-exit lines, read at once, newest first in each.
 */
export async function readSystemdFailedUnitsJournal(data: {
  hostIdentifier: string;
  unitNames: ReadonlyArray<string>;
  window: SystemdUnitJournalWindow;
}): Promise<Array<SystemdUnitJournalLine>> {
  if (data.unitNames.length === 0) {
    return [];
  }

  const ofUnits: Record<string, unknown> = {
    [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: new Includes([...data.unitNames]),
  };

  const [results, exits] = await Promise.all([
    readHostJournalLines({
      hostIdentifier: data.hostIdentifier,
      attributes: {
        ...ofUnits,
        [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: new NotNull(),
      },
      window: data.window,
      limit: SYSTEMD_FAILED_UNITS_JOURNAL_READ_LIMIT,
    }),
    readHostJournalLines({
      hostIdentifier: data.hostIdentifier,
      attributes: {
        ...ofUnits,
        [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE]: new NotNull(),
      },
      window: data.window,
      limit: SYSTEMD_FAILED_UNITS_JOURNAL_READ_LIMIT,
    }),
  ]);

  return [...results, ...exits];
}
