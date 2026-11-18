import UserMiddleware from "../Middleware/UserAuthorization";
import WhoIsToldService, { WhoIsToldDraft } from "../Services/WhoIsToldService";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import { WhoIsToldResult } from "../../Types/Monitor/WhoIsTold";
import ObjectID from "../../Types/ObjectID";

/*
 * WHO IS TOLD WHEN A MONITOR GOES DOWN (Types/Monitor/WhoIsTold), for the
 * monitor's overview and whatever else shows the chain:
 *
 *   GET /who-is-told/monitor/:monitorId[?refresh=true]
 *
 * A signed-in member of the project (or a key of it) who may read the
 * monitor; what they may not read of its policies and rules is taken out by
 * the service (WhoIsToldService.getForMonitor). Reads only. `refresh` works
 * the answer out again instead of using the minute-old one, as Readiness's
 * Recheck does.
 *
 * A bare router, as OnCallReadinessAPI is: it reads no single model's CRUD
 * routes.
 */

export const WHO_IS_TOLD_API_PATH: string = "/who-is-told";

const router: ExpressRouter = Express.getRouter();

export function readMonitorIdParam(req: ExpressRequest): ObjectID {
  const raw: string = ((req.params["monitorId"] as string) || "").trim();

  if (!raw || !ObjectID.isValidUUID(raw)) {
    throw new BadDataException("monitorId is required.");
  }

  return new ObjectID(raw);
}

export function isRefreshRequested(req: ExpressRequest): boolean {
  const raw: unknown = (req.query as Record<string, unknown>)["refresh"];

  if (raw === undefined || raw === null) {
    return false;
  }

  const normalized: string = String(raw).trim().toLowerCase();

  return normalized === "true" || normalized === "1";
}

// The most labels a draft is read with: a form never holds more.
export const WHO_IS_TOLD_DRAFT_MAX_LABELS: number = 500;
const WHO_IS_TOLD_DRAFT_MAX_NAME_LENGTH: number = 1000;

/*
 * The monitor a draft describes (#7055), from the request's body - its
 * monitorSteps as the Dashboard serializes them - or a refusal that says
 * what is wrong.
 */
export function readDraftFromBody(req: ExpressRequest): WhoIsToldDraft {
  const body: JSONObject = (req.body || {}) as JSONObject;

  const monitorType: unknown = body["monitorType"];

  if (
    typeof monitorType !== "string" ||
    !Object.values(MonitorType).includes(monitorType as MonitorType)
  ) {
    throw new BadDataException("monitorType is required.");
  }

  const rawMonitorId: unknown = body["monitorId"];
  let monitorId: ObjectID | undefined = undefined;

  if (
    rawMonitorId !== undefined &&
    rawMonitorId !== null &&
    rawMonitorId !== ""
  ) {
    if (
      typeof rawMonitorId !== "string" ||
      !ObjectID.isValidUUID(rawMonitorId)
    ) {
      throw new BadDataException("monitorId is not a monitor's id.");
    }

    monitorId = new ObjectID(rawMonitorId);
  }

  const rawSteps: unknown = body["monitorSteps"];

  if (!rawSteps || typeof rawSteps !== "object" || Array.isArray(rawSteps)) {
    throw new BadDataException("monitorSteps is required.");
  }

  let monitorSteps: MonitorSteps;

  try {
    monitorSteps = MonitorSteps.fromJSON(rawSteps as JSONObject);
  } catch {
    throw new BadDataException("monitorSteps could not be read.");
  }

  const rawLabelIds: unknown = body["labelIds"];
  const labelIds: Array<ObjectID> = [];

  if (Array.isArray(rawLabelIds)) {
    for (const id of rawLabelIds.slice(0, WHO_IS_TOLD_DRAFT_MAX_LABELS)) {
      if (typeof id === "string" && ObjectID.isValidUUID(id)) {
        labelIds.push(new ObjectID(id));
      }
    }
  }

  const text: (value: unknown) => string = (value: unknown): string => {
    return typeof value === "string"
      ? value.slice(0, WHO_IS_TOLD_DRAFT_MAX_NAME_LENGTH)
      : "";
  };

  return {
    monitorId: monitorId,
    name: text(body["name"]),
    description: text(body["description"]),
    monitorType: monitorType as MonitorType,
    monitorSteps: monitorSteps,
    labelIds: labelIds,
  };
}

/*
 * WHO A MONITOR NOT SAVED YET WOULD TELL (#7055): Create Monitor's criteria,
 * or a saved monitor's criteria being edited.
 *
 *   POST /who-is-told/draft
 *   { monitorId?, name, description?, monitorType, monitorSteps, labelIds? }
 *
 * Reads only, and keeps nothing: WhoIsToldService.getForDraft, which asks
 * what creating the monitor takes, or reading the saved one.
 */
router.post(
  `${WHO_IS_TOLD_API_PATH}/draft`,
  UserMiddleware.getUserMiddleware,
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

      const result: WhoIsToldResult = await WhoIsToldService.getForDraft({
        projectId: projectId,
        props: props,
        draft: readDraftFromBody(req),
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        result as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  `${WHO_IS_TOLD_API_PATH}/monitor/:monitorId`,
  UserMiddleware.getUserMiddleware,
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

      const monitorId: ObjectID = readMonitorIdParam(req);

      const result: WhoIsToldResult = await WhoIsToldService.getForMonitor({
        projectId: projectId,
        monitorId: monitorId,
        props: props,
        refresh: isRefreshRequested(req),
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        result as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
