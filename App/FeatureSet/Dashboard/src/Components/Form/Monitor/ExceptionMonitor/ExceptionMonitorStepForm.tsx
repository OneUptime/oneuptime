import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import ObjectID from "Common/Types/ObjectID";
import JSONFunctions from "Common/Types/JSONFunctions";
import Query from "Common/Types/BaseDatabase/Query";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import ExceptionInstanceTable from "../../../Exceptions/ExceptionInstanceTable";

export interface ComponentProps {
  monitorStepExceptionMonitor: MonitorStepExceptionMonitor;
  onMonitorStepExceptionMonitorChanged: (
    monitorStepExceptionMonitor: MonitorStepExceptionMonitor,
  ) => void;
  telemetryServices: Array<Service>;
}

type ExceptionMonitorFormValues = {
  message: string;
  exceptionTypesInput: string;
  telemetryServiceIds: Array<string>;
  includeResolved: boolean;
  includeArchived: boolean;
  lastXSecondsOfExceptions: number;
};

const DURATION_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "Last 5 seconds", value: 5 },
  { label: "Last 10 seconds", value: 10 },
  { label: "Last 30 seconds", value: 30 },
  { label: "Last 1 minute", value: 60 },
  { label: "Last 5 minutes", value: 300 },
  { label: "Last 15 minutes", value: 900 },
  { label: "Last 30 minutes", value: 1800 },
  { label: "Last 1 hour", value: 3600 },
  { label: "Last 6 hours", value: 21600 },
  { label: "Last 12 hours", value: 43200 },
  { label: "Last 24 hours", value: 86400 },
];

type ParseExceptionTypesFunction = (input: string) => Array<string>;

