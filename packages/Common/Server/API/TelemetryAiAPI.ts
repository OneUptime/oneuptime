import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import TelemetryAiActivityReader from "../Utils/AI/TelemetryAi/TelemetryAiActivityReader";
import TelemetryAiPersonFix from "../Utils/AI/TelemetryAi/TelemetryAiPersonFix";
import { TelemetryAiLane, isTelemetryAiLane } from "../../Types/AI/TelemetryAi";
import {
  TELEMETRY_AI_FIX_PATH,
  TELEMETRY_AI_FIX_SUGGESTION_PATH,
  TELEMETRY_AI_LOGS_PAGE_SIZE,
  TELEMETRY_AI_LOGS_PATH,
  TELEMETRY_AI_READINESS_PATH,
  TelemetryAiLogsJSON,
  TelemetryAiReadinessJSON,
} from "../../Types/AI/TelemetryAiActivity";
import {
  TelemetryAiFixSuggestion,
  telemetryAiFixSuggestionToJSON,
} from "../../Utils/Suggestions/TelemetryAiFixSuggestion";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

const router: ExpressRouter = Express.getRouter();

/*
 * The custom calls behind the AI section of a telemetry product's menu - the
 * Profiler's first (Types/AI/TelemetryAi). Its Insights page lists the
 * lane's AI insights with the ordinary AIInsight list, and its Settings
 * page's switch and AI rules are ordinary CRUD on the Project and on
 * AutoRemediationRule.
 *
 *   POST /telemetry-ai/readiness   { lane }
 *     Whether OneUptime AI can open pull requests for the lane's problems
 *     now, and the first thing to do when it cannot
 *     (TelemetryAiReadinessJSON): for any signed-in member of the project.
 *
 *   POST /telemetry-ai/logs   { lane, skip? }
 *     What OneUptime AI did with the lane's problems, newest first, a page
 *     at a time (TelemetryAiLogsJSON): only about problems the caller may
 *     read (TelemetryAiActivityReader).
 *
 *   POST /telemetry-ai/fix-suggestion   { insightId }
 *     What "Fix with AI" offers on one of the lane's findings
 *     (TelemetryAiFixSuggestion): decided by the gates the next route
 *     checks, under the caller's own permissions (TelemetryAiPersonFix).
 *
 *   POST /telemetry-ai/fix   { insightId, repositoryId? }
 *     The pull request that finding asks for: a Code task the caller
 *     starts, in the repository that holds the code - or the one they
 *     picked, when none was found for certain. Response: { taskId }.
 */

// The most entries a page may start after: older ones are not paged to.
export const TELEMETRY_AI_LOGS_MAX_SKIP: number = 10000;

/*
 * A signed-in user, inside exactly one project: the tenant the request is
 * authenticated for.
 */
async function getTenantProps(req: ExpressRequest): Promise<{
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  CommonAPI.assertAuthenticatedUser(props);

  const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

  return { projectId, props: { ...props, isMultiTenantRequest: false } };
}

function readBody(body: unknown): JSONObject {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

// The lane a request names; anything else is refused.
export function parseTelemetryAiLane(body: unknown): TelemetryAiLane {
  const lane: unknown = readBody(body)["lane"];

  if (!isTelemetryAiLane(lane)) {
    throw new BadDataException(
      `lane must be one of: ${Object.values(TelemetryAiLane).join(", ")}.`,
    );
  }

  return lane;
}

// The finding a fix request names: an insight's id, always.
export function parseTelemetryAiFixInsightId(body: unknown): ObjectID {
  const insightId: unknown = readBody(body)["insightId"];

  if (typeof insightId !== "string" || !ObjectID.isValidUUID(insightId)) {
    throw new BadDataException("insightId must be an insight's ID.");
  }

  return new ObjectID(insightId);
}

// The repository a person picked, when the body names one.
export function parseTelemetryAiFixRepositoryId(
  body: unknown,
): ObjectID | undefined {
  const repositoryId: unknown = readBody(body)["repositoryId"];

  if (repositoryId === undefined || repositoryId === null) {
    return undefined;
  }

  if (typeof repositoryId !== "string" || !ObjectID.isValidUUID(repositoryId)) {
    throw new BadDataException("repositoryId must be a repository's ID.");
  }

  return new ObjectID(repositoryId);
}

// Where a logs page starts: 0 when the body does not say.
export function parseTelemetryAiLogsSkip(body: unknown): number {
  const skip: unknown = readBody(body)["skip"];

  if (skip === undefined || skip === null) {
    return 0;
  }

  if (
    typeof skip !== "number" ||
    !Number.isInteger(skip) ||
    skip < 0 ||
    skip > TELEMETRY_AI_LOGS_MAX_SKIP
  ) {
    throw new BadDataException(
      `skip must be a whole number from 0 to ${TELEMETRY_AI_LOGS_MAX_SKIP}.`,
    );
  }

  return skip;
}

router.post(
  TELEMETRY_AI_READINESS_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { projectId }: { projectId: ObjectID } = await getTenantProps(req);
      const lane: TelemetryAiLane = parseTelemetryAiLane(req.body);

      const readiness: TelemetryAiReadinessJSON =
        await TelemetryAiActivityReader.readReadiness({ projectId, lane });

      Response.sendJsonObjectResponse(
        req,
        res,
        readiness as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  TELEMETRY_AI_LOGS_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const {
        projectId,
        props,
      }: { projectId: ObjectID; props: DatabaseCommonInteractionProps } =
        await getTenantProps(req);
      const lane: TelemetryAiLane = parseTelemetryAiLane(req.body);
      const skip: number = parseTelemetryAiLogsSkip(req.body);

      const logs: TelemetryAiLogsJSON =
        await TelemetryAiActivityReader.readLogs({
          projectId,
          lane,
          props,
          skip,
          limit: TELEMETRY_AI_LOGS_PAGE_SIZE,
        });

      Response.sendJsonObjectResponse(req, res, logs as unknown as JSONObject);
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  TELEMETRY_AI_FIX_SUGGESTION_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const {
        projectId,
        props,
      }: { projectId: ObjectID; props: DatabaseCommonInteractionProps } =
        await getTenantProps(req);
      const insightId: ObjectID = parseTelemetryAiFixInsightId(req.body);

      const suggestion: TelemetryAiFixSuggestion =
        await TelemetryAiPersonFix.getSuggestion({
          projectId,
          insightId,
          props,
        });

      Response.sendJsonObjectResponse(
        req,
        res,
        telemetryAiFixSuggestionToJSON(suggestion),
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  TELEMETRY_AI_FIX_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const {
        projectId,
        props,
      }: { projectId: ObjectID; props: DatabaseCommonInteractionProps } =
        await getTenantProps(req);
      const insightId: ObjectID = parseTelemetryAiFixInsightId(req.body);
      const repositoryId: ObjectID | undefined =
        parseTelemetryAiFixRepositoryId(req.body);

      const created: { taskId: string } =
        await TelemetryAiPersonFix.createFixTask({
          projectId,
          insightId,
          userId: props.userId!,
          props,
          ...(repositoryId ? { repositoryId } : {}),
        });

      Response.sendJsonObjectResponse(req, res, { taskId: created.taskId });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
