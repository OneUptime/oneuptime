import React, { FunctionComponent, ReactElement } from "react";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SECTION_ICON,
} from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import {
  DOMAIN_MONITOR_MORE_FIELDS,
  getMonitorOptionsMoreFieldsItems,
} from "../MonitorMoreFields";
import MonitorStepDomainMonitor from "Common/Types/Monitor/MonitorStepDomainMonitor";
import { parseMonitorStepRetriesInput } from "Common/Types/Monitor/MonitorStepRetries";
import DomainLookupMethod from "Common/Types/Monitor/DomainMonitor/DomainLookupMethod";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";

export interface ComponentProps {
  monitorStepDomainMonitor: MonitorStepDomainMonitor;
  onChange: (value: MonitorStepDomainMonitor) => void;
}

const DomainMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

  const lookupMethodOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(DomainLookupMethod);

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Domain Name"
          description="The domain name to monitor (e.g. example.com)"
          required={true}
        />
        <Input
          initialValue={props.monitorStepDomainMonitor.domainName}
          placeholder="example.com"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepDomainMonitor,
              domainName: value,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Lookup Method"
          description="How registration data is read. Auto uses RDAP when the TLD publishes one and falls back to WHOIS. Some TLDs (such as .digital) have no working WHOIS server, and some (such as .io) have no RDAP service."
          required={true}
        />
        <Dropdown
          options={lookupMethodOptions}
          initialValue={lookupMethodOptions.find((option: DropdownOption) => {
            return option.value === props.monitorStepDomainMonitor.lookupMethod;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...props.monitorStepDomainMonitor,
              lookupMethod: value as DomainLookupMethod,
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
          props.monitorStepDomainMonitor,
          DOMAIN_MONITOR_MORE_FIELDS,
        )}
        dataTestId="domain-monitor-more-fields"
      >
        <div className="space-y-4">

          <div>
            <FieldLabelElement
              title="Timeout (ms)"
              description="How long to wait for the registration lookup to respond before timing out"
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepDomainMonitor.timeout?.toString() || "10000"
              }
              placeholder="10000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDomainMonitor,
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
                props.monitorStepDomainMonitor.retries?.toString() || "3"
              }
              placeholder="3"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDomainMonitor,
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

export default DomainMonitorStepForm;
