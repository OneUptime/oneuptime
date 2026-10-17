import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import OnCallCalendarFeedRateLimit from "../Middleware/OnCallCalendarFeedRateLimit";
import UserMiddleware from "../Middleware/UserAuthorization";
import ScheduledMaintenanceCalendarFeedService from "../Services/ScheduledMaintenanceCalendarFeedService";
import ScheduledMaintenanceService from "../Services/ScheduledMaintenanceService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import CalendarFeedToken, {
  CalendarFeedRotation,
} from "../Utils/OnCall/CalendarFeedToken";
import Response from "../Utils/Response";
import MaintenanceCalendarFeedCache, {
  RenderedMaintenanceCalendar,
} from "../Utils/ScheduledMaintenance/MaintenanceCalendarFeedCache";
import MaintenanceCalendarFeedUrls from "../Utils/ScheduledMaintenance/MaintenanceCalendarFeedUrls";
import TeamMaintenanceCalendar, {
  TEAM_CALENDAR_FUTURE_DAYS,
  TEAM_CALENDAR_PAST_DAYS,
  TEAM_CALENDAR_REPLACED_REASON,
  TEAM_CALENDAR_TURNED_OFF_REASON,
} from "../Utils/ScheduledMaintenance/TeamMaintenanceCalendar";
import CommonAPI from "./CommonAPI";
import {
  assertJsonRequest,
  classifyCalendarClient,
  feedFallbackHandler,
  isPreviousTokenInGrace,
  shouldRecordFetch,
} from "./OnCallCalendarAPI";
import ScheduledMaintenanceCalendarFeed from "../../Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CalendarSubscriptionLinkSet } from "../../Types/Calendar/CalendarSubscriptionLinks";
import OneUptimeDate from "../../Types/Date";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { MAINTENANCE_CALENDAR_FILE_NAME } from "../../Types/ScheduledMaintenance/MaintenanceCalendar";

/*
 * The HTTP face of the team's calendar link for scheduled maintenance.
 *
 * Two kinds of route, as for the on-call calendar links (OnCallCalendarAPI,
 * whose rules these follow and whose helpers they share):
 *
 * THE PUBLIC ROUTE (no UserMiddleware). A calendar app sends no cookie; the
 * 43-character token in the path is the credential. Rate limit -> shape
 * guard -> token lookup (the current hash, then the rotated-out hash within
 * its 30 days) -> the calendar -> bookkeeping. One answer for each case:
 *
 *   unknown / malformed / expired token   -> 404, a body that says nothing
 *   a link turned off, or one replaced by
 *   a new link within its 30 days         -> 200, an EMPTY calendar saying
 *                                            why, so the app clears its copy
 *   otherwise                             -> 200, every event of the project
 *                                            from 90 days back to a year
 *                                            ahead (TeamMaintenanceCalendar)
 *
 * THE SESSION ROUTES (UserMiddleware + requireUserAuthentication): the
 * Subscribe dialog on Scheduled Maintenance > Events reads the link
 * (/current - the only place the encrypted token is ever read back),
 * publishes it and regenerates it. Turning it off and on is the model's own
 * isEnabled, through its CRUD route.
 *
 * WHO MAY HOLD THE LINK. It shows every event of the project, so every
 * session route asks two things of the caller: the model's own permission
 * (the scheduled maintenance event's access lists, enforced by reading and
 * writing the row with the caller's props), and that they read every event
 * of the project - a reader held to some labels, or to the events they own,
 * is told why the link is not theirs to see (READ_EVERY_EVENT_MESSAGE).
 *
 * The token never reaches a log line, an error message or a cache key.
 */
const router: ExpressRouter = Express.getRouter();

// -- Routes (exported so tests and the dashboard pin the same strings) ------

export const TEAM_FEED_ROUTE: string =
  "/scheduled-maintenance-calendar/project/:token/maintenance.ics";

/*
 * Anything else under the token-bearing prefix: answered without ever
 * writing the URL down (OnCallCalendarAPI.feedFallbackHandler), so a token
 * pasted without its file name never reaches the catch-all's log line.
 */
export const TEAM_FEED_FALLBACK_ROUTE: string =
  "/scheduled-maintenance-calendar/project/*";

export const TEAM_FEED_CURRENT_ROUTE: string =
  "/scheduled-maintenance-calendar/project-feed/current";
export const TEAM_FEED_PUBLISH_ROUTE: string =
  "/scheduled-maintenance-calendar/project-feed/publish";
export const TEAM_FEED_ROTATE_ROUTE: string =
  "/scheduled-maintenance-calendar/project-feed/rotate";

