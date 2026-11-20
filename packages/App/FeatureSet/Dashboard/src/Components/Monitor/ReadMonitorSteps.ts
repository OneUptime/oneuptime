import Monitor from "Common/Models/DatabaseModels/Monitor";
import Includes from "Common/Types/BaseDatabase/Includes";
import SeriesDebugHints from "Common/Types/Monitor/SeriesContext/SeriesDebugHints";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";

/*
 * A MONITOR'S STEPS ARE READ ON THE MONITOR, BY THE MONITOR'S OWN READ
 * (#10309).
 *
 * A monitor's steps are the whole of what it checks - its URLs, request
 * headers and bodies, the queries it runs and the criteria that judge them -
 * and no relation reads them (Monitor.monitorSteps). An incident's or an
 * alert's page that needs them reads the monitor's id and kind through the
 * incident or alert, which every reader of it reads, and then, only when it
 * uses them, the steps from the monitor itself: the Root Cause card, to chart
 * a monitor's metrics for an event that kept no snapshot of them; an Affected
 * Resource's commands, to name the reading a Metrics monitor reads.
 *
 * Read so, the server weighs the monitor's own read - its read permissions,
 * a team's block, a grant limited to some monitors' labels - and answers the
 * monitors the reader may read. A reader who may read no monitor's steps
 * (an Incident Viewer, a custom role that reads alerts) is not sent the read
 * at all, and the page shows what it shows without them. Best effort, as the
 * event's rule line reads its monitor (useEventMetricRule): a read that fails
 * leaves the page without what the steps would have added, never with an
 * error.
 */

// What a page reads of a monitor through the incident or alert that names it.
export const MONITOR_THROUGH_RELATION_SELECT: {
  _id: true;
  monitorType: true;
} = {
  _id: true,
  monitorType: true,
};

// A monitor's steps as its own read answers them.
export interface MonitorStepsOfMonitor {
  _id: string;
  monitorType?: MonitorType | undefined;
  monitorSteps?: MonitorSteps | undefined;
}

type ReadIdFunction = (value: unknown) => string | undefined;

// A monitor's id as a page holds it - an ObjectID or its string - or none.
export const readMonitorId: ReadIdFunction = (
  value: unknown,
): string | undefined => {
  if (value instanceof ObjectID || typeof value === "string") {
    return value.toString().trim() || undefined;
  }

  return undefined;
};

/*
 * Whether the reader may read a monitor's steps, as far as their
 * permissions say: without them in hand yet, the server decides.
 */
export function mayReadMonitorSteps(): boolean {
  return (
    !PermissionGate.hasPermissionSnapshot() ||
    PermissionGate.canReadColumn(new Monitor(), "monitorSteps")
  );
}

/*
 * The steps of the monitors named, each read on the monitor by the
 * reader's own read: the monitors the reader may read, in no order; none
 * for a reader who may read no monitor's steps, or a read that fails.
 */
export async function readMonitorSteps(
  monitorIds: ReadonlyArray<string>,
): Promise<Array<MonitorStepsOfMonitor>> {
  const ids: Array<string> = Array.from(
    new Set(
      monitorIds
        .map((monitorId: string): string | undefined => {
          return readMonitorId(monitorId);
        })
        .filter((monitorId: string | undefined): monitorId is string => {
          return Boolean(monitorId);
        }),
    ),
  );

  if (ids.length === 0 || !mayReadMonitorSteps()) {
    return [];
  }

  try {
    const monitors: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        _id: new Includes(ids),
      },
      select: {
        _id: true,
        monitorType: true,
        monitorSteps: true,
      },
      limit: ids.length,
      skip: 0,
      sort: {},
    });

    return (monitors.data || [])
      .map((monitor: Monitor): MonitorStepsOfMonitor | null => {
        const monitorId: string | undefined = readMonitorId(monitor?._id);

        return monitorId
          ? {
              _id: monitorId,
              monitorType: monitor.monitorType,
              monitorSteps: monitor.monitorSteps,
            }
          : null;
      })
      .filter(
        (
          monitor: MonitorStepsOfMonitor | null,
        ): monitor is MonitorStepsOfMonitor => {
          return monitor !== null;
        },
      );
  } catch {
    return [];
  }
}

/*
 * The metrics a Metrics monitor's steps read, read on the monitor by the
 * reader's own read: what an Affected Resource's commands pick a managed
 * device's reading by (SeriesDebugHints.getDebugCommands). Undefined for
 * any other kind of monitor, whose commands name no metric, and for a reader
 * who may not read the monitor, who is offered every command of the device
 * instead - as for a monitor whose steps name no reading.
 */
export async function readMetricNamesOfMonitor(
  monitor:
    | {
        _id?: string | undefined;
        monitorType?: MonitorType | undefined;
      }
    | null
    | undefined,
): Promise<Array<string> | undefined> {
  const monitorId: string | undefined = readMonitorId(monitor?._id);

  if (!monitorId || monitor?.monitorType !== MonitorType.Metrics) {
    return undefined;
  }

  const read: MonitorStepsOfMonitor | undefined = (
    await readMonitorSteps([monitorId])
  )[0];

  return read
    ? SeriesDebugHints.getMetricNamesOfMonitorSteps(read.monitorSteps)
    : undefined;
}
