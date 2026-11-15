import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
} from "Common/Types/Cloud/CloudPlatform";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * A Provider filter's options: the clouds by their own names - "AWS",
 * "Google Cloud", "Azure" - drawn as written in every language
 * (DropdownOption.isUserContent), in the filter's menu and in the chip it
 * leaves above its table, as the rows under it draw them
 * (getCloudProviderLabel). A cloud's name is never looked up as a word
 * (#7690).
 */
export function getCloudProviderOptions(): Array<DropdownOption> {
  return Object.values(CloudProvider).map(
    (provider: CloudProvider): DropdownOption => {
      return {
        label: CLOUD_PROVIDER_LABELS[provider],
        value: provider,
        isUserContent: true,
      };
    },
  );
}
