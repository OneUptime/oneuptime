import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
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
 * What Cloud > Connect says about a connection's streams - Amazon Data
 * Firehose delivering an AWS account's CloudWatch metrics and logs - in
 * the dashboard's own words: how streaming is doing, in a word for the
 * connections list and a sentence for the streaming dialog, why a delivery
 * was refused and what to do, and what arrived from where.
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

export const CLOUD_STREAM_REFUSAL_WORDS: Record<
  CloudStreamRefusalReason,
  CloudStreamRefusalWords
> = {
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

const STATE_LABELS: Record<
  Exclude<CloudStreamState, "off">,
  { label: string; color: Color }
> = {
  receiving: { label: translationKey("Streaming"), color: Green },
  waiting: { label: translationKey("Stream waiting"), color: Yellow },
  quiet: { label: translationKey("Stream quiet"), color: Gray500 },
  refused: { label: translationKey("Stream refused"), color: Red },
};

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
 * How a connection's streaming is doing - or null while it streams
 * nothing (no key), when the list says nothing of it.
 */
export function getCloudStreamStatusWords(data: {
  streamKeyCreatedAt: Date | string | null | undefined;
  streamSummary: unknown;
  now: Date;
}): CloudStreamStatusWords | null {
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

  const look: { label: string; color: Color } = STATE_LABELS[state];

  if (state === "waiting") {
    return {
      state,
      ...look,
      sentence: { template: STREAM_WAITING_SENTENCE, values: {} },
    };
  }

  if (state === "receiving") {
    return {
      state,
      ...look,
      sentence: {
        template: STREAM_RECEIVING_SENTENCE,
        values: { time: formatCloudStreamTime(summary.lastDeliveryAt) },
      },
    };
  }

  if (state === "quiet") {
    return {
      state,
      ...look,
      sentence: {
        template: STREAM_QUIET_SENTENCE,
        values: { time: formatCloudStreamTime(summary.lastDeliveryAt) },
      },
    };
  }

  const refusal: CloudStreamRefusalWords =
    CLOUD_STREAM_REFUSAL_WORDS[
      summary.lastRefusal?.reason || CloudStreamRefusalReason.Malformed
    ];

  return {
    state,
    ...look,
    sentence: {
      template: STREAM_REFUSED_SENTENCE,
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

/*
 * What arrived, one line a Region and kind, the newest first:
 * "Metrics of 12 namespaces from us-east-1", "Logs of 3 log groups from
 * eu-west-1". The account is said when there is more than one.
 */
export function getCloudStreamSourceWords(
  streamSummary: unknown,
): Array<CloudTemplate> {
  const summary: CloudStreamSummary = readCloudStreamSummary(streamSummary);
  const accounts: Set<string> = new Set<string>([
    ...summary.metricSources.map((source: { accountId: string }) => {
      return source.accountId;
    }),
    ...summary.logSources.map((source: { accountId: string }) => {
      return source.accountId;
    }),
  ]);
  const place: (source: {
    accountId: string;
    region: string;
  }) => string = (source: { accountId: string; region: string }): string => {
    const region: string = source.region || "?";
    return accounts.size > 1 ? `${region} (${source.accountId})` : region;
  };

  return [
    ...summary.metricSources.map(
      (source: {
        accountId: string;
        region: string;
        namespaces: Array<string>;
      }): CloudTemplate => {
        return {
          template: METRICS_FROM.other,
          values: { region: place(source) },
          plural: { one: METRICS_FROM.one, count: source.namespaces.length },
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
          template: LOGS_FROM.other,
          values: { region: place(source) },
          plural: { one: LOGS_FROM.one, count: source.logGroups.length },
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
