import OnCallCalendarFeedCache from "../Infrastructure/OnCallCalendarFeedCache";
import UserMiddleware from "../Middleware/UserAuthorization";
import OnCallDutyPolicyScheduleLayerUserService from "../Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleOwnerTeamService from "../Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleService from "../Services/OnCallDutyPolicyScheduleService";
import TeamMemberService from "../Services/TeamMemberService";
import TeamService from "../Services/TeamService";
import QueryHelper from "../Types/Database/QueryHelper";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import OnCallCalendarFeedRenderer, {
  CachedScheduleSegments,
  ScheduleInfo,
} from "../Utils/OnCall/OnCallCalendarFeedRenderer";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayerUser from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyScheduleOwnerTeam from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import MaterializedShiftUtil from "../../Types/OnCallDutyPolicy/MaterializedShift";
import ScheduleTimelineUtil, {
  SCHEDULE_TIMELINE_ROUTE,
  ScheduleTimelineResponse,
  ScheduleTimelineScheduleJson,
  ScheduleTimelineShiftJson,
  ScheduleTimelineTeamJson,
  TIMELINE_MAX_SCHEDULES,
  TimelineWindow,
} from "../../Types/OnCallDutyPolicy/ScheduleTimeline";

/*
 * GET /on-call-schedule-timeline?from=&to=[&teamId=]
 *
 * Every on-call schedule the caller can read in the tenant project, with the
 * resolved shifts of each over [from, to): the data behind the "all schedules
 * in one week / month view" page and the per-team schedule view.
 *
 * WHO MAY SEE WHAT. The shifts are the schedules' rosters -- who is on which
 * layer, and when -- so the route first requires the permission the CRUD
 * read of layer users requires (assertPermittedInProject with that model's
 * read list); a role that can list schedules but not open their layers gets
 * a 403 here too, not a back door. Override provenance (whose shift is being
 * covered, the override's window) is likewise only sent to callers who could
 * read user overrides; anyone else still sees who is paged, which the
 * schedule row itself already exposes as currentUserOnRoster.
 *
 * WHICH schedules appear is then decided by reading the schedule list with
 * the CALLER's props, so the table permission and the label scoping
 * (@CanAccessIfCanReadOn) apply exactly as on the schedules table. Everything
 * after that -- the shift expansion, user names, team names, "am I on this
 * roster" -- is a root read keyed on the ids that gate returned.
 *
 * WHAT IT COSTS. The shifts come from the schedule-level cache the calendar
 * feeds and /my-shifts share (OnCallCalendarFeedRenderer), keyed on each
 * schedule's shiftConfigVersion and the UTC-day-aligned window, so a team
 * paging through the same week shares one expansion per schedule. A miss
 * holds one of the per-process render slots, and like /my-shifts this route
 * leaves half of them for the public feeds: a dashboard can retry, a calendar
 * client that gets a 503 shows somebody a stale on-call calendar.
 */

const router: ExpressRouter = Express.getRouter();

// Seconds the dashboard is told to wait before retrying a capped render.
export const TIMELINE_RETRY_AFTER_SECONDS: number = 5;

/*
 * The optional `?teamId=` filter: only schedules that team owns. Absent or
 * blank -> no filter. Present but not a UUID -> 400; a page that asked for
 * one team's schedules must never quietly get everyone's.
 */
export function readTimelineTeamFilter(req: ExpressRequest): ObjectID | null {
  const raw: unknown = req.query?.["teamId"];

  if (raw === undefined || raw === null) {
    return null;
  }

  const value: string = (
    Array.isArray(raw) ? String(raw[0] ?? "") : String(raw)
  ).trim();

  if (!value) {
    return null;
  }

  if (!ObjectID.isValidUUID(value)) {
    throw new BadDataException("teamId must be a valid id.");
  }

  return new ObjectID(value);
}

