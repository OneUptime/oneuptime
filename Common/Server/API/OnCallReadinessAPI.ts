import UserMiddleware from "../Middleware/UserAuthorization";
import OnCallReadinessService, {
  ReadinessCoverageCell,
  ReadinessMethod,
  ReadinessSummary,
  ReadinessTeam,
  UserReadiness,
} from "../Services/OnCallReadinessService";
import OnCallDutyPolicyService from "../Services/OnCallDutyPolicyService";
import OnCallSetupReminderService, {
  SetupReminderResult,
  SetupReminderUserResult,
} from "../Services/OnCallSetupReminderService";
import TeamMemberService from "../Services/TeamMemberService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserPermission } from "../../Types/Permission";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import TeamMember from "../../Models/DatabaseModels/TeamMember";

/*
 * "Can this responder actually be paged?" answered over HTTP, for one policy,
 * one project, or one user. Everything the routes below return is computed by
 * OnCallReadinessService; this file is transport and authorisation only, and
 * deliberately holds no readiness logic of its own so the API and any in-process
 * caller (TeamComplianceService, the on-call banner) can never disagree.
 *
 * Why a plain ExpressRouter rather than `extends BaseAPI`:
 *
 * The obvious model for this file, TeamComplianceAPI, does
 * `class TeamComplianceAPI extends BaseAPI<Team, TeamServiceType>` and calls
 * `super(Team, TeamService)` purely to inherit `this.router`. That side effect
 * is not free: the BaseAPI constructor registers the ENTIRE Team CRUD route set
 * (list, get, count, create, update, delete) onto that router. Team is already
 * registered independently at App/FeatureSet/BaseAPI/Index.ts:2884, and Express
 * dispatches to whichever matching handler was `app.use`d first, so the second
 * copy is dead code that exists only to be shadowed - and it would quietly stop
 * being dead the day the mount order changed. Readiness is not a CRUD model at
 * all, so there is nothing to inherit here even in principle. AIReadinessAPI
 * (Common/Server/API/AIReadinessAPI.ts) is the pattern this follows instead: a
 * bare router, exported as the router itself, mounted with
 * `app.use(prefix, OnCallReadinessAPI)`.
 *
 * Authorisation, on every route:
 *
 * These endpoints deliberately disclose ONE USER'S CONFIGURATION TO ANOTHER -
 * which channels they have, which severities they are covered for. That is the
 * whole point (an owner has to be able to see who cannot be reached), but it
 * means the usual "the model's TableAccessControl will catch it" reasoning does
 * not apply: OnCallReadinessService reads with `isRoot: true`, so these handlers
 * are the only gate underneath. UserMiddleware.getUserMiddleware is NOT that
 * gate - it admits anonymous callers as UserType.Public and calls next(), and
 * the tenant id it attaches comes straight off the caller-supplied `tenantid`
 * header before any authorisation runs. So each route asserts, itself:
 *
 *   1. the caller is a logged-in member of the project it named
 *      (CommonAPI.assertAuthenticatedProjectMember), and
 *   2. the resource in the path - the policy, or the user - actually belongs to
 *      that same project, because otherwise a member of project A reads project
 *      B's data simply by sending their own `tenantid` header alongside a
 *      borrowed id.
 *
 * OnCallReadinessService guards its own reads too - getReadinessForPolicy
 * rejects a policy from another project, getReadinessForUser rejects a user who
 * is not a member of one - and the checks here deliberately duplicate that.
 * They are not redundant belt-and-braces for its own sake: the service's guards
 * are data-scoping guards that answer with BadDataException (a 400), whereas a
 * member of project A reaching for project B's policy id is an authorisation
 * failure and should be answered as one. More to the point, an endpoint's
 * authorisation should be legible in the endpoint. If the service later relaxes
 * its guard for a legitimate internal caller - a preview for a user not yet
 * added to the project, say - these routes must not quietly become a
 * cross-project probe as a side effect. The cost is one primary-key lookup on a
 * request that is about to do considerably more work than that.
 *
 * Identifiers are masked by the service, before they ever reach this file, and
 * the serialisers below copy `maskedIdentifier` and nothing else. There is no
 * "unmask for self" branch anywhere: the contract carries no raw field to
 * populate, so a future change would have to widen the contract in the open
 * rather than slip a raw phone number through a boolean flag.
 *
 * The two summary routes are PAGED - see READINESS_PAGE_SIZE_DEFAULT below for
 * why, and for the rule that keeps a paged answer from lying about the whole.
 *
 * THE ONE ROUTE THAT IS NOT A READ:
 *
 * /on-call-readiness/send-setup-reminder is a POST that sends branded email to
 * real people, and it therefore carries a HIGHER bar than its read siblings -
 * see SETUP_REMINDER_PERMISSIONS below. Membership was the original bar and it
 * was the wrong one: `assertAuthenticatedProjectMember` proves only that the
 * caller has SOME access entry for the project, which every read-only Viewer
 * has, so anyone who could look at the readiness table could also make the
 * product mail their colleagues in the project's name. Disclosure and action are
 * different questions, and this route is the only one here that answers the
 * second.
 */
