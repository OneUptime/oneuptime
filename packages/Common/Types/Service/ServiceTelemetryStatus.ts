/*
 * WHAT A SERVICE'S STATUS SAYS (issue #6270).
 *
 * A service has no stored connection status: its Overview works one out
 * from lastSeenAt, when telemetry last arrived for it. It used to say
 * "Connected" for 30 minutes after that and "Disconnected" (amber) from
 * then on - so a staging service, an internal API used in office hours or
 * a worker that runs every hour read as if its link to OneUptime were
 * broken whenever nobody had called it for half an hour.
 *
 * Unlike a RUM application or a serverless function, a service may also
 * send runtime metrics all the time, so its silence is less clearly idle:
 * it can be quiet because nobody calls it, or because it stopped. So the
 * words claim only what OneUptime knows - whether data is arriving - and
 * the tooltip says what each reading can mean:
 *
 *   Receiving data   - something arrived in the last 30 minutes. Green.
 *   No recent data   - something arrived before, and nothing has for 30
 *                      minutes. Grey: often idle, sometimes stopped, and
 *                      OneUptime cannot tell which.
 *   Waiting for data - nothing has ever arrived: the service was created
 *                      by hand before its telemetry. Grey.
 *
 * "Receiving data" and "Waiting for data" are the words a RUM application
 * and a serverless function use (RumApplicationStatus,
 * ServerlessFunctionStatus): the same keys, so the same words in every
 * language.
 *
 * Read from lastSeenAt and the reader's clock, with the window inclusive
 * at its end: data that arrived exactly 30 minutes ago is still receiving,
 * as the silence sweeps of the other resources count it
 * (lastSeenAt < cutoff is what turns one quiet). A lastSeenAt ahead of the
 * reader's clock - the server's clock, which writes it, running ahead of
 * the browser's - is receiving: it arrived as recently as can be. A value
 * that is not a real date is never seen, not "last seen Invalid Date ago".
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn (the Dashboard's extractor reads this
 * file as a "keys" root). React-free and server-safe.
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
 * How long a service may send nothing before it shows "No recent data".
 * Well above the minute lastSeenAt is throttled to (ServiceService's
 * LAST_SEEN_THROTTLE_SECONDS) and the five minutes it can trail live
 * traffic by (the OpenTelemetry ingest's maintenance fence), so a busy
 * service never flaps. The words below say this number.
 */
export const SERVICE_NO_RECENT_DATA_AFTER_MINUTES: number = 30;

export const SERVICE_NO_RECENT_DATA_AFTER_MS: number =
  SERVICE_NO_RECENT_DATA_AFTER_MINUTES * 60 * 1000;

export enum ServiceTelemetryStatus {
  ReceivingData = "receiving-data",
  NoRecentData = "no-recent-data",
  WaitingForData = "waiting-for-data",
}

// The pill's colour: green while data arrives, grey otherwise.
export type ServiceTelemetryStatusTone = "positive" | "neutral";

export interface ServiceTelemetryStatusWords {
  // The pill's words.
  label: string;
  // What the status means and what, if anything, to do: the pill's tooltip.
  description: string;
  tone: ServiceTelemetryStatusTone;
}

export interface ServiceTelemetryStatusInput {
  lastSeenAt: Date | string | null | undefined;
  // The reader's clock.
  now: Date;
}

export const SERVICE_RECEIVING_DATA_LABEL: string =
  translationKey("Receiving data");

export const SERVICE_NO_RECENT_DATA_LABEL: string =
  translationKey("No recent data");

export const SERVICE_WAITING_FOR_DATA_LABEL: string =
  translationKey("Waiting for data");

export const SERVICE_RECEIVING_DATA_DESCRIPTION: string = translationKey(
  "Data has arrived from this service in the last 30 minutes.",
);

export const SERVICE_NO_RECENT_DATA_DESCRIPTION: string = translationKey(
  "Nothing has arrived in the last 30 minutes. A service that sends data only while it handles requests is quiet when nobody calls it. If it should be busy, check that it is running and still sends its telemetry to OneUptime with this service.name.",
);

