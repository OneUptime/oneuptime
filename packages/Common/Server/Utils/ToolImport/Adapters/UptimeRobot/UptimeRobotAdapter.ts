import DnsRecordType from "../../../../../Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import { TOOL_IMPORT_MAX_RECORDS_PER_KIND } from "../../../../../Types/ToolImport/ToolImportLimits";
import {
  intervalNotes,
  toCertificateMonitor,
  toHttpMonitor,
  toUnsupportedMonitor,
} from "../../../../../Types/ToolImport/ToolImportMonitorMapping";
import { readStatusCodeRanges } from "../../../../../Types/ToolImport/ToolImportMonitorRules";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../../Types/ToolImport/ToolImportResourceKind";
import {
  getEmptyToolImportSnapshot,
  ImportedMonitor,
  ImportedStatusPage,
  ImportedStatusPageResource,
  ToolImportSnapshot,
} from "../../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../../Types/ToolImport/ToolImportSource";
import ToolImportHttpClient from "../../ToolImportHttpClient";
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  capRecords,
  cleanName,
  createToolImportClient,
  readOptionalList,
  toFatalReadError,
} from "../../ToolImportAdapterSupport";
import {
  ToolImportAdapter,
  ToolImportReadContext,
  ToolImportReadSettings,
} from "../../Types";

/*
 * UPTIMEROBOT.
 *
 * Reads, with an API key from Integrations & API > API (the Read-only API
 * key is enough - an import never writes to UptimeRobot), through
 * UptimeRobot's v3 REST API, documented at https://uptimerobot.com/api/v3/
 * and in its OpenAPI definition:
 *
 *   GET /v3/user/me                     the account, for the preview's title
 *   GET /v3/monitors?limit=&cursor=     monitors
 *   GET /v3/psps?limit=&cursor=         public status pages
 *   GET /v3/maintenance-windows?...     maintenance windows (only counted)
 *
 * Auth is `Authorization: Bearer <key>` against api.uptimerobot.com. Lists
 * are cursor paged: `limit` (at most 200) and `cursor` - the last item's id
 * - in, `nextLink` out (null on the last page). The next link itself is
 * never followed: the cursor is sent to the same fixed path. A Free account
 * may make ten requests a minute, so reads are paced at one every six
 * seconds (ToolImportCatalog).
 *
 * How UptimeRobot's ideas map:
 *  - HTTP and Keyword monitors are Website monitors (API monitors when they
 *    send headers or a body), with the same status codes for "up" and the
 *    keyword where it should be. One that warns before its certificate
 *    expires also gets an SSL Certificate monitor.
 *  - Ping and Port monitors are Ping and Port monitors; a Port monitor that
 *    alerts while its port is open is the other way round from OneUptime's,
 *    and is left out.
 *  - Heartbeat monitors are Incoming Request monitors, down once no ping
 *    has come for the interval and its grace period.
 *  - DNS and API monitors are DNS and API monitors, without the answers
 *    and assertions they check (named in the preview).
 *  - UDP, visual comparison and dependency monitors have no OneUptime
 *    monitor that does the same, and are named as left out.
 *  - A public status page shows the same monitors - all of them, those it
 *    names, or those carrying its tags.
 */

const PAGE_SIZE: number = 200;

const KEY_ADVICE: string =
  "Check that you copied the whole key, and that it is the account's Main or Read-only API key from Integrations & API, not a monitor-specific one.";

// UptimeRobot's monitor types.
const TYPE_HTTP: string = "HTTP";
const TYPE_KEYWORD: string = "KEYWORD";
const TYPE_PING: string = "PING";
const TYPE_PORT: string = "PORT";
const TYPE_HEARTBEAT: string = "HEARTBEAT";
const TYPE_DNS: string = "DNS";
const TYPE_API: string = "API";

// The words the preview uses for the types OneUptime has no monitor for.
const UNSUPPORTED_TYPE_NAMES: Record<string, string> = {
  UDP: "UDP",
  VISUAL_COMPARISON: "visual comparison",
  DEPENDENCY: "dependency",
};

// keywordCaseType: 0 is case sensitive, 1 is not.
const KEYWORD_CASE_INSENSITIVE: number = 1;

const DNS_RECORD_TYPES: ReadonlyArray<string> = Object.values(DnsRecordType);

interface PagedRead {
  records: Array<unknown>;
  hasMore: boolean;
}

