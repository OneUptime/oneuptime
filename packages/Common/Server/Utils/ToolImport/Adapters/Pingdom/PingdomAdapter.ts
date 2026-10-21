import MonitorType from "../../../../../Types/Monitor/MonitorType";
import {
  intervalNotes,
  toCertificateMonitor,
  toHttpMonitor,
  toUnsupportedMonitor,
} from "../../../../../Types/ToolImport/ToolImportMonitorMapping";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../../Types/ToolImport/ToolImportResourceKind";
import {
  getEmptyToolImportSnapshot,
  ImportedMonitor,
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
 * PINGDOM.
 *
 * Reads, with an API token from My Pingdom > Settings > Pingdom API (one
 * with Read access is enough - an import never writes to Pingdom), through
 * Pingdom's API 3.1, documented at https://docs.pingdom.com/api/ and in its
 * OpenAPI definition (API_3.1.yaml):
 *
 *   GET /api/3.1/checks?include_tags=true&showencryption=true
 *                                       every uptime check, in one answer
 *   GET /api/3.1/checks/{checkid}       one check's settings: its path,
 *                                       port, keyword, headers
 *   GET /api/3.1/tms/check              transaction checks (only named)
 *   GET /api/3.1/maintenance            maintenance windows (only counted)
 *
 * Auth is `Authorization: Bearer <token>` against api.pingdom.com. Pingdom
 * counts every request against the token's hourly allowance, so a check's
 * settings are read only for the checks that have any (a ping check has
 * none beyond its host), one request at a time.
 *
 * How Pingdom's checks map:
 *  - HTTP checks are Website monitors (API monitors when they post data or
 *    send headers), with the text the page should (or should not) contain.
 *    One that treats an expiring certificate as down also gets an SSL
 *    Certificate monitor, warning that many days ahead.
 *  - TCP checks are Port monitors; SMTP, POP3 and IMAP checks are Port
 *    monitors on their port, and the preview says OneUptime checks the port,
 *    not the conversation on it.
 *  - Ping checks are Ping monitors, DNS checks DNS monitors (without the
 *    address they expect, which the preview names).
 *  - UDP, custom HTTP and transaction checks have no OneUptime monitor that
 *    does the same, and are named as left out.
 */

const KEY_ADVICE: string =
  "Check that you copied the whole token, and that it is an API token from My Pingdom > Settings > Pingdom API.";

// The port each mail protocol listens on when the check names none.
const MAIL_PORTS: Record<string, { port: number; secure: number }> = {
  smtp: { port: 25, secure: 465 },
  pop3: { port: 110, secure: 995 },
  imap: { port: 143, secure: 993 },
};

const UNSUPPORTED_TYPE_NAMES: Record<string, string> = {
  udp: "UDP",
  httpcustom: "custom HTTP",
};

export default class PingdomAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.Pingdom;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.Pingdom,
    );

    try {
      await context.onProgress?.(ToolImportResourceKind.Monitor);

      const list: Record<string, unknown> = asRecord(
        await client.getJson("/api/3.1/checks", {
          include_tags: true,
          showencryption: true,
        }),
      );

      const checks: Array<Record<string, unknown>> = capRecords({
        kind: ToolImportResourceKind.Monitor,
        records: asArray(list["checks"]).map(asRecord),
        notes: snapshot.notes,
      });

      const monitors: Array<ImportedMonitor> = [];
      const certificates: Array<ImportedMonitor> = [];

      for (const check of checks) {
        const read: Array<ImportedMonitor> = await this.readCheck(
          client,
          check,
        );

        if (read[0]) {
          monitors.push(read[0]);
        }

        if (read[1]) {
          certificates.push(read[1]);
        }
      }

      // Transaction checks: named in the preview as not brought over.
      for (const transaction of await this.readTransactionChecks(client)) {
        monitors.push(transaction);
      }

      snapshot.monitors = [...monitors, ...certificates];

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
        toolName: "Pingdom",
        keyAdvice: KEY_ADVICE,
      });
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  /*
   * One check, read whole where it has settings beyond its host: the
   * monitor it becomes and, for an HTTP check that treats an expiring
   * certificate as down, its SSL Certificate monitor.
   */
  private async readCheck(
    client: ToolImportHttpClient,
    listed: Record<string, unknown>,
  ): Promise<Array<ImportedMonitor>> {
    const checkId: string = asString(listed["id"]);
    const type: string = asString(listed["type"]).toLowerCase();

    if (!checkId) {
      return [];
    }

    if (type === "ping" || type === "udp" || type === "httpcustom") {
      return [this.toMonitor(listed)];
    }

    let detail: Record<string, unknown> = {};

    try {
      detail = asRecord(
        asRecord(
          await client.getJson(
            `/api/3.1/checks/${encodeURIComponent(checkId)}`,
          ),
        )["check"],
      );
    } catch (error) {
      // Deleted between the list and now: nothing left to bring over.
      if (
        error instanceof ToolImportHttpError &&
        error.kind === ToolImportHttpErrorKind.NotFound
      ) {
        return [];
      }

      throw error;
    }

    return this.toMonitors({ ...listed, ...detail });
  }

  // The monitor a check becomes, and its certificate monitor when it has one.
  public toMonitors(check: Record<string, unknown>): Array<ImportedMonitor> {
    const monitor: ImportedMonitor = this.toMonitor(check);
    const certificate: ImportedMonitor | null = this.toCertificate(
      check,
      monitor,
    );

    return certificate ? [monitor, certificate] : [monitor];
  }

  public toMonitor(check: Record<string, unknown>): ImportedMonitor {
    const sourceId: string = asString(check["id"]);
    const name: string = cleanName(check["name"], `Check ${sourceId}`);
    const hostname: string = asString(check["hostname"]);
    const typeSettings: Record<string, unknown> = asRecord(check["type"]);
    // The list names the type; a check's own settings are keyed by it.
    const type: string = (
      asString(check["type"]) ||
      Object.keys(typeSettings)[0] ||
      ""
    ).toLowerCase();
    const settings: Record<string, unknown> = asRecord(typeSettings[type]);
    const intervalSeconds: number | undefined =
      (asNumber(check["resolution"]) || 0) * 60 || undefined;
    const isPaused: boolean =
      asString(check["status"]).toLowerCase() === "paused" ||
      check["paused"] === true;

    if (type === "http") {
      return this.toWebMonitor({
        sourceId: sourceId,
        name: name,
        hostname: hostname,
        settings: settings,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
    }

    if (type === "ping") {
      return this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "ping",
        monitorType: MonitorType.Ping,
        destination: hostname,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
    }

    if (type === "tcp") {
      const monitor: ImportedMonitor = this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "TCP",
        monitorType: MonitorType.Port,
        destination: hostname,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
      monitor.port = asNumber(settings["port"]) || undefined;

      if (asString(settings["stringtoexpect"])) {
        monitor.notes.push(
          makeToolImportNote(ToolImportNoteCode.MonitorChecksPortOnly, {
            protocol: "TCP",
          }),
        );
      }

      return monitor;
    }

    if (type === "smtp" || type === "pop3" || type === "imap") {
      const ports: { port: number; secure: number } = MAIL_PORTS[type]!;
      const monitor: ImportedMonitor = this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: type.toUpperCase(),
        monitorType: MonitorType.Port,
        destination: hostname,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });
      monitor.port =
        asNumber(settings["port"]) ||
        (asBoolean(settings["encryption"], false) ? ports.secure : ports.port);
      monitor.notes.push(
        makeToolImportNote(ToolImportNoteCode.MonitorChecksPortOnly, {
          protocol: type.toUpperCase(),
        }),
      );
      return monitor;
    }

    if (type === "dns") {
      const monitor: ImportedMonitor = this.plainMonitor({
        sourceId: sourceId,
        name: name,
        sourceType: "DNS",
        monitorType: MonitorType.DNS,
        destination: hostname,
        intervalSeconds: intervalSeconds,
        isPaused: isPaused,
      });

      const nameserver: string = asString(settings["nameserver"]);

      if (nameserver) {
        monitor.dnsServer = nameserver;
      }

      if (asString(settings["expectedip"])) {
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
      destination: hostname || undefined,
    });
  }

  private toWebMonitor(data: {
    sourceId: string;
    name: string;
    hostname: string;
    settings: Record<string, unknown>;
    intervalSeconds: number | undefined;
    isPaused: boolean;
  }): ImportedMonitor {
    const settings: Record<string, unknown> = data.settings;
    const isEncrypted: boolean = asBoolean(settings["encryption"], false);
    const port: number | null = asNumber(settings["port"]);
    const isDefaultPort: boolean =
      port === null || port === (isEncrypted ? 443 : 80);
    const path: string = asString(settings["url"]) || "/";
    const url: string = `${isEncrypted ? "https" : "http"}://${data.hostname}${
      isDefaultPort ? "" : `:${port}`
    }${path.startsWith("/") ? path : `/${path}`}`;

    const shouldContain: string = asString(settings["shouldcontain"]);
    const shouldNotContain: string = asString(settings["shouldnotcontain"]);
    const postData: string = asString(settings["postdata"]);

    return toHttpMonitor({
      sourceId: data.sourceId,
      name: data.name,
      sourceType: "HTTP",
      url: url,
      method: postData ? "POST" : "GET",
      headers: this.readHeaders(settings["requestheaders"]),
      body: postData || undefined,
      intervalSeconds: data.intervalSeconds,
      keyword: shouldContain
        ? { value: shouldContain, isPresent: true, isCaseSensitive: true }
        : shouldNotContain
          ? { value: shouldNotContain, isPresent: false, isCaseSensitive: true }
          : undefined,
      signsIn: Boolean(asString(settings["username"])),
      isPaused: data.isPaused,
    });
  }

  /*
   * A check's request headers, in either of the shapes Pingdom writes
   * them: an object of names and values, or "Name: value" strings.
   */
  private readHeaders(value: unknown): Array<{ name: string; value: string }> {
    if (Array.isArray(value)) {
      return asArray(value)
        .map(asString)
        .filter((line: string): boolean => {
          return line.includes(":");
        })
        .map((line: string) => {
          const at: number = line.indexOf(":");
          return {
            name: line.slice(0, at).trim(),
            value: line.slice(at + 1).trim(),
          };
        });
    }

    return Object.entries(asRecord(value))
      .map(([name, headerValue]: [string, unknown]) => {
        return { name: name, value: asString(headerValue) };
      })
      .filter((header: { name: string; value: string }): boolean => {
        // Pingdom sends its own user agent: not a header the check chose.
        return header.name.toLowerCase() !== "user-agent";
      });
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

  /*
   * An HTTP check that treats a certificate expiring within so many days
   * as down: OneUptime watches the certificate with its own monitor, which
   * warns that many days ahead.
   */
  private toCertificate(
    check: Record<string, unknown>,
    monitor: ImportedMonitor,
  ): ImportedMonitor | null {
    const settings: Record<string, unknown> = asRecord(
      asRecord(check["type"])["http"],
    );
    const days: number = asNumber(settings["ssl_down_days_before"]) || 0;

    if (
      !monitor.destination ||
      days < 1 ||
      !asBoolean(settings["verify_certificate"], true)
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

  // Transaction checks, each named as left out; none when the key cannot read them.
  private async readTransactionChecks(
    client: ToolImportHttpClient,
  ): Promise<Array<ImportedMonitor>> {
    try {
      const body: Record<string, unknown> = asRecord(
        await client.getJson("/api/3.1/tms/check"),
      );

      return asArray(body["checks"])
        .map(asRecord)
        .filter((check: Record<string, unknown>): boolean => {
          return Boolean(asString(check["id"]));
        })
        .map((check: Record<string, unknown>): ImportedMonitor => {
          const sourceId: string = `transaction:${asString(check["id"])}`;

          return toUnsupportedMonitor({
            sourceId: sourceId,
            name: cleanName(check["name"], `Transaction ${sourceId}`),
            sourceType: "transaction",
          });
        });
    } catch (error) {
      if (isListNotAvailable(error)) {
        return [];
      }

      throw error;
    }
  }

  private async countMaintenanceWindows(
    client: ToolImportHttpClient,
  ): Promise<number> {
    try {
      return asArray(
        asRecord(await client.getJson("/api/3.1/maintenance"))["maintenance"],
      ).length;
    } catch (error) {
      if (isListNotAvailable(error)) {
        return 0;
      }

      throw error;
    }
  }
}
