/*
 * WHAT A SERVERLESS FUNCTION'S STATUS SAYS (issue #6269).
 *
 * A serverless function sends its telemetry only while it runs: the
 * platform freezes or stops it between invocations, and nothing is
 * exported then. A nightly job, a webhook handler on a quiet day and a
 * staging function all go silent for hours, and that is the function
 * working as it should. The status used to say "Disconnected" then, in
 * red, which reads as "the link between your function and OneUptime is
 * broken" and sent people looking for a fault that was not there. So it
 * says what is actually true instead:
 *
 *   Receiving data        - data arrived in the last 15 minutes. Green.
 *   No recent invocations - data arrived before, and nothing has for 15
 *                           minutes: nothing has invoked the function in
 *                           that time. Grey, never red: it is normal.
 *   Waiting for data      - nothing has ever arrived: the function was
 *                           added through the API and has not run with
 *                           the OpenTelemetry SDK yet. Grey; its Overview
 *                           shows how to set it up.
 *
 * There is no warning state, on purpose. OneUptime has no signal that a
 * function's export is broken: a revoked or mistyped ingestion key is
 * refused by the ingest middleware before the request is read, so before
 * it names a function, and a function that cannot reach OneUptime sends
 * nothing at all. A state saying "something is wrong" would be a guess.
 * The tooltip and the Overview say what to check when the function should
 * be running.
 *
 * Every place that says it reads it from here: the Serverless Functions
 * list (its Status column), a function's Overview (the pill in its hero
 * and the connection card under it) and OneUptime AI's
 * query_telemetry_resources tool. The record keeps the values it always
 * had - otelCollectorStatus "connected" / "disconnected", written by
 * ingest and by the sweep (ServerlessFunctionService.
 * markDisconnectedFunctions), which the API returns and filters on - so
 * only the words and the colours changed.
 *
 * The status is read exactly as an overview's connection card reads any
 * resource (ResourceConnectionState in the Dashboard): "connected" or
 * "active" is receiving, otherwise a lastSeenAt that is a real date is no
 * recent invocations, otherwise it is waiting. So the pill and the card
 * under it can never disagree. The sweep decides when "connected" turns
 * to "disconnected"; the clock is not read here.
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn (the Dashboard's extractor reads this
 * file as a "keys" root). React-free and server-safe: the sweep, the AI
 * toolbox and the tests read it.
 */

/*
 * Marks an English text as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here
 * so this file stays free of the UI. It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * How long a function may send nothing before it shows "No recent
 * invocations": the sweep's silence (markDisconnectedFunctions reads this
 * constant), counted only while OneUptime was receiving
 * (ReceivingCoverage). It stays well above the five minutes lastSeenAt can
 * trail live traffic by (the OpenTelemetry ingest's maintenance fence), so
 * a function in use never flaps. The words below say this number.
 */
export const SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_AFTER_MINUTES: number = 15;

export enum ServerlessFunctionStatus {
  ReceivingData = "receiving-data",
  NoRecentInvocations = "no-recent-invocations",
  WaitingForData = "waiting-for-data",
}

// The pill's colour: green while data arrives, grey otherwise.
export type ServerlessFunctionStatusTone = "positive" | "neutral";

export interface ServerlessFunctionStatusWords {
  // The pill's words.
  label: string;
  // What the status means and what, if anything, to do: the pill's tooltip.
  description: string;
  tone: ServerlessFunctionStatusTone;
}

export interface ServerlessFunctionStatusInput {
  otelCollectorStatus: string | null | undefined;
  lastSeenAt: Date | string | null | undefined;
}

/*
 * "Receiving data" and "Waiting for data" are the words a RUM
 * application's status uses (RumApplicationStatus): the same keys, so the
 * same words in every language. Only the quiet state says what is quiet -
 * a function's invocations, an application's traffic.
 */
export const SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL: string =
  translationKey("Receiving data");

export const SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL: string =
  translationKey("No recent invocations");

export const SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL: string =
  translationKey("Waiting for data");

export const SERVERLESS_FUNCTION_RECEIVING_DATA_DESCRIPTION: string =
  translationKey("Data has arrived from this function in the last 15 minutes.");