export const SERVICE_WAITING_FOR_DATA_DESCRIPTION: string = translationKey(
  "Nothing has arrived from this service yet. Send its OpenTelemetry data with service.name set to exactly this service's name.",
);

const SERVICE_TELEMETRY_STATUS_WORDS: Record<
  ServiceTelemetryStatus,
  ServiceTelemetryStatusWords
> = {
  [ServiceTelemetryStatus.ReceivingData]: {
    label: SERVICE_RECEIVING_DATA_LABEL,
    description: SERVICE_RECEIVING_DATA_DESCRIPTION,
    tone: "positive",
  },
  [ServiceTelemetryStatus.NoRecentData]: {
    label: SERVICE_NO_RECENT_DATA_LABEL,
    description: SERVICE_NO_RECENT_DATA_DESCRIPTION,
    tone: "neutral",
  },
  [ServiceTelemetryStatus.WaitingForData]: {
    label: SERVICE_WAITING_FOR_DATA_LABEL,
    description: SERVICE_WAITING_FOR_DATA_DESCRIPTION,
    tone: "neutral",
  },
};

/*
 * When telemetry last arrived, or null when it never has. A value that
 * does not parse to a real date is treated as never: "last seen Invalid
 * Date ago" helps nobody.
 */
export const getServiceLastDataAt: (
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

/*
 * Whether data that arrived at `lastDataAt` still counts as arriving at
 * `now`: at most SERVICE_NO_RECENT_DATA_AFTER_MINUTES ago, or ahead of the
 * reader's clock. A `now` that is not a real date counts nothing as
 * recent: the age is then not a number, which no window holds.
 */
export const isServiceDataRecent: (lastDataAt: Date, now: Date) => boolean = (
  lastDataAt: Date,
  now: Date,
): boolean => {
  const age: number = now.getTime() - lastDataAt.getTime();

  return age <= SERVICE_NO_RECENT_DATA_AFTER_MS;
};

export const getServiceTelemetryStatus: (
  input: ServiceTelemetryStatusInput,
) => ServiceTelemetryStatus = (
  input: ServiceTelemetryStatusInput,
): ServiceTelemetryStatus => {
  const lastDataAt: Date | null = getServiceLastDataAt(input.lastSeenAt);

  if (!lastDataAt) {
    return ServiceTelemetryStatus.WaitingForData;
  }

  return isServiceDataRecent(lastDataAt, input.now)
    ? ServiceTelemetryStatus.ReceivingData
    : ServiceTelemetryStatus.NoRecentData;
};

/*
 * The words and colour for a status. Anything that is not one of the three
 * reads as waiting, the state that claims the least.
 */
export const getServiceTelemetryStatusWords: (
  status: ServiceTelemetryStatus,
) => ServiceTelemetryStatusWords = (
  status: ServiceTelemetryStatus,
): ServiceTelemetryStatusWords => {
  return (
    SERVICE_TELEMETRY_STATUS_WORDS[status] ||
    SERVICE_TELEMETRY_STATUS_WORDS[ServiceTelemetryStatus.WaitingForData]
  );
};

export interface ServiceTelemetryStatusDescription
  extends ServiceTelemetryStatusWords {
  status: ServiceTelemetryStatus;
  // When data last arrived (a real date), or null: the hero's "Last seen".
  lastDataAt: Date | null;
}

// The status, its words and when data last arrived, from the record.
export const describeServiceTelemetryStatus: (
  input: ServiceTelemetryStatusInput,
) => ServiceTelemetryStatusDescription = (
  input: ServiceTelemetryStatusInput,
): ServiceTelemetryStatusDescription => {
  const status: ServiceTelemetryStatus = getServiceTelemetryStatus(input);

  return {
    status,
    ...getServiceTelemetryStatusWords(status),
    lastDataAt: getServiceLastDataAt(input.lastSeenAt),
  };
};
