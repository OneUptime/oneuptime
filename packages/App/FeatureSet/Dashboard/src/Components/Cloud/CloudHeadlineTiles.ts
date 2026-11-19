import {
  CloudHeadlineFormat,
  CloudHeadlineReading,
  CloudResourceReading,
  CloudResourceReadings,
  HEADLINE_AVAILABILITY,
  HEADLINE_CAPACITY,
  HEADLINE_CONNECTIONS,
  HEADLINE_CPU,
  HEADLINE_DATA_SIZE,
  HEADLINE_DEAD_LETTERED,
  HEADLINE_DISK_READ,
  HEADLINE_DISK_WRITE,
  HEADLINE_DOCUMENTS,
  HEADLINE_DURATION,
  HEADLINE_ERRORS,
  HEADLINE_FAILED_RUNS,
  HEADLINE_FREE_MEMORY,
  HEADLINE_FREE_STORAGE,
  HEADLINE_HEALTH,
  HEADLINE_HEALTHY_BACKENDS,
  HEADLINE_INDEX_SIZE,
  HEADLINE_INSTANCES,
  HEADLINE_INVOCATIONS,
  HEADLINE_LATENCY,
  HEADLINE_MEMORY,
  HEADLINE_MESSAGES_IN,
  HEADLINE_MESSAGES_OUT,
  HEADLINE_MESSAGES_WAITING,
  HEADLINE_NETWORK_IN,
  HEADLINE_NETWORK_OUT,
  HEADLINE_OLDEST_MESSAGE,
  HEADLINE_PODS_READY,
  HEADLINE_PORTS_USED,
  HEADLINE_QUEUE_LENGTH,
  HEADLINE_READ_LATENCY,
  HEADLINE_READ_OPERATIONS,
  HEADLINE_REQUESTS,
  HEADLINE_REQUEST_UNITS,
  HEADLINE_RESPONSE_TIME,
  HEADLINE_RESTARTS,
  HEADLINE_RUNS,
  HEADLINE_SERVER_LOAD,
  HEADLINE_SESSIONS,
  HEADLINE_STORAGE_USED,
  HEADLINE_THROTTLED,
  HEADLINE_THROUGHPUT,
  HEADLINE_TRAFFIC,
  HEADLINE_UNHEALTHY_HOSTS,
  HEADLINE_WRITE_LATENCY,
  HEADLINE_WRITE_OPERATIONS,
  getCloudHeadlineReadingOf,
  getCloudHeadlineReadings,
  getCloudReadingAgeMs,
  getCloudReadingPeriodSeconds,
  isCloudHeadlineExpected,
} from "Common/Types/Cloud/CloudResourceHealth";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  formatDurationInUnit,
  formatMilliseconds,
} from "../../Utils/Milliseconds";
import { formatMinutesAgo } from "../Inventory/InventoryLiveness";

/*
 * WHAT A CLOUD RESOURCE'S PAGE LEADS WITH.
 *
 * A resource is any of a hundred types, each with metrics of its own, so
 * its page names, for the common types, the few numbers people read first
 * (CloudResourceHealth's headline readings: a database's CPU, free storage
 * and connections; a load balancer's requests and response time) and
 * draws each as the hero's tiles from what the last read kept - no query
 * over the metrics. A type with none gets no tiles: its Metrics card below
 * lists everything it reports.
 *
 * A level every resource of the type reports (its CPU, its free memory,
 * its connections) that a fresh read did not bring is said plainly - "Not
 * reported" in its tile - rather than left out, so a page never leaves the
 * reader wondering where a number went (isCloudHeadlineExpected). One its
 * cloud reports only with something installed says what, with the
 * provider's instructions a click away: a Compute Engine VM's memory and
 * disks "Need the Ops Agent" (CloudHeadlineReading.needs). A sum over the
 * period is left out: the cloud writes none for a period it is zero in.
 *
 * A reading read less often than every read - an Azure metric kept at five
 * minutes, read every 15, which the read keeps between its reads (#9740) -
 * says how old it is under its value ("12m ago"), so a figure from a
 * quarter of an hour ago never reads as the resource's now.
 *
 * React-free (the page maps these to its tiles), so App tests can read it.
 */

