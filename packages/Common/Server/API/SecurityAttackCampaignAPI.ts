import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SECURITY_ATTACK_CAMPAIGNS_MAX,
  SECURITY_ATTACK_CAMPAIGNS_MAX_DAYS,
  SecurityAttackCampaign,
  SecurityAttackCampaignsResult,
} from "../../Types/SecurityEvent/SecurityAttackCampaign";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityEventService from "../Services/SecurityEventService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import TelemetryReadAccess from "../Utils/Telemetry/TelemetryReadAccess";
import CommonAPI from "./CommonAPI";

/*
 * POST /security-event/attack-campaigns - the Campaigns page's one read:
 * the project's web attacks over a window, one row per address that sent
 * them, worst first (SecurityEventService.findAttackCampaigns).
 *
 * Takes the right to read security events, like every other read of them,
 * and counts only the events of the sources the caller may read
 * (TelemetryReadAccess): a Security role scoped to the sources it owns, or
 * to some labels, sees the attacks on those sources alone. The window is
 * the page's: at most SECURITY_ATTACK_CAMPAIGNS_MAX_DAYS long, ending no
 * later than now; without one, the last seven days.
 */

export const DEFAULT_CAMPAIGN_WINDOW_IN_DAYS: number = 7;

/*
 * A window is a span of time, not of calendar days: across a change of the
 * clocks a calendar week is an hour longer or shorter than seven days.
 */
const DAY_MS: number = 24 * 60 * 60 * 1000;

function readDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function readCampaignWindow(
  body: JSONObject,
  now: Date,
): { startTime: Date; endTime: Date } {
  const requestedEnd: Date | null = readDate(body["endTime"]);
  const endTime: Date =
    requestedEnd && requestedEnd.getTime() < now.getTime() ? requestedEnd : now;
  const requestedStart: Date | null = readDate(body["startTime"]);
  const earliest: Date = new Date(
    endTime.getTime() - SECURITY_ATTACK_CAMPAIGNS_MAX_DAYS * DAY_MS,
  );

  let startTime: Date =
    requestedStart ||
    new Date(endTime.getTime() - DEFAULT_CAMPAIGN_WINDOW_IN_DAYS * DAY_MS);

  if (startTime.getTime() >= endTime.getTime()) {
    throw new BadDataException("The window's start must be before its end.");
  }

  if (startTime.getTime() < earliest.getTime()) {
    startTime = earliest;
  }

  return { startTime, endTime };
}

export default class SecurityAttackCampaignAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/security-event/attack-campaigns",
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

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: new SecurityEvent().getReadPermissions(),
            errorMessage:
              "Reading security events takes a Security role, or Project Owner or Project Admin.",
          });

          const body: JSONObject =
            req.body && typeof req.body === "object"
              ? (req.body as JSONObject)
              : {};
          const range: { startTime: Date; endTime: Date } = readCampaignWindow(
            body,
            OneUptimeDate.getCurrentDate(),
          );

          const campaigns: Array<SecurityAttackCampaign> =
            await SecurityEventService.findAttackCampaigns({
              projectId,
              startTime: range.startTime,
              endTime: range.endTime,
              limit: SECURITY_ATTACK_CAMPAIGNS_MAX,
              serviceFilter: await TelemetryReadAccess.getServiceFilter({
                modelType: SecurityEvent,
                props,
              }),
            });

          const result: SecurityAttackCampaignsResult = {
            campaigns: campaigns.slice(0, SECURITY_ATTACK_CAMPAIGNS_MAX),
            startTime: range.startTime.toISOString(),
            endTime: range.endTime.toISOString(),
            isTruncated: campaigns.length > SECURITY_ATTACK_CAMPAIGNS_MAX,
          };

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    return router;
  }
}
