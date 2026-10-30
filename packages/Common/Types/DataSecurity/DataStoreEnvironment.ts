/*
 * WHICH ENVIRONMENT A STORE SERVES.
 *
 * Read from its tags or labels (`env`, `environment`, `stage`, `tier`) and
 * from the words in its name, the way teams already mark them. It matters
 * twice: production data copied into a non-production store is an issue of
 * its own (development stores are rarely guarded like production ones), and
 * production adds to an issue's risk score.
 */
enum DataStoreEnvironment {
  Production = "Production",
  Staging = "Staging",
  Development = "Development",
  Test = "Test",
  Unknown = "Unknown",
}

export default DataStoreEnvironment;

export const ALL_DATA_STORE_ENVIRONMENTS: ReadonlyArray<DataStoreEnvironment> =
  [
    DataStoreEnvironment.Production,
    DataStoreEnvironment.Staging,
    DataStoreEnvironment.Development,
    DataStoreEnvironment.Test,
    DataStoreEnvironment.Unknown,
  ];

const TAG_KEYS: ReadonlyArray<string> = [
  "env",
  "environment",
  "stage",
  "tier",
  "deployment-environment",
  "deployment_environment",
  "deployment.environment",
  "app-env",
];

const WORDS: ReadonlyArray<[DataStoreEnvironment, ReadonlyArray<string>]> = [
  [DataStoreEnvironment.Production, ["prod", "production", "prd", "live"]],
  [DataStoreEnvironment.Staging, ["staging", "stage", "stg", "preprod", "uat"]],
  [
    DataStoreEnvironment.Development,
    ["dev", "development", "sandbox", "scratch", "playground"],
  ],
  [DataStoreEnvironment.Test, ["test", "testing", "qa", "ci", "e2e"]],
];

function environmentOfWords(text: string): DataStoreEnvironment | null {
  const words: Array<string> = text.toLowerCase().split(/[^a-z0-9]/);

  for (const [environment, names] of WORDS) {
    for (const name of names) {
      if (words.includes(name)) {
        return environment;
      }
    }
  }

  return null;
}

/*
 * The environment a store's tags name, else the one its name names, else
 * Unknown.
 */
export function inferDataStoreEnvironment(
  name: string,
  tags: Readonly<Record<string, string>> | null | undefined,
): DataStoreEnvironment {
  for (const [key, value] of Object.entries(tags || {})) {
    if (TAG_KEYS.includes(key.toLowerCase())) {
      const fromTag: DataStoreEnvironment | null = environmentOfWords(value);

      if (fromTag) {
        return fromTag;
      }
    }
  }

  return environmentOfWords(name) || DataStoreEnvironment.Unknown;
}

export function isNonProduction(environment: string | undefined): boolean {
  return (
    environment === DataStoreEnvironment.Staging ||
    environment === DataStoreEnvironment.Development ||
    environment === DataStoreEnvironment.Test
  );
}