export const PER_MINUTE: string = translationKey("per minute");
export const PER_SECOND: string = translationKey("per second");
export const NOT_REPORTED: string = translationKey("Not reported");
export const NOT_REPORTED_DESCRIPTION: string = translationKey(
  "Its cloud sent no value for this in the last read.",
);

// Two rows of tiles at most: the Metrics card below has every metric.
export const CLOUD_HEADLINE_TILES_MAX: number = 8;

export interface CloudHeadlineTile {
  key: string;
  // English, looked up in the reader's language by the tile.
  title: string;
  value: string;
  sublabel?: string | undefined;
  // English words drawn in place of a value the last read did not bring.
  valueNote?: string | undefined;
  // The (i) beside the title: what a missing value means (English).
  description?: string | undefined;
  /*
   * Where to get what would give it a value, drawn in place of the line
   * under it: the provider's own instructions (an English label).
   */
  link?: { url: string; label: string } | undefined;
  // For a percent: the tile's bar.
  percent?: number | null | undefined;
  // A share that is better the fuller it is: availability, healthy backends.
  higherIsBetter?: boolean | undefined;
  // Where its bar turns amber and red, as its type's rules judge it.
  thresholds?: { warn: number; danger: number } | undefined;
  icon: IconProp;
  iconColor: "blue" | "violet" | "amber" | "emerald" | "slate" | "sky" | "rose";
}

/*
 * How a share's bar is coloured, where the default - amber from 70%, red
 * from 90%, for what is worse the fuller it is (CPU, memory, storage) -
 * would say the opposite of the health rules: an availability of 100% is
 * the bar's best, red under 90% and amber under 99.9% as its rules judge
 * it (CloudResourceHealth's availability); a load balancer's healthy
 * backends red under half and amber under all; a share of requests that
 * failed amber from 5% and red from half.
 */
const BARS: Record<
  string,
  {
    higherIsBetter?: boolean | undefined;
    thresholds: { warn: number; danger: number };
  }
> = {
  [HEADLINE_AVAILABILITY]: {
    higherIsBetter: true,
    thresholds: { warn: 99.9, danger: 90 },
  },
  [HEADLINE_HEALTHY_BACKENDS]: {
    higherIsBetter: true,
    thresholds: { warn: 100, danger: 50 },
  },
  [HEADLINE_HEALTH]: {
    higherIsBetter: true,
    thresholds: { warn: 100, danger: 50 },
  },
  [HEADLINE_ERRORS]: { thresholds: { warn: 5, danger: 50 } },
};

const ICONS: Record<
  string,
  { icon: IconProp; color: CloudHeadlineTile["iconColor"] }
