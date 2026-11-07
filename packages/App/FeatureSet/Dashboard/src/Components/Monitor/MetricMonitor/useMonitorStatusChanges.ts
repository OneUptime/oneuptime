import { useEffect, useState } from "react";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import MetricInvestigationTime from "../../Metrics/Investigation/MetricInvestigationTime";
import {
  MonitorStatusChange,
  getMonitorStatusChanges,
} from "../../../Utils/MonitorMetricInvestigation";

/*
 * When a monitor's status changed inside a window, for its metric charts to
 * mark (issue #5759): the moments it went Offline, Degraded or back to
 * Operational, beside the incidents and alerts it opened.
 *
 * Best effort: a reader who may not read the timeline, or a read that
 * fails, gets charts without these marks, never an error. No timer of its
 * own: it reads again when the window moves or the page asks.
 */

// The most changes read for one window: the newest, when there are more.
export const MONITOR_STATUS_CHANGES_FETCH_LIMIT: number = 50;

// One empty list, so a render while reading hands the charts the same one.
const NO_CHANGES: Array<MonitorStatusChange> = [];

interface ReadResult {
  requestKey: string;
  changes: Array<MonitorStatusChange>;
}

export default function useMonitorStatusChanges(input: {
  monitorId: ObjectID;
  window: InBetween<Date>;
  // Moves when the page wants them read again (Refresh, a status change).
  refreshToken: number;
}): Array<MonitorStatusChange> {
  const [result, setResult] = useState<ReadResult | null>(null);

  const usableWindow: InBetween<Date> | null =
    MetricInvestigationTime.toUsableWindow(input.window);
  const startMs: number = usableWindow
    ? usableWindow.startValue.getTime()
    : Number.NaN;
  const endMs: number = usableWindow
    ? usableWindow.endValue.getTime()
    : Number.NaN;
  const monitorIdString: string = input.monitorId.toString();

  const requestKey: string = JSON.stringify([
    monitorIdString,
    startMs,
    endMs,
    input.refreshToken,
  ]);

  useEffect(() => {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return;
    }

    let isCancelled: boolean = false;

    const read: () => Promise<void> = async (): Promise<void> => {
      let changes: Array<MonitorStatusChange> = [];

      try {
        const window: InBetween<Date> = new InBetween<Date>(
          new Date(startMs),
          new Date(endMs),
        );

        const listResult: ListResult<MonitorStatusTimeline> =
          await ModelAPI.getList<MonitorStatusTimeline>({
            modelType: MonitorStatusTimeline,
            query: {
              monitorId: new ObjectID(monitorIdString),
              startsAt: window,
            },
            select: {
              _id: true,
              startsAt: true,
              monitorStatus: {
                name: true,
                color: true,
              },
            },
            sort: {
              startsAt: SortOrder.Descending,
            },
            limit: MONITOR_STATUS_CHANGES_FETCH_LIMIT,
            skip: 0,
          });

        changes = getMonitorStatusChanges({
          rows: listResult.data,
          window: window,
        });
      } catch {
        // No marks rather than an error: the charts stand on their own.
        changes = [];
      }

      if (!isCancelled) {
        setResult({ requestKey, changes });
      }
    };

    void read();

    return () => {
      isCancelled = true;
    };
  }, [requestKey]);

  // The changes of this window only: none while a new one is read.
  return result && result.requestKey === requestKey
    ? result.changes
    : NO_CHANGES;
}
