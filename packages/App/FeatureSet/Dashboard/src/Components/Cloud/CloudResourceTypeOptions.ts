import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
} from "Common/Types/Cloud/CloudPlatform";
import {
  CLOUD_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
} from "Common/Types/Cloud/CloudResourceCatalog";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * A Type filter's options: the catalog's types under their labels - the
 * clouds' product names, which every page draws as written in every
 * language (getCloudResourceTypeText). The menu draws them as written too
 * (isUserContent), as the chip the filter leaves above the table and the
 * rows under it do: a Spanish menu said "Máquina virtual" where its chip
 * and every row said "Virtual Machine" (#7659).
 *
 * An account's Resources list its own cloud's types, by their labels alone
 * (`provider`); All Resources lists every cloud's (null), each with its
 * cloud's name: "Virtual Machine (Azure)". A type the catalog does not list
 * is still found through the Name search. Sorted by what they say.
 */
export function getCloudResourceTypeOptions(
  provider: CloudProvider | string | null,
): Array<DropdownOption> {
  return CLOUD_RESOURCE_TYPES.filter(
    (descriptor: CloudResourceTypeDescriptor): boolean => {
      return provider === null || descriptor.provider === provider;
    },
  )
    .map((descriptor: CloudResourceTypeDescriptor): DropdownOption => {
      return {
        label:
          provider === null
            ? `${descriptor.label} (${CLOUD_PROVIDER_LABELS[descriptor.provider]})`
            : descriptor.label,
        value: descriptor.type,
        isUserContent: true,
      };
    })
    .sort((a: DropdownOption, b: DropdownOption): number => {
      return a.label.localeCompare(b.label);
    });
}
