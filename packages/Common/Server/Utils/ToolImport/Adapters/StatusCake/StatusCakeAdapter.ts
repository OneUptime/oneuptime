import MonitorType from "../../../../../Types/Monitor/MonitorType";
import { TOOL_IMPORT_MAX_RECORDS_PER_KIND } from "../../../../../Types/ToolImport/ToolImportLimits";
import {
  certificateMonitorName,
  intervalNotes,
  toCertificateMonitor,
  toHttpMonitor,
  toUnsupportedMonitor,
} from "../../../../../Types/ToolImport/ToolImportMonitorMapping";
import {
  invertStatusCodeRanges,
  readStatusCodeRanges,
} from "../../../../../Types/ToolImport/ToolImportMonitorRules";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../../Types/ToolImport/ToolImportResourceKind";
import {
  getEmptyToolImportSnapshot,
  ImportedMonitor,
  ImportedStatusCodeRange,
  ToolImportSnapshot,
} from "../../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../../Types/ToolImport/ToolImportSource";
import ToolImportHttpClient, {
  ToolImportHttpError,
  ToolImportHttpErrorKind,
} from "../../ToolImportHttpClient";
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  capRecords,
  cleanName,
  createToolImportClient,
  isListNotAvailable,
  toFatalReadError,
} from "../../ToolImportAdapterSupport";
import {
  ToolImportAdapter,
  ToolImportReadContext,
  ToolImportReadSettings,
} from "../../Types";

/*
 * STATUSCAKE.
 *
 * Reads, with an API key from StatusCake's account panel (an import never
 * writes to StatusCake), through StatusCake's API v1, documented at
 * https://developers.statuscake.com/api/:
 *
 *   GET /v1/uptime?page=&limit=         uptime checks (an overview each)
 *   GET /v1/uptime/{id}                 one uptime check's settings (not
 *                                       for a ping check: its overview
 *                                       is all there is to it)
 *   GET /v1/ssl?page=&limit=            SSL certificate checks
 *   GET /v1/heartbeat?page=&limit=      heartbeat checks
 *   GET /v1/maintenance-windows?...     maintenance windows (only counted)
 *
 * Auth is `Authorization: Bearer <key>` against api.statuscake.com. Lists
 * are paged with `page` (from 1) and `limit` (at most 100), and
 * `metadata.page_count` says how many pages there are. A Free account may
 * make 60 requests a minute, so reads are paced at one a second.
 *
 * How StatusCake's checks map:
 *  - HTTP and HEAD checks are Website monitors (API monitors when they
 *    post data or send headers), with the text the page should (or should
 *    not) contain. StatusCake lists the status codes that raise an alert;
 *    every other code counts as up. One that alerts before its certificate
 *    expires also gets an SSL Certificate monitor.
 *  - TCP is Port, PING is Ping, DNS is DNS (without the addresses it
 *    expects, which the preview names); SMTP and SSH are Port monitors on
 *    their port (the preview says OneUptime checks the port only).
 *  - SSL checks are SSL Certificate monitors, warning as far ahead as the
 *    first alert; heartbeat checks are Incoming Request monitors.
 */

const PAGE_SIZE: number = 100;

const KEY_ADVICE: string =
  "Check that you copied the whole key, and that it is an API key from your StatusCake account panel.";

// Each source id is prefixed with its kind of check: their ids may meet.
export const STATUSCAKE_UPTIME_PREFIX: string = "uptime-";
export const STATUSCAKE_SSL_PREFIX: string = "ssl-";
export const STATUSCAKE_HEARTBEAT_PREFIX: string = "heartbeat-";

// The port a check that names none listens on.
const DEFAULT_PORTS: Record<string, number> = {
  SMTP: 25,
  SSH: 22,
};

// A check rate of 0 checks constantly: as often as OneUptime can.
const CONSTANT_CHECK_SECONDS: number = 60;

