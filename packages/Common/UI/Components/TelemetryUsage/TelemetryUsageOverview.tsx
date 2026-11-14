import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import {
  getTelemetryUsageRangeOfLastDays,
  TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
  TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
  TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS,
  TELEMETRY_USAGE_SIGNALS,
  TelemetryUsageRange,
  TelemetryUsageResourceSummary,
  TelemetryUsageSignal,
  TelemetryUsageSummary,
} from "../../../Types/Telemetry/TelemetryUsage";
import { PluralTemplate, Translator } from "../../../Types/Translator";
import API from "../../Utils/API/API";
import { translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import InfoCard from "../InfoCard/InfoCard";
import Link from "../Link/Link";
import Table from "../Table/Table";
import { drawsItsOwnLines } from "../Table/ColumnLineText";
import { getTableHeaderButtons } from "../Table/TableHeaderControls";
import TableEmptyState, { TableEmptyStateKind } from "../Table/TableEmptyState";
import Column from "../Table/Types/Column";
import FieldType from "../Types/FieldType";
import TelemetryUsageDailyChart, {
  getChartedSignals,
} from "./TelemetryUsageDailyChart";
import {
  formatTelemetryUsageCost,
  formatTelemetryUsageRetention,
  formatTelemetryUsageSize,
  getTelemetryUsageResourceName,
  getTelemetryUsageResourceTypeLabel,
  getTelemetryUsageSignalTooltip,
  TELEMETRY_USAGE_SIGNAL_TITLES,
} from "./TelemetryUsageWords";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * A project's telemetry usage: how much of each signal it sent each UTC day
 * of a range, and which of its resources sent it, with the retention each is
 * kept for - and, where billing is on and the reader reads billing, what it
 * cost. The Dashboard's Project Settings > Telemetry & APM > Usage, and the
 * Admin Dashboard's view of one project, which hand it how to read a range
 * (fetchUsage) and, the Dashboard, where a resource's page is.
 *
 * It opens on the last 30 complete UTC days: today is still being sent, and
 * a day is counted once it has ended (TelemetryUsageBillingService).
 */

export const TELEMETRY_USAGE_OVERVIEW_TEST_ID: string =
  "telemetry-usage-overview";
export const TELEMETRY_USAGE_RESOURCES_TABLE_ID: string =
  "telemetry-usage-resources";
const RESOURCES_PAGE_SIZE: number = 25;

const LAST_DAYS: PluralTemplate = {
  one: "Last {{count}} day",
  other: "Last {{count}} days",
};

export const NO_USAGE_YET_TITLE: string = translationKey(
  "No telemetry usage yet",
);
export const NO_USAGE_YET_DESCRIPTION: string = translationKey(
  "A day's telemetry is counted once the day has ended in UTC, by about 08:00 UTC the next day. Today's shows up tomorrow.",
);
export const NO_USAGE_IN_RANGE_TITLE: string = translationKey(
  "No telemetry usage in this range",
);
const RETENTION_TOOLTIP: string = translationKey(
  "How long the resource's telemetry is kept, as counted on the newest day of the range.",
);
export const NO_USAGE_IN_RANGE_DESCRIPTION: string = translationKey(
  "The newest day with usage is {{day}}. Choose a longer range to see it.",
);

// One resource's row, its usage of each signal in a column of its own.
export interface TelemetryUsageResourceRow {
  primaryEntityId: string;
  name: string;
  typeLabel: string;
  route: Route | undefined;
  totalGB: number;
  totalCostInUSD: number;
  retention: string;
  logsGB: number;
  metricsGB: number;
  // Spans - and, on days counted before exceptions were shown apart, those too.
  tracesGB: number;
  exceptionsGB: number;
  profilesGB: number;
  sessionReplayGB: number;
  securityEventsGB: number;
}

type SignalColumnKey =
  | "logsGB"
  | "metricsGB"
  | "tracesGB"
  | "exceptionsGB"
  | "profilesGB"
  | "sessionReplayGB"
  | "securityEventsGB";

export const TELEMETRY_USAGE_SIGNAL_COLUMN_KEYS: Record<
  string,
  SignalColumnKey
> = {
  [ProductType.Logs]: "logsGB",
  [ProductType.Metrics]: "metricsGB",
  [ProductType.Traces]: "tracesGB",
  [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: "exceptionsGB",
  [ProductType.Profiles]: "profilesGB",
  [ProductType.SessionReplay]: "sessionReplayGB",
  [ProductType.SecurityEvents]: "securityEventsGB",
};

export const toTelemetryUsageResourceRow: (data: {
  resource: TelemetryUsageResourceSummary;
  projectId: string;
  translator: Translator;
  getResourceRoute?:
    | ((resource: TelemetryUsageResourceSummary) => Route | undefined)
    | undefined;
}) => TelemetryUsageResourceRow = (data: {
  resource: TelemetryUsageResourceSummary;
  projectId: string;
  translator: Translator;
  getResourceRoute?:
    | ((resource: TelemetryUsageResourceSummary) => Route | undefined)
    | undefined;
}): TelemetryUsageResourceRow => {
  const resource: TelemetryUsageResourceSummary = data.resource;
  const gbOf: (signal: TelemetryUsageSignal) => number = (
    signal: TelemetryUsageSignal,
  ): number => {
    return resource.byProduct[signal]?.dataIngestedInGB || 0;
  };

  return {
    primaryEntityId: resource.primaryEntityId,
    name: getTelemetryUsageResourceName(
      resource,
      data.projectId,
      data.translator,
    ),
    typeLabel: getTelemetryUsageResourceTypeLabel(
      resource.primaryEntityType,
      data.translator,
    ),
    route: data.getResourceRoute ? data.getResourceRoute(resource) : undefined,
    totalGB: resource.total.dataIngestedInGB,
    totalCostInUSD: resource.total.totalCostInUSD || 0,
    retention: formatTelemetryUsageRetention(resource, data.translator),
    logsGB: gbOf(ProductType.Logs),
    metricsGB: gbOf(ProductType.Metrics),
    tracesGB: gbOf(ProductType.Traces),
    exceptionsGB: gbOf(TELEMETRY_USAGE_EXCEPTIONS_SIGNAL),
    profilesGB: gbOf(ProductType.Profiles),
    sessionReplayGB: gbOf(ProductType.SessionReplay),
    securityEventsGB: gbOf(ProductType.SecurityEvents),
  };
};

// The rows in a column's order; ties by name, so a page never reshuffles.
export const sortTelemetryUsageResourceRows: (
  rows: Array<TelemetryUsageResourceRow>,
  sortBy: keyof TelemetryUsageResourceRow | null,
  sortOrder: SortOrder,
) => Array<TelemetryUsageResourceRow> = (
  rows: Array<TelemetryUsageResourceRow>,
  sortBy: keyof TelemetryUsageResourceRow | null,
  sortOrder: SortOrder,
): Array<TelemetryUsageResourceRow> => {
  const key: keyof TelemetryUsageResourceRow = sortBy || "totalGB";
  const direction: number = sortOrder === SortOrder.Ascending ? 1 : -1;

  return [...rows].sort(
    (
      first: TelemetryUsageResourceRow,
      second: TelemetryUsageResourceRow,
    ): number => {
      const a: unknown = first[key];
      const b: unknown = second[key];
      const order: number =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a || "").localeCompare(String(b || ""), undefined, {
              sensitivity: "base",
            });

      return (
        order * direction ||
        first.name.localeCompare(second.name, undefined, {
          sensitivity: "base",
        }) ||
        first.primaryEntityId.localeCompare(second.primaryEntityId)
      );
    },
  );
};

export interface ComponentProps {
  // The project whose usage it is: its id is the unattributed bucket's too.
  projectId: string;
  // Reads one range of the project's usage.
  fetchUsage: (range: TelemetryUsageRange) => Promise<TelemetryUsageSummary>;
  // A resource's own page, where the app has one.
  getResourceRoute?:
    | ((resource: TelemetryUsageResourceSummary) => Route | undefined)
    | undefined;
}

const TelemetryUsageOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [rangeInDays, setRangeInDays] = useState<number>(
    TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
  );
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [summary, setSummary] = useState<TelemetryUsageSummary | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sortBy, setSortBy] = useState<keyof TelemetryUsageResourceRow | null>(
    "totalGB",
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);
  const [pageNumber, setPageNumber] = useState<number>(1);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const usage: TelemetryUsageSummary = await props.fetchUsage(
          getTelemetryUsageRangeOfLastDays(
            rangeInDays,
            OneUptimeDate.getCurrentDate(),
          ),
        );

        if (isCurrent) {
          setSummary(usage);
          setPageNumber(1);
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return (): void => {
      isCurrent = false;
    };
  }, [rangeInDays, refreshCount, props.projectId]);

  const rangeOptions: Array<DropdownOption> =
    TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS.map(
      (days: number): DropdownOption => {
        return {
          value: days,
          label: translator.translatePlural(LAST_DAYS, days),
        };
      },
    );

  const rangeElement: ReactElement = (
    <div className="w-44">
      <Dropdown
        options={rangeOptions}
        value={rangeOptions.find((option: DropdownOption): boolean => {
          return option.value === rangeInDays;
        })}
        isClearable={false}
        ariaLabel="Range"
        dataTestId="telemetry-usage-range"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          const days: number = Number(value);

          if (Number.isFinite(days) && days > 0) {
            setRangeInDays(days);
          }
        }}
      />
    </div>
  );

  const rows: Array<TelemetryUsageResourceRow> = useMemo(() => {
    return (summary?.resources || []).map(
      (resource: TelemetryUsageResourceSummary): TelemetryUsageResourceRow => {
        return toTelemetryUsageResourceRow({
          resource: resource,
          projectId: props.projectId,
          translator: translator,
          getResourceRoute: props.getResourceRoute,
        });
      },
    );
  }, [summary, translator.language, props.projectId]);

  const sortedRows: Array<TelemetryUsageResourceRow> = useMemo(() => {
    return sortTelemetryUsageResourceRows(rows, sortBy, sortOrder);
  }, [rows, sortBy, sortOrder]);

  const signals: Array<TelemetryUsageSignal> = summary
    ? getChartedSignals(summary.days)
    : [];
  const hasUsage: boolean = Boolean(
    summary && summary.total.dataIngestedInGB > 0,
  );

  // A signal's (i), in the reader's language: what it counts besides its name.
  const tooltipOf: (signal: TelemetryUsageSignal) => string | undefined = (
    signal: TelemetryUsageSignal,
  ): string | undefined => {
    const tooltip: string | undefined = getTelemetryUsageSignalTooltip(signal, {
      isCostIncluded: Boolean(summary?.isCostIncluded),
    });

    return tooltip ? translator.translateText(tooltip) || tooltip : undefined;
  };

  const getSummaryBody: () => ReactElement = (): ReactElement => {
    if (isLoading && !summary) {
      return <ComponentLoader />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setRefreshCount(refreshCount + 1);
          }}
        />
      );
    }

    if (!summary || !hasUsage) {
      return (
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.ChartBar}
          title={
            summary?.latestDay ? NO_USAGE_IN_RANGE_TITLE : NO_USAGE_YET_TITLE
          }
          description={
            summary?.latestDay
              ? translator.translateTemplate(NO_USAGE_IN_RANGE_DESCRIPTION, {
                  day: OneUptimeDate.getDateAsLocalFormattedString(
                    new Date(`${summary.latestDay}T12:00:00.000Z`),
                    true,
                  ),
                })
              : NO_USAGE_YET_DESCRIPTION
          }
          isCompact={true}
          dataTestId="telemetry-usage-empty"
        />
      );
    }

    return (
      <div className="space-y-5">
        <div
          className="grid grid-cols-2 gap-4 md:grid-cols-4"
          data-testid="telemetry-usage-totals"
        >
          <InfoCard
            title={translator.translateText("Total") || "Total"}
            value={formatTelemetryUsageSize(
              summary.total.dataIngestedInGB,
              translator,
            )}
            dataTestId="telemetry-usage-total"
          />
          {summary.isCostIncluded ? (
            <InfoCard
              title={translator.translateText("Cost") || "Cost"}
              value={formatTelemetryUsageCost(
                summary.total.totalCostInUSD || 0,
                translator,
              )}
              dataTestId="telemetry-usage-cost"
            />
          ) : (
            <></>
          )}
          {signals.map((signal: TelemetryUsageSignal): ReactElement => {
            const title: string =
              TELEMETRY_USAGE_SIGNAL_TITLES[signal] || String(signal);

            return (
              <InfoCard
                key={signal}
                title={translator.translateText(title) || title}
                value={formatTelemetryUsageSize(
                  summary.byProduct[signal]?.dataIngestedInGB || 0,
                  translator,
                )}
                tooltip={tooltipOf(signal)}
                dataTestId={`telemetry-usage-signal-${signal}`}
              />
            );
          })}
        </div>
        <TelemetryUsageDailyChart days={summary.days} />
      </div>
    );
  };

  const signalColumns: Array<Column<TelemetryUsageResourceRow>> =
    TELEMETRY_USAGE_SIGNALS.filter((signal: TelemetryUsageSignal): boolean => {
      return signals.includes(signal);
    }).map(
      (signal: TelemetryUsageSignal): Column<TelemetryUsageResourceRow> => {
        const key: SignalColumnKey =
          TELEMETRY_USAGE_SIGNAL_COLUMN_KEYS[signal]!;
        const headerTooltip: string | undefined = tooltipOf(signal);

        return {
          id: key,
          key: key,
          title: TELEMETRY_USAGE_SIGNAL_TITLES[signal] || String(signal),
          type: FieldType.Element,
          hideOnMobile: true,
          ...(headerTooltip ? { headerTooltip: headerTooltip } : {}),
          getElement: (row: TelemetryUsageResourceRow): ReactElement => {
            return (
              <span className="tabular-nums text-gray-700">
                {row[key] > 0
                  ? formatTelemetryUsageSize(row[key], translator)
                  : "—"}
              </span>
            );
          },
        };
      },
    );

  const columns: Array<Column<TelemetryUsageResourceRow>> = [
    {
      id: "resource",
      key: "name",
      title: "Resource",
      type: FieldType.Element,
      // Its name (in an isolate) over the page's word for its kind.
      getLineText: drawsItsOwnLines,
      getElement: (row: TelemetryUsageResourceRow): ReactElement => {
        return (
          <div className="min-w-0">
            {row.route ? (
              <Link
                to={row.route}
                className="font-medium text-indigo-600 hover:underline"
                dataTestId="telemetry-usage-resource-link"
              >
                <bdi>{row.name}</bdi>
              </Link>
            ) : (
              <bdi className="font-medium text-gray-900">{row.name}</bdi>
            )}
            <div className="text-xs text-gray-500">{row.typeLabel}</div>
          </div>
        );
      },
    },
    ...signalColumns,
    {
      id: "total",
      key: "totalGB",
      title: "Total",
      type: FieldType.Element,
      getElement: (row: TelemetryUsageResourceRow): ReactElement => {
        return (
          <span className="font-medium tabular-nums text-gray-900">
            {formatTelemetryUsageSize(row.totalGB, translator)}
          </span>
        );
      },
    },
    ...(summary?.isCostIncluded
      ? [
          {
            id: "cost",
            key: "totalCostInUSD",
            title: "Cost",
            type: FieldType.Element,
            getElement: (row: TelemetryUsageResourceRow): ReactElement => {
              return (
                <span className="tabular-nums text-gray-700">
                  {formatTelemetryUsageCost(row.totalCostInUSD, translator)}
                </span>
              );
            },
          } as Column<TelemetryUsageResourceRow>,
        ]
      : []),
    {
      id: "retention",
      key: "retention",
      title: "Retention",
      type: FieldType.Element,
      disableSort: true,
      headerTooltip: translator.translateText(RETENTION_TOOLTIP),
      getElement: (row: TelemetryUsageResourceRow): ReactElement => {
        return <span className="text-gray-700">{row.retention || "—"}</span>;
      },
    },
  ];

  const pageRows: Array<TelemetryUsageResourceRow> = sortedRows.slice(
    (pageNumber - 1) * RESOURCES_PAGE_SIZE,
    pageNumber * RESOURCES_PAGE_SIZE,
  );

  return (
    <Fragment>
      <div data-testid={TELEMETRY_USAGE_OVERVIEW_TEST_ID}>
        <Card
          title="Telemetry Usage"
          description="How much telemetry this project sent each day, by signal. A day is counted once it has ended in UTC."
          rightElement={rangeElement}
          headerLayout="toolbar"
          buttons={getTableHeaderButtons([
            {
              title: "",
              buttonStyle: ButtonStyleType.ICON,
              icon: IconProp.Refresh,
              onClick: () => {
                setRefreshCount(refreshCount + 1);
              },
            },
          ])}
        >
          {getSummaryBody()}
        </Card>
      </div>

      {summary && hasUsage && !error ? (
        <Card
          title="Usage by Resource"
          description="Which services and resources sent the telemetry, heaviest first, and how long each keeps it."
        >
          <Table<TelemetryUsageResourceRow>
            id={TELEMETRY_USAGE_RESOURCES_TABLE_ID}
            columnWidthsKey={TELEMETRY_USAGE_RESOURCES_TABLE_ID}
            data={pageRows}
            columns={columns}
            singularLabel="Resource"
            pluralLabel="Resources"
            currentPageNumber={pageNumber}
            totalItemsCount={sortedRows.length}
            itemsOnPage={RESOURCES_PAGE_SIZE}
            disablePagination={sortedRows.length <= RESOURCES_PAGE_SIZE}
            error=""
            isLoading={isLoading}
            onNavigateToPage={(page: number): void => {
              setPageNumber(page);
            }}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChanged={(
              newSortBy: keyof TelemetryUsageResourceRow | null,
              newSortOrder: SortOrder,
            ): void => {
              setSortBy(newSortBy);
              setSortOrder(newSortOrder);
              setPageNumber(1);
            }}
          />
        </Card>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default TelemetryUsageOverview;
