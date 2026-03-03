import React, { FunctionComponent, ReactElement, useState } from "react";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import SnmpOidEditor from "./SnmpOidEditor";
import SnmpV3AuthForm from "./SnmpV3AuthForm";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Link from "Common/UI/Components/Link/Link";
import URL from "Common/Types/API/URL";
import { DOCS_URL } from "Common/UI/Config";

export interface ComponentProps {
  monitorStepSnmpMonitor: MonitorStepSnmpMonitor;
  onChange: (value: MonitorStepSnmpMonitor) => void;
}

const SnmpMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);

  const snmpVersionOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(SnmpVersion);

  const isV3: boolean =
    props.monitorStepSnmpMonitor.snmpVersion === SnmpVersion.V3;

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="SNMP Version"
          description="Select the SNMP protocol version"
          required={true}
        />
        <Dropdown
          options={snmpVersionOptions}
          initialValue={snmpVersionOptions.find((option: DropdownOption) => {
            return option.value === props.monitorStepSnmpMonitor.snmpVersion;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const newConfig: MonitorStepSnmpMonitor = {
              ...props.monitorStepSnmpMonitor,
              snmpVersion: value as SnmpVersion,
            };

            // Initialize v3 auth if switching to v3
            if (value === SnmpVersion.V3 && !newConfig.snmpV3Auth) {
              newConfig.snmpV3Auth = {
                securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
                username: "",
              };
              newConfig.communityString = undefined;
            }

            // Clear v3 auth if switching away from v3
            if (value !== SnmpVersion.V3) {
              newConfig.snmpV3Auth = undefined;
              if (!newConfig.communityString) {
                newConfig.communityString = "public";
              }
            }

            props.onChange(newConfig);
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Hostname or IP Address"
          description="The hostname or IP address of the SNMP device"
          required={true}
        />
        <Input
          initialValue={props.monitorStepSnmpMonitor.hostname}
          placeholder="192.168.1.1 or switch.example.com"
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepSnmpMonitor,
              hostname: value,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Port"
          description="SNMP port (default: 161)"
          required={true}
        />
        <Input
          initialValue={props.monitorStepSnmpMonitor.port?.toString() || "161"}
          placeholder="161"
          type={InputType.NUMBER}
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepSnmpMonitor,
              port: parseInt(value) || 161,
            });
          }}
        />
      </div>

      {!isV3 && (
        <div>
          <FieldLabelElement
            title="Community String"
            description={
              <p>
                SNMP community string for authentication.{" "}
                <Link
                  className="underline"
                  openInNewTab={true}
                  to={URL.fromString(
                    DOCS_URL.toString() + "/monitor/monitor-secrets",
                  )}
                >
                  You can use secrets here.
                </Link>
              </p>
            }
            required={true}
          />
          <Input
            initialValue={
              props.monitorStepSnmpMonitor.communityString || "public"
            }
            placeholder="public"
            onChange={(value: string) => {
              props.onChange({
                ...props.monitorStepSnmpMonitor,
                communityString: value,
              });
            }}
          />
        </div>
      )}

      {isV3 && props.monitorStepSnmpMonitor.snmpV3Auth && (
        <div className="border p-4 rounded-md bg-gray-50">
          <h4 className="font-medium mb-3">SNMPv3 Authentication</h4>
          <SnmpV3AuthForm
            value={props.monitorStepSnmpMonitor.snmpV3Auth}
            onChange={(value: SnmpV3Auth) => {
              props.onChange({
                ...props.monitorStepSnmpMonitor,
                snmpV3Auth: value,
              });
            }}
          />
        </div>
      )}

      <SnmpOidEditor
        value={props.monitorStepSnmpMonitor.oids}
        onChange={(oids: Array<SnmpOid>) => {
          props.onChange({
            ...props.monitorStepSnmpMonitor,
            oids: oids,
          });
        }}
      />

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
                props.monitorStepSnmpMonitor.timeout?.toString() || "5000"
              }
              placeholder="5000"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepSnmpMonitor,
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
                props.monitorStepSnmpMonitor.retries?.toString() || "3"
              }
              placeholder="3"
              type={InputType.NUMBER}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepSnmpMonitor,
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

export default SnmpMonitorStepForm;
