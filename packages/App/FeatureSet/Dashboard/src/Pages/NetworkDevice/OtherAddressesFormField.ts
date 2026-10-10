import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import NetworkDeviceOtherAddressesUtil, {
  MAX_OTHER_ADDRESSES,
} from "Common/Utils/NetworkDevice/NetworkDeviceOtherAddresses";

/*
 * The Other Addresses field (NetworkDevice.otherAddresses): the addresses a
 * device sends traps, syslog and flow records from besides its hostname - a
 * loopback, a management interface, the outside of a firewall. A record from
 * any of them is the device's.
 *
 * On the Settings form's Address step, beside the hostname, because it IS
 * the device's other address. The Traffic page's "It is one of my devices"
 * fills it in too, one click per exporter.
 *
 * A plain .ts module, like MacAddressFormField, so App/Tests can pin it.
 */

export const OTHER_ADDRESSES_FIELD_TITLE: string = "Other Addresses";

export const OTHER_ADDRESSES_FIELD_DESCRIPTION: string = translationKey(
  "Optional. Other IP addresses this device sends flow records, traps or syslog from - a loopback or a management interface, say - separated by commas. Records from any of them are matched to this device, as records from its hostname are.",
);

export const OTHER_ADDRESSES_FIELD_PLACEHOLDER: string = "10.0.0.1, 192.0.2.10";

export const OTHER_ADDRESSES_VALIDATION_MESSAGE: string = translationKey(
  "Other Addresses takes IP addresses only, separated by commas, up to 10 of them.",
);

/*
 * The server's own check (NetworkDeviceOtherAddressesUtil.normalize), so
 * the form lets through exactly what the server stores. A blank box clears
 * the field.
 */
export const validateOtherAddresses: (
  values: FormValues<NetworkDevice>,
) => string | null = (values: FormValues<NetworkDevice>): string | null => {
  const raw: unknown = values["otherAddresses"];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }

  try {
    NetworkDeviceOtherAddressesUtil.normalize(String(raw));
  } catch {
    return (
      translateText(OTHER_ADDRESSES_VALIDATION_MESSAGE) ||
      OTHER_ADDRESSES_VALIDATION_MESSAGE
    );
  }

  return null;
};

// The limit the message names, kept in step with the server's.
export const OTHER_ADDRESSES_LIMIT: number = MAX_OTHER_ADDRESSES;

export function getOtherAddressesFormField(options?: {
  stepId?: string | undefined;
}): Field<NetworkDevice> {
  const field: Field<NetworkDevice> = {
    field: {
      otherAddresses: true,
    },
    title: OTHER_ADDRESSES_FIELD_TITLE,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: OTHER_ADDRESSES_FIELD_PLACEHOLDER,
    description: OTHER_ADDRESSES_FIELD_DESCRIPTION,
    customValidation: validateOtherAddresses,
  };

  if (options?.stepId) {
    field.stepId = options.stepId;
  }

  return field;
}