const router: ExpressRouter = Express.getRouter();

/*
 * Paging, and the one rule that makes it safe.
 *
 * A summary carries one UserReadiness per responder, and each of those carries a
 * coverage cell per (rule type, severity) pair: four rule types against, say,
 * eight incident and eight alert severities is 32 cells with a name and two ids
 * apiece. That is a few kilobytes per responder, so a project with a few
 * thousand responders serialises to tens of megabytes of JSON - built in memory,
 * on every page load, by a service that also caches it. Nobody reads a table of
 * five thousand rows in one screen, so the wire format should not pretend
 * otherwise.
 *
 * THE RULE: the response is bounded, but the FACTS ARE NOT. readyCount,
 * partiallyReadyCount and notReachableCount always describe the entire scope,
 * never the page, and `totalCount` states how many responders the scope holds so
 * a client can always see that it is holding part of a list. This is the
 * difference between a paged answer and a truncated one, and it is the whole
 * reason the counts are computed by the service rather than derived by the
 * client from `users.length`: a UI that counted the rows it received would put a
 * reassuring "3 not reachable" under a page that happened to contain three, in a
 * project with forty.
 *
 * Ordering is what makes the FIRST page the useful one: the service sorts
 * most-broken-first (NotReachable, then PartiallyReady, then Ready), so page one
 * of a paged response holds the responders somebody needs to act on, and the
 * rows that fall off the end are the healthy ones.
 *
 * A `limit` above the maximum is REFUSED rather than clamped. Silently returning
 * 500 rows to a caller who asked for 5,000 is precisely the failure this feature
 * exists to prevent - a client cannot tell a short page from a complete list -
 * so the caller is told the ceiling and asked to page.
 */
const READINESS_PAGE_SIZE_DEFAULT: number = 100;
const READINESS_PAGE_SIZE_MAX: number = 500;

interface ReadinessPageRequest {
  limit: number;
  skip: number;
}

/**
 * The wire shape of a paged summary. Exported so the dashboard can derive its
 * own types from it rather than hand-copying the field names, the way
 * ReadinessTypes.ts already derives from the service's contract.
 */
export interface ReadinessSummaryPageWire {
  projectId: string;
  onCallDutyPolicyId?: string | undefined;
  /** Whole-scope counts. Never the page's. */
  readyCount: number;
  partiallyReadyCount: number;
  notReachableCount: number;
  /**
   * Whether a page with no matching rule falls back to the responder's verified
   * methods, or is dropped. Carried on the wire because a UI that tells an admin
   * "those pages still reach them through the fallback" must stop saying so for
   * a project that has the fallback switched off - which is the moment the
   * sentence stops being reassuring and starts being false.
   */
  isFallbackEnabled: boolean;
  /**
   * TRUE means the SCOPE was truncated before it was paged - a read behind the
   * summary hit its ceiling - so responders may be missing from it entirely and
   * `totalCount` is a floor rather than a total. Distinct from `hasMore`, which
   * merely says there are further pages of a complete answer.
   */
  isTruncated: boolean;
  /**
   * Responders in the whole scope, so a client can always see that it is holding
   * part of a list. A lower bound when isTruncated is true.
   */
  totalCount: number;
  limit: number;
  skip: number;
  hasMore: boolean;
  users: Array<JSONObject>;
}

