import DatabaseConfig from "../../DatabaseConfig";
import { IsBillingEnabled, getAllEnvVars } from "../../EnvironmentConfig";
import OnCallCalendarFeedCache, {
  CachedCalendarBody,
  OnCallCalendarFeedCacheScope,
} from "../../Infrastructure/OnCallCalendarFeedCache";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import ProjectService from "../../Services/ProjectService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import Response from "../Response";
import AppMetrics from "../Telemetry/AppMetrics";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallCalendarFeedUrls from "./OnCallCalendarFeedUrls";
import OnCallShiftMaterializer, {
  MaterializeResult,
  MaterializedScheduleInfo,
} from "./OnCallShiftMaterializer";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import { ICalendarEvent } from "../../../Types/Calendar/ICalendar";
import OneUptimeDate from "../../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import CalendarFeedWindow, {
  BODY_CACHE_TTL_SECONDS,
  FEED_SIMULATION_ITERATION_CAP,
  FeedWindow,
  MAX_EVENTS,
  MAX_GAP_EVENTS,
  SCHEDULE_CACHE_TTL_SECONDS,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import MaterializedShiftUtil, {
  MaterializedShift,
  MaterializedShiftJson,
} from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import OnCallCalendarFeedUtil, {
  CoverageEnvelopeResult,
  CoverageGapEventsResult,
  FeedRenderResult,
  OnCallCalendarFeedKind,
  WindowShrinkResult,
} from "../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import { TimeSegment } from "../../../Types/OnCallDutyPolicy/ShiftSeamUtil";
import { createHash } from "crypto";

/*
 * Turns one feed row plus its request into a calendar body.
 *
 * Everything between "the token resolved to this row" and "send these bytes"
 * lives here so the three public routes (personal, schedule, project) and
 * the session-authenticated /my-shifts route share one pipeline:
 *
 *   authorisation (re-derived on EVERY fetch; a valid token is not
 *   authorisation) -> body cache -> render slot -> schedule-level cache ->
 *   materialize -> shrink to MAX_EVENTS -> coverage gaps -> serialize ->
 *   body + last-good cache -> metrics.
 *
 * Three outcomes come out of it, matching the one response rule the routes
 * apply: a rendered body (200), an empty calendar that says why (200, so
 * subscribed clients clear their copy instead of dropping the calendar), or
 * "unavailable" (503 + Retry-After) when nothing at all can be served.
 *
 * Stale-while-error: when a render throws, hits the per-process render cap
 * or trips a schedule's iteration cap, the most recent body that rendered
 * successfully for the same key is served instead, flagged `stale` so the
 * route adds `Warning: 110` and the bookkeeping records lastRenderTruncated.
 * Only when there is nothing to fall back to does the outcome turn into a
 * 503.
 *
 * Nothing here ever sees the plaintext token. The body-cache key carries the
 * token HASH (so a rotation is a new key) and the log lines carry the feed
 * kind and row id.
 */

export enum FeedRenderStatus {
  Rendered = "rendered",
  Empty = "empty",
  Unavailable = "unavailable",
}

export interface FeedRenderOutcome {
  status: FeedRenderStatus;
  kind: OnCallCalendarFeedKind;
  body: string;
  etag: string;
  lastModified: Date;
  /* Served from the last-good tier after a failed or capped render. */
  stale: boolean;
  /* Window shrunk, iteration cap hit, or gap list capped -- anything cut. */
  truncated: boolean;
  eventCount: number;
  /* The body came from the body cache (no render happened). */
  cacheHit: boolean;
  /* Why the calendar is empty (status Empty); goes into X-WR-CALDESC. */
  reason: string | null;
  /* For status Unavailable: what to put in Retry-After. */
  retryAfterSeconds: number | null;
}

interface BaseFeedRenderRequest {
  feedId: ObjectID;
  projectId: ObjectID;
  /* The stored lookup hash, used in cache keys. NEVER the token. */
  tokenHash: string;
  pastDays: number;
  futureDays: number;
  now?: Date | undefined;
}

export interface PersonalFeedRenderRequest extends BaseFeedRenderRequest {
  kind: OnCallCalendarFeedKind.Personal;
  userId: ObjectID;
  includeCoveringShifts: boolean;
  /* The `?schedule=` filter, already validated as a UUID. */
  scheduleFilterId?: ObjectID | undefined;
}

export interface ScheduleFeedRenderRequest extends BaseFeedRenderRequest {
  kind: OnCallCalendarFeedKind.Schedule;
  scheduleId: ObjectID;
  includeCoverageGaps: boolean;
  minimumGapMinutes: number;
}

export interface ProjectFeedRenderRequest extends BaseFeedRenderRequest {
  kind: OnCallCalendarFeedKind.Project;
  includeCoverageGaps: boolean;
  minimumGapMinutes: number;
}

