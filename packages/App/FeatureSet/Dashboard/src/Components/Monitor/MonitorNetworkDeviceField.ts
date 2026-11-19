import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/Types/Translator";

/*
 * THE NETWORK DEVICE A MONITOR CHECKS, AS A FORM ASKS IT (OneUptime issue
 * #9545).
 *
 * A Ping, IP, Port, NTP, Website, API or SSL Certificate monitor a person
 * makes on a device's address can be tied to that device
 * (Monitor.networkDeviceId): what lists it on the device's pages, links what
 * it raises to the device, and keeps an import or an auto import rule from
 * giving the device a second monitor like it. Create Monitor asks it folded
 * under More fields - most monitors check no device - and the monitor's
 * Details card lets it be changed or cleared; both draw this one field.
 *
 * Left empty on a new monitor, the server ties it to the one device at the
 * address it checks, when exactly one is there (MonitorDeviceLink).
 */

// In English: the form draws them in the reader's language.
export const NETWORK_DEVICE_FIELD_TITLE: string =
  translationKey("Network Device");

export const NETWORK_DEVICE_FIELD_DESCRIPTION: string = translationKey(
  "The device this monitor checks. It is listed on the device's pages, and an import never gives the device a second one like it.",
);

/*
 * Whether the reader may see which device a monitor is of: the monitor's
 * column, and the devices themselves. Asked before the field or the
 * device's name is drawn - a relation the reader cannot read fails the
 * whole read of the monitor.
 */
export function canReadMonitorDevice(): boolean {
  return (
    PermissionGate.canReadColumn(new Monitor(), "networkDevice") &&
    PermissionGate.check(new NetworkDevice(), ModelAction.Read).isAllowed
  );
}

export function getMonitorNetworkDeviceFormField(options: {
  stepId?: string | undefined;
  collapsibleSection?: Field<Monitor>["collapsibleSection"];
  placeholder: string;
  showIf?: ((values: FormValues<Monitor>) => boolean) | undefined;
}): Field<Monitor> {
  return {
    field: {
      networkDevice: true,
    },
    ...(options.stepId ? { stepId: options.stepId } : {}),
    title: NETWORK_DEVICE_FIELD_TITLE,
    description: NETWORK_DEVICE_FIELD_DESCRIPTION,
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: {
      type: NetworkDevice,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: options.placeholder,
    ...(options.collapsibleSection
      ? { collapsibleSection: options.collapsibleSection }
      : {}),
    ...(options.showIf ? { showIf: options.showIf } : {}),
  };
}
