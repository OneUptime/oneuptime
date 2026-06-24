import React, { FunctionComponent, ReactElement, useState } from "react";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);

  const providerOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(ExternalStatusPageProviderType);

  const selectedProviderOption: DropdownOption | undefined =
    providerOptions.find((option: DropdownOption) => {
      return (
        option.value ===
        (props.monitorStepExternalStatusPageMonitor.provider ||
          ExternalStatusPageProviderType.Auto)
      );
    });

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
          title="Provider Type"
          description="Leave as Auto to auto-detect the status page format. OneUptime supports Atlassian Statuspage, incident.io (e.g. status.openai.com), and RSS/Atom feeds."
          required={false}
        />
        <Dropdown
          value={selectedProviderOption}
          options={providerOptions}
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

      <div>
        <FieldLabelElement
          title="Component Group Filter (Optional)"
          description="Filter to a specific component group by name (e.g. 'APIs' on status.openai.com). Leave blank to monitor all groups. Supported for Atlassian Statuspage and incident.io."
          required={false}
        />
        <Input
          initialValue={
            props.monitorStepExternalStatusPageMonitor.componentGroupName || ""
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
          description="Filter to a specific component by name. Combine with the group filter above to target a sub-set within a group. Leave blank to monitor every component."
          required={false}
        />
        <Input
          initialValue={
            props.monitorStepExternalStatusPageMonitor.componentName || ""
          }
          placeholder="e.g. Chat Completions, EC2 us-east-1"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepExternalStatusPageMonitor,
              componentName: value || undefined,
            });
          }}
        />
      </div>

      {!showAdvancedOptions && (
        <div className="mt-1 -ml-3">
          <Button
            title="Advanced: Timeout and Retries"
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            onClick={() => {
              setShowAdvancedOptions(true);
            }}
          />
        </div>
      )}

      {showAdvancedOptions && (
        <div className="space-y-4 border p-4 rounded-md bg-gray-50">
          <h4 className="font-medium">Advanced Options</h4>

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
              description="Number of times to retry on failure"
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
                  retries: parseInt(value) || 3,
                });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ExternalStatusPageMonitorStepForm;
