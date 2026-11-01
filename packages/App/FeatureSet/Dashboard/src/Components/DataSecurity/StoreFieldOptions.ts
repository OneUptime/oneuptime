import DataSensitivity from "Common/Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "Common/Types/DataSecurity/DataStoreEnvironment";
import {
  DATA_STORE_KINDS,
  DataStoreKindInfo,
  DataStoreProvider,
} from "Common/Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "Common/Types/DataSecurity/DataStorePosture";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * The choices a data store's lists and forms offer, in the order people
 * look for them: most sensitive and most exposed first, Production first.
 * Kinds are named as their clouds name them, so they read the same in
 * every language.
 */

export const STORE_SENSITIVITY_OPTIONS: Array<DropdownOption> = [
  { label: "Restricted", value: DataSensitivity.Restricted },
  { label: "Confidential", value: DataSensitivity.Confidential },
  { label: "Internal", value: DataSensitivity.Internal },
  { label: "Public", value: DataSensitivity.Public },
];

export const STORE_EXPOSURE_OPTIONS: Array<DropdownOption> = [
  { label: "Public", value: DataStoreExposure.Public },
  { label: "Other accounts", value: DataStoreExposure.OtherAccounts },
  { label: "Internet reachable", value: DataStoreExposure.InternetReachable },
  { label: "Private", value: DataStoreExposure.Private },
  { label: "Unknown", value: DataStoreExposure.Unknown },
];

export const STORE_ENVIRONMENT_OPTIONS: Array<DropdownOption> = [
  { label: "Production", value: DataStoreEnvironment.Production },
  { label: "Staging", value: DataStoreEnvironment.Staging },
  { label: "Development", value: DataStoreEnvironment.Development },
  { label: "Test", value: DataStoreEnvironment.Test },
  { label: "Unknown", value: DataStoreEnvironment.Unknown },
];

export const STORE_PROVIDER_OPTIONS: Array<DropdownOption> = [
  { label: "AWS", value: DataStoreProvider.Aws },
  { label: "Azure", value: DataStoreProvider.Azure },
  { label: "Google Cloud", value: DataStoreProvider.Gcp },
  { label: "Run by you", value: DataStoreProvider.SelfManaged },
  { label: "OneUptime telemetry", value: DataStoreProvider.OneUptime },
];

// What a store's provider is called, for its rows.
export function getStoreProviderName(provider: string | undefined): string {
  const option: DropdownOption | undefined = STORE_PROVIDER_OPTIONS.find(
    (candidate: DropdownOption): boolean => {
      return candidate.value === provider;
    },
  );

  return option ? option.label : provider || "";
}

// Every kind of store, for the lists' Kind filter.
export const STORE_KIND_OPTIONS: Array<DropdownOption> = DATA_STORE_KINDS.map(
  (info: DataStoreKindInfo): DropdownOption => {
    return { label: info.kind, value: info.kind };
  },
);

/*
 * The kinds a person adds by hand: the databases a team runs itself. Cloud
 * stores are found from their accounts, and telemetry from what services
 * send.
 */
export const SELF_MANAGED_STORE_KIND_OPTIONS: Array<DropdownOption> =
  DATA_STORE_KINDS.filter((info: DataStoreKindInfo): boolean => {
    return info.provider === DataStoreProvider.SelfManaged;
  }).map((info: DataStoreKindInfo): DropdownOption => {
    return { label: info.kind, value: info.kind };
  });