export const PUBLISH_LOCK_NAMESPACE: string =
  "ScheduledMaintenanceCalendarFeed.publish";

export const PUBLISH_LOCK_TIMEOUT_MS: number = 10000;

export const READ_EVERY_EVENT_MESSAGE: string =
  "You can see only some of this project's scheduled maintenance events, so its calendar link, which shows every event, is not yours to use. Ask a project admin for access to every event.";

export const NO_TEAM_FEED_MESSAGE: string =
  "This project has no calendar link for scheduled maintenance yet. Publish one first.";

// The body of every 404 on the public route. Says nothing.
const NOT_FOUND_MESSAGE: string = "Not found.";

// -- Wire shape -------------------------------------------------------------

/*
 * What the Subscribe dialog reads: the on-call links' FeedStatus shape
 * (Dashboard CalendarFeedTypes.parseFeedStatus reads both), with the fixed
 * window in `settings`.
 */
export interface MaintenanceCalendarFeedStatus {
  exists: boolean;
  feedId: string | null;
  isEnabled: boolean;
  needsRegeneration: boolean;
  tokenHint: string | null;
  rotatedAt: string | null;
  previousTokenExpiresAt: string | null;
  lastFetchedAt: string | null;
  lastFetchedClient: string | null;
  fetchCount: number;
  lastRenderTruncated: boolean;
  settings: {
    pastDays: number;
    futureDays: number;
  };
  urls: CalendarSubscriptionLinkSet | null;
  hostWarning: string | null;
  protocolWarning: string | null;
  privateHost: string | null;
}

interface TeamFeedLookup {
  feed: ScheduledMaintenanceCalendarFeed;
  // Matched the rotated-out hash, still within its 30 days.
  viaPreviousToken: boolean;
}

// -- Helpers ----------------------------------------------------------------

