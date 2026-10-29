import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import { LlmConnectionFailureKind } from "Common/Types/LlmObservability/LlmConnectionTest";
import { NetworkTrafficUsageConnection } from "Common/Types/NetFlow/NetworkTrafficUsage";
import {
  MERAKI_REGIONS,
  MerakiRegion,
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
import { formatRelativeTime, isJustNow } from "../../Home/HomeRelativeTime";

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

/*
 * The words a connection's status pill says - the same ones Cloud Connect's
 * list says for a cloud account (Working, Not working, Off, Waiting for the
 * first read), so a person who connects both reads one vocabulary.
 */
export const MERAKI_STATUS_WORDS: Record<
  NetworkControllerConnectionStatus,
  MerakiStatusWords
> = {
  [NetworkControllerConnectionStatus.Healthy]: {
    label: translationKey("Working"),
    tone: "green",
  },
  [NetworkControllerConnectionStatus.Partial]: {
    label: translationKey("Read in part"),
    tone: "amber",
  },
  [NetworkControllerConnectionStatus.Failing]: {
    label: translationKey("Not working"),
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

/*
 * The dot colours of a tone, in light and dark: the saturated marks read
 * the same on both; the grey is one the dark theme remaps (Theme.css), so
 * a waiting or turned-off connection's dot is quiet in both.
 */
export const MERAKI_TONE_DOT: Record<MerakiTone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  gray: "bg-gray-300",
};

export const MERAKI_TONE_TEXT: Record<MerakiTone, string> = {
  green: "text-gray-600",
  amber: "text-amber-800",
  red: "text-red-700",
  gray: "text-gray-600",
};

// The status pill's colour of a tone (Pill paints both themes from it).
export const MERAKI_TONE_PILL: Record<MerakiTone, Color> = {
  green: Green,
  amber: Yellow,
  red: Red,
  gray: Gray500,
};

/*
 * A connection, as the page names one where it says what a reader may not
 * do with it ("You do not have permission to update this Meraki
 * connection."): the model's own name, Network Controller Connection, is
 * the database's word, not the page's.
 */
export const MERAKI_CONNECTION_NAME: string =
  translationKey("Meraki connection");

export interface MerakiTimeOptions {
  // The reader's language code ("de" reads "vor 2 Minuten"); English if unset.
  language?: string | undefined;
  // Handed in by the tests; the current time otherwise.
  now?: Date | undefined;
}

/*
 * When a read happened, in the reader's language: "2 minutes ago",
 * "vor 2 Minuten". A read under a minute ago gives its seconds, never "now",
 * which beside the Read now button would read as the button; and a server
 * clock a little ahead of the browser's never says "in 2 minutes".
 */
export function getMerakiReadTime(
  value: string | undefined,
  options: MerakiTimeOptions = {},
): string {
  if (!value) {
    return "";
  }

  const date: Date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now: Date = options.now || OneUptimeDate.getCurrentDate();
  const readAt: Date = date.getTime() > now.getTime() ? now : date;

  if (!isJustNow({ date: readAt, now })) {
    return formatRelativeTime({
      date: readAt,
      now,
      language: options.language,
    });
  }

  const seconds: number = Math.max(
    1,
    Math.round((now.getTime() - readAt.getTime()) / 1000),
  );

  try {
    return new Intl.RelativeTimeFormat(options.language || "en", {
      numeric: "always",
    }).format(-seconds, "second");
  } catch {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"} ago`;
  }
}

/*
 * One sentence on how a connection is doing - beside its name in the list,
 * and over the traffic it read - with its times in the reader's language.
 */
export function getMerakiConnectionSentence(
  connection: NetworkTrafficUsageConnection,
  options: MerakiTimeOptions = {},
): MerakiTemplate {
  const when: (value: string | undefined) => string = (
    value: string | undefined,
  ): string => {
    return getMerakiReadTime(value, options);
  };

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
              "Last read {{time}}: the traffic below stops there.",
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
 * A key the region's dashboard refused, naming the dashboard: the one thing
 * Meraki's own answer would add, so that answer is not shown under it too.
 */
export const KEY_REFUSED_BY_DASHBOARD: string = translationKey(
  "The Meraki dashboard at {{host}} did not accept this API key.",
);

// A test that never reached Meraki: OneUptime could not run it at all.
export const TEST_COULD_NOT_RUN: string = translationKey(
  "The test could not run",
);

/*
 * A failed test's way on, by why it failed: a refused key, or a key that
 * cannot be one, is changed - testing it again would only fail again; a
 * key that cannot read the organization may be fixed in Meraki (try again)
 * or swapped for an administrator's; anything else is tried again.
 */
export interface MerakiTestActions {
  tryAgain: boolean;
  changeKey: boolean;
}

export function getMerakiTestActions(
  result: NetworkControllerTestResult,
): MerakiTestActions {
  if (result.status !== "fail") {
    return { tryAgain: false, changeKey: false };
  }

  switch (result.failureKind) {
    case LlmConnectionFailureKind.Authentication:
    case LlmConnectionFailureKind.Settings:
      return { tryAgain: false, changeKey: true };
    case LlmConnectionFailureKind.Permission:
      return { tryAgain: true, changeKey: true };
    default:
      return { tryAgain: true, changeKey: false };
  }
}

/*
 * What a test says, in the reader's language: a failure by its kind (with
 * Meraki's own answer below it), a pass by what a read will cover - the
 * counts drawn as label and number, so no sentence has to agree with one.
 *
 * A test whose request never reached Meraki (OneUptime answered it with an
 * error: provider empty) says so, rather than blaming Meraki. A refused key
 * names the dashboard that refused it when the caller knows it.
 */
export function getMerakiTestWords(data: {
  result: NetworkControllerTestResult;
  organizationName: string;
  // The region's dashboard ("dashboard.meraki.com"), when the caller knows it.
  dashboardHost?: string | undefined;
}): MerakiTestWords {
  const result: NetworkControllerTestResult = data.result;

  if (result.status === "fail") {
    if (!result.provider) {
      return {
        tone: "fail",
        headline: { template: TEST_COULD_NOT_RUN, values: {} },
        details: result.message || undefined,
      };
    }

    const kind: LlmConnectionFailureKind =
      result.failureKind &&
      Object.values(LlmConnectionFailureKind).includes(result.failureKind)
        ? result.failureKind
        : LlmConnectionFailureKind.Other;
    const words: { headline: string; advice: string } = FAILURE_WORDS[kind];

    if (
      kind === LlmConnectionFailureKind.Authentication &&
      data.dashboardHost
    ) {
      return {
        tone: "fail",
        headline: {
          template: KEY_REFUSED_BY_DASHBOARD,
          values: { host: data.dashboardHost },
        },
        advice: words.advice,
      };
    }

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

// Every device of the organization's device list, appliances among them.
export const DEVICE_COUNT: PluralTemplate = {
  one: "{{count}} device",
  other: "{{count}} devices",
};

/*
 * The organization's devices that are network devices here, whose missing
 * details Inventory fills in from Meraki (NetworkControllerInventory): said
 * as what the connection does for them, the details named that a Meraki
 * box's own poll cannot read. "Fills in" - what a device already has (saved,
 * or read by its own poll) stays.
 */
export const DESCRIBED_DEVICES_NOTE: PluralTemplate = {
  one: "Fills in the model, serial number and firmware of {{count}} network device.",
  other:
    "Fills in the model, serial number and firmware of {{count}} network devices.",
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

/*
 * A range with nothing in it because the reads stopped before it began (a
 * connection failing or not read lately): when the traffic read ends, and
 * the way to it - never "Meraki keeps 30 days", which is not why.
 */
export const NEWEST_TRAFFIC_BEFORE_RANGE: string = translationKey(
  "The newest traffic is from {{time}}. Pick a longer time range to see it.",
);

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
  region: MerakiRegion;
  regionName: string;
  regionHost: string;
  summary: NetworkControllerReadSummary | undefined;
}

/*
 * A connection's one button, the next thing to do with it: Turn on when it
 * is off (Read now would be refused), Update API key when Meraki refused
 * its key (reading again would fail again), Read now otherwise.
 */
export enum MerakiConnectionAction {
  ReadNow = "read-now",
  TurnOn = "turn-on",
  UpdateKey = "update-key",
}

export function getMerakiConnectionAction(
  facts: Pick<MerakiConnectionRowFacts, "connection" | "summary">,
): MerakiConnectionAction {
  if (facts.connection.status === NetworkControllerConnectionStatus.Off) {
    return MerakiConnectionAction.TurnOn;
  }

  if (
    facts.connection.status === NetworkControllerConnectionStatus.Failing &&
    facts.summary?.failureKind === LlmConnectionFailureKind.Authentication
  ) {
    return MerakiConnectionAction.UpdateKey;
  }

  return MerakiConnectionAction.ReadNow;
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
    region: region.region,
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
  conversationsOnFlowsSide: string;
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
  // The page has flow records as well: its conversations are a switch away.
  conversationsOnFlowsSide: translationKey(
    "The Meraki dashboard API reports totals, not conversations. This page's flow records have them.",
  ),
  flows: translationKey(
    "How many flows Meraki's traffic analytics counted in this time range.",
  ),
};