const parseExceptionTypes: ParseExceptionTypesFunction = (input: string) => {
  return input
    .split(",")
    .map((item: string): string => {
      return item.trim();
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
};

type ToFormValuesFunction = (
  monitor: MonitorStepExceptionMonitor,
) => ExceptionMonitorFormValues;

const toFormValues: ToFormValuesFunction = (
  monitor: MonitorStepExceptionMonitor,
) => {
  return {
    message: monitor.message || "",
    exceptionTypesInput: monitor.exceptionTypes.join(", "),
    telemetryServiceIds: monitor.telemetryServiceIds.map(
      (id: ObjectID): string => {
        return id.toString();
      },
    ),
    includeResolved: monitor.includeResolved || false,
    includeArchived: monitor.includeArchived || false,
    lastXSecondsOfExceptions:
      monitor.lastXSecondsOfExceptions ||
      MonitorStepExceptionMonitorUtil.getDefault().lastXSecondsOfExceptions,
  };
};

type ToMonitorConfigFunction = (
  values: ExceptionMonitorFormValues,
) => MonitorStepExceptionMonitor;

const toMonitorConfig: ToMonitorConfigFunction = (
  values: ExceptionMonitorFormValues,
) => {
  return {
    telemetryServiceIds: values.telemetryServiceIds
      .filter((id: string): boolean => {
        return Boolean(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    exceptionTypes: parseExceptionTypes(values.exceptionTypesInput),
    message: values.message || "",
    includeResolved: values.includeResolved || false,
    includeArchived: values.includeArchived || false,
    lastXSecondsOfExceptions:
      values.lastXSecondsOfExceptions ||
      MonitorStepExceptionMonitorUtil.getDefault().lastXSecondsOfExceptions,
  };
};

type HasAdvancedConfigurationFunction = (
  monitor: MonitorStepExceptionMonitor,
) => boolean;

const hasAdvancedConfiguration: HasAdvancedConfigurationFunction = (
  monitor: MonitorStepExceptionMonitor,
) => {
  return (
    monitor.includeResolved ||
    monitor.includeArchived ||
    (monitor.telemetryServiceIds && monitor.telemetryServiceIds.length > 0)
  );
};

const ExceptionMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [formValues, setFormValues] = useState<ExceptionMonitorFormValues>(
    toFormValues(props.monitorStepExceptionMonitor),
  );

  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(
    hasAdvancedConfiguration(props.monitorStepExceptionMonitor),
  );

  useEffect(() => {
    setFormValues(toFormValues(props.monitorStepExceptionMonitor));
    setShowAdvancedOptions(
      hasAdvancedConfiguration(props.monitorStepExceptionMonitor),
    );
  }, [props.monitorStepExceptionMonitor]);

  type HandleFormChangeFunction = (values: ExceptionMonitorFormValues) => void;

  const handleFormChange: HandleFormChangeFunction = (
    values: ExceptionMonitorFormValues,
  ) => {
    setFormValues(values);
    props.onMonitorStepExceptionMonitorChanged(toMonitorConfig(values));
  };

  const handleAdvancedToggle: () => void = (): void => {
    setShowAdvancedOptions((current: boolean): boolean => {
      return !current;
    });
  };

  const previewQuery: Query<ExceptionInstance> = useMemo(() => {
    const monitorConfig: MonitorStepExceptionMonitor =
      toMonitorConfig(formValues);

    return JSONFunctions.anyObjectToJSONObject(
      MonitorStepExceptionMonitorUtil.toAnalyticsQuery(monitorConfig),
    ) as Query<ExceptionInstance>;
  }, [formValues]);

  return (
    <div>
      <BasicForm
        id="exception-monitor-form"
        hideSubmitButton={true}
        initialValues={formValues}
        onChange={handleFormChange}
        fields={[
          {
            field: {
              message: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Filter Exception Message",
            description:
              "Filter exceptions that include this text in the message.",
            hideOptionalLabel: true,
          },
          {
            field: {
              exceptionTypesInput: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Exception Types",
            description:
              "Provide a comma-separated list of exception types to monitor.",
            placeholder: "TypeError, NullReferenceException",
            hideOptionalLabel: true,
          },
          {
            field: {
              lastXSecondsOfExceptions: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DURATION_OPTIONS,
            title: "Monitor exceptions for (time)",
            description:
              "We will evaluate exceptions generated within this time window.",
            defaultValue:
              MonitorStepExceptionMonitorUtil.getDefault()
                .lastXSecondsOfExceptions,
            hideOptionalLabel: true,
          },
          {
            field: {
              telemetryServiceIds: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: props.telemetryServices.map(
              (service: Service): { label: string; value: string } => {
                return {
                  label: service.name || "Untitled Service",
                  value: service.id?.toString() || "",
                };
              },
            ),
            title: "Filter by Telemetry Service",
            description: "Select telemetry services to scope this monitor.",
            hideOptionalLabel: true,
            showIf: (): boolean => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              includeResolved: true,
            },
            fieldType: FormFieldSchemaType.Checkbox,
            title: "Include Resolved Exceptions",
            description: "When enabled, resolved exceptions will be counted.",
            hideOptionalLabel: true,
            showIf: (): boolean => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              includeArchived: true,
            },
            fieldType: FormFieldSchemaType.Checkbox,
            title: "Include Archived Exceptions",
            description:
              "When enabled, archived exceptions will be included in results.",
            hideOptionalLabel: true,
            showIf: (): boolean => {
              return showAdvancedOptions;
            },
          },
        ]}
      />

      <div className="-ml-3">
        <Button
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          title={
            showAdvancedOptions
              ? "Hide Advanced Options"
              : "Show Advanced Options"
          }
          onClick={handleAdvancedToggle}
        />
      </div>

      <div>
        <HorizontalRule />
        <FieldLabelElement
          title="Exceptions Preview"
          description={
            "Here is the preview of the exceptions that will be monitored based on the filters you have set above."
          }
          hideOptionalLabel={true}
          isHeading={true}
        />
        <div className="mt-5 mb-5">
          <ExceptionInstanceTable
            title="Exceptions Preview"
            description="Exceptions matching the current monitor filters."
            query={previewQuery}
          />
        </div>
      </div>
    </div>
  );
};

export default ExceptionMonitorStepForm;
