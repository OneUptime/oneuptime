import PageMap from "../../Utils/PageMap";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ServiceCallsTable, {
  ServiceCallsTableRow,
} from "../ServiceCalls/ServiceCallsTable";
import { DatabaseCallingService } from "../../Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  formatDatabaseCount,
  formatDatabaseErrorRate,
} from "../../Pages/Database/Utils/DatabaseServerPresentation";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import React, { FunctionComponent, ReactElement } from "react";
import {
  getGlobalTranslator,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  formatDurationInUnit,
  formatMilliseconds,
} from "../../Utils/Milliseconds";

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
  translator: Translator = getGlobalTranslator(),
): string {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= shown) {
    return "";
  }
  return translator.translatePlural(
    {
      one: "Showing the {{shown}} busiest of {{count}} calling service.",
      other: "Showing the {{shown}} busiest of {{count}} calling services.",
    },
    total,
    { shown: shown, count: formatDatabaseCount(total, translator) },
  );
}

// A service's p95: "850 µs", "12 ms" in the reader's words (#7418), "1.25 s".
function formatMs(value: number | null, translator: Translator): string {
  if (value === null || !Number.isFinite(value)) {
    return EMPTY_VALUE_MARK;
  }
  if (value < 1) {
    return formatDurationInUnit(translator, value * 1000, "microsecond", {
      decimals: 0,
    });
  }
  if (value < 1000) {
    const decimals: number = value < 10 ? 1 : 0;

    return formatMilliseconds(translator, value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return formatDurationInUnit(translator, value / 1000, "second", {
    decimals: 2,
  });
}

// The table's count and duration columns, as English keys.
export const DATABASE_CALLING_SERVICES_COUNT_HEADER: string =
  translationKey("Queries");

export const DATABASE_CALLING_SERVICES_DURATION_HEADER: string =
  translationKey("p95");

const DatabaseCallingServicesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const footer: string = getCallingServicesFooter(
    props.services.length,
    props.totalServices,
    translator,
  );

  return (
    <Card
      title="Calling services"
      description="The application services that query this database, busiest first — from the database spans of your instrumented applications."
    >
      {props.isLoading ? (
        <TableSkeleton rows={3} columns={3} hasHeader={false} />
      ) : props.services.length === 0 ? (
        <div
          data-testid="database-calling-services-empty"
          className="text-sm text-gray-500"
        >
          {translator.translateText(
            "No instrumented application queried this database in the selected range.",
          )}
        </div>
      ) : (
        <ServiceCallsTable
          dataTestId="database-calling-services"
          rowTestId="database-calling-service-row"
          footerTestId="database-calling-services-footer"
          countHeader={DATABASE_CALLING_SERVICES_COUNT_HEADER}
          durationHeader={DATABASE_CALLING_SERVICES_DURATION_HEADER}
          footer={footer}
          rows={props.services.map(
            (service: DatabaseCallingService): ServiceCallsTableRow => {
              return {
                serviceId: service.serviceId,
                name: props.serviceNames[service.serviceId] || null,
                route: RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SERVICE_VIEW] as Route,
                  { modelId: new ObjectID(service.serviceId) },
                ),
                calls: formatDatabaseCount(service.calls, translator),
                errorRate: formatDatabaseErrorRate(
                  service.errorRatePercent,
                  translator,
                ),
                duration: formatMs(service.p95DurationMs, translator),
              };
            },
          )}
        />
      )}
    </Card>
  );
};

export default DatabaseCallingServicesCard;
