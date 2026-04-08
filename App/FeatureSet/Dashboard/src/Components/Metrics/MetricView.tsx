import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MetricQueryConfig from "./MetricQueryConfig";
import MetricGraphConfig from "./MetricFormulaConfig";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Text from "Common/Types/Text";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import StartAndEndDate, {
  StartAndEndDateType,
} from "Common/UI/Components/Date/StartAndEndDate";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Card from "Common/UI/Components/Card/Card";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import API from "Common/UI/Utils/API/API";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricUtil from "./Utils/Metrics";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricCharts from "./MetricCharts";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import IconProp from "Common/Types/Icon/IconProp";

const getFetchRelevantState: (data: MetricViewData) => unknown = (
  data: MetricViewData,
) => {
  return {
    startAndEndDate: data.startAndEndDate
      ? {
          startValue: data.startAndEndDate.startValue,
          endValue: data.startAndEndDate.endValue,
        }
      : null,
    queryConfigs: data.queryConfigs.map(
      (queryConfig: MetricQueryConfigData) => {
        return {
          metricQueryData: queryConfig.metricQueryData,
        };
      },
    ),
  };
};

export interface ComponentProps {
  data: MetricViewData;
  hideQueryElements?: boolean;
  hideStartAndEndDate?: boolean;
  onChange: (data: MetricViewData) => void;
  hideCardInQueryElements?: boolean;
  hideCardInCharts?: boolean;
  chartCssClass?: string | undefined;
}

