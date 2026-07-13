import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
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
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ServiceService from "Common/Server/Services/ServiceService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import Service from "Common/Models/DatabaseModels/Service";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";

/*
 * Operational status for a set of services, for the Service Map's
 * overlay: active incidents AND active alerts per service. Both link to
 * services directly (IncidentService / AlertService join tables), and
 * both are "active" while their current state orders before the
 * project's resolved state — the same definition the respective
 * services' own active-count helpers use. All reads go through the
 * permission-scoped model layer, so callers only see what they can read.
 */

const MAX_SERVICE_NAMES: number = 500;
const MAX_ITEMS_PER_SERVICE: number = 5;

interface StatusItem {
  id: string;
  title: string;
  severityName: string | null;
  severityColor: string | null;
}

export interface ServiceOperationalStatusEntry {
  serviceName: string;
  serviceId: string;
  activeIncidentCount: number;
  worstIncidentSeverityName: string | null;
  worstIncidentSeverityColor: string | null;
  incidents: Array<StatusItem>;
  activeAlertCount: number;
  worstAlertSeverityName: string | null;
  worstAlertSeverityColor: string | null;
  alerts: Array<StatusItem>;
}

/*
 * Incidents and alerts share the exact shape this endpoint needs: a
 * severity relation (name/color/order, lower order = more severe) and a
 * services relation. One generic summarizer serves both.
 */
interface StatusSource {
  _id?: { toString: () => string } | undefined;
  title?: string | undefined;
  severity?:
    | {
        name?: string | undefined;
        color?: { toString: () => string } | undefined;
        order?: number | undefined;
      }
    | undefined;
  serviceIds: Array<string>;
}

interface StatusSummary {
  count: number;
  worstSeverityName: string | null;
  worstSeverityColor: string | null;
  items: Array<StatusItem>;
}

function summarize(sources: Array<StatusSource>): StatusSummary {
  let worst: StatusSource | null = null;
  for (const source of sources) {
    const order: number | undefined = source.severity?.order;
    if (
      !worst ||
      (order !== undefined && order < (worst.severity?.order ?? Infinity))
    ) {
      worst = source;
    }
  }
  return {
    count: sources.length,
    worstSeverityName: worst?.severity?.name || null,
    worstSeverityColor: worst?.severity?.color?.toString() || null,
    items: sources
      .slice(0, MAX_ITEMS_PER_SERVICE)
      .map((source: StatusSource): StatusItem => {
        return {
          id: source._id ? source._id.toString() : "",
          title: source.title || "Untitled",
          severityName: source.severity?.name || null,
          severityColor: source.severity?.color?.toString() || null,
        };
      }),
  };
}

function groupByService(
  sources: Array<StatusSource>,
): Map<string, Array<StatusSource>> {
  const byService: Map<string, Array<StatusSource>> = new Map<
    string,
    Array<StatusSource>
  >();
  for (const source of sources) {
    for (const serviceId of source.serviceIds) {
      const bucket: Array<StatusSource> = byService.get(serviceId) || [];
      bucket.push(source);
      byService.set(serviceId, bucket);
    }
  }
  return byService;
}

