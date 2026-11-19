import {
  PROBE_INGEST_URL,
  PROBE_MONITOR_CHECK_TIMEOUT_IN_MS,
  PROBE_MONITOR_FETCH_LIMIT,
  PROBE_MONITORING_WORKERS,
} from "../../Config";
import MonitorUtil from "../../Utils/Monitors/Monitor";
import MonitorCheckSlots from "../../Utils/Monitors/MonitorCheckSlots";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import ServerBusy from "../../Utils/ServerBusy";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import APIException from "Common/Types/Exception/ApiException";
import { JSONArray } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import NumberUtil from "Common/Utils/Number";
import Sleep from "Common/Types/Sleep";

/*
 * HOW THIS PROBE GETS ITS MONITORS CHECKED (OneUptime issue #9488).
 *
 * Every minute, each of PROBE_MONITORING_WORKERS workers asks the server
 * for up to PROBE_MONITOR_FETCH_LIMIT of the monitors that are due, and
 * starts checking them. While the server hands it a full batch, more may be
 * due, so the worker asks again as soon as there is room; once a batch comes
 * back short, everything that was due has been handed out, and the worker
 * waits for the next minute.
 *
 * It used to ask once a minute and wait for the whole batch to finish, so a
 * probe checked at most PROBE_MONITORING_WORKERS x PROBE_MONITOR_FETCH_LIMIT
 * monitors a minute - 50 with Docker Compose's defaults - however many were
 * due. 100 one-minute Website monitors were checked about every two minutes,
 * with nothing to say so.
 *
 * What keeps it bounded:
 *
 *   - Checks at once: never more than MONITOR_CHECKS_AT_ONCE, the
 *     PROBE_MONITORING_WORKERS batches of PROBE_MONITOR_FETCH_LIMIT the
 *     probe always ran at its busiest (MonitorCheckSlots). A worker reserves
 *     room before it asks, and each check gives its slot back when it
 *     settles, so one slow check holds one slot, not its whole batch.
 *   - What it asks for: never more monitors than it has room for, and never
 *     more than PROBE_MONITOR_FETCH_LIMIT at a time: the server's work per
 *     request is what it always was.
 *   - When the server is busy (429) it asks again only once the answer's
 *     Retry-After has passed (ServerBusy); after any other failed fetch, at
 *     the next minute. Nothing is lost either way: the server claimed
 *     nothing, and the monitors stay due.
 *
 * The server claims what it hands out atomically and moves each claimed
 * monitor to its next check time in the same statement
 * (MonitorProbeService.claimMonitorProbesForProbing), so asking again never
 * hands a monitor out twice for one interval, from this worker, another
 * worker, another replica of the probe, or this probe after a restart.
 */

// The most monitor checks this probe runs at once.
export const MONITOR_CHECKS_AT_ONCE: number =
  PROBE_MONITORING_WORKERS * PROBE_MONITOR_FETCH_LIMIT;

/*
 * A worker that has room for this much of a batch asks for monitors,
 * rather than wait for room for the whole batch: half a batch, at least one.
 */
export const MONITOR_ROOM_TO_ASK: number = Math.max(
  1,
  Math.ceil(PROBE_MONITOR_FETCH_LIMIT / 2),
);

/*
 * A worker that waits this long for room while monitors are due says so
 * (at warn, at most every MONITOR_WAIT_WARNING_EVERY_MS): the probe is
 * running every check it may, and the monitors waiting are checked late.
 */
export const MONITOR_WAIT_WARNING_AFTER_MS: number = 60 * 1000;
export const MONITOR_WAIT_WARNING_EVERY_MS: number = 10 * 60 * 1000;

// The longest a worker waits before its first fetch of a minute.
export const MONITOR_FETCH_STAGGER_MAX_MS: number = 45 * 1000;

const monitorCheckSlots: MonitorCheckSlots = new MonitorCheckSlots(
  MONITOR_CHECKS_AT_ONCE,
);