const MetricView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [currentQueryVariable, setCurrentQueryVariable] = useState<string>(
    Text.getLetterFromAByNumber(props.data.queryConfigs.length),
  );

  const [metricTypes, setMetricTypes] = useState<Array<MetricType>>([]);

  const [
    showCannotRemoveOneRemainingQueryError,
    setShowCannotRemoveOneRemainingQueryError,
  ] = useState<boolean>(false);

  type GetEmptyQueryConfigFunction = () => MetricQueryConfigData;

  const getEmptyQueryConfigData: GetEmptyQueryConfigFunction =
    (): MetricQueryConfigData => {
      const currentVar: string = currentQueryVariable;
      setCurrentQueryVariable(Text.getNextLowercaseLetter(currentVar));

      return {
        metricAliasData: {
          metricVariable: currentVar,
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            aggegationType: MetricsAggregationType.Avg,
            metricName:
              metricTypes.length > 0 && metricTypes[0] && metricTypes[0].name
                ? metricTypes[0].name
                : "",
          },
        },
      };
    };

  const [isPageLoading, setIsPageLoading] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string>("");

  const [telemetryAttributesByMetric, setTelemetryAttributesByMetric] =
    useState<Record<string, Array<string>>>({});
  const [loadedMetricAttributes, setLoadedMetricAttributes] = useState<
    Set<string>
  >(new Set());
  const [loadingMetricAttributes, setLoadingMetricAttributes] = useState<
    Set<string>
  >(new Set());
  const [telemetryAttributesError, setTelemetryAttributesError] =
    useState<string>("");

  const metricViewDataRef: React.MutableRefObject<MetricViewData> =
    React.useRef(props.data);
  const lastFetchSnapshotRef: React.MutableRefObject<string> = React.useRef(
    JSON.stringify(getFetchRelevantState(props.data)),
  );

  useEffect(() => {
    loadMetricTypes().catch((err: Error) => {
      setPageError(API.getFriendlyErrorMessage(err as Error));
    });
  }, []);

  useEffect(() => {
    const hasChanged: boolean = JSONFunctions.isJSONObjectDifferent(
      metricViewDataRef.current,
      props.data,
    );

    if (hasChanged) {
      setCurrentQueryVariable(
        Text.getLetterFromAByNumber(props.data.queryConfigs.length),
      );
    }

    const currentFetchSnapshot: string = JSON.stringify(
      getFetchRelevantState(props.data),
    );

    const shouldFetch: boolean =
      currentFetchSnapshot !== lastFetchSnapshotRef.current &&
      Boolean(props.data?.startAndEndDate?.startValue) &&
      Boolean(props.data?.startAndEndDate?.endValue);

    if (shouldFetch) {
      lastFetchSnapshotRef.current = currentFetchSnapshot;
      fetchAggregatedResults().catch((err: Error) => {
        setMetricResultsError(API.getFriendlyErrorMessage(err as Error));
      });
    }

    if (hasChanged) {
      metricViewDataRef.current = props.data;
    }
  }, [props.data]);

  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );

  const [isMetricResultsLoading, setIsMetricResultsLoading] =
    useState<boolean>(false);
  const [metricResultsError, setMetricResultsError] = useState<string>("");

  const loadMetricTypes: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsPageLoading(true);

      const {
        metricTypes,
      }: {
        metricTypes: Array<MetricType>;
      } = await MetricUtil.loadAllMetricsTypes({
        includeAttributes: false,
      });

      setMetricTypes(metricTypes);
      setTelemetryAttributesByMetric({});
      setLoadedMetricAttributes(new Set());
      setLoadingMetricAttributes(new Set());
      setTelemetryAttributesError("");

      setIsPageLoading(false);
      setPageError("");

      /// if there's no query then set the default query and fetch results.
      if (
        props.data.queryConfigs.length === 0 &&
        metricTypes.length > 0 &&
        metricTypes[0] &&
        metricTypes[0].name
      ) {
        // then  add a default query which would be the first
        if (props.onChange) {
          props.onChange({
            ...props.data,
            queryConfigs: [
              {
                metricAliasData: {
                  metricVariable: "a",
                  legend: "",
                  title: "",
                  description: "",
                  legendUnit: "",
                },
                metricQueryData: {
                  filterData: {
                    metricName: metricTypes[0].name,
                    aggegationType: MetricsAggregationType.Avg,
                  },
                },
              },
            ],
          });
        }
      }

      if (props.data) {
        fetchAggregatedResults().catch((err: Error) => {
          setMetricResultsError(API.getFriendlyErrorMessage(err as Error));
        });
      }
    } catch (err) {
      setIsPageLoading(false);
      setPageError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  const loadTelemetryAttributesForMetric: (
    metricName: string,
  ) => Promise<void> = async (metricName: string): Promise<void> => {
    if (!metricName) {
      return;
    }

    if (
      loadingMetricAttributes.has(metricName) ||
      loadedMetricAttributes.has(metricName)
    ) {
      return;
    }

    try {
      setLoadingMetricAttributes((prev: Set<string>) => {
        const next: Set<string> = new Set(prev);
        next.add(metricName);
        return next;
      });
      setTelemetryAttributesError("");

      const attributes: Array<string> =
        await MetricUtil.getTelemetryAttributes({ metricName });

      setTelemetryAttributesByMetric(
        (prev: Record<string, Array<string>>) => ({
          ...prev,
          [metricName]: attributes,
        }),
      );
      setLoadedMetricAttributes((prev: Set<string>) => {
        const next: Set<string> = new Set(prev);
        next.add(metricName);
        return next;
      });
    } catch (err) {
      setTelemetryAttributesError(
        `We couldn't load metric attributes. ${API.getFriendlyErrorMessage(err as Error)}`,
      );
    } finally {
      setLoadingMetricAttributes((prev: Set<string>) => {
        const next: Set<string> = new Set(prev);
        next.delete(metricName);
        return next;
      });
    }
  };

  const handleAdvancedFiltersToggle: (
    show: boolean,
    metricName?: string,
  ) => void = (show: boolean, metricName?: string): void => {
    if (show && metricName) {
      void loadTelemetryAttributesForMetric(metricName);
    }
  };

  const fetchAggregatedResults: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsMetricResultsLoading(true);

      if (
        !props.data.startAndEndDate?.startValue ||
        !props.data.startAndEndDate?.endValue
      ) {
        setIsMetricResultsLoading(false);
        return;
      }
      try {
        const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
          metricViewData: props.data,
        });

        setMetricResults(results);
        setMetricResultsError("");
      } catch (err: unknown) {
        setMetricResultsError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsMetricResultsLoading(false);
    };

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage message={pageError} />;
  }

  return (
    <Fragment>
      <div className="space-y-4">
        {/* Time range selector */}
        {!props.hideStartAndEndDate && (
          <Card>
            <div className="-mt-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Time Range
                </span>
              </div>
              <StartAndEndDate
                type={StartAndEndDateType.DateTime}
                value={props.data.startAndEndDate || undefined}
                onValueChanged={(startAndEndDate: InBetween<Date> | null) => {
                  if (props.onChange) {
                    props.onChange({
                      ...props.data,
                      startAndEndDate: startAndEndDate,
                    });
                  }
                }}
              />
            </div>
          </Card>
        )}

        {/* Query configs */}
        {!props.hideQueryElements && (
          <div className="space-y-3">
            {props.data.queryConfigs.map(
              (queryConfig: MetricQueryConfigData, index: number) => {
                return (
                  <MetricQueryConfig
                    key={index}
                    onChange={(data: MetricQueryConfigData) => {
                      const newGraphConfigs: Array<MetricQueryConfigData> = [
                        ...props.data.queryConfigs,
                      ];
                      newGraphConfigs[index] = data;
                      if (props.onChange) {
                        props.onChange({
                          ...props.data,
                          queryConfigs: newGraphConfigs,
                        });
                      }
                    }}
                    data={queryConfig}
                    hideCard={props.hideCardInQueryElements}
                    telemetryAttributes={
                      telemetryAttributesByMetric[
                        queryConfig.metricQueryData?.filterData?.metricName?.toString() ||
                          ""
                      ] || []
                    }
                    metricTypes={metricTypes}
                    onAdvancedFiltersToggle={(show: boolean) => {
                      handleAdvancedFiltersToggle(
                        show,
                        queryConfig.metricQueryData?.filterData?.metricName?.toString(),
                      );
                    }}
                    attributesLoading={loadingMetricAttributes.has(
                      queryConfig.metricQueryData?.filterData?.metricName?.toString() ||
                        "",
                    )}
                    attributesError={telemetryAttributesError}
                    onMetricNameChanged={(metricName: string) => {
                      void loadTelemetryAttributesForMetric(metricName);
                    }}
                    onAttributesRetry={() => {
                      const metricName: string =
                        queryConfig.metricQueryData?.filterData?.metricName?.toString() ||
                        "";
                      if (metricName) {
                        setLoadedMetricAttributes((prev: Set<string>) => {
                          const next: Set<string> = new Set(prev);
                          next.delete(metricName);
                          return next;
                        });
                        void loadTelemetryAttributesForMetric(metricName);
                      }
                    }}
                    onRemove={() => {
                      if (props.data.queryConfigs.length === 1) {
                        setShowCannotRemoveOneRemainingQueryError(true);
                        return;
                      }

                      const newGraphConfigs: Array<MetricQueryConfigData> = [
                        ...props.data.queryConfigs,
                      ];
                      newGraphConfigs.splice(index, 1);

                      if (props.onChange) {
                        props.onChange({
                          ...props.data,
                          queryConfigs: newGraphConfigs,
                        });
                      }
                    }}
                  />
                );
              },
            )}
          </div>
        )}

        {/* Formula configs and Add buttons */}
        {!props.hideQueryElements && (
          <div className="space-y-3">
            {props.data.formulaConfigs.length > 0 && (
              <div className="space-y-3">
                {props.data.formulaConfigs.map(
                  (formulaConfig: MetricFormulaConfigData, index: number) => {
                    return (
                      <MetricGraphConfig
                        key={index}
                        onDataChanged={(data: MetricFormulaConfigData) => {
                          const newGraphConfigs: Array<MetricFormulaConfigData> =
                            [...props.data.formulaConfigs];
                          newGraphConfigs[index] = data;
                          if (props.onChange) {
                            props.onChange({
                              ...props.data,
                              formulaConfigs: newGraphConfigs,
                            });
                          }
                        }}
                        data={formulaConfig}
                        onRemove={() => {
                          const newGraphConfigs: Array<MetricFormulaConfigData> =
                            [...props.data.formulaConfigs];
                          newGraphConfigs.splice(index, 1);
                          if (props.onChange) {
                            props.onChange({
                              ...props.data,
                              formulaConfigs: newGraphConfigs,
                            });
                          }
                        }}
                      />
                    );
                  },
                )}
              </div>
            )}

            {/* Add metric button */}
            <div className="flex items-center">
              <Button
                title="Add Metric"
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.OUTLINE}
                icon={IconProp.Add}
                onClick={() => {
                  if (props.onChange) {
                    props.onChange({
                      ...props.data,
                      queryConfigs: [
                        ...props.data.queryConfigs,
                        getEmptyQueryConfigData(),
                      ],
                    });
                  }
                }}
              />
            </div>
          </div>
        )}

        {/* Chart results */}
        {isMetricResultsLoading && <ComponentLoader />}

        {metricResultsError && <ErrorMessage message={metricResultsError} />}

        {!isMetricResultsLoading && !metricResultsError && (
          <div
            className={props.hideCardInCharts ? "" : "grid grid-cols-1 gap-4"}
          >
            <MetricCharts
              hideCard={props.hideCardInCharts}
              metricResults={metricResults}
              metricTypes={metricTypes}
              metricViewData={props.data}
              chartCssClass={props.chartCssClass}
            />
          </div>
        )}
      </div>

      {showCannotRemoveOneRemainingQueryError ? (
        <ConfirmModal
          title={`Cannot Remove Query`}
          description={`Cannot remove query because there must be at least one query.`}
          isLoading={false}
          submitButtonText={"Close"}
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            return setShowCannotRemoveOneRemainingQueryError(false);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default MetricView;
