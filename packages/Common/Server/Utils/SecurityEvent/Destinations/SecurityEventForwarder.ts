import SecurityEventDestination from "../../../../Models/DatabaseModels/SecurityEventDestination";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityEventDestinationDefinition,
  getSecurityEventDestinationDefinition,
} from "../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationScope from "../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { SETUP_TEST_PRODUCT_NAME } from "../../../../Types/SecurityEvent/SecuritySetupTest";
import {
  SecurityEventRecord,
  readSecurityEventRecord,
} from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import SecurityEventDestinationService from "../../../Services/SecurityEventDestinationService";
import SecurityEventService from "../../../Services/SecurityEventService";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import SecurityProjectWork, {
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
} from "../SecurityProjectWork";
import SecurityEventDestinationRegistry from "./SecurityEventDestinationRegistry";
import {
  SecurityEventDestinationSettings,
  SecurityEventSendResult,
  SecurityEventSender,
} from "./Types";

/*
 * Sends each enabled Security Event Destination what arrived since its
 * cursor: every minute, a window at a time, oldest first.
 *
 *   - Events are read by when they ARRIVED (createdAt), so an event that
 *     happened a while before it reached OneUptime - an imported alert, a
 *     log scanned a minute later - is still sent, once. A window waits
 *     FORWARD_SETTLE_IN_SECONDS so the events of its last seconds have
 *     landed, and is read in a fixed order, so the same window reads the
 *     same way again.
 *   - Only the destination's project is read, only what it asked for (its
 *     detections, or every event), and never what was imported from the
 *     same product: Google SecOps is not sent its own alerts back. The
 *     setup test's simulated events are never sent anywhere.
 *   - A window is done when everything in it was sent or refused one by
 *     one. When the SIEM stops answering, the cursor stays at the window,
 *     with how many of its events were already delivered, and the next run
 *     goes on from there - nothing is sent twice, nothing skipped. A run
 *     sends at most FORWARD_MAX_EVENTS_PER_RUN events, for as long as its
 *     turn has time; one that stops part way through a window keeps its
 *     place the same way.
 *   - A destination that fell further behind than a day (it was off, or
 *     its SIEM was down) skips ahead to the last day rather than flood the
 *     SIEM with a backlog; the result says so.
 */

export const FORWARD_SETTLE_IN_SECONDS: number = 30;
export const FORWARD_WINDOW_IN_SECONDS: number = 5 * 60;
export const FORWARD_MAX_WINDOWS_PER_RUN: number = 12;
/*
 * The most events one run sends. A run that reaches it part way through a
 * window stops there, and the next goes on from the event after.
 */
export const FORWARD_MAX_EVENTS_PER_RUN: number = 50000;
export const FORWARD_PAGE_SIZE: number = 1000;
export const FORWARD_MAX_BACKLOG_IN_HOURS: number = 24;
// Events that happened this long before they arrived are not sent.
export const FORWARD_LATE_EVENT_WINDOW_IN_HOURS: number = 24;

export interface SecurityEventForwardResult {
  sent: number;
  rejected: number;
  rejectionReason: string;
  windows: number;
  skippedBacklog: boolean;
  failure: string;
  // The window the send stopped in, and how many of its events were delivered.
  partialWindowStart: string;
  partialWindowProcessed: number;
  sentFrom: string;
  sentTo: string;
}

/*
 * The work is spread by project (SecurityProjectWork): the cron queues one
 * turn for each project with an enabled destination.
 */
export const SECURITY_EVENT_FORWARD_PROJECT_WORK: SecurityProjectWorkDefinition =
  {
    jobName: "SecurityEvents:ForwardProject",
    key: "security-event-forward",
    maxConcurrentProjects: 8,
  };

