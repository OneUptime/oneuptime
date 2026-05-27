import React, { FunctionComponent, ReactElement, useState } from "react";
import MonitorStepDnssecMonitor from "Common/Types/Monitor/MonitorStepDnssecMonitor";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Toggle from "Common/UI/Components/Toggle/Toggle";

export interface ComponentProps {
  monitorStepDnssecMonitor: MonitorStepDnssecMonitor;
  onChange: (value: MonitorStepDnssecMonitor) => void;
}

const DnssecMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Zone (Domain Name)"
          description="The zone to validate via DNSSEC (e.g. example.com)"
          required={true}
        />
        <Input
          initialValue={props.monitorStepDnssecMonitor.domainName}
          placeholder="example.com"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepDnssecMonitor,
              domainName: value,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Resolvers"
          description="Comma-separated list of validating resolvers to query (e.g. 1.1.1.1, 8.8.8.8, 9.9.9.9)"
          required={true}
        />
        <Input
          initialValue={props.monitorStepDnssecMonitor.resolvers.join(", ")}
          placeholder="1.1.1.1, 8.8.8.8, 9.9.9.9"
          onChange={(value: string) => {
            const resolvers: Array<string> = value
              .split(",")
              .map((s: string) => {
                return s.trim();
              })
              .filter((s: string) => {
                return s.length > 0;
              });
            props.onChange({
              ...props.monitorStepDnssecMonitor,
              resolvers: resolvers,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Check Nameserver Consistency"
          description="Query each authoritative nameserver directly and verify they return the same SOA serial. Requires outbound DNS to arbitrary IPs; disable if your network blocks this."
          required={false}
        />
        <Toggle
          value={props.monitorStepDnssecMonitor.checkNameserverConsistency}
          onChange={(value: boolean) => {
            props.onChange({
              ...props.monitorStepDnssecMonitor,
              checkNameserverConsistency: value,
            });
          }}
        />
      </div>

      {!showAdvancedOptions && (
        <div className="mt-1 -ml-3">
          <Button
            title="Advanced: Expiry Warning, Timeout, Retries"
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
              title="Signature Expiry Warning (days)"
              description="Used as a default threshold for the DNSSEC signature expiry filter."
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepDnssecMonitor.signatureExpiryWarningDays?.toString() ||
                "7"
              }
              placeholder="7"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDnssecMonitor,
                  signatureExpiryWarningDays: parseInt(value) || 7,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Timeout (ms)"
              description="How long to wait for each DNS query before timing out"
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepDnssecMonitor.timeout?.toString() || "10000"
              }
              placeholder="10000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDnssecMonitor,
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
                props.monitorStepDnssecMonitor.retries?.toString() || "3"
              }
              placeholder="3"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepDnssecMonitor,
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

export default DnssecMonitorStepForm;