// The checks running now: what a test waits for.
const checksInProgress: Set<Promise<void>> = new Set<Promise<void>>();

let lastWaitWarningAt: number | null = null;

/*
 * Single-flight guard, scoped to each WORKER SLOT.
 *
 * node-cron fires this job every minute and never waits for the previous
 * tick. A worker still fetching - handed full batches, or waiting for room
 * while every check slot is busy - skips the tick, so the workers never
 * stack: there are at most PROBE_MONITORING_WORKERS of them. Per slot rather
 * than one flag for the whole job: one busy slot must not silence the free
 * ones.
 *
 * It covers the fetching, not the checks: a worker's checks run on in their
 * slots (MonitorCheckSlots bounds them), and the worker asks again at the
 * next minute while they do.
 */
const workerRunsInProgress: Set<number> = new Set<number>();

// Exported for tests: lets each case start with an idle probe.
export function resetProbeWorkerRunState(): void {
  workerRunsInProgress.clear();
  monitorCheckSlots.reset();
  checksInProgress.clear();
  lastWaitWarningAt = null;
}

// Exported for tests: the probe's check slots.
export function getMonitorCheckSlots(): MonitorCheckSlots {
  return monitorCheckSlots;
}

// Exported for tests: how many workers the cron has fetching now.
export function getWorkersFetching(): number {
  return workerRunsInProgress.size;
}

// Exported for tests: resolves once every check started so far has settled.
export async function whenMonitorChecksSettle(): Promise<void> {
  while (checksInProgress.size > 0) {
    await Promise.allSettled(Array.from(checksInProgress));
  }
}

/*
 * Exported for tests: bounds ONE monitor's full check in time.
 *
 * Promise.race subscribes to both promises, so a check that settles late is
 * still observed and can never surface as an unhandled rejection. It does
 * not — cannot — cancel the check: nothing here can reach into an arbitrary
 * monitor implementation and unwind it. The point is that the PROBE stops
 * waiting: the check's slot is released, and the wedged monitor loses
 * exactly one cycle instead of holding that slot forever.
 */
export async function probeMonitorWithDeadline(
  monitor: Monitor,
  deadlineInMs: number = PROBE_MONITOR_CHECK_TIMEOUT_IN_MS,
): Promise<void> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  const deadline: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (err: Error) => void) => {
      deadlineTimer = setTimeout(() => {
        /*
         * Logged here, at the moment the deadline is crossed, rather than
         * left to the caller: this is the one line that turns a silently
         * skipped cycle into something an operator can grep for.
         */
        logger.error(
          `Monitor ${monitor.id?.toString()} (${monitor.monitorType}) did not finish probing within ${deadlineInMs}ms. Abandoning this check — the monitor implementation is not settling. Raise PROBE_MONITOR_CHECK_TIMEOUT_IN_MS if this monitor legitimately needs longer.`,
        );

        reject(
          new Error(
            `Probing monitor ${monitor.id?.toString()} (${monitor.monitorType}) exceeded the ${deadlineInMs}ms deadline`,
          ),
        );
      }, deadlineInMs);
    },
  );

  try {
    return await Promise.race([MonitorUtil.probeMonitor(monitor), deadline]);
  } finally {
    /*
     * Always clear it: an un-cleared timer holds the event loop open after
     * an otherwise healthy check.
     */
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }
  }
}

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:MonitorFetchList",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        let workers: number = 0;

        while (workers < PROBE_MONITORING_WORKERS) {
          workers++;

          const currentWorker: number = workers;

          if (workerRunsInProgress.has(currentWorker)) {
            logger.debug(
              `Worker ${currentWorker} is still fetching from a previous tick. Skipping this tick for it.`,
            );
            continue;
          }

          workerRunsInProgress.add(currentWorker);

          logger.debug(`Starting worker ${currentWorker}`);

          try {
            new FetchListAndProbe("Worker " + currentWorker)
              .run()
              .catch((err: unknown) => {
                logger.error(`Worker ${currentWorker} failed: `);
                logger.error(err);
              })
              .finally(() => {
                // Free the slot for the next tick — failures included.
                workerRunsInProgress.delete(currentWorker);
              });
          } catch (err) {
            /*
             * Nothing above is expected to throw synchronously, but a slot
             * marked busy for a worker that never actually started would be
             * lost for the lifetime of the process — exactly the leak this
             * guard exists to prevent.
             */
            workerRunsInProgress.delete(currentWorker);
            logger.error(`Worker ${currentWorker} failed to start: `);
            logger.error(err);
          }
        }
      } catch (err) {
        logger.error("Starting workers failed");
        logger.error(err);
      }
    },
  });
};