// The requested window, validated and clamped (see ScheduleTimelineUtil).
export function readTimelineWindow(
  req: ExpressRequest,
  now: Date,
): TimelineWindow {
  const pick: (name: string) => unknown = (name: string): unknown => {
    const raw: unknown = req.query?.[name];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  return ScheduleTimelineUtil.clampWindow({
    from: pick("from"),
    to: pick("to"),
    now,
  });
}

/*
 * Assemble the response from what the route read. Pure, so the shape and
 * the ordering rules are tested without a database:
 *
 *   - schedules keep the caller-scoped read's order (by name);
 *   - a schedule the cache produced nothing for still gets a row (it is
 *     visible to the caller; an empty row says "nobody is on call");
 *   - shifts are projected with ScheduleTimelineUtil.toTimelineShift and
 *     sorted by start;
 *   - teams are the owner teams of the returned schedules, by name.
 */
export function buildTimelineResponse(data: {
  window: TimelineWindow;
  now: Date;
  schedules: Array<{ id: string; name: string }>;
  segments: Array<CachedScheduleSegments>;
  ownerTeamIdsBySchedule: Map<string, Array<string>>;
  rosterScheduleIds: Set<string>;
  teamNames: Map<string, string>;
  memberTeamIds: Set<string>;
  totalScheduleCount: number;
  // False strips override provenance: the caller cannot read user overrides.
  includeOverrides: boolean;
}): ScheduleTimelineResponse {
  const segmentsById: Map<string, CachedScheduleSegments> = new Map();

  for (const segment of data.segments) {
    segmentsById.set(segment.scheduleId, segment);
  }

  const schedules: Array<ScheduleTimelineScheduleJson> = [];
  const usedTeamIds: Set<string> = new Set<string>();
  let truncated: boolean = false;

  for (const schedule of data.schedules) {
    const segment: CachedScheduleSegments | undefined = segmentsById.get(
      schedule.id,
    );

    const shifts: Array<ScheduleTimelineShiftJson> = [];

    if (segment) {
      for (const shift of MaterializedShiftUtil.fromJSONArray(segment.shifts)) {
        const projected: ScheduleTimelineShiftJson | null =
          ScheduleTimelineUtil.toTimelineShift(shift, data.window);

        if (projected) {
          shifts.push(
            data.includeOverrides
              ? projected
              : { ...projected, override: null },
          );
        }
      }
    }

    shifts.sort(
      (a: ScheduleTimelineShiftJson, b: ScheduleTimelineShiftJson): number => {
        return Date.parse(a.start) - Date.parse(b.start);
      },
    );

    const ownerTeamIds: Array<string> = (
      data.ownerTeamIdsBySchedule.get(schedule.id) || []
    ).filter((teamId: string) => {
      // A team row that has since been deleted has no name to group under.
      return data.teamNames.has(teamId);
    });

    for (const teamId of ownerTeamIds) {
      usedTeamIds.add(teamId);
    }

    truncated = truncated || Boolean(segment?.truncated);

    schedules.push({
      scheduleId: schedule.id,
      scheduleName: segment?.scheduleName || schedule.name,
      scheduleTimezone: segment?.scheduleTimezone ?? null,
      ownerTeamIds,
      isCurrentUserOnRoster: data.rosterScheduleIds.has(schedule.id),
      truncated: Boolean(segment?.truncated),
      shifts,
    });
  }

  const teams: Array<ScheduleTimelineTeamJson> = Array.from(usedTeamIds)
    .map((teamId: string): ScheduleTimelineTeamJson => {
      return {
        teamId,
        teamName: data.teamNames.get(teamId) || "Unnamed team",
        isCurrentUserMember: data.memberTeamIds.has(teamId),
      };
    })
    .sort((a: ScheduleTimelineTeamJson, b: ScheduleTimelineTeamJson) => {
      return a.teamName.localeCompare(b.teamName);
    });

  return {
    from: data.window.from.toISOString(),
    to: data.window.to.toISOString(),
    generatedAt: data.now.toISOString(),
    truncated,
    totalScheduleCount: Math.max(
      data.totalScheduleCount,
      data.schedules.length,
    ),
    schedulesTruncated: data.totalScheduleCount > data.schedules.length,
    schedules,
    teams,
  };
}

function toIdStrings(
  ids: Array<ObjectID | null | undefined | string>,
): Array<string> {
  const out: Array<string> = [];

  for (const id of ids) {
    const value: string = id ? id.toString() : "";

    if (value && !out.includes(value)) {
      out.push(value);
    }
  }

  return out;
}

/*
 * Schedule ids a team owns, read with the caller's props (the owner-team
 * table has its own read permission, and the answer must respect it).
 */
async function findScheduleIdsOwnedByTeam(data: {
  teamId: ObjectID;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Array<string>> {
  const rows: Array<OnCallDutyPolicyScheduleOwnerTeam> =
    await OnCallDutyPolicyScheduleOwnerTeamService.findBy({
      query: {
        teamId: data.teamId,
        projectId: data.projectId,
      },
      select: {
        onCallDutyPolicyScheduleId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: data.props,
    });

  return toIdStrings(
    rows.map((row: OnCallDutyPolicyScheduleOwnerTeam) => {
      return row.onCallDutyPolicyScheduleId;
    }),
  );
}

/*
 * Owner teams per schedule, with the caller's props. A caller whose role can
 * read schedules but not their owner rows still gets a timeline, just an
 * ungrouped one, so a permission error here is logged and swallowed.
 */
async function loadOwnerTeamIds(data: {
  scheduleIds: Array<string>;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Map<string, Array<string>>> {
  const out: Map<string, Array<string>> = new Map();

  if (data.scheduleIds.length === 0) {
    return out;
  }

  let rows: Array<OnCallDutyPolicyScheduleOwnerTeam> = [];

  try {
    rows = await OnCallDutyPolicyScheduleOwnerTeamService.findBy({
      query: {
        projectId: data.projectId,
        onCallDutyPolicyScheduleId: QueryHelper.any(data.scheduleIds),
      },
      select: {
        onCallDutyPolicyScheduleId: true,
        teamId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: data.props,
    });
  } catch (err) {
    /*
     * Only a refusal is a reason to serve the timeline ungrouped. A database
     * error must surface: silently dropping every team would look like a
     * successful answer with all schedules under "No owner team".
     */
    if (
      !(err instanceof NotAuthorizedException) &&
      !(err instanceof PaymentRequiredException)
    ) {
      throw err;
    }

    logger.debug(
      "OnCallScheduleTimelineAPI: owner teams could not be read for this caller; the timeline is served ungrouped.",
    );
    logger.debug(err);
    return out;
  }

  for (const row of rows) {
    const scheduleId: string = row.onCallDutyPolicyScheduleId?.toString() || "";
    const teamId: string = row.teamId?.toString() || "";

    if (!scheduleId || !teamId) {
      continue;
    }

    const list: Array<string> = out.get(scheduleId) || [];

    if (!list.includes(teamId)) {
      list.push(teamId);
    }

    out.set(scheduleId, list);
  }

  return out;
}

async function loadTeamNames(data: {
  teamIds: Array<string>;
  projectId: ObjectID;
}): Promise<Map<string, string>> {
  const out: Map<string, string> = new Map();

  if (data.teamIds.length === 0) {
    return out;
  }

  const rows: Array<Team> = await TeamService.findBy({
    query: {
      _id: QueryHelper.any(data.teamIds),
      projectId: data.projectId,
    },
    select: {
      _id: true,
      name: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  for (const row of rows) {
    const teamId: string = row.id?.toString() || "";

    if (teamId) {
      out.set(teamId, row.name?.toString() || "Unnamed team");
    }
  }

  return out;
}

// The caller's own accepted memberships among `teamIds`.
async function loadMemberTeamIds(data: {
  teamIds: Array<string>;
  projectId: ObjectID;
  userId: ObjectID;
}): Promise<Set<string>> {
  if (data.teamIds.length === 0) {
    return new Set<string>();
  }

  const rows: Array<TeamMember> = await TeamMemberService.findBy({
    query: {
      projectId: data.projectId,
      userId: data.userId,
      teamId: QueryHelper.any(data.teamIds),
      hasAcceptedInvitation: true,
    },
    select: {
      teamId: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  return new Set<string>(
    toIdStrings(
      rows.map((row: TeamMember) => {
        return row.teamId;
      }),
    ),
  );
}

// Which of `scheduleIds` the caller is assigned to on some layer.
async function loadRosterScheduleIds(data: {
  scheduleIds: Array<string>;
  projectId: ObjectID;
  userId: ObjectID;
}): Promise<Set<string>> {
  if (data.scheduleIds.length === 0) {
    return new Set<string>();
  }

  const rows: Array<OnCallDutyPolicyScheduleLayerUser> =
    await OnCallDutyPolicyScheduleLayerUserService.findBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        onCallDutyPolicyScheduleId: QueryHelper.any(data.scheduleIds),
      },
      select: {
        onCallDutyPolicyScheduleId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

  return new Set<string>(
    toIdStrings(
      rows.map((row: OnCallDutyPolicyScheduleLayerUser) => {
        return row.onCallDutyPolicyScheduleId;
      }),
    ),
  );
}

// Whether the caller could read user overrides through their CRUD endpoint.
export function canReadUserOverrides(
  props: DatabaseCommonInteractionProps,
): boolean {
  try {
    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions:
        new OnCallDutyPolicyUserOverride().getReadPermissions(),
    });
    return true;
  } catch {
    return false;
  }
}

function emptyResponse(
  window: TimelineWindow,
  now: Date,
): ScheduleTimelineResponse {
  return buildTimelineResponse({
    window,
    now,
    schedules: [],
    segments: [],
    ownerTeamIdsBySchedule: new Map(),
    rosterScheduleIds: new Set(),
    teamNames: new Map(),
    memberTeamIds: new Set(),
    totalScheduleCount: 0,
    includeOverrides: false,
  });
}

router.get(
  SCHEDULE_TIMELINE_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      const userId: ObjectID = props.userId as ObjectID;

      // The rosters are layer-user data: require what reading them requires.
      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions:
          new OnCallDutyPolicyScheduleLayerUser().getReadPermissions(),
        errorMessage:
          "You do not have permission to read this project's on-call schedule layers.",
      });

      const includeOverrides: boolean = canReadUserOverrides(props);

      const now: Date = OneUptimeDate.getCurrentDate();
      const window: TimelineWindow = readTimelineWindow(req, now);
      const teamId: ObjectID | null = readTimelineTeamFilter(req);

      let teamScheduleIds: Array<string> | null = null;

      if (teamId) {
        teamScheduleIds = await findScheduleIdsOwnedByTeam({
          teamId,
          projectId,
          props,
        });

        if (teamScheduleIds.length === 0) {
          return Response.sendJsonObjectResponse(
            req,
            res,
            emptyResponse(window, now) as unknown as JSONObject,
          );
        }
      }

      /*
       * THE gate: a non-root read, so permissions and label scoping decide
       * which schedules exist for this caller. One row past the cap tells
       * the page there is more than it was given.
       */
      const scheduleQuery: {
        projectId: ObjectID;
        _id?: ReturnType<typeof QueryHelper.any>;
      } = { projectId };

      if (teamScheduleIds) {
        scheduleQuery._id = QueryHelper.any(teamScheduleIds);
      }

      const visible: Array<OnCallDutyPolicySchedule> =
        await OnCallDutyPolicyScheduleService.findBy({
          query: scheduleQuery,
          select: {
            _id: true,
            name: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
          limit: TIMELINE_MAX_SCHEDULES + 1,
          skip: 0,
          props,
        });

      const readable: Array<{ id: string; name: string }> = [];

      for (const row of visible) {
        const id: string = row.id?.toString() || "";

        if (id) {
          readable.push({ id, name: row.name?.toString() || "" });
        }
      }

      if (readable.length === 0) {
        return Response.sendJsonObjectResponse(
          req,
          res,
          emptyResponse(window, now) as unknown as JSONObject,
        );
      }

      let totalScheduleCount: number = readable.length;
      const schedules: Array<{ id: string; name: string }> = readable.slice(
        0,
        TIMELINE_MAX_SCHEDULES,
      );

      if (readable.length > TIMELINE_MAX_SCHEDULES) {
        totalScheduleCount = (
          await OnCallDutyPolicyScheduleService.countBy({
            query: scheduleQuery,
            props,
          })
        ).toNumber();
      }

      const scheduleIds: Array<string> = schedules.map(
        (schedule: { id: string; name: string }) => {
          return schedule.id;
        },
      );

      const ownerTeamIdsBySchedule: Map<
        string,
        Array<string>
      > = await loadOwnerTeamIds({ scheduleIds, projectId, props });

      const allTeamIds: Array<string> = toIdStrings(
        Array.from(ownerTeamIdsBySchedule.values()).flat(),
      );

      const [teamNames, memberTeamIds, rosterScheduleIds]: [
        Map<string, string>,
        Set<string>,
        Set<string>,
      ] = await Promise.all([
        loadTeamNames({ teamIds: allTeamIds, projectId }),
        loadMemberTeamIds({ teamIds: allTeamIds, projectId, userId }),
        loadRosterScheduleIds({ scheduleIds, projectId, userId }),
      ]);

      const infos: Array<ScheduleInfo> =
        await OnCallCalendarFeedRenderer.loadSchedules(
          scheduleIds.map((id: string) => {
            return new ObjectID(id);
          }),
        );

      if (
        !OnCallCalendarFeedCache.tryAcquireRenderSlot({
          leaveFreeSlots: Math.floor(
            OnCallCalendarFeedCache.getRenderConcurrency() / 2,
          ),
        })
      ) {
        res.set("Retry-After", String(TIMELINE_RETRY_AFTER_SECONDS));

        return Response.sendErrorResponse(
          req,
          res,
          new ServiceUnavailableException(
            "The schedule timeline is busy right now. Please try again in a few seconds.",
          ),
        );
      }

      let segments: Array<CachedScheduleSegments>;

      try {
        const cacheWindow: { windowStart: Date; windowEnd: Date } =
          ScheduleTimelineUtil.getCacheWindow(window);

        segments = await OnCallCalendarFeedRenderer.loadScheduleSegmentsBatch({
          schedules: infos,
          windowStart: cacheWindow.windowStart,
          windowEnd: cacheWindow.windowEnd,
          now,
        });
      } finally {
        OnCallCalendarFeedCache.releaseRenderSlot();
      }

      const payload: ScheduleTimelineResponse = buildTimelineResponse({
        window,
        now,
        schedules,
        segments,
        ownerTeamIdsBySchedule,
        rosterScheduleIds,
        teamNames,
        memberTeamIds,
        totalScheduleCount,
        includeOverrides,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        payload as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
