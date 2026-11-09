import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import ProbeService from "Common/Server/Services/ProbeService";
import Probe from "Common/Models/DatabaseModels/Probe";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LatencyMatrix from "Common/Types/Monitor/LatencyMatrix";
import LatencyMatrixUtil, {
  LatencyMatrixMonitorInput,
  LatencyMatrixProbeInput,
  LatencyMatrixProbeResult,
} from "Common/Utils/Monitor/LatencyMatrixUtil";

/*
 * Builds a probes × targets latency grid for the requesting user's project
 * from each monitor-probe pair's last-check snapshot. Read-only and
 * permission-scoped.
 */
export default class NetworkLatencyMatrixAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/network-device/latency-matrix",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.tenantId) {
            throw new BadDataException("Project not found in request");
          }

          const probes: Array<Probe> = await ProbeService.findBy({
            query: {
              projectId: props.tenantId,
            },
            select: {
              _id: true,
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: props,
          });

          const monitorProbes: Array<MonitorProbe> =
            await MonitorProbeService.findBy({
              query: {
                projectId: props.tenantId,
              },
              select: {
                _id: true,
                monitorId: true,
                probeId: true,
                monitor: {
                  _id: true,
                  name: true,
                },
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });

          /*
           * The latency, state and time of each pair's last check, read for
           * the pairs the request may read. Read as OneUptime reads it:
           * only those three numbers leave this endpoint, so the check need
           * not be redacted for a reader first (MonitorProbeService).
           */
          const lastMonitoringLogById: Map<string, JSONObject | undefined> =
            new Map();

          const monitorProbeIds: Array<ObjectID> = monitorProbes
            .map((monitorProbe: MonitorProbe): ObjectID | null => {
              return monitorProbe.id || null;
            })
            .filter((id: ObjectID | null): id is ObjectID => {
              return id !== null;
            });

          if (monitorProbeIds.length > 0) {
            const lastChecks: Array<MonitorProbe> =
              await MonitorProbeService.findBy({
                query: {
                  _id: QueryHelper.any(monitorProbeIds),
                  projectId: props.tenantId,
                },
                select: {
                  _id: true,
                  lastMonitoringLog: true,
                },
                limit: monitorProbeIds.length,
                skip: 0,
                props: {
                  isRoot: true,
                },
              });

            for (const lastCheck of lastChecks) {
              if (lastCheck.id) {
                lastMonitoringLogById.set(
                  lastCheck.id.toString(),
                  lastCheck.lastMonitoringLog as JSONObject | undefined,
                );
              }
            }
          }

          // Distinct monitors, preserving name, ordered by first appearance.
          const monitorMap: Map<string, LatencyMatrixMonitorInput> = new Map();
          const results: Array<LatencyMatrixProbeResult> = [];

          for (const monitorProbe of monitorProbes) {
            const monitorId: string | undefined =
              monitorProbe.monitorId?.toString();
            const probeId: string | undefined =
              monitorProbe.probeId?.toString();

            if (!monitorId || !probeId) {
              continue;
            }

            if (!monitorMap.has(monitorId)) {
              monitorMap.set(monitorId, {
                id: monitorId,
                name:
                  monitorProbe.monitor?.name ||
                  `Monitor ${monitorId.substring(0, 8)}`,
              });
            }

            results.push({
              monitorId: monitorId,
              probeId: probeId,
              lastMonitoringLog: monitorProbe.id
                ? lastMonitoringLogById.get(monitorProbe.id.toString())
                : undefined,
            });
          }

          const probeInputs: Array<LatencyMatrixProbeInput> = probes.map(
            (probe: Probe) => {
              return {
                id: probe.id!.toString(),
                name: probe.name || "Probe",
              };
            },
          );

          const matrix: LatencyMatrix = LatencyMatrixUtil.buildMatrix({
            monitors: Array.from(monitorMap.values()),
            probes: probeInputs,
            results: results,
            now: OneUptimeDate.getCurrentDate(),
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            matrix as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
