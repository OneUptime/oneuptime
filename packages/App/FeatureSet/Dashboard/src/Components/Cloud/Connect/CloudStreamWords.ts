import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import { isAwsRegion } from "Common/Types/Cloud/AwsRegionCode";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudStreamRefusalReason,
  CloudStreamState,
  CloudStreamSummary,
  getCloudStreamState,
  readCloudStreamSummary,
} from "Common/Types/CloudConnection/CloudStream";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import {
  PluralTemplate,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { CloudTemplate } from "./CloudConnectionWords";

/*
 * What Cloud > Connect says about a connection's streams in the dashboard's
 * own words - each cloud's in its own: Amazon Data Firehose delivering an
 * AWS account's CloudWatch metrics and logs, OneUptime reading the event
 * hubs Azure Monitor sends a subscription's metrics and resource logs to,
 * and Pub/Sub pushing a Google Cloud project's logs. How streaming is
 * doing, in a word for the connections list and a sentence for the
 * streaming dialog, why it was refused or failed and what to do, and what
 * arrived from where.
 *
 * React-free (App's tests read it). Every string is an English translation
 * key, or a template with its values, which the components translate when
 * they draw them (drawCloudTemplate).
 */

export interface CloudStreamStatusWords {
  state: CloudStreamState;
  // A word or two for the connections list.
  label: string;
  color: Color;
  // The dialog's sentence, and the list's tooltip.
  sentence: CloudTemplate;
}

export interface CloudStreamRefusalWords {
  // What happened, in a few words.
  reason: string;
  // What to do about it.
  advice: string;
}

// The cloud a connection's stream words are in: AWS's when it says none.
export function readCloudStreamProvider(
  provider: string | null | undefined,
): CloudProvider {
  const value: string = (provider || "").toLowerCase();

  if (value === CloudProvider.Azure) {
    return CloudProvider.Azure;
  }

  if (value === CloudProvider.GCP) {
    return CloudProvider.GCP;
  }

  return CloudProvider.AWS;
}

type CloudStreamRefusalTable = Partial<
  Record<CloudStreamRefusalReason, CloudStreamRefusalWords>
>;

// Amazon Data Firehose's deliveries, for an AWS connection.
export const CLOUD_STREAM_REFUSAL_WORDS: CloudStreamRefusalTable = {
  [CloudStreamRefusalReason.WrongKey]: {
    reason: translationKey(
      "A delivery came with a key that is not this connection's.",
    ),
    advice: translationKey(
      "Make a new key and run the command again: Firehose keeps sending the batches it holds, and they are taken once the key is right.",
    ),
  },
  [CloudStreamRefusalReason.TurnedOff]: {
    reason: translationKey("This connection is turned off."),
    advice: translationKey(
      "Turn it on to take its streams again. Firehose keeps what it could not deliver in the stack's bucket.",
    ),
  },
  [CloudStreamRefusalReason.NotAllowed]: {
    reason: translationKey("This project cannot take telemetry right now."),
    advice: translationKey(
      "Check the project's plan and billing: deliveries are taken again once it can.",
    ),
  },
  [CloudStreamRefusalReason.TooLarge]: {
    reason: translationKey("A delivery was larger than OneUptime takes."),
    advice: translationKey(
      "Set the Firehose stream's buffer to 1 MiB and its content encoding to GZIP, as the command does.",
    ),
  },
  [CloudStreamRefusalReason.Malformed]: {
    reason: translationKey(
      "Something that is not a Firehose delivery came to the endpoint.",
    ),
    advice: translationKey(
      "Send the endpoint deliveries of an Amazon Data Firehose HTTP endpoint destination only.",
    ),
  },
  [CloudStreamRefusalReason.Throttled]: {
    reason: translationKey(
      "The streams sent more deliveries a minute than OneUptime takes.",
    ),
    advice: translationKey(
      "Nothing is lost: Firehose sends those batches again shortly. A larger buffer sends fewer deliveries.",
    ),
  },
};

/*
 * OneUptime's reads of an Azure connection's event hubs: nothing is pushed
 * to it, so nothing is refused but its own reads, which fail.
 */
export const AZURE_STREAM_REFUSAL_WORDS: CloudStreamRefusalTable = {
  [CloudStreamRefusalReason.NoAccess]: {
    reason: translationKey("The connection's app may not read the event hubs."),
    advice: translationKey(
      "Run the command again: it gives the app the Azure Event Hubs Data Receiver role on its resource group. A new role can take a few minutes to be in force.",
    ),
  },
  [CloudStreamRefusalReason.Unreachable]: {
    reason: translationKey("OneUptime could not reach the event hubs."),
    advice: translationKey(
      "Check that their namespaces take connections from the internet, and that this OneUptime may reach them on port 9093.",
    ),
  },
  [CloudStreamRefusalReason.TurnedOff]: {
    reason: translationKey("This connection is turned off."),
    advice: translationKey("Turn it on to read its event hubs again."),
  },
  [CloudStreamRefusalReason.NotAllowed]: {
    reason: translationKey("This project cannot take telemetry right now."),
    advice: translationKey(
      "Check the project's plan and billing: the event hubs are read again once it can.",
    ),
  },
};

// Pub/Sub's pushes, for a Google Cloud connection.
export const GCP_STREAM_REFUSAL_WORDS: CloudStreamRefusalTable = {
  [CloudStreamRefusalReason.WrongKey]: {
    reason: translationKey(
      "A push came with a key that is not this connection's.",
    ),
    advice: translationKey(
      "Make a new key and run the command again: Pub/Sub keeps the messages it could not push for a day, and they are taken once the key is right.",
    ),
  },
  [CloudStreamRefusalReason.WrongToken]: {
    reason: translationKey(
      "A push was not signed by Google for this connection's push service account.",
    ),
    advice: translationKey(
      "Run the command again: it sets the push subscription to sign as that service account, and lets Pub/Sub do so.",
    ),
  },
  [CloudStreamRefusalReason.TurnedOff]: {
    reason: translationKey("This connection is turned off."),
    advice: translationKey(
      "Turn it on to take its pushes again. Pub/Sub keeps what it could not push for a day.",
    ),
  },
  [CloudStreamRefusalReason.NotAllowed]: {
    reason: translationKey("This project cannot take telemetry right now."),
    advice: translationKey(
      "Check the project's plan and billing: pushes are taken again once it can.",
    ),
  },
  [CloudStreamRefusalReason.TooLarge]: {
    reason: translationKey("A push was larger than OneUptime takes."),
    advice: translationKey(
      "A log entry over 512 KiB is refused. Leave such entries out with the sink's filter.",
    ),
  },
  [CloudStreamRefusalReason.Malformed]: {
    reason: translationKey(
      "Something that is not a Pub/Sub push of a log entry came to the endpoint.",
    ),
    advice: translationKey(
      "Send the endpoint the pushes of the command's subscription only: wrapped, one log entry each.",
    ),
  },
  [CloudStreamRefusalReason.Throttled]: {
    reason: translationKey(
      "The subscription pushed more a minute than OneUptime takes.",
    ),
    advice: translationKey(
      "Nothing is lost: Pub/Sub pushes those messages again shortly. A narrower filter sends fewer.",
    ),
  },
};

export const CLOUD_STREAM_REFUSALS_BY_PROVIDER: Record<
  CloudProvider,
  CloudStreamRefusalTable
> = {
  [CloudProvider.AWS]: CLOUD_STREAM_REFUSAL_WORDS,
  [CloudProvider.Azure]: AZURE_STREAM_REFUSAL_WORDS,
  [CloudProvider.GCP]: GCP_STREAM_REFUSAL_WORDS,
};

// What a cloud's stream says when it does not know the reason.
const FALLBACK_REFUSAL: Record<CloudProvider, CloudStreamRefusalReason> = {
  [CloudProvider.AWS]: CloudStreamRefusalReason.Malformed,
  [CloudProvider.Azure]: CloudStreamRefusalReason.Unreachable,
  [CloudProvider.GCP]: CloudStreamRefusalReason.Malformed,
};

export function getCloudStreamRefusalWords(data: {
  provider: string | null | undefined;
  reason: CloudStreamRefusalReason | null | undefined;
}): CloudStreamRefusalWords {
  const provider: CloudProvider = readCloudStreamProvider(data.provider);
  const table: CloudStreamRefusalTable =
    CLOUD_STREAM_REFUSALS_BY_PROVIDER[provider];

  return (
    (data.reason ? table[data.reason] : undefined) ||
    table[FALLBACK_REFUSAL[provider]]!
  );
}

interface CloudStreamSentences {
  waiting: string;
  receiving: string;
  quiet: string;
  refused: string;
}

export const STREAM_WAITING_SENTENCE: string = translationKey(
  "Waiting for the first delivery. Firehose delivers within a few minutes of the command finishing.",
);
export const STREAM_RECEIVING_SENTENCE: string = translationKey(
  "Receiving. The last delivery came {{time}}.",
);
export const STREAM_QUIET_SENTENCE: string = translationKey(
  "No delivery since {{time}}: the connection reads its metrics on its schedule again until the stream delivers.",
);
export const STREAM_REFUSED_SENTENCE: string = translationKey(
  "The last delivery was refused, {{time}}: {{reason}} {{advice}}",
);

export const AZURE_STREAM_WAITING_SENTENCE: string = translationKey(
  "Waiting for the first events. Azure sends them within a few minutes of the command finishing, and OneUptime reads the event hubs every minute.",
);
export const AZURE_STREAM_RECEIVING_SENTENCE: string = translationKey(
  "Receiving. The last events came {{time}}.",
);
export const AZURE_STREAM_QUIET_SENTENCE: string = translationKey(
  "No events since {{time}}: the connection reads its metrics on its schedule again until they come.",
);
export const AZURE_STREAM_FAILED_SENTENCE: string = translationKey(
  "The event hubs could not be read, {{time}}: {{reason}} {{advice}}",
);

export const GCP_STREAM_WAITING_SENTENCE: string = translationKey(
  "Waiting for the first push. Pub/Sub pushes a log within a minute of a project writing one the filter takes.",
);
export const GCP_STREAM_RECEIVING_SENTENCE: string = translationKey(
  "Receiving. The last push came {{time}}.",
);
export const GCP_STREAM_QUIET_SENTENCE: string = translationKey(
  "No push since {{time}}: the projects wrote no log the filter takes, or their sinks are gone.",
);
export const GCP_STREAM_REFUSED_SENTENCE: string = translationKey(
  "The last push was refused, {{time}}: {{reason}} {{advice}}",
);

const SENTENCES: Record<CloudProvider, CloudStreamSentences> = {
  [CloudProvider.AWS]: {
    waiting: STREAM_WAITING_SENTENCE,
    receiving: STREAM_RECEIVING_SENTENCE,
    quiet: STREAM_QUIET_SENTENCE,
    refused: STREAM_REFUSED_SENTENCE,
  },
  [CloudProvider.Azure]: {
    waiting: AZURE_STREAM_WAITING_SENTENCE,
    receiving: AZURE_STREAM_RECEIVING_SENTENCE,
    quiet: AZURE_STREAM_QUIET_SENTENCE,
    refused: AZURE_STREAM_FAILED_SENTENCE,
  },
  [CloudProvider.GCP]: {
    waiting: GCP_STREAM_WAITING_SENTENCE,
    receiving: GCP_STREAM_RECEIVING_SENTENCE,
    quiet: GCP_STREAM_QUIET_SENTENCE,
    refused: GCP_STREAM_REFUSED_SENTENCE,
  },
};

const STATE_LABELS: Record<
  Exclude<CloudStreamState, "off">,
  { label: string; color: Color }
> = {
  receiving: { label: translationKey("Streaming"), color: Green },
  waiting: { label: translationKey("Stream waiting"), color: Yellow },
  quiet: { label: translationKey("Stream quiet"), color: Gray500 },
  refused: { label: translationKey("Stream refused"), color: Red },
};

// Azure's stream is OneUptime's own read: it fails, nothing is refused.
const AZURE_FAILED_LABEL: { label: string; color: Color } = {
  label: translationKey("Stream failing"),
  color: Red,
};

// A delivery's time as the list and the dialog write it.
export function formatCloudStreamTime(iso: string | undefined): string {
  if (!iso) {
    return "";
  }

  const time: Date = new Date(iso);

  return Number.isFinite(time.getTime())
    ? OneUptimeDate.getDateAsLocalShortDateTimeString(time)
    : "";
}

/*
 * How a connection's streaming is doing, in its cloud's words - or null
 * while it streams nothing (no key; for Azure, reading not turned on), when
 * the list says nothing of it.
 */
export function getCloudStreamStatusWords(data: {
  // AWS when left out.
  provider?: string | null | undefined;
  streamKeyCreatedAt: Date | string | null | undefined;
  streamSummary: unknown;
  now: Date;
}): CloudStreamStatusWords | null {
  const provider: CloudProvider = readCloudStreamProvider(data.provider);
  const sentences: CloudStreamSentences = SENTENCES[provider];
  const summary: CloudStreamSummary = readCloudStreamSummary(
    data.streamSummary,
  );
  const state: CloudStreamState = getCloudStreamState({
    hasKey: Boolean(data.streamKeyCreatedAt),
    summary,
    now: data.now,
  });

  if (state === "off") {
    return null;
  }

  const look: { label: string; color: Color } =
    state === "refused" && provider === CloudProvider.Azure
      ? AZURE_FAILED_LABEL
      : STATE_LABELS[state];

  if (state === "waiting") {
    return {
      state,
      ...look,
      sentence: { template: sentences.waiting, values: {} },
    };
  }

  if (state === "receiving" || state === "quiet") {
    return {
      state,
      ...look,
      sentence: {
        template: state === "receiving" ? sentences.receiving : sentences.quiet,
        values: { time: formatCloudStreamTime(summary.lastDeliveryAt) },
      },
    };
  }

  const refusal: CloudStreamRefusalWords = getCloudStreamRefusalWords({
    provider,
    reason: summary.lastRefusal?.reason,
  });

  return {
    state,
    ...look,
    sentence: {
      template: sentences.refused,
      values: {
        time: formatCloudStreamTime(summary.lastRefusal?.at),
        reason: translatableTerm(refusal.reason),
        advice: translatableTerm(refusal.advice),
      },
    },
  };
}

const METRICS_FROM: PluralTemplate = {
  one: "Metrics of {{count}} namespace from {{region}}",
  other: "Metrics of {{count}} namespaces from {{region}}",
};

const LOGS_FROM: PluralTemplate = {
  one: "Logs of {{count}} log group from {{region}}",
  other: "Logs of {{count}} log groups from {{region}}",
};

const AZURE_METRICS_FROM: PluralTemplate = {
  one: "Metrics of {{count}} resource type from {{region}}",
  other: "Metrics of {{count}} resource types from {{region}}",
};

const AZURE_LOGS_FROM: PluralTemplate = {
  one: "Logs of {{count}} category from {{region}}",
  other: "Logs of {{count}} categories from {{region}}",
};

const GCP_LOGS_FROM: PluralTemplate = {
  one: "Entries of {{count}} log from {{region}}",
  other: "Entries of {{count}} logs from {{region}}",
};

const SOURCE_TEMPLATES: Record<
  CloudProvider,
  { metrics: PluralTemplate; logs: PluralTemplate }
> = {
  [CloudProvider.AWS]: { metrics: METRICS_FROM, logs: LOGS_FROM },
  [CloudProvider.Azure]: { metrics: AZURE_METRICS_FROM, logs: AZURE_LOGS_FROM },
  // A Google Cloud stream carries no metrics.
  [CloudProvider.GCP]: { metrics: METRICS_FROM, logs: GCP_LOGS_FROM },
};

/*
 * What arrived, one line a place and kind, the newest first - "Metrics of
 * 12 namespaces from us-east-1", "Logs of 3 categories from westeurope",
 * "Entries of 4 logs from us-central1 (acme-prod)". The account is said
 * when there is more than one, and always for Google Cloud, whose logs a
 * project's are; a place with no region is its account.
 */
export function getCloudStreamSourceWords(
  streamSummary: unknown,
  // AWS when left out.
  providerName?: string | null | undefined,
): Array<CloudTemplate> {
  const provider: CloudProvider = readCloudStreamProvider(providerName);
  const templates: { metrics: PluralTemplate; logs: PluralTemplate } =
    SOURCE_TEMPLATES[provider];
  const summary: CloudStreamSummary = readCloudStreamSummary(streamSummary);
  const accounts: Set<string> = new Set<string>([
    ...summary.metricSources.map((source: { accountId: string }) => {
      return source.accountId;
    }),
    ...summary.logSources.map((source: { accountId: string }) => {
      return source.accountId;
    }),
  ]);
  const showAccount: boolean =
    accounts.size > 1 || provider === CloudProvider.GCP;
  const place: (source: {
    accountId: string;
    region: string;
  }) => string = (source: { accountId: string; region: string }): string => {
    if (!source.region) {
      return source.accountId || "?";
    }

    return showAccount && source.accountId
      ? `${source.region} (${source.accountId})`
      : source.region;
  };

  return [
    ...summary.metricSources.map(
      (source: {
        accountId: string;
        region: string;
        namespaces: Array<string>;
      }): CloudTemplate => {
        return {
          template: templates.metrics.other,
          values: { region: place(source) },
          plural: {
            one: templates.metrics.one,
            count: source.namespaces.length,
          },
        };
      },
    ),
    ...summary.logSources.map(
      (source: {
        accountId: string;
        region: string;
        logGroups: Array<string>;
      }): CloudTemplate => {
        return {
          template: templates.logs.other,
          values: { region: place(source) },
          plural: { one: templates.logs.one, count: source.logGroups.length },
        };
      },
    ),
  ];
}

/*
 * The Regions a connection's last read found resources in, most first:
 * where its streams are set up unless the dialog is told otherwise.
 */
export function getCloudStreamDefaultRegions(
  lastPullResult: unknown,
): Array<string> {
  if (!lastPullResult || typeof lastPullResult !== "object") {
    return [];
  }

  const regions: unknown = (lastPullResult as { regions?: unknown }).regions;

  if (!Array.isArray(regions)) {
    return [];
  }

  return regions
    .map((entry: unknown): string => {
      const region: unknown =
        entry && typeof entry === "object"
          ? (entry as { region?: unknown }).region
          : undefined;

      return typeof region === "string" ? region.trim().toLowerCase() : "";
    })
    .filter((region: string, index: number, all: Array<string>): boolean => {
      return Boolean(region) && all.indexOf(region) === index;
    });
}

/*
 * The accounts a connection's last read reached - an Azure connection's
 * subscriptions, a Google Cloud connection's projects - as it lists them.
 */
export function getCloudStreamReadAccounts(
  lastPullResult: unknown,
): Array<string> {
  if (!lastPullResult || typeof lastPullResult !== "object") {
    return [];
  }

  const accounts: unknown = (lastPullResult as { accounts?: unknown }).accounts;

  if (!Array.isArray(accounts)) {
    return [];
  }

  return accounts
    .map((account: unknown): string => {
      return typeof account === "string" ? account.trim().toLowerCase() : "";
    })
    .filter((account: string, index: number, all: Array<string>): boolean => {
      return Boolean(account) && all.indexOf(account) === index;
    });
}

/*
 * The Regions a connection's stacks are in, as far as OneUptime knows: the
 * Regions its streams delivered from - each delivery comes from its
 * stack's own - and then those its last read found resources in, where
 * the command deploys unless told otherwise. What Stop streaming's command
 * deletes, so a stack in a Region the read never found anything in is not
 * left behind, still billed.
 */
export function getCloudStreamStackRegions(data: {
  streamSummary: unknown;
  lastPullResult: unknown;
}): Array<string> {
  const summary: CloudStreamSummary = readCloudStreamSummary(
    data.streamSummary,
  );
  const regions: Array<string> = [];

  for (const region of [
    ...summary.metricSources.map((source: { region: string }): string => {
      return source.region;
    }),
    ...summary.logSources.map((source: { region: string }): string => {
      return source.region;
    }),
    ...getCloudStreamDefaultRegions(data.lastPullResult),
  ]) {
    const code: string = region.trim().toLowerCase();

    if (code && isAwsRegion(code) && !regions.includes(code)) {
      regions.push(code);
    }
  }

  return regions;
}
