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
    window.innerHeight,
  );
  const [autoScroll, setAutoScroll] = React.useState<boolean>(true);
  const [showScrollToBottom, setShowScrollToBottom] = React.useState<boolean>(false);
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
            <div className="bg-slate-50 -mx-6 -mb-6 px-6 py-4 border-t border-gray-200">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                {/* Auto Scroll Toggle */}
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    <Toggle
                      title=""
                      value={autoScroll}
                      onChange={(checked: boolean) => {
                        setAutoScroll(checked);
                      }}
                    />
                    <label className="text-sm font-medium text-gray-700 cursor-pointer">
                      Auto-scroll to new logs
                    </label>
                  </div>
                  {autoScroll && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                      Live
                    </span>
                  )}
                </div>

                {/* Search Button */}
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500 hidden sm:block">
                    {props.logs.length} log{props.logs.length !== 1 ? 's' : ''} found
                  </span>
                  <Button
                    title="Apply Filters"
                    icon={IconProp.Search}
                    buttonStyle={ButtonStyleType.PRIMARY}
                    buttonSize={ButtonSize.Small}
                    onClick={() => {
                      props.onFilterChanged(filterData);
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
            className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-xl border border-slate-700 shadow-2xl overflow-hidden"
            style={{
              height: screenHeight - 520,
            }}
          >
            {/* Custom Scrollbar Container */}
            <div 
              ref={scrollContainerRef}
              className="h-full overflow-y-auto scrollbar-thin scrollbar-track-slate-800 scrollbar-thumb-slate-600 hover:scrollbar-thumb-slate-500 p-4"
              onScroll={handleScroll}
            >
              {props.logs.map((log: Log, i: number) => {
                return <LogItem serviceMap={serviceMap} key={i} log={log} />;
              })}

              {props.logs.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4 text-slate-500">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-full h-full">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-slate-300 mb-2">No logs found</h3>
                    <p className="text-slate-500 text-sm">
                      {props.noLogsMessage || "Try adjusting your filters or check back later for new log entries."}
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
              className="absolute bottom-4 right-4 bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-full shadow-lg transition-all duration-200 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
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
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-xl border border-slate-700 shadow-2xl overflow-hidden"
             style={{ height: screenHeight - 520 }}>
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
