import React, { FunctionComponent, ReactElement, useState } from "react";
import MonitorStepDnsMonitor from "Common/Types/Monitor/MonitorStepDnsMonitor";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DropdownUtil from "Common/UI/Utils/Dropdown";

export interface ComponentProps {
  monitorStepDnsMonitor: MonitorStepDnsMonitor;
  onChange: (value: MonitorStepDnsMonitor) => void;
}

const DnsMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);

  const recordTypeOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(DnsRecordType);

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Domain Name"
          description="The domain name to query (e.g. example.com)"
          required={true}
        />
        <Input
          initialValue={props.monitorStepDnsMonitor.queryName}
          placeholder="example.com"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepDnsMonitor,
              queryName: value,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Record Type"
          description="The type of DNS record to query"
          required={true}
        />
        <Dropdown
          options={recordTypeOptions}
          initialValue={recordTypeOptions.find((option: DropdownOption) => {
            return option.value === props.monitorStepDnsMonitor.recordType;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...props.monitorStepDnsMonitor,
              recordType: value as DnsRecordType,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="DNS Server (Optional)"
          description="Custom DNS server to use. Leave empty to use system default."
          required={false}
        />
        <Input
          initialValue={props.monitorStepDnsMonitor.hostname || ""}
          placeholder="8.8.8.8 or leave empty for system default"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepDnsMonitor,
              hostname: value || undefined,
            });
          }}
        />
      </div>

      {!showAdvancedOptions && (
        <div className="mt-1 -ml-3">
          <Button
            title="Advanced: Port, Timeout and Retries"
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
              title="Port"
              description="DNS port (default: 53)"
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepDnsMonitor.port?.toString() || "53"
              }
              placeholder="53"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDnsMonitor,
                  port: parseInt(value) || 53,
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
                props.monitorStepDnsMonitor.timeout?.toString() || "5000"
              }
              placeholder="5000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDnsMonitor,
                  timeout: parseInt(value) || 5000,
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
                props.monitorStepDnsMonitor.retries?.toString() || "3"
              }
              placeholder="3"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDnsMonitor,
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

export default DnsMonitorStepForm;