function readCursor(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readNumber(value: JSONValue | undefined): number {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

export default class SecurityEventForwarder {
  /*
   * The cron's half: every enabled destination in the instance, page by
   * page, and one turn queued for each project that has one. Returns how
   * many projects were queued.
   */
  @CaptureSpan()
  public static async enqueueProjectsWithEnabledDestinations(): Promise<number> {
    const destinations: Array<SecurityEventDestination> =
      await SecurityEventDestinationService.findAllBy({
        query: { isEnabled: true },
        select: {
          _id: true,
          projectId: true,
        },
        sort: { _id: SortOrder.Ascending },
        props: { isRoot: true },
      });

    return SecurityProjectWork.enqueueProjects(
      SECURITY_EVENT_FORWARD_PROJECT_WORK,
      destinations.map(
        (destination: SecurityEventDestination): ObjectID | undefined => {
          return destination.projectId;
        },
      ),
    );
  }

  // One project's turn: a send to each of its enabled destinations.
  @CaptureSpan()
  public static async forwardProject(
    projectId: ObjectID,
    lease: SecurityProjectWorkLease = UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
  ): Promise<void> {
    const destinations: Array<SecurityEventDestination> =
      await SecurityEventDestinationService.findAllBy({
        query: { projectId, isEnabled: true },
        select: {
          _id: true,
          projectId: true,
          provider: true,
          sendScope: true,
          cursor: true,
          lastSendResult: true,
        },
        sort: { _id: SortOrder.Ascending },
        props: { isRoot: true },
      });

    for (const destination of destinations) {
      if (!lease.hasTimeLeft()) {
        return;
      }

      await this.forwardWithLock(destination, lease);

      if (!(await lease.keep())) {
        return;
      }
    }
  }

  // One send per destination at a time, across every worker.
  private static async forwardWithLock(
    destination: SecurityEventDestination,
    lease: SecurityProjectWorkLease,
  ): Promise<void> {
    if (!destination.id || !destination.projectId) {
      return;
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        namespace: "SecurityEventForward",
        key: destination.id.toString(),
        lockTimeout: 10 * 60 * 1000,
        acquireAttemptsLimit: 1,
      });
    } catch {
      // A send to this destination is already under way.
      return;
    }

    try {
      await this.forwardDestination(destination, { lease });
    } catch (error) {
      logger.error(
        `SecurityEventForwarder: destination ${destination.id.toString()} failed:`,
      );
      logger.error(error);

      const destinationId: ObjectID = destination.id;

      await ConnectorErrorMessage.recordFailure({
        label: `SecurityEventForwarder: destination ${destinationId.toString()}`,
        write: async (): Promise<void> => {
          await SecurityEventDestinationService.updateOneById({
            id: destinationId,
            data: {
              lastAttemptAt: OneUptimeDate.getCurrentDate(),
              lastError: ConnectorErrorMessage.toMessage(error),
            },
            props: { isRoot: true },
          });
        },
      });
    } finally {
      if (mutex) {
        await Semaphore.release(mutex).catch((): void => {
          // The lock runs out on its own.
        });
      }
    }
  }

  @CaptureSpan()
  public static async forwardDestination(
    destination: SecurityEventDestination,
    options: {
      sender?: SecurityEventSender | undefined;
      lease?: SecurityProjectWorkLease | undefined;
    } = {},
  ): Promise<SecurityEventForwardResult> {
    const lease: SecurityProjectWorkLease =
      options.lease || UNLIMITED_SECURITY_PROJECT_WORK_LEASE;
    const projectId: ObjectID = destination.projectId!;
    const definition: SecurityEventDestinationDefinition | undefined =
      getSecurityEventDestinationDefinition(destination.provider);

    if (!definition) {
      throw new Error(
        `Unknown destination provider "${String(destination.provider)}".`,
      );
    }

    const settings: SecurityEventDestinationSettings =
      await SecurityEventDestinationService.getSettings(destination);
    const sender: SecurityEventSender =
      options.sender ||
      SecurityEventDestinationRegistry.getSender(definition.provider);

    const now: Date = OneUptimeDate.getCurrentDate();
    const until: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -FORWARD_SETTLE_IN_SECONDS,
    );
    const oldestAllowed: Date = OneUptimeDate.addRemoveHours(
      now,
      -FORWARD_MAX_BACKLOG_IN_HOURS,
    );

    let cursor: Date = readCursor(destination.cursor) || until;
    let skippedBacklog: boolean = false;

    /*
     * A send that stopped part way through a window goes on from the event
     * after the last one it delivered.
     */
    const previous: JSONObject = destination.lastSendResult || {};
    let skipInWindow: number =
      previous["partialWindowStart"] === cursor.toISOString()
        ? readNumber(previous["partialWindowProcessed"])
        : 0;

    if (OneUptimeDate.isBefore(cursor, oldestAllowed)) {
      cursor = oldestAllowed;
      skippedBacklog = true;
      skipInWindow = 0;
    }

    const result: SecurityEventForwardResult = {
      sent: 0,
      rejected: 0,
      rejectionReason: "",
      windows: 0,
      skippedBacklog,
      failure: "",
      partialWindowStart: "",
      partialWindowProcessed: 0,
      sentFrom: cursor.toISOString(),
      sentTo: cursor.toISOString(),
    };

    const findingsOnly: boolean =
      destination.sendScope !== SecurityEventDestinationScope.AllEvents;

    // Events read this run, against FORWARD_MAX_EVENTS_PER_RUN.
    let readThisRun: number = 0;

    while (
      OneUptimeDate.isBefore(cursor, until) &&
      result.windows < FORWARD_MAX_WINDOWS_PER_RUN
    ) {
      const nextEnd: Date = OneUptimeDate.addRemoveSeconds(
        cursor,
        FORWARD_WINDOW_IN_SECONDS,
      );
      const windowEnd: Date = OneUptimeDate.isBefore(nextEnd, until)
        ? nextEnd
        : until;

      let offset: number = skipInWindow;
      let processedInWindow: number = skipInWindow;
      let stopped: boolean = false;

      for (;;) {
        if (readThisRun >= FORWARD_MAX_EVENTS_PER_RUN || !lease.hasTimeLeft()) {
          // Out of this run's budget: the next goes on from this event.
          result.partialWindowStart = cursor.toISOString();
          result.partialWindowProcessed = processedInWindow;
          stopped = true;
          break;
        }

        const rows: Array<JSONObject> =
          await SecurityEventService.findArrivedEvents({
            projectId,
            arrivedAfter: cursor,
            arrivedUntil: windowEnd,
            happenedAfter: OneUptimeDate.addRemoveHours(
              cursor,
              -FORWARD_LATE_EVENT_WINDOW_IN_HOURS,
            ),
            findingsOnly,
            excludeProductNames: [
              ...definition.importedProductNames,
              SETUP_TEST_PRODUCT_NAME,
            ],
            limit: FORWARD_PAGE_SIZE,
            offset,
          });

        if (rows.length === 0) {
          break;
        }

        readThisRun += rows.length;

        const records: Array<SecurityEventRecord> = rows.map(
          (row: JSONObject): SecurityEventRecord => {
            return readSecurityEventRecord(row);
          },
        );

        const sendResult: SecurityEventSendResult = await sender.send({
          settings,
          events: records,
        });

        result.sent += sendResult.sent;
        result.rejected += sendResult.rejected;
        result.rejectionReason =
          result.rejectionReason || sendResult.rejectionReason;
        processedInWindow += sendResult.processed;

        if (sendResult.failure) {
          result.failure = sendResult.failure;
          result.partialWindowStart = cursor.toISOString();
          result.partialWindowProcessed = processedInWindow;
          stopped = true;
          break;
        }

        offset += rows.length;

        if (rows.length < FORWARD_PAGE_SIZE) {
          break;
        }

        if (!(await lease.keep())) {
          // Another send may have the project now: stop at this event.
          result.partialWindowStart = cursor.toISOString();
          result.partialWindowProcessed = processedInWindow;
          stopped = true;
          break;
        }
      }

      if (stopped) {
        break;
      }

      cursor = windowEnd;
      skipInWindow = 0;
      result.windows += 1;
      result.sentTo = cursor.toISOString();
    }

    await SecurityEventDestinationService.updateOneById({
      id: destination.id!,
      data: {
        cursor: cursor.toISOString(),
        lastAttemptAt: now,
        lastSendResult: { ...result } as never,
        lastError: (result.failure || null) as unknown as string,
        ...(result.sent > 0 ? { lastSentAt: now } : {}),
      },
      props: { isRoot: true },
    });

    return result;
  }
}
