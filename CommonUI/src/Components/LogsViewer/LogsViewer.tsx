import Query from "Common/Types/BaseDatabase/Query";
import DropdownUtil from "../../Utils/Dropdown";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import FiltersForm from "../Filters/FiltersForm";
import FieldType from "../Types/FieldType";
import LogItem from "./LogItem";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import Log, { LogSeverity } from "Model/AnalyticsModels/Log";
import React, { FunctionComponent, ReactElement, Ref } from "react";
import Toggle from "../Toggle/Toggle";
import Card from "../Card/Card";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "../../Utils/API/API";
import { APP_API_URL } from "../../Config";
import PageLoader from "../Loader/PageLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";

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
  const logsViewerRef: Ref<HTMLDivElement> = React.useRef<HTMLDivElement>(null);

  const [logAttributes, setLogAttributes] = React.useState<Array<string>>([]);

  const [isPageLoading, setIsPageLoading] = React.useState<boolean>(true);
  const [pageError, setPageError] = React.useState<string>("");

  const loadAttributes: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsPageLoading(true);

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
    const logsViewer: HTMLDivElement | null = logsViewerRef.current;

    if (logsViewer) {
      logsViewer.scrollTop = logsViewer.scrollHeight;
    }
  };

  React.useEffect(() => {
    if (!autoScroll) {
      return;
    }

    scrollToBottom();
  }, [props.logs]);

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage error={pageError} />;
  }

  return (
    <div>
      {props.showFilters && (
        <div className="mb-5">
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

            <div className="flex justify-between">
              <div>
                <Toggle
                  title="Auto Scroll"
                  value={autoScroll}
                  onChange={(checked: boolean) => {
                    setAutoScroll(checked);
                  }}
                />
              </div>
              <div>
                <Button
                  title="Search Logs"
                  icon={IconProp.Search}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  onClick={() => {
                    props.onFilterChanged(filterData);
                  }}
                />
              </div>
            </div>
          </Card>
        </div>
      )}
      {!props.isLoading && (
        <div
          ref={logsViewerRef}
          className="shadow-xl rounded-xl bg-slate-800 p-5 overflow-hidden hover:overflow-y-auto dark-scrollbar"
          style={{
            height: screenHeight - 520,
          }}
        >
          {props.logs.map((log: Log, i: number) => {
            return <LogItem key={i} log={log} />;
          })}

          {props.logs.length === 0 && (
            <div className={`text-slate-200 courier-prime`}>
              {props.noLogsMessage || "No logs found for this service."}
            </div>
          )}
        </div>
      )}
      {props.isLoading && <ComponentLoader />}
    </div>
  );
};

export default LogsViewer;
