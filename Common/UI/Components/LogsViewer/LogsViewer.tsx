import Query from "../../../Types/BaseDatabase/Query";
import DropdownUtil from "../../Utils/Dropdown";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import FiltersForm from "../Filters/FiltersForm";
import FieldType from "../Types/FieldType";
import LogItem from "./LogItem";
import {
  PromiseVoidFunction,
  VoidFunction,
} from "../../../Types/FunctionTypes";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import React, {
  FunctionComponent,
  ReactElement,
  Ref,
  useCallback,
  useMemo,
} from "react";
import Toggle from "../Toggle/Toggle";
import Card from "../Card/Card";
import Icon from "../Icon/Icon";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import API from "../../Utils/API/API";
import { APP_API_URL } from "../../Config";
import PageLoader from "../Loader/PageLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import TelemetryService from "../../../Models/DatabaseModels/TelemetryService";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Dictionary from "../../../Types/Dictionary";

export interface ComponentProps {
  logs: Array<Log>;
  onFilterChanged: (filterOptions: Query<Log>) => void;
  filterData: Query<Log>;
  isLoading: boolean;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  getTraceRoute?: (traceId: string, log: Log) => Route | URL | undefined;
  getSpanRoute?: (spanId: string, log: Log) => Route | URL | undefined;
}

type OptionalTraceRouteProps = {
  getTraceRoute?: (traceId: string, log: Log) => Route | URL | undefined;
};

type OptionalSpanRouteProps = {
  getSpanRoute?: (spanId: string, log: Log) => Route | URL | undefined;
};

const LogsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [filterData, setFilterData] = React.useState<Query<Log>>(
    props.filterData,
  );

  const [screenHeight, setScreenHeight] = React.useState<number>(
    typeof window !== "undefined" ? window.innerHeight : 900,
  );
  const [autoScroll, setAutoScroll] = React.useState<boolean>(true);
  const [showScrollToLatest, setShowScrollToLatest] =
    React.useState<boolean>(false);
  const [isDescending, setIsDescending] = React.useState<boolean>(false);
  // removed wrapLines toggle for a cleaner toolbar
  const logsViewerRef: Ref<HTMLDivElement> = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef: Ref<HTMLDivElement> =
    React.useRef<HTMLDivElement>(null);

  const [logAttributes, setLogAttributes] = React.useState<Array<string>>([]);
  const [attributesLoaded, setAttributesLoaded] =
    React.useState<boolean>(false);
  const [attributesLoading, setAttributesLoading] =
    React.useState<boolean>(false);
  const [attributesError, setAttributesError] = React.useState<string>("");
  const [areAdvancedFiltersVisible, setAreAdvancedFiltersVisible] =
    React.useState<boolean>(false);

  const [isPageLoading, setIsPageLoading] = React.useState<boolean>(true);
  const [pageError, setPageError] = React.useState<string>("");

  const [serviceMap, setServiceMap] = React.useState<
    Dictionary<TelemetryService>
  >({});

  const displayLogs: Array<Log> = useMemo(() => {
    if (isDescending) {
      return [...props.logs].reverse();
    }

    return props.logs;
  }, [props.logs, isDescending]);

  const loadTelemetryServices: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        setIsPageLoading(true);
        setPageError("");

        const telemetryServices: ListResult<TelemetryService> =
          await ModelAPI.getList({
            modelType: TelemetryService,
            query: {},
            select: {
              name: true,
              serviceColor: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {
              name: SortOrder.Ascending,
            },
          });
        const services: Dictionary<TelemetryService> = {};

        telemetryServices.data.forEach((service: TelemetryService) => {
          services[service.id!.toString()!] = service;
        });

        setServiceMap(services);
      } catch (err) {
        setPageError(
          `We couldn't load telemetry service metadata. ${API.getFriendlyErrorMessage(err as Error)}`,
        );
      } finally {
        setIsPageLoading(false);
      }
    }, []);

  const loadAttributes: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        setAttributesLoading(true);
        setAttributesError("");

        const attributeRepsonse: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/get-attributes",
            ),
            data: {},
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (attributeRepsonse instanceof HTTPErrorResponse) {
          throw attributeRepsonse;
        }

        const attributes: Array<string> = (attributeRepsonse.data[
          "attributes"
        ] || []) as Array<string>;
        setLogAttributes(attributes);
        setAttributesLoaded(true);
      } catch (err) {
        setLogAttributes([]);
        setAttributesLoaded(false);
        setAttributesError(
          `We couldn't load log attributes. Filters may be limited. ${API.getFriendlyErrorMessage(err as Error)}`,
        );
      } finally {
        setAttributesLoading(false);
      }
    }, []);

  // Update the screen height when the window is resized

  React.useEffect(() => {
    void loadTelemetryServices();

    const handleResize: any = (): void => {
      setScreenHeight(window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [loadTelemetryServices]);

  // Keep scroll aligned with the latest log entry

  const scrollToLatest: VoidFunction = (): void => {
    const scrollContainer: HTMLDivElement | null = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    if (isDescending) {
      scrollContainer.scrollTop = 0;
      return;
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  };

  const applySortDirection = (nextDescending: boolean): void => {
    setShowScrollToLatest(false);
    setIsDescending((previous: boolean) => {
      if (previous === nextDescending) {
        return previous;
      }

      // Apply scroll alignment after the DOM reorders log entries.
      setTimeout(() => {
        const scrollContainer: HTMLDivElement | null =
          scrollContainerRef.current;

        if (!scrollContainer) {
          return;
        }

        if (nextDescending) {
          scrollContainer.scrollTop = 0;
          return;
        }

        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }, 0);

      return nextDescending;
    });
  };

  const handleScroll: VoidFunction = React.useCallback((): void => {
    const scrollContainer: HTMLDivElement | null = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const isNearLatest: boolean = isDescending
      ? scrollTop < 100
      : scrollHeight - scrollTop - clientHeight < 100;
    setShowScrollToLatest(!isNearLatest && displayLogs.length > 0);
  }, [isDescending, displayLogs.length]);

  React.useEffect(() => {
    if (!autoScroll) {
      return;
    }

    scrollToLatest();
  }, [props.logs, autoScroll, isDescending]);

  React.useEffect(() => {
    const scrollContainer: HTMLDivElement | null = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll);
      return () => {
        return scrollContainer.removeEventListener("scroll", handleScroll);
      };
    }
    return () => {}; // Return empty cleanup function if no scrollContainer
  }, [handleScroll]);

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }
  if (pageError) {
    return <ErrorMessage message={pageError} />;
  }
  return (
    <div>
      {props.showFilters && (
        <div className="mb-6">
          <Card>
            <div className="-mt-8">
              <FiltersForm<Log>
                id="logs-filter"
                showFilter={props.showFilters}
                filterData={props.filterData}
                onFilterChanged={(filterData: Query<Log>) => {
                  setFilterData(filterData);
                }}
                onAdvancedFiltersToggle={(show: boolean) => {
                  setAreAdvancedFiltersVisible(show);

                  if (show && !attributesLoaded && !attributesLoading) {
                    void loadAttributes();
                  }
                }}
                isFilterLoading={areAdvancedFiltersVisible && attributesLoading}
                filterError={
                  areAdvancedFiltersVisible && attributesError
                    ? attributesError
                    : undefined
                }
                onFilterRefreshClick={
                  areAdvancedFiltersVisible && attributesError
                    ? () => {
                        void loadAttributes();
                      }
                    : undefined
                }
                filters={[
                  {
                    key: "body",
                    type: FieldType.Text,
                    title: "Search Log",
                  },
                  {
                    key: "severityText",
                    filterDropdownOptions:
                      DropdownUtil.getDropdownOptionsFromEnum(LogSeverity),
                    type: FieldType.Dropdown,
                    title: "Log Severity",
                    isAdvancedFilter: true,
                  },
                  {
                    key: "time",
                    type: FieldType.DateTime,
                    title: "Start and End Date",
                    isAdvancedFilter: true,
                  },
                  {
                    key: "attributes",
                    type: FieldType.JSON,
                    title: "Filter by Attributes",
                    jsonKeys: logAttributes,
                    isAdvancedFilter: true,
                  },
                ]}
              />
            </div>

            {/* Enhanced Controls Section */}
            <div className="-mx-6 -mb-6 px-6 py-3 border-t border-slate-200 bg-white/50">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Toggle
                      title=""
                      value={autoScroll}
                      onChange={(checked: boolean) => {
                        return setAutoScroll(checked);
                      }}
                    />
                    <span className="text-xs text-slate-600">
                      {autoScroll ? "Live" : "Paused"}
                    </span>
                  </div>
                  <span className="hidden sm:block h-4 w-px bg-slate-200" />
                  <span className="text-xs text-slate-500">
                    {displayLogs.length} result
                    {displayLogs.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm ring-1 ring-slate-200/60">
                    <button
                      type="button"
                      aria-pressed={isDescending}
                      className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                        isDescending
                          ? "bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500/40"
                          : "text-slate-500 hover:text-indigo-600"
                      }`}
                      onClick={() => {
                        applySortDirection(true);
                      }}
                    >
                      <Icon
                        icon={IconProp.BarsArrowDown}
                        className={`h-4 w-4 ${
                          isDescending
                            ? "text-white/90"
                            : "text-slate-400"
                        }`}
                      />
                      <span>Newest first</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={!isDescending}
                      className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                        !isDescending
                          ? "bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500/40"
                          : "text-slate-500 hover:text-indigo-600"
                      }`}
                      onClick={() => {
                        applySortDirection(false);
                      }}
                    >
                      <Icon
                        icon={IconProp.BarsArrowUp}
                        className={`h-4 w-4 ${
                          !isDescending
                            ? "text-white/90"
                            : "text-slate-400"
                        }`}
                      />
                      <span>Oldest first</span>
                    </button>
                  </div>
                  <Button
                    title="Apply Filters"
                    icon={IconProp.Search}
                    buttonStyle={ButtonStyleType.NORMAL}
                    buttonSize={ButtonSize.Small}
                    onClick={() => {
                      return props.onFilterChanged(filterData);
                    }}
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
      {!props.isLoading && (
        <div className="relative">
          <div
            ref={logsViewerRef}
            className="rounded-md border border-slate-700 bg-slate-900 overflow-hidden"
            style={{
              height: Math.max(360, screenHeight - 360),
            }}
          >
            {/* Custom Scrollbar Container */}
            <div
              ref={scrollContainerRef}
              className={`h-full overflow-y-auto p-2 sm:p-3 antialiased`}
              onScroll={handleScroll}
            >
              <ul role="list" className="divide-y divide-slate-800">
                {displayLogs.map((log: Log, i: number) => {
                  const traceRouteProps: OptionalTraceRouteProps =
                    props.getTraceRoute
                      ? { getTraceRoute: props.getTraceRoute }
                      : {};
                  const spanRouteProps: OptionalSpanRouteProps =
                    props.getSpanRoute
                      ? { getSpanRoute: props.getSpanRoute }
                      : {};
                  return (
                    <li key={i} className="py-1 first:pt-0 last:pb-0">
                      <LogItem
                        serviceMap={serviceMap}
                        log={log}
                        {...traceRouteProps}
                        {...spanRouteProps}
                      />
                    </li>
                  );
                })}
              </ul>

              {displayLogs.length === 0 && (
                <div className="flex items-center justify-center h-full px-4">
                  <div className="text-center">
                    <h3 className="text-sm font-medium text-slate-300 mb-1">
                      No logs found
                    </h3>
                    <p className="text-slate-500 text-xs">
                      {props.noLogsMessage ||
                        "Adjust filters or check again later."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Floating Scroll to Latest Button */}
          {showScrollToLatest && (
            <button
              onClick={scrollToLatest}
              className="absolute bottom-3 right-3 bg-slate-700 hover:bg-slate-600 text-white p-2 rounded-md shadow transition-all"
              title={isDescending ? "Scroll to top" : "Scroll to bottom"}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {isDescending ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 14l7-7 7 7m-7-7v18"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 10l-7 7-7-7m7 7V3"
                  />
                )}
              </svg>
            </button>
          )}
        </div>
      )}
      {props.isLoading && (
        <div
          className="rounded-md border border-slate-700 bg-slate-900 overflow-hidden"
          style={{ height: Math.max(360, screenHeight - 360) }}
        >
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <ComponentLoader />
              <p className="text-slate-400 text-sm mt-4">Loading logs...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LogsViewer;
