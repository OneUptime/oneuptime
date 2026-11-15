import RunCron from "../../Utils/Cron";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Project from "Common/Models/DatabaseModels/Project";
import MonitorNetworkDeviceService, {
  RowOfGoneDevice,
} from "Common/Server/Services/MonitorNetworkDeviceService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProjectService from "Common/Server/Services/ProjectService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import NetworkDeviceStalePoll, {
  MIN_STALE_AFTER_IN_MINUTES,
} from "Common/Server/Utils/Monitor/NetworkDeviceStalePoll";
import NetworkDeviceStalePollReports, {
  StalePollReport,
} from "Common/Server/Utils/Monitor/NetworkDeviceStalePollReports";
import NetworkDeviceWalkUtil from "Common/Server/Utils/Monitor/NetworkDeviceWalkUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import MonitorPauseState from "Common/Utils/Monitor/MonitorPauseState";

/*
 * A Network Device monitor is evaluated on each poll of its device and on
 * each trap, and on nothing else: when the polls stopped, it kept the status
 * of its last poll and "Device unreachable" never fired. Every five minutes
 * this finds the devices that have gone three polling intervals (at least
 * ten minutes) without a poll, and evaluates each monitor watching one as a
 * poll that found the device unreachable, saying why none came
 * (NetworkDeviceStalePoll) - once per stale spell
 * (NetworkDeviceStalePollReports). The next real poll evaluates it again.
 *
 * It reads from the devices, not the monitors. It used to read every enabled
 * Network Device monitor with its steps, look up each step's device one
 * query at a time, and evaluate every monitor of every stale device on
 * every run: a probe outage re-evaluated thousands of devices' monitors
 * every five minutes until it ended. Now:
 *
 *   1. The devices whose last poll is older than the shortest stale window,
 *      in pages by id (no index on lastPolledAt: a poll moves it, and the
 *      device table's indexes are kept clear of what polls move so polls
 *      stay HOT updates - #7921). One pass over the device table per run.
 *   2. Of those, the ones stale by their own polling interval, in active
 *      projects: one read of the page's projects.
 *   3. Their monitors, through MonitorNetworkDevice: one lookup per project
 *      on the page (NetworkDeviceWalkUtil.findMonitorsWatchingDevices).
 *   4. One read of the page's reports, and an evaluation only for each
 *      monitor not yet evaluated for the spell its device is in.
 *
 * And the monitors whose steps name a device that no longer exists, through
 * MonitorNetworkDevice too (its rows outlive the device), the same way.
 */

export const JOB_NAME: string = "NetworkDeviceMonitor:CheckStalePolls";

// Devices read per page.
export const STALE_DEVICE_PAGE_SIZE: number = 1000;

// Monitors evaluated at once.
export const STALE_POLL_EVALUATION_CONCURRENCY: number = 10;

// The columns of a device the stale check reads (StalePollDevice).
const STALE_DEVICE_SELECT: {
  _id: true;
  projectId: true;
  lastPolledAt: true;
  pollingIntervalInMinutes: true;
  isPollingEnabled: true;
  probeId: true;
  hostname: true;
  monitoringMethod: true;
  createdAt: true;
} = {
  _id: true,
  projectId: true,
  lastPolledAt: true,
  pollingIntervalInMinutes: true,
  isPollingEnabled: true,
  probeId: true,
  hostname: true,
  monitoringMethod: true,
  createdAt: true,
};

// A device the run looks at, by id: its project, and the device (null: gone).
interface WatchedDevice {
  projectId: ObjectID;
  device: NetworkDevice | null;
}

// One monitor's steps for one device, and why no poll came.
interface StaleEvaluation {
  monitor: Monitor;
  deviceId: string;
  // Null: the device no longer exists.
  device: NetworkDevice | null;
  steps: Array<MonitorStep>;
  staleReason: string;
  report: StalePollReport;
}