export default class ServiceOperationalStatusAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/telemetry/service-operational-status",
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

          const body: JSONObject = req.body as JSONObject;
          const rawNames: unknown = body["serviceNames"];
          if (!Array.isArray(rawNames) || rawNames.length === 0) {
            throw new BadDataException("serviceNames is required");
          }
          const serviceNames: Array<string> = rawNames
            .filter((name: unknown) => {
              return typeof name === "string" && name.length > 0;
            })
            .slice(0, MAX_SERVICE_NAMES) as Array<string>;

          /*
           * Match names case-insensitively: topology entity display names
           * are canonicalized to lowercase while Service rows keep the
           * original casing.
           */
          const services: Array<Service> = await ServiceService.findBy({
            query: { projectId: props.tenantId },
            select: { _id: true, name: true },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: props,
          });
          const serviceByLowerName: Map<string, Service> = new Map<
            string,
            Service
          >();
          for (const service of services) {
            if (service.name) {
              serviceByLowerName.set(service.name.toLowerCase(), service);
            }
          }

          /*
           * No resolved state configured means "active" is undefined for
           * that signal — report zero instead of failing the overlay.
           */
          const [resolvedIncidentState, resolvedAlertState]: [
            IncidentState | null,
            AlertState | null,
          ] = await Promise.all([
            IncidentStateService.findOneBy({
              query: { projectId: props.tenantId, isResolvedState: true },
              select: { _id: true, order: true },
              props: { isRoot: true },
            }),
            AlertStateService.findOneBy({
              query: { projectId: props.tenantId, isResolvedState: true },
              select: { _id: true, order: true },
              props: { isRoot: true },
            }),
          ]);

          let activeIncidents: Array<Incident> = [];
          if (
            resolvedIncidentState &&
            resolvedIncidentState.order !== undefined
          ) {
            activeIncidents = await IncidentService.findBy({
              query: {
                projectId: props.tenantId,
                currentIncidentState: {
                  order: QueryHelper.lessThan(resolvedIncidentState.order),
                },
              },
              select: {
                _id: true,
                title: true,
                incidentSeverity: {
                  name: true,
                  color: true,
                  order: true,
                },
                services: {
                  _id: true,
                },
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: props,
            });
          }

          let activeAlerts: Array<Alert> = [];
          if (resolvedAlertState && resolvedAlertState.order !== undefined) {
            activeAlerts = await AlertService.findBy({
              query: {
                projectId: props.tenantId,
                currentAlertState: {
                  order: QueryHelper.lessThan(resolvedAlertState.order),
                },
              },
              select: {
                _id: true,
                title: true,
                alertSeverity: {
                  name: true,
                  color: true,
                  order: true,
                },
                services: {
                  _id: true,
                },
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: props,
            });
          }

          const toSource: (
            title: string | undefined,
            id: { toString: () => string } | undefined,
            severity: StatusSource["severity"],
            relatedServices: Array<Service> | undefined,
          ) => StatusSource = (
            title: string | undefined,
            id: { toString: () => string } | undefined,
            severity: StatusSource["severity"],
            relatedServices: Array<Service> | undefined,
          ): StatusSource => {
            return {
              _id: id,
              title: title,
              severity: severity,
              serviceIds: (relatedServices || [])
                .map((service: Service) => {
                  return service._id ? service._id.toString() : "";
                })
                .filter(Boolean),
            };
          };

          const incidentsByService: Map<
            string,
            Array<StatusSource>
          > = groupByService(
            activeIncidents.map((incident: Incident): StatusSource => {
              return toSource(
                incident.title,
                incident._id,
                incident.incidentSeverity,
                incident.services,
              );
            }),
          );
          const alertsByService: Map<
            string,
            Array<StatusSource>
          > = groupByService(
            activeAlerts.map((alert: Alert): StatusSource => {
              return toSource(
                alert.title,
                alert._id,
                alert.alertSeverity,
                alert.services,
              );
            }),
          );

          const statuses: Array<ServiceOperationalStatusEntry> = [];
          for (const requestedName of serviceNames) {
            const service: Service | undefined = serviceByLowerName.get(
              requestedName.toLowerCase(),
            );
            if (!service || !service._id) {
              continue;
            }
            const serviceId: string = service._id.toString();
            const incidentSummary: StatusSummary = summarize(
              incidentsByService.get(serviceId) || [],
            );
            const alertSummary: StatusSummary = summarize(
              alertsByService.get(serviceId) || [],
            );

            statuses.push({
              serviceName: requestedName,
              serviceId: serviceId,
              activeIncidentCount: incidentSummary.count,
              worstIncidentSeverityName: incidentSummary.worstSeverityName,
              worstIncidentSeverityColor: incidentSummary.worstSeverityColor,
              incidents: incidentSummary.items,
              activeAlertCount: alertSummary.count,
              worstAlertSeverityName: alertSummary.worstSeverityName,
              worstAlertSeverityColor: alertSummary.worstSeverityColor,
              alerts: alertSummary.items,
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            services: statuses,
          } as unknown as JSONObject);
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
