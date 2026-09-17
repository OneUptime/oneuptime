import PageComponentProps from "../../PageComponentProps";
import SnmpOidEditor from "../../../Components/Form/Monitor/SnmpMonitor/SnmpOidEditor";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import {
  MAX_DEVICE_SPECIFIC_OIDS,
  MAX_EFFECTIVE_OIDS_PER_DEVICE,
  MAX_OIDS_PER_TEMPLATE,
} from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const oidCollectionTemplateDocumentation: string = `
### What an OID Collection Template Is

**You do not need OIDs for interfaces. Bits in/out, errors, utilization and up/down are collected for every port on every poll, automatically, and can be alerted on per port. OID Collection Templates are for the things that are not per-port: CPU, memory, temperature, fans, power supplies.**

A template is one named list of SNMP OIDs that many devices share. Link devices to it and they poll that list. Nothing is copied onto the device: the list is merged fresh on every poll, so editing the template changes what every linked device collects, with no per-device edit and no re-import.

A device can still carry its own **Device-Specific Health OIDs** on top of the template — the one sensor that only that chassis has. The effective list a probe receives is the template's OIDs first, in template order, then the device's own additions. If the same OID is in both, the device's entry wins (it keeps the name and description the operator gave it) but stays at the template's position, so growing a shared template can never push somebody's device-specific OID off the end.

### Coming from Zabbix

| Zabbix | OneUptime |
| --- | --- |
| Template | OID Collection Template |
| Item | An OID on that template |
| The "Network interfaces by SNMP" discovery rule, and its item prototypes | Built in and always on. There is nothing to author — every port is walked, charted and alertable on every poll |
| Trigger | Monitor criteria |
| Host group | Labels |

The discovery-rule row is the one that saves the most work. In Zabbix, per-port counters exist because you attached a low-level discovery rule with item prototypes. Here the interface walk is part of every poll: bits in and out, errors per second, utilization and oper status already exist for every port on every SNMP device, keyed by interface name and index. Do not re-create them as OIDs. A hand-typed per-port OID gives you one flat series for one interface index, and it silently follows the wrong port the day that index moves.

### Criteria

Criteria alert on what is collected, and they are set on the monitor, not here. Interface criteria fan out — one criterion covers every port. **OID criteria do not: one criterion covers one OID.** Alerting on CPU, memory and temperature is three criteria, and there is no wildcard that means "any OID" — the wildcard fan-out is interface-only.

### Limits

- Up to **${MAX_OIDS_PER_TEMPLATE} OIDs per template**.
- Plus up to **${MAX_DEVICE_SPECIFIC_OIDS} device-specific OIDs** on a device linked to one. The two compose to the **${MAX_EFFECTIVE_OIDS_PER_DEVICE}** a device may poll, so a linked device can never be silently truncated.
- A device with no template keeps the full **${MAX_EFFECTIVE_OIDS_PER_DEVICE}** for its own list. The tighter device-specific budget is what linking costs, and it applies from the moment you link.

Both caps are enforced when you save, which is what keeps the effective list a device polls at or below ${MAX_EFFECTIVE_OIDS_PER_DEVICE} OIDs. Split a bigger inventory across templates by device role — core routers, access switches, firewalls — rather than trying to carry every platform in one list.

### Vendor Profiles

**Start from a vendor profile** prefills a new template with a prebuilt set of CPU, memory, temperature, fan and power-supply OIDs for a common platform. It is a one-time prefill into this template's list: prune it, extend it, and the profile is not consulted again. Applying a profile twice, or two overlapping profiles, never duplicates an OID.
`;

const vendorProfileOptions: Array<DropdownOption> =
  SnmpVendorTemplateUtil.getAll().map(
    (vendorTemplate: SnmpVendorTemplate): DropdownOption => {
      return {
        label: vendorTemplate.label,
        value: vendorTemplate.id,
      };
    },
  );

export interface OidListFormFieldProps {
  initialValue?: Array<SnmpOid> | undefined;
  onChange?: ((value: Array<SnmpOid>) => void) | undefined;
}

/*
 * The template's OID list, plus the optional vendor prefill above it.
 *
 * The prefill is purely client-side: the eleven vendor profiles stay
 * compiled in and are never seeded as rows, so choosing one here writes its
 * OIDs into THIS template's list and nothing links the two afterwards.
 */
const OidListFormField: FunctionComponent<OidListFormFieldProps> = (
  props: OidListFormFieldProps,
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
          title="Start from a Vendor Profile"
          description="Optional. Prefills the list below with the CPU, memory, temperature, fan and power-supply OIDs a platform exposes, so you are editing a starting point instead of looking up MIBs. Prune or extend it afterwards — the profile is not linked to this template."
          required={false}
        />
        <Dropdown
          options={vendorProfileOptions}
          value={undefined}
          placeholder="Start from a vendor profile…"
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (!value || Array.isArray(value)) {
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

const NetworkDeviceOidCollectionTemplatesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkDeviceOidTemplate>
        modelType={NetworkDeviceOidTemplate}
        id="network-device-oid-templates-table"
        name="Settings > Network Device OID Collection Templates"
        userPreferencesKey="network-device-oid-templates-table"
        saveFilterProps={{
          tableId: "network-device-oid-templates-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "OID Collection Templates",
          description:
            "One named list of SNMP health OIDs — CPU, memory, temperature, fans, power supplies — shared by every device linked to it. Edit the template and collection changes everywhere, with no per-device edit. Interface counters are collected automatically and do not belong here.",
        }}
        helpContent={{
          title: "How OID Collection Templates Work",
          description:
            "Share one health-OID list across devices, and what it replaces if you are coming from Zabbix.",
          markdown: oidCollectionTemplateDocumentation,
        }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
            isNotCustomizable: true,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: { oids: true },
            title: "OIDs",
            type: FieldType.Element,
            /*
             * Count of what this template carries, NOT of the devices using
             * it: a device count is one COUNT query per row per render, and
             * it belongs on a detail page.
             */
            disableSort: true,
            getElement: (item: NetworkDeviceOidTemplate): ReactElement => {
              const oidCount: number = item.oids?.length || 0;

              if (oidCount === 0) {
                return (
                  <span className="text-sm text-gray-400">No OIDs yet</span>
                );
              }

              return (
                <span className="text-sm text-gray-900">
                  {oidCount} {oidCount === 1 ? "OID" : "OIDs"}
                </span>
              );
            },
            getExportValue: (item: NetworkDeviceOidTemplate): string => {
              return (item.oids?.length || 0).toString();
            },
          },
        ]}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "OIDs", id: "oids" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Core Routers",
            validation: { minLength: 2 },
            description:
              "What this list is for, usually a device role or platform. Names are unique in the project.",
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "CPU, memory and temperature for the Cisco IOS-XE core routers.",
          },
          {
            field: { oids: true },
            title: "OIDs",
            stepId: "oids",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            description: `The OIDs every linked device polls, up to ${MAX_OIDS_PER_TEMPLATE}. Values are recorded as device metrics and can be alerted on through monitor criteria. Interface counters — bits in/out, errors, utilization, up/down — are already collected for every port and do not need to be listed here.`,
            getCustomElement: (
              values: FormValues<NetworkDeviceOidTemplate>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <OidListFormField
                  initialValue={
                    (values.oids as Array<SnmpOid> | undefined) || []
                  }
                  onChange={(newOids: Array<SnmpOid>): void => {
                    elementProps.onChange?.(newOids);
                  }}
                />
              );
            },
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default NetworkDeviceOidCollectionTemplatesPage;