export interface StalePollSweepResult {
  devicesRead: number;
  staleDevices: number;
  evaluated: number;
  alreadyReported: number;
  failed: number;
  // The run's deadline passed (RunCron) before it read every page.
  stoppedAtDeadline: boolean;
}

/*
 * The run. It stops at the next page once its deadline passes - its time
 * limit, or its lock lost (RunCron, CronLock) - and the next run starts over;
 * what was reported stays reported.
 */
export const checkStalePolls: (data: {
  now: Date;
  deadline: JobDeadline;
}) => Promise<StalePollSweepResult> = async (data: {
  now: Date;
  deadline: JobDeadline;
}): Promise<StalePollSweepResult> => {
  const result: StalePollSweepResult = {
    devicesRead: 0,
    staleDevices: 0,
    evaluated: 0,
    alreadyReported: 0,
    failed: 0,
    stoppedAtDeadline: false,
  };

  const activeProjects: ActiveProjects = new ActiveProjects();

  // Polled devices whose polls stopped.
  const pollsStoppedBefore: Date = OneUptimeDate.addRemoveMinutes(
    data.now,
    -MIN_STALE_AFTER_IN_MINUTES,
  );
  let cursor: ObjectID | undefined = undefined;

  for (;;) {
    if (data.deadline.hasPassed()) {
      result.stoppedAtDeadline = true;
      return result;
    }

    const page: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        isPollingEnabled: true,
        lastPolledAt: QueryHelper.lessThanOrNull(pollsStoppedBefore),
        ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
      },
      select: STALE_DEVICE_SELECT,
      sort: {
        _id: SortOrder.Ascending,
      },
      skip: 0,
      limit: STALE_DEVICE_PAGE_SIZE,
      props: {
        isRoot: true,
      },
    });

    if (page.length === 0) {
      break;
    }

    const lastId: ObjectID | null = page[page.length - 1]!.id;

    if (!lastId || (cursor && lastId.toString() <= cursor.toString())) {
      throw new Error(
        `${JOB_NAME}: a page of devices did not move past the last device of the page before.`,
      );
    }

    cursor = lastId;
    result.devicesRead += page.length;

    // Stale by its own polling interval, however its monitors were made.
    const stale: Array<NetworkDevice> = page.filter(
      (device: NetworkDevice): boolean => {
        return Boolean(
          device.id &&
            device.projectId &&
            NetworkDeviceStalePoll.getStaleReason({
              device: device,
              now: data.now,
            }),
        );
      },
    );

    const inActiveProjects: Array<NetworkDevice> = await activeProjects.keep(
      stale,
      (device: NetworkDevice): ObjectID => {
        return device.projectId!;
      },
    );

    result.staleDevices += inActiveProjects.length;

    const devices: Map<string, WatchedDevice> = new Map();

    for (const device of inActiveProjects) {
      devices.set(device.id!.toString(), {
        projectId: device.projectId!,
        device: device,
      });
    }

    await evaluateOncePerSpell({
      evaluations: await findStaleEvaluations({
        devices: devices,
        now: data.now,
      }),
      result: result,
    });

    if (page.length < STALE_DEVICE_PAGE_SIZE) {
      break;
    }
  }

  // Monitors that watch a device that no longer exists.
  let goneCursor: ObjectID | undefined = undefined;

  for (;;) {
    if (data.deadline.hasPassed()) {
      result.stoppedAtDeadline = true;
      return result;
    }

    const rows: Array<RowOfGoneDevice> =
      await MonitorNetworkDeviceService.findRowsOfGoneDevices({
        afterId: goneCursor,
        limit: STALE_DEVICE_PAGE_SIZE,
      });

    if (rows.length === 0) {
      break;
    }

    goneCursor = rows[rows.length - 1]!.id;

    const inActiveProjects: Array<RowOfGoneDevice> = await activeProjects.keep(
      rows,
      (row: RowOfGoneDevice): ObjectID => {
        return row.projectId;
      },
    );

    const devices: Map<string, WatchedDevice> = new Map();

    for (const row of inActiveProjects) {
      devices.set(row.networkDeviceId.toString(), {
        projectId: row.projectId,
        device: null,
      });
    }

    await evaluateOncePerSpell({
      evaluations: await findStaleEvaluations({
        devices: devices,
        now: data.now,
      }),
      result: result,
    });

    if (rows.length < STALE_DEVICE_PAGE_SIZE) {
      break;
    }
  }

  return result;
};

