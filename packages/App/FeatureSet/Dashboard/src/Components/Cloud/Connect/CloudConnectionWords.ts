import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { getCloudResourceTypeLabel } from "Common/Types/Cloud/CloudResourceCatalog";
import {
  CloudConnectionCostEstimate,
  estimateCloudConnectionCost,
} from "Common/Types/CloudConnection/CloudConnectionCost";
import {
  CloudConnectionFailureKind,
  CloudConnectionReadSummary,
  CloudConnectionRegionCount,
  CloudConnectionTestResult,
  CloudConnectionTypeCount,
  readCloudConnectionReadSummary,
} from "Common/Types/CloudConnection/CloudConnectionTest";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import {
  PluralTemplate,
  TemplateValue,
  TemplateValues,
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What Cloud > Connect says about a connection, in the dashboard's own
 * words: a test's headline and advice, a read's failure, how a connection
 * is doing, what its last read found and what reading it costs.
 *
 * React-free (App's tests read it). Every string is an English translation
 * key, or a template with its values, which the components translate when
 * they draw them (drawCloudTemplate). A cloud's own message is kept apart,
 * as the details of a failure: it is English, and it is the cloud's, not
 * ours.
 */

export interface CloudWords {
  headline: string;
  advice?: string | undefined;
  details?: string | undefined;
}

export interface CloudTemplate {
  template: string;
  values: TemplateValues;
  /*
   * A sentence that changes with a count: `template` is its general
   * ("other") form, and `one` the form for one.
   */
  plural?: { one: string; count: number } | undefined;
}

// A template on the screen, in the reader's language.
export function drawCloudTemplate(
  translator: Translator,
  words: CloudTemplate,
): string {
  if (words.plural) {
    return translator.translatePlural(
      { one: words.plural.one, other: words.template },
      words.plural.count,
      words.values,
    );
  }

  return translator.translateTemplate(words.template, words.values);
}

const RESOURCE_COUNT: PluralTemplate = {
  one: "{{count}} resource",
  other: "{{count}} resources",
};

/*
 * Short, under the count and the regions of a column that has to fit
 * beside the side menu at 1280 pixels in every language.
 */
const CHANGES_RECORDED: PluralTemplate = {
  one: "{{count}} new change",
  other: "{{count}} new changes",
};

function pluralOf(
  template: PluralTemplate,
  count: number,
  values: TemplateValues = {},
): CloudTemplate {
  return {
    template: template.other,
    values,
    plural: { one: template.one, count },
  };
}

// A number written the way the sentence's language writes it.
function numberIn(value: number, fractionDigits?: number): TemplateValue {
  return composedValue((translator: Translator): string => {
    const options: Intl.NumberFormatOptions | undefined =
      fractionDigits === undefined
        ? undefined
        : {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
          };

    try {
      return value.toLocaleString(translator.language, options);
    } catch {
      return value.toLocaleString("en-US", options);
    }
  });
}

const FAILURE_WORDS: Record<
  CloudConnectionFailureKind,
  { headline: string; advice: string }
> = {
  [CloudConnectionFailureKind.Authentication]: {
    headline: translationKey("The key or secret was not accepted."),
    advice: translationKey(
      "Copy everything the command printed and paste it again. A key made a minute ago can take a minute to work.",
    ),
  },
  [CloudConnectionFailureKind.Permission]: {
    headline: translationKey(
      "Signed in, but this access cannot read what OneUptime needs.",
    ),
    advice: translationKey(
      "Run the setup command again: it grants the read-only role OneUptime needs. A new role can take a minute to work.",
    ),
  },
  [CloudConnectionFailureKind.RateLimited]: {
    headline: translationKey("The cloud asked OneUptime to slow down."),
    advice: translationKey(
      "Nothing is wrong with the settings. Test again in a minute.",
    ),
  },
  [CloudConnectionFailureKind.Unavailable]: {
    headline: translationKey("The cloud could not be reached."),
    advice: translationKey(
      "Test again in a few minutes. If it keeps failing, check that your OneUptime server can reach the cloud's APIs.",
    ),
  },
  [CloudConnectionFailureKind.Settings]: {
    headline: translationKey("A setting is not right."),
    advice: translationKey("Fix the setting named below, then test again."),
  },
  [CloudConnectionFailureKind.Other]: {
    headline: translationKey("The cloud refused the test."),
    advice: translationKey(
      "Its answer is below. Check the settings, then test again.",
    ),
  },
};

export function getCloudFailureWords(
  kind: CloudConnectionFailureKind | undefined,
): { headline: string; advice: string } {
  return (
    FAILURE_WORDS[kind || CloudConnectionFailureKind.Other] ||
    FAILURE_WORDS[CloudConnectionFailureKind.Other]
  );
}

/*
 * "It works", never "Connected": a test in the form runs before anything
 * is saved, and the connection is made only by the Connect button.
 */
export function getCloudTestWords(
  result: CloudConnectionTestResult,
): CloudWords {
  if (result.status === "pass") {
    return {
      headline: translationKey(
        "It works. Here is what OneUptime found to monitor.",
      ),
    };
  }

  if (result.status === "warn") {
    return {
      headline: translationKey(
        "It works, but OneUptime found no resources to monitor yet.",
      ),
      advice: translationKey(
        "The first read lists every resource of the account, whether it reports metrics or not. If none appear then, check that the access is for the right account, subscription or project.",
      ),
    };
  }

  const words: { headline: string; advice: string } = getCloudFailureWords(
    result.failureKind,
  );

  return {
    headline: words.headline,
    advice: words.advice,
    details: result.message || undefined,
  };
}

/*
 * Why a saved connection's last read failed, in the words a test uses for
 * the same failure. Undefined for a failure of no known kind: the cloud's
 * own answer is shown alone.
 */
export function getCloudReadFailureWords(
  connection: Pick<CloudConnection, "lastPullResult">,
): CloudWords | undefined {
  const summary: CloudConnectionReadSummary | undefined =
    readCloudConnectionReadSummary(connection.lastPullResult);

  if (
    !summary ||
    summary.status !== "failed" ||
    !summary.failureKind ||
    summary.failureKind === CloudConnectionFailureKind.Other
  ) {
    return undefined;
  }

  return getCloudFailureWords(summary.failureKind);
}

export interface CloudConnectionHealth {
  key: "off" | "waiting" | "working" | "failing";
  label: string;
  color: Color;
  // A translation key, or the stored error itself for "failing".
  tooltip: string;
  tooltipIsError: boolean;
}

function toTime(value: Date | string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const time: number = OneUptimeDate.fromString(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export function getCloudConnectionHealth(
  connection: Pick<
    CloudConnection,
    "isEnabled" | "lastPulledAt" | "lastSuccessfulPullAt" | "lastError"
  >,
): CloudConnectionHealth {
  if (connection.isEnabled === false) {
    return {
      key: "off",
      label: translationKey("Off"),
      color: Gray500,
      tooltip: translationKey(
        "Turned off: it is not read until it is turned on.",
      ),
      tooltipIsError: false,
    };
  }

  const lastPulledAt: number | undefined = toTime(connection.lastPulledAt);
  const lastSuccessAt: number | undefined = toTime(
    connection.lastSuccessfulPullAt,
  );

  if (
    connection.lastError &&
    (lastSuccessAt === undefined ||
      (lastPulledAt !== undefined && lastPulledAt > lastSuccessAt))
  ) {
    return {
      key: "failing",
      label: translationKey("Not working"),
      color: Red,
      tooltip: connection.lastError,
      tooltipIsError: true,
    };
  }

  if (lastSuccessAt !== undefined) {
    return {
      key: "working",
      label: translationKey("Working"),
      color: Green,
      tooltip: translationKey("Its last read finished without a problem."),
      tooltipIsError: false,
    };
  }

  return {
    key: "waiting",
    label: translationKey("Waiting for the first read"),
    color: Yellow,
    tooltip: translationKey(
      "The first read starts within a minute of connecting, and can take a few minutes.",
    ),
    tooltipIsError: false,
  };
}

// "12 resources", "1 resource".
export function getResourceCountWords(count: number): CloudTemplate {
  return pluralOf(RESOURCE_COUNT, count);
}

/*
 * "3 new changes": what the last read added from the accounts' activity
 * logs and their provider's health events, kept as change events. Shown
 * only when the last read added some.
 */
export function getChangesRecordedWords(count: number): CloudTemplate {
  return pluralOf(CHANGES_RECORDED, count);
}

/*
 * What a connection reads, in its cloud's own word for it: an AWS account,
 * an Azure subscription, a Google Cloud project.
 */
const ACCOUNTS_WORDS: Record<CloudProvider, PluralTemplate> = {
  [CloudProvider.AWS]: {
    one: "Account: {{accounts}}",
    other: "Accounts: {{accounts}}",
  },
  [CloudProvider.Azure]: {
    one: "Subscription: {{accounts}}",
    other: "Subscriptions: {{accounts}}",
  },
  [CloudProvider.GCP]: {
    one: "Project: {{accounts}}",
    other: "Projects: {{accounts}}",
  },
};

/*
 * "Subscription: 7c4a1f2e-…", "Accounts: 123456789012, 210987654321".
 * Undefined when nothing names one.
 */
export function getCloudAccountsWords(data: {
  provider: CloudProvider | string;
  accounts: Array<string>;
}): CloudTemplate | undefined {
  const accounts: Array<string> = data.accounts.filter(
    (account: string): boolean => {
      return Boolean(account && account.trim());
    },
  );

  if (accounts.length === 0) {
    return undefined;
  }

  return pluralOf(
    ACCOUNTS_WORDS[data.provider as CloudProvider] ||
      ACCOUNTS_WORDS[CloudProvider.AWS],
    accounts.length,
    { accounts: accounts.join(", ") },
  );
}

/*
 * The accounts a row of the list names under its cloud: those its name
 * does not already say ("AWS 123456789012" says its account).
 */
export function getAccountsNotInName(data: {
  name: string | undefined;
  accounts: Array<string>;
}): Array<string> {
  const name: string = (data.name || "").toLowerCase();

  return data.accounts.filter((account: string): boolean => {
    return Boolean(account) && !name.includes(account.toLowerCase());
  });
}

/*
 * Whether a connection's name already says its cloud: "Microsoft Azure",
 * the name a new Azure connection is given, or "Google Cloud acme-prod".
 * The quiet line under the name then leaves the cloud out.
 */
export function doesNameSayCloud(data: {
  name: string | undefined;
  cloudTitle: string;
}): boolean {
  const title: string = data.cloudTitle.trim().toLowerCase();

  return Boolean(title) && (data.name || "").toLowerCase().includes(title);
}

/*
 * Why the Credentials step cannot go on yet, said on the box the command's
 * output is pasted into: nothing there, or a value still missing from what
 * was pasted or typed.
 */
export const PASTE_NOTHING_YET: string = translationKey(
  "Paste everything the command printed.",
);
export const PASTE_HOLDS_NOTHING: string = translationKey(
  "Nothing OneUptime needs is in this yet. Copy everything the command printed.",
);
export const PASTE_STILL_MISSING: string = translationKey(
  "Still missing: {{fields}}. Paste everything the command printed, or enter the values below.",
);

// "+3 more": what a short list leaves out.
export const MORE_COUNT: PluralTemplate = {
  one: "+{{count}} more",
  other: "+{{count}} more",
};

// How many regions a list's row names before it says how many more.
export const LISTED_REGION_COUNT: number = 2;

/*
 * The regions a connection's last read found resources in, most first, as
 * a row of the list names them: the first two, and how many more.
 */
export function getCloudRegionNames(
  regions: Array<CloudConnectionRegionCount>,
): { names: Array<string>; more: number } {
  const named: Array<string> = regions
    .filter((entry: CloudConnectionRegionCount): boolean => {
      return Boolean(entry.region);
    })
    .map((entry: CloudConnectionRegionCount): string => {
      return entry.region;
    });

  return {
    names: named.slice(0, LISTED_REGION_COUNT),
    more: Math.max(named.length - LISTED_REGION_COUNT, 0),
  };
}

/*
 * When a connection was last read, under how it is doing: "Last read Oct
 * 21, 09:50" (the time is drawn by the caller), or never.
 */
export const LAST_READ_AT: string = translationKey("Last read {{time}}");
export const NOT_READ_YET: string = translationKey("Not read yet");

/*
 * A read started from the list, until it ends: said in the row, and as why
 * Read now is locked meanwhile.
 */
export const READING_NOW: string = translationKey("Reading now…");

// How often a connection is read: "Every 10 minutes", "Every hour".
export function getCloudReadIntervalWords(minutes: number): CloudTemplate {
  if (minutes === 60) {
    return { template: translationKey("Every hour"), values: {} };
  }

  return {
    template: translationKey("Every {{minutes}} minutes"),
    values: { minutes: numberIn(minutes) },
  };
}

/*
 * The resource types of a connection or a test, most first: "Virtual
 * Machine" and its count. Each label is the catalog's (translated where
 * drawn); a type the catalog does not know is shown as its own name.
 */
export function getResourceTypeEntries(data: {
  provider: CloudProvider | string;
  resourceTypes: Array<CloudConnectionTypeCount>;
}): Array<{ label: string; count: number }> {
  return data.resourceTypes.map(
    (entry: CloudConnectionTypeCount): { label: string; count: number } => {
      return {
        label: getCloudResourceTypeLabel(data.provider, entry.type),
        count: entry.count,
      };
    },
  );
}

/*
 * What reading the resources a test found would cost each month in the
 * customer's own cloud bill: a template and its values, or a "within the
 * free allowance" line.
 */
export function getCloudCostWords(data: {
  provider: CloudProvider;
  resourceTypes: Array<CloudConnectionTypeCount>;
  readIntervalInMinutes: number;
  accounts: number;
}): CloudTemplate {
  const estimate: CloudConnectionCostEstimate = estimateCloudConnectionCost({
    provider: data.provider,
    resourceTypes: data.resourceTypes,
    readIntervalInMinutes: data.readIntervalInMinutes,
    accounts: data.accounts,
  });

  if (estimate.monthlyCostUsd < 0.01) {
    if (data.provider === CloudProvider.AWS) {
      return {
        template: translationKey(
          "Reading these costs under a cent a month in CloudWatch charges.",
        ),
        values: {},
      };
    }

    return {
      template: translationKey(
        "Reading these fits in your cloud's free monthly allowance for monitoring reads.",
      ),
      values: {},
    };
  }

  return {
    template: translationKey(
      "Reading these every {{minutes}} minutes costs about ${{cost}} a month in your cloud's monitoring charges.",
    ),
    values: {
      minutes: numberIn(data.readIntervalInMinutes),
      cost: numberIn(Math.round(estimate.monthlyCostUsd * 100) / 100, 2),
    },
  };
}
