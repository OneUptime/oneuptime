import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import SnmpOid, {
  SnmpOidTemplates,
} from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Input from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import IconProp from "Common/Types/Icon/IconProp";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";

export interface ComponentProps {
  value: Array<SnmpOid>;
  onChange: (value: Array<SnmpOid>) => void;
}

const SnmpOidEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [oids, setOids] = useState<Array<SnmpOid>>(props.value || []);
  const [showTemplates, setShowTemplates] = useState<boolean>(false);

  useEffect(() => {
    setOids(props.value || []);
  }, [props.value]);

  const addOid = (): void => {
    const newOids: Array<SnmpOid> = [
      ...oids,
      { oid: "", name: "", description: "" },
    ];
    setOids(newOids);
    props.onChange(newOids);
  };

  const removeOid = (index: number): void => {
    const newOids: Array<SnmpOid> = oids.filter((_, i) => {
      return i !== index;
    });
    setOids(newOids);
    props.onChange(newOids);
  };

  const updateOid = (
    index: number,
    field: keyof SnmpOid,
    value: string,
  ): void => {
    const newOids: Array<SnmpOid> = [...oids];
    newOids[index] = { ...newOids[index]!, [field]: value };
    setOids(newOids);
    props.onChange(newOids);
  };

  const addTemplate = (template: SnmpOid): void => {
    const newOids: Array<SnmpOid> = [...oids, template];
    setOids(newOids);
    props.onChange(newOids);
    setShowTemplates(false);
  };

  const templateOptions: Array<DropdownOption> =
    SnmpOidTemplates.getCommonOids().map((template: SnmpOid) => {
      return {
        label: `${template.name} (${template.oid})`,
        value: template.oid,
      };
    });

  return (
    <div>
      <FieldLabelElement
        title="OIDs to Monitor"
        description="Add the OIDs you want to query from the SNMP device"
        required={true}
      />

      {oids.length > 0 && (
        <div className="space-y-3 mt-3">
          {oids.map((oid: SnmpOid, index: number) => {
            return (
              <div
                key={index}
                className="flex items-start space-x-2 p-3 border rounded-md bg-gray-50"
              >
                <div className="flex-1 space-y-2">
                  <Input
                    initialValue={oid.oid}
                    placeholder="OID (e.g., 1.3.6.1.2.1.1.1.0)"
                    onChange={(value: string) => {
                      updateOid(index, "oid", value);
                    }}
                  />
                  <div className="flex space-x-2">
                    <Input
                      initialValue={oid.name || ""}
                      placeholder="Name (optional)"
                      onChange={(value: string) => {
                        updateOid(index, "name", value);
                      }}
                    />
                    <Input
                      initialValue={oid.description || ""}
                      placeholder="Description (optional)"
                      onChange={(value: string) => {
                        updateOid(index, "description", value);
                      }}
                    />
                  </div>
                </div>
                <Button
                  buttonStyle={ButtonStyleType.ICON}
                  icon={IconProp.Trash}
                  onClick={() => {
                    removeOid(index);
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex space-x-2">
        <Button
          title="Add OID"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={addOid}
          icon={IconProp.Add}
        />
        <Button
          title="Add from Template"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={() => {
            setShowTemplates(!showTemplates);
          }}
          icon={IconProp.Template}
        />
      </div>

      {showTemplates && (
        <div className="mt-3">
          <Dropdown
            options={templateOptions}
            placeholder="Select a common OID template..."
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (value) {
                const template: SnmpOid | undefined =
                  SnmpOidTemplates.getCommonOids().find((t: SnmpOid) => {
                    return t.oid === value.toString();
                  });
                if (template) {
                  addTemplate(template);
                }
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

export default SnmpOidEditor;
