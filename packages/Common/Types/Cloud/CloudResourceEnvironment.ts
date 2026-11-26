import { translationKey } from "../Translator";

/*
 * WHETHER A CLOUD RESOURCE IS PRODUCTION (#11010).
 *
 * Acting on savings changes a customer's cloud, so it has to know what it
 * must never touch on its own: an off-hours schedule never stops
 * production, and no AI rule acts on production without a person, under
 * any rule. Getting it wrong one way stops a team's database at 19:00; the
 * other way only leaves a saving for a person to approve. So:
 *
 *   - Production on any sign of it, wherever it comes from: a production
 *     sign beats a non-production one.
 *   - Non-production only on a sign of it: never because nothing says
 *     production.
 *   - Unknown otherwise, read as production by every schedule and rule.
 *
 * The signs, in the words teams already use for them:
 *
 *   1. The resource's own cloud tags - an "environment", "env", "stage" or
 *      OpenTelemetry's "deployment.environment" tag: the convention each
 *      cloud's own scheduler reads (AWS Instance Scheduler, Azure's
 *      Start/Stop VMs, Google Cloud's instance schedules), and the one a
 *      cost report groups by.
 *   2. Its account: many teams keep production in accounts of its own (an
 *      AWS account, an Azure subscription, a Google Cloud project), which
 *      a person marks on the account's page (CloudAccount.environment).
 *   3. Its OneUptime labels: a label named "Production", "Staging", "Dev".
 *
 * A tag of another name the team uses ("Schedule: office-hours") picks
 * what a schedule stops; it never makes a resource non-production.
 *
 * Data Security reads a store's environment from the same tags
 * (Types/DataSecurity/DataStoreEnvironment), and from the words in its
 * name when no tag says. This never reads a name: "staging-web" may be
 * the web server production's staging pipeline deploys to, and a name
 * read wrong here stops something, where there it only moves a risk
 * score. The words are Data Security's, and a few more.
 */

/*
 * Stored on a savings action and an account (CloudAccount.environment),
 * and sent by the API: a wire contract.
 */
export enum CloudResourceEnvironment {
  Production = "Production",
  NonProduction = "NonProduction",
  Unknown = "Unknown",
}

export const CLOUD_RESOURCE_ENVIRONMENTS: ReadonlyArray<CloudResourceEnvironment> =
  [
    CloudResourceEnvironment.Production,
    CloudResourceEnvironment.NonProduction,
    CloudResourceEnvironment.Unknown,
  ];

export function isCloudResourceEnvironment(
  value: unknown,
): value is CloudResourceEnvironment {
  return (
    typeof value === "string" &&
    (CLOUD_RESOURCE_ENVIRONMENTS as ReadonlyArray<string>).includes(value)
  );
}

export const CLOUD_RESOURCE_ENVIRONMENT_LABELS: Readonly<
  Record<CloudResourceEnvironment, string>
> = {
  [CloudResourceEnvironment.Production]: translationKey("Production"),
  [CloudResourceEnvironment.NonProduction]: translationKey("Non-production"),
  [CloudResourceEnvironment.Unknown]: translationKey("Not known"),
};

/*
 * The tag keys that name a resource's environment, compared without case
 * and without "-", "_", "." or spaces: "Environment", "env",
 * "deployment.environment", "deployment-environment.name"...
 */
export const CLOUD_ENVIRONMENT_TAG_KEYS: ReadonlyArray<string> = [
  "environment",
  "env",
  "stage",
  "tier",
  "appenv",
  "deploymentenvironment",
  "deploymentenvironmentname",
  "appenvironment",
  "environmentname",
  "envname",
];

// The words that say production.
export const CLOUD_PRODUCTION_WORDS: ReadonlyArray<string> = [
  "prod",
  "production",
  "prd",
  "live",
];

// The words that say not production.
export const CLOUD_NON_PRODUCTION_WORDS: ReadonlyArray<string> = [
  "dev",
  "develop",
  "development",
  "devel",
  "test",
  "testing",
  "tst",
  "qa",
  "uat",
  "staging",
  "stage",
  "stg",
  "sandbox",
  "sbx",
  "demo",
  "preview",
  "nonprod",
  "nonproduction",
  "preprod",
  "preproduction",
  "perf",
  "performance",
  "load",
  "loadtest",
  "ci",
  "e2e",
  "lab",
  "playground",
  "experiment",
  "experimental",
  "integration",
  "int",
  "sit",
  "poc",
  "scratch",
  "temp",
  "ephemeral",
  "review",
  "training",
];

// A key or word as compared: lower case, without "-", "_", "." or spaces.
export function normalizeEnvironmentWord(value: string): string {
  return (value || "").toLowerCase().replace(/[\s._-]+/g, "");
}

/*
 * What a value says: production, not production, or nothing. The whole
 * value first ("non-prod", "pre-prod" are one word each), then each word
 * in it ("prod-eu-1", "dev west"): a production word anywhere wins.
 */
