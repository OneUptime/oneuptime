import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import IncidentAlertAiLogsReader from "../Utils/AI/IncidentAlertActivity/IncidentAlertAiLogsReader";
import {
  INCIDENT_ALERT_AI_LOGS_PATHS,
  INCIDENT_ALERT_AI_LOG_KINDS,
  INCIDENT_ALERT_AI_SUBJECT_KINDS,
  IncidentAlertAiLogKind,
  IncidentAlertAiLogs,
  IncidentAlertAiSubjectKind,
} from "../../Types/AI/IncidentAlertAiLogs";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

const router: ExpressRouter = Express.getRouter();

/*
 * The custom calls behind the AI section of the Incidents and Alerts menus.
 * Its Settings and Auto Remediation Rules pages are ordinary CRUD on the
 * Project and on AutoRemediationRule.
 *
 *   POST /ai-activity/incident/logs   { before?, kinds? }
 *   POST /ai-activity/alert/logs      { before?, kinds? }
 *     Everything OneUptime AI did for the project's incidents (or alerts),
 *     newest first, a page at a time (IncidentAlertAiLogs): its
 *     investigations, the fixes it proposed or applied, the fix pull
 *     requests it was asked to open, and the commands it ran. For a
 *     signed-in user who may read incidents (or alerts); every entry is
 *     about one the caller may read, and fixes and commands also need read
 *     access to their own tables (IncidentAlertAiLogsReader).
 */

/*
 * A signed-in user, inside exactly one project: the tenant the request is
 * authenticated for. Whether they may read incidents or alerts is the model
 * layer's answer, which also admits master admins.
 */
export async function getTenantProps(req: ExpressRequest): Promise<{
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  CommonAPI.assertAuthenticatedUser(props);

  const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

  return { projectId, props: { ...props, isMultiTenantRequest: false } };
}

export interface ParsedLogsRequest {
  before?: Date | undefined;
  kinds?: Array<IncidentAlertAiLogKind> | undefined;
}

// What a logs request asks for; anything else in the body is ignored.
export function parseLogsRequest(body: unknown): ParsedLogsRequest {
  const request: JSONObject =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)
      : {};
  const parsed: ParsedLogsRequest = {};

  const before: unknown = request["before"];

  if (before !== undefined && before !== null && before !== "") {
    const date: Date =
      typeof before === "string" ? new Date(before) : new Date(NaN);

    if (Number.isNaN(date.getTime())) {
      throw new BadDataException("before must be an ISO date.");
    }

    parsed.before = date;
  }

  const kinds: unknown = request["kinds"];

  if (kinds !== undefined && kinds !== null) {
    if (
      !Array.isArray(kinds) ||
      kinds.some((kind: unknown): boolean => {
        return !INCIDENT_ALERT_AI_LOG_KINDS.includes(
          kind as IncidentAlertAiLogKind,
        );
      })
    ) {
      throw new BadDataException(
        `kinds must be a list of: ${INCIDENT_ALERT_AI_LOG_KINDS.join(", ")}.`,
      );
    }

    parsed.kinds = kinds as Array<IncidentAlertAiLogKind>;
  }

  return parsed;
}

for (const subjectKind of INCIDENT_ALERT_AI_SUBJECT_KINDS) {
  router.post(
    INCIDENT_ALERT_AI_LOGS_PATHS[subjectKind],
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
        const request: ParsedLogsRequest = parseLogsRequest(req.body);

        const logs: IncidentAlertAiLogs = await IncidentAlertAiLogsReader.read({
          subjectKind: subjectKind as IncidentAlertAiSubjectKind,
          projectId,
          props,
          before: request.before,
          kinds: request.kinds,
        });

        Response.sendJsonObjectResponse(
          req,
          res,
          logs as unknown as JSONObject,
        );
        return;
      } catch (err) {
        next(err);
        return;
      }
    },
  );
}

export default router;
