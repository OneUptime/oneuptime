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
 * WHAT A CHANGE NOBODY APPROVES READS (#11347). An off-hours schedule's
 * stop and an AI rule's change made without asking change a resource with
 * no person looking at it, so they read its environment from what no edit
 * of a OneUptime record can say on its own (getUnattendedCloudResource
 * Environment):
 *
 *   - non-production only from the cloud's own tags or the account's
 *     Environment setting. A tag is written in the cloud: OneUptime only
 *     reads it (CloudResource.cloudTags is no person's to write). The
 *     account's Environment is the one setting whose meaning is the
 *     environment, set on the account's own page, and no agent's tool
 *     writes it;
 *   - production from any sign, labels included: a label named
 *     "Production" holds a resource back whatever its tags and its account
 *     say. It can only make things safer.
 *
 * A label's name is the weakest sign. One edit of it - in the Dashboard,
 * the API, the MCP server's update_label - changes what OneUptime believes
 * of every resource that carries it, without a resource in sight: renamed
 * from "Production" to "dev", or any label renamed to "dev", it would let
 * a schedule stop and a rule change every one of them with nobody asked.
 * So a label says non-production only to a person, who sees where it came
 * from: Apply and an owner's approval read every sign
 * (getCloudResourceEnvironment). And a label that says production, renamed
 * to a name that does not or deleted, lets go of what it held: an agent
 * asks a person first (Types/AI/AIAlwaysAskChanges).
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

// What a resource's environment is read from: its tags, its account's setting, its labels.
export interface CloudResourceEnvironmentSigns {
  tags?: Record<string, unknown> | undefined | null;
  accountEnvironment?: CloudResourceEnvironment | string | undefined | null;
  labelNames?: Array<string | undefined> | undefined | null;
}

// The signs a person approving reads as saying non-production: every one.
export const CLOUD_NON_PRODUCTION_SOURCES: ReadonlyArray<CloudEnvironmentSource> =
  [
    CloudEnvironmentSource.Tag,
    CloudEnvironmentSource.Account,
    CloudEnvironmentSource.Label,
  ];

/*
 * The signs a change nobody approves reads as saying non-production: the
 * cloud's own tags and the account's setting, never a label (#11347).
 */
export const CLOUD_UNATTENDED_NON_PRODUCTION_SOURCES: ReadonlyArray<CloudEnvironmentSource> =
  [CloudEnvironmentSource.Tag, CloudEnvironmentSource.Account];

type EnvironmentSign = [CloudResourceEnvironment, CloudEnvironmentSource];

// What each sign says, in the order a reading names the one that decided it.
function readSigns(data: CloudResourceEnvironmentSigns): Array<EnvironmentSign> {
  return [
    [readEnvironmentFromTags(data.tags), CloudEnvironmentSource.Tag],
    [
      isCloudResourceEnvironment(data.accountEnvironment)
        ? data.accountEnvironment
        : CloudResourceEnvironment.Unknown,
      CloudEnvironmentSource.Account,
    ],
    [readEnvironmentFromLabels(data.labelNames), CloudEnvironmentSource.Label],
  ];
}

/*
 * The signs as one: production on any of them, then non-production on one
 * of those that may say it, then not known.
 */
function readFrom(
  signs: Array<EnvironmentSign>,
  nonProductionFrom: ReadonlyArray<CloudEnvironmentSource>,
): CloudResourceEnvironmentReading {
  const production: EnvironmentSign | undefined = signs.find(
    (sign: EnvironmentSign): boolean => {
      return sign[0] === CloudResourceEnvironment.Production;
    },
  );

  if (production) {
    return { environment: production[0], source: production[1] };
  }

  const nonProduction: EnvironmentSign | undefined = signs.find(
    (sign: EnvironmentSign): boolean => {
      return (
        sign[0] === CloudResourceEnvironment.NonProduction &&
        nonProductionFrom.includes(sign[1])
      );
    },
  );

  if (nonProduction) {
    return { environment: nonProduction[0], source: nonProduction[1] };
  }

  return {
    environment: CloudResourceEnvironment.Unknown,
    source: CloudEnvironmentSource.None,
  };
}

/*
 * A resource's environment from all its signs, and the one that decided
 * it: its tags, its account's setting, its labels. What a person approving
 * a change reads (Apply, an owner's approval), and what an AI rule's
 * environments are matched with.
 */
export function getCloudResourceEnvironment(
  data: CloudResourceEnvironmentSigns,
): CloudResourceEnvironmentReading {
  return readFrom(readSigns(data), CLOUD_NON_PRODUCTION_SOURCES);
}

/*
 * What a change nobody approves reads (#11347): an off-hours schedule's
 * stop, an AI rule's change made without asking. Production on any sign,
 * labels included; non-production only on the cloud's tags or the
 * account's setting. A resource only its labels call non-production is not
 * known to it, and is left to a person.
 */
export function getUnattendedCloudResourceEnvironment(
  data: CloudResourceEnvironmentSigns,
): CloudResourceEnvironmentReading {
  return readFrom(readSigns(data), CLOUD_UNATTENDED_NON_PRODUCTION_SOURCES);
}

export interface CloudResourceEnvironmentReadings {
  // Every sign, labels' names included: what a person reads.
  reading: CloudResourceEnvironmentReading;
  // What a change nobody approves reads.
  unattended: CloudResourceEnvironmentReading;
}

// Both readings of one resource's signs, read once.
export function getCloudResourceEnvironmentReadings(
  data: CloudResourceEnvironmentSigns,
): CloudResourceEnvironmentReadings {
  const signs: Array<EnvironmentSign> = readSigns(data);

  return {
    reading: readFrom(signs, CLOUD_NON_PRODUCTION_SOURCES),
    unattended: readFrom(signs, CLOUD_UNATTENDED_NON_PRODUCTION_SOURCES),
  };
}

/*
 * Whether a reading's non-production is its labels' alone: what a change
 * nobody approves never acts on. A reading names the first sign in order
 * - tags, account, labels - so one from a label means neither the tags nor
 * the account said so.
 */
export function isNonProductionOnlyByLabels(
  reading: CloudResourceEnvironmentReading,
): boolean {
  return (
    reading.environment === CloudResourceEnvironment.NonProduction &&
    reading.source === CloudEnvironmentSource.Label
  );
}

/*
 * Whether a label's name says production, as a resource's labels are read:
 * a label that holds every resource it is on back from what nobody
 * approves.
 */
export function doesLabelSayProduction(name: unknown): boolean {
  return (
    typeof name === "string" &&
    readEnvironmentFromLabels([name]) === CloudResourceEnvironment.Production
  );
}

/*
 * Whether a schedule, or a rule acting without asking, may touch it: only
 * when known not production, as a change nobody approves reads it
 * (getUnattendedCloudResourceEnvironment).
 */
export function isKnownNonProduction(
  environment: CloudResourceEnvironment | string | undefined | null,
): boolean {
  return environment === CloudResourceEnvironment.NonProduction;
}
