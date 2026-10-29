import NetworkAddressName from "Common/Models/DatabaseModels/NetworkAddressName";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { NetworkAddressNameUtil } from "Common/Types/NetFlow/NetworkAddressName";
import NetworkAddressBlockUtil from "Common/Utils/NetworkTraffic/NetworkAddressBlock";

/*
 * The Address Name form (issue #5340), the same on Network > Settings >
 * Address Names and in "Name this address" on a Traffic page: what to call
 * it, and the address - or the subnet, to say where every address in it
 * is. Checked the way the server checks it (NetworkAddressBlockUtil,
 * NetworkAddressNameUtil), so the form lets through exactly what is stored.
 *
 * A plain .ts module, like OtherAddressesFormField, so App/Tests can pin it.
 */

export const ADDRESS_NAME_NAME_PLACEHOLDER: string = "Payroll SaaS";

export const ADDRESS_NAME_NAME_DESCRIPTION: string = translationKey(
  "Shown on the Traffic pages. For a subnet, say where it is, like Mumbai office.",
);

export const ADDRESS_NAME_ADDRESS_PLACEHOLDER: string = "10.18.167.0/24";

export const ADDRESS_NAME_ADDRESS_DESCRIPTION: string = translationKey(
  "One IP address, or a subnet to name every address in it. IPv4 or IPv6.",
);

export const ADDRESS_NAME_ADDRESS_VALIDATION_MESSAGE: string = translationKey(
  "Enter one IP address, like 10.0.0.5, or a subnet, like 10.18.167.0/24.",
);

export const ADDRESS_NAME_NAME_VALIDATION_MESSAGE: string = translationKey(
  "Enter a name for the address.",
);

export const validateAddressNameAddress: (
  values: FormValues<NetworkAddressName>,
) => string | null = (
  values: FormValues<NetworkAddressName>,
): string | null => {
  if (NetworkAddressBlockUtil.parse(values["address"])) {
    return null;
  }

  return (
    translateText(ADDRESS_NAME_ADDRESS_VALIDATION_MESSAGE) ||
    ADDRESS_NAME_ADDRESS_VALIDATION_MESSAGE
  );
};

export const validateAddressNameName: (
  values: FormValues<NetworkAddressName>,
) => string | null = (
  values: FormValues<NetworkAddressName>,
): string | null => {
  if (NetworkAddressNameUtil.cleanName(values["name"])) {
    return null;
  }

  return (
    translateText(ADDRESS_NAME_NAME_VALIDATION_MESSAGE) ||
    ADDRESS_NAME_NAME_VALIDATION_MESSAGE
  );
};

export function getNetworkAddressNameFormFields(): Array<
  Field<NetworkAddressName>
> {
  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: ADDRESS_NAME_NAME_PLACEHOLDER,
      description: ADDRESS_NAME_NAME_DESCRIPTION,
      customValidation: validateAddressNameName,
    },
    {
      field: {
        address: true,
      },
      title: "Address or Subnet",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: ADDRESS_NAME_ADDRESS_PLACEHOLDER,
      description: ADDRESS_NAME_ADDRESS_DESCRIPTION,
      customValidation: validateAddressNameAddress,
    },
  ];
}
