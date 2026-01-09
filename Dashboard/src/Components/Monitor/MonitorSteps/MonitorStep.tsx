import MonitorCriteriaElement from "./MonitorCriteria";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorStep, { MonitorStepType } from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Service from "Common/Models/DatabaseModels/Service";
import { JSONObject } from "Common/Types/JSON";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/UI/Utils/API/API";
import Includes from "Common/Types/BaseDatabase/Includes";
import OneUptimeDate from "Common/Types/Date";
import ServicesElement from "../../Service/ServiceElements";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import ObjectID from "Common/Types/ObjectID";
import SpanUtil from "../../../Utils/SpanUtil";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";

export interface ComponentProps {
  monitorStatusOptions: Array<MonitorStatus>;
  incidentSeverityOptions: Array<IncidentSeverity>;
  alertSeverityOptions: Array<AlertSeverity>;
  monitorStep: MonitorStep;
  monitorType: MonitorType;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
}

export interface LogMonitorStepView {
  body: string | undefined;
  severityTexts: Array<string> | undefined;
  attributes: JSONObject | undefined;
  telemetryServices: Array<Service> | undefined;
  lastXSecondsOfLogs: number | undefined;
}

export interface TraceMonitorStepView {
  spanName: string | undefined;
  spanStatuses: Array<SpanStatus> | undefined;
  attributes: JSONObject | undefined;
  telemetryServices: Array<Service> | undefined;
  lastXSecondsOfSpans: number | undefined;
}

const MonitorStepElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [telemetryServices, setServices] = useState<Array<Service> | undefined>(
    undefined,
  );

  // this field is used for most monitor types
  let fields: Array<Field<MonitorStepType>> = [];
  let logFields: Array<Field<LogMonitorStepView>> = [];
  let traceFields: Array<Field<TraceMonitorStepView>> = [];

  const traceMonitorDetailView: TraceMonitorStepView = {
    spanName: undefined,
    spanStatuses: undefined,
    attributes: undefined,
    telemetryServices: undefined,
    lastXSecondsOfSpans: undefined,
  };

  const logMonitorDetailView: LogMonitorStepView = {
    body: undefined,
    severityTexts: undefined,
    attributes: undefined,
    telemetryServices: undefined,
    lastXSecondsOfLogs: undefined,
  };

  const fetchServices: PromiseVoidFunction = async (): Promise<void> => {
    let telemetryServiceIds: Array<ObjectID> = [];

    // if the monitor is a log monitor
    if (
      props.monitorStep.data?.logMonitor &&
      props.monitorType === MonitorType.Logs
    ) {
      telemetryServiceIds =
        props.monitorStep.data?.logMonitor?.telemetryServiceIds || [];
    }

    // if the monitor is a trace monitor
    if (
      props.monitorStep.data?.traceMonitor &&
      props.monitorType === MonitorType.Traces
    ) {
      telemetryServiceIds =
        props.monitorStep.data?.traceMonitor?.telemetryServiceIds || [];
    }

    const telemetryServicesResult: ListResult<Service> =
      await ModelAPI.getList<Service>({
        modelType: Service,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          _id: new Includes(telemetryServiceIds),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
          serviceColor: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

    if (telemetryServicesResult instanceof HTTPErrorResponse) {
      throw telemetryServicesResult;
    }

    setServices(telemetryServicesResult.data);
  };

  const loadComponent: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      if (
        props.monitorType === MonitorType.Logs ||
        props.monitorType === MonitorType.Traces
      ) {
        await fetchServices();
      }
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    loadComponent();
  }, [props.monitorType]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (props.monitorType === MonitorType.API) {
    fields = [
      {
        key: "monitorDestination",
        title: "API URL",
        description: "URL of the API you want to monitor.",
        fieldType: FieldType.Text,
        placeholder: "No data entered",
      },
      {
        key: "requestType",
        title: "Request Type",
        description: "Whats the type of the API request?",
        fieldType: FieldType.Text,
        placeholder: "No data entered",
      },
      {
        key: "requestBody",
        title: "Request Body",
        description: "Request Body to send, if any.",
        fieldType: FieldType.JSON,
        placeholder: "No data entered",
      },
      {
        key: "requestHeaders",
        title: "Request Headers",
        description: "Request Headers to send, if any.",
        fieldType: FieldType.DictionaryOfStrings,
        placeholder: "No data entered",
      },
      {
        key: "doNotFollowRedirects",
        title: "Do Not Follow Redirects",
        description: "When set, we will not follow redirects.",
        fieldType: FieldType.Boolean,
        placeholder: "No",
      },
    ];
  } else if (props.monitorType === MonitorType.Website) {
    fields = [
      {
        key: "monitorDestination",
        title: "Website URL",
        description: "URL of the website you want to monitor.",
        fieldType: FieldType.Text,
        placeholder: "No data entered",
      },
      {
        key: "doNotFollowRedirects",
        title: "Do Not Follow Redirects",
        description: "Do not follow redirects.",
        fieldType: FieldType.Boolean,
        placeholder: "No",
      },
    ];
  } else if (props.monitorType === MonitorType.Ping) {
    fields = [
      {
        key: "monitorDestination",
        title: "Ping Hostname or IP Address",
        description:
          "Hostname or IP Address of the resource you would like us to ping.",
        fieldType: FieldType.Text,
        placeholder: "No data entered",
      },
    ];
  } else if (props.monitorType === MonitorType.Port) {
    fields = [
      {
        key: "monitorDestination",
        title: "Ping Hostname or IP Address",
        description:
          "Hostname or IP Address of the resource you would like us to ping.",
        fieldType: FieldType.Text,
        placeholder: "No data entered",
      },
      {
        key: "monitorDestinationPort",
        title: "Port",
        description: "Port of the resource you would like us to ping.",
        fieldType: FieldType.Port,
        placeholder: "No port entered",
      },
    ];
  } else if (props.monitorType === MonitorType.IP) {
    fields = [
      {
        key: "monitorDestination",
        title: "IP Address",
        description: "IP Address of the resource you would like us to ping.",
        fieldType: FieldType.Text,
        placeholder: "No data entered",
      },
    ];
  } else if (props.monitorType === MonitorType.CustomJavaScriptCode) {
    fields = [
      {
        key: "customCode",
        title: "JavaScript Code",
        description: "JavaScript code to run.",
        fieldType: FieldType.JavaScript,
        placeholder: "No data entered",
      },
    ];
  } else if (props.monitorType === MonitorType.SyntheticMonitor) {
    fields = [
      {
        key: "customCode",
        title: "JavaScript Code",
        description: "JavaScript code to run.",
        fieldType: FieldType.JavaScript,
        placeholder: "No data entered",
      },
      {
        key: "browserTypes",
        title: "Browser Types",
        description: "Browser types to run the synthetic monitor on.",
        fieldType: FieldType.ArrayOfText,
        placeholder: "No data entered",
      },
      {
        key: "screenSizeTypes",
        title: "Screen Size Types",
        description: "Screen size types to run the synthetic monitor on.",
        fieldType: FieldType.ArrayOfText,
        placeholder: "No data entered",
      },
      {
        key: "retryCountOnError",
        title: "Retry Count on Error",
        description:
          "Number of times to retry the synthetic monitor if it fails.",
        fieldType: FieldType.Number,
        placeholder: "0",
      },
    ];
  } else if (props.monitorType === MonitorType.Logs) {
    logFields = [];

    if (props.monitorStep.data?.logMonitor?.body) {
      logMonitorDetailView.body = props.monitorStep.data?.logMonitor?.body;

      logFields.push({
        key: "body",
        title: "Filter Log Message",
        description: "Filter by log message with this text:",
        fieldType: FieldType.Text,
        placeholder: "No log message entered",
      });
    }

    if (props.monitorStep.data?.logMonitor?.lastXSecondsOfLogs) {
      logMonitorDetailView.lastXSecondsOfLogs =
        props.monitorStep.data?.logMonitor?.lastXSecondsOfLogs;

      logFields.push({
        key: "lastXSecondsOfLogs",
        title: "Monitor logs for the last (time)",
        description: "How many seconds of logs to monitor.",
        fieldType: FieldType.Element,
        placeholder: "1 minute",
        getElement: (item: LogMonitorStepView): ReactElement => {
          return (
            <p>
              {OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
                item.lastXSecondsOfLogs || 0,
              )}
            </p>
          );
        },
      });
    }

    if (props.monitorStep.data?.logMonitor?.severityTexts) {
      logMonitorDetailView.severityTexts =
        props.monitorStep.data?.logMonitor?.severityTexts;

      logFields.push({
        key: "severityTexts",
        title: "Log Severity",
        description: "Severity of the logs to monitor.",
        fieldType: FieldType.ArrayOfText,
        placeholder: "No severity entered",
      });
    }

    if (
      props.monitorStep.data?.logMonitor?.attributes &&
      Object.keys(props.monitorStep.data?.logMonitor?.attributes).length > 0
    ) {
      logMonitorDetailView.attributes =
        props.monitorStep.data?.logMonitor?.attributes;

      logFields.push({
        key: "attributes",
        title: "Log Attributes",
        description: "Attributes of the logs to monitor.",
        fieldType: FieldType.JSON,
        placeholder: "No attributes entered",
      });
    }

    if (
      props.monitorStep.data?.logMonitor?.telemetryServiceIds &&
      props.monitorStep.data?.logMonitor?.telemetryServiceIds.length > 0 &&
      telemetryServices &&
      telemetryServices.length > 0
    ) {
      logMonitorDetailView.telemetryServices = telemetryServices; // set the telemetry services

      logFields.push({
        key: "telemetryServices",
        title: "Telemetry Services",
        description: "Telemetry services to monitor.",
        fieldType: FieldType.Element,
        placeholder: "No telemetry services entered",
        getElement: (): ReactElement => {
          return <ServicesElement services={telemetryServices} />;
        },
      });
    }
  } else if (props.monitorType === MonitorType.Traces) {
    traceFields = [];

    if (props.monitorStep.data?.traceMonitor?.spanName) {
      traceMonitorDetailView.spanName =
        props.monitorStep.data?.traceMonitor?.spanName;

      traceFields.push({
        key: "spanName",
        title: "Filter Span Name",
        description: "Filter by span name with this text:",
        fieldType: FieldType.Text,
        placeholder: "No span name entered",
      });
    }

    if (props.monitorStep.data?.traceMonitor?.lastXSecondsOfSpans) {
      traceMonitorDetailView.lastXSecondsOfSpans =
        props.monitorStep.data?.traceMonitor?.lastXSecondsOfSpans;

      traceFields.push({
        key: "lastXSecondsOfSpans",
        title: "Monitor spans for the last (time)",
        description: "How many seconds of spans to monitor.",
        fieldType: FieldType.Element,
        placeholder: "1 minute",
        getElement: (item: TraceMonitorStepView): ReactElement => {
          return (
            <p>
              {OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
                item.lastXSecondsOfSpans || 0,
              )}
            </p>
          );
        },
      });
    }

    if (props.monitorStep.data?.traceMonitor?.spanStatuses) {
      traceMonitorDetailView.spanStatuses =
        props.monitorStep.data?.traceMonitor?.spanStatuses;

      traceFields.push({
        key: "spanStatuses",
        title: "Span Status",
        description: "Status of the spans to monitor.",
        fieldType: FieldType.Element,
        getElement: (item: TraceMonitorStepView): ReactElement => {
          return (
            <p>
              {item.spanStatuses
                ?.map((status: SpanStatus) => {
                  return SpanUtil.getSpanStatusText(status);
                })
                .join(", ")}
            </p>
          );
        },
        placeholder: "No span status entered. All statuses will be monitored.",
      });
    }

    if (
      props.monitorStep.data?.traceMonitor?.attributes &&
      Object.keys(props.monitorStep.data?.traceMonitor?.attributes).length > 0
    ) {
      traceMonitorDetailView.attributes =
        props.monitorStep.data?.traceMonitor?.attributes;

      traceFields.push({
        key: "attributes",
        title: "Span Attributes",
        description: "Attributes of the spans to monitor.",
        fieldType: FieldType.JSON,
        placeholder: "No attributes entered",
      });
    }

    if (
      props.monitorStep.data?.traceMonitor?.telemetryServiceIds &&
      props.monitorStep.data?.traceMonitor?.telemetryServiceIds.length > 0 &&
      telemetryServices &&
      telemetryServices.length > 0
    ) {
      traceMonitorDetailView.telemetryServices = telemetryServices; // set the telemetry services

      traceFields.push({
        key: "telemetryServices",
        title: "Telemetry Services",
        description: "Telemetry services to monitor.",
        fieldType: FieldType.Element,
        placeholder: "No telemetry services entered",
        getElement: (): ReactElement => {
          return <ServicesElement services={telemetryServices} />;
        },
      });
    }
  }

  return (
    <div className="mt-5">
      <FieldLabelElement
        title={"Monitor Details"}
        description={
          "Here are the details of the request we will send to monitor your resource status."
        }
        required={true}
        isHeading={true}
      />
      <div className="mt-5">
        {fields && fields.length > 0 && (
          <Detail<MonitorStepType>
            id={"monitor-step"}
            item={props.monitorStep.data!}
            fields={fields}
          />
        )}
        {logFields && logFields.length > 0 && (
          <Detail<LogMonitorStepView>
            id={"monitor-logs"}
            item={logMonitorDetailView}
            fields={logFields}
          />
        )}
        {traceFields && traceFields.length > 0 && (
          <Detail<TraceMonitorStepView>
            id={"monitor-traces"}
            item={traceMonitorDetailView}
            fields={traceFields}
          />
        )}
      </div>

      <HorizontalRule />

      <div className="mt-5">
        <FieldLabelElement
          title="Criteria"
          isHeading={true}
          description={
            "Criteria we will use to determine your resource status."
          }
          required={true}
        />

        <MonitorCriteriaElement
          onCallPolicyOptions={props.onCallPolicyOptions}
          monitorStatusOptions={props.monitorStatusOptions}
          incidentSeverityOptions={props.incidentSeverityOptions}
          alertSeverityOptions={props.alertSeverityOptions}
          monitorCriteria={
            props.monitorStep?.data?.monitorCriteria as MonitorCriteria
          }
        />
      </div>
    </div>
  );
};

export default MonitorStepElement;
