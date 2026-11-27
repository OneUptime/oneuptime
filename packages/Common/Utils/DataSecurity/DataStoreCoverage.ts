import {
  DataStoreExposureCheck,
  DataStoreFamily,
  DataStoreKindInfo,
  DataStoreProvider,
  getDataStoreExposureCheck,
  getDataStoreKindInfo,
  isSearchEngineDataStoreKind,
  PROBE_SCANNABLE_DATABASE_KINDS,
  DataStoreKind,
  WORKER_CLAIMED_DATA_STORE_KINDS,
} from "../../Types/DataSecurity/DataStoreKind";
import { translationKey } from "../../Types/Translator";

/*
 * WHAT ONEUPTIME CHECKS ON A KIND OF STORE, AND WHAT IT CANNOT, AND WHY
 * (#11140).
 *
 * A person could add an Elasticsearch store, fill in a connection string,
 * and wait for scans and an exposure that would never come: nothing said
 * that OneUptime could not sample its content or check how it was reached.
 * The form that adds a store, its Settings and its Overview read this one
 * list instead, so each says the same, before anyone spends time on setup:
 *
 *  - its content: sampled for sensitive data, and how - or that it cannot
 *    be yet;
 *  - its exposure: read from a cloud's own settings, asked of the store's
 *    own address with each scan, held by OneUptime - or not checkable;
 *  - for a store asked at its own address, whether the internet reaches
 *    it: known when OneUptime Cloud's servers reach it, not from inside
 *    your network;
 *  - its encryption at rest, backups and access logging: in a cloud's
 *    settings, or nowhere OneUptime can see.
 *
 * Each line's words are translation keys, drawn in the reader's language.
 */

export enum DataStoreCoverageKey {
  Content = "content",
  Exposure = "exposure",
  Credentials = "credentials",
  Internet = "internet",
  Configuration = "configuration",
  Tracking = "tracking",
}

export interface DataStoreCoverageItem {
  key: DataStoreCoverageKey;
  // Whether OneUptime checks it.
  isChecked: boolean;
  // What it is, in a few words.
  label: string;
  // How it is checked, or why it is not, in a sentence.
  detail: string;
}

export interface DataStoreCoverageInput {
  kind: string | undefined | null;
  // Scanned from one of the project's probes, inside its network.
  isScannedFromProbe?: boolean | undefined;
  /*
   * OneUptime Cloud, whose servers reach a store over the internet: a store
   * they reach is reachable from it. A OneUptime someone hosts runs inside
   * a network, where that says nothing of the internet.
   */
  isOneUptimeCloud: boolean;
}

const SAMPLED_TABLES: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Content,
  isChecked: true,
  label: translationKey("Sensitive data in its tables"),
  detail: translationKey(
    "A few rows of each table, read with a read-only connection string.",
  ),
};

const SAMPLED_INDICES: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Content,
  isChecked: true,
  label: translationKey("Sensitive data in its indices"),
  detail: translationKey(
    "A few of each index's newest documents, read with a read-only user.",
  ),
};

const SAMPLED_FILES: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Content,
  isChecked: true,
  label: translationKey("Sensitive data in its files"),
  detail: translationKey(
    "A sample of them, read through its cloud connection when the connection allows content reads.",
  ),
};

const SAMPLED_DATASET: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Content,
  isChecked: true,
  label: translationKey("Sensitive data in its tables"),
  detail: translationKey(
    "A few rows of each table, read through its cloud connection when the connection allows content reads.",
  ),
};

const SAMPLED_TELEMETRY: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Content,
  isChecked: true,
  label: translationKey("Sensitive data in what your services send"),
  detail: translationKey("Its last hour, scanned every hour."),
};

const NOT_SAMPLED: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Content,
  isChecked: false,
  label: translationKey("Sensitive data in it"),
  detail: translationKey(
    "OneUptime cannot sample this kind of store's content yet.",
  ),
};

const EXPOSURE_FROM_CLOUD: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Exposure,
  isChecked: true,
  label: translationKey("Who can reach it"),
  detail: translationKey(
    "Read from its cloud's own settings, through a cloud connection with Data Security turned on.",
  ),
};

const EXPOSURE_HELD_BY_ONEUPTIME: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Exposure,
  isChecked: true,
  label: translationKey("Who can reach it"),
  detail: translationKey(
    "OneUptime holds it: only your project's members reach it, through OneUptime.",
  ),
};

const EXPOSURE_NOT_CHECKABLE: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Exposure,
  isChecked: false,
  label: translationKey("Who can reach it"),
  detail: translationKey(
    "OneUptime has no way to check this kind of store, so its exposure reads Can't be checked.",
  ),
};

const ANSWERS_WITHOUT_CREDENTIALS: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Credentials,
  isChecked: true,
  label: translationKey(
    "Whether it answers without credentials, and requires TLS",
  ),
  detail: translationKey(
    "Asked with each content scan, from where the scan runs. Nothing is written to it.",
  ),
};