> = {
  [HEADLINE_CPU]: { icon: IconProp.CPUChip, color: "blue" },
  [HEADLINE_MEMORY]: { icon: IconProp.Server, color: "violet" },
  [HEADLINE_STORAGE_USED]: { icon: IconProp.Database, color: "amber" },
  [HEADLINE_FREE_STORAGE]: { icon: IconProp.Database, color: "amber" },
  [HEADLINE_CONNECTIONS]: { icon: IconProp.Signal, color: "sky" },
  [HEADLINE_REQUESTS]: { icon: IconProp.Activity, color: "blue" },
  [HEADLINE_INVOCATIONS]: { icon: IconProp.Bolt, color: "blue" },
  [HEADLINE_ERRORS]: { icon: IconProp.Alert, color: "rose" },
  [HEADLINE_LATENCY]: { icon: IconProp.Clock, color: "emerald" },
  [HEADLINE_RESPONSE_TIME]: { icon: IconProp.Clock, color: "emerald" },
  [HEADLINE_DURATION]: { icon: IconProp.Clock, color: "emerald" },
  [HEADLINE_MESSAGES_WAITING]: { icon: IconProp.InboxStack, color: "sky" },
  [HEADLINE_OLDEST_MESSAGE]: { icon: IconProp.Clock, color: "amber" },
  [HEADLINE_UNHEALTHY_HOSTS]: { icon: IconProp.Server, color: "rose" },
  [HEADLINE_AVAILABILITY]: { icon: IconProp.Heart, color: "emerald" },
  [HEADLINE_SERVER_LOAD]: { icon: IconProp.Scale, color: "violet" },
  [HEADLINE_FREE_MEMORY]: { icon: IconProp.Server, color: "violet" },
  [HEADLINE_NETWORK_IN]: { icon: IconProp.ArrowDown, color: "sky" },
  [HEADLINE_NETWORK_OUT]: { icon: IconProp.ArrowUp, color: "sky" },
  [HEADLINE_DISK_READ]: { icon: IconProp.Disc, color: "amber" },
  [HEADLINE_DISK_WRITE]: { icon: IconProp.Disc, color: "amber" },
  [HEADLINE_READ_OPERATIONS]: { icon: IconProp.ArrowDown, color: "amber" },
  [HEADLINE_WRITE_OPERATIONS]: { icon: IconProp.ArrowUp, color: "amber" },
  [HEADLINE_READ_LATENCY]: { icon: IconProp.Clock, color: "emerald" },
  [HEADLINE_WRITE_LATENCY]: { icon: IconProp.Clock, color: "emerald" },
  [HEADLINE_TRAFFIC]: { icon: IconProp.ArrowUpDown, color: "sky" },
  [HEADLINE_THROUGHPUT]: { icon: IconProp.ArrowUpDown, color: "sky" },
  [HEADLINE_HEALTHY_BACKENDS]: { icon: IconProp.CheckCircle, color: "emerald" },
  [HEADLINE_HEALTH]: { icon: IconProp.Heart, color: "emerald" },
  [HEADLINE_MESSAGES_IN]: { icon: IconProp.InboxArrowDown, color: "sky" },
  [HEADLINE_MESSAGES_OUT]: { icon: IconProp.PaperAirplane, color: "sky" },
  [HEADLINE_DEAD_LETTERED]: { icon: IconProp.Alert, color: "rose" },
  [HEADLINE_QUEUE_LENGTH]: { icon: IconProp.InboxStack, color: "amber" },
  [HEADLINE_PODS_READY]: { icon: IconProp.Cube, color: "emerald" },
  [HEADLINE_INSTANCES]: { icon: IconProp.SquareStack, color: "blue" },
  [HEADLINE_RESTARTS]: { icon: IconProp.Refresh, color: "amber" },
  [HEADLINE_REQUEST_UNITS]: { icon: IconProp.Scale, color: "violet" },
  [HEADLINE_SESSIONS]: { icon: IconProp.User, color: "sky" },
  [HEADLINE_CAPACITY]: { icon: IconProp.Scale, color: "violet" },
  [HEADLINE_RUNS]: { icon: IconProp.Play, color: "blue" },
  [HEADLINE_FAILED_RUNS]: { icon: IconProp.Alert, color: "rose" },
  [HEADLINE_THROTTLED]: { icon: IconProp.Stop, color: "amber" },
  [HEADLINE_PORTS_USED]: { icon: IconProp.Signal, color: "violet" },
  [HEADLINE_DATA_SIZE]: { icon: IconProp.Database, color: "amber" },
  [HEADLINE_INDEX_SIZE]: { icon: IconProp.QueueList, color: "amber" },
  [HEADLINE_DOCUMENTS]: { icon: IconProp.DocumentText, color: "sky" },
};

const BYTE_UNITS: ReadonlyArray<string> = [
  "B",
  "KiB",
  "MiB",
  "GiB",
  "TiB",
  "PiB",
];

// A size in binary units: one decimal under 10 ("9.6 GiB"), whole from 10 ("12 GiB").
export function formatCloudBytes(
  bytes: number,
  translator: Translator,
): string {
  let value: number = Math.max(0, bytes);
  let index: number = 0;

  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024;
    index++;
  }

  const rounded: number =
    value < 10 ? Math.round(value * 10) / 10 : Math.round(value);

  return `${translator.formatNumber(rounded)}\u00A0${BYTE_UNITS[index]}`;
}