export default class UptimeRobotAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.UptimeRobot;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.UptimeRobot,
    );

    try {
      const user: Record<string, unknown> = asRecord(
        await client.getJson("/v3/user/me"),
      );
      snapshot.accountName = asString(user["email"]) || undefined;

      await context.onProgress?.(ToolImportResourceKind.Monitor);

      const monitorList: PagedRead = await this.readPaged(
        client,
        "/v3/monitors",
      );
      const rawMonitors: Array<Record<string, unknown>> = capRecords({
        kind: ToolImportResourceKind.Monitor,
        records: monitorList.records.map(asRecord),
        notes: snapshot.notes,
        hasMore: monitorList.hasMore,
      });

      snapshot.monitors = this.toMonitors(rawMonitors);

      await context.onProgress?.(ToolImportResourceKind.StatusPage);

      snapshot.statusPages = await readOptionalList<ImportedStatusPage>({
        kind: ToolImportResourceKind.StatusPage,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedStatusPage>> => {
          const psps: PagedRead = await this.readPaged(client, "/v3/psps");

          return capRecords({
            kind: ToolImportResourceKind.StatusPage,
            records: psps.records.map((psp: unknown): ImportedStatusPage => {
              return this.toStatusPage(asRecord(psp), rawMonitors);
            }),
            notes: snapshot.notes,
            hasMore: psps.hasMore,
          });
        },
      });

      const windows: number = await this.countMaintenanceWindows(client);

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
        toolName: "UptimeRobot",
        keyAdvice: KEY_ADVICE,
      });
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  /*
   * Every record of a cursor-paged list: `limit` and `cursor` (the last
   * record's id) in, `data` and `nextLink` out. Stops at the last page, at
   * a page that comes back empty or does not move the cursor on, and once
   * it holds the records one read collects - `hasMore` then says there
   * were more, for capRecords' note.
   */
  private async readPaged(
    client: ToolImportHttpClient,
    path: string,
  ): Promise<PagedRead> {
    const records: Array<unknown> = [];
    let cursor: string | undefined = undefined;

    for (;;) {
      const body: Record<string, unknown> = asRecord(
        await client.getJson(path, { limit: PAGE_SIZE, cursor: cursor }),
      );
      const page: Array<unknown> = asArray(body["data"]);
      records.push(...page);

      const lastId: string = asString(asRecord(page[page.length - 1])["id"]);

      if (
        page.length === 0 ||
        !asString(body["nextLink"]) ||
        !lastId ||
        lastId === cursor
      ) {
        return { records: records, hasMore: false };
      }

      if (records.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND) {
        return { records: records, hasMore: true };
      }

      cursor = lastId;
    }
  }

  private async countMaintenanceWindows(
    client: ToolImportHttpClient,
  ): Promise<number> {
    try {
      return (await this.readPaged(client, "/v3/maintenance-windows")).records
        .length;
    } catch {
      // Only a count for a note: a list the key may not read says nothing.
      return 0;
    }
  }

  // Every monitor, and an SSL Certificate monitor after the ones that warn.
  public toMonitors(
    rawMonitors: Array<Record<string, unknown>>,
  ): Array<ImportedMonitor> {
    const monitors: Array<ImportedMonitor> = [];
    const certificates: Array<ImportedMonitor> = [];

    for (const raw of rawMonitors) {
      const monitor: ImportedMonitor | null = this.toMonitor(raw);

      if (!monitor) {
        continue;
      }

      monitors.push(monitor);

      const certificate: ImportedMonitor | null = this.toCertificate(
        raw,
        monitor,
      );

      if (certificate) {
        certificates.push(certificate);
      }
    }

    // Certificates last, so the plan's room goes to the checks first.
    return [...monitors, ...certificates];
  }

  public toMonitor(raw: Record<string, unknown>): ImportedMonitor | null {
    const sourceId: string = asString(raw["id"]);

    if (!sourceId) {
      return null;
    }

    const type: string = asString(raw["type"]).toUpperCase();
    const name: string = cleanName(raw["friendlyName"], `Monitor ${sourceId}`);
    const url: string = asString(raw["url"]);
    const intervalSeconds: number | undefined =
      asNumber(raw["interval"]) || undefined;
    const isPaused: boolean =
      asString(raw["status"]).toUpperCase() === "PAUSED";

    if (type === TYPE_HTTP || type === TYPE_KEYWORD || type === TYPE_API) {
      return this.toWebMonitor({
        raw: raw,
        sourceId: sourceId,
        name: name,
        type: type,
        url: url,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
    }

    if (type === TYPE_PING) {
      return this.simpleMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "ping",
        monitorType: MonitorType.Ping,
        destination: url,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
    }

    if (type === TYPE_PORT) {
      if (asString(raw["portAlertCondition"]).toUpperCase() === "OPEN") {
        return toUnsupportedMonitor({
          sourceId: sourceId,
          name: name,
          sourceType: "port",
          destination: url,
          skipReason: makeToolImportNote(ToolImportNoteCode.MonitorUpsideDown),
        });
      }

      const monitor: ImportedMonitor = this.simpleMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "port",
        monitorType: MonitorType.Port,
        destination: url,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
      monitor.port = asNumber(raw["port"]) || undefined;
      monitor.timeoutSeconds = asNumber(raw["timeout"]) || undefined;
      return monitor;
    }

    if (type === TYPE_HEARTBEAT) {
      const grace: number = asNumber(raw["gracePeriod"]) || 0;
      const monitor: ImportedMonitor = this.simpleMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "heartbeat",
        monitorType: MonitorType.IncomingRequest,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
        // A heartbeat is not checked on an interval: it waits to be pinged.
        isChecked: false,
      });
      monitor.heartbeatTimeoutSeconds = (intervalSeconds || 0) + grace;
      monitor.notes.push(
        makeToolImportNote(ToolImportNoteCode.MonitorNewHeartbeatAddress),
      );
      return monitor;
    }

    if (type === TYPE_DNS) {
      const records: Record<string, unknown> = asRecord(
        asRecord(raw["config"])["dnsRecords"],
      );
      const recordType: string | undefined = Object.keys(records).find(
        (key: string): boolean => {
          return (
            DNS_RECORD_TYPES.includes(key.toUpperCase()) &&
            asArray(records[key]).length > 0
          );
        },
      );

      const monitor: ImportedMonitor = this.simpleMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "DNS",
        monitorType: MonitorType.DNS,
        destination: url,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });

      if (recordType) {
        monitor.dnsRecordType = recordType.toUpperCase() as DnsRecordType;
        monitor.notes.push(
          makeToolImportNote(ToolImportNoteCode.MonitorDnsAnswersLeftOut),
        );
      }

      return monitor;
    }

    return toUnsupportedMonitor({
      sourceId: sourceId,
      name: name,
      sourceType:
        UNSUPPORTED_TYPE_NAMES[type] || type.toLowerCase() || "unknown",
      destination: url || undefined,
    });
  }

  private toWebMonitor(data: {
    raw: Record<string, unknown>;
    sourceId: string;
    name: string;
    type: string;
    url: string;
    intervalSeconds: number | undefined;
    isPaused: boolean;
  }): ImportedMonitor {
    const raw: Record<string, unknown> = data.raw;
    const notes: Array<ToolImportNote> = [];
    const headers: Array<{ name: string; value: string }> = Object.entries(
      asRecord(raw["customHttpHeaders"]),
    ).map(([name, value]: [string, unknown]) => {
      return { name: name, value: asString(value) };
    });

    // A request body: raw JSON is one; key-value form data is not.
    let body: string | undefined = undefined;
    const postValue: unknown = raw["postValueData"];

    if (postValue !== null && postValue !== undefined && postValue !== "") {
      body =
        asString(raw["postValueType"]).toUpperCase() === "RAW_JSON"
          ? typeof postValue === "string"
            ? postValue
            : JSON.stringify(postValue)
          : "form";
    }

    const authType: string = asString(raw["authType"]).toUpperCase();

    const hasAssertions: boolean =
      data.type === TYPE_API &&
      asArray(asRecord(asRecord(raw["config"])["apiAssertions"])["checks"])
        .length > 0;

    if (hasAssertions) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.MonitorAssertionsLeftOut),
      );
    }

    const keywordValue: string = asString(raw["keywordValue"]);
    const isKeyword: boolean =
      data.type === TYPE_KEYWORD && Boolean(keywordValue);
    const isCaseInsensitive: boolean =
      asNumber(raw["keywordCaseType"]) === KEYWORD_CASE_INSENSITIVE;

    if (isKeyword && isCaseInsensitive) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.MonitorKeywordCaseSensitive),
      );
    }

    return toHttpMonitor({
      sourceId: data.sourceId,
      name: data.name,
      sourceType: data.type === TYPE_API ? "API" : data.type.toLowerCase(),
      url: data.url,
      method: asString(raw["httpMethodType"]) || "GET",
      headers: headers,
      body: body,
      followRedirects: asBoolean(raw["followRedirections"], true),
      timeoutSeconds: asNumber(raw["timeout"]) || undefined,
      intervalSeconds: data.intervalSeconds,
      acceptedStatusCodes: readStatusCodeRanges(
        asArray(raw["successHttpResponseCodes"]),
      ),
      keyword: isKeyword
        ? {
            value: keywordValue,
            // UptimeRobot alerts when the keyword is (or is not) there.
            isPresent:
              asString(raw["keywordType"]).toUpperCase() === "ALERT_NOT_EXISTS",
            isCaseSensitive: !isCaseInsensitive,
          }
        : undefined,
      signsIn:
        Boolean(asString(raw["httpUsername"])) ||
        (Boolean(authType) && authType !== "NONE"),
      isPaused: data.isPaused,
      notes: notes,
    });
  }

  private simpleMonitor(data: {
    sourceId: string;
    name: string;
    sourceType: string;
    monitorType: MonitorType;
    destination?: string | undefined;
    intervalSeconds: number | undefined;
    isPaused: boolean;
    // False for a monitor no probe checks on an interval (a heartbeat).
    isChecked?: boolean | undefined;
  }): ImportedMonitor {
    const notes: Array<ToolImportNote> =
      data.isChecked === false ? [] : intervalNotes(data.intervalSeconds);

    if (data.isPaused) {
      notes.push(makeToolImportNote(ToolImportNoteCode.MonitorPaused));
    }

    const monitor: ImportedMonitor = {
      sourceId: data.sourceId,
      name: data.name,
      sourceType: data.sourceType,
      monitorType: data.monitorType,
      intervalSeconds: data.intervalSeconds,
      isPaused: data.isPaused,
      notes: notes,
    };

    if (data.destination) {
      monitor.destination = data.destination;
    }

    return monitor;
  }

  /*
   * The SSL Certificate monitor of a web monitor that warns before its
   * certificate expires, as many days ahead as its first reminder.
   */
  private toCertificate(
    raw: Record<string, unknown>,
    monitor: ImportedMonitor,
  ): ImportedMonitor | null {
    if (
      (monitor.monitorType !== MonitorType.Website &&
        monitor.monitorType !== MonitorType.API) ||
      raw["sslExpirationReminder"] !== true ||
      !monitor.destination
    ) {
      return null;
    }

    const days: Array<number> = asArray(
      asRecord(raw["config"])["sslExpirationPeriodDays"],
    )
      .map((value: unknown): number | null => {
        return asNumber(value);
      })
      .filter((value: number | null): value is number => {
        return value !== null && value > 0;
      });

    return toCertificateMonitor({
      sourceId: monitor.sourceId,
      name: monitor.name,
      url: monitor.destination,
      warningDays: days.length > 0 ? Math.max(...days) : undefined,
      intervalSeconds: monitor.intervalSeconds,
      isPaused: monitor.isPaused,
    });
  }

  /*
   * A public status page, showing the monitors it names - or those
   * carrying its tags, or, naming neither, every monitor - in the order
   * the page names them, or the account's.
   */
  public toStatusPage(
    psp: Record<string, unknown>,
    rawMonitors: Array<Record<string, unknown>>,
  ): ImportedStatusPage {
    const sourceId: string = asString(psp["id"]);
    const name: string = cleanName(
      psp["friendlyName"],
      `Status page ${sourceId}`,
    );
    const named: Array<string> = asArray(psp["monitorIds"])
      .map(asString)
      .filter(Boolean);
    const tagIds: Array<string> = asArray(psp["tagIds"])
      .map(asString)
      .filter(Boolean);

    const shown: Array<Record<string, unknown>> = rawMonitors.filter(
      (monitor: Record<string, unknown>): boolean => {
        if (named.length > 0) {
          return named.includes(asString(monitor["id"]));
        }

        if (tagIds.length > 0) {
          return asArray(monitor["tags"]).some((tag: unknown): boolean => {
            return tagIds.includes(asString(asRecord(tag)["id"]));
          });
        }

        return true;
      },
    );

    if (named.length > 0) {
      shown.sort(
        (a: Record<string, unknown>, b: Record<string, unknown>): number => {
          return (
            named.indexOf(asString(a["id"])) - named.indexOf(asString(b["id"]))
          );
        },
      );
    }

    const features: Record<string, unknown> = asRecord(
      asRecord(psp["customSettings"])["features"],
    );

    const resources: Array<ImportedStatusPageResource> = shown.map(
      (monitor: Record<string, unknown>): ImportedStatusPageResource => {
        const monitorId: string = asString(monitor["id"]);

        return {
          key: monitorId,
          monitorSourceId: monitorId,
          displayName: cleanName(
            monitor["friendlyName"],
            `Monitor ${monitorId}`,
          ),
          // "true"/"false" in a page as read; true/false in one as written.
          showUptimePercent: asBoolean(features["showUptimePercentage"], true),
          showStatusHistoryChart: asBoolean(features["showBars"], true),
        };
      },
    );

    const notes: Array<ToolImportNote> = [];
    const isPasswordSet: boolean = psp["isPasswordSet"] === true;
    const customDomain: string = asString(psp["customDomain"]);

    if (isPasswordSet) {
      notes.push(makeToolImportNote(ToolImportNoteCode.StatusPagePrivate));
    }

    if (customDomain) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.StatusPageCustomDomain, {
          domain: customDomain,
        }),
      );
    }

    if (asString(psp["logo"]) || asString(psp["icon"])) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.StatusPageBrandingLeftOut),
      );
    }

    return {
      sourceId: sourceId,
      name: name,
      pageTitle: name,
      isPublic: !isPasswordSet,
      allowsEmailSubscribers: psp["subscription"] === true,
      isHiddenFromSearchEngines: psp["noIndex"] === true,
      groups: [],
      resources: resources,
      notes: notes,
    };
  }
}