/*
 * Digits and nothing else. No sign, no decimal point, no trailing units: a page
 * parameter is a count of rows.
 */
const WHOLE_NUMBER: RegExp = /^\d+$/;

/*
 * Query parameters are strings from an untrusted caller. parseInt("12abc") is
 * 12 and parseInt("abc") is NaN, and both would otherwise become a page size, so
 * the value is required to be nothing but digits before it is believed.
 */
function readPositiveIntegerParam(
  req: ExpressRequest,
  name: string,
  fallback: number,
): number {
  const raw: string | undefined = req.query[name] as string | undefined;

  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  if (!WHOLE_NUMBER.test(raw)) {
    throw new BadDataException(
      `${name} must be a whole number. Received: "${raw}".`,
    );
  }

  return parseInt(raw, 10);
}

/*
 * An explicit refresh must actually re-read.
 *
 * The service answers from a 60s in-process cache, which is right for the
 * ordinary case - several surfaces ask the same question on one screen. It is
 * wrong for the one interaction where the user has just CHANGED the answer: a
 * responder verifies a device while an admin watches, the admin presses
 * Recheck, and a cached summary redraws them as still unreachable. The admin
 * concludes the fix did not work.
 *
 * `?refresh=true` drops this replica's cache before recomputing. It is a
 * deliberate, user-initiated cost, and it is bounded by the same authorisation
 * as the read itself, so it cannot be used to force recomputation on a project
 * the caller cannot already read. Each replica clears only its own copy; the
 * TTL remains the only cross-process guarantee.
 */
function isRefreshRequested(req: ExpressRequest): boolean {
  const raw: string | undefined = (req.query as Record<string, unknown>)[
    "refresh"
  ] as string | undefined;

  if (raw === undefined || raw === null) {
    return false;
  }

  const normalized: string = String(raw).trim().toLowerCase();

  return normalized === "true" || normalized === "1";
}

function readPageRequest(req: ExpressRequest): ReadinessPageRequest {
  const limit: number = readPositiveIntegerParam(
    req,
    "limit",
    READINESS_PAGE_SIZE_DEFAULT,
  );
  const skip: number = readPositiveIntegerParam(req, "skip", 0);

  if (limit < 1 || limit > READINESS_PAGE_SIZE_MAX) {
    throw new BadDataException(
      `limit must be between 1 and ${READINESS_PAGE_SIZE_MAX}. Ask for the next page with skip instead.`,
    );
  }

  return {
    limit: limit,
    skip: skip,
  };
}

/*
 * Project membership for the user NAMED IN THE PATH (not the caller). Without
 * this, /on-call-readiness/user/:userId is a cross-project probe: the readiness
 * queries are all projectId-scoped and would come back empty for a stranger,
 * but the summary still carries that stranger's name and login email, read from
 * the User table where no project scoping exists. TeamMember is the membership
 * table for a project - even the creating owner gets a row
 * (ProjectService.ts:1853) - so its absence is a definitive "not in this
 * project".
 *
 * Invitation state is deliberately not part of the query, matching the check
 * OnCallReadinessService.getReadinessForUser makes for the same reason. A user
 * with a pending invitation can already be selected onto an escalation rule, and
 * "is this person reachable?" is exactly the question worth asking about them;
 * requiring hasAcceptedInvitation would refuse the readiness read for the
 * responders most likely to be misconfigured.
 *
 * The rejection reuses assertResourceBelongsToProject's wording verbatim so a
 * caller cannot tell "this user exists but is in another project" apart from
 * "this user does not exist", and therefore cannot enumerate users through it.
 */