function sendNotFound(req: ExpressRequest, res: ExpressResponse): void {
  return Response.sendErrorResponse(
    req,
    res,
    new NotFoundException(NOT_FOUND_MESSAGE),
  );
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === "string" && value) {
    const parsed: Date = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

function getWindowSettings(): { pastDays: number; futureDays: number } {
  return {
    pastDays: TEAM_CALENDAR_PAST_DAYS,
    futureDays: TEAM_CALENDAR_FUTURE_DAYS,
  };
}

// The status of a project with no link yet.
export function buildAbsentFeedStatus(): MaintenanceCalendarFeedStatus {
  return {
    exists: false,
    feedId: null,
    isEnabled: false,
    needsRegeneration: false,
    tokenHint: null,
    rotatedAt: null,
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: getWindowSettings(),
    urls: null,
    hostWarning: MaintenanceCalendarFeedUrls.getHostWarning(),
    protocolWarning: MaintenanceCalendarFeedUrls.getProtocolWarning(),
    privateHost: MaintenanceCalendarFeedUrls.getPrivateHost(),
  };
}

/*
 * The status of an existing link. `plaintextToken` is a token just minted
 * (known without a decrypt); otherwise `decryptedToken` is what the root read
 * handed back, checked against the hash read with it. A token that does not
 * decrypt, or no longer hashes to its row's hash, means ENCRYPTION_SECRET
 * changed under the row: the link still works for the apps that hold it,
 * but it cannot be shown, and the dialog offers Regenerate link.
 */
export function buildFeedStatus(data: {
  feed: ScheduledMaintenanceCalendarFeed;
  plaintextToken?: string | undefined;
  decryptedToken?: string | undefined;
  verifiedTokenHash?: string | undefined;
  decryptFailed?: boolean | undefined;
}): MaintenanceCalendarFeedStatus {
  let token: string | null = null;
  let needsRegeneration: boolean = false;

  if (
    data.plaintextToken &&
    CalendarFeedToken.isValidShape(data.plaintextToken)
  ) {
    token = data.plaintextToken;
  } else if (
    !data.decryptFailed &&
    data.decryptedToken &&
    data.verifiedTokenHash &&
    CalendarFeedToken.isValidShape(data.decryptedToken) &&
    CalendarFeedToken.isHashEqual(
      CalendarFeedToken.hash(data.decryptedToken),
      data.verifiedTokenHash,
    )
  ) {
    token = data.decryptedToken;
  } else {
    needsRegeneration = true;
  }

  const feed: ScheduledMaintenanceCalendarFeed = data.feed;

  return {
    exists: true,
    feedId: feed.id ? feed.id.toString() : null,
    isEnabled: feed.isEnabled !== false,
    needsRegeneration: needsRegeneration,
    tokenHint: feed.tokenHint || null,
    rotatedAt: toIso(feed.rotatedAt),
    previousTokenExpiresAt: toIso(feed.previousTokenExpiresAt),
    lastFetchedAt: toIso(feed.lastFetchedAt),
    lastFetchedClient: feed.lastFetchedClient || null,
    fetchCount: typeof feed.fetchCount === "number" ? feed.fetchCount : 0,
    lastRenderTruncated: false,
    settings: getWindowSettings(),
    urls: token ? MaintenanceCalendarFeedUrls.buildFeedUrls({ token }) : null,
    hostWarning: MaintenanceCalendarFeedUrls.getHostWarning(),
    protocolWarning: MaintenanceCalendarFeedUrls.getProtocolWarning(),
    privateHost: MaintenanceCalendarFeedUrls.getPrivateHost(),
  };
}

/*
 * The one decrypting read. Selecting `token` makes DatabaseService decrypt
 * it on the way out; with the wrong secret that throws or yields bytes that
 * do not hash to tokenHash, and both are needsRegeneration, never a 500.
 */
async function readTokenForStatus(id: ObjectID): Promise<{
  decryptedToken?: string | undefined;
  verifiedTokenHash?: string | undefined;
  decryptFailed: boolean;
}> {
  try {
    const row: ScheduledMaintenanceCalendarFeed | null =
      await ScheduledMaintenanceCalendarFeedService.findOneById({
        id: id,
        select: { _id: true, token: true, tokenHash: true },
        props: { isRoot: true, ignoreHooks: true },
      });

    if (!row || !row.token || !row.tokenHash) {
      return { decryptFailed: true };
    }

    return {
      decryptedToken: row.token,
      verifiedTokenHash: row.tokenHash,
      decryptFailed: false,
    };
  } catch (err) {
    logger.warn(
      `ScheduledMaintenanceCalendarAPI: could not decrypt the calendar link token of feed ${id.toString()}; the link needs regenerating.`,
    );
    logger.warn(err);
    return { decryptFailed: true };
  }
}

async function buildStatusForRow(data: {
  feed: ScheduledMaintenanceCalendarFeed;
  plaintextToken?: string | undefined;
}): Promise<MaintenanceCalendarFeedStatus> {
  if (data.plaintextToken || !data.feed.id) {
    return buildFeedStatus({
      feed: data.feed,
      plaintextToken: data.plaintextToken,
      decryptFailed: !data.plaintextToken,
    });
  }

  return buildFeedStatus({
    feed: data.feed,
    ...(await readTokenForStatus(data.feed.id)),
  });
}

// The non-secret columns a session read selects.
const STATUS_SELECT: {
  _id: true;
  projectId: true;
  isEnabled: true;
  tokenHint: true;
  rotatedAt: true;
  previousTokenExpiresAt: true;
  lastFetchedAt: true;
  lastFetchedClient: true;
  fetchCount: true;
} = {
  _id: true,
  projectId: true,
  isEnabled: true,
  tokenHint: true,
  rotatedAt: true,
  previousTokenExpiresAt: true,
  lastFetchedAt: true,
  lastFetchedClient: true,
  fetchCount: true,
};

/*
 * The columns the PUBLIC route reads. Never `token`: a calendar app's poll
 * must keep working after an ENCRYPTION_SECRET rotation, and selecting the
 * encrypted column would decrypt it on every poll.
 */
const PUBLIC_SELECT: {
  _id: true;
  projectId: true;
  isEnabled: true;
  rotatedAt: true;
  lastFetchedAt: true;
  fetchCount: true;
  previousTokenExpiresAt: true;
} = {
  _id: true,
  projectId: true,
  isEnabled: true,
  rotatedAt: true,
  lastFetchedAt: true,
  fetchCount: true,
  previousTokenExpiresAt: true,
};

export async function lookupTeamFeed(
  tokenHash: string,
  now: Date,
): Promise<TeamFeedLookup | null> {
  const current: ScheduledMaintenanceCalendarFeed | null =
    await ScheduledMaintenanceCalendarFeedService.findOneBy({
      query: { tokenHash: tokenHash },
      select: PUBLIC_SELECT,
      props: { isRoot: true, ignoreHooks: true },
    });

  if (current) {
    return { feed: current, viaPreviousToken: false };
  }

  const previous: ScheduledMaintenanceCalendarFeed | null =
    await ScheduledMaintenanceCalendarFeedService.findOneBy({
      query: { previousTokenHash: tokenHash },
      select: PUBLIC_SELECT,
      props: { isRoot: true, ignoreHooks: true },
    });

  if (!previous || !isPreviousTokenInGrace(previous, now)) {
    return null;
  }

  return { feed: previous, viaPreviousToken: true };
}

/*
 * The key a link's calendar is kept under: the link, when its token was
 * minted (a regenerated link is a new key) and the UTC day (the window rolls
 * daily). Never the token, nor its hash.
 */
export function getTeamCalendarCacheKey(data: {
  feed: ScheduledMaintenanceCalendarFeed;
  now: Date;
}): string {
  const rotatedAt: string | null = toIso(data.feed.rotatedAt);

  return `team:${data.feed.id?.toString() || ""}:${
    rotatedAt ? new Date(rotatedAt).getTime() : 0
  }:${TeamMaintenanceCalendar.getDayBucket(data.now)}`;
}

/*
 * Fire-and-forget bookkeeping after a served GET: when, by which kind of
 * app, how often (approximate under concurrency, on purpose). At most once
 * per five minutes per link, never for a HEAD, never thrown into the route.
 */
function recordFetch(data: {
  feed: ScheduledMaintenanceCalendarFeed;
  req: ExpressRequest;
  now: Date;
}): void {
  if (
    !data.feed.id ||
    !shouldRecordFetch({
      method: data.req.method,
      lastFetchedAt: data.feed.lastFetchedAt,
      now: data.now,
    })
  ) {
    return;
  }

  const client: string | null = classifyCalendarClient(
    data.req.headers?.["user-agent"] as string | Array<string> | undefined,
  );

  const previousCount: number =
    typeof data.feed.fetchCount === "number" &&
    Number.isFinite(data.feed.fetchCount)
      ? data.feed.fetchCount
      : 0;

  const id: ObjectID = data.feed.id;

  ScheduledMaintenanceCalendarFeedService.updateOneById({
    id: id,
    data: {
      lastFetchedAt: data.now,
      lastFetchedClient: client || "Other",
      fetchCount: previousCount + 1,
    },
    props: { isRoot: true, ignoreHooks: true },
  }).catch((err: unknown) => {
    logger.warn(
      `ScheduledMaintenanceCalendarAPI: bookkeeping for calendar link ${id.toString()} failed.`,
    );
    logger.warn(err);
  });
}

// -- Public route -----------------------------------------------------------

router.get(
  TEAM_FEED_ROUTE,
  OnCallCalendarFeedRateLimit.getMiddleware(),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token: unknown = req.params?.["token"];

      if (!CalendarFeedToken.isValidShape(token)) {
        return sendNotFound(req, res);
      }

      const now: Date = OneUptimeDate.getCurrentDate();

      const lookup: TeamFeedLookup | null = await lookupTeamFeed(
        CalendarFeedToken.hash(token),
        now,
      );

      if (!lookup || !lookup.feed.id || !lookup.feed.projectId) {
        return sendNotFound(req, res);
      }

      let calendar: RenderedMaintenanceCalendar;

      if (lookup.viaPreviousToken) {
        calendar = await TeamMaintenanceCalendar.renderEmpty({
          projectId: lookup.feed.projectId,
          reason: TEAM_CALENDAR_REPLACED_REASON,
          now: now,
        });
      } else if (lookup.feed.isEnabled === false) {
        calendar = await TeamMaintenanceCalendar.renderEmpty({
          projectId: lookup.feed.projectId,
          reason: TEAM_CALENDAR_TURNED_OFF_REASON,
          now: now,
        });
      } else {
        const projectId: ObjectID = lookup.feed.projectId;

        calendar = (
          await MaintenanceCalendarFeedCache.getOrRender({
            key: getTeamCalendarCacheKey({ feed: lookup.feed, now: now }),
            render: (): Promise<RenderedMaintenanceCalendar> => {
              return TeamMaintenanceCalendar.render({
                projectId: projectId,
                now: now,
              });
            },
          })
        ).calendar;

        // Only a real, current, turned-on link's fetch is worth counting.
        recordFetch({ feed: lookup.feed, req: req, now: now });
      }

      return Response.sendCalendarResponse(req, res, {
        body: calendar.body,
        etag: calendar.etag,
        lastModified: calendar.lastModified,
        fileName: MAINTENANCE_CALENDAR_FILE_NAME,
      });
    } catch (err) {
      next(err);
    }
  },
);

