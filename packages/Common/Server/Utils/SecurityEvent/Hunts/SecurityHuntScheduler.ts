import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import SecurityHunt from "../../../../Models/DatabaseModels/SecurityHunt";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "../../../../Types/BaseDatabase/Query";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import QueryTimeoutException from "../../../../Types/Exception/QueryTimeoutException";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import PartialEntity from "../../../../Types/Database/PartialEntity";
import {
  SECURITY_HUNT_RUN_ERRORS,
  SecurityHuntRunWindow,
  getNextSecurityHuntRunAt,
  getSecurityHuntRetryAt,
  getSecurityHuntRunWindow,
  isScheduledSecurityHunt,
  readSecurityHuntFilters,
} from "../../../../Types/SecurityEvent/SecurityHunt";
import { buildSecurityHuntQuery } from "../../../../Utils/SecurityEvent/SecurityHuntSearch";
import AccessTokenService from "../../../Services/AccessTokenService";
import AnalyticsDatabaseService from "../../../Services/AnalyticsDatabaseService";
import SecurityEventService from "../../../Services/SecurityEventService";
import SecurityHuntService from "../../../Services/SecurityHuntService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import logger from "../../Logger";
import CallerPermission from "../../Permission/CallerPermission";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import SecurityProjectWork, {
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
} from "../SecurityProjectWork";
import SecurityHuntNotifications from "./SecurityHuntNotifications";

/*
 * SCHEDULED HUNTS (Types/SecurityEvent/SecurityHunt).
 *
 * Every minute the cron queues one turn for each project with a hunt due
 * (nextRunAt has come), spread as every security pipeline is
 * (SecurityProjectWork: a lease per project, a pool of permits). A turn runs
 * the project's due hunts, the longest overdue first.
 *
 * One run of a hunt:
 *
 *   1. reads the window since the run before stopped (searchedUpToAt), to
 *      two minutes ago (getSecurityHuntRunWindow);
 *   2. counts the events its search finds there, through the same read the
 *      Events page lists them with (SecurityEventService.countBy, the
 *      query compiled by SecurityHuntSearch), as the person who set its
 *      schedule - their permissions, read when the run is made, so a run
 *      never sees more than its author could - with the explorers' time
 *      limit, and an exact count: a read the limit stopped is an error, never
 *      "found nothing";
 *   3. records what it found on the hunt in one compare-and-set on the
 *      schedule it was read with, so a hunt changed while it ran keeps the
 *      change (its new schedule starts from the change) and a second worker
 *      never records the same window twice;
 *   4. when it found events, queues the notification
 *      (SecurityHuntNotifications), only once its record holds.
 *
 * A run that cannot be made records why (lastRunError) and is tried again
 * within the hour; its window stays where it was, so the next run reads
 * what this one could not.
 */

export const SECURITY_HUNTS_PROJECT_WORK: SecurityProjectWorkDefinition = {
  jobName: "SecurityHunts:RunProject",
  key: "security-hunts",
  maxConcurrentProjects: 8,
};

// What a run reads of a hunt.
const HUNT_RUN_SELECT: Select<SecurityHunt> = {
  _id: true,
  projectId: true,
  name: true,
  schedule: true,
  searchQuery: true,
  filters: true,
  scheduledByUserId: true,
  searchedUpToAt: true,
  nextRunAt: true,
};

export interface SecurityHuntRunOutcome {
  // The window the run read; null when there was nothing new to read.
  window: SecurityHuntRunWindow | null;
  // How many events the search found; null when the run could not be made.
  eventCount: number | null;
  error: string | null;
  // Whether the run's record held: false when the hunt changed while it ran.
  isRecorded: boolean;
  isNotificationQueued: boolean;
}

// A run that cannot be made, with the words its hunt shows.
export class SecurityHuntRunError extends Error {}

