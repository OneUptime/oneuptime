import React, { FunctionComponent, ReactElement } from "react";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SECTION_ICON,
} from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import {
  DNSSEC_MONITOR_MORE_FIELDS,
  getMonitorOptionsMoreFieldsItems,
} from "../MonitorMoreFields";
import MonitorStepDnssecMonitor from "Common/Types/Monitor/MonitorStepDnssecMonitor";
import { parseMonitorStepRetriesInput } from "Common/Types/Monitor/MonitorStepRetries";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Toggle from "Common/UI/Components/Toggle/Toggle";

export interface ComponentProps {
  monitorStepDnssecMonitor: MonitorStepDnssecMonitor;
  onChange: (value: MonitorStepDnssecMonitor) => void;
}

const DnssecMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
        <Toggle
          title="Check Nameserver Consistency"
          description="Query each authoritative nameserver directly and verify they return the same SOA serial. Requires outbound DNS to arbitrary IPs; disable if your network blocks this."
          value={props.monitorStepDnssecMonitor.checkNameserverConsistency}
          onChange={(value: boolean) => {
            props.onChange({
              ...props.monitorStepDnssecMonitor,
              checkNameserverConsistency: value,
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
          props.monitorStepDnssecMonitor,
          DNSSEC_MONITOR_MORE_FIELDS,
        )}
        dataTestId="dnssec-monitor-more-fields"
      >
        <div className="space-y-4">
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
              description="Number of times to retry after the first attempt fails. For example, 2 means up to 3 attempts in total. Set to 0 for no retries. Defaults to 3."
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

export default DnssecMonitorStepForm;
