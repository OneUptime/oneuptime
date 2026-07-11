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
import Service from "Common/Models/DatabaseModels/Service";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";

/*
 * Active-incident status for a set of services, for the Service Map's
 * operational overlay. Incidents link to services directly through the
 * IncidentService join ("services affected by this incident"), and an
 * incident is active while its current state orders before the project's
 * resolved state — the same definition IncidentService's own
 * active-incident helpers use. All reads go through the permission-scoped
 * model layer, so callers only see incidents and services they can read.
 */

const MAX_SERVICE_NAMES: number = 500;
const MAX_INCIDENTS_PER_SERVICE: number = 5;

export interface ServiceIncidentStatusEntry {
  serviceName: string;
  serviceId: string;
  activeIncidentCount: number;
  worstSeverityName: string | null;
  worstSeverityColor: string | null;
  incidents: Array<{
    incidentId: string;
    title: string;
    severityName: string | null;
    severityColor: string | null;
  }>;
}

export default class ServiceIncidentStatusAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/telemetry/service-incident-status",
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
           * this project — report all services as incident-free instead of
           * failing the whole overlay.
           */
          const resolvedState: IncidentState | null =
            await IncidentStateService.findOneBy({
              query: { projectId: props.tenantId, isResolvedState: true },
              select: { _id: true, order: true },
              props: { isRoot: true },
            });

          let activeIncidents: Array<Incident> = [];
          if (resolvedState && resolvedState.order !== undefined) {
            activeIncidents = await IncidentService.findBy({
              query: {
                projectId: props.tenantId,
                currentIncidentState: {
                  order: QueryHelper.lessThan(resolvedState.order),
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

          // serviceId -> incidents affecting it.
          const incidentsByServiceId: Map<string, Array<Incident>> = new Map<
            string,
            Array<Incident>
          >();
          for (const incident of activeIncidents) {
            for (const service of incident.services || []) {
              if (!service._id) {
                continue;
              }
              const key: string = service._id.toString();
              incidentsByServiceId.set(key, [
                ...(incidentsByServiceId.get(key) || []),
                incident,
              ]);
            }
          }

          const statuses: Array<ServiceIncidentStatusEntry> = [];
          for (const requestedName of serviceNames) {
            const service: Service | undefined = serviceByLowerName.get(
              requestedName.toLowerCase(),
            );
            if (!service || !service._id) {
              continue;
            }
            const incidents: Array<Incident> =
              incidentsByServiceId.get(service._id.toString()) || [];

            // Lower severity order = more severe (Critical first).
            let worst: Incident | null = null;
            for (const incident of incidents) {
              const order: number | undefined =
                incident.incidentSeverity?.order;
              if (
                !worst ||
                (order !== undefined &&
                  order < (worst.incidentSeverity?.order ?? Infinity))
              ) {
                worst = incident;
              }
            }

            statuses.push({
              serviceName: requestedName,
              serviceId: service._id.toString(),
              activeIncidentCount: incidents.length,
              worstSeverityName: worst?.incidentSeverity?.name || null,
              worstSeverityColor:
                worst?.incidentSeverity?.color?.toString() || null,
              incidents: incidents
                .slice(0, MAX_INCIDENTS_PER_SERVICE)
                .map((incident: Incident) => {
                  return {
                    incidentId: incident._id ? incident._id.toString() : "",
                    title: incident.title || "Untitled incident",
                    severityName: incident.incidentSeverity?.name || null,
                    severityColor:
                      incident.incidentSeverity?.color?.toString() || null,
                  };
                }),
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