/*
 * After the exact GET route, so it still wins, and before the session
 * routes, whose prefix (`project-feed/`) this one does not share.
 */
router.all(TEAM_FEED_FALLBACK_ROUTE, feedFallbackHandler);

// -- Session routes ---------------------------------------------------------

/*
 * The link shows every event of the project, so only a caller who reads
 * every one may see, publish or regenerate it.
 */
export async function assertReadsEveryEvent(
  props: DatabaseCommonInteractionProps,
): Promise<void> {
  const readsEveryEvent: boolean =
    await ScheduledMaintenanceService.readsEveryRecordInProject(props);

  if (!readsEveryEvent) {
    throw new ForbiddenException(READ_EVERY_EVENT_MESSAGE);
  }
}

/*
 * NON-root read with the caller's props: the model's access lists decide
 * whether this caller may see that the link exists at all.
 */
async function findTeamFeedAsCaller(data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<ScheduledMaintenanceCalendarFeed | null> {
  return await ScheduledMaintenanceCalendarFeedService.findOneBy({
    query: {
      projectId: data.projectId,
    },
    select: STATUS_SELECT,
    props: data.props,
  });
}

/*
 * Publish under a per-project lock: the unique index on projectId is the
 * backstop; the lock is what turns a double click into one link rather than
 * one link and one error. Without Redis the index alone has to do.
 */
async function withPublishLock<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  let mutex: SemaphoreMutex | null = null;

  try {
    mutex = await Semaphore.lock({
      key: key,
      namespace: PUBLISH_LOCK_NAMESPACE,
      lockTimeout: PUBLISH_LOCK_TIMEOUT_MS,
    });
  } catch (err) {
    logger.warn(
      "ScheduledMaintenanceCalendarAPI: could not take the publish lock; relying on the unique index.",
    );
    logger.warn(err);
    mutex = null;
  }

  try {
    return await work();
  } finally {
    if (mutex) {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.warn(
          "ScheduledMaintenanceCalendarAPI: releasing the publish lock failed.",
        );
        logger.warn(err);
      }
    }
  }
}

