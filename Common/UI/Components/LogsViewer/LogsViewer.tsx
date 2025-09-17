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
import React, { FunctionComponent, ReactElement, Ref } from "react";
import Toggle from "../Toggle/Toggle";
import Card from "../Card/Card";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
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
}

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
  const [showScrollToBottom, setShowScrollToBottom] = React.useState<boolean>(false);
  // removed wrapLines toggle for a cleaner toolbar
  const logsViewerRef: Ref<HTMLDivElement> = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef: Ref<HTMLDivElement> = React.useRef<HTMLDivElement>(null);

  const [logAttributes, setLogAttributes] = React.useState<Array<string>>([]);

  const [isPageLoading, setIsPageLoading] = React.useState<boolean>(true);
  const [pageError, setPageError] = React.useState<string>("");

  const [serviceMap, setServiceMap] = React.useState<
    Dictionary<TelemetryService>
  >({});

  const loadAttributes: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsPageLoading(true);

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

      const attributeRepsonse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post(
          URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/logs/get-attributes",
          ),
          {},
          {
            ...ModelAPI.getCommonHeaders(),
          },
        );

      if (attributeRepsonse instanceof HTTPErrorResponse) {
        throw attributeRepsonse;
      } else {
        const attributes: Array<string> = attributeRepsonse.data[
          "attributes"
        ] as Array<string>;
        setLogAttributes(attributes);
      }

      setIsPageLoading(false);
      setPageError("");
    } catch (err) {
      setIsPageLoading(false);
      setPageError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  // Update the screen height when the window is resized

  React.useEffect(() => {
    loadAttributes().catch((err: unknown) => {
      setPageError(API.getFriendlyErrorMessage(err as Error));
    });

    const handleResize: any = (): void => {
      setScreenHeight(window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Keep scroll to the bottom of the log

  const scrollToBottom: VoidFunction = (): void => {
    const scrollContainer: HTMLDivElement | null = scrollContainerRef.current;

    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  };

  const handleScroll: VoidFunction = (): void => {
    const scrollContainer: HTMLDivElement | null = scrollContainerRef.current;
    if (scrollContainer) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollToBottom(!isNearBottom && props.logs.length > 0);
    }
  };

  React.useEffect(() => {
    if (!autoScroll) {
      return;
    }

    scrollToBottom();
  }, [props.logs]);

  React.useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
    return () => {}; // Return empty cleanup function if no scrollContainer
  }, []);

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
            <div className="-mx-6 -mb-6 px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/50">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Toggle
                      title=""
                      value={autoScroll}
                      onChange={(checked: boolean) => setAutoScroll(checked)}
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-300">{autoScroll ? "Live" : "Paused"}</span>
                  </div>
                  <span className="hidden sm:block h-4 w-px bg-slate-200 dark:bg-slate-700" />
                  <span className="text-xs text-slate-500 dark:text-slate-400">{props.logs.length} result{props.logs.length !== 1 ? "s" : ""}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    title="Apply Filters"
                    icon={IconProp.Search}
                    buttonStyle={ButtonStyleType.NORMAL}
                    buttonSize={ButtonSize.Small}
                    onClick={() => props.onFilterChanged(filterData)}
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
                {props.logs.map((log: Log, i: number) => {
                  return (
                    <li key={i} className="py-1 first:pt-0 last:pb-0">
                      <LogItem serviceMap={serviceMap} log={log} />
                    </li>
                  );
                })}
              </ul>

              {props.logs.length === 0 && (
                <div className="flex items-center justify-center h-full px-4">
                  <div className="text-center">
                    <h3 className="text-sm font-medium text-slate-300 mb-1">No logs found</h3>
                    <p className="text-slate-500 text-xs">
                      {props.noLogsMessage || "Adjust filters or check again later."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Floating Scroll to Bottom Button */}
          {showScrollToBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-3 right-3 bg-slate-700 hover:bg-slate-600 text-white p-2 rounded-md shadow transition-all"
              title="Scroll to bottom"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
          )}
        </div>
      )}
      {props.isLoading && (
        <div className="rounded-md border border-slate-700 bg-slate-900 overflow-hidden"
             style={{ height: Math.max(360, screenHeight - 360) }}>
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
