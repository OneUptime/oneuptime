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
  ImportedStatusPageGroup,
  ImportedStatusPageResource,
  ImportedStatusPageSubscriber,
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
  cleanEmail,
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
 * BETTER STACK (UPTIME).
 *
 * Reads, with a team's Uptime API token from Better Stack > API tokens >
 * Team-based tokens (an import never writes to Better Stack), through Better
 * Stack's Uptime API v2, documented at
 * https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/:
 *
 *   GET /api/v2/monitors?per_page=&page=          monitors
 *   GET /api/v2/heartbeats?per_page=&page=        heartbeats
 *   GET /api/v2/status-pages?per_page=&page=      status pages
 *   GET /api/v2/status-pages/{id}/sections        a page's sections
 *   GET /api/v2/status-pages/{id}/resources       what a page shows
 *   GET /api/v2/status-pages/{id}/subscribers     a page's email subscribers
 *
 * Auth is `Authorization: Bearer <token>` against incidents.betterstack.com.
 * Lists follow JSON:API: `data` of { id, type, attributes }, paged with
 * `per_page` (at most 250) and `page` (from 1); `pagination.next` says
 * whether there is another page, and is never followed itself.
 *
 * How Better Stack's ideas map:
 *  - Status, expected status code, keyword and keyword absence monitors
 *    are Website monitors (API monitors when they send headers or a body):
 *    a status monitor is up on any 2xx, an expected status code monitor on
 *    the codes it lists. One that warns before its certificate expires also
 *    gets an SSL Certificate monitor.
 *  - Ping is Ping, TCP is Port; SMTP, POP and IMAP are Port monitors on
 *    their port (the preview says OneUptime checks the port only). DNS is a
 *    DNS monitor of the name it queries, asking the server it names.
 *  - Heartbeats are Incoming Request monitors, down once no ping has come
 *    for the period and its grace.
 *  - UDP and Playwright monitors have no OneUptime monitor that does the
 *    same, and are named as left out.
 *  - A status page's sections are its groups, and what it shows its
 *    resources: monitors and heartbeats, and items tracked by hand, which
 *    become manual monitors. Its email subscribers come over (with the
 *    person's word that they may move them) following the same parts.
 */

const PAGE_SIZE: number = 250;

const KEY_ADVICE: string =
  "Check that you copied the whole token, and that it is a team's Uptime API token from Better Stack > API tokens > Team-based tokens.";

// The monitor types that load a web address.
const WEB_TYPES: ReadonlyArray<string> = [
  "status",
  "expected_status_code",
  "keyword",
  "keyword_absence",
];

// Mail protocols, checked as their port.
const MAIL_TYPES: Record<string, string> = {
  smtp: "SMTP",
  pop: "POP3",
  imap: "IMAP",
};

// Monitor types whose request_timeout is in milliseconds, not seconds.
const MILLISECOND_TIMEOUT_TYPES: ReadonlyArray<string> = [
  "ping",
  "tcp",
  "udp",
  "smtp",
  "pop",
  "imap",
];

const UNSUPPORTED_TYPE_NAMES: Record<string, string> = {
  udp: "UDP",
  playwright: "Playwright",
};

const UNDERSCORES: RegExp = /_/g;

// Every source id is prefixed with its kind of record: their ids may meet.
export const BETTER_STACK_MONITOR_PREFIX: string = "monitor-";
export const BETTER_STACK_HEARTBEAT_PREFIX: string = "heartbeat-";
export const BETTER_STACK_ITEM_PREFIX: string = "item-";

interface PagedRead {
  records: Array<Record<string, unknown>>;
  hasMore: boolean;
}

export default class BetterStackAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.BetterStack;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.BetterStack,
    );

    try {
      await context.onProgress?.(ToolImportResourceKind.Monitor);

      const monitorList: PagedRead = await this.readPaged(
        client,
        "/api/v2/monitors",
      );
      const heartbeatList: PagedRead = await this.readPaged(
        client,
        "/api/v2/heartbeats",
      );

      const monitors: Array<ImportedMonitor> = [];
      const certificates: Array<ImportedMonitor> = [];

      for (const raw of monitorList.records) {
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

      for (const raw of heartbeatList.records) {
        const heartbeat: ImportedMonitor | null = this.toHeartbeat(raw);

        if (heartbeat) {
          monitors.push(heartbeat);
        }
      }

      snapshot.accountName =
        asString(
          asRecord(asRecord(monitorList.records[0])["attributes"])["team_name"],
        ) || undefined;

      await context.onProgress?.(ToolImportResourceKind.StatusPage);

      const pages: Array<{
        statusPage: ImportedStatusPage;
        items: Array<ImportedMonitor>;
        subscribers: Array<ImportedStatusPageSubscriber>;
      }> = await readOptionalList({
        kind: ToolImportResourceKind.StatusPage,
        notes: snapshot.notes,
        read: async () => {
          const list: PagedRead = await this.readPaged(
            client,
            "/api/v2/status-pages",
          );

          const read: Array<{
            statusPage: ImportedStatusPage;
            items: Array<ImportedMonitor>;
            subscribers: Array<ImportedStatusPageSubscriber>;
          }> = [];

          for (const page of capRecords({
            kind: ToolImportResourceKind.StatusPage,
            records: list.records,
            notes: snapshot.notes,
            hasMore: list.hasMore,
          })) {
            read.push(await this.readStatusPage(client, page, snapshot.notes));
          }

          return read;
        },
      });

      // Items tracked by hand become manual monitors, after the checks.
      const items: Array<ImportedMonitor> = pages.flatMap(
        (page: { items: Array<ImportedMonitor> }): Array<ImportedMonitor> => {
          return page.items;
        },
      );

      snapshot.monitors = capRecords({
        kind: ToolImportResourceKind.Monitor,
        records: [...monitors, ...items, ...certificates],
        notes: snapshot.notes,
        hasMore: monitorList.hasMore || heartbeatList.hasMore,
      });

      snapshot.statusPages = pages.map(
        (page: { statusPage: ImportedStatusPage }): ImportedStatusPage => {
          return page.statusPage;
        },
      );

      await context.onProgress?.(ToolImportResourceKind.StatusPageSubscriber);

      snapshot.statusPageSubscribers = capRecords({
        kind: ToolImportResourceKind.StatusPageSubscriber,
        records: pages.flatMap(
          (page: {
            subscribers: Array<ImportedStatusPageSubscriber>;
          }): Array<ImportedStatusPageSubscriber> => {
            return page.subscribers;
          },
        ),
        notes: snapshot.notes,
      });
    } catch (error) {
      throw toFatalReadError({
        error: error,
        toolName: "Better Stack",
        keyAdvice: KEY_ADVICE,
      });
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  /*
   * Every record of a list: `per_page` and `page` in, `data` and
   * `pagination.next` out. Stops at the last page, at an empty one, and
   * once it holds the records one read collects.
   */
  private async readPaged(
    client: ToolImportHttpClient,
    path: string,
  ): Promise<PagedRead> {
    const records: Array<Record<string, unknown>> = [];

    for (let page: number = 1; ; page++) {
      const body: Record<string, unknown> = asRecord(
        await client.getJson(path, { per_page: PAGE_SIZE, page: page }),
      );
      const data: Array<unknown> = asArray(body["data"]);
      records.push(...data.map(asRecord));

      if (data.length === 0 || !asString(asRecord(body["pagination"])["next"])) {
        return { records: records, hasMore: false };
      }

      if (records.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND) {
        return { records: records, hasMore: true };
      }
    }
  }

  public toMonitor(raw: Record<string, unknown>): ImportedMonitor | null {
    const id: string = asString(raw["id"]);

    if (!id) {
      return null;
    }

    const attributes: Record<string, unknown> = asRecord(raw["attributes"]);
    const sourceId: string = `${BETTER_STACK_MONITOR_PREFIX}${id}`;
    const type: string = asString(attributes["monitor_type"]).toLowerCase();
    const url: string = asString(attributes["url"]);
    const name: string = cleanName(
      attributes["pronounceable_name"],
      url || `Monitor ${id}`,
    );
    const intervalSeconds: number | undefined =
      asNumber(attributes["check_frequency"]) || undefined;
    const rawTimeout: number | null = asNumber(attributes["request_timeout"]);
    const timeoutSeconds: number | undefined = rawTimeout
      ? MILLISECOND_TIMEOUT_TYPES.includes(type)
        ? rawTimeout / 1000
        : rawTimeout
      : undefined;
    const isPaused: boolean =
      Boolean(asString(attributes["paused_at"])) ||
      asString(attributes["status"]).toLowerCase() === "paused";

    if (WEB_TYPES.includes(type)) {
      const keyword: string = asString(attributes["required_keyword"]);
      const isKeyword: boolean =
        (type === "keyword" || type === "keyword_absence") && Boolean(keyword);

      return toHttpMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: type.replace(UNDERSCORES, " "),
        url: url,
        method: asString(attributes["http_method"]) || "GET",
        headers: asArray(attributes["request_headers"]).map(
          (header: unknown) => {
            return {
              name: asString(asRecord(header)["name"]),
              value: asString(asRecord(header)["value"]),
            };
          },
        ),
        body: asString(attributes["request_body"]) || undefined,
        followRedirects: asBoolean(attributes["follow_redirects"], true),
        timeoutSeconds: timeoutSeconds,
        intervalSeconds: intervalSeconds,
        // A status monitor is up on a 2xx; the others on the codes they list.
        acceptedStatusCodes:
          type === "expected_status_code"
            ? readStatusCodeRanges(asArray(attributes["expected_status_codes"]))
            : type === "status"
              ? [{ from: 200, to: 299 }]
              : undefined,
        keyword: isKeyword
          ? {
              value: keyword,
              isPresent: type === "keyword",
              isCaseSensitive: true,
            }
          : undefined,
        signsIn: Boolean(asString(attributes["auth_username"])),
        isPaused: isPaused,
      });
    }

    if (type === "ping") {
      return this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "ping",
        monitorType: MonitorType.Ping,
        destination: url,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
    }

    if (type === "tcp" || MAIL_TYPES[type]) {
      const monitor: ImportedMonitor = this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: MAIL_TYPES[type] || "TCP",
        monitorType: MonitorType.Port,
        destination: url,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
      // A mail check may list several ports ("25, 465"): the first is checked.
      monitor.port =
        asNumber(asString(attributes["port"]).split(",")[0]) || undefined;
      monitor.timeoutSeconds = timeoutSeconds;

      if (MAIL_TYPES[type]) {
        monitor.notes.push(
          makeToolImportNote(ToolImportNoteCode.MonitorChecksPortOnly, {
            protocol: MAIL_TYPES[type]!,
          }),
        );
      }

      return monitor;
    }

    if (type === "dns") {
      // The name to look up is the request body; the url is the server to ask.
      const monitor: ImportedMonitor = this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "DNS",
        monitorType: MonitorType.DNS,
        destination: asString(attributes["request_body"]),
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });

      if (url) {
        monitor.dnsServer = url;
      }

      if (asString(attributes["required_keyword"])) {
        monitor.notes.push(
          makeToolImportNote(ToolImportNoteCode.MonitorDnsAnswersLeftOut),
        );
      }

      return monitor;
    }

    return toUnsupportedMonitor({
      sourceId: sourceId,
      name: name,
      sourceType: UNSUPPORTED_TYPE_NAMES[type] || type || "unknown",
      destination: url || undefined,
    });
  }

  public toHeartbeat(raw: Record<string, unknown>): ImportedMonitor | null {
    const id: string = asString(raw["id"]);

    if (!id) {
      return null;
    }

    const attributes: Record<string, unknown> = asRecord(raw["attributes"]);
    const isPaused: boolean =
      Boolean(asString(attributes["paused_at"])) ||
      asString(attributes["status"]).toLowerCase() === "paused";
    const notes: Array<ToolImportNote> = [
      makeToolImportNote(ToolImportNoteCode.MonitorNewHeartbeatAddress),
    ];

    if (isPaused) {
      notes.push(makeToolImportNote(ToolImportNoteCode.MonitorPaused));
    }

    return {
      sourceId: `${BETTER_STACK_HEARTBEAT_PREFIX}${id}`,
      name: cleanName(attributes["name"], `Heartbeat ${id}`),
      sourceType: "heartbeat",
      monitorType: MonitorType.IncomingRequest,
      intervalSeconds: asNumber(attributes["period"]) || undefined,
      heartbeatTimeoutSeconds:
        (asNumber(attributes["period"]) || 0) +
          (asNumber(attributes["grace"]) || 0) || undefined,
      isPaused: isPaused,
      notes: notes,
    };
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

  // A web monitor that warns before its certificate expires.
  private toCertificate(
    raw: Record<string, unknown>,
    monitor: ImportedMonitor,
  ): ImportedMonitor | null {
    const attributes: Record<string, unknown> = asRecord(raw["attributes"]);
    const days: number = asNumber(attributes["ssl_expiration"]) || 0;

    if (
      days < 1 ||
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
      warningDays: days,
      intervalSeconds: monitor.intervalSeconds,
      isPaused: monitor.isPaused,
    });
  }

  /*
   * A status page with its sections, what it shows and its subscribers.
   * Items it tracks by hand come back as manual monitors of their own.
   */
  private async readStatusPage(
    client: ToolImportHttpClient,
    raw: Record<string, unknown>,
    notes: Array<ToolImportNote>,
  ): Promise<{
    statusPage: ImportedStatusPage;
    items: Array<ImportedMonitor>;
    subscribers: Array<ImportedStatusPageSubscriber>;
  }> {
    const id: string = asString(raw["id"]);
    const base: string = `/api/v2/status-pages/${encodeURIComponent(id)}`;

    const sections: PagedRead = await this.readPaged(
      client,
      `${base}/sections`,
    );
    const resources: PagedRead = await this.readPaged(
      client,
      `${base}/resources`,
    );
    // A page whose subscribers the token may not read is said once.
    const subscriberNotes: Array<ToolImportNote> = [];
    const subscribers: Array<Record<string, unknown>> = (
      await readOptionalList<Record<string, unknown>>({
        kind: ToolImportResourceKind.StatusPageSubscriber,
        notes: subscriberNotes,
        read: async (): Promise<Array<Record<string, unknown>>> => {
          return (await this.readPaged(client, `${base}/subscribers`)).records;
        },
      })
    ).filter((subscriber: Record<string, unknown>): boolean => {
      return Boolean(asString(subscriber["id"]));
    });

    for (const note of subscriberNotes) {
      if (
        !notes.some((existing: ToolImportNote): boolean => {
          return JSON.stringify(existing) === JSON.stringify(note);
        })
      ) {
        notes.push(note);
      }
    }

    return this.toStatusPage({
      page: raw,
      sections: sections.records,
      resources: resources.records,
      subscribers: subscribers,
    });
  }

  public toStatusPage(data: {
    page: Record<string, unknown>;
    sections: Array<Record<string, unknown>>;
    resources: Array<Record<string, unknown>>;
    subscribers: Array<Record<string, unknown>>;
  }): {
    statusPage: ImportedStatusPage;
    items: Array<ImportedMonitor>;
    subscribers: Array<ImportedStatusPageSubscriber>;
  } {
    const id: string = asString(data.page["id"]);
    const attributes: Record<string, unknown> = asRecord(
      data.page["attributes"],
    );
    const name: string = cleanName(
      attributes["company_name"],
      `Status page ${id}`,
    );
    const notes: Array<ToolImportNote> = [];

    const groups: Array<ImportedStatusPageGroup> = [...data.sections]
      .sort(byPosition)
      .map((section: Record<string, unknown>): ImportedStatusPageGroup => {
        return {
          key: asString(section["id"]),
          name: cleanName(
            asRecord(section["attributes"])["name"],
            "Services",
          ),
        };
      })
      .filter((group: ImportedStatusPageGroup): boolean => {
        return Boolean(group.key);
      });

    const items: Array<ImportedMonitor> = [];
    const resources: Array<ImportedStatusPageResource> = [];

    for (const raw of [...data.resources].sort(byPosition)) {
      const resource: Record<string, unknown> = asRecord(raw["attributes"]);
      const key: string = asString(raw["id"]);
      const resourceId: string = asString(resource["resource_id"]);
      const type: string = asString(resource["resource_type"]);
      const displayName: string = cleanName(
        resource["public_name"],
        `Resource ${key}`,
      );

      let monitorSourceId: string | null = null;

      if (type === "Monitor") {
        monitorSourceId = `${BETTER_STACK_MONITOR_PREFIX}${resourceId}`;
      } else if (type === "Heartbeat") {
        monitorSourceId = `${BETTER_STACK_HEARTBEAT_PREFIX}${resourceId}`;
      } else if (type === "ManuallyTrackedItem") {
        monitorSourceId = `${BETTER_STACK_ITEM_PREFIX}${id}-${key}`;
        items.push({
          sourceId: monitorSourceId,
          name: displayName,
          sourceType: "manually tracked item",
          monitorType: MonitorType.Manual,
          isPaused: false,
          notes: [],
        });
      }

      if (!key || !resourceId || !monitorSourceId) {
        notes.push(
          makeToolImportNote(ToolImportNoteCode.StatusPageResourceNotSupported, {
            name: displayName,
          }),
        );
        continue;
      }

      const widget: string = asString(resource["widget_type"]).toLowerCase();
      const sectionId: string = asString(resource["status_page_section_id"]);

      resources.push({
        key: key,
        monitorSourceId: monitorSourceId,
        groupKey: groups.some((group: ImportedStatusPageGroup): boolean => {
          return group.key === sectionId;
        })
          ? sectionId
          : undefined,
        displayName: displayName,
        displayDescription: asString(resource["explanation"]) || undefined,
        showUptimePercent: widget !== "plain",
        showStatusHistoryChart: widget !== "plain",
      });
    }

    const isPasswordEnabled: boolean = attributes["password_enabled"] === true;
    const hasIpAllowlist: boolean =
      asArray(attributes["ip_allowlist"]).length > 0;

    if (isPasswordEnabled || hasIpAllowlist) {
      notes.push(makeToolImportNote(ToolImportNoteCode.StatusPagePrivate));
    }

    const customDomain: string = asString(attributes["custom_domain"]);

    if (customDomain) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.StatusPageCustomDomain, {
          domain: customDomain,
        }),
      );
    }

    if (
      asString(attributes["logo_url"]) ||
      asString(attributes["dark_logo_url"]) ||
      asString(attributes["custom_css"])
    ) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.StatusPageBrandingLeftOut),
      );
    }

    const subscribers: Array<ImportedStatusPageSubscriber> = [];

    for (const raw of data.subscribers) {
      const subscriber: Record<string, unknown> = asRecord(raw["attributes"]);
      const email: string | null = cleanEmail(subscriber["email"]);

      if (!email) {
        continue;
      }

      const imported: ImportedStatusPageSubscriber = {
        sourceId: asString(raw["id"]),
        email: email,
        statusPageSourceId: id,
        resourceKeys: asArray(subscriber["status_page_resource_ids"])
          .map(asString)
          .filter(Boolean),
        notes: [],
      };

      if (!asString(subscriber["confirmed_at"])) {
        imported.skipReason = makeToolImportNote(
          ToolImportNoteCode.SubscriberNotConfirmed,
        );
      }

      subscribers.push(imported);
    }

    const statusPage: ImportedStatusPage = {
      sourceId: id,
      name: name,
      pageTitle: name,
      isPublic: !isPasswordEnabled && !hasIpAllowlist,
      historyDays: asNumber(attributes["history"]) || undefined,
      allowsEmailSubscribers: asBoolean(attributes["subscribable"], false),
      allowsSubscribersToChooseResources: subscribers.some(
        (subscriber: ImportedStatusPageSubscriber): boolean => {
          return subscriber.resourceKeys.length > 0;
        },
      ),
      isHiddenFromSearchEngines: attributes["hide_from_search_engines"] === true,
      groups: groups,
      resources: resources,
      notes: notes,
    };

    return { statusPage: statusPage, items: items, subscribers: subscribers };
  }
}

function byPosition(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  return (
    (asNumber(asRecord(a["attributes"])["position"]) || 0) -
    (asNumber(asRecord(b["attributes"])["position"]) || 0)
  );
}