/*
 * The evaluations the devices call for: for each enabled monitor watching
 * one, its steps that name the device and can say it is unreachable, while
 * the device is stale for that monitor (a device never polled is stale only
 * once the newer of it and the monitor has existed long enough).
 */
async function findStaleEvaluations(data: {
  devices: Map<string, WatchedDevice>;
  now: Date;
}): Promise<Array<StaleEvaluation>> {
  const deviceIdsByProject: Map<string, Array<string>> = new Map();

  for (const [deviceId, watched] of data.devices) {
    const projectId: string = watched.projectId.toString();

    deviceIdsByProject.set(projectId, [
      ...(deviceIdsByProject.get(projectId) || []),
      deviceId,
    ]);
  }

  const evaluations: Array<StaleEvaluation> = [];

  for (const [projectId, deviceIds] of deviceIdsByProject) {
    const wanted: Set<string> = new Set(deviceIds);

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: new ObjectID(projectId),
        deviceIds: deviceIds,
        select: {
          createdAt: true,
        },
      });

    for (const monitor of monitors) {
      if (!monitor.id || !monitor.projectId) {
        continue;
      }

      if (MonitorPauseState.isPaused(monitor)) {
        continue;
      }

      const stepsByDevice: Map<string, Array<MonitorStep>> = new Map();

      for (const step of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        const deviceId: string | undefined =
          step.data?.networkDeviceMonitor?.networkDeviceId;

        if (
          !deviceId ||
          !wanted.has(deviceId) ||
          !NetworkDeviceStalePoll.canSayUnreachable(step)
        ) {
          continue;
        }

        stepsByDevice.set(deviceId, [
          ...(stepsByDevice.get(deviceId) || []),
          step,
        ]);
      }

      for (const [deviceId, steps] of stepsByDevice) {
        const device: NetworkDevice | null =
          data.devices.get(deviceId)?.device || null;

        const staleReason: string | undefined =
          NetworkDeviceStalePoll.getStaleReason({
            device: device,
            monitorCreatedAt: monitor.createdAt,
            now: data.now,
          });

        if (!staleReason) {
          continue;
        }

        evaluations.push({
          monitor: monitor,
          deviceId: deviceId,
          device: device,
          steps: steps,
          staleReason: staleReason,
          report: {
            monitorId: monitor.id,
            deviceId: deviceId,
            spell: NetworkDeviceStalePollReports.spellOf(device),
          },
        });
      }
    }
  }

  return evaluations;
}

/*
 * Evaluates each monitor not yet evaluated for the spell its device is in,
 * a few at a time, and records the ones that went through. One that failed
 * is not recorded: the next run tries it again.
 */
async function evaluateOncePerSpell(data: {
  evaluations: Array<StaleEvaluation>;
  result: StalePollSweepResult;
}): Promise<void> {
  if (data.evaluations.length === 0) {
    return;
  }

  const reported: Set<string> = await NetworkDeviceStalePollReports.getReported(
    data.evaluations.map((evaluation: StaleEvaluation): StalePollReport => {
      return evaluation.report;
    }),
  );

  const due: Array<StaleEvaluation> = data.evaluations.filter(
    (evaluation: StaleEvaluation): boolean => {
      return !reported.has(
        NetworkDeviceStalePollReports.getKey(
          evaluation.report.monitorId,
          evaluation.report.deviceId,
        ),
      );
    },
  );

  data.result.alreadyReported += data.evaluations.length - due.length;

  const done: Array<StalePollReport> = [];
  let next: number = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(STALE_POLL_EVALUATION_CONCURRENCY, due.length) },
      async (): Promise<void> => {
        while (next < due.length) {
          const evaluation: StaleEvaluation = due[next++]!;

          if (await evaluate(evaluation)) {
            done.push(evaluation.report);
            data.result.evaluated++;
          } else {
            data.result.failed++;
          }
        }
      },
    ),
  );

  try {
    await NetworkDeviceStalePollReports.markReported(done);
  } catch (err) {
    // Not recorded: the next run evaluates them again, as before.
    logger.error(
      `${JOB_NAME}: could not record ${done.length} stale poll report(s); they will be evaluated again on the next run.`,
    );
    logger.error(err);
  }
}