router.get(
  TEAM_FEED_CURRENT_ROUTE,
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

      const feed: ScheduledMaintenanceCalendarFeed | null =
        await findTeamFeedAsCaller({ projectId, props });

      await assertReadsEveryEvent(props);

      const status: MaintenanceCalendarFeedStatus = feed
        ? await buildStatusForRow({ feed })
        : buildAbsentFeedStatus();

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  TEAM_FEED_PUBLISH_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertJsonRequest(req);

      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      await assertReadsEveryEvent(props);

      await withPublishLock(projectId.toString(), async (): Promise<void> => {
        const existing: ScheduledMaintenanceCalendarFeed | null =
          await findTeamFeedAsCaller({ projectId, props });

        if (existing && existing.id) {
          await ScheduledMaintenanceCalendarFeedService.updateOneBy({
            query: { _id: existing.id, projectId: projectId },
            data: { isEnabled: true },
            props: props,
          });

          return;
        }

        const model: ScheduledMaintenanceCalendarFeed =
          new ScheduledMaintenanceCalendarFeed();
        model.projectId = projectId;

        await ScheduledMaintenanceCalendarFeedService.create({
          data: model,
          props: props,
        });
      });

      const feed: ScheduledMaintenanceCalendarFeed | null =
        await findTeamFeedAsCaller({ projectId, props });

      if (!feed) {
        throw new NotFoundException(NO_TEAM_FEED_MESSAGE);
      }

      const status: MaintenanceCalendarFeedStatus = await buildStatusForRow({
        feed,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  TEAM_FEED_ROTATE_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      assertJsonRequest(req);

      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      await assertReadsEveryEvent(props);

      const existing: ScheduledMaintenanceCalendarFeed | null =
        await findTeamFeedAsCaller({ projectId, props });

      if (!existing || !existing.id) {
        throw new NotFoundException(NO_TEAM_FEED_MESSAGE);
      }

      /*
       * A write with the caller's props, of what the row already holds: it
       * is what proves the caller may edit the link before the root
       * rotation below does what they asked.
       */
      await ScheduledMaintenanceCalendarFeedService.updateOneBy({
        query: { _id: existing.id, projectId: projectId },
        data: { isEnabled: existing.isEnabled !== false },
        props: props,
      });

      const rotation: CalendarFeedRotation =
        await ScheduledMaintenanceCalendarFeedService.rotateTokenById({
          id: existing.id,
        });

      const feed: ScheduledMaintenanceCalendarFeed | null =
        await findTeamFeedAsCaller({ projectId, props });

      if (!feed) {
        throw new NotFoundException(NO_TEAM_FEED_MESSAGE);
      }

      const status: MaintenanceCalendarFeedStatus = await buildStatusForRow({
        feed,
        plaintextToken: rotation.token,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