/*
 * A number for a tile: whole from 100, one decimal under it, two under one
 * - "1,240", "37.5", "0.42" - in the reader's numerals.
 */
export function formatCloudAmount(
  value: number,
  translator: Translator,
): string {
  const magnitude: number = Math.abs(value);
  const rounded: number =
    magnitude >= 100
      ? Math.round(value)
      : magnitude >= 1
        ? Math.round(value * 10) / 10
        : Math.round(value * 100) / 100;

  return translator.formatNumber(rounded);
}

/*
 * The decimals formatCloudAmount rounds a figure to: none from a hundred
 * up, one from one up, two under one.
 */
function cloudAmountDecimals(value: number): number {
  const magnitude: number = Math.abs(value);

  return magnitude >= 100 ? 0 : magnitude >= 1 ? 1 : 2;
}

/*
 * A time from seconds: milliseconds under one second ("230 ms"), else "1.8
 * s", "12 min" or "2.5 h" - each unit in the reader's words and digits
 * ("۱٫۸ ثانیه", "12 Min."; issues #7418, #8348).
 */
export function formatCloudSeconds(
  seconds: number,
  translator: Translator,
): string {
  const milliseconds: number = seconds * 1000;

  if (Math.abs(seconds) < 1) {
    return formatMilliseconds(translator, milliseconds, {
      maximumFractionDigits: 0,
    });
  }

  if (Math.abs(seconds) < 120) {
    return formatDurationInUnit(translator, seconds, "second", {
      decimals: cloudAmountDecimals(seconds),
      dropTrailingZeros: true,
    });
  }

  if (Math.abs(seconds) < 2 * 3600) {
    return formatDurationInUnit(translator, seconds / 60, "minute", {
      decimals: 0,
      dropTrailingZeros: true,
    });
  }

  return formatDurationInUnit(translator, seconds / 3600, "hour", {
    decimals: cloudAmountDecimals(seconds / 3600),
    dropTrailingZeros: true,
  });
}

function formatValue(data: {
  format: CloudHeadlineFormat;
  reading: CloudResourceReading;
  periodSeconds: number;
  translator: Translator;
}): { value: string; sublabel?: string | undefined; percent?: number } {
  const value: number = data.reading.value;

  switch (data.format) {
    case "percent": {
      const percent: number = Math.max(0, value);
      return {
        value: `${data.translator.formatNumber(Math.round(percent))}%`,
        percent: Math.min(100, percent),
      };
    }
    case "ratio": {
      const percent: number = Math.max(0, value * 100);
      return {
        value: `${data.translator.formatNumber(Math.round(percent))}%`,
        percent: Math.min(100, percent),
      };
    }
    case "bytes":
      return { value: formatCloudBytes(value, data.translator) };
    case "count":
      return {
        value: data.translator.formatNumber(Math.round(Math.max(0, value))),
      };
    case "seconds":
      return { value: formatCloudSeconds(value, data.translator) };
    case "milliseconds":
      return { value: formatCloudSeconds(value / 1000, data.translator) };
    case "perPeriod":
      return {
        value: formatCloudAmount(
          (Math.max(0, value) * 60) / Math.max(1, data.periodSeconds),
          data.translator,
        ),
        sublabel: PER_MINUTE,
      };
    case "perSecond":
      return {
        value: formatCloudAmount(Math.max(0, value), data.translator),
        sublabel: PER_SECOND,
      };
    case "bytesPerPeriod":
      return {
        value: formatCloudBytes(
          (Math.max(0, value) * 60) / Math.max(1, data.periodSeconds),
          data.translator,
        ),
        sublabel: PER_MINUTE,
      };
    case "bytesPerSecond":
      return {
        value: formatCloudBytes(Math.max(0, value), data.translator),
        sublabel: PER_SECOND,
      };
    case "bitsPerSecond":
      return {
        value: formatCloudBytes(Math.max(0, value) / 8, data.translator),
        sublabel: PER_SECOND,
      };
    default:
      return { value: formatCloudAmount(value, data.translator) };
  }
}

