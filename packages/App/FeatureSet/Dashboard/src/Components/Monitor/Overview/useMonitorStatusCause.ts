import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * The root cause of the status the monitor is in now, for its hero's why
 * (#9592): the current status event's, read when that event is first seen
 * and never again until the status changes - it is written once, when the
 * status changes. The page's poll reads the newest status events without
 * it, so a Markdown that can run to a few kilobytes is not downloaded every
 * minute.
 *
 * Read with the access every monitor page has to its status timeline: the
 * column is readable wherever the events are. A read that fails says so
 * ("failed"): the hero then explains the status from its probes alone, and
 * never claims a reason it could not read.
 */

export type MonitorStatusCauseState = "idle" | "loading" | "loaded" | "failed";

export interface MonitorStatusCause {
  state: MonitorStatusCauseState;
  // The status event the cause is of.
  rowId?: string | undefined;
  // Its root cause, as stored; empty when it has none.
  rootCause?: string | undefined;
}

export const MONITOR_STATUS_CAUSE_SELECT: Select<MonitorStatusTimeline> = {
  _id: true,
  rootCause: true,
};

export async function readMonitorStatusCause(
  rowId: string,
): Promise<MonitorStatusCause> {
  try {
    const row: MonitorStatusTimeline | null = await ModelAPI.getItem({
      modelType: MonitorStatusTimeline,
      id: new ObjectID(rowId),
      select: MONITOR_STATUS_CAUSE_SELECT,
    });

    return {
      state: "loaded",
      rowId: rowId,
      rootCause: row?.rootCause?.toString() || "",
    };
  } catch {
    return { state: "failed", rowId: rowId };
  }
}

const useMonitorStatusCause: (options: {
  // The current status event: undefined while there is nothing to explain.
  rowId: string | undefined;
}) => MonitorStatusCause = (options: {
  rowId: string | undefined;
}): MonitorStatusCause => {
  const [cause, setCause] = useState<MonitorStatusCause>({ state: "idle" });

  useEffect(() => {
    const rowId: string | undefined = options.rowId;

    if (!rowId) {
      setCause({ state: "idle" });
      return;
    }

    let isCancelled: boolean = false;

    setCause({ state: "loading", rowId: rowId });

    void readMonitorStatusCause(rowId).then(
      (read: MonitorStatusCause): void => {
        if (!isCancelled) {
          setCause(read);
        }
      },
    );

    return () => {
      isCancelled = true;
    };
  }, [options.rowId]);

  /*
   * A cause is only ever of the event it was read for: between a new event
   * and its read, the hero waits for it rather than show the old one.
   */
  if (!options.rowId) {
    return { state: "idle" };
  }

  return cause.rowId === options.rowId
    ? cause
    : { state: "loading", rowId: options.rowId };
};

export default useMonitorStatusCause;