const URL_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;
const PATH_AND_AFTER: RegExp = /[/?#].*$/;
// "host:port" with one colon: an IPv6 address has more.
const HOST_AND_PORT: RegExp = /^([^:]+):\d{1,5}$/;

interface PagedRead {
  records: Array<Record<string, unknown>>;
  hasMore: boolean;
}

export default class StatusCakeAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.StatusCake;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.StatusCake,
    );

    try {
      await context.onProgress?.(ToolImportResourceKind.Monitor);

      const uptime: PagedRead = await this.readPaged(client, "/v1/uptime");
      const monitors: Array<ImportedMonitor> = [];
      const certificates: Array<ImportedMonitor> = [];

      for (const overview of capRecords({
        kind: ToolImportResourceKind.Monitor,
        records: uptime.records,
        notes: snapshot.notes,
        hasMore: uptime.hasMore,
      })) {
        const test: Record<string, unknown> | null = await this.readUptimeTest(
          client,
          overview,
        );

        if (!test) {
          continue;
        }

        const monitor: ImportedMonitor = this.toUptimeMonitor(test);

        monitors.push(monitor);

        const certificate: ImportedMonitor | null = this.toCertificate(
          test,
          monitor,
        );

        if (certificate) {
          certificates.push(certificate);
        }
      }

      const sslTests: Array<Record<string, unknown>> = await this.readOptional(
        client,
        "/v1/ssl",
      );
      const heartbeats: Array<Record<string, unknown>> =
        await this.readOptional(client, "/v1/heartbeat");

      snapshot.monitors = [
        ...monitors,
        ...heartbeats
          .map((test: Record<string, unknown>): ImportedMonitor | null => {
            return this.toHeartbeatMonitor(test);
          })
          .filter((monitor: ImportedMonitor | null): monitor is ImportedMonitor => {
            return Boolean(monitor);
          }),
        ...sslTests
          .map((test: Record<string, unknown>): ImportedMonitor | null => {
            return this.toSslMonitor(test);
          })
          .filter((monitor: ImportedMonitor | null): monitor is ImportedMonitor => {
            return Boolean(monitor);
          }),
        ...certificates,
      ];

      const windows: number = (
        await this.readOptional(client, "/v1/maintenance-windows")
      ).length;

      if (windows > 0) {
        snapshot.notes.push(
          makeToolImportNote(ToolImportNoteCode.MaintenanceWindowsNotRead, {
            count: windows,
          }),
        );
      }
    } catch (error) {
      throw toFatalReadError({
        error: error,
        toolName: "StatusCake",
        keyAdvice: KEY_ADVICE,
      });
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  /*
   * Every record of a list: `page` and `limit` in, `data` and
   * `metadata.page_count` out. Stops at the last page, at an empty one,
   * and once it holds the records one read collects.
   */
  private async readPaged(
    client: ToolImportHttpClient,
    path: string,
  ): Promise<PagedRead> {
    const records: Array<Record<string, unknown>> = [];

    for (let page: number = 1; ; page++) {
      const body: Record<string, unknown> = asRecord(
        await client.getJson(path, { page: page, limit: PAGE_SIZE }),
      );
      const data: Array<unknown> = asArray(body["data"]);
      records.push(...data.map(asRecord));

      const pageCount: number =
        asNumber(asRecord(body["metadata"])["page_count"]) || 1;

      if (data.length === 0 || page >= pageCount) {
        return { records: records, hasMore: false };
      }

      if (records.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND) {
        return { records: records, hasMore: true };
      }
    }
  }

  /*
   * One uptime check with its settings. A ping check's overview says all
   * there is to it; any other check's settings are read on their own,
   * one request each. Null for a check without an id, or one deleted since
   * the list was read.
   */
  private async readUptimeTest(
    client: ToolImportHttpClient,
    overview: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const id: string = asString(overview["id"]);

    if (!id) {
      return null;
    }

    if (asString(overview["test_type"]).toUpperCase() === "PING") {
      return overview;
    }

    try {
      const detail: Record<string, unknown> = asRecord(
        asRecord(await client.getJson(`/v1/uptime/${encodeURIComponent(id)}`))[
          "data"
        ],
      );

      return { ...overview, ...detail };
    } catch (error) {
      if (
        error instanceof ToolImportHttpError &&
        error.kind === ToolImportHttpErrorKind.NotFound
      ) {
        return null;
      }

      throw error;
    }
  }

  // A list the key or the plan may not read is an empty one.
  private async readOptional(
    client: ToolImportHttpClient,
    path: string,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      return (await this.readPaged(client, path)).records;
    } catch (error) {
      if (isListNotAvailable(error)) {
        return [];
      }

      throw error;
    }
  }

  public toUptimeMonitor(test: Record<string, unknown>): ImportedMonitor {
    const id: string = asString(test["id"]);
    const sourceId: string = `${STATUSCAKE_UPTIME_PREFIX}${id}`;
    const type: string = asString(test["test_type"]).toUpperCase();
    const address: string = asString(test["website_url"]);
    const name: string = cleanName(test["name"], address || `Check ${id}`);
    const rate: number | null = asNumber(test["check_rate"]);
    const intervalSeconds: number | undefined =
      rate === 0 ? CONSTANT_CHECK_SECONDS : rate || undefined;
    const isPaused: boolean = asBoolean(test["paused"], false);

    if (type === "HTTP" || type === "HEAD") {
      return this.toWebMonitor({
        test: test,
        sourceId: sourceId,
        name: name,
        type: type,
        url: address,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
    }

    const host: string = toHost(address);

    if (type === "PING") {
      return this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "PING",
        monitorType: MonitorType.Ping,
        destination: host,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
    }

    if (type === "TCP" || type === "SMTP" || type === "SSH") {
      const monitor: ImportedMonitor = this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: type,
        monitorType: MonitorType.Port,
        destination: host,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
      monitor.port =
        asNumber(test["port"]) || DEFAULT_PORTS[type] || undefined;
      monitor.timeoutSeconds = asNumber(test["timeout"]) || undefined;

      if (type !== "TCP") {
        monitor.notes.push(
          makeToolImportNote(ToolImportNoteCode.MonitorChecksPortOnly, {
            protocol: type,
          }),
        );
      }

      return monitor;
    }

    if (type === "DNS") {
      const monitor: ImportedMonitor = this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "DNS",
        monitorType: MonitorType.DNS,
        destination: host,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });

      const server: string = asString(test["dns_server"]);

      if (server) {
        monitor.dnsServer = server;
      }

      if (asArray(test["dns_ips"]).length > 0) {
        monitor.notes.push(
          makeToolImportNote(ToolImportNoteCode.MonitorDnsAnswersLeftOut),
        );
      }

      return monitor;
    }

    return toUnsupportedMonitor({
      sourceId: sourceId,
      name: name,
      sourceType: type || "unknown",
      destination: address || undefined,
    });
  }

  private toWebMonitor(data: {
    test: Record<string, unknown>;
    sourceId: string;
    name: string;
    type: string;
    url: string;
    intervalSeconds: number | undefined;
    isPaused: boolean;
  }): ImportedMonitor {
    const test: Record<string, unknown> = data.test;
    const postBody: string = asString(test["post_body"]);
    const postRaw: string = asString(test["post_raw"]);
    const findString: string = asString(test["find_string"]);

    // The codes that raise an alert; every other code counts as up.
    const alerting: Array<ImportedStatusCodeRange> = readStatusCodeRanges(
      asArray(test["status_codes"]),
    );

    return toHttpMonitor({
      sourceId: data.sourceId,
      name: data.name,
      sourceType: data.type,
      url: data.url,
      method:
        data.type === "HEAD" ? "HEAD" : postBody || postRaw ? "POST" : "GET",
      headers: this.readHeaders(test["custom_header"]),
      body: postBody || postRaw || undefined,
      followRedirects: asBoolean(test["follow_redirects"], false),
      timeoutSeconds: asNumber(test["timeout"]) || undefined,
      intervalSeconds: data.intervalSeconds,
      acceptedStatusCodes:
        alerting.length > 0 ? invertStatusCodeRanges(alerting) : undefined,
      keyword: findString
        ? {
            value: findString,
            isPresent: !asBoolean(test["do_not_find"], false),
            isCaseSensitive: true,
          }
        : undefined,
      isPaused: data.isPaused,
    });
  }

  // custom_header is a JSON object, written as a string.
  private readHeaders(value: unknown): Array<{ name: string; value: string }> {
    let headers: unknown = value;

    if (typeof value === "string") {
      try {
        headers = JSON.parse(value);
      } catch {
        return [];
      }
    }

    return Object.entries(asRecord(headers)).map(
      ([name, headerValue]: [string, unknown]) => {
        return { name: name, value: asString(headerValue) };
      },
    );
  }

  private plainMonitor(data: {
    sourceId: string;
    name: string;
    sourceType: string;
    monitorType: MonitorType;
    destination: string;
    intervalSeconds: number | undefined;
    isPaused: boolean;
  }): ImportedMonitor {
    const notes: Array<ToolImportNote> = intervalNotes(data.intervalSeconds);

    if (data.isPaused) {
      notes.push(makeToolImportNote(ToolImportNoteCode.MonitorPaused));
    }

    return {
      sourceId: data.sourceId,
      name: data.name,
      sourceType: data.sourceType,
      monitorType: data.monitorType,
      destination: data.destination,
      intervalSeconds: data.intervalSeconds,
      isPaused: data.isPaused,
      notes: notes,
    };
  }

  // An HTTP check that alerts before its certificate expires.
  private toCertificate(
    test: Record<string, unknown>,
    monitor: ImportedMonitor,
  ): ImportedMonitor | null {
    if (
      test["enable_ssl_alert"] !== true ||
      !monitor.destination ||
      (monitor.monitorType !== MonitorType.Website &&
        monitor.monitorType !== MonitorType.API)
    ) {
      return null;
    }

    return toCertificateMonitor({
      sourceId: monitor.sourceId,
      name: monitor.name,
      url: monitor.destination,
      intervalSeconds: monitor.intervalSeconds,
      isPaused: monitor.isPaused,
    });
  }

  // An SSL check: an SSL Certificate monitor warning as far ahead as its first alert.
  public toSslMonitor(test: Record<string, unknown>): ImportedMonitor | null {
    const id: string = asString(test["id"]);
    const address: string = asString(test["website_url"]);
    // A certificate is read over https, whether or not the address says so.
    const url: string =
      !address || URL_SCHEME.test(address) ? address : `https://${address}`;

    if (!id) {
      return null;
    }

    const days: Array<number> = asArray(test["alert_at"])
      .map((value: unknown): number | null => {
        return asNumber(value);
      })
      .filter((value: number | null): value is number => {
        return value !== null && value > 0;
      });
    const isPaused: boolean = asBoolean(test["paused"], false);
    const intervalSeconds: number | undefined =
      asNumber(test["check_rate"]) || undefined;
    const notes: Array<ToolImportNote> = intervalNotes(intervalSeconds);

    if (isPaused) {
      notes.push(makeToolImportNote(ToolImportNoteCode.MonitorPaused));
    }

    const monitor: ImportedMonitor = {
      sourceId: `${STATUSCAKE_SSL_PREFIX}${id}`,
      name: certificateMonitorName(toHost(url) || `SSL check ${id}`),
      sourceType: "SSL",
      monitorType: MonitorType.SSLCertificate,
      destination: url,
      intervalSeconds: intervalSeconds,
      isPaused: isPaused,
      notes: notes,
    };

    if (days.length > 0) {
      monitor.certificateExpiryWarningDays = Math.max(...days);
    }

    return monitor;
  }

  public toHeartbeatMonitor(
    test: Record<string, unknown>,
  ): ImportedMonitor | null {
    const id: string = asString(test["id"]);

    if (!id) {
      return null;
    }

    const isPaused: boolean = asBoolean(test["paused"], false);
    const period: number | undefined = asNumber(test["period"]) || undefined;
    const notes: Array<ToolImportNote> = [
      makeToolImportNote(ToolImportNoteCode.MonitorNewHeartbeatAddress),
    ];

    if (isPaused) {
      notes.push(makeToolImportNote(ToolImportNoteCode.MonitorPaused));
    }

    return {
      sourceId: `${STATUSCAKE_HEARTBEAT_PREFIX}${id}`,
      name: cleanName(test["name"], `Heartbeat ${id}`),
      sourceType: "heartbeat",
      monitorType: MonitorType.IncomingRequest,
      intervalSeconds: period,
      heartbeatTimeoutSeconds: period,
      isPaused: isPaused,
      notes: notes,
    };
  }
}

/*
 * The host of a check's address, whether it was written as a URL or not:
 * no scheme, path or port ("ssh://bastion.example.com:22/" is
 * "bastion.example.com"). An IPv6 address keeps its colons.
 */
export function toHost(address: string): string {
  const host: string = address
    .trim()
    .replace(URL_SCHEME, "")
    .replace(PATH_AND_AFTER, "");
  const withPort: RegExpMatchArray | null = host.match(HOST_AND_PORT);

  return withPort ? withPort[1]! : host;
}