// Exported for tests: one worker's fetching for one tick.
export class FetchListAndProbe {
  private workerName: string = "";

  public constructor(workerName: string) {
    this.workerName = workerName;
  }

  /*
   * Fetches and starts checking monitors until the server has none due for
   * this probe, then resolves. The checks it started run on in their slots.
   */
  public async run(): Promise<void> {
    logger.debug(`Running worker ${this.workerName}`);

    try {
      await this.fetchListAndProbe();

      logger.debug(`Worker ${this.workerName} has nothing more to fetch`);
    } catch (err) {
      logger.error(`Error in worker ${this.workerName}`);
      logger.error(err);
    }
  }

  private async fetchListAndProbe(): Promise<void> {
    /*
     * Workers start at random moments in the minute, so the probes of a
     * server, and the workers of a probe, do not all ask at once.
     */
    const sleepTime: number = NumberUtil.getRandomNumber(
      0,
      MONITOR_FETCH_STAGGER_MAX_MS,
    );
    logger.debug(
      `Sleeping for ${sleepTime} ms, just to give probe API's some time to load balance between different workers`,
    );
    await Sleep.sleep(sleepTime);

    let isMoreDue: boolean = false;

    for (;;) {
      // The server asked this probe to wait (ServerBusy): it asks later.
      if (ServerBusy.isBackingOff("monitors")) {
        return;
      }

      const room: number = await this.reserveRoom({ isMoreDue });

      if (room <= 0) {
        return;
      }

      let monitors: Array<Monitor> | null = null;

      try {
        monitors = await this.fetchMonitors(room);
      } finally {
        if (!monitors) {
          monitorCheckSlots.release(room);
        }
      }

      if (!monitors) {
        return;
      }

      this.startChecks(monitors, room);

      /*
       * A short batch: the server handed out every monitor that was due for
       * this probe, so nothing waits for this worker until the next minute.
       */
      if (monitors.length < room) {
        return;
      }

      isMoreDue = true;

      logger.debug(
        `${this.workerName} was handed a full batch of ${monitors.length} monitors; more may be due, so it asks again.`,
      );
    }
  }

  /*
   * Room for the next fetch. When the last batch was full, monitors are
   * waiting for it: a wait of MONITOR_WAIT_WARNING_AFTER_MS or more means
   * the probe is checking all it may at once and they are checked late.
   */
  private async reserveRoom(data: { isMoreDue: boolean }): Promise<number> {
    const startedAt: number = Date.now();

    const room: number = await monitorCheckSlots.reserve(
      PROBE_MONITOR_FETCH_LIMIT,
      MONITOR_ROOM_TO_ASK,
    );

    const waitedInMs: number = Date.now() - startedAt;

    if (data.isMoreDue && waitedInMs >= MONITOR_WAIT_WARNING_AFTER_MS) {
      FetchListAndProbe.warnAboutWaiting(waitedInMs);
    }

    return room;
  }