export function readEnvironmentWord(
  value: string | undefined | null,
): CloudResourceEnvironment {
  const whole: string = normalizeEnvironmentWord(value || "");

  if (!whole) {
    return CloudResourceEnvironment.Unknown;
  }

  if (CLOUD_PRODUCTION_WORDS.includes(whole)) {
    return CloudResourceEnvironment.Production;
  }

  if (CLOUD_NON_PRODUCTION_WORDS.includes(whole)) {
    return CloudResourceEnvironment.NonProduction;
  }

  const words: Array<string> = (value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  if (
    words.some((word: string): boolean => {
      return CLOUD_PRODUCTION_WORDS.includes(word);
    })
  ) {
    return CloudResourceEnvironment.Production;
  }

  if (
    words.some((word: string): boolean => {
      return CLOUD_NON_PRODUCTION_WORDS.includes(word);
    })
  ) {
    return CloudResourceEnvironment.NonProduction;
  }

  return CloudResourceEnvironment.Unknown;
}

// What a resource's cloud tags say of its environment.
export function readEnvironmentFromTags(
  tags: Record<string, unknown> | undefined | null,
): CloudResourceEnvironment {
  const found: Array<CloudResourceEnvironment> = [];

  for (const [key, value] of Object.entries(tags || {})) {
    if (
      !CLOUD_ENVIRONMENT_TAG_KEYS.includes(normalizeEnvironmentWord(key)) ||
      typeof value !== "string"
    ) {
      continue;
    }

    found.push(readEnvironmentWord(value));
  }

  return combineEnvironments(found);
}

// What a resource's OneUptime labels say: a label named for its environment.
export function readEnvironmentFromLabels(
  labelNames: Array<string | undefined> | undefined | null,
): CloudResourceEnvironment {
  return combineEnvironments(
    (labelNames || []).map(
      (name: string | undefined): CloudResourceEnvironment => {
        const whole: string = normalizeEnvironmentWord(name || "");

        // A label is a word of its own: "Production", "Staging", "env: dev".
        if (CLOUD_PRODUCTION_WORDS.includes(whole)) {
          return CloudResourceEnvironment.Production;
        }

        if (CLOUD_NON_PRODUCTION_WORDS.includes(whole)) {
          return CloudResourceEnvironment.NonProduction;
        }

        const colon: number = (name || "").search(/[:=]/);

        if (colon > 0) {
          const key: string = normalizeEnvironmentWord(
            (name || "").slice(0, colon),
          );

          if (CLOUD_ENVIRONMENT_TAG_KEYS.includes(key)) {
            return readEnvironmentWord((name || "").slice(colon + 1));
          }
        }

        return CloudResourceEnvironment.Unknown;
      },
    ),
  );
}

// Several signs as one: production wins, then non-production, then unknown.
export function combineEnvironments(
  signs: Array<CloudResourceEnvironment | undefined | null>,
): CloudResourceEnvironment {
  if (signs.includes(CloudResourceEnvironment.Production)) {
    return CloudResourceEnvironment.Production;
  }

  if (signs.includes(CloudResourceEnvironment.NonProduction)) {
    return CloudResourceEnvironment.NonProduction;
  }

  return CloudResourceEnvironment.Unknown;
}

// Where a resource's environment was read from: the dialog says why.
export enum CloudEnvironmentSource {
  Tag = "Tag",
  Account = "Account",
  Label = "Label",
  None = "None",
}

export interface CloudResourceEnvironmentReading {
  environment: CloudResourceEnvironment;
  source: CloudEnvironmentSource;
}

/*
 * A resource's environment from all its signs, and the one that decided
 * it: its tags, its account's setting, its labels.
 */
export function getCloudResourceEnvironment(data: {
  tags?: Record<string, unknown> | undefined | null;
  accountEnvironment?: CloudResourceEnvironment | string | undefined | null;
  labelNames?: Array<string | undefined> | undefined | null;
}): CloudResourceEnvironmentReading {
  const fromTags: CloudResourceEnvironment = readEnvironmentFromTags(data.tags);
  const fromAccount: CloudResourceEnvironment = isCloudResourceEnvironment(
    data.accountEnvironment,
  )
    ? data.accountEnvironment
    : CloudResourceEnvironment.Unknown;
  const fromLabels: CloudResourceEnvironment = readEnvironmentFromLabels(
    data.labelNames,
  );
  const signs: Array<[CloudResourceEnvironment, CloudEnvironmentSource]> = [
    [fromTags, CloudEnvironmentSource.Tag],
    [fromAccount, CloudEnvironmentSource.Account],
    [fromLabels, CloudEnvironmentSource.Label],
  ];

  for (const wanted of [
    CloudResourceEnvironment.Production,
    CloudResourceEnvironment.NonProduction,
  ]) {
    const sign: [CloudResourceEnvironment, CloudEnvironmentSource] | undefined =
      signs.find(
        (
          entry: [CloudResourceEnvironment, CloudEnvironmentSource],
        ): boolean => {
          return entry[0] === wanted;
        },
      );

    if (sign) {
      return { environment: sign[0], source: sign[1] };
    }
  }

  return {
    environment: CloudResourceEnvironment.Unknown,
    source: CloudEnvironmentSource.None,
  };
}

// Whether a schedule, or a rule acting without asking, may touch it: only when known not production.
export function isKnownNonProduction(
  environment: CloudResourceEnvironment | string | undefined | null,
): boolean {
  return environment === CloudResourceEnvironment.NonProduction;
}