// Evaluates one monitor's steps for one device. True when every step went through.
async function evaluate(evaluation: StaleEvaluation): Promise<boolean> {
  const now: Date = OneUptimeDate.getCurrentDate();
  let allEvaluated: boolean = true;

  for (const step of evaluation.steps) {
    /*
     * A poll that found the device unreachable, and says why: no walk and
     * no ping ran, so walk-based criteria see "not evaluated". Network
     * Device monitors are not probe monitors (no MonitorProbe row is read
     * or written), so the device's probe is named only when it has one.
     */
    const response: ProbeMonitorResponse = {
      projectId: evaluation.monitor.projectId!,
      monitorId: evaluation.monitor.id!,
      monitorStepId: step.id,
      ...(evaluation.device?.probeId
        ? { probeId: evaluation.device.probeId }
        : {}),
      isOnline: false,
      failureCause: evaluation.staleReason,
      monitoredAt: now,
      ingestedAt: now,
    } as ProbeMonitorResponse;

    try {
      await MonitorResourceUtil.monitorResource(response);
    } catch (err) {
      allEvaluated = false;
      logger.error(
        `${JOB_NAME}: could not check monitor ${evaluation.monitor.id!.toString()} for device ${evaluation.deviceId}:`,
      );
      logger.error(err);
    }
  }

  return allEvaluated;
}

/*
 * Which projects are active (ProjectService.getActiveProjectStatusQuery),
 * read once per run, a page's new projects at a time.
 */
class ActiveProjects {
  private known: Map<string, boolean> = new Map();

  public async keep<T>(
    items: Array<T>,
    projectIdOf: (item: T) => ObjectID,
  ): Promise<Array<T>> {
    const unknown: Array<string> = Array.from(
      new Set(
        items.map((item: T): string => {
          return projectIdOf(item).toString();
        }),
      ),
    ).filter((projectId: string): boolean => {
      return !this.known.has(projectId);
    });

    if (unknown.length > 0) {
      const active: Array<Project> = await ProjectService.findBy({
        query: {
          ...ProjectService.getActiveProjectStatusQuery(),
          _id: QueryHelper.any(unknown),
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: unknown.length,
        props: {
          isRoot: true,
        },
      });

      const activeIds: Set<string> = new Set(
        active.map((project: Project): string => {
          return project.id!.toString();
        }),
      );

      for (const projectId of unknown) {
        this.known.set(projectId, activeIds.has(projectId));
      }
    }

    return items.filter((item: T): boolean => {
      return this.known.get(projectIdOf(item).toString()) === true;
    });
  }
}

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const result: StalePollSweepResult = await checkStalePolls({
        now: OneUptimeDate.getCurrentDate(),
        deadline: deadline,
      });

      logger.debug(
        `${JOB_NAME}: read ${result.devicesRead} device(s) whose polls may have stopped, ${result.staleDevices} stale; evaluated ${result.evaluated} monitor(s), ${result.alreadyReported} already evaluated for their spell, ${result.failed} failed${result.stoppedAtDeadline ? ", stopped at the job's deadline" : ""}.`,
      );
    } catch (err) {
      logger.error(`Error in ${JOB_NAME}`);
      logger.error(err);
    }
  },
);