/*
 * The line under a tile's value: what its figure is per ("per minute"),
 * and - for a reading read less often than every read - how old it is,
 * as an age in the reader's words ("12m ago"), the two set apart by " · ".
 */
export function getCloudHeadlineSublabel(data: {
  sublabel: string | undefined;
  ageMs: number | null;
  translator: Translator;
}): string | undefined {
  if (data.ageMs === null) {
    return data.sublabel;
  }

  const age: string = formatMinutesAgo(
    Math.floor(data.ageMs / 60_000),
    data.translator,
  );

  if (!data.sublabel) {
    return age;
  }

  return `${data.translator.translateText(data.sublabel) || data.sublabel} · ${age}`;
}

/*
 * The tiles of a resource of this type, in the catalog's order: one per
 * headline reading the last read kept, and a "Not reported" one for each
 * level every resource of its type reports that the read did not bring -
 * two rows at most. None while its readings are stale: a number from hours
 * ago would read as the resource's now.
 */
export function getCloudHeadlineTiles(data: {
  provider: string;
  type: string;
  readings: CloudResourceReadings;
  hasFreshReadings: boolean;
  translator: Translator;
  // When the page is read: a slow reading's age is said from it.
  now?: Date | undefined;
}): Array<CloudHeadlineTile> {
  if (!data.hasFreshReadings) {
    return [];
  }

  const now: Date = data.now || new Date();

  const tiles: Array<CloudHeadlineTile> = [];

  for (const headline of getCloudHeadlineReadings(data.provider, data.type)) {
    if (tiles.length >= CLOUD_HEADLINE_TILES_MAX) {
      break;
    }

    const found: { key: string; reading: CloudResourceReading } | null =
      getCloudHeadlineReadingOf(headline, data.readings);
    const look: { icon: IconProp; color: CloudHeadlineTile["iconColor"] } =
      ICONS[headline.label] || { icon: IconProp.ChartBar, color: "slate" };

    if (!found) {
      if (headline.needs) {
        // What its cloud needs installed to report it, and where to get it.
        tiles.push({
          key: headline.key,
          title: headline.label,
          value: "",
          valueNote: headline.needs.note,
          description: headline.needs.description,
          link: headline.needs.link,
          icon: look.icon,
          iconColor: "slate",
        });
      } else if (isCloudHeadlineExpected(headline)) {
        tiles.push({
          key: headline.key,
          title: headline.label,
          value: "",
          valueNote: NOT_REPORTED,
          description: NOT_REPORTED_DESCRIPTION,
          icon: look.icon,
          iconColor: "slate",
        });
      }

      continue;
    }
    const formatted: {
      value: string;
      sublabel?: string | undefined;
      percent?: number;
    } = formatValue({
      format: headline.format,
      reading: found.reading,
      periodSeconds: getCloudReadingPeriodSeconds(
        data.provider,
        found.key,
        data.type,
      ),
      translator: data.translator,
    });

    const bar: (typeof BARS)[string] | undefined =
      formatted.percent === undefined ? undefined : BARS[headline.label];

    tiles.push({
      key: headline.key,
      title: headline.label,
      value: formatted.value,
      sublabel: getCloudHeadlineSublabel({
        sublabel: formatted.sublabel,
        ageMs: getCloudReadingAgeMs({
          provider: data.provider,
          type: data.type,
          key: found.key,
          reading: found.reading,
          now,
        }),
        translator: data.translator,
      }),
      percent: formatted.percent,
      higherIsBetter: bar?.higherIsBetter,
      thresholds: bar?.thresholds,
      icon: look.icon,
      iconColor: look.color,
    });
  }

  return tiles;
}

// For tests: what a resource's page leads with, by type.
export function getCloudHeadlineKeys(
  provider: string,
  type: string,
): Array<string> {
  return getCloudHeadlineReadings(provider, type).map(
    (headline: CloudHeadlineReading): string => {
      return headline.key;
    },
  );
}
