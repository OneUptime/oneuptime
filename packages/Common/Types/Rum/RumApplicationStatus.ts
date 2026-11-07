/*
 * WHAT A RUM APPLICATION'S STATUS SAYS (issue #6191).
 *
 * A RUM application's data comes from the people who use it: every page
 * load, click, request and recording is sent by a visitor's browser or a
 * user's phone. When nobody uses the app - an internal tool overnight, a
 * staging site between releases, a shop at four in the morning - nothing
 * arrives, and that is the app working as it should. The status used to say
 * "Disconnected" then, in red, which reads as "the link between your app and
 * OneUptime is broken" and sent people looking for a fault that was not
 * there. So it says what is actually true instead:
 *
 *   Receiving data    - data arrived in the last 15 minutes. Green.
 *   No recent traffic - data arrived before, and nothing has for 15
 *                       minutes: nobody has used the app in that time.
 *                       Grey, never red: it is normal.
 *   Waiting for data  - nothing has ever arrived: the application was added
 *                       by hand and its app has not sent anything yet.
 *                       Grey; its Overview shows how to set it up.
 *
 * There is no warning state, on purpose. OneUptime has no signal that a RUM
 * application's SDK is broken: a revoked key, a key switched off and an
 * origin a Browser key does not allow are all refused by the ingest
 * middleware before the request is read, so before it names an application.
 * A state saying "something is wrong" would be a guess. (Session Replay's
 * own refusals are counted per application, and its Recording Health row
 * and Health page say them.)
 *
 * Every place that says it reads it from here: the RUM Applications list
 * (its Status column), an application's Overview (the pill in its hero and
 * the connection card under it) and OneUptime AI's query_rum_applications
 * tool. The record keeps the values it always had - otelCollectorStatus
 * "connected" / "disconnected", written by ingest and by the sweep
 * (RumApplicationService.markDisconnectedApplications), which the API
 * returns and filters on - so only the words and the colours changed.
 *
 * The status is read exactly as an overview's connection card reads any
 * resource (ResourceConnectionState in the Dashboard): "connected" or
 * "active" is receiving, otherwise a lastSeenAt that is a real date is no
 * recent traffic, otherwise it is waiting. So the pill and the card under it
 * can never disagree. The sweep decides when "connected" turns to
 * "disconnected"; the clock is not read here.
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn (the Dashboard's extractor reads this file
 * as a "keys" root). React-free and server-safe: the AI toolbox and the
 * tests call it.
 */

/*
 * Marks an English text as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI. It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * How long an application may send nothing before it shows "No recent
 * traffic": the sweep's silence, counted only while OneUptime was receiving
 * (ReceivingCoverage). It stays well above the five minutes lastSeenAt can
 * trail live traffic by (the OpenTelemetry ingest's maintenance fence), so
 * an app in use never flaps. The words below say this number.
 */
export const RUM_APPLICATION_NO_RECENT_TRAFFIC_AFTER_MINUTES: number = 15;

export enum RumApplicationStatus {
  ReceivingData = "receiving-data",
  NoRecentTraffic = "no-recent-traffic",
  WaitingForData = "waiting-for-data",
}

// The pill's colour: green while data arrives, grey otherwise.
export type RumApplicationStatusTone = "positive" | "neutral";

export interface RumApplicationStatusWords {
  // The pill's words.
  label: string;
  // What the status means and what, if anything, to do: the pill's tooltip.
  description: string;
  tone: RumApplicationStatusTone;
}

export interface RumApplicationStatusInput {
  otelCollectorStatus: string | null | undefined;
  lastSeenAt: Date | string | null | undefined;
}

export const RUM_APPLICATION_RECEIVING_DATA_LABEL: string =
  translationKey("Receiving data");

export const RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL: string =
  translationKey("No recent traffic");

export const RUM_APPLICATION_WAITING_FOR_DATA_LABEL: string =
  translationKey("Waiting for data");

export const RUM_APPLICATION_RECEIVING_DATA_DESCRIPTION: string =
  translationKey(
    "Data has arrived from this application in the last 15 minutes.",
  );

export const RUM_APPLICATION_NO_RECENT_TRAFFIC_DESCRIPTION: string =
  translationKey(
    "Nothing has arrived in the last 15 minutes. An application sends data only while people use it, so this is normal when nobody is, for example overnight. If people are using it right now, its Overview lists what to check.",
  );

export const RUM_APPLICATION_WAITING_FOR_DATA_DESCRIPTION: string =
  translationKey(
    "Nothing has arrived from this application yet. Add the OpenTelemetry SDK or the Session Replay snippet to your app; its Documentation tab shows how.",
  );

const RUM_APPLICATION_STATUS_WORDS: Record<
  RumApplicationStatus,
  RumApplicationStatusWords
> = {
  [RumApplicationStatus.ReceivingData]: {
    label: RUM_APPLICATION_RECEIVING_DATA_LABEL,
    description: RUM_APPLICATION_RECEIVING_DATA_DESCRIPTION,
    tone: "positive",
  },
  [RumApplicationStatus.NoRecentTraffic]: {
    label: RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL,
    description: RUM_APPLICATION_NO_RECENT_TRAFFIC_DESCRIPTION,
    tone: "neutral",
  },
  [RumApplicationStatus.WaitingForData]: {
    label: RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
    description: RUM_APPLICATION_WAITING_FOR_DATA_DESCRIPTION,
    tone: "neutral",
  },
};

/*
 * "connected" and "active" are receiving, whatever their case - and nothing
 * else is, not even with spaces around it: the card under the pill reads the
 * value exactly so (isResourceStatusConnected), and the two must agree.
 */
export const isRumApplicationStatusReceiving: (
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
export const getRumApplicationLastDataAt: (
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

export const getRumApplicationStatus: (
  input: RumApplicationStatusInput,
) => RumApplicationStatus = (
  input: RumApplicationStatusInput,
): RumApplicationStatus => {
  if (isRumApplicationStatusReceiving(input.otelCollectorStatus)) {
    return RumApplicationStatus.ReceivingData;
  }

  return getRumApplicationLastDataAt(input.lastSeenAt)
    ? RumApplicationStatus.NoRecentTraffic
    : RumApplicationStatus.WaitingForData;
};

/*
 * The words and colour for a status. Anything that is not one of the three
 * (a value from an older client, say) reads as waiting, the state that
 * claims the least.
 */
export const getRumApplicationStatusWords: (
  status: RumApplicationStatus,
) => RumApplicationStatusWords = (
  status: RumApplicationStatus,
): RumApplicationStatusWords => {
  return (
    RUM_APPLICATION_STATUS_WORDS[status] ||
    RUM_APPLICATION_STATUS_WORDS[RumApplicationStatus.WaitingForData]
  );
};

export interface RumApplicationStatusDescription
  extends RumApplicationStatusWords {
  status: RumApplicationStatus;
}

// The status and its words, from what the application's record holds.
export const describeRumApplicationStatus: (
  input: RumApplicationStatusInput,
) => RumApplicationStatusDescription = (
  input: RumApplicationStatusInput,
): RumApplicationStatusDescription => {
  const status: RumApplicationStatus = getRumApplicationStatus(input);

  return { status, ...getRumApplicationStatusWords(status) };
};
