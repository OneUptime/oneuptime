import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  BULK_ACTION_CONCURRENCY,
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import BulkReadAhead from "Common/UI/Components/BulkUpdate/BulkReadAhead";
import { BulkActionOnClickProps } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * ADD PROBE AND REMOVE PROBE, IN THE MONITORS LIST'S BULK ACTIONS.
 *
 * Each selected monitor is changed through the shared runner (progress,
 * Stop, a summary by monitor), several at once: the probes a monitor runs on
 * are its own, and adding one to a monitor or taking one off it reads or
 * writes nothing another monitor's change does.
 *
 * Whether the probe is on a monitor already is read a window of monitors at
 * a time - one list request for fifty (BulkReadAhead), not one per monitor -
 * and a window whose request fails reads its monitors one by one.
 *
 * A monitor the change would not change is left as it is and listed with
 * why, as "not changed" rather than as a failure: one that no probe runs
 * (an incoming request, a manual monitor), one the probe is on already
 * (Add), one it is not on (Remove). The others get exactly what one
 * monitor's Add or Remove gives them: a MonitorProbe row, enabled, or that
 * row deleted.
 */

export type BulkMonitorProbeChangeMode = "add" | "remove";

// Why a monitor was left as it was, in the summary's "not changed" list.
export const PROBES_NOT_SUPPORTED_REASON: string = translationKey(
  "This monitor type does not support probes",
);

export const PROBE_ALREADY_ASSIGNED_REASON: string = translationKey(
  "Probe is already assigned to this monitor",
);

export const PROBE_NOT_ASSIGNED_REASON: string = translationKey(
  "Probe is not assigned to this monitor",
);

// Whether a probe runs this kind of monitor: only those have probes to change.
export function canMonitorHaveProbes(monitor: Monitor): boolean {
  return Boolean(
    monitor.monitorType &&
      MonitorTypeHelper.isProbableMonitor(monitor.monitorType as MonitorType),
  );
}

/*
 * Which of these monitors the probe is on, by monitor id: each one's
 * MonitorProbe row. One list request for all of them.
 */
export async function readProbeAssignments(data: {
  monitors: Array<Monitor>;
  probeId: ObjectID;
  projectId: ObjectID;
}): Promise<Map<string, MonitorProbe>> {
  const monitorIds: Array<ObjectID> = [];

  for (const monitor of data.monitors) {
    if (monitor.id) {
      monitorIds.push(monitor.id);
    }
  }

  const assignments: Map<string, MonitorProbe> = new Map<
    string,
    MonitorProbe
  >();

  if (monitorIds.length === 0) {
    return assignments;
  }

  const result: ListResult<MonitorProbe> = await ModelAPI.getList<MonitorProbe>(
    {
      modelType: MonitorProbe,
      query: {
        monitorId: new Includes(monitorIds),
        probeId: data.probeId,
        projectId: data.projectId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        monitorId: true,
      },
      sort: {},
    },
  );

  for (const row of result.data) {
    const monitorId: string = row.monitorId?.toString().toLowerCase() || "";

    if (monitorId) {
      assignments.set(monitorId, row);
    }
  }

  return assignments;
}

export interface BulkMonitorProbeChangeOptions {
  actionProps: BulkActionOnClickProps<Monitor>;
  probeId: ObjectID;
  projectId: ObjectID;
  mode: BulkMonitorProbeChangeMode;
  // The reader's words for a reason a monitor was left as it was.
  translate: (text: string) => string;
}

export async function runBulkMonitorProbeChange(
  options: BulkMonitorProbeChangeOptions,
): Promise<void> {
  const reader: BulkReadAhead<Monitor, MonitorProbe> = new BulkReadAhead<
    Monitor,
    MonitorProbe
  >({
    // Only the monitors a probe can run: the others are not read about.
    items: options.actionProps.items.filter(canMonitorHaveProbes),
    getKey: (monitor: Monitor): string => {
      return monitor.id?.toString() || "";
    },
    readWindow: (
      monitors: Array<Monitor>,
    ): Promise<Map<string, MonitorProbe>> => {
      return readProbeAssignments({
        monitors: monitors,
        probeId: options.probeId,
        projectId: options.projectId,
      });
    },
    readOne: async (monitor: Monitor): Promise<MonitorProbe | null> => {
      const assignments: Map<string, MonitorProbe> = await readProbeAssignments(
        {
          monitors: [monitor],
          probeId: options.probeId,
          projectId: options.projectId,
        },
      );

      return (
        assignments.get(monitor.id?.toString().toLowerCase() || "") || null
      );
    },
  });

  await runBulkAction<Monitor>({
    actionProps: options.actionProps,
    concurrency: BULK_ACTION_CONCURRENCY,
    step: async (monitor: Monitor): Promise<BulkItemOutcome> => {
      if (!monitor.id) {
        throw new BadDataException("Monitor ID not found");
      }

      if (!canMonitorHaveProbes(monitor)) {
        return bulkItemUnchanged(
          options.translate(PROBES_NOT_SUPPORTED_REASON),
        );
      }

      const assignment: MonitorProbe | null = await reader.read(monitor);

      if (options.mode === "add") {
        if (assignment) {
          return bulkItemUnchanged(
            options.translate(PROBE_ALREADY_ASSIGNED_REASON),
          );
        }

        const monitorProbe: MonitorProbe = new MonitorProbe();
        monitorProbe.monitorId = monitor.id;
        monitorProbe.probeId = options.probeId;
        monitorProbe.projectId = options.projectId;
        monitorProbe.isEnabled = true;

        await ModelAPI.create<MonitorProbe>({
          model: monitorProbe,
          modelType: MonitorProbe,
        });

        return BULK_ITEM_CHANGED;
      }

      if (!assignment || !assignment.id) {
        return bulkItemUnchanged(options.translate(PROBE_NOT_ASSIGNED_REASON));
      }

      await ModelAPI.deleteItem<MonitorProbe>({
        modelType: MonitorProbe,
        id: assignment.id,
      });

      return BULK_ITEM_CHANGED;
    },
  });
}