export default class SecurityHuntScheduler {
  /*
   * The cron's half: every hunt due in the instance, and one turn queued
   * for each project with one. Returns how many projects were queued.
   */
  @CaptureSpan()
  public static async enqueueProjectsWithDueHunts(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    const hunts: Array<SecurityHunt> = await SecurityHuntService.findAllBy({
      query: {
        nextRunAt: QueryHelper.lessThanEqualTo(now),
      },
      select: {
        _id: true,
        projectId: true,
      },
      sort: {
        nextRunAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    return SecurityProjectWork.enqueueProjects(
      SECURITY_HUNTS_PROJECT_WORK,
      hunts.map((hunt: SecurityHunt): ObjectID | undefined => {
        return hunt.projectId;
      }),
      now,
    );
  }

  /*
   * One project's turn: its due hunts, the longest overdue first, for as
   * long as the turn has time and keeps its lease. A hunt left over is
   * still due next minute.
   */
  @CaptureSpan()
  public static async runDueHuntsForProject(
    projectId: ObjectID,
    lease: SecurityProjectWorkLease = UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
  ): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const hunts: Array<SecurityHunt> = await SecurityHuntService.findAllBy({
      query: {
        projectId,
        nextRunAt: QueryHelper.lessThanEqualTo(now),
      },
      select: HUNT_RUN_SELECT,
      sort: {
        nextRunAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    for (const hunt of hunts) {
      if (!lease.hasTimeLeft()) {
        return;
      }

      await this.runHunt(hunt);

      if (!(await lease.keep())) {
        return;
      }
    }
  }

  /*
   * The read access a run uses: the person who set the schedule, as they
   * are in the project now. Somebody who has left the project, or no longer
   * holds a role that reads security events, runs nothing.
   */
  public static async getRunProps(
    hunt: SecurityHunt,
  ): Promise<DatabaseCommonInteractionProps> {
    if (!hunt.scheduledByUserId || !hunt.projectId) {
      throw new SecurityHuntRunError(
        SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
      );
    }

    const props: DatabaseCommonInteractionProps =
      await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
        {
          userId: hunt.scheduledByUserId,
          projectId: hunt.projectId,
        },
      );

    if (
      !CallerPermission.isProjectMember(props, hunt.projectId) ||
      !CallerPermission.holdsAnyOf(
        props,
        new SecurityEvent().getReadPermissions(),
        { projectId: hunt.projectId },
      )
    ) {
      throw new SecurityHuntRunError(
        SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
      );
    }

    return props;
  }

  // How many events a hunt's search finds in a window, read as `props`.
  public static async countEvents(data: {
    hunt: SecurityHunt;
    window: SecurityHuntRunWindow;
    props: DatabaseCommonInteractionProps;
  }): Promise<number> {
    const query: Query<SecurityEvent> = buildSecurityHuntQuery({
      projectId: data.hunt.projectId!,
      searchQuery: data.hunt.searchQuery,
      filters: readSecurityHuntFilters(data.hunt.filters),
      startTime: data.window.startTime,
      endTime: data.window.endTime,
    });

    const count: PositiveNumber = await SecurityEventService.countBy({
      query,
      props: data.props,
      // A read the time limit stopped is an error, never "found nothing".
      exact: true,
    });

    return count.toNumber();
  }

  // Why a run could not be made, in the words its hunt shows.
  public static describeRunError(error: unknown): string {
    if (error instanceof SecurityHuntRunError) {
      return error.message;
    }

    if (
      error instanceof QueryTimeoutException ||
      AnalyticsDatabaseService.isQueryTimeoutError(error)
    ) {
      return SECURITY_HUNT_RUN_ERRORS.timedOut.message;
    }

    return SECURITY_HUNT_RUN_ERRORS.searchFailed.message;
  }

  /*
   * One run of one hunt (see the top of this file). Never throws: what went
   * wrong is recorded on the hunt.
   */
  @CaptureSpan()
  public static async runHunt(
    hunt: SecurityHunt,
    options: { now?: Date | undefined } = {},
  ): Promise<SecurityHuntRunOutcome> {
    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const outcome: SecurityHuntRunOutcome = {
      window: null,
      eventCount: null,
      error: null,
      isRecorded: false,
      isNotificationQueued: false,
    };

    if (!hunt.id || !hunt.projectId) {
      return outcome;
    }

    // A hunt taken off its schedule since it was found due runs no more.
    if (!isScheduledSecurityHunt(hunt.schedule)) {
      outcome.isRecorded = await this.record(hunt, {
        nextRunAt: null,
      });
      return outcome;
    }

    const window: SecurityHuntRunWindow | null = getSecurityHuntRunWindow({
      schedule: hunt.schedule,
      searchedUpTo: hunt.searchedUpToAt,
      now,
    });

    const nextRunAt: Date | null = getNextSecurityHuntRunAt({
      schedule: hunt.schedule,
      dueAt: hunt.nextRunAt,
      now,
    });

    // Nothing new to read yet: it is due again next interval.
    if (!window) {
      outcome.isRecorded = await this.record(hunt, { nextRunAt });
      return outcome;
    }

    outcome.window = window;

    let eventCount: number;

    try {
      const props: DatabaseCommonInteractionProps =
        await this.getRunProps(hunt);

      eventCount = await this.countEvents({ hunt, window, props });
    } catch (error) {
      if (!(error instanceof SecurityHuntRunError)) {
        logger.error(
          `SecurityHuntScheduler: hunt ${hunt.id.toString()} could not run:`,
        );
        logger.error(error);
      }

      outcome.error = this.describeRunError(error);

      // Its window stays where it was: the next run reads what this one could not.
      outcome.isRecorded = await this.record(hunt, {
        lastRunAt: now,
        lastRunError: outcome.error,
        nextRunAt: getSecurityHuntRetryAt({ schedule: hunt.schedule, now }),
      });

      return outcome;
    }

    outcome.eventCount = eventCount;

    outcome.isRecorded = await this.record(hunt, {
      lastRunAt: now,
      lastRunEventCount: eventCount,
      lastRunError: null,
      searchedUpToAt: window.endTime,
      nextRunAt,
      ...(eventCount > 0
        ? {
            lastFoundAt: window.endTime,
            lastFoundSinceAt: window.startTime,
            lastFoundEventCount: eventCount,
          }
        : {}),
    });

    if (outcome.isRecorded && eventCount > 0) {
      outcome.isNotificationQueued = await SecurityHuntNotifications.huntFound({
        projectId: hunt.projectId,
        securityHuntId: hunt.id,
        eventCount,
        window,
      });
    }

    return outcome;
  }

  /*
   * What a run found, written only if the hunt still has the schedule it
   * was read with (its next run and its window's start): a hunt someone
   * changed while it ran keeps the change. Never throws.
   */
  private static async record(
    hunt: SecurityHunt,
    write: {
      lastRunAt?: Date | undefined;
      lastRunEventCount?: number | undefined;
      lastRunError?: string | null | undefined;
      searchedUpToAt?: Date | undefined;
      nextRunAt?: Date | null | undefined;
      lastFoundAt?: Date | undefined;
      lastFoundSinceAt?: Date | undefined;
      lastFoundEventCount?: number | undefined;
    },
  ): Promise<boolean> {
    try {
      return await SecurityHuntService.compareAndSetColumnsByIdWithoutHooks({
        id: hunt.id!,
        data: write as unknown as PartialEntity<SecurityHunt>,
        expectedData: {
          nextRunAt: (hunt.nextRunAt || null) as unknown as Date,
          searchedUpToAt: (hunt.searchedUpToAt || null) as unknown as Date,
        },
        skipUpdateDateColumn: true,
      });
    } catch (error) {
      logger.error(
        `SecurityHuntScheduler: could not record a run of hunt ${hunt.id?.toString() || ""}:`,
      );
      logger.error(error);
      return false;
    }
  }
}
