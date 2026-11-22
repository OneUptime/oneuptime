import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import {
  findDropFilterImpact,
  readDropFilterImpactRequest,
} from "../Utils/Telemetry/DropFilterImpact";
import LogDropFilter from "../../Models/DatabaseModels/LogDropFilter";
import TraceDropFilter from "../../Models/DatabaseModels/TraceDropFilter";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  DROP_FILTER_IMPACT_API_PATHS,
  DropFilterImpact,
} from "../../Types/Telemetry/DropFilterImpact";
import { TelemetryFieldSignal } from "../../Types/Telemetry/TelemetryFieldReaders";

const router: ExpressRouter = Express.getRouter();

/*
 * WHAT A DROP OR SAMPLE FILTER BEING WRITTEN WOULD TAKE (#10436).
 *
 *   POST /telemetry/logs/drop-filter-impact
 *   POST /telemetry/traces/drop-filter-impact
 *   { filterQuery, action: "drop" | "sample", samplePercentage?, name? }
 *
 * The drop filter forms ask while a filter is written, and a filter's
 * Enable before it is turned on; an API caller or a pipeline asks before
 * it writes one: how many of the last day's records the filter matches,
 * how many of those Security Events read, and the monitors, dashboards,
 * saved views, recording rules and SLOs whose queries keep the same
 * records (Utils/Telemetry/DropFilterImpact). It reads; it changes nothing,
 * and it never refuses a filter for what it would take.
 *
 * For whoever may create or edit that signal's drop filters, with an API
 * key too. The records are counted only over the services the caller may
 * read, and the readers named only where they may read them.
 */
function writePermissionsOf(model: {
  getCreatePermissions: () => Array<Permission>;
  getUpdatePermissions: () => Array<Permission>;
}): Array<Permission> {
  return Array.from(
    new Set<Permission>([
      ...model.getCreatePermissions(),
      ...model.getUpdatePermissions(),
    ]),
  );
}

export const DROP_FILTER_IMPACT_PERMISSIONS: Readonly<
  Record<TelemetryFieldSignal, Array<Permission>>
> = {
  log: writePermissionsOf(new LogDropFilter()),
  trace: writePermissionsOf(new TraceDropFilter()),
};

for (const signal of ["log", "trace"] as Array<TelemetryFieldSignal>) {
  router.post(
    DROP_FILTER_IMPACT_API_PATHS[signal],
    UserMiddleware.getUserMiddleware,
    UserMiddleware.requireUserAuthentication,
    UserMiddleware.requirePermission({
      permissions: DROP_FILTER_IMPACT_PERMISSIONS[signal],
    }),
    async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const props: DatabaseCommonInteractionProps =
          await CommonAPI.getDatabaseCommonInteractionProps(req);
        const projectId: ObjectID | undefined = props.tenantId;

        if (!projectId) {
          throw new BadDataException("Project ID is required");
        }

        const impact: DropFilterImpact = await findDropFilterImpact({
          projectId,
          request: readDropFilterImpactRequest(req.body, signal),
          props,
        });

        Response.sendJsonObjectResponse(
          req,
          res,
          impact as unknown as JSONObject,
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
