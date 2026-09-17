import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { normalizeMac } from "Common/Utils/Monitor/EndpointAttachmentUtil";

/*
 * The MAC Address field, shared by every NetworkDevice form (the create
 * form, the Settings form, the Overview card and the topology's Add to
 * Monitoring dialog) so the four cannot drift apart - the same reason
 * HOSTNAME_FIELD_DESCRIPTION exists.
 *
 * A plain .ts module rather than a piece of a .tsx page for the reason
 * DiscoveryScanFormValidation gives: App/tsconfig excludes the Dashboard's
 * .tsx, so this is what App/Tests can import and pin.
 */

export const MAC_ADDRESS_FIELD_TITLE: string = "MAC Address";

/*
 * What the field is FOR, in the operator's terms. The mechanism (forwarding
 * tables, ARP) is named because it is the answer to "why would I type this",
 * and the auto-fill is named so nobody types forty of them that a router
 * would have filled in anyway.
 */
export const MAC_ADDRESS_FIELD_DESCRIPTION: string =
  "Optional. Lets the topology map find the switch port this device is plugged into from the forwarding tables of the switches it monitors — the link LLDP and CDP cannot report for a device that speaks neither, such as a register, a handset or anything monitored by ping alone. Leave it empty if the device's hostname is an IP address and a router (or any walked device with an ARP table) at its site collects endpoints: the MAC is then learned from that table and filled in here, and corrected if the address later moves to another MAC. A MAC you type is never overwritten.";

export const MAC_ADDRESS_FIELD_PLACEHOLDER: string = "aa:bb:cc:dd:ee:ff";

/*
 * The message the server gives for the same mistake, so a value the form
 * lets through is one the server will accept, and vice versa.
 */
export const MAC_ADDRESS_VALIDATION_MESSAGE: string =
  "MAC Address must be six pairs of hex digits, for example aa:bb:cc:dd:ee:ff. Dashes, dots and bare hex are accepted too.";

export type MacAddressValidatorFunction = (
  values: FormValues<NetworkDevice>,
) => string | null;

/*
 * Against the RAW value, like validateSnmpPort: the field is optional, so a
 * blank box says nothing here and is left to `required`. Anything else has
 * to normalise - the same normaliser the server and the endpoint inventory
 * use, so every spelling the server accepts the form accepts too.
 */
export const validateMacAddress: MacAddressValidatorFunction = (
  values: FormValues<NetworkDevice>,
): string | null => {
  const raw: unknown = values["macAddress"];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }

  if (!normalizeMac(String(raw))) {
    return MAC_ADDRESS_VALIDATION_MESSAGE;
  }

  return null;
};

export interface MacAddressFormFieldOptions {
  /*
   * Form step the field belongs to, on the forms that have steps. It sits
   * beside the hostname - it is the device's other address - so callers pass
   * the hostname's step.
   */
  stepId?: string | undefined;
}

export function getMacAddressFormField(
  options?: MacAddressFormFieldOptions,
): Field<NetworkDevice> {
  const field: Field<NetworkDevice> = {
    field: {
      macAddress: true,
    },
    title: MAC_ADDRESS_FIELD_TITLE,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: MAC_ADDRESS_FIELD_PLACEHOLDER,
    description: MAC_ADDRESS_FIELD_DESCRIPTION,
    customValidation: validateMacAddress,
  };

  if (!options?.stepId) {
    return field;
  }

  return { ...field, stepId: options.stepId };
}
