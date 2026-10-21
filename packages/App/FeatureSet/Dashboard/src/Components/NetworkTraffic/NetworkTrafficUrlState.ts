import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import {
  NetworkTrafficFilters,
  NetworkTrafficFiltersUtil,
} from "Common/Types/NetFlow/NetworkTraffic";
import NetworkFlowApplicationUtil from "Common/Types/NetFlow/NetworkFlowApplication";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a Traffic page is showing - its time range and the filters a click on
 * a row added - kept in the URL, so a link to a page lands on exactly that
 * view, and a reload keeps it.
 *
 * The query string is untrusted input: anything unreadable drops to its
 * default (the past hour, no filter) rather than failing the page.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

export const NETWORK_TRAFFIC_DEFAULT_RANGE: TimeRange = TimeRange.PAST_ONE_HOUR;

export const NETWORK_TRAFFIC_URL_PARAMS: Array<string> = [
  "range",
  "start",
  "end",
  "src",
  "dst",
  "host",
  "proto",
  "port",
  "if",
  "device",
  "exporter",
];

export interface NetworkTrafficViewState {
  range: RangeStartAndEndDateTime;
  filters: NetworkTrafficFilters;
}

export function getDefaultNetworkTrafficView(): NetworkTrafficViewState {
  return {
    range: { range: NETWORK_TRAFFIC_DEFAULT_RANGE },
    filters: {},
  };
}

function readRange(
  read: (name: string) => string | null,
): RangeStartAndEndDateTime {
  const range: string | null = read("range");

  if (range === TimeRange.CUSTOM) {
    const start: Date = new Date(read("start") || "");
    const end: Date = new Date(read("end") || "");

    if (
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()) &&
      start.getTime() < end.getTime()
    ) {
      return {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      };
    }

    return { range: NETWORK_TRAFFIC_DEFAULT_RANGE };
  }

  if (range && (Object.values(TimeRange) as Array<string>).includes(range)) {
    return { range: range as TimeRange };
  }

  return { range: NETWORK_TRAFFIC_DEFAULT_RANGE };
}

/*
 * One filter value from the URL, checked the way the server checks it;
 * anything it would refuse is dropped here instead of failing the page.
 */
function readFilters(
  read: (name: string) => string | null,
): NetworkTrafficFilters {
  const filters: NetworkTrafficFilters = {};

  const candidates: Array<[keyof NetworkTrafficFilters, string, boolean]> = [
    ["sourceIp", "src", false],
    ["destinationIp", "dst", false],
    ["hostIp", "host", false],
    ["exporterIp", "exporter", false],
    ["networkDeviceId", "device", false],
    ["protocolNumber", "proto", true],
    ["port", "port", true],
    ["interfaceIndex", "if", true],
  ];

  for (const [field, param, isNumber] of candidates) {
    const raw: string | null = read(param);

    if (raw === null || raw === "") {
      continue;
    }

    try {
      const one: NetworkTrafficFilters = NetworkTrafficFiltersUtil.sanitize({
        [field]: isNumber ? Number(raw) : raw,
      });

      Object.assign(filters, one);
    } catch {
      // Not a value the server would take: left out.
    }
  }

  return filters;
}

export function readNetworkTrafficView(
  read: (name: string) => string | null,
): NetworkTrafficViewState {
  return {
    range: readRange(read),
    filters: readFilters(read),
  };
}

/*
 * The params to write for a view: a default is written as null, so it
 * leaves the URL instead of filling it.
 */
export function toNetworkTrafficUrlParams(
  view: NetworkTrafficViewState,
): Dictionary<string | null> {
  const isCustom: boolean =
    view.range.range === TimeRange.CUSTOM &&
    Boolean(view.range.startAndEndDate);
  const filters: NetworkTrafficFilters = view.filters;

  const text: (value: string | number | undefined) => string | null = (
    value: string | number | undefined,
  ): string | null => {
    return value === undefined || value === "" ? null : String(value);
  };

  return {
    range:
      view.range.range === NETWORK_TRAFFIC_DEFAULT_RANGE
        ? null
        : view.range.range,
    start: isCustom
      ? view.range.startAndEndDate!.startValue.toISOString()
      : null,
    end: isCustom ? view.range.startAndEndDate!.endValue.toISOString() : null,
    src: text(filters.sourceIp),
    dst: text(filters.destinationIp),
    host: text(filters.hostIp),
    proto: text(filters.protocolNumber),
    port: text(filters.port),
    if: text(filters.interfaceIndex),
    device: text(filters.networkDeviceId),
    exporter: text(filters.exporterIp),
  };
}

