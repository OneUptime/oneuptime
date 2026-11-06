import {
  CloudHeadlineFormat,
  CloudHeadlineReading,
  CloudResourceReading,
  CloudResourceReadings,
  HEADLINE_AVAILABILITY,
  HEADLINE_CONNECTIONS,
  HEADLINE_CPU,
  HEADLINE_DURATION,
  HEADLINE_ERRORS,
  HEADLINE_FREE_STORAGE,
  HEADLINE_INVOCATIONS,
  HEADLINE_LATENCY,
  HEADLINE_MEMORY,
  HEADLINE_MESSAGES_WAITING,
  HEADLINE_OLDEST_MESSAGE,
  HEADLINE_REQUESTS,
  HEADLINE_RESPONSE_TIME,
  HEADLINE_SERVER_LOAD,
  HEADLINE_STORAGE_USED,
  HEADLINE_UNHEALTHY_HOSTS,
  getCloudHeadlineReadings,
  getCloudReadingPeriodSeconds,
} from "Common/Types/Cloud/CloudResourceHealth";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

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
 * React-free (the page maps these to its tiles), so App tests can read it.
 */

export const PER_MINUTE: string = translationKey("per minute");
export const PER_SECOND: string = translationKey("per second");

export interface CloudHeadlineTile {
  key: string;
  // English, looked up in the reader's language by the tile.
  title: string;
  value: string;
  sublabel?: string | undefined;
  // For a percent: the tile's bar.
  percent?: number | null | undefined;
  icon: IconProp;
  iconColor: "blue" | "violet" | "amber" | "emerald" | "slate" | "sky" | "rose";
}

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

  return `${translator.formatNumber(rounded)} ${BYTE_UNITS[index]}`;
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

// A time from seconds: milliseconds under one second ("230 ms"), else "1.8 s".
export function formatCloudSeconds(
  seconds: number,
  translator: Translator,
): string {
  if (Math.abs(seconds) < 1) {
    return `${translator.formatNumber(Math.round(seconds * 1000))} ms`;
  }

  if (Math.abs(seconds) < 120) {
    return `${formatCloudAmount(seconds, translator)} s`;
  }

  if (Math.abs(seconds) < 2 * 3600) {
    return `${translator.formatNumber(Math.round(seconds / 60))} min`;
  }

  return `${formatCloudAmount(seconds / 3600, translator)} h`;
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
    default:
      return { value: formatCloudAmount(value, data.translator) };
  }
}

/*
 * The tiles of a resource of this type, in the catalog's order: one per
 * headline reading the last read kept. None while its readings are stale -
 * a number from hours ago would read as the resource's now.
 */
export function getCloudHeadlineTiles(data: {
  provider: string;
  type: string;
  readings: CloudResourceReadings;
  hasFreshReadings: boolean;
  translator: Translator;
}): Array<CloudHeadlineTile> {
  if (!data.hasFreshReadings) {
    return [];
  }

  const tiles: Array<CloudHeadlineTile> = [];

  for (const headline of getCloudHeadlineReadings(data.provider, data.type)) {
    const reading: CloudResourceReading | undefined =
      data.readings[headline.key];

    if (!reading) {
      continue;
    }

    const look: { icon: IconProp; color: CloudHeadlineTile["iconColor"] } =
      ICONS[headline.label] || { icon: IconProp.ChartBar, color: "slate" };
    const formatted: {
      value: string;
      sublabel?: string | undefined;
      percent?: number;
    } = formatValue({
      format: headline.format,
      reading,
      periodSeconds: getCloudReadingPeriodSeconds(data.provider, headline.key),
      translator: data.translator,
    });

    tiles.push({
      key: headline.key,
      title: headline.label,
      value: formatted.value,
      sublabel: formatted.sublabel,
      percent: formatted.percent,
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
