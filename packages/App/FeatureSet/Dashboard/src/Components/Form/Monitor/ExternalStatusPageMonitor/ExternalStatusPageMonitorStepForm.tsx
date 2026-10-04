import React, { FunctionComponent, ReactElement } from "react";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SECTION_ICON,
} from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import {
  EXTERNAL_STATUS_PAGE_MONITOR_MORE_FIELDS,
  getMonitorOptionsMoreFieldsItems,
} from "../MonitorMoreFields";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import { parseMonitorStepRetriesInput } from "Common/Types/Monitor/MonitorStepRetries";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";

export interface ComponentProps {
  monitorStepExternalStatusPageMonitor: MonitorStepExternalStatusPageMonitor;
  onChange: (value: MonitorStepExternalStatusPageMonitor) => void;
}

const ExternalStatusPageMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const providerDropdownOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(ExternalStatusPageProviderType);

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Status Page URL"
          description="The URL of the external status page to monitor (e.g. https://www.githubstatus.com or https://status.openai.com)"
          required={true}
        />
        <Input
          initialValue={
            props.monitorStepExternalStatusPageMonitor.statusPageUrl
          }
          placeholder="https://status.example.com"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepExternalStatusPageMonitor,
              statusPageUrl: value,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Provider"
          description="How OneUptime reads this status page. 'Auto' detects Atlassian Statuspage, incident.io, or an RSS/Atom feed automatically."
          required={false}
        />
        <Dropdown
          initialValue={providerDropdownOptions.find((i: DropdownOption) => {
            return (
              i.value ===
              (props.monitorStepExternalStatusPageMonitor.provider ||
                ExternalStatusPageProviderType.Auto)
            );
          })}
          options={providerDropdownOptions}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...props.monitorStepExternalStatusPageMonitor,
              provider:
                (value?.toString() as ExternalStatusPageProviderType) ||
                ExternalStatusPageProviderType.Auto,
            });
          }}
        />
      </div>

      {/*
       * More fields, folded like every form's: options most monitors
       * leave at their defaults. Its header names them and shows the
       * ones changed.
       */}
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        icon={MORE_SECTION_ICON}
        items={getMonitorOptionsMoreFieldsItems(
          props.monitorStepExternalStatusPageMonitor,
          EXTERNAL_STATUS_PAGE_MONITOR_MORE_FIELDS,
        )}
        dataTestId="external-status-page-monitor-more-fields"
      >
        <div className="space-y-4">
          <div>
            <FieldLabelElement
              title="Component Group Filter (Optional)"
              description="Scope to a specific component group, e.g. 'APIs'. Incidents and component statuses outside this group are ignored. Supported for Atlassian Statuspage and incident.io."
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.componentGroupName ||
                ""
              }
              placeholder="e.g. APIs"
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  componentGroupName: value || undefined,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Component Name Filter (Optional)"
              description="Filter to a specific component by name (applied within the component group when one is set). Leave blank to monitor all components in scope."
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.componentName || ""
              }
              placeholder="e.g. API, Compute Engine, us-east-1"
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  componentName: value || undefined,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Timeout (ms)"
              description="How long to wait for a response before timing out"
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.timeout?.toString() ||
                "10000"
              }
              placeholder="10000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  timeout: parseInt(value) || 10000,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Retries"
              description="Number of times to retry after the first attempt fails. For example, 2 means up to 3 attempts in total. Set to 0 for no retries. Defaults to 3."
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.retries?.toString() ||
                "3"
              }
              placeholder="3"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  // A typed 0 means no retries, so it must not read as "unset".
                  retries: parseMonitorStepRetriesInput(value, 3),
                });
              }}
            />
          </div>
        </div>
      </FoldedSection>
    </div>
  );
};

export default ExternalStatusPageMonitorStepForm;
