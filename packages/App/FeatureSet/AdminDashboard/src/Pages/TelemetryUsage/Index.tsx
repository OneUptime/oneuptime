import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { fetchUsageByProject } from "../../Utils/TelemetryUsage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  getTelemetryUsageRangeOfLastDays,
  TELEMETRY_USAGE_DEFAULT_PROJECTS_PAGE_SIZE,
  TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
  TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
  TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS,
  TELEMETRY_USAGE_SIGNALS,
  TelemetryProjectUsagePage,
  TelemetryProjectUsageSortBy,
  TelemetryProjectUsageSummary,
  TelemetryUsageSignal,
} from "Common/Types/Telemetry/TelemetryUsage";
import { PluralTemplate, Translator } from "Common/Types/Translator";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import Link from "Common/UI/Components/Link/Link";
import Page from "Common/UI/Components/Page/Page";
import Table from "Common/UI/Components/Table/Table";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import Column from "Common/UI/Components/Table/Types/Column";
import {
  formatTelemetryUsageCost,
  formatTelemetryUsageSize,
  getTelemetryUsageSignalTooltip,
  TELEMETRY_USAGE_SIGNAL_TITLES,
} from "Common/UI/Components/TelemetryUsage/TelemetryUsageWords";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * Admin Dashboard > Telemetry Usage: how much telemetry each project of the
 * instance sent over a range, heaviest first, so the master admin finds the
 * projects filling ClickHouse - with billing on or off (usage is counted
 * where billing is off too, at no cost). Each project opens on its own
 * usage, by day, signal and resource (Projects > a project > Telemetry
 * Usage). Sorted and paged on the server: an instance can hold thousands of
 * projects.
 */

const LAST_DAYS: PluralTemplate = {
  one: "Last {{count}} day",
  other: "Last {{count}} days",
};

// A project's row: the columns sort by these.
interface ProjectUsageRow {
  projectId: string;
  name: string;
  total: number;
  cost: number;
  logs: number;
  metrics: number;
  traces: number;
  exceptions: number;
  profiles: number;
  sessionReplays: number;
  securityEvents: number;
}

type SignalKey =
  | "logs"
  | "metrics"
  | "traces"
  | "exceptions"
  | "profiles"
  | "sessionReplays"
  | "securityEvents";

