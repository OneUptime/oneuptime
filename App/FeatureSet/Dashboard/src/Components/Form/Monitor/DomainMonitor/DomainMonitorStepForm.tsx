import React, { FunctionComponent, ReactElement, useState } from "react";
import MonitorStepDomainMonitor from "Common/Types/Monitor/MonitorStepDomainMonitor";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";

export interface ComponentProps {
  monitorStepDomainMonitor: MonitorStepDomainMonitor;
  onChange: (value: MonitorStepDomainMonitor) => void;
}

const DomainMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);

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
              description="How long to wait for a WHOIS response before timing out"
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
              description="Number of times to retry on failure"
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

export default DomainMonitorStepForm;