export const SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION: string =
  translationKey(
    "Nothing has arrived in the last 15 minutes. A function sends data only while it runs, so this is normal when nothing has invoked it, for example between scheduled runs. If it should be running, its Overview lists what to check.",
  );

export const SERVERLESS_FUNCTION_WAITING_FOR_DATA_DESCRIPTION: string =
  translationKey(
    "Nothing has arrived from this function yet. Add the OpenTelemetry SDK to it and invoke it once; its Documentation tab shows how.",
  );

const SERVERLESS_FUNCTION_STATUS_WORDS: Record<
  ServerlessFunctionStatus,
  ServerlessFunctionStatusWords
> = {
  [ServerlessFunctionStatus.ReceivingData]: {
    label: SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
    description: SERVERLESS_FUNCTION_RECEIVING_DATA_DESCRIPTION,
    tone: "positive",
  },
  [ServerlessFunctionStatus.NoRecentInvocations]: {
    label: SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_LABEL,
    description: SERVERLESS_FUNCTION_NO_RECENT_INVOCATIONS_DESCRIPTION,
    tone: "neutral",
  },
  [ServerlessFunctionStatus.WaitingForData]: {
    label: SERVERLESS_FUNCTION_WAITING_FOR_DATA_LABEL,
    description: SERVERLESS_FUNCTION_WAITING_FOR_DATA_DESCRIPTION,
    tone: "neutral",
  },
};

/*
 * "connected" and "active" are receiving, whatever their case - and nothing
 * else is, not even with spaces around it: the card under the pill reads the
 * value exactly so (isResourceStatusConnected), and the two must agree.
 */
export const isServerlessFunctionStatusReceiving: (
  otelCollectorStatus: string | null | undefined,
) => boolean = (otelCollectorStatus: string | null | undefined): boolean => {
  const normalized: string = (otelCollectorStatus || "").toLowerCase();

  return normalized === "connected" || normalized === "active";
};

/*
 * When data last arrived, or null when it never has. A value that does not
 * parse to a real date is treated as never: "last seen Invalid Date ago"
 * helps nobody.
 */
export const getServerlessFunctionLastDataAt: (
  lastSeenAt: Date | string | null | undefined,
) => Date | null = (
  lastSeenAt: Date | string | null | undefined,
): Date | null => {
  if (!lastSeenAt) {
    return null;
  }

  const date: Date =
    lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);

  return isNaN(date.getTime()) ? null : date;
};

export const getServerlessFunctionStatus: (
  input: ServerlessFunctionStatusInput,
) => ServerlessFunctionStatus = (
  input: ServerlessFunctionStatusInput,
): ServerlessFunctionStatus => {
  if (isServerlessFunctionStatusReceiving(input.otelCollectorStatus)) {
    return ServerlessFunctionStatus.ReceivingData;
  }

  return getServerlessFunctionLastDataAt(input.lastSeenAt)
    ? ServerlessFunctionStatus.NoRecentInvocations
    : ServerlessFunctionStatus.WaitingForData;
};

/*
 * The words and colour for a status. Anything that is not one of the three
 * (a value from an older client, say) reads as waiting, the state that
 * claims the least.
 */
export const getServerlessFunctionStatusWords: (
  status: ServerlessFunctionStatus,
) => ServerlessFunctionStatusWords = (
  status: ServerlessFunctionStatus,
): ServerlessFunctionStatusWords => {
  return (
    SERVERLESS_FUNCTION_STATUS_WORDS[status] ||
    SERVERLESS_FUNCTION_STATUS_WORDS[ServerlessFunctionStatus.WaitingForData]
  );
};

export interface ServerlessFunctionStatusDescription
  extends ServerlessFunctionStatusWords {
  status: ServerlessFunctionStatus;
}

// The status and its words, from what the function's record holds.
export const describeServerlessFunctionStatus: (
  input: ServerlessFunctionStatusInput,
) => ServerlessFunctionStatusDescription = (
  input: ServerlessFunctionStatusInput,
): ServerlessFunctionStatusDescription => {
  const status: ServerlessFunctionStatus = getServerlessFunctionStatus(input);

  return { status, ...getServerlessFunctionStatusWords(status) };
};
