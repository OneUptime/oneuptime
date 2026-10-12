import HTTPMethod from "../API/HTTPMethod";
import MonitorType from "../Monitor/MonitorType";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "./ToolImportNote";
import {
  readJsonObjectBody,
  splitRequestHeaders,
  TOOL_IMPORT_MAX_TIMEOUT_SECONDS,
  ToolImportHeaderSplit,
  toMonitoringInterval,
} from "./ToolImportMonitorRules";
import {
  ImportedKeyword,
  ImportedMonitor,
  ImportedStatusCodeRange,
} from "./ToolImportSnapshot";

/*
 * THE WAY EVERY UPTIME TOOL'S WEB CHECK BECOMES A MONITOR.
 *
 * UptimeRobot, Pingdom, Better Stack, StatusCake and Uptime Kuma all have a
 * check that loads a web address and looks at the answer. Each adapter
 * reads its tool's fields into an HttpCheckInput, and this decides the rest
 * the same way for all of them:
 *
 *  - A plain GET (or HEAD) with no headers and no body is a Website
 *    monitor; anything more - another method, headers, a body, or an
 *    answer read as JSON - is an API monitor, which sends them.
 *  - Headers that may hold a secret are left out and named; a body is sent
 *    only when it is a JSON object, the only body an API monitor sends.
 *  - Passwords are never copied: a check that signs in says so.
 *  - The interval and timeout OneUptime cannot match exactly are said.
 */

export interface HttpCheckHeader {
  name: string;
  value: string;
}

export interface HttpCheckInput {
  sourceId: string;
  name: string;
  description?: string | undefined;
  sourceType: string;
  url: string;
  // The tool's method, any case; none: GET.
  method?: string | undefined;
  headers?: Array<HttpCheckHeader> | undefined;
  body?: string | undefined;
  followRedirects?: boolean | undefined;
  timeoutSeconds?: number | undefined;
  intervalSeconds?: number | undefined;
  acceptedStatusCodes?: Array<ImportedStatusCodeRange> | undefined;
  keyword?: ImportedKeyword | undefined;
  // The check signs in with a user name and password (never copied).
  signsIn?: boolean | undefined;
  /*
   * The check reads the answer as JSON (an API check with assertions, a
   * JSON query): an API monitor, whatever its method, so the criteria that
   * replace its assertions read the same JSON.
   */
  readsJson?: boolean | undefined;
  isPaused: boolean;
  // Notes the adapter adds about its tool's own settings.
  notes?: Array<ToolImportNote> | undefined;
}

const KNOWN_METHODS: ReadonlyArray<HTTPMethod> = [
  HTTPMethod.GET,
  HTTPMethod.HEAD,
  HTTPMethod.POST,
  HTTPMethod.PUT,
  HTTPMethod.PATCH,
  HTTPMethod.DELETE,
];

export function readHttpMethod(value: unknown): HTTPMethod {
  const upper: string =
    typeof value === "string" ? value.trim().toUpperCase() : "";

  return (KNOWN_METHODS as ReadonlyArray<string>).includes(upper)
    ? (upper as HTTPMethod)
    : HTTPMethod.GET;
}

export function toHttpMonitor(input: HttpCheckInput): ImportedMonitor {
  const notes: Array<ToolImportNote> = [...(input.notes || [])];
  const method: HTTPMethod = readHttpMethod(input.method);
  const headers: ToolImportHeaderSplit = splitRequestHeaders(
    input.headers || [],
  );

  for (const name of headers.leftOut) {
    notes.push(
      makeToolImportNote(ToolImportNoteCode.MonitorHeaderLeftOut, {
        header: name,
      }),
    );
  }

  if (input.signsIn) {
    notes.push(makeToolImportNote(ToolImportNoteCode.MonitorSignInLeftOut));
  }

  let body: string | undefined = undefined;

  if (
    input.body &&
    input.body.trim() &&
    method !== HTTPMethod.GET &&
    method !== HTTPMethod.HEAD
  ) {
    body = readJsonObjectBody(input.body) || undefined;

    if (!body) {
      notes.push(makeToolImportNote(ToolImportNoteCode.MonitorBodyLeftOut));
    }
  }

  const hasHeaders: boolean = Object.keys(headers.kept).length > 0;
  const isPlainLoad: boolean =
    (method === HTTPMethod.GET || method === HTTPMethod.HEAD) &&
    !hasHeaders &&
    !body;

  notes.push(...intervalNotes(input.intervalSeconds));
  notes.push(...timeoutNotes(input.timeoutSeconds));

  if (input.isPaused) {
    notes.push(makeToolImportNote(ToolImportNoteCode.MonitorPaused));
  }

  const monitor: ImportedMonitor = {
    sourceId: input.sourceId,
    name: input.name,
    sourceType: input.sourceType,
    monitorType:
      isPlainLoad && !input.readsJson ? MonitorType.Website : MonitorType.API,
    destination: input.url,
    httpMethod: method,
    followRedirects: input.followRedirects,
    timeoutSeconds: input.timeoutSeconds,
    intervalSeconds: input.intervalSeconds,
    isPaused: input.isPaused,
    notes: notes,
  };

  if (input.description) {
    monitor.description = input.description;
  }

  if (!isPlainLoad) {
    if (hasHeaders) {
      monitor.requestHeaders = headers.kept;
    }

    if (body) {
      monitor.requestBody = body;
    }
  }

  if (input.acceptedStatusCodes && input.acceptedStatusCodes.length > 0) {
    monitor.acceptedStatusCodes = input.acceptedStatusCodes;
  }

  if (input.keyword && input.keyword.value) {
    monitor.keyword = input.keyword;

    // A keyword needs the page itself: HEAD brings no body to look in.
    if (monitor.httpMethod === HTTPMethod.HEAD) {
      monitor.httpMethod = HTTPMethod.GET;
    }
  }

  return monitor;
}

