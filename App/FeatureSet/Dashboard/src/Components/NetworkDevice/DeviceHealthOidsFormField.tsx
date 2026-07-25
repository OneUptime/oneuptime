import React, { FunctionComponent, ReactElement, useState } from "react";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import SnmpOidEditor from "../Form/Monitor/SnmpMonitor/SnmpOidEditor";

const vendorTemplateOptions: Array<DropdownOption> =
  SnmpVendorTemplateUtil.getAll().map((template: SnmpVendorTemplate) => {
    return {
      label: template.label,
      value: template.id,
    };
  });

export interface ComponentProps {
  initialValue?: Array<SnmpOid> | undefined;
  onChange?: ((value: Array<SnmpOid>) => void) | undefined;
}

/*
 * Health-OID editor for the NetworkDevice settings form (moved here from
 * the Network Device monitor step form — collection belongs to the
 * device). The values collected on each poll are recorded as
 * device-scoped metrics and can be alerted on through monitor criteria.
 */
const DeviceHealthOidsFormField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [oids, setOids] = useState<Array<SnmpOid>>(props.initialValue || []);

  const updateOids: (newOids: Array<SnmpOid>) => void = (
    newOids: Array<SnmpOid>,
  ): void => {
    setOids(newOids);
    props.onChange?.(newOids);
  };

  return (
    <div className="space-y-5">
      <div>
        <FieldLabelElement
          title="Vendor Health Template"
          description="Apply a prebuilt set of CPU, memory, and temperature OIDs for your device's vendor. The OIDs are added below, where you can prune or extend them."
          required={false}
        />
        <Dropdown
          options={vendorTemplateOptions}
          value={undefined}
          placeholder="Apply a vendor template…"
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (!value) {
              return;
            }
            updateOids(
              SnmpVendorTemplateUtil.mergeOids(oids, value.toString()),
            );
          }}
        />
      </div>

      <SnmpOidEditor value={oids} onChange={updateOids} />
    </div>
  );
};

export default DeviceHealthOidsFormField;
