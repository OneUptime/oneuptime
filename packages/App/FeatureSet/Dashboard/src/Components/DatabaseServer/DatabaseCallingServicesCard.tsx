import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { DatabaseCallingService } from "../../Pages/Database/Utils/DatabaseServerTelemetryQueries";
import { formatDatabaseCount } from "../../Pages/Database/Utils/DatabaseServerPresentation";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Who queries this database": the application services whose CLIENT spans
 * name one of its endpoints, busiest first, with their error rate and p95
 * query latency over the selected range. The table holds the busiest few;
 * when more services called, a footer says how many in all.
 */

export interface ComponentProps {
  services: Array<DatabaseCallingService>;
  // Service id → display name. An id without a name renders as the id.
  serviceNames: Record<string, string>;
  isLoading: boolean;
  // Every service that called in the range (the table may show fewer).
  totalServices?: number | undefined;
}

/**
 * The footer under a table that holds fewer services than called, e.g.
 * "Showing the 10 busiest of 25 calling services." Empty when the table is
 * the whole list.
 */
export function getCallingServicesFooter(
  shown: number,
  total: number | null | undefined,
): string {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= shown) {
    return "";
  }
  return `Showing the ${shown} busiest of ${formatDatabaseCount(total)} calling services.`;
}

function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1) {
    return `${(value * 1000).toFixed(0)} µs`;
  }
  if (value < 1000) {
    return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

function formatErrorRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

const DatabaseCallingServicesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Card
      title="Calling services"
      description="The application services that query this database, busiest first — from the database spans of your instrumented applications."
    >
      {props.isLoading ? (
        <ComponentLoader />
      ) : props.services.length === 0 ? (
        <div
          data-testid="database-calling-services-empty"
          className="text-sm text-gray-500"
        >
          No instrumented application queried this database in the selected
          range.
        </div>
      ) : (
        <div className="-m-6 -mt-2 border-t border-gray-200">
          <div className="grid grid-cols-12 gap-4 bg-gray-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <div className="col-span-6">Service</div>
            <div className="col-span-2 text-right">Queries</div>
            <div className="col-span-2 text-right">Errors</div>
            <div className="col-span-2 text-right">p95</div>
          </div>
          <div className="divide-y divide-gray-100">
            {props.services.map(
              (service: DatabaseCallingService): ReactElement => {
                const name: string =
                  props.serviceNames[service.serviceId] || service.serviceId;
                const route: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SERVICE_VIEW] as Route,
                  { modelId: new ObjectID(service.serviceId) },
                );
                return (
                  <div
                    key={service.serviceId}
                    data-testid="database-calling-service-row"
                    className="grid grid-cols-12 gap-4 px-4 py-3 text-sm"
                  >
                    <div className="col-span-6 min-w-0 truncate">
                      {props.serviceNames[service.serviceId] ? (
                        <AppLink
                          to={route}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {name}
                        </AppLink>
                      ) : (
                        <span className="font-mono text-gray-500">{name}</span>
                      )}
                    </div>
                    <div className="col-span-2 text-right text-gray-700">
                      {formatDatabaseCount(service.calls)}
                    </div>
                    <div className="col-span-2 text-right text-gray-700">
                      {formatErrorRate(service.errorRatePercent)}
                    </div>
                    <div className="col-span-2 text-right text-gray-700">
                      {formatMs(service.p95DurationMs)}
                    </div>
                  </div>
                );
              },
            )}
          </div>
          {getCallingServicesFooter(
            props.services.length,
            props.totalServices,
          ) ? (
            <div
              data-testid="database-calling-services-footer"
              className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500"
            >
              {getCallingServicesFooter(
                props.services.length,
                props.totalServices,
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      )}
    </Card>
  );
};

export default DatabaseCallingServicesCard;
