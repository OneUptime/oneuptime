import {
  computeSharePercent,
  filterProjects,
  formatCompactCount,
  formatCount,
  formatPercent,
  getSignalCounts,
  parseProjectIngestion,
  projectDisplayName,
  sortProjects,
  summarizeProjects,
  TELEMETRY_SIGNAL_ORDER,
  TelemetryCounts,
  TelemetryProjectIngestionView,
  TelemetryProjectRow,
  TelemetryProjectSummary,
  TelemetrySignalCounts,
  TelemetrySortColumn,
  TelemetrySortDirection,
} from "./TelemetryIngestionUtils";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { Green, Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Input from "Common/UI/Components/Input/Input";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// The tint each signal keeps across the tiles, the bars and the table header.
const SIGNAL_STYLES: Record<string, { dot: string; bar: string }> = {
  Logs: { dot: "bg-indigo-500", bar: "bg-indigo-500" },
  Metrics: { dot: "bg-emerald-500", bar: "bg-emerald-500" },
  Traces: { dot: "bg-amber-500", bar: "bg-amber-500" },
};

const StatTile: FunctionComponent<{
  label: string;
  value: string;
  hint?: string | undefined;
}> = (props: {
  label: string;
  value: string;
  hint?: string | undefined;
}): ReactElement => {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {props.label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
        {props.value}
      </div>
      {props.hint ? (
        <div
          className="mt-0.5 truncate text-xs text-gray-500"
          title={props.hint}
        >
          {props.hint}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * The share of the day's rows one project accounts for. Purely a reading aid:
 * scanning twelve four-digit numbers for "who is the loud one" is slow, a row of
 * bars is instant.
 */
const ShareBar: FunctionComponent<{ percent: number }> = (props: {
  percent: number;
}): ReactElement => {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 flex-shrink-0 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-1.5 rounded-full bg-indigo-500"
          style={{ width: `${props.percent}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-gray-500">
        {formatPercent(props.percent)}
      </span>
    </div>
  );
};

/*
 * A clickable column header. Sorting is the whole interaction on this table, so
 * the active column carries both an arrow and a darker weight rather than an
 * arrow alone.
 */
const SortableHeader: FunctionComponent<{
  label: string;
  isActive: boolean;
  direction: TelemetrySortDirection;
  align?: "left" | "right" | undefined;
  onClick: () => void;
  dotClassName?: string | undefined;
}> = (props: {
  label: string;
  isActive: boolean;
  direction: TelemetrySortDirection;
  align?: "left" | "right" | undefined;
  onClick: () => void;
  dotClassName?: string | undefined;
}): ReactElement => {
  const alignRight: boolean = props.align !== "left";

  return (
    <th
      scope="col"
      aria-sort={
        props.isActive
          ? props.direction === TelemetrySortDirection.Ascending
            ? "ascending"
            : "descending"
          : "none"
      }
      className={`whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wide ${
        alignRight ? "text-right" : "text-left"
      } ${props.isActive ? "text-gray-900" : "text-gray-500"}`}
    >
      <button
        type="button"
        onClick={props.onClick}
        className="inline-flex items-center gap-1.5 hover:text-gray-900"
      >
        {props.dotClassName ? (
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${props.dotClassName}`}
            aria-hidden="true"
          />
        ) : (
          <></>
        )}
        <span>{props.label}</span>
        {/*
         * Geometric shapes rather than arrows: the obvious "↕" carries an
         * emoji presentation by default and renders as a full-colour glyph in
         * the middle of a small-caps header row.
         */}
        <span
          className={`text-[9px] leading-none ${
            props.isActive ? "" : "text-gray-300"
          }`}
          aria-hidden="true"
        >
          {props.isActive
            ? props.direction === TelemetrySortDirection.Ascending
              ? "▲"
              : "▼"
            : "▾"}
        </span>
      </button>
    </th>
  );
};

/*
 * Telemetry ingestion split by tenant. The by-signal card next to this one says
 * whether the pipeline is flowing; this one says who is filling it — the
 * question behind an unexplained ingest spike, a noisy-neighbour complaint or a
 * capacity conversation with one customer.
 */
const TelemetryIngestionByProject: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<JSONObject | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  const [sortColumn, setSortColumn] = useState<TelemetrySortColumn>(
    TelemetrySortColumn.Total,
  );
  const [sortSignal, setSortSignal] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<TelemetrySortDirection>(
    TelemetrySortDirection.Descending,
  );

  const loadIngestion: () => Promise<void> = async (): Promise<void> => {
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/admin/health/clickhouse-telemetry-ingestion-by-project",
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setData(response.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadIngestion().catch(() => {
      // handled via setError
    });
  }, []);

  /*
   * Clicking the active column flips its direction; clicking a new one starts
   * it descending, because "who is sending the most" is what every one of these
   * columns is asked first.
   */
  const applySort: (
    column: TelemetrySortColumn,
    signal: string | null,
  ) => void = (column: TelemetrySortColumn, signal: string | null): void => {
    const isSameColumn: boolean =
      sortColumn === column && sortSignal === signal;

    if (isSameColumn) {
      setSortDirection(
        sortDirection === TelemetrySortDirection.Descending
          ? TelemetrySortDirection.Ascending
          : TelemetrySortDirection.Descending,
      );
      return;
    }

    setSortColumn(column);
    setSortSignal(signal);
    setSortDirection(
      column === TelemetrySortColumn.Project
        ? TelemetrySortDirection.Ascending
        : TelemetrySortDirection.Descending,
    );
  };

  const renderContent: () => ReactElement = (): ReactElement => {
    if (isInitialLoading && !data) {
      return <ComponentLoader />;
    }

    const view: TelemetryProjectIngestionView = parseProjectIngestion(data);

    if (!view.connected) {
      return (
        <div className="text-sm text-gray-500">
          ClickHouse is not reachable from this instance, so per-project
          ingestion cannot be measured.
        </div>
      );
    }

    // Totals are always over every project, never over the filtered subset.
    const summary: TelemetryProjectSummary = summarizeProjects(view.projects);
    const visibleProjects: Array<TelemetryProjectRow> = sortProjects({
      projects: filterProjects(view.projects, searchText),
      column: sortColumn,
      signalColumn: sortSignal,
      direction: sortDirection,
    });

    const isIngesting: boolean = (summary.lastHour ?? 0) > 0;

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            {formatCount(summary.lastHour)} telemetry rows from{" "}
            {summary.projectCount.toLocaleString()}{" "}
            {summary.projectCount === 1 ? "project" : "projects"} in the last
            hour
          </div>
          <Statusbubble
            text={isIngesting ? "Ingesting" : "Idle"}
            color={isIngesting ? Green : Gray500}
            shouldAnimate={isIngesting}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            label="Projects ingesting"
            value={summary.projectCount.toLocaleString()}
            hint={
              summary.topProject
                ? `Top: ${projectDisplayName(summary.topProject)}`
                : undefined
            }
          />
          <StatTile
            label="Rows / last minute"
            value={formatCompactCount(summary.lastMinute)}
          />
          <StatTile
            label="Rows / last hour"
            value={formatCompactCount(summary.lastHour)}
          />
          <StatTile
            label="Rows / last 24 hours"
            value={formatCompactCount(summary.lastDay)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          {summary.byTelemetryType.map(
            (signal: TelemetrySignalCounts): ReactElement => {
              const percent: number = computeSharePercent(
                signal.lastDay,
                summary.lastDay,
              );

              return (
                <div
                  key={signal.telemetryType}
                  className="flex items-center gap-2 text-sm"
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      SIGNAL_STYLES[signal.telemetryType]?.dot || "bg-gray-400"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-gray-700">
                    {signal.telemetryType}
                  </span>
                  <span className="tabular-nums text-gray-900">
                    {formatCount(signal.lastDay)}
                  </span>
                  <span className="text-xs text-gray-500">
                    ({formatPercent(percent)} of 24h)
                  </span>
                </div>
              );
            },
          )}
        </div>

        {view.unavailableSignals.length > 0 ? (
          <Alert
            type={AlertType.WARNING}
            title={`Could not read ${view.unavailableSignals.join(
              ", ",
            )} on this instance — those columns show "—" rather than zero.`}
          />
        ) : (
          <></>
        )}

        {view.truncated ? (
          <Alert
            type={AlertType.INFO}
            title={`Only the ${
              view.maxProjectsPerSignal === null
                ? "top"
                : `top ${view.maxProjectsPerSignal.toLocaleString()}`
            } projects per signal are listed. Smaller projects are not shown and are not included in the totals above.`}
          />
        ) : (
          <></>
        )}

        {view.projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            No project ingested telemetry in the last 24 hours.
          </div>
        ) : (
          <>
            <div className="sm:max-w-xs">
              <Input
                placeholder="Filter by project name or id"
                value={searchText}
                dataTestId="telemetry-by-project-search"
                onChange={(value: string) => {
                  setSearchText(value);
                }}
              />
            </div>

            {visibleProjects.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
                No project matches &quot;{searchText}&quot;.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <SortableHeader
                        label="Project"
                        align="left"
                        isActive={
                          sortColumn === TelemetrySortColumn.Project &&
                          !sortSignal
                        }
                        direction={sortDirection}
                        onClick={() => {
                          applySort(TelemetrySortColumn.Project, null);
                        }}
                      />
                      {TELEMETRY_SIGNAL_ORDER.map(
                        (telemetryType: string): ReactElement => {
                          return (
                            <SortableHeader
                              key={telemetryType}
                              label={telemetryType}
                              dotClassName={
                                SIGNAL_STYLES[telemetryType]?.dot ||
                                "bg-gray-400"
                              }
                              isActive={sortSignal === telemetryType}
                              direction={sortDirection}
                              onClick={() => {
                                applySort(
                                  TelemetrySortColumn.Total,
                                  telemetryType,
                                );
                              }}
                            />
                          );
                        },
                      )}
                      <SortableHeader
                        label="Total (24h)"
                        isActive={
                          sortColumn === TelemetrySortColumn.Total &&
                          !sortSignal
                        }
                        direction={sortDirection}
                        onClick={() => {
                          applySort(TelemetrySortColumn.Total, null);
                        }}
                      />
                      <th
                        scope="col"
                        className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                      >
                        Share
                      </th>
                      <SortableHeader
                        label="Last hour"
                        isActive={
                          sortColumn === TelemetrySortColumn.LastHour &&
                          !sortSignal
                        }
                        direction={sortDirection}
                        onClick={() => {
                          applySort(TelemetrySortColumn.LastHour, null);
                        }}
                      />
                      <SortableHeader
                        label="Last minute"
                        isActive={
                          sortColumn === TelemetrySortColumn.LastMinute &&
                          !sortSignal
                        }
                        direction={sortDirection}
                        onClick={() => {
                          applySort(TelemetrySortColumn.LastMinute, null);
                        }}
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleProjects.map(
                      (project: TelemetryProjectRow): ReactElement => {
                        return (
                          <tr
                            key={project.projectId}
                            className="hover:bg-gray-50"
                          >
                            <td className="max-w-xs px-3 py-2 text-sm">
                              <div
                                className="truncate font-medium text-gray-900"
                                title={projectDisplayName(project)}
                              >
                                {project.projectName || "Unnamed project"}
                              </div>
                              <div
                                className="truncate font-mono text-xs text-gray-400"
                                title={project.projectId}
                              >
                                {project.projectId}
                              </div>
                            </td>
                            {TELEMETRY_SIGNAL_ORDER.map(
                              (telemetryType: string): ReactElement => {
                                const counts: TelemetryCounts = getSignalCounts(
                                  project,
                                  telemetryType,
                                );

                                return (
                                  <td
                                    key={telemetryType}
                                    className="whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums text-gray-700"
                                  >
                                    {formatCount(counts.lastDay)}
                                  </td>
                                );
                              },
                            )}
                            <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-semibold tabular-nums text-gray-900">
                              {formatCount(project.lastDay)}
                            </td>
                            <td className="px-3 py-2">
                              <ShareBar
                                percent={computeSharePercent(
                                  project.lastDay,
                                  summary.lastDay,
                                )}
                              />
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums text-gray-700">
                              {formatCount(project.lastHour)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums text-gray-700">
                              {formatCount(project.lastMinute)}
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="text-xs text-gray-500">
          Counts use each signal&apos;s telemetry timestamp (event time), which
          tracks live ingestion, and cover the last 24 hours. A project deleted
          while its telemetry is still inside the retention window keeps
          contributing rows and is listed by its id.
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Ingestion by project"
      description="Which projects are sending logs, metrics and traces into ClickHouse, and how much of each over the last minute, hour and day."
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          buttonStyle: ButtonStyleType.NORMAL,
          isLoading: isRefreshing,
          onClick: () => {
            setIsRefreshing(true);
            loadIngestion().catch(() => {
              // handled via setError
            });
          },
        },
      ]}
    >
      <div>
        {error ? (
          <Alert type={AlertType.DANGER} title={error} className="mb-4" />
        ) : (
          <></>
        )}
        {renderContent()}
      </div>
    </Card>
  );
};

export default TelemetryIngestionByProject;