  private static warnAboutWaiting(waitedInMs: number): void {
    const now: number = Date.now();

    if (
      lastWaitWarningAt !== null &&
      now - lastWaitWarningAt < MONITOR_WAIT_WARNING_EVERY_MS
    ) {
      return;
    }

    lastWaitWarningAt = now;

    logger.warn(
      `This probe is running all ${MONITOR_CHECKS_AT_ONCE} monitor checks it may run at once, and more monitors are due: they waited ${Math.round(waitedInMs / 1000)} s for room, so they are checked later than their interval. Raise PROBE_MONITORING_WORKERS (now ${PROBE_MONITORING_WORKERS}) or PROBE_MONITOR_FETCH_LIMIT (now ${PROBE_MONITOR_FETCH_LIMIT}) to check more at once, give the probe more CPU, or run another probe.`,
    );
  }

  /*
   * Up to `limit` of this probe's due monitors, claimed for it by the
   * server; null when there are none to be had now - the server was busy,
   * or the fetch failed - and the worker stops until its next tick.
   */
  private async fetchMonitors(limit: number): Promise<Array<Monitor> | null> {
    try {
      logger.debug("Fetching monitor list");

      const monitorListUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/monitor/list");

      const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
        await API.fetch<JSONArray>({
          method: HTTPMethod.POST,
          url: monitorListUrl,
          data: {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            limit: limit,
          },
          headers: {},
          options: ProbeAPIRequest.getDefaultRequestOptions(monitorListUrl),
        });

      /*
       * Not the list itself: the monitors in it hold their secrets' values,
       * filled in by the server, which the logger's redaction (by field
       * name) cannot all tell apart.
       */
      logger.debug("Fetched monitor list");

      /*
       * The server is too busy to hand out monitors now: nothing was
       * claimed, they stay due, and this probe asks again once the wait it
       * was given has passed.
       */
      if (ServerBusy.isBusyAnswer(result)) {
        ServerBusy.note("monitors", result);
        return null;
      }

      if (result instanceof HTTPErrorResponse) {
        logger.error(
          `Fetching the monitor list failed: the server answered ${result.statusCode}. This probe asks again at its next tick.`,
        );
        logger.error(result.data);
        return null;
      }

      return BaseModel.fromJSONArray(
        Array.isArray(result.data) ? (result.data as JSONArray) : [],
        Monitor,
      );
    } catch (err) {
      logger.error("Error in fetching monitor list");
      logger.error(err);

      if (err instanceof APIException) {
        logger.error("API Exception Error");
        logger.error(JSON.stringify((err as APIException).error, null, 2));
      }

      return null;
    }
  }

  /*
   * Starts every monitor the server handed out, each in a slot of its own.
   * `room` slots were reserved for them: the ones not needed go back, and
   * any monitor past them - a server that handed out more than it was asked
   * for - takes a slot anyway, since the server claimed it.
   */
  private startChecks(monitors: Array<Monitor>, room: number): void {
    if (monitors.length > room) {
      monitorCheckSlots.take(monitors.length - room);
    } else {
      monitorCheckSlots.release(room - monitors.length);
    }

    for (const monitor of monitors) {
      /*
       * Every check carries its own deadline (probeMonitorWithDeadline).
       * Without one, a single monitor implementation that never settles
       * holds its slot forever.
       */
      const check: Promise<void> = this.probeAndLogMonitor(monitor)
        .catch((err: unknown) => {
          logger.error(err);
        })
        .finally(() => {
          monitorCheckSlots.release(1);
          checksInProgress.delete(check);
        });

      checksInProgress.add(check);
    }
  }

  /*
   * Each check consumes its result or error at once and resolves void, so a
   * slow check never holds on to another check's response.
   */
  private async probeAndLogMonitor(monitor: Monitor): Promise<void> {
    try {
      await probeMonitorWithDeadline(monitor);
      logger.debug(`Probed monitor ${monitor.id?.toString()}`);
    } catch (err) {
      logger.error("Error in probing monitor:");
      logger.error(err);
    } finally {
      logger.debug("Monitor:");
      logger.debug(monitor);
    }
  }
}

export default InitJob;