// ---- Filters, as the chips over the page say them -----------------------------

export type NetworkTrafficFilterKind =
  | "source"
  | "destination"
  | "host"
  | "application"
  | "interface"
  | "device"
  | "exporter";

export const FILTER_SOURCE_LABEL: string = translationKey("From {{address}}");
export const FILTER_DESTINATION_LABEL: string =
  translationKey("To {{address}}");
export const FILTER_HOST_LABEL: string = translationKey(
  "To or from {{address}}",
);
export const FILTER_APPLICATION_LABEL: string = translationKey(
  "Application {{application}}",
);
export const FILTER_INTERFACE_LABEL: string = translationKey(
  "Through {{interface}}",
);
export const FILTER_DEVICE_LABEL: string = translationKey("Device {{device}}");
export const FILTER_EXPORTER_LABEL: string = translationKey(
  "Sent by {{address}}",
);

export interface NetworkTrafficFilterChip {
  kind: NetworkTrafficFilterKind;
  // An English template (translated where it is drawn) and its values.
  template: string;
  values: Dictionary<string | number>;
}

/*
 * The chips for the filters that are set, in the order a reader narrows a
 * page: who (device, exporter), through what (interface), between whom
 * (from, to, either), for what (application). `names` turns ids into the
 * names the page already knows.
 */
export function getNetworkTrafficFilterChips(
  filters: NetworkTrafficFilters,
  names: {
    deviceName?: string | undefined;
    interfaceName?: string | undefined;
    applicationName?: string | undefined;
  },
): Array<NetworkTrafficFilterChip> {
  const chips: Array<NetworkTrafficFilterChip> = [];

  if (filters.networkDeviceId) {
    chips.push({
      kind: "device",
      template: FILTER_DEVICE_LABEL,
      values: { device: names.deviceName || filters.networkDeviceId },
    });
  }

  if (filters.exporterIp) {
    chips.push({
      kind: "exporter",
      template: FILTER_EXPORTER_LABEL,
      values: { address: filters.exporterIp },
    });
  }

  if (filters.interfaceIndex !== undefined) {
    chips.push({
      kind: "interface",
      template: FILTER_INTERFACE_LABEL,
      values: {
        interface: names.interfaceName || `#${filters.interfaceIndex}`,
      },
    });
  }

  if (filters.sourceIp) {
    chips.push({
      kind: "source",
      template: FILTER_SOURCE_LABEL,
      values: { address: filters.sourceIp },
    });
  }

  if (filters.destinationIp) {
    chips.push({
      kind: "destination",
      template: FILTER_DESTINATION_LABEL,
      values: { address: filters.destinationIp },
    });
  }

  if (filters.hostIp) {
    chips.push({
      kind: "host",
      template: FILTER_HOST_LABEL,
      values: { address: filters.hostIp },
    });
  }

  if (filters.protocolNumber !== undefined || filters.port !== undefined) {
    chips.push({
      kind: "application",
      template: FILTER_APPLICATION_LABEL,
      values: {
        application:
          names.applicationName ||
          [filters.protocolNumber, filters.port]
            .filter((value: number | undefined): boolean => {
              return value !== undefined;
            })
            .join("/"),
      },
    });
  }

  return chips;
}

// The filters without one kind (the chip's x).
export function withoutNetworkTrafficFilter(
  filters: NetworkTrafficFilters,
  kind: NetworkTrafficFilterKind,
): NetworkTrafficFilters {
  const next: NetworkTrafficFilters = { ...filters };

  switch (kind) {
    case "source":
      delete next.sourceIp;
      break;
    case "destination":
      delete next.destinationIp;
      break;
    case "host":
      delete next.hostIp;
      break;
    case "application":
      delete next.protocolNumber;
      delete next.port;
      break;
    case "interface":
      delete next.interfaceIndex;
      break;
    case "device":
      delete next.networkDeviceId;
      break;
    case "exporter":
      delete next.exporterIp;
      break;
  }

  return next;
}

/*
 * The filters after a click on an application row: the protocol, and its
 * service port when it has ports (ICMP has none to filter on).
 */
export function withApplicationFilter(
  filters: NetworkTrafficFilters,
  protocolNumber: number,
  port: number,
): NetworkTrafficFilters {
  const next: NetworkTrafficFilters = {
    ...filters,
    protocolNumber: protocolNumber,
  };

  if (NetworkFlowApplicationUtil.hasPorts(protocolNumber) && port > 0) {
    next.port = port;
  } else {
    delete next.port;
  }

  return next;
}
