import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
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
  /*
   * The OIDs of the OID Collection Template this device is linked to.
   *
   * PRESENCE is what "linked" means here, not length: a template with an
   * empty list is still a link, and the caller passes the prop only when the
   * form actually has a template selected (conditional spread). That
   * distinction drives both the read-only block below and whether the vendor
   * copy dropdown is offered at all.
   */
  templateOids?: Array<SnmpOid> | undefined;
  templateName?: string | undefined;
}

/*
 * Health-OID editor for the NetworkDevice settings form (moved here from
 * the Network Device monitor step form — collection belongs to the
 * device). The values collected on each poll are recorded as
 * device-scoped metrics and can be alerted on through monitor criteria.
 *
 * What the device polls is the template's list plus the list edited here,
 * merged fresh on every poll and never copied onto the device — so the
 * editable list alone does not answer "what does this device collect?".
 * The template's entries are rendered above it, read-only, so the whole
 * effective list is on one screen.
 */
const DeviceHealthOidsFormField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [oids, setOids] = useState<Array<SnmpOid>>(props.initialValue || []);

  /*
   * Resync from the form, which the original seeding-once version did not do.
   *
   * On an edit form the card mounts before ModelForm has fetched the device,
   * so the first `initialValue` is an empty list; without this the editor
   * stayed empty forever and saving wiped every OID on the device. Compared
   * by content rather than by array identity because the form hands down a
   * freshly built array on every keystroke — resetting state to a
   * content-equal copy mid-edit is what moves the caret to the end of the
   * input the operator is typing in.
   */
  const initialValueKey: string = JSON.stringify(props.initialValue || []);

  useEffect(() => {
    setOids((currentOids: Array<SnmpOid>): Array<SnmpOid> => {
      if (JSON.stringify(currentOids) === initialValueKey) {
        return currentOids;
      }

      return props.initialValue || [];
    });
  }, [initialValueKey]);

  const updateOids: (newOids: Array<SnmpOid>) => void = (
    newOids: Array<SnmpOid>,
  ): void => {
    setOids(newOids);
    props.onChange?.(newOids);
  };

  const templateOids: Array<SnmpOid> | undefined = props.templateOids;
  const isTemplateLinked: boolean = templateOids !== undefined;

  /*
   * An OID on both lists resolves to the DEVICE's entry at the TEMPLATE's
   * position — SnmpOidListUtil.mergeOidLists' rule. Saying so on the row is
   * cheaper than letting an operator wonder which of the two names ends up
   * on the metric.
   */
  const deviceOidSet: Set<string> = new Set(
    oids.map((entry: SnmpOid): string => {
      return SnmpOidListUtil.normalizeOid(entry.oid);
    }),
  );

  return (
    <div className="space-y-5">
      {isTemplateLinked ? (
        <div data-testid="device-health-oids-from-template">
          <FieldLabelElement
            title={`Collected from ${props.templateName || "the linked OID Collection Template"}`}
            description="Collected on every poll because this device is linked to the template. Edit them on the template itself — the change reaches every device linked to it, with nothing to re-save here."
            required={false}
          />
          {templateOids && templateOids.length > 0 ? (
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              {templateOids.map((oid: SnmpOid, index: number) => {
                const normalized: string = SnmpOidListUtil.normalizeOid(
                  oid.oid,
                );

                return (
                  <li
                    key={`${normalized}-${index}`}
                    data-testid={`device-health-oids-template-row-${index}`}
                    className="flex flex-wrap items-baseline gap-x-2"
                  >
                    <span className="font-medium text-gray-900">
                      {oid.name || normalized}
                    </span>
                    {oid.name ? (
                      <span className="text-gray-500">{normalized}</span>
                    ) : (
                      <></>
                    )}
                    {deviceOidSet.has(normalized) ? (
                      <span className="text-amber-700">
                        overridden by this device below
                      </span>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              This template has no OIDs yet, so it adds nothing to this device.
            </p>
          )}
        </div>
      ) : (
        /*
         * Offered only when no template is linked. This dropdown COPIES a
         * vendor's OIDs into the device's own list, which is the
         * copy-not-link pattern templates exist to replace — showing both at
         * once invites an operator to duplicate their template's contents
         * onto one device and then wonder why editing the template changed
         * nothing.
         */
        <div>
          <FieldLabelElement
            title="Vendor Health Template"
            description="Apply a prebuilt set of CPU, memory, and temperature OIDs for your device's vendor. The OIDs are copied into the list below, where you can prune or extend them — this is a one-time copy, not a link."
            required={false}
          />
          <Dropdown
            options={vendorTemplateOptions}
            value={undefined}
            dataTestId="device-health-oids-vendor-template"
            placeholder="Apply a vendor template…"
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
      )}

      <SnmpOidEditor value={oids} onChange={updateOids} />
    </div>
  );
};

export default DeviceHealthOidsFormField;