async function assertUserBelongsToProject(
  userId: ObjectID,
  projectId: ObjectID,
): Promise<void> {
  const memberships: Array<TeamMember> = await TeamMemberService.findBy({
    query: {
      userId: userId,
      projectId: projectId,
    },
    select: {
      _id: true,
    },
    limit: 1,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  if (memberships.length === 0) {
    throw new NotAuthorizedException(
      "You are not authorized to access this project's data.",
    );
  }
}

/*
 * Who may make the product send mail in this project's name.
 *
 * The action is "manage on-call", so the granular permission that means exactly
 * that - EditProjectOnCallDutyPolicy, the one that lets somebody change who gets
 * paged - is the permission this asks for. The two project roles and the on-call
 * role are listed ALONGSIDE it rather than being expanded into it because
 * OneUptime's teams hold ROLES, not granular permissions: a project created
 * before this feature existed has an owner whose team carries ProjectOwner and
 * nothing more granular, and a gate that named only the granular permission
 * would lock every existing project's owner out of their own button.
 *
 * Deliberately NOT here:
 *
 *   - ProjectMember and Viewer, which is the whole point of the change. Both can
 *     read the readiness table, and reading who is unreachable is a different
 *     act from mailing them about it under the project's branding.
 *   - OnCallMember and OnCallViewer. The on-call tiers below Admin are for
 *     people who are ON call, not people who administer it.
 *
 * The read routes keep the membership bar: they disclose configuration to
 * somebody who is already inside the project, which is what the feature is for.
 */
const SETUP_REMINDER_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.OnCallAdmin,
  Permission.EditProjectOnCallDutyPolicy,
];

/*
 * The permission check, read the way the rest of the API reads permissions.
 *
 * getUserPermissions(Allow) rather than `userTenantAccessPermission[...]`
 * directly, and that is not a stylistic preference. That dictionary's entries
 * hold GRANTS AND DENIALS in one array, discriminated only by
 * `isBlockPermission`; mapping it raw would count a team's explicit BLOCK of
 * ProjectAdmin as a grant of ProjectAdmin, so the admin action that restricts a
 * team would be the thing that handed it this endpoint. The helper filters by
 * type and scopes to props.tenantId, which is the same project
 * assertAuthenticatedProjectMember just authorised the caller for.
 *
 * The refusal reuses the router's single refusal sentence verbatim, so an
 * under-privileged member cannot tell "you may not do this" apart from "you are
 * not in this project" and use the difference to probe.
 */
function assertCanSendSetupReminders(
  databaseProps: DatabaseCommonInteractionProps,
): void {
  if (databaseProps.isMasterAdmin) {
    return;
  }

  const permissions: Array<Permission> =
    DatabaseCommonInteractionPropsUtil.getUserPermissions(
      databaseProps,
      PermissionType.Allow,
    ).map((userPermission: UserPermission): Permission => {
      return userPermission.permission;
    });

  const isAllowed: boolean = permissions.some(
    (permission: Permission): boolean => {
      return SETUP_REMINDER_PERMISSIONS.includes(permission);
    },
  );

  if (!isAllowed) {
    throw new NotAuthorizedException(
      "You are not authorized to access this project's data.",
    );
  }
}

/*
 * ObjectID's constructor accepts any string, so an unparseable path segment
 * would otherwise travel all the way to a query that matches nothing and read
 * as "this policy has no responders" rather than "you sent nonsense".
 */
function readObjectIdParam(req: ExpressRequest, name: string): ObjectID {
  const raw: string = (req.params[name] as string) || "";
  ObjectID.validateUUID(raw);
  return new ObjectID(raw);
}

/*
 * The `userIds` array from a POST body, validated before it is believed.
 *
 * A request body is a bag of JSON from an untrusted caller, so every layer of
 * this is checked rather than asserted: that the field is there, that it is an
 * array, that each element is a string, and that each string is a UUID.
 * ObjectID's constructor accepts ANY string, so skipping the last check would
 * push arbitrary caller text into a database query - and, in this case, into the
 * "not a member of this project" branch of a mail-sending service, where it
 * would look exactly like an ordinary stale id rather than like nonsense.
 *
 * The ceiling is enforced in the service rather than here, because the service
 * is what the ceiling protects and it must hold for every caller. This route
 * only has to hand it a well-formed list.
 */
function readUserIdsFromBody(req: ExpressRequest): Array<ObjectID> {
  const body: JSONObject = (req.body || {}) as JSONObject;

  const raw: unknown = body["userIds"];

  if (!Array.isArray(raw)) {
    throw new BadDataException(
      "userIds is required and must be an array of user ids.",
    );
  }

  return raw.map((value: unknown): ObjectID => {
    if (typeof value !== "string") {
      throw new BadDataException(
        "Every entry in userIds must be a user id string.",
      );
    }

    ObjectID.validateUUID(value);

    return new ObjectID(value);
  });
}

/*
 * ObjectID.toJSON() serialises to `{ _type: "ObjectID", value: "..." }`, which
 * is right for model payloads the client parses back through JSONFunctions but
 * wrong for a hand-rolled response body. These serialisers flatten every id to
 * a plain string, the same way TeamComplianceAPI does, so the browser can read
 * `userId` without knowing about ObjectID at all.
 */
function serializeMethod(method: ReadinessMethod): JSONObject {
  return {
    /*
     * The id of the METHOD ROW, flattened like every other id here.
     *
     * It is not sensitive - it is already the foreign key stored on any rule its
     * owner created - and it is the whole reason an administrator can POINT A
     * RULE AT a method without READING that method's row. The seven method
     * models stay scoped to their owner precisely so the raw phone number,
     * webhook url, device token and chat id behind them never leave the server;
     * the dropdown an admin uses is built from this id plus the mask below.
     *
     * Dropping it does not fail loudly. The payload still looks well-formed and
     * the readiness page still renders - only the admin's rule form quietly has
     * nothing to submit. A merge did exactly that, which is why the API test
     * asserts this field's presence and that it is the METHOD row's id rather
     * than the user's or the rule's.
     */
    methodId: method.methodId.toString(),
    methodType: method.methodType,
    // Masked upstream. Never widened here, for any caller, including self.
    maskedIdentifier: method.maskedIdentifier,
    isVerified: method.isVerified,
  };
}

function serializeCoverageCell(cell: ReadinessCoverageCell): JSONObject {
  return {
    ruleType: cell.ruleType,
    /*
     * Undefined rather than absent for the two go-on-call / go-off-call rule
     * types, which are not per-severity at all. The client renders one row per
     * cell and needs to be able to tell "this cell has no severity" from "the
     * severity failed to load".
     */
    severityId: cell.severityId ? cell.severityId.toString() : undefined,
    severityName: cell.severityName,
    hasRule: cell.hasRule,
    isOptOut: cell.isOptOut,
  };
}

function serializeUserReadiness(readiness: UserReadiness): JSONObject {
  return {
    userId: readiness.userId.toString(),
    userName: readiness.userName,
    userEmail: readiness.userEmail,
    userProfilePictureId: readiness.userProfilePictureId
      ? readiness.userProfilePictureId.toString()
      : undefined,
    status: readiness.status,
    methods: readiness.methods.map(serializeMethod),
    coverage: readiness.coverage.map(serializeCoverageCell),
    reasons: readiness.reasons,
    reachedVia: readiness.reachedVia,
    /*
     * The teams that page this responder, ids flattened to strings like every other id
     * here. A team name is already readable by any project member through the team list,
     * so nothing is disclosed by naming it — and naming it is what lets the readiness
     * table offer a team filter whose options a reader can actually recognise.
     */
    teams: readiness.teams.map((team: ReadinessTeam): JSONObject => {
      return {
        _id: team._id.toString(),
        name: team.name,
      };
    }),
  };
}

/*
 * One page of a summary. `users` is sliced; nothing else is. See
 * READINESS_PAGE_SIZE_DEFAULT for why the counts stay whole-scope.
 */
function serializeSummaryPage(
  summary: ReadinessSummary,
  page: ReadinessPageRequest,
): JSONObject {
  const totalCount: number = summary.users.length;
  const pagedUsers: Array<UserReadiness> = summary.users.slice(
    page.skip,
    page.skip + page.limit,
  );

  const wire: ReadinessSummaryPageWire = {
    projectId: summary.projectId.toString(),
    onCallDutyPolicyId: summary.onCallDutyPolicyId
      ? summary.onCallDutyPolicyId.toString()
      : undefined,
    readyCount: summary.readyCount,
    partiallyReadyCount: summary.partiallyReadyCount,
    notReachableCount: summary.notReachableCount,
    /*
     * Both of these are facts about the SCOPE, so they are copied onto every
     * page of it rather than onto the first. A client that fetched page two
     * would otherwise be told the answer is complete and the fallback is on.
     */
    isFallbackEnabled: summary.isFallbackEnabled,
    isTruncated: summary.isTruncated,
    totalCount: totalCount,
    limit: page.limit,
    skip: page.skip,
    /*
     * Stated rather than left to be derived. `skip + users.length < totalCount`
     * is the same arithmetic, but a client that gets it slightly wrong stops
     * paging one page early and silently drops responders - which is the exact
     * failure mode paging was introduced to avoid.
     */
    hasMore: page.skip + pagedUsers.length < totalCount,
    users: pagedUsers.map(serializeUserReadiness),
  };

  return wire as unknown as JSONObject;
}

/**
 * The wire shape of a setup-reminder run. Exported so the dashboard derives its
 * type from the contract rather than hand-copying field names, the same way
 * ReadinessSummaryPageWire is used.
 */
export interface SetupReminderResultWire {
  projectId: string;
  /** Distinct users considered. May be fewer than the ids posted, if they repeated. */
  requestedCount: number;
  sentCount: number;
  /** Every skipped outcome of whatever kind; `results` says which kind, per user. */
  skippedCount: number;
  failedCount: number;
  results: Array<JSONObject>;
}

/*
 * Per user, always - even when everything worked.
 *
 * The counts alone would be enough to render "5 sent, 2 skipped, 1 failed", and
 * that sentence is already far better than a tick. The array is here for the
 * next question the reader has, which is "which one failed?" - and answering
 * that from the client requires the outcome to be attached to an id it can match
 * against the row the admin ticked.
 *
 * `outcome` is the enum's own string, not a boolean or a status code, because
 * the four ways of not being sent are four different things to do next and a UI
 * that cannot tell them apart ends up saying "3 skipped" with no explanation of
 * why - which reads as a malfunction rather than as a throttle working.
 *
 * No user name or address is echoed back. The client already holds both from the
 * readiness payload it was rendering when the admin made the selection, so
 * repeating them here would widen what this endpoint discloses in exchange for
 * nothing.
 */
function serializeSetupReminderUserResult(
  result: SetupReminderUserResult,
): JSONObject {
  return {
    userId: result.userId.toString(),
    outcome: result.outcome,
    message: result.message,
  };
}

function serializeSetupReminderResult(result: SetupReminderResult): JSONObject {
  const wire: SetupReminderResultWire = {
    projectId: result.projectId.toString(),
    requestedCount: result.requestedCount,
    sentCount: result.sentCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    results: result.results.map(serializeSetupReminderUserResult),
  };

  return wire as unknown as JSONObject;
}

/*
 * Readiness for one policy's effective responder set - direct users, team
 * members, schedule-layer users and overrides alike. This is what the policy
 * overview card and the coloured dots on the escalation-rule responder chips
 * read.
 *
 * Paged: `?limit=&skip=`. The chips surface asks about specific responders, so a
 * policy with more responders than one page holds must be paged through before
 * every chip can be dotted - a chip whose user is not in the page it has must
 * render as unknown rather than as ready.
 */
router.get(
  "/on-call-readiness/policy/:policyId",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      if (isRefreshRequested(req)) {
        OnCallReadinessService.clearCache();
      }

      const policyId: ObjectID = readObjectIdParam(req, "policyId");

      const page: ReadinessPageRequest = readPageRequest(req);

      /*
       * The policy id arrives from the caller and the readiness read below runs
       * as root, so the policy's OWN projectId - not the header - is what has to
       * agree with the project the caller was authorised for.
       */
      const policy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: policyId,
          select: {
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: policy?.projectId,
        projectId: projectId,
      });

      const summary: ReadinessSummary =
        await OnCallReadinessService.getReadinessForPolicy(policyId, projectId);

      return Response.sendJsonObjectResponse(
        req,
        res,
        serializeSummaryPage(summary, page),
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Readiness across every policy in the project. Backs the On-Call > Readiness
 * page and the section banner. The project comes from the `tenantid` header
 * rather than the path, which is why assertAuthenticatedProjectMember - which
 * checks the caller against that very header - is the whole authorisation story
 * for this route.
 *
 * Paged: `?limit=&skip=`. This is the widest scope in the product - every
 * responder on every policy - so it is the route that would otherwise serialise
 * a whole project's coverage grid into one response.
 */
router.get(
  "/on-call-readiness/project",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      if (isRefreshRequested(req)) {
        OnCallReadinessService.clearCache();
      }

      const page: ReadinessPageRequest = readPageRequest(req);

      const summary: ReadinessSummary =
        await OnCallReadinessService.getReadinessForProject(projectId);

      return Response.sendJsonObjectResponse(
        req,
        res,
        serializeSummaryPage(summary, page),
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Readiness for a single responder. Used by the add-responder modal, which asks
 * about a user the moment they are picked - before they are on any policy, so
 * this route deliberately does not require the user to be on one.
 */
router.get(
  "/on-call-readiness/user/:userId",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      if (isRefreshRequested(req)) {
        OnCallReadinessService.clearCache();
      }

      const userId: ObjectID = readObjectIdParam(req, "userId");

      await assertUserBelongsToProject(userId, projectId);

      const readiness: UserReadiness =
        await OnCallReadinessService.getReadinessForUser(userId, projectId);

      return Response.sendJsonObjectResponse(
        req,
        res,
        serializeUserReadiness(readiness),
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Ask a set of responders to finish their own notification setup.
 *
 * The only WRITE on this router, and the only thing in the readiness feature
 * that reaches outside the product. It exists because the gaps this feature
 * reports are not gaps an admin can close: a notification method lives on the
 * responder's own account and has to be verified by them, so "tell them" is
 * genuinely the whole of the available fix.
 *
 * Everything about who is mailed, what the mail says and whether it is sent at
 * all belongs to OnCallSetupReminderService - including the re-check that each
 * id is a member of this project, which is duplicated there on purpose so the
 * service is safe for any caller and not only for this route.
 *
 * Two gates, in this order: membership (which project is this, and is the caller
 * in it) and then permission (may they act in it). Both run before the body is
 * read, because a route that validates a payload for a caller it is about to
 * refuse has told that caller something about the payload format.
 *
 * The response is a PER-USER array, never a bare success. A caller that ticked
 * eight responders and got a 200 back has no idea that two were reminded this
 * morning and one has no address on file, and a UI that renders a green tick
 * over that has told its user something false about whether a page will reach
 * somebody. See serializeSetupReminderResult.
 */
router.post(
  "/on-call-readiness/send-setup-reminder",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      assertCanSendSetupReminders(databaseProps);

      const userIds: Array<ObjectID> = readUserIdsFromBody(req);

      const result: SetupReminderResult =
        await OnCallSetupReminderService.sendSetupReminders({
          projectId: projectId,
          userIds: userIds,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        serializeSetupReminderResult(result),
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
