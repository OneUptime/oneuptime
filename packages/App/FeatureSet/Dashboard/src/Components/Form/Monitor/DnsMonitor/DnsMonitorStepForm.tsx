import React, { FunctionComponent, ReactElement } from "react";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SECTION_ICON,
} from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import {
  DNS_MONITOR_MORE_FIELDS,
  getMonitorOptionsMoreFieldsItems,
} from "../MonitorMoreFields";
import MonitorStepDnsMonitor from "Common/Types/Monitor/MonitorStepDnsMonitor";
import { parseMonitorStepRetriesInput } from "Common/Types/Monitor/MonitorStepRetries";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import DropdownUtil from "Common/UI/Utils/Dropdown";

export interface ComponentProps {
  monitorStepDnsMonitor: MonitorStepDnsMonitor;
  onChange: (value: MonitorStepDnsMonitor) => void;
}

const DnsMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

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

      {/*
       * More fields, folded like every form's: options most monitors
       * leave at their defaults. Its header names them and shows the
       * ones changed.
       */}
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        icon={MORE_SECTION_ICON}
        items={getMonitorOptionsMoreFieldsItems(
          props.monitorStepDnsMonitor,
          DNS_MONITOR_MORE_FIELDS,
        )}
        dataTestId="dns-monitor-more-fields"
      >
        <div className="space-y-4">

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
              description="Number of times to retry after the first attempt fails. For example, 2 means up to 3 attempts in total. Set to 0 for no retries. Defaults to 3."
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

export default DnsMonitorStepForm;
