import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import Label from "Common/Models/DatabaseModels/Label";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import MonitorTypeUtil from "../../Utils/MonitorType";
import {
  CustomElementProps,
  FormFieldStyleType,
} from "Common/UI/Components/Forms/Types/Field";
import MonitorSteps from "../../Components/Form/Monitor/MonitorSteps";
import MonitorStepsType from "Common/Types/Monitor/MonitorSteps";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import OneUptimeDate from "Common/Types/Date";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import {
  buildFormulaConfigsFromSerializedFormulas,
  buildQueryConfigsFromSerializedQueries,
} from "../../Components/Metrics/Utils/MetricConfigReconstruct";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import MonitoringInterval from "../../Utils/MonitorIntervalDropdownOptions";
import Card from "Common/UI/Components/Card/Card";

/*
 * Candidate rolling windows for "create monitor from this explorer view" —
 * the explorer's arbitrary window snaps to the nearest one. Ordered
 * ascending in minutes.
 */
const ROLLING_TIME_CANDIDATES: Array<{
  minutes: number;
  rollingTime: RollingTime;
}> = [
  { minutes: 1, rollingTime: RollingTime.Past1Minute },
  { minutes: 5, rollingTime: RollingTime.Past5Minutes },
  { minutes: 10, rollingTime: RollingTime.Past10Minutes },
  { minutes: 15, rollingTime: RollingTime.Past15Minutes },
  { minutes: 30, rollingTime: RollingTime.Past30Minutes },
  { minutes: 60, rollingTime: RollingTime.Past1Hour },
  { minutes: 120, rollingTime: RollingTime.Past2Hours },
  { minutes: 180, rollingTime: RollingTime.Past3Hours },
  { minutes: 360, rollingTime: RollingTime.Past6Hours },
  { minutes: 720, rollingTime: RollingTime.Past12Hours },
  // Past1Hours is the enum's (historically misnamed) "Past 1 Day" member.
  { minutes: 1440, rollingTime: RollingTime.Past1Hours },
  { minutes: 2880, rollingTime: RollingTime.Past2Days },
  { minutes: 4320, rollingTime: RollingTime.Past3Days },
  { minutes: 10080, rollingTime: RollingTime.Past7Days },
  { minutes: 20160, rollingTime: RollingTime.Past14Days },
  { minutes: 43200, rollingTime: RollingTime.Past30Days },
  { minutes: 86400, rollingTime: RollingTime.Past60Days },
  { minutes: 129600, rollingTime: RollingTime.Past90Days },
  { minutes: 259200, rollingTime: RollingTime.Past180Days },
  { minutes: 525600, rollingTime: RollingTime.Past365Days },
];

function getNearestRollingTimeForWindow(): RollingTime {
  const startTimeParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.StartTime,
  );
  const endTimeParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.EndTime,
  );

  // No window on the link — fall back to the explorer's default hour.
  if (
    !startTimeParam ||
    !endTimeParam ||
    !OneUptimeDate.isValidDateString(startTimeParam) ||
    !OneUptimeDate.isValidDateString(endTimeParam)
  ) {
    return RollingTime.Past1Hour;
  }

  const windowMinutes: number =
    (OneUptimeDate.fromString(endTimeParam).getTime() -
      OneUptimeDate.fromString(startTimeParam).getTime()) /
    60000;

  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    return RollingTime.Past1Hour;
  }

  let nearest: { minutes: number; rollingTime: RollingTime } =
    ROLLING_TIME_CANDIDATES[0]!;

  for (const candidate of ROLLING_TIME_CANDIDATES) {
    if (
      Math.abs(candidate.minutes - windowMinutes) <
      Math.abs(nearest.minutes - windowMinutes)
    ) {
      nearest = candidate;
    }
  }

  return nearest.rollingTime;
}

function buildThresholdCriteriaInstance(input: {
  name: string;
  description: string;
  filters: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.Any,
    filters: input.filters,
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: input.name,
    description: input.description,
  };

  return instance;
}

const MonitorCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const monitorTemplateId: string | null =
    Navigation.getQueryStringByName("monitorTemplateId");

  const [isLoading, setIsLoading] = useState<boolean>(
    Boolean(monitorTemplateId),
  );
  const [error, setError] = useState<string>("");
  const [initialValues, setInitialValues] = useState<JSONObject>({});

  /*
   * "Create monitor from this view" deep link from the metric explorer:
   * pre-seed a Metric monitor from the shared serializer's
   * metricQueries/metricFormulas params (plus the window → rolling time).
   * Any warning/critical thresholds on the queries become generated
   * warning/critical criteria; otherwise criteria stay at the form's
   * defaults. Template links take priority — they carry full steps.
   */
  const preSeedFromMetricExplorerLink: (rawMetricQueries: string) => void = (
    rawMetricQueries: string,
  ): void => {
    const serializedQueries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(rawMetricQueries);

    if (serializedQueries.length === 0) {
      return;
    }

    const rawMetricFormulas: string | null = Navigation.getQueryStringByName(
      MetricExplorerUrlParam.MetricFormulas,
    );
    const serializedFormulas: Array<SerializedMetricFormula> = rawMetricFormulas
      ? MetricExplorerUrl.parseMetricFormulasParam(rawMetricFormulas)
      : [];

    const queryConfigs: Array<MetricQueryConfigData> =
      buildQueryConfigsFromSerializedQueries(serializedQueries);
    const formulaConfigs: Array<MetricFormulaConfigData> =
      buildFormulaConfigsFromSerializedFormulas(
        serializedFormulas,
        queryConfigs.length,
      );

    const monitorSteps: MonitorStepsType = new MonitorStepsType();
    const monitorStep: MonitorStep | undefined =
      monitorSteps.data?.monitorStepsInstanceArray[0];

    if (!monitorStep || !monitorStep.data) {
      return;
    }

    monitorStep.data.metricMonitor = {
      metricViewConfig: {
        queryConfigs: queryConfigs,
        formulaConfigs: formulaConfigs,
      },
      rollingTime: getNearestRollingTimeForWindow(),
    };

    const warningFilters: Array<CriteriaFilter> = [];
    const criticalFilters: Array<CriteriaFilter> = [];

    for (const queryConfig of queryConfigs) {
      const metricAlias: string =
        queryConfig.metricAliasData?.metricVariable || "";

      const buildFilter: (thresholdValue: number) => CriteriaFilter = (
        thresholdValue: number,
      ): CriteriaFilter => {
        return {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: thresholdValue,
          metricMonitorOptions: {
            metricAggregationType: EvaluateOverTimeType.AnyValue,
            ...(metricAlias ? { metricAlias: metricAlias } : {}),
          },
        };
      };

      if (queryConfig.criticalThreshold !== undefined) {
        criticalFilters.push(buildFilter(queryConfig.criticalThreshold));
      }

      if (queryConfig.warningThreshold !== undefined) {
        warningFilters.push(buildFilter(queryConfig.warningThreshold));
      }
    }

    const criteriaInstances: Array<MonitorCriteriaInstance> = [];

    if (criticalFilters.length > 0) {
      criteriaInstances.push(
        buildThresholdCriteriaInstance({
          name: "Critical",
          description:
            "Generated from the critical threshold on the metric explorer view.",
          filters: criticalFilters,
        }),
      );
    }

    if (warningFilters.length > 0) {
      criteriaInstances.push(
        buildThresholdCriteriaInstance({
          name: "Warning",
          description:
            "Generated from the warning threshold on the metric explorer view.",
          filters: warningFilters,
        }),
      );
    }

    if (criteriaInstances.length > 0) {
      const monitorCriteria: MonitorCriteria = new MonitorCriteria();
      monitorCriteria.data = {
        monitorCriteriaInstanceArray: criteriaInstances,
      };
      monitorStep.data.monitorCriteria = monitorCriteria;
    }

    setInitialValues({
      monitorType: MonitorType.Metrics,
      monitorSteps: monitorSteps.toJSON(),
    });
  };

  useEffect(() => {
    if (monitorTemplateId) {
      fetchMonitorTemplate(new ObjectID(monitorTemplateId));
      return;
    }

    const rawMetricQueries: string | null = Navigation.getQueryStringByName(
      MetricExplorerUrlParam.MetricQueries,
    );

    if (rawMetricQueries) {
      preSeedFromMetricExplorerLink(rawMetricQueries);
    }
  }, []);

  const fetchMonitorTemplate: (id: ObjectID) => Promise<void> = async (
    id: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const template: MonitorTemplate | null =
        await ModelAPI.getItem<MonitorTemplate>({
          modelType: MonitorTemplate,
          id: id,
          select: {
            monitorName: true,
            monitorDescription: true,
            monitorType: true,
            monitorSteps: true,
            monitoringInterval: true,
            labels: true,
          },
        });

      if (template) {
        const templateJSON: JSONObject = BaseModel.toJSONObject(
          template,
          MonitorTemplate,
        );

        const values: JSONObject = {
          ...templateJSON,
          name: template.monitorName,
          description: template.monitorDescription,
          monitorType: template.monitorType,
          monitorSteps: templateJSON["monitorSteps"],
          monitoringInterval: template.monitoringInterval,
          labels: template.labels?.map((label: Label) => {
            return label.id!.toString();
          }),
        };

        setInitialValues(values);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  return (
    <Fragment>
      <Card
        title="Create New Monitor"
        description={
          "Monitor anything - Websites, API, IPv4, IPv6, or send data inbound and more. Create alerts on any metrics and alert the right team."
        }
        className="mb-10"
      >
        <div>
          {isLoading && <PageLoader isVisible={true} />}
          {error && <ErrorMessage message={error} />}
          {!isLoading && !error && (
            <ModelForm<Monitor>
              modelType={Monitor}
              name="Create New Monitor"
              id="create-monitor-form"
              initialValues={initialValues}
              fields={[
                {
                  field: {
                    name: true,
                  },
                  title: "Name",
                  stepId: "monitor-info",
                  fieldType: FormFieldSchemaType.Text,
                  required: true,
                  placeholder: "Monitor Name",
                  validation: {
                    minLength: 2,
                  },
                },
                {
                  field: {
                    description: true,
                  },
                  stepId: "monitor-info",
                  title: "Description",
                  fieldType: FormFieldSchemaType.LongText,
                  required: false,
                  placeholder: "Description",
                },
                {
                  field: {
                    monitorType: true,
                  },
                  title: "Monitor Type",
                  description: "Select the type of monitor you want to create",
                  stepId: "monitor-info",
                  fieldType: FormFieldSchemaType.CardSelect,
                  required: true,
                  cardSelectOptions:
                    MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions(),
                },
                {
                  field: {
                    monitorSteps: true,
                  },
                  stepId: "criteria",
                  styleType: FormFieldStyleType.Heading,
                  title: "Monitor Details",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: true,
                  customValidation: (values: FormValues<Monitor>) => {
                    const error: string | null =
                      MonitorStepsType.getValidationError(
                        values.monitorSteps as MonitorStepsType,
                        values.monitorType as MonitorType,
                      );

                    return error;
                  },
                  getCustomElement: (
                    value: FormValues<Monitor>,
                    props: CustomElementProps,
                  ) => {
                    return (
                      <MonitorSteps
                        {...props}
                        monitorType={value.monitorType || MonitorType.Manual}
                        monitorName={value.name || ""}
                      />
                    );
                  },
                },
                {
                  field: {
                    monitoringInterval: true,
                  },
                  stepId: "monitoring-interval",
                  title: "Monitoring Interval",
                  fieldType: FormFieldSchemaType.Dropdown,
                  required: true,
                  fetchDropdownOptions: (item: FormValues<Monitor>) => {
                    let interval: Array<DropdownOption> = [
                      ...MonitoringInterval,
                    ];

                    if (
                      item &&
                      (item.monitorType === MonitorType.SyntheticMonitor ||
                        item.monitorType === MonitorType.CustomJavaScriptCode ||
                        item.monitorType === MonitorType.SSLCertificate)
                    ) {
                      // remove the every minute option, every 2 mins, every 10 minutes
                      interval = interval.filter((option: DropdownOption) => {
                        return (
                          option.value !== "* * * * *" &&
                          option.value !== "*/2 * * * *"
                        );
                      });

                      return Promise.resolve(interval);
                    }

                    return Promise.resolve(interval);
                  },

                  placeholder: "Select Monitoring Interval",
                },
              ]}
              steps={[
                {
                  title: "Monitor Info",
                  id: "monitor-info",
                },
                {
                  title: "Criteria",
                  id: "criteria",
                  showIf: (values: FormValues<Monitor>) => {
                    return values.monitorType !== MonitorType.Manual;
                  },
                },
                {
                  title: "Interval",
                  id: "monitoring-interval",
                  showIf: (values: FormValues<Monitor>) => {
                    return MonitorTypeHelper.doesMonitorTypeHaveInterval(
                      values.monitorType as MonitorType,
                    );
                  },
                },
              ]}
              onBeforeCreate={async (item: Monitor): Promise<Monitor> => {
                if (monitorTemplateId) {
                  item.monitorTemplateId = new ObjectID(monitorTemplateId);
                }
                return item;
              }}
              onSuccess={(createdItem: Monitor) => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.MONITOR_VIEW] as Route,
                      {
                        modelId: createdItem._id,
                      },
                    ),
                  ),
                );
              }}
              submitButtonText={"Create Monitor"}
              formType={FormType.Create}
            />
          )}
        </div>
      </Card>
    </Fragment>
  );
};

export default MonitorCreate;