const INTERNET_FROM_CLOUD: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Internet,
  isChecked: true,
  label: translationKey("Whether the internet reaches it"),
  detail: translationKey(
    "OneUptime's servers reach it over the internet when they scan it.",
  ),
};

const INTERNET_NOT_FROM_INSIDE: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Internet,
  isChecked: false,
  label: translationKey("Whether the internet reaches it"),
  detail: translationKey(
    "Can't be known from inside your network, where the scan runs.",
  ),
};

const CONFIGURATION_FROM_CLOUD: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Configuration,
  isChecked: true,
  label: translationKey("Encryption, backups and access logging"),
  detail: translationKey("Read from its cloud's settings, with who can reach it."),
};

const CONFIGURATION_NOT_VISIBLE: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Configuration,
  isChecked: false,
  label: translationKey("Encryption, backups and access logging"),
  detail: translationKey(
    "Not visible from its address, and no cloud OneUptime reads holds them.",
  ),
};

const CONFIGURATION_NOT_READ: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Configuration,
  isChecked: false,
  label: translationKey("Encryption, backups and access logging"),
  detail: translationKey(
    "OneUptime does not read this kind of store's settings, so they are not checked.",
  ),
};

const TRACKED: DataStoreCoverageItem = {
  key: DataStoreCoverageKey.Tracking,
  isChecked: true,
  label: translationKey("Its owners, labels and sensitivity"),
  detail: translationKey(
    "Set by you, for its issues and the record of processing.",
  ),
};

// Every sentence a coverage line can say, for the guards that hold them translated.
export const DATA_STORE_COVERAGE_ITEMS: ReadonlyArray<DataStoreCoverageItem> = [
  SAMPLED_TABLES,
  SAMPLED_INDICES,
  SAMPLED_FILES,
  SAMPLED_DATASET,
  SAMPLED_TELEMETRY,
  NOT_SAMPLED,
  EXPOSURE_FROM_CLOUD,
  EXPOSURE_HELD_BY_ONEUPTIME,
  EXPOSURE_NOT_CHECKABLE,
  ANSWERS_WITHOUT_CREDENTIALS,
  INTERNET_FROM_CLOUD,
  INTERNET_NOT_FROM_INSIDE,
  CONFIGURATION_FROM_CLOUD,
  CONFIGURATION_NOT_VISIBLE,
  CONFIGURATION_NOT_READ,
  TRACKED,
];

// What its content scan reads, for a kind OneUptime samples.
function contentOf(info: DataStoreKindInfo): DataStoreCoverageItem {
  if (info.family === DataStoreFamily.Telemetry) {
    return SAMPLED_TELEMETRY;
  }

  if (
    !info.contentScannable ||
    !WORKER_CLAIMED_DATA_STORE_KINDS.includes(info.kind)
  ) {
    return NOT_SAMPLED;
  }

  if (isSearchEngineDataStoreKind(info.kind)) {
    return SAMPLED_INDICES;
  }

  if (PROBE_SCANNABLE_DATABASE_KINDS.includes(info.kind)) {
    return SAMPLED_TABLES;
  }

  return info.kind === DataStoreKind.GcpBigQueryDataset
    ? SAMPLED_DATASET
    : SAMPLED_FILES;
}

export function getDataStoreCoverage(
  input: DataStoreCoverageInput,
): Array<DataStoreCoverageItem> {
  const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(input.kind);

  if (!info) {
    return [];
  }

  const content: DataStoreCoverageItem = contentOf(info);

  switch (getDataStoreExposureCheck(info.kind)) {
    case DataStoreExposureCheck.HeldByOneUptime:
      return [content, EXPOSURE_HELD_BY_ONEUPTIME];
    case DataStoreExposureCheck.CloudApi:
      return [content, EXPOSURE_FROM_CLOUD, CONFIGURATION_FROM_CLOUD];
    case DataStoreExposureCheck.Endpoint:
      return [
        content,
        ANSWERS_WITHOUT_CREDENTIALS,
        !input.isScannedFromProbe && input.isOneUptimeCloud
          ? INTERNET_FROM_CLOUD
          : INTERNET_NOT_FROM_INSIDE,
        CONFIGURATION_NOT_VISIBLE,
      ];
    case DataStoreExposureCheck.None:
    default:
      return [
        content,
        EXPOSURE_NOT_CHECKABLE,
        CONFIGURATION_NOT_READ,
        // Nothing else is checked: what adding it still gives.
        ...(content.isChecked ? [] : [TRACKED]),
      ];
  }
}

/*
 * Whether a store of this kind takes a connection string in Data Security:
 * a database or search cluster OneUptime's workers sample with one. For any
 * other kind the field would be saved and never read, so it is not shown.
 */
export function takesConnectionString(kind: string | undefined | null): boolean {
  const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(kind);

  return Boolean(
    info &&
      info.provider === DataStoreProvider.SelfManaged &&
      info.contentScannable &&
      WORKER_CLAIMED_DATA_STORE_KINDS.includes(info.kind),
  );
}
