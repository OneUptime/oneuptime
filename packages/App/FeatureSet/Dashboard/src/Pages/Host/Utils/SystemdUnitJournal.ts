import Log from "Common/Models/AnalyticsModels/Log";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { JOURNALD_SYSTEMD_UNIT_ATTRIBUTE } from "Common/Utils/HostCollector/HostCollectorDefaultConfig";
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

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

export async function readSystemdUnitJournal(data: {
  hostIdentifier: string;
  unitName: string;
  window: SystemdUnitJournalWindow;
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
        [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: data.unitName,
      },
    },
    limit: SYSTEMD_UNIT_JOURNAL_READ_LIMIT,
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
