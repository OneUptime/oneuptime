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
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import SecurityEventsMonitorPreview from "../../../Monitor/SecurityEventsMonitor/SecurityEventsMonitorPreview";
import SecurityEventAttributeUtil from "../../../SecurityEvents/SecurityEventAttributeUtil";

/*
 * The filters that narrow a security event monitor down further - telemetry
 * service and attributes - fold under the same More fields section as the
 * rarely needed fields of every other form, instead of the Show / Hide
 * Advanced Options link this form had of its own. Severity and class stay
 * on screen (issue #3398). Folded, the section's header names its filters
 * and shows each one a monitor uses as a chip ("Filter by Attributes: 1" on
 * a monitor created from a detection rule), so editing a monitor never
 * hides a filter it has. Folded fields stay mounted: the preview below and
 * the saved step always get the whole filter set. Built once, so every
 * render hands its fields the same section.
 */
const MORE_SECURITY_EVENT_FILTERS: FormFieldCollapsibleSection<MonitorStepSecurityEventsMonitor> =
  getAdvancedFormSection<MonitorStepSecurityEventsMonitor>();

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

  /*
   * Attribute-key suggestions for the attributes dictionary, so the keys the
   * project's events actually carry (threat.matched, device.hostname, ...)
   * autocomplete instead of being typed from memory. Fetched once, as the
   * form opens - as the log and trace monitors' keys are (MonitorStep) - so
   * they are there by the time someone opens More fields to use them. The
   * form only shows while a monitor's filters are being set up, never on a
   * page that is merely browsed.
   */
  const [attributeKeys, setAttributeKeys] = React.useState<Array<string>>([]);

  React.useEffect(() => {
    let isUnmounted: boolean = false;

    SecurityEventAttributeUtil.getAttributeKeys()
      .then((keys: Array<string>) => {
        if (!isUnmounted) {
          setAttributeKeys(keys);
        }
      })
      .catch(() => {
        // Recoverable: the dictionary still accepts hand-typed keys.
      });

    return () => {
      isUnmounted = true;
    };
  }, []);

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
            /*
             * Always on screen, like Event Class — hidden behind the old
             * advanced toggle, severity read as "monitors cannot filter
             * by severity" (issue #3398). Never fold it.
             */
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
            collapsibleSection: MORE_SECURITY_EVENT_FILTERS,
          },
          {
            field: {
              attributes: true,
            },
            fieldType: FormFieldSchemaType.Dictionary,
            title: "Filter by Attributes",
            jsonKeysForDictionary: attributeKeys,
            /*
             * Same operator set the Log/Trace monitors expose —
             * StatementGenerator's map branch compiles every wrapper, so
             * include/exclude/contains over any flattened source
             * attribute needs only this flag.
             */
            dictionaryEnableOperators: true,
            description:
              "You can filter the security events based on the attributes that are attached to them.",
            hideOptionalLabel: true,
            collapsibleSection: MORE_SECURITY_EVENT_FILTERS,
          },
        ]}
      />
      <div>
        <HorizontalRule />
        <FieldLabelElement
          title={"Security Events Preview"}
          description={
            "The security events these filters match, so you can check the filters before you save."
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
