import MonitorStepSecurityEventsMonitor from "Common/Types/Monitor/MonitorStepSecurityEventsMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import React, { FunctionComponent, ReactElement } from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  OcsfEventClasses,
  OcsfEventClassProps,
} from "Common/Types/SecurityEvent/OcsfEventClass";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import SecurityEventsMonitorPreview from "../../../Monitor/SecurityEventsMonitor/SecurityEventsMonitorPreview";

export interface ComponentProps {
  monitorStepSecurityEventsMonitor: MonitorStepSecurityEventsMonitor;
  onMonitorStepSecurityEventsMonitorChanged: (
    monitorStepSecurityEventsMonitor: MonitorStepSecurityEventsMonitor,
  ) => void;
  telemetryServices: Array<Service>;
}

const SecurityEventsMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [
    monitorStepSecurityEventsMonitor,
    setMonitorStepSecurityEventsMonitor,
  ] = React.useState<MonitorStepSecurityEventsMonitor>(
    props.monitorStepSecurityEventsMonitor,
  );

  let showAdvancedOptionsByDefault: boolean = false;

  if (
    (monitorStepSecurityEventsMonitor.severityNames &&
      monitorStepSecurityEventsMonitor.severityNames.length > 0) ||
    (monitorStepSecurityEventsMonitor.classNames &&
      monitorStepSecurityEventsMonitor.classNames.length > 0) ||
    (monitorStepSecurityEventsMonitor.telemetryServiceIds &&
      monitorStepSecurityEventsMonitor.telemetryServiceIds.length > 0) ||
    (monitorStepSecurityEventsMonitor.attributes &&
      Object.keys(monitorStepSecurityEventsMonitor.attributes).length > 0)
  ) {
    showAdvancedOptionsByDefault = true;
  }

  const [showAdvancedOptions, setShowAdvancedOptions] = React.useState(
    showAdvancedOptionsByDefault,
  );

  return (
    <div>
      <BasicForm
        id="security-events-filter"
        hideSubmitButton={true}
        initialValues={monitorStepSecurityEventsMonitor}
        onChange={(values: MonitorStepSecurityEventsMonitor) => {
          setMonitorStepSecurityEventsMonitor(values);
          props.onMonitorStepSecurityEventsMonitorChanged(values);
        }}
        fields={[
          {
            field: {
              messageContains: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Monitor events that include this text",
            description:
              "This monitor will filter all the security events that include this text in their message.",
            hideOptionalLabel: true,
          },
          {
            field: {
              lastXSecondsOfEvents: true,
            },
            defaultValue: 60,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
              {
                label: "Last 5 seconds",
                value: 5,
              },
              {
                label: "Last 10 seconds",
                value: 10,
              },
              {
                label: "Last 30 seconds",
                value: 30,
              },
              {
                label: "Last 1 minute",
                value: 60,
              },
              {
                label: "Last 5 minutes",
                value: 300,
              },
              {
                label: "Last 15 minutes",
                value: 900,
              },
              {
                label: "Last 30 minutes",
                value: 1800,
              },
              {
                label: "Last 1 hour",
                value: 3600,
              },
              {
                label: "Last 6 hours",
                value: 21600,
              },
              {
                label: "Last 12 hours",
                value: 43200,
              },
              {
                label: "Last 24 hours",
                value: 86400,
              },
            ],
            title: "Monitor Security Events for (time)",
            description:
              "We will fetch all the security events that were generated in the last X time.",
            hideOptionalLabel: true,
          },
          {
            field: {
              severityNames: true,
            },
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(OcsfSeverity),
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            title: "Event Severity",
            description:
              "Select the OCSF severity of the security events you want to monitor.",
            hideOptionalLabel: true,
            showIf: () => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              classNames: true,
            },
            dropdownOptions: OcsfEventClasses.map(
              (eventClass: OcsfEventClassProps) => {
                return {
                  label: eventClass.name,
                  value: eventClass.name,
                };
              },
            ),
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            title: "Event Class",
            description:
              "Select the OCSF event classes you want to monitor (e.g. Authentication, Detection Finding).",
            hideOptionalLabel: true,
            showIf: () => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              telemetryServiceIds: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: props.telemetryServices.map(
              (telemetryService: Service) => {
                return {
                  label: telemetryService.name!,
                  value: telemetryService.id?.toString() || "",
                };
              },
            ),
            title: "Filter by Telemetry Service",
            description: "Select the telemetry services you want to monitor.",
            hideOptionalLabel: true,
            showIf: () => {
              return showAdvancedOptions;
            },
          },
          {
            field: {
              attributes: true,
            },
            fieldType: FormFieldSchemaType.Dictionary,
            title: "Filter by Attributes",
            jsonKeysForDictionary: [],
            description:
              "You can filter the security events based on the attributes that are attached to them.",
            hideOptionalLabel: true,
            showIf: () => {
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
          onClick={() => {
            return setShowAdvancedOptions(!showAdvancedOptions);
          }}
        />
      </div>
      <div>
        <HorizontalRule />
        <FieldLabelElement
          title={"Security Events Preview"}
          description={
            "Here is the preview of the security events that will be monitored based on the filters you have set above."
          }
          hideOptionalLabel={true}
          isHeading={true}
        />
        <div className="mt-5 mb-5">
          <SecurityEventsMonitorPreview
            monitorStepSecurityEventsMonitor={monitorStepSecurityEventsMonitor}
          />
        </div>
      </div>
    </div>
  );
};

export default SecurityEventsMonitorStepForm;