const SIGNAL_KEYS: Record<string, SignalKey> = {
  [ProductType.Logs]: "logs",
  [ProductType.Metrics]: "metrics",
  [ProductType.Traces]: "traces",
  [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: "exceptions",
  [ProductType.Profiles]: "profiles",
  [ProductType.SessionReplay]: "sessionReplays",
  [ProductType.SecurityEvents]: "securityEvents",
};

// What the server sorts by, for each sortable column.
const SORT_BY_KEY: Record<string, TelemetryProjectUsageSortBy> = {
  name: "name",
  total: "total",
  logs: ProductType.Logs,
  metrics: ProductType.Metrics,
  traces: ProductType.Traces,
  exceptions: TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
  profiles: ProductType.Profiles,
  sessionReplays: ProductType.SessionReplay,
  securityEvents: ProductType.SecurityEvents,
};

const toRow: (project: TelemetryProjectUsageSummary) => ProjectUsageRow = (
  project: TelemetryProjectUsageSummary,
): ProjectUsageRow => {
  const gbOf: (signal: TelemetryUsageSignal) => number = (
    signal: TelemetryUsageSignal,
  ): number => {
    return project.byProduct[signal]?.dataIngestedInGB || 0;
  };

  return {
    projectId: project.projectId,
    name: project.projectName || project.projectId,
    total: project.total.dataIngestedInGB,
    cost: project.total.totalCostInUSD || 0,
    logs: gbOf(ProductType.Logs),
    metrics: gbOf(ProductType.Metrics),
    traces: gbOf(ProductType.Traces),
    exceptions: gbOf(TELEMETRY_USAGE_EXCEPTIONS_SIGNAL),
    profiles: gbOf(ProductType.Profiles),
    sessionReplays: gbOf(ProductType.SessionReplay),
    securityEvents: gbOf(ProductType.SecurityEvents),
  };
};

const TelemetryUsagePage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();

  const [rangeInDays, setRangeInDays] = useState<number>(
    TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
  );
  const [sortBy, setSortBy] = useState<keyof ProjectUsageRow | null>("total");
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [itemsOnPage, setItemsOnPage] = useState<number>(
    TELEMETRY_USAGE_DEFAULT_PROJECTS_PAGE_SIZE,
  );
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [page, setPage] = useState<TelemetryProjectUsagePage | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const usage: TelemetryProjectUsagePage = await fetchUsageByProject({
          range: getTelemetryUsageRangeOfLastDays(
            rangeInDays,
            OneUptimeDate.getCurrentDate(),
          ),
          sortBy: SORT_BY_KEY[sortBy || "total"] || "total",
          sortOrder: sortOrder === SortOrder.Ascending ? "asc" : "desc",
          skip: (pageNumber - 1) * itemsOnPage,
          limit: itemsOnPage,
        });

        if (isCurrent) {
          setPage(usage);
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
  }, [rangeInDays, sortBy, sortOrder, pageNumber, itemsOnPage, refreshCount]);

  const rangeOptions: Array<DropdownOption> =
    TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS.map(
      (days: number): DropdownOption => {
        return {
          value: days,
          label: translator.translatePlural(LAST_DAYS, days),
        };
      },
    );

  // The signals any project sent in the range: the others get no column.
  const signals: Array<TelemetryUsageSignal> = TELEMETRY_USAGE_SIGNALS.filter(
    (signal: TelemetryUsageSignal): boolean => {
      return (page?.byProduct[signal]?.dataIngestedInGB || 0) > 0;
    },
  );

  // A signal's (i), in the admin's language: what it counts besides its name.
  const tooltipOf: (signal: TelemetryUsageSignal) => string | undefined = (
    signal: TelemetryUsageSignal,
  ): string | undefined => {
    const tooltip: string | undefined = getTelemetryUsageSignalTooltip(signal, {
      isCostIncluded: Boolean(page?.isCostIncluded),
    });

    return tooltip ? translator.translateText(tooltip) || tooltip : undefined;
  };

  const sizeCell: (gigabytes: number) => ReactElement = (
    gigabytes: number,
  ): ReactElement => {
    return (
      <span className="tabular-nums text-gray-700">
        {gigabytes > 0 ? formatTelemetryUsageSize(gigabytes, translator) : "—"}
      </span>
    );
  };

  const columns: Array<Column<ProjectUsageRow>> = [
    {
      id: "project",
      key: "name",
      title: "Project",
      type: FieldType.Element,
      getElement: (row: ProjectUsageRow): ReactElement => {
        return (
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROJECT_TELEMETRY_USAGE] as Route,
              { modelId: new ObjectID(row.projectId) },
            )}
            className="font-medium text-indigo-600 hover:underline"
            dataTestId="telemetry-usage-project-link"
          >
            <bdi>{row.name}</bdi>
          </Link>
        );
      },
    },
    ...signals.map((signal: TelemetryUsageSignal): Column<ProjectUsageRow> => {
      const key: SignalKey = SIGNAL_KEYS[signal]!;
      const headerTooltip: string | undefined = tooltipOf(signal);

      return {
        id: key,
        key: key,
        title: TELEMETRY_USAGE_SIGNAL_TITLES[signal] || String(signal),
        type: FieldType.Element,
        hideOnMobile: true,
        ...(headerTooltip ? { headerTooltip: headerTooltip } : {}),
        getElement: (row: ProjectUsageRow): ReactElement => {
          return sizeCell(row[key]);
        },
      };
    }),
    {
      id: "total",
      key: "total",
      title: "Total",
      type: FieldType.Element,
      getElement: (row: ProjectUsageRow): ReactElement => {
        return (
          <span className="font-medium tabular-nums text-gray-900">
            {formatTelemetryUsageSize(row.total, translator)}
          </span>
        );
      },
    },
    ...(page?.isCostIncluded
      ? [
          {
            id: "cost",
            key: "cost",
            title: "Cost",
            type: FieldType.Element,
            disableSort: true,
            getElement: (row: ProjectUsageRow): ReactElement => {
              return (
                <span className="tabular-nums text-gray-700">
                  {formatTelemetryUsageCost(row.cost, translator)}
                </span>
              );
            },
          } as Column<ProjectUsageRow>,
        ]
      : []),
  ];

  const hasUsage: boolean = Boolean(page && page.total.dataIngestedInGB > 0);

  return (
    <Page
      title={t("pages.telemetryUsage.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.telemetryUsage"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.TELEMETRY_USAGE] as Route,
          ),
        },
      ]}
    >
      <Card
        title={t("pages.telemetryUsage.cardTitle")}
        description={t("pages.telemetryUsage.cardDescription")}
        headerLayout="toolbar"
        rightElement={
          <div className="w-44">
            <Dropdown
              options={rangeOptions}
              value={rangeOptions.find((option: DropdownOption): boolean => {
                return option.value === rangeInDays;
              })}
              isClearable={false}
              ariaLabel="Range"
              dataTestId="telemetry-usage-range"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const days: number = Number(value);

                if (Number.isFinite(days) && days > 0) {
                  setRangeInDays(days);
                  setPageNumber(1);
                }
              }}
            />
          </div>
        }
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
        {page && hasUsage ? (
          <div
            className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4"
            data-testid="telemetry-usage-instance-totals"
          >
            <InfoCard
              title={translator.translateText("Total") || "Total"}
              value={formatTelemetryUsageSize(
                page.total.dataIngestedInGB,
                translator,
              )}
              dataTestId="telemetry-usage-instance-total"
            />
            {page.isCostIncluded ? (
              <InfoCard
                title={translator.translateText("Cost") || "Cost"}
                value={formatTelemetryUsageCost(
                  page.total.totalCostInUSD || 0,
                  translator,
                )}
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
                    page.byProduct[signal]?.dataIngestedInGB || 0,
                    translator,
                  )}
                  tooltip={tooltipOf(signal)}
                  dataTestId={`telemetry-usage-instance-signal-${signal}`}
                />
              );
            })}
          </div>
        ) : (
          <></>
        )}

        {!isLoading && !error && page && !hasUsage ? (
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            icon={IconProp.ChartBar}
            title={t("pages.telemetryUsage.emptyTitle")}
            description={t("pages.telemetryUsage.emptyDescription")}
            isCompact={true}
            dataTestId="telemetry-usage-projects-empty"
          />
        ) : (
          <Table<ProjectUsageRow>
            id="admin-telemetry-usage-projects"
            columnWidthsKey="admin-telemetry-usage-projects"
            data={(page?.projects || []).map(toRow)}
            columns={columns}
            singularLabel="Project"
            pluralLabel="Projects"
            currentPageNumber={pageNumber}
            totalItemsCount={page?.count || 0}
            itemsOnPage={itemsOnPage}
            error={error}
            isLoading={isLoading}
            onNavigateToPage={(newPage: number, newItemsOnPage: number) => {
              setPageNumber(newPage);
              setItemsOnPage(newItemsOnPage);
            }}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChanged={(
              newSortBy: keyof ProjectUsageRow | null,
              newSortOrder: SortOrder,
            ) => {
              setSortBy(newSortBy);
              setSortOrder(newSortOrder);
              setPageNumber(1);
            }}
            onRefreshClick={() => {
              setRefreshCount(refreshCount + 1);
            }}
          />
        )}
      </Card>
    </Page>
  );
};

export default TelemetryUsagePage;
