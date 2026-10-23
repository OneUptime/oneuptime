import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import OneUptimeDate from "Common/Types/Date";
import { LlmConnectionFailureKind } from "Common/Types/LlmObservability/LlmConnectionTest";
import { NetworkTrafficUsageConnection } from "Common/Types/NetFlow/NetworkTrafficUsage";
import {
  MERAKI_REGIONS,
  MerakiRegionDefinition,
  getMerakiRegionOrDefault,
} from "Common/Types/NetworkController/MerakiRegion";
import {
  NetworkControllerConnectionStatus,
  getNetworkControllerConnectionHealth,
} from "Common/Types/NetworkController/NetworkControllerConnectionHealth";
import {
  NETWORK_CONTROLLER_READ_INTERVALS_IN_MINUTES,
  NetworkControllerConfig,
  readNetworkControllerConfig,
} from "Common/Types/NetworkController/NetworkControllerConnectionSettings";
import { NetworkControllerTestResult } from "Common/Types/NetworkController/NetworkControllerConnectionTest";
import {
  NetworkControllerReadSummary,
  readNetworkControllerReadSummary,
} from "Common/Types/NetworkController/NetworkControllerReadSummary";
import {
  PluralTemplate,
  TemplateValues,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Traffic pages say about a Meraki connection, in the dashboard's
 * own words: how it is doing, how often it reads, what a test found and
 * what to do when it did not work.
 *
 * React-free (App's tests read it). Every string is an English translation
 * key, or a template with its values, translated where it is drawn. What
 * Meraki or the reader said in English - a refused call's reason - is kept
 * apart, as a failure's details: it is not ours to translate.
 */

export interface MerakiTemplate {
  template: string;
  values: TemplateValues;
}

export type MerakiTone = "green" | "amber" | "red" | "gray";

export interface MerakiStatusWords {
  label: string;
  tone: MerakiTone;
}

export function drawMerakiTemplate(
  translator: Translator,
  words: MerakiTemplate,
): string {
  return translator.translateTemplate(words.template, words.values);
}

export const MERAKI_STATUS_WORDS: Record<
  NetworkControllerConnectionStatus,
  MerakiStatusWords
> = {
  [NetworkControllerConnectionStatus.Healthy]: {
    label: translationKey("Connected"),
    tone: "green",
  },
  [NetworkControllerConnectionStatus.Partial]: {
    label: translationKey("Read in part"),
    tone: "amber",
  },
  [NetworkControllerConnectionStatus.Failing]: {
    label: translationKey("Failing"),
    tone: "red",
  },
  [NetworkControllerConnectionStatus.Stale]: {
    label: translationKey("Not read lately"),
    tone: "amber",
  },
  [NetworkControllerConnectionStatus.Waiting]: {
    label: translationKey("Waiting for the first read"),
    tone: "gray",
  },
  [NetworkControllerConnectionStatus.Off]: {
    label: translationKey("Off"),
    tone: "gray",
  },
};

// The dot or pill colours of a tone, in light and dark.
export const MERAKI_TONE_DOT: Record<MerakiTone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  gray: "bg-gray-400",
};

export const MERAKI_TONE_TEXT: Record<MerakiTone, string> = {
  green: "text-gray-600",
  amber: "text-amber-800",
  red: "text-red-700",
  gray: "text-gray-600",
};

function when(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : OneUptimeDate.fromNow(date);
}

/*
 * One sentence on how a connection is doing - beside its name in the list,
 * and over the traffic it read.
 */
export function getMerakiConnectionSentence(
  connection: NetworkTrafficUsageConnection,
): MerakiTemplate {
  switch (connection.status) {
    case NetworkControllerConnectionStatus.Off:
      return {
        template: translationKey(
          "Turned off: Meraki is not read until it is turned on.",
        ),
        values: {},
      };
    case NetworkControllerConnectionStatus.Waiting:
      return {
        template: translationKey(
          "Waiting for the first read. It starts within a minute and reads the last day.",
        ),
        values: {},
      };
    case NetworkControllerConnectionStatus.Failing:
      return {
        template: translationKey("Couldn't read Meraki {{time}}."),
        values: { time: when(connection.lastPulledAt) },
      };
    case NetworkControllerConnectionStatus.Stale:
      return connection.lastSuccessfulPullAt
        ? {
            template: translationKey(
              "Not read since {{time}}: the traffic below stops there.",
            ),
            values: { time: when(connection.lastSuccessfulPullAt) },
          }
        : {
            template: translationKey(
              "Not read yet. Check that OneUptime's Workers are running.",
            ),
            values: {},
          };
    case NetworkControllerConnectionStatus.Partial:
      return {
        template: translationKey(
          "Read {{time}}, in part: the next read carries on.",
        ),
        values: { time: when(connection.lastSuccessfulPullAt) },
      };
    case NetworkControllerConnectionStatus.Healthy:
    default:
      return {
        template: translationKey("Read {{time}}."),
        values: { time: when(connection.lastSuccessfulPullAt) },
      };
  }
}

// How often uplink usage is read: "Every 5 minutes", "Every hour".
export function getMerakiIntervalWords(minutes: number): MerakiTemplate {
  if (minutes === 60) {
    return { template: translationKey("Every hour"), values: {} };
  }

  return {
    template: translationKey("Every {{minutes}} minutes"),
    values: { minutes: minutes },
  };
}

export function getMerakiIntervalOptions(): Array<{
  value: number;
  words: MerakiTemplate;
}> {
  return NETWORK_CONTROLLER_READ_INTERVALS_IN_MINUTES.map(
    (minutes: number): { value: number; words: MerakiTemplate } => {
      return { value: minutes, words: getMerakiIntervalWords(minutes) };
    },
  );
}

// The regions, as the region picker lists them: their name and the address people sign in at.
export function getMerakiRegionOptions(): Array<MerakiRegionDefinition> {
  return [...MERAKI_REGIONS];
}

// Mark the region names for the extractor: they are drawn translated.
export const MERAKI_REGION_NAMES: Array<string> = [
  translationKey("Global"),
  translationKey("Canada"),
  translationKey("China"),
  translationKey("India"),
  translationKey("United States FedRAMP"),
];

const FAILURE_WORDS: Record<
  LlmConnectionFailureKind,
  { headline: string; advice: string }
> = {
  [LlmConnectionFailureKind.Authentication]: {
    headline: translationKey("Meraki did not accept this API key."),
    advice: translationKey(
      "Copy the key again from the Meraki dashboard (Organization > API & Webhooks), and check the region is the dashboard you sign in to.",
    ),
  },
  [LlmConnectionFailureKind.Permission]: {
    headline: translationKey("This key cannot read the organization."),
    advice: translationKey(
      "Turn on API access for the organization in the Meraki dashboard (Organization > API & Webhooks), or use the key of one of its administrators.",
    ),
  },
  [LlmConnectionFailureKind.RateLimited]: {
    headline: translationKey("Meraki asked OneUptime to slow down."),
    advice: translationKey(
      "Other applications are using the organization's API budget right now. Try again in a minute.",
    ),
  },
  [LlmConnectionFailureKind.Unavailable]: {
    headline: translationKey("The Meraki dashboard API could not be reached."),
    advice: translationKey(
      "Check that your OneUptime server can reach the Meraki dashboard API over HTTPS, then try again.",
    ),
  },
  [LlmConnectionFailureKind.Settings]: {
    headline: translationKey("A setting is not right."),
    advice: translationKey("Fix it, then try again."),
  },
  [LlmConnectionFailureKind.Other]: {
    headline: translationKey("Meraki refused the request."),
    advice: translationKey(
      "Its answer is below. Check the key, then try again.",
    ),
  },
};

export interface MerakiTestWords {
  tone: "pass" | "warn" | "fail";
  headline: MerakiTemplate;
  advice?: string | undefined;
  // What Meraki answered, in English, for a failure.
  details?: string | undefined;
  // What a read will cover, when an organization was counted.
  counts?: { networks: number; appliances: number } | undefined;
}

export const TEST_COUNT_LABELS: { networks: string; appliances: string } = {
  networks: translationKey("Networks"),
  appliances: translationKey("MX and Z appliances"),
};

/*
 * What a test says, in the reader's language: a failure by its kind (with
 * Meraki's own answer below it), a pass by what a read will cover - the
 * counts drawn as label and number, so no sentence has to agree with one.
 */
export function getMerakiTestWords(data: {
  result: NetworkControllerTestResult;
  organizationName: string;
}): MerakiTestWords {
  const result: NetworkControllerTestResult = data.result;

  if (result.status === "fail") {
    const kind: LlmConnectionFailureKind =
      result.failureKind &&
      Object.values(LlmConnectionFailureKind).includes(result.failureKind)
        ? result.failureKind
        : LlmConnectionFailureKind.Other;
    const words: { headline: string; advice: string } = FAILURE_WORDS[kind];

    return {
      tone: "fail",
      headline: { template: words.headline, values: {} },
      advice: words.advice,
      details: result.message || undefined,
    };
  }

  if (result.networkCount === undefined) {
    return {
      tone: "pass",
      headline: {
        template: translationKey(
          "This key reads several organizations. Pick the one to read.",
        ),
        values: {},
      },
    };
  }

  const counts: { networks: number; appliances: number } = {
    networks: result.networkCount || 0,
    appliances: result.applianceCount || 0,
  };

  if (counts.networks === 0) {
    return {
      tone: "warn",
      headline: {
        template: translationKey(
          "{{organization}} has no networks yet: there is no traffic to read.",
        ),
        values: { organization: data.organizationName },
      },
      counts,
    };
  }

  if (counts.appliances === 0) {
    return {
      tone: "warn",
      headline: {
        template: translationKey(
          "{{organization}} has no MX or Z appliance, so there is no uplink usage to read: only applications and clients are shown.",
        ),
        values: { organization: data.organizationName },
      },
      counts,
    };
  }

  return {
    tone: "pass",
    headline: {
      template: translationKey("Ready to read {{organization}}."),
      values: { organization: data.organizationName },
    },
    counts,
  };
}

// What a connection's last read covered, on its row.
export const NETWORK_COUNT: PluralTemplate = {
  one: "{{count}} network",
  other: "{{count}} networks",
};

export const APPLIANCE_COUNT: PluralTemplate = {
  one: "{{count}} appliance",
  other: "{{count}} appliances",
};

export const API_CALL_COUNT: PluralTemplate = {
  one: "{{count}} API call a read",
  other: "{{count}} API calls a read",
};

export const ANALYSIS_OFF_NOTE: PluralTemplate = {
  one: "Traffic analysis is off on {{count}} network, so Meraki keeps no applications for it. Turn it on in the Meraki dashboard under Network-wide > General.",
  other:
    "Traffic analysis is off on {{count}} networks, so Meraki keeps no applications for them. Turn it on in the Meraki dashboard under Network-wide > General.",
};

export const ANALYTICS_WAITING_NOTE: PluralTemplate = {
  one: "The applications and clients of {{count}} network wait for the next read, which carries on in a minute.",
  other:
    "The applications and clients of {{count}} networks wait for the next read, which carries on in a minute.",
};

export const RATE_LIMITED_NOTE: string = translationKey(
  "Meraki asked OneUptime to slow down during the last read: other applications share the organization's API budget, and OneUptime reads more slowly until it is free.",
);

export const READING_NOW: string = translationKey("Reading now…");

/*
 * A saved connection as its row says it: how it is doing (the shared
 * health rule), its organization and region, and what its last read
 * covered and could not do.
 */
export interface MerakiConnectionRowFacts {
  connection: NetworkTrafficUsageConnection;
  regionName: string;
  regionHost: string;
  summary: NetworkControllerReadSummary | undefined;
}

export function getMerakiConnectionRowFacts(
  model: NetworkControllerConnection,
  now: Date,
): MerakiConnectionRowFacts {
  const config: NetworkControllerConfig = readNetworkControllerConfig(
    model.config,
  );
  const summary: NetworkControllerReadSummary | undefined =
    readNetworkControllerReadSummary(model.lastPullResult);
  const region: MerakiRegionDefinition = getMerakiRegionOrDefault(
    config.region,
  );
  const toText: (value: Date | undefined) => string | undefined = (
    value: Date | undefined,
  ): string | undefined => {
    if (!value) {
      return undefined;
    }

    const date: Date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };

  return {
    connection: {
      id: model.id?.toString() || model._id?.toString() || "",
      name: model.name || "",
      provider: model.provider || "",
      organizationName: summary?.organizationName || config.organizationName,
      status: getNetworkControllerConnectionHealth(
        {
          isEnabled: model.isEnabled,
          createdAt: model.createdAt,
          lastPulledAt: model.lastPulledAt,
          lastSuccessfulPullAt: model.lastSuccessfulPullAt,
          lastError: model.lastError,
          lastReadStatus: summary?.status,
          readIntervalInMinutes: config.readIntervalInMinutes,
        },
        now,
      ).status,
      readIntervalInMinutes: config.readIntervalInMinutes,
      lastPulledAt: toText(model.lastPulledAt),
      lastSuccessfulPullAt: toText(model.lastSuccessfulPullAt),
      lastError: model.lastError || undefined,
    },
    regionName: region.name,
    regionHost: region.dashboardHost,
    summary,
  };
}

// What the Meraki side of a page says once, about what its numbers are.
export const MERAKI_VIEW_HELP: {
  traffic: string;
  applications: string;
  destinations: string;
  clients: string;
  networks: string;
  uplinks: string;
  conversations: string;
  flows: string;
} = {
  traffic: translationKey(
    "Bytes through the appliances' uplinks in this time range, as Meraki counts them: what they received (download) and sent (upload). Meraki reports them in five-minute windows; a window at the edge of the range counts for the part inside it.",
  ),
  applications: translationKey(
    "Traffic by application, as Meraki's traffic analytics name them. Meraki sums them over two hours or more, so a shorter time range shows its share of those windows - an estimate.",
  ),
  destinations: translationKey(
    "The hosts and addresses the most traffic went to, with the application most of it was, from Meraki's traffic analytics.",
  ),
  clients: translationKey(
    "The clients that sent and received the most, as Meraki reports each network's clients - read with the applications, every two hours.",
  ),
  networks: translationKey(
    "The Meraki networks whose appliances carried the most traffic. Click one to see only its traffic.",
  ),
  uplinks: translationKey(
    "Each appliance's uplinks - wan1, wan2, cellular - with what came in (download) and went out (upload).",
  ),
  conversations: translationKey(
    "The Meraki dashboard API reports totals, not conversations: it never says who talked to whom. Turn on NetFlow on the MX appliances to see conversations as well.",
  ),
  flows: translationKey(
    "How many flows Meraki's traffic analytics counted in this time range.",
  ),
};
