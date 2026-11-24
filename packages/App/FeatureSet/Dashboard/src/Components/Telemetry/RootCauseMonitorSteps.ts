import {
  MonitorStepsOfMonitor,
  readMonitorSteps,
} from "../Monitor/ReadMonitorSteps";
import {
  RootCauseEvent,
  getRootCauseMonitorIdsToRead,
  withRootCauseMonitorSteps,
} from "../../Utils/EventRootCauseMetrics";

/*
 * The event as the Root Cause card charts it (#10309). Its monitors are read
 * through it by which they are and what kind (MONITOR_THROUGH_RELATION_SELECT),
 * which every reader of the event reads; no relation reads their steps. An
 * event that kept a metric snapshot is charted as it was read. One that kept
 * none gets the steps of its monitors that read metrics, each read on the
 * monitor by the reader's own read (ReadMonitorSteps). A reader who may not
 * read those monitors gets the event as it was read, and the card charts
 * nothing from them.
 */
export async function readRootCauseMonitorSteps(
  event: RootCauseEvent,
): Promise<RootCauseEvent> {
  const monitorIds: Array<string> = getRootCauseMonitorIdsToRead(event);

  // Nothing to read: no monitor's steps, whatever the event's read held.
  const read: Array<MonitorStepsOfMonitor> =
    monitorIds.length > 0 ? await readMonitorSteps(monitorIds) : [];

  return withRootCauseMonitorSteps(event, read);
}