export type FeedRenderRequest =
  | PersonalFeedRenderRequest
  | ScheduleFeedRenderRequest
  | ProjectFeedRenderRequest;

/* One schedule's cached, JSON-safe materialization over one window. */
export interface CachedScheduleSegments {
  scheduleId: string;
  scheduleName: string;
  scheduleTimezone: string | null;
  projectId: string;
  projectName: string | null;
  shiftConfigVersion: number;
  lastModifiedAt: string;
  /* The engine hit its iteration cap: shifts may be missing. */
  truncated: boolean;
  /* Every user's shifts on the schedule, policy variants included. */
  shifts: Array<MaterializedShiftJson>;
  /* Where the layers INTENDED coverage (for gap events), ISO strings. */
  envelope: Array<{ start: string; end: string }>;
  envelopeTruncated: boolean;
}

export interface UserShiftsResult {
  shifts: Array<MaterializedShift>;
  truncated: boolean;
  generatedAt: Date;
}

export interface EmptyOutcomeOptions {
  kind: OnCallCalendarFeedKind;
  reason: string;
  scheduleName?: string | undefined;
  projectName?: string | undefined;
  filterScheduleName?: string | undefined;
  timezone?: string | undefined;
  now?: Date | undefined;
}

/* The schedule facts every render needs, read once per request. */
interface ScheduleInfo {
  id: ObjectID;
  name: string;
  timezone?: string | undefined;
  projectId: ObjectID;
  shiftConfigVersion: number;
}

/* What resolveContext hands the pipeline, or the reason it cannot. */
type RenderContext =
  | {
      empty: false;
      schedules: Array<ScheduleInfo>;
      viewerTimezone?: string | undefined;
      calendarTimezone?: string | undefined;
      scheduleName?: string | undefined;
      projectName?: string | undefined;
      filterScheduleName?: string | undefined;
    }
  | {
      empty: true;
      reason: string;
      scheduleName?: string | undefined;
      projectName?: string | undefined;
      filterScheduleName?: string | undefined;
      timezone?: string | undefined;
    };

export const RENDER_CAP_RETRY_AFTER_SECONDS: number = 60;

/*
 * The X-WR-CALDESC sentences for every "200 but empty" case. Exported so the
 * routes, the tests and (through the docs) the users see the same words.
 */
export const FEED_DISABLED_REASON: string =
  "This calendar feed is turned off in OneUptime. Turn it back on from the Calendar Feed settings to see shifts here again.";

export const TOKEN_ROTATED_REASON: string =
  "This calendar link was regenerated in OneUptime. Subscribe to the new link from the Calendar Feed settings; this one will stop working soon.";

export const PLAN_REASON: string =
  "Calendar feeds need the Growth plan or higher. Upgrade the project's plan in OneUptime to see shifts here.";

export const USER_MISSING_REASON: string =
  "The user this calendar link belongs to no longer exists.";

export const NO_SCHEDULES_REASON: string =
  "You are not on any on-call schedule in this project right now. Shifts appear here once you are added to a schedule.";

export const FILTERED_SCHEDULE_REASON: string =
  "You are not on the on-call schedule this calendar link is filtered to.";

export const SCHEDULE_MISSING_REASON: string =
  "The on-call schedule this calendar link belongs to no longer exists.";

export const PROJECT_MISSING_REASON: string =
  "The project this calendar link belongs to no longer exists.";

export const NO_PROJECT_SCHEDULES_REASON: string =
  "This project has no on-call schedules yet. Shifts appear here once a schedule is created.";

export default class OnCallCalendarFeedRenderer {
  // -- Outcomes ----------------------------------------------------------

  /*
   * The empty VCALENDAR outcome for one of the "200 but nothing to show"
   * cases. Cheap enough not to cache: it is a header and a sentence.
   */
  public static buildEmptyOutcome(
    options: EmptyOutcomeOptions,
  ): FeedRenderOutcome {
    const now: Date = options.now || OneUptimeDate.getCurrentDate();

    const body: string = OnCallCalendarFeedUtil.renderEmpty({
      kind: options.kind,
      reason: options.reason,
      scheduleName: options.scheduleName,
      projectName: options.projectName,
      filterScheduleName: options.filterScheduleName,
      timezone: options.timezone,
    });

    return {
      status: FeedRenderStatus.Empty,
      kind: options.kind,
      body,
      etag: Response.getCalendarETag(body),
      lastModified: now,
      stale: false,
      truncated: false,
      eventCount: 0,
      cacheHit: false,
      reason: options.reason,
      retryAfterSeconds: null,
    };
  }

