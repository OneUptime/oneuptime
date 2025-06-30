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
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import StartAndEndDate, {
  StartAndEndDateType,
} from "Common/UI/Components/Date/StartAndEndDate";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
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

  const [telemetryAttributes, setTelemetryAttributes] = useState<Array<string>>(
    [],
  );

  const metricViewDataRef: React.MutableRefObject<MetricViewData> =
    React.useRef(props.data);

  useEffect(() => {
    loadAllMetricsTypes().catch((err: Error) => {
      setPageError(API.getFriendlyErrorMessage(err as Error));
    });
  }, []);

  useEffect(() => {
    const hasChanged: boolean = JSONFunctions.isJSONObjectDifferent(
      metricViewDataRef.current,
      props.data,
    );

    if (
      hasChanged &&
      props.data &&
      props.data.startAndEndDate &&
      props.data.startAndEndDate.startValue &&
      props.data.startAndEndDate.endValue
    ) {
      setCurrentQueryVariable(
        Text.getLetterFromAByNumber(props.data.queryConfigs.length),
      );
      fetchAggregatedResults().catch((err: Error) => {
        setMetricResultsError(API.getFriendlyErrorMessage(err as Error));
      });

      metricViewDataRef.current = props.data;
    }
  }, [props.data]);

  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );

  const [isMetricResultsLoading, setIsMetricResultsLoading] =
    useState<boolean>(false);
  const [metricResultsError, setMetricResultsError] = useState<string>("");

  const loadAllMetricsTypes: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsPageLoading(true);

      const {
        metricTypes,
        telemetryAttributes,
      }: {
        metricTypes: Array<MetricType>;
        telemetryAttributes: Array<string>;
      } = await MetricUtil.loadAllMetricsTypes();

      setMetricTypes(metricTypes);
      setTelemetryAttributes(telemetryAttributes);

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
      <div className="space-y-3">
        {!props.hideStartAndEndDate && (
          <div className="mb-5">
            <Card>
              <div className="-mt-5">
                <FieldLabelElement title="Start and End Time" required={true} />
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
          </div>
        )}

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
                    telemetryAttributes={telemetryAttributes}
                    metricTypes={metricTypes}
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
      </div>

      {!props.hideQueryElements && (
        <div className="space-y-3">
          <div className="space-y-3">
            {props.data.formulaConfigs.map(
              (formulaConfig: MetricFormulaConfigData, index: number) => {
                return (
                  <MetricGraphConfig
                    key={index}
                    onDataChanged={(data: MetricFormulaConfigData) => {
                      const newGraphConfigs: Array<MetricFormulaConfigData> = [
                        ...props.data.formulaConfigs,
                      ];
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
                      const newGraphConfigs: Array<MetricFormulaConfigData> = [
                        ...props.data.formulaConfigs,
                      ];
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
          <div>
            <div className="flex -ml-3 mt-8 justify-between w-full">
              <div>
                <Button
                  title="Add Metric"
                  buttonSize={ButtonSize.Small}
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
                {/* <Button
              title="Add Formula"
              buttonSize={ButtonSize.Small}
              onClick={() => {
                setMetricViewData({
                  ...metricViewData,
                  formulaConfigs: [
                    ...metricViewData.formulaConfigs,
                    getEmptyFormulaConfigData(),
                  ],
                });
              }}
            /> */}
              </div>
            </div>
          </div>
          <HorizontalRule />
        </div>
      )}

      {isMetricResultsLoading && <ComponentLoader />}

      {metricResultsError && <ErrorMessage message={metricResultsError} />}

      {!isMetricResultsLoading && !metricResultsError && (
        <div className="grid grid-cols-1 gap-4 mt-3">
          {/** charts */}
          <MetricCharts
            hideCard={props.hideCardInCharts}
            metricResults={metricResults}
            metricTypes={metricTypes}
            metricViewData={props.data}
            chartCssClass={props.chartCssClass}
          />
        </div>
      )}

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
