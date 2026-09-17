import React, { FunctionComponent, ReactElement } from "react";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import Input from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import DropdownUtil from "Common/UI/Utils/Dropdown";

export interface ComponentProps {
  value: SnmpV3Auth;
  onChange: (value: SnmpV3Auth) => void;
}

const SnmpV3AuthForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const securityLevelOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(SnmpSecurityLevel);

  const authProtocolOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(SnmpAuthProtocol);

  const privProtocolOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(SnmpPrivProtocol);

  const showAuthFields: boolean =
    props.value.securityLevel === SnmpSecurityLevel.AuthNoPriv ||
    props.value.securityLevel === SnmpSecurityLevel.AuthPriv;

  const showPrivFields: boolean =
    props.value.securityLevel === SnmpSecurityLevel.AuthPriv;

  return (
    <div className="space-y-4">
      <div>
        <FieldLabelElement
          title="Security Level"
          description="SNMPv3 security level"
          required={true}
        />
        <Dropdown
          options={securityLevelOptions}
          initialValue={securityLevelOptions.find((option: DropdownOption) => {
            return option.value === props.value.securityLevel;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...props.value,
              securityLevel: value as SnmpSecurityLevel,
            });
          }}
        />
      </div>

      <div>
        <FieldLabelElement
          title="Username"
          description="SNMPv3 username"
          required={true}
        />
        <Input
          initialValue={props.value.username}
          placeholder="Username"
          onChange={(value: string) => {
            props.onChange({
              ...props.value,
              username: value,
            });
          }}
        />
      </div>

      {showAuthFields && (
        <>
          <div>
            <FieldLabelElement
              title="Authentication Protocol"
              description="Authentication protocol for SNMPv3"
              required={true}
            />
            <Dropdown
              options={authProtocolOptions}
              initialValue={authProtocolOptions.find(
                (option: DropdownOption) => {
                  return option.value === props.value.authProtocol;
                },
              )}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                props.onChange({
                  ...props.value,
                  authProtocol: value as SnmpAuthProtocol,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Authentication Key"
              description="Authentication password/key for SNMPv3. You can use {{secretName}} syntax for secrets."
              required={true}
            />
            <Input
              initialValue={props.value.authKey || ""}
              placeholder="Authentication Key"
              onChange={(value: string) => {
                props.onChange({
                  ...props.value,
                  authKey: value,
                });
              }}
            />
          </div>
        </>
      )}

      {showPrivFields && (
        <>
          <div>
            <FieldLabelElement
              title="Privacy Protocol"
              description="Privacy/encryption protocol for SNMPv3"
              required={true}
            />
            <Dropdown
              options={privProtocolOptions}
              initialValue={privProtocolOptions.find(
                (option: DropdownOption) => {
                  return option.value === props.value.privProtocol;
                },
              )}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                props.onChange({
                  ...props.value,
                  privProtocol: value as SnmpPrivProtocol,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title="Privacy Key"
              description="Privacy/encryption password/key for SNMPv3. You can use {{secretName}} syntax for secrets."
              required={true}
            />
            <Input
              initialValue={props.value.privKey || ""}
              placeholder="Privacy Key"
              onChange={(value: string) => {
                props.onChange({
                  ...props.value,
                  privKey: value,
                });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default SnmpV3AuthForm;