  public static buildUnavailableOutcome(
    kind: OnCallCalendarFeedKind,
    retryAfterSeconds: number,
  ): FeedRenderOutcome {
    return {
      status: FeedRenderStatus.Unavailable,
      kind,
      body: "",
      etag: "",
      lastModified: OneUptimeDate.getCurrentDate(),
      stale: false,
      truncated: false,
      eventCount: 0,
      cacheHit: false,
      reason: null,
      retryAfterSeconds,
    };
  }

  private static outcomeFromCachedBody(data: {
    kind: OnCallCalendarFeedKind;
    cached: CachedCalendarBody;
    stale: boolean;
    cacheHit: boolean;
    truncated: boolean;
  }): FeedRenderOutcome {
    return {
      status: FeedRenderStatus.Rendered,
      kind: data.kind,
      body: data.cached.body,
      etag: data.cached.etag,
      lastModified: data.cached.lastModified,
      stale: data.stale,
      truncated: data.truncated,
      eventCount: OnCallCalendarFeedRenderer.countEvents(data.cached.body),
      cacheHit: data.cacheHit,
      reason: null,
      retryAfterSeconds: null,
    };
  }

  // -- Plan --------------------------------------------------------------

  /*
   * Decision 3: below-plan projects render an EMPTY calendar, never a 404.
   * The check is imperative because the public routes read as root, so the
   * models' @TableBillingAccessControl never runs for them. A project whose
   * plan cannot be read (deleted mid-request, or no plan yet) is treated as
   * below plan: failing closed here costs one empty calendar, failing open
   * would hand out rosters for free.
   */
  @CaptureSpan()
  public static async isProjectOnPlan(
    projectId: ObjectID,
    options?: { billingEnabled?: boolean | undefined } | undefined,
  ): Promise<boolean> {
    const billingEnabled: boolean =
      options?.billingEnabled === undefined
        ? IsBillingEnabled
        : options.billingEnabled;

    if (!billingEnabled) {
      return true;
    }

    try {
      const current: { plan: PlanType | null; isSubscriptionUnpaid: boolean } =
        await ProjectService.getCurrentPlan(projectId);

      if (!current.plan) {
        return false;
      }

      return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        PlanType.Growth,
        current.plan,
        getAllEnvVars(),
      );
    } catch (err) {
      logger.warn(
        `OnCallCalendarFeedRenderer: could not read the plan of project ${projectId.toString()}; treating it as below plan.`,
      );
      logger.warn(err);
      return false;
    }
  }

  // -- Render ------------------------------------------------------------

  @CaptureSpan()
  public static async render(
    request: FeedRenderRequest,
  ): Promise<FeedRenderOutcome> {
    const now: Date = request.now || OneUptimeDate.getCurrentDate();

    const pastDays: number = CalendarFeedWindow.clampPastDays(request.pastDays);
    const futureDays: number = CalendarFeedWindow.clampFutureDays(
      request.futureDays,
    );

    const window: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now,
      pastDays,
      futureDays,
    });

    const context: RenderContext =
      await OnCallCalendarFeedRenderer.resolveContext(request, window);

    if (context.empty) {
      return OnCallCalendarFeedRenderer.buildEmptyOutcome({
        kind: request.kind,
        reason: context.reason,
        scheduleName: context.scheduleName,
        projectName: context.projectName,
        filterScheduleName: context.filterScheduleName,
        timezone: context.timezone,
        now,
      });
    }

    const scheduleIds: Array<string> = context.schedules.map(
      (schedule: ScheduleInfo) => {
        return schedule.id.toString();
      },
    );

    const bodyKey: string = OnCallCalendarFeedRenderer.buildBodyCacheKey({
      request,
      pastDays,
      futureDays,
      schedules: context.schedules,
      now,
    });

    const scope: OnCallCalendarFeedCacheScope = {
      projectId: request.projectId.toString(),
      userId:
        request.kind === OnCallCalendarFeedKind.Personal
          ? request.userId.toString()
          : undefined,
      scheduleIds,
    };

    const cachedBody: CachedCalendarBody | null =
      await OnCallCalendarFeedCache.getBody({ key: bodyKey, scope });

    if (cachedBody) {
      return OnCallCalendarFeedRenderer.outcomeFromCachedBody({
        kind: request.kind,
        cached: cachedBody,
        stale: false,
        cacheHit: true,
        truncated: false,
      });
    }

    if (!OnCallCalendarFeedCache.tryAcquireRenderSlot()) {
      return await OnCallCalendarFeedRenderer.fallBackToLastGood({
        kind: request.kind,
        bodyKey,
        why: "render cap reached",
      });
    }

    const startedAt: number = Date.now();

    try {
      const segments: Array<CachedScheduleSegments> = await Promise.all(
        context.schedules.map((schedule: ScheduleInfo) => {
          return OnCallCalendarFeedRenderer.loadScheduleSegments({
            schedule,
            windowStart: window.feedStart,
            windowEnd: window.feedEnd,
            now,
          });
        }),
      );

      const iterationTruncated: Array<CachedScheduleSegments> = segments.filter(
        (segment: CachedScheduleSegments) => {
          return segment.truncated;
        },
      );

      /*
       * A capped expansion is missing shifts. A complete body from an
       * earlier render is better than a partial one now; only when there is
       * none does the partial render go out, with a note saying so.
       */
      if (iterationTruncated.length > 0) {
        const lastGood: CachedCalendarBody | null =
          await OnCallCalendarFeedCache.getLastGood(bodyKey);

        if (lastGood) {
          logger.warn(
            `OnCallCalendarFeedRenderer: ${request.kind} feed ${request.feedId.toString()} hit the iteration cap; serving the last good body.`,
          );

          return OnCallCalendarFeedRenderer.outcomeFromCachedBody({
            kind: request.kind,
            cached: lastGood,
            stale: true,
            cacheHit: false,
            truncated: true,
          });
        }
      }

      let shifts: Array<MaterializedShift> =
        OnCallCalendarFeedRenderer.collectShifts(segments, now);

      if (request.kind === OnCallCalendarFeedKind.Personal) {
        shifts = OnCallShiftMaterializer.filterShiftsForUser(
          shifts,
          request.userId,
        );
      }

      const shrink: WindowShrinkResult =
        OnCallCalendarFeedUtil.shrinkWindowToFit({
          shifts,
          feedStart: window.feedStart,
          feedEnd: window.feedEnd,
        });

      const notes: Array<string> = [];

      if (shrink.truncated) {
        notes.push(
          `Shortened to ${Math.max(
            0,
            futureDays - shrink.daysDropped,
          )} days ahead because the feed would exceed ${MAX_EVENTS} events.`,
        );
      }

      if (iterationTruncated.length > 0) {
        const names: string = iterationTruncated
          .map((segment: CachedScheduleSegments) => {
            return segment.scheduleName;
          })
          .join(", ");

        notes.push(
          `Some shifts may be missing: the schedule ${names} is too complex to expand fully. Simplify its layers or shorten the feed window.`,
        );
      }

      let gapEvents: Array<ICalendarEvent> = [];
      let gapsTruncated: boolean = false;

      const dashboardUrl: string = (
        await DatabaseConfig.getDashboardUrl()
      ).toString();

      if (
        request.kind !== OnCallCalendarFeedKind.Personal &&
        request.includeCoverageGaps
      ) {
        const gaps: { events: Array<ICalendarEvent>; truncated: boolean } =
          OnCallCalendarFeedRenderer.buildGapEvents({
            segments,
            feedStart: window.feedStart,
            feedEnd: shrink.feedEnd,
            minimumGapMinutes: request.minimumGapMinutes,
            dashboardUrl,
          });

        gapEvents = gaps.events;
        gapsTruncated = gaps.truncated;

        if (gapsTruncated) {
          notes.push(
            `Only the first ${MAX_GAP_EVENTS} coverage gaps are shown.`,
          );
        }
      }

      const rendered: FeedRenderResult = OnCallCalendarFeedUtil.render({
        kind: request.kind,
        shifts: shrink.shifts,
        dashboardUrl,
        viewerTimezone: context.viewerTimezone,
        calendarTimezone: context.calendarTimezone,
        scheduleName: context.scheduleName,
        projectName: context.projectName,
        filterScheduleName: context.filterScheduleName,
        notes,
        gapEvents,
      });

      const value: CachedCalendarBody = {
        body: rendered.body,
        etag: Response.getCalendarETag(rendered.body),
        lastModified: rendered.lastModifiedAt || now,
      };

      await OnCallCalendarFeedCache.setBody({
        key: bodyKey,
        scope,
        value,
        ttlSeconds: BODY_CACHE_TTL_SECONDS,
      });

      /*
       * A partial render must never become the "last good" body: the next
       * complete render would then be shadowed by it on the next failure.
       */
      if (iterationTruncated.length === 0) {
        await OnCallCalendarFeedCache.setLastGood(bodyKey, value);
      }

      OnCallCalendarFeedRenderer.recordMetrics({
        kind: request.kind,
        durationMs: Date.now() - startedAt,
        eventCount: rendered.eventCount,
      });

      return {
        status: FeedRenderStatus.Rendered,
        kind: request.kind,
        body: value.body,
        etag: value.etag,
        lastModified: value.lastModified,
        stale: false,
        truncated:
          shrink.truncated || iterationTruncated.length > 0 || gapsTruncated,
        eventCount: rendered.eventCount,
        cacheHit: false,
        reason: null,
        retryAfterSeconds: null,
      };
    } catch (err) {
      logger.error(
        `OnCallCalendarFeedRenderer: rendering the ${request.kind} feed ${request.feedId.toString()} failed.`,
      );
      logger.error(err);

      return await OnCallCalendarFeedRenderer.fallBackToLastGood({
        kind: request.kind,
        bodyKey,
        why: "render failed",
      });
    } finally {
      OnCallCalendarFeedCache.releaseRenderSlot();
    }
  }

  // -- /my-shifts --------------------------------------------------------

  /*
   * The caller's own shifts between two instants, through the same
   * schedule-level cache the feeds use. The window handed to the cache is
   * widened to whole UTC days so a mobile client asking for "now to +30 d"
   * every few minutes keys the same entries as the feeds do, and the result
   * is then cut back to what was asked for.
   */
  @CaptureSpan()
  public static async materializeUserShifts(data: {
    userId: ObjectID;
    projectIds?: Array<ObjectID> | undefined;
    from: Date;
    to: Date;
    now?: Date | undefined;
  }): Promise<UserShiftsResult> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const windowStart: Date = new Date(
      CalendarFeedWindow.startOfUtcDay(data.from),
    );

    const endDayStart: number = CalendarFeedWindow.startOfUtcDay(data.to);
    const windowEnd: Date = new Date(
      data.to.getTime() > endDayStart
        ? endDayStart + 24 * 60 * 60 * 1000
        : endDayStart,
    );

    const candidateIds: Array<ObjectID> =
      await OnCallShiftMaterializer.getCandidateScheduleIdsForUser({
        userId: data.userId,
        projectIds: data.projectIds,
        windowStart,
        windowEnd,
        includeCoveringShifts: true,
      });

    if (candidateIds.length === 0) {
      return { shifts: [], truncated: false, generatedAt: now };
    }

    const schedules: Array<ScheduleInfo> =
      await OnCallCalendarFeedRenderer.loadSchedules(candidateIds);

    const segments: Array<CachedScheduleSegments> = await Promise.all(
      schedules.map((schedule: ScheduleInfo) => {
        return OnCallCalendarFeedRenderer.loadScheduleSegments({
          schedule,
          windowStart,
          windowEnd,
          now,
        });
      }),
    );

    const own: Array<MaterializedShift> =
      OnCallShiftMaterializer.filterShiftsForUser(
        OnCallCalendarFeedRenderer.collectShifts(segments, now),
        data.userId,
      );

    const inRange: Array<MaterializedShift> = own.filter(
      (shift: MaterializedShift) => {
        return shift.start < data.to && shift.end > data.from;
      },
    );

    return {
      shifts: MaterializedShiftUtil.sortByStart(inRange),
      truncated: segments.some((segment: CachedScheduleSegments) => {
        return segment.truncated;
      }),
      generatedAt: now,
    };
  }

  // -- Schedule-level cache ---------------------------------------------

  /*
   * One schedule's materialization over one window, from the shared cache or
   * freshly rendered into it. The key is the schedule's shiftConfigVersion
   * plus the exact window, so every feed and /my-shifts call that lands on
   * the same day-aligned window shares one LayerUtil expansion.
   *
   * The coverage envelope is computed in the same callback: it is the same
   * cost class as the expansion and the gap-event path would otherwise
   * expand every layer a second time.
   */
  @CaptureSpan()
  public static async loadScheduleSegments(data: {
    schedule: ScheduleInfo;
    windowStart: Date;
    windowEnd: Date;
    now: Date;
  }): Promise<CachedScheduleSegments> {
    const key: string = `${
      data.schedule.shiftConfigVersion
    }:${data.windowStart.toISOString()}:${data.windowEnd.toISOString()}`;

    return await OnCallCalendarFeedCache.getOrRenderScheduleSegments<CachedScheduleSegments>(
      {
        scheduleId: data.schedule.id.toString(),
        key,
        ttlSeconds: SCHEDULE_CACHE_TTL_SECONDS,
        render: async (): Promise<CachedScheduleSegments> => {
          return await OnCallCalendarFeedRenderer.renderScheduleSegments(data);
        },
      },
    );
  }

  private static async renderScheduleSegments(data: {
    schedule: ScheduleInfo;
    windowStart: Date;
    windowEnd: Date;
    now: Date;
  }): Promise<CachedScheduleSegments> {
    const result: MaterializeResult =
      await OnCallShiftMaterializer.materializeForSchedule({
        scheduleId: data.schedule.id,
        windowStart: data.windowStart,
        windowEnd: data.windowEnd,
        now: data.now,
        maxSimulationIterations: FEED_SIMULATION_ITERATION_CAP,
      });

    const info: MaterializedScheduleInfo | undefined = result.schedules.find(
      (schedule: MaterializedScheduleInfo) => {
        return schedule.scheduleId === data.schedule.id.toString();
      },
    );

    let envelope: CoverageEnvelopeResult = { segments: [], truncated: false };

    if (info) {
      envelope = OnCallCalendarFeedUtil.computeCoverageEnvelope({
        layers: info.layerProps,
        windowStart: data.windowStart,
        windowEnd: data.windowEnd,
        maxSimulationIterations: FEED_SIMULATION_ITERATION_CAP,
      });
    }

    return {
      scheduleId: data.schedule.id.toString(),
      scheduleName: info?.scheduleName || data.schedule.name,
      scheduleTimezone:
        info?.scheduleTimezone ?? data.schedule.timezone ?? null,
      projectId: info?.projectId || data.schedule.projectId.toString(),
      projectName: info?.projectName ?? null,
      shiftConfigVersion:
        info?.shiftConfigVersion ?? data.schedule.shiftConfigVersion,
      lastModifiedAt: (info?.lastModifiedAt || data.now).toISOString(),
      truncated: result.truncated,
      shifts: MaterializedShiftUtil.toJSONArray(result.shifts),
      envelope: envelope.segments.map((segment: TimeSegment) => {
        return {
          start: segment.start.toISOString(),
          end: segment.end.toISOString(),
        };
      }),
      envelopeTruncated: envelope.truncated,
    };
  }

  // -- Cache key ---------------------------------------------------------

  /*
   * `${kind}:${tokenHash}:${filters}:${digest(scheduleIds+versions)}:${day}`.
   * The candidate set and every shiftConfigVersion are read from Postgres on
   * each request, so any configuration edit changes the key immediately --
   * no counters to lose. The day bucket rolls the window at UTC midnight.
   */
  public static buildBodyCacheKey(data: {
    request: FeedRenderRequest;
    pastDays: number;
    futureDays: number;
    schedules: Array<ScheduleInfo>;
    now: Date;
  }): string {
    const request: FeedRenderRequest = data.request;

    let filters: string;

    if (request.kind === OnCallCalendarFeedKind.Personal) {
      filters = `s=${request.scheduleFilterId?.toString() || ""};c=${
        request.includeCoveringShifts ? 1 : 0
      }`;
    } else {
      filters = `g=${request.includeCoverageGaps ? 1 : 0};m=${
        request.minimumGapMinutes
      }`;
    }

    const versions: string = data.schedules
      .map((schedule: ScheduleInfo) => {
        return `${schedule.id.toString()}@${schedule.shiftConfigVersion}`;
      })
      .sort()
      .join(",");

    const digest: string = createHash("sha256")
      .update(versions, "utf8")
      .digest("hex")
      .slice(0, 24);

    return [
      request.kind,
      request.tokenHash,
      filters,
      `w=${data.pastDays}/${data.futureDays}`,
      digest,
      CalendarFeedWindow.getUtcDayBucket(data.now),
    ].join(":");
  }

  // -- Context (authorization, re-derived per fetch) ----------------------

  private static async resolveContext(
    request: FeedRenderRequest,
    window: FeedWindow,
  ): Promise<RenderContext> {
    switch (request.kind) {
      case OnCallCalendarFeedKind.Personal:
        return await OnCallCalendarFeedRenderer.resolvePersonalContext(
          request,
          window,
        );
      case OnCallCalendarFeedKind.Schedule:
        return await OnCallCalendarFeedRenderer.resolveScheduleContext(request);
      case OnCallCalendarFeedKind.Project:
        return await OnCallCalendarFeedRenderer.resolveProjectContext(request);
      default:
        return { empty: true, reason: USER_MISSING_REASON };
    }
  }

  private static async resolvePersonalContext(
    request: PersonalFeedRenderRequest,
    window: FeedWindow,
  ): Promise<RenderContext> {
    const user: User | null = await UserService.findOneById({
      id: request.userId,
      select: {
        _id: true,
        timezone: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (!user) {
      return { empty: true, reason: USER_MISSING_REASON };
    }

    const viewerTimezone: string | undefined = user.timezone
      ? user.timezone.toString()
      : undefined;

    if (
      !(await OnCallCalendarFeedRenderer.isProjectOnPlan(request.projectId))
    ) {
      return { empty: true, reason: PLAN_REASON, timezone: viewerTimezone };
    }

    const candidateIds: Array<ObjectID> =
      await OnCallShiftMaterializer.getCandidateScheduleIdsForUser({
        userId: request.userId,
        projectIds: [request.projectId],
        scheduleId: request.scheduleFilterId,
        windowStart: window.feedStart,
        windowEnd: window.feedEnd,
        includeCoveringShifts: request.includeCoveringShifts,
      });

    let filterScheduleName: string | undefined = undefined;

    if (request.scheduleFilterId) {
      const filtered: Array<ScheduleInfo> =
        await OnCallCalendarFeedRenderer.loadSchedules([
          request.scheduleFilterId,
        ]);

      filterScheduleName = filtered[0]?.name;
    }

    if (candidateIds.length === 0) {
      return {
        empty: true,
        reason: request.scheduleFilterId
          ? FILTERED_SCHEDULE_REASON
          : NO_SCHEDULES_REASON,
        filterScheduleName,
        timezone: viewerTimezone,
      };
    }

    const schedules: Array<ScheduleInfo> = (
      await OnCallCalendarFeedRenderer.loadSchedules(candidateIds)
    ).filter((schedule: ScheduleInfo) => {
      /*
       * Belt and braces: the candidate query was scoped to the project, but
       * a schedule row from another project must never render under this
       * project's token.
       */
      return schedule.projectId.toString() === request.projectId.toString();
    });

    if (schedules.length === 0) {
      return {
        empty: true,
        reason: request.scheduleFilterId
          ? FILTERED_SCHEDULE_REASON
          : NO_SCHEDULES_REASON,
        filterScheduleName,
        timezone: viewerTimezone,
      };
    }

    return {
      empty: false,
      schedules,
      viewerTimezone,
      calendarTimezone: viewerTimezone,
      filterScheduleName,
    };
  }

  private static async resolveScheduleContext(
    request: ScheduleFeedRenderRequest,
  ): Promise<RenderContext> {
    const schedules: Array<ScheduleInfo> =
      await OnCallCalendarFeedRenderer.loadSchedules([request.scheduleId]);

    const schedule: ScheduleInfo | undefined = schedules[0];

    if (
      !schedule ||
      schedule.projectId.toString() !== request.projectId.toString()
    ) {
      return { empty: true, reason: SCHEDULE_MISSING_REASON };
    }

    if (
      !(await OnCallCalendarFeedRenderer.isProjectOnPlan(request.projectId))
    ) {
      return {
        empty: true,
        reason: PLAN_REASON,
        scheduleName: schedule.name,
        timezone: schedule.timezone,
      };
    }

    return {
      empty: false,
      schedules: [schedule],
      scheduleName: schedule.name,
      calendarTimezone: schedule.timezone,
    };
  }

  private static async resolveProjectContext(
    request: ProjectFeedRenderRequest,
  ): Promise<RenderContext> {
    const project: Project | null = await ProjectService.findOneById({
      id: request.projectId,
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (!project) {
      return { empty: true, reason: PROJECT_MISSING_REASON };
    }

    const projectName: string | undefined = project.name || undefined;

    if (
      !(await OnCallCalendarFeedRenderer.isProjectOnPlan(request.projectId))
    ) {
      return { empty: true, reason: PLAN_REASON, projectName };
    }

    const rows: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
        query: {
          projectId: request.projectId,
        },
        select: OnCallCalendarFeedRenderer.scheduleSelect(),
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {
          name: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    const schedules: Array<ScheduleInfo> =
      OnCallCalendarFeedRenderer.toScheduleInfos(rows);

    if (schedules.length === 0) {
      return { empty: true, reason: NO_PROJECT_SCHEDULES_REASON, projectName };
    }

    return {
      empty: false,
      schedules,
      projectName,
    };
  }

  // -- Helpers -----------------------------------------------------------

  private static scheduleSelect(): {
    _id: true;
    name: true;
    timezone: true;
    projectId: true;
    shiftConfigVersion: true;
  } {
    return {
      _id: true,
      name: true,
      timezone: true,
      projectId: true,
      shiftConfigVersion: true,
    };
  }

  /*
   * Root read of the schedule facts the render needs (name, zone, project,
   * shiftConfigVersion). Input order is preserved; unknown ids are dropped.
   */
  @CaptureSpan()
  public static async loadSchedules(
    ids: Array<ObjectID>,
  ): Promise<Array<ScheduleInfo>> {
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
        query: {
          _id: QueryHelper.any(ids),
        },
        select: OnCallCalendarFeedRenderer.scheduleSelect(),
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

    const byId: Map<string, ScheduleInfo> = new Map();

    for (const info of OnCallCalendarFeedRenderer.toScheduleInfos(rows)) {
      byId.set(info.id.toString(), info);
    }

    const ordered: Array<ScheduleInfo> = [];

    for (const id of ids) {
      const info: ScheduleInfo | undefined = byId.get(id.toString());

      if (info && !ordered.includes(info)) {
        ordered.push(info);
      }
    }

    return ordered;
  }

  private static toScheduleInfos(
    rows: Array<OnCallDutyPolicySchedule>,
  ): Array<ScheduleInfo> {
    const infos: Array<ScheduleInfo> = [];

    for (const row of rows) {
      if (!row.id || !row.projectId) {
        continue;
      }

      const timezone: string | undefined = row.timezone
        ? row.timezone.toString()
        : undefined;

      const info: ScheduleInfo = {
        id: row.id,
        name: row.name || "",
        projectId: row.projectId,
        shiftConfigVersion:
          typeof row.shiftConfigVersion === "number" &&
          Number.isFinite(row.shiftConfigVersion)
            ? row.shiftConfigVersion
            : Number(row.shiftConfigVersion) || 0,
      };

      if (timezone) {
        info.timezone = timezone;
      }

      infos.push(info);
    }

    return infos;
  }

  /*
   * Every cached shift of every schedule as MaterializedShift objects, with
   * isPast re-evaluated against THIS request's clock (a schedule entry can be
   * up to an hour old).
   */
  private static collectShifts(
    segments: Array<CachedScheduleSegments>,
    now: Date,
  ): Array<MaterializedShift> {
    const shifts: Array<MaterializedShift> = [];

    for (const segment of segments) {
      for (const shift of MaterializedShiftUtil.fromJSONArray(segment.shifts)) {
        shift.isPast = shift.start.getTime() < now.getTime();
        shifts.push(shift);
      }
    }

    return MaterializedShiftUtil.sortByStart(shifts);
  }

  private static buildGapEvents(data: {
    segments: Array<CachedScheduleSegments>;
    feedStart: Date;
    feedEnd: Date;
    minimumGapMinutes: number;
    dashboardUrl: string;
  }): { events: Array<ICalendarEvent>; truncated: boolean } {
    const collected: Array<ICalendarEvent> = [];
    let truncated: boolean = false;

    const minimumGapSeconds: number =
      Math.max(0, Math.floor(data.minimumGapMinutes)) * 60;

    for (const segment of data.segments) {
      const shifts: Array<TimeSegment> = segment.shifts.map(
        (shift: MaterializedShiftJson) => {
          return {
            start: new Date(shift.start),
            end: new Date(shift.end),
          };
        },
      );

      const envelope: Array<TimeSegment> = segment.envelope.map(
        (window: { start: string; end: string }) => {
          return { start: new Date(window.start), end: new Date(window.end) };
        },
      );

      const result: CoverageGapEventsResult =
        OnCallCalendarFeedUtil.buildCoverageGapEvents({
          scheduleId: segment.scheduleId,
          scheduleName: segment.scheduleName,
          projectId: segment.projectId,
          shifts,
          feedStart: data.feedStart,
          feedEnd: data.feedEnd,
          envelope,
          minimumGapSeconds,
          lastModifiedAt: new Date(segment.lastModifiedAt),
          shiftConfigVersion: segment.shiftConfigVersion,
          dashboardUrl: data.dashboardUrl,
          maxGapEvents: MAX_GAP_EVENTS,
        });

      truncated = truncated || result.truncated;
      collected.push(...result.events);
    }

    collected.sort((a: ICalendarEvent, b: ICalendarEvent) => {
      return a.start.getTime() - b.start.getTime();
    });

    if (collected.length > MAX_GAP_EVENTS) {
      return { events: collected.slice(0, MAX_GAP_EVENTS), truncated: true };
    }

    return { events: collected, truncated };
  }

  private static async fallBackToLastGood(data: {
    kind: OnCallCalendarFeedKind;
    bodyKey: string;
    why: string;
  }): Promise<FeedRenderOutcome> {
    const lastGood: CachedCalendarBody | null =
      await OnCallCalendarFeedCache.getLastGood(data.bodyKey);

    if (lastGood) {
      logger.warn(
        `OnCallCalendarFeedRenderer: ${data.why}; serving the last good ${data.kind} feed body.`,
      );

      return OnCallCalendarFeedRenderer.outcomeFromCachedBody({
        kind: data.kind,
        cached: lastGood,
        stale: true,
        cacheHit: false,
        truncated: true,
      });
    }

    logger.warn(
      `OnCallCalendarFeedRenderer: ${data.why} and nothing is cached for this ${data.kind} feed; answering unavailable.`,
    );

    return OnCallCalendarFeedRenderer.buildUnavailableOutcome(
      data.kind,
      RENDER_CAP_RETRY_AFTER_SECONDS,
    );
  }

  private static recordMetrics(data: {
    kind: OnCallCalendarFeedKind;
    durationMs: number;
    eventCount: number;
  }): void {
    try {
      const attributes: Record<string, string> = {
        [AppMetrics.ON_CALL_CALENDAR_FEED_KIND_ATTRIBUTE]:
          OnCallCalendarFeedUrls.getKindSegment(data.kind),
      };

      AppMetrics.getOnCallCalendarRenderDuration().record(
        data.durationMs,
        attributes,
      );
      AppMetrics.getOnCallCalendarRenderEvents().record(
        data.eventCount,
        attributes,
      );
    } catch (err) {
      logger.debug(
        `OnCallCalendarFeedRenderer: metrics unavailable (${String(err)})`,
      );
    }
  }

  /* VEVENT count of a serialized body, for outcomes rebuilt from a cache. */
  public static countEvents(body: string): number {
    return (body.match(/BEGIN:VEVENT/g) || []).length;
  }
}
