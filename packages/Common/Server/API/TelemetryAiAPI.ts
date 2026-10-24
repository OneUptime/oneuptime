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
import { TelemetryAiLane, isTelemetryAiLane } from "../../Types/AI/TelemetryAi";
import {
  TELEMETRY_AI_LOGS_PAGE_SIZE,
  TELEMETRY_AI_LOGS_PATH,
  TELEMETRY_AI_READINESS_PATH,
  TelemetryAiLogsJSON,
  TelemetryAiReadinessJSON,
} from "../../Types/AI/TelemetryAiActivity";
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

export default router;