/*
 * An SSL Certificate monitor for a web check whose tool also warns before
 * its certificate expires - OneUptime watches certificates with a monitor
 * of their own. Null for an address that is not https.
 */
export function toCertificateMonitor(data: {
  sourceId: string;
  name: string;
  url: string;
  warningDays?: number | undefined;
  intervalSeconds?: number | undefined;
  isPaused: boolean;
}): ImportedMonitor | null {
  if (!data.url.trim().toLowerCase().startsWith("https://")) {
    return null;
  }

  const monitor: ImportedMonitor = {
    sourceId: `${data.sourceId}:certificate`,
    name: certificateMonitorName(data.name),
    sourceType: "certificate",
    monitorType: MonitorType.SSLCertificate,
    destination: data.url,
    // A certificate changes rarely: no more often than the web check.
    intervalSeconds: Math.max(data.intervalSeconds || 0, 60 * 60),
    isPaused: data.isPaused,
    notes: data.isPaused
      ? [makeToolImportNote(ToolImportNoteCode.MonitorPaused)]
      : [],
  };

  if (data.warningDays && data.warningDays > 0) {
    monitor.certificateExpiryWarningDays = data.warningDays;
  }

  return monitor;
}

// "<name> certificate", cut so the name fits the column.
export function certificateMonitorName(name: string): string {
  const suffix: string = " certificate";
  const room: number = 100 - suffix.length;

  return `${name.length > room ? name.slice(0, room).trim() : name}${suffix}`;
}

/*
 * The note for a check OneUptime cannot run at the same pace: faster than
 * once a minute, or between two of the intervals OneUptime offers.
 */
export function intervalNotes(
  seconds: number | undefined,
): Array<ToolImportNote> {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return [];
  }

  const oneUptime: number = toMonitoringInterval(seconds).seconds;

  return oneUptime === Math.round(seconds)
    ? []
    : [
        makeToolImportNote(ToolImportNoteCode.MonitorIntervalChanged, {
          every: Math.round(seconds),
          oneUptimeEvery: oneUptime,
        }),
      ];
}

// The note for a check that waits longer for an answer than OneUptime does.
export function timeoutNotes(
  seconds: number | undefined,
): Array<ToolImportNote> {
  return seconds && seconds > TOOL_IMPORT_MAX_TIMEOUT_SECONDS
    ? [
        makeToolImportNote(ToolImportNoteCode.MonitorTimeoutShortened, {
          timeout: Math.round(seconds),
        }),
      ]
    : [];
}

// A check OneUptime has no monitor for, named so the preview can say so.
export function toUnsupportedMonitor(data: {
  sourceId: string;
  name: string;
  sourceType: string;
  destination?: string | undefined;
  skipReason?: ToolImportNote | undefined;
}): ImportedMonitor {
  const monitor: ImportedMonitor = {
    sourceId: data.sourceId,
    name: data.name,
    sourceType: data.sourceType,
    monitorType: null,
    isPaused: false,
    notes: [],
  };

  if (data.destination) {
    monitor.destination = data.destination;
  }

  if (data.skipReason) {
    monitor.skipReason = data.skipReason;
  }

  return monitor;
}
