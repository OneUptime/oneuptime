import dgram from "dgram";
import net from "net";
import tls from "tls";
import { Host } from "Common/Server/EnvironmentConfig";
import AuditLogExportSettingsUtil, {
  AuditLogExportSettings,
} from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import DataSourceEgressGuard, {
  EgressGuardOptions,
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import {
  AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE,
  AuditLogExportSyslogFraming,
  AuditLogExportSyslogProtocol,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import {
  AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION,
  AuditLogExportChange,
  AuditLogExportRecord,
  serializeAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import EgressGuardException, {
  EgressFailureReason,
} from "Common/Types/Exception/EgressGuardException";
import { JSONValue } from "Common/Types/JSON";
import {
  describeLargeJson,
  formatCount,
  getJsonLength,
  isJsonStructure,
  limitText,
} from "Common/Utils/AuditLog/AuditLogValues";
import { limitLines } from "Common/Utils/Workflow/WorkflowGraphChanges";
import {
  AuditLogExportDelivery,
  AuditLogExportDeliveryError,
  AuditLogExportDeliveryReceipt,
  AuditLogExportDestination,
} from "./Types";

/*
 * Syslog: one RFC 5424 message per entry, over TLS (RFC 5425, port 6514 by
 * default) or plain TCP, framed by octet counting (each message preceded by
 * its length) or by a line break, as the receiver expects - or over UDP
 * (RFC 5426, port 514), one datagram per message:
 *
 *   <110>1 2026-10-24T09:15:03.000Z oneuptime.example.com oneuptime - audit-log - {"schemaVersion":1,...}
 *
 * Facility 13 (log audit), severity 6 (informational): <110>. The message
 * is the entry's JSON on one line (JSON never holds a raw line break, so a
 * line break can frame it).
 *
 * Over TLS and TCP, every message of a batch goes over one connection,
 * which is ended once all of it is written; the batch counts as delivered
 * when the connection closes without an error. Syslog has no
 * acknowledgement, so a receiver that drops what it got cannot say so - one
 * reason a file destination is the archive and syslog the stream.
 *
 * Over UDP there is not even a connection: a datagram lost on the way is
 * lost without a word, and a batch counts as sent once every datagram has
 * left. What can be heard is a host that answers its port is closed (ICMP
 * port unreachable, ECONNREFUSED on the socket): a moment is waited for
 * that after the last datagram, and the batch is then tried again. The
 * datagrams go out in bursts with a short pause between, so a receiver's
 * socket buffer is never run over by a batch at once. A datagram holds at
 * most Maximum message size bytes, and a receiver cuts a longer message
 * wherever it stops reading, which leaves no JSON - so an entry too long
 * for it is shortened here, its values first, with the audit log's own
 * markers (fitSyslogMessage), and every message is one whole JSON entry.
 *
 * The address goes through the egress policy first, and the connection
 * dials only the address that was checked (a pinned lookup; over UDP the
 * address itself), while TLS still verifies the certificate against the
 * host name.
 */

// Facility 13 (log audit) * 8 + severity 6 (informational).
export const AUDIT_LOG_EXPORT_SYSLOG_PRIORITY: number = 110;

export const AUDIT_LOG_EXPORT_SYSLOG_APP_NAME: string = "oneuptime";

export const AUDIT_LOG_EXPORT_SYSLOG_MESSAGE_ID: string = "audit-log";

export const AUDIT_LOG_EXPORT_SYSLOG_TIMEOUT_IN_MS: number = 30 * 1000;

// How long a receiver has to close its side once everything is written.
const SYSLOG_CLOSE_GRACE_IN_MS: number = 5 * 1000;

/*
 * How long a batch over UDP waits after its last datagram for the receiver's
 * host to answer that its port is closed: an ICMP answer takes a round trip.
 */
export const AUDIT_LOG_EXPORT_SYSLOG_UDP_SETTLE_IN_MS: number = 1000;

/*
 * Datagrams go out in bursts a receiver's socket buffer holds - 212 KB by
 * default on Linux, where even a small datagram takes over 2 KB of it -
 * with a short pause after each. Sent back to back, a batch of 500 entries
 * of 8 KB lost a sixth of them to a receiver in another process on the
 * same machine, and 100 of 64 KB four in five; paced, none was lost, and a
 * batch of 4 MB takes about 0.6 seconds.
 */
export const AUDIT_LOG_EXPORT_SYSLOG_UDP_BURST_DATAGRAMS: number = 32;

export const AUDIT_LOG_EXPORT_SYSLOG_UDP_BURST_BYTES: number = 64 * 1024;

export const AUDIT_LOG_EXPORT_SYSLOG_UDP_PAUSE_IN_MS: number = 10;

/*
 * The characters each value of an entry keeps, step by step, until the
 * entry fits a datagram: a change's before and after, and its summary
 * lines. The first step that fits is sent.
 */
export const AUDIT_LOG_EXPORT_SYSLOG_UDP_VALUE_LIMITS: ReadonlyArray<number> = [
  4096, 1024, 256, 64, 16,
];

/*
 * The characters each name of the entry itself keeps once its values are
 * being shortened: more than the audit log records of a name today, so only
 * an entry recorded before it cut names loses any of one.
 */
export const AUDIT_LOG_EXPORT_SYSLOG_UDP_NAME_LIMIT: number = 128;

// The names an entry carries as text a person typed, rather than an id or a time.
type ShortenedName =
  | "resourceName"
  | "userName"
  | "userEmail"
  | "apiKeyName"
  | "mcpClientName"
  | "workflowName";

const SHORTENED_NAMES: ReadonlyArray<ShortenedName> = [
  "resourceName",
  "userName",
  "userEmail",
  "apiKeyName",
  "mcpClientName",
  "workflowName",
];

// What the egress check of a host answers: the addresses the connection may dial.
export type SyslogTargetResolver = (
  host: string,
  options: EgressGuardOptions,
) => Promise<Array<ResolvedAddress>>;

const defaultResolver: SyslogTargetResolver = (
  host: string,
  options: EgressGuardOptions,
): Promise<Array<ResolvedAddress>> => {
  return DataSourceEgressGuard.assertHostnameAllowed(host, options);
};

// How a UDP socket is made: Node's own, unless a test plays the network's part.
export type SyslogUdpSocketFactory = (type: dgram.SocketType) => dgram.Socket;

const defaultUdpSocketFactory: SyslogUdpSocketFactory = (
  type: dgram.SocketType,
): dgram.Socket => {
  return dgram.createSocket(type);
};

// RFC 5424's HOSTNAME: printable US-ASCII without spaces, or "-" (the nil value).
export function getSyslogHostName(host: string = Host): string {
  const value: string = (host || "").trim();

  if (!value || value.length > 255) {
    return "-";
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 33 || code > 126) {
      return "-";
    }
  }

  return value;
}

export function toSyslogMessage(data: {
  record: AuditLogExportRecord;
  hostName: string;
}): string {
  return `<${AUDIT_LOG_EXPORT_SYSLOG_PRIORITY}>1 ${data.record.createdAt} ${data.hostName} ${AUDIT_LOG_EXPORT_SYSLOG_APP_NAME} - ${AUDIT_LOG_EXPORT_SYSLOG_MESSAGE_ID} - ${serializeAuditLogExportRecord(
    data.record,
  )}`;
}

// One message as it goes on the wire: its length first (octet counting), or a line break after it.
export function frameSyslogMessage(message: string, framing: string): Buffer {
  const bytes: Buffer = Buffer.from(message, "utf8");

  if (framing === AuditLogExportSyslogFraming.NewLine) {
    return Buffer.concat([bytes, Buffer.from("\n", "utf8")]);
  }

  return Buffer.concat([Buffer.from(`${bytes.length} `, "utf8"), bytes]);
}

/*
 * The longest message an export over UDP sends: the size it names, else the
 * default - and never one a datagram cannot carry, whatever is stored.
 */
export function readSyslogUdpMessageSize(value: string): number {
  const text: string = (value || "").trim();
  const size: number = text ? Number(text) : NaN;

  if (!Number.isInteger(size)) {
    return AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_UDP_MESSAGE_SIZE;
  }

  return Math.min(
    AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE,
    Math.max(AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE, size),
  );
}

// A value as a shortened entry keeps it: text cut with how much is left out, JSON by its size.
function shortenValue(
  value: JSONValue | undefined,
  limit: number,
): JSONValue | undefined {
  if (typeof value === "string") {
    return limitText(value, limit);
  }

  if (isJsonStructure(value)) {
    const length: number = getJsonLength(value);

    return length > limit ? describeLargeJson(length) : value;
  }

  return value;
}

/*
 * A change with each value shortened to the limit, its keys as they were
 * (a change of a create has no before). Its summary keeps a line for each
 * 64 characters of the limit, the last counting the rest.
 */
function shortenChange(
  change: AuditLogExportChange,
  limit: number,
): AuditLogExportChange {
  const shortened: AuditLogExportChange = { field: change.field };

  if (Object.prototype.hasOwnProperty.call(change, "oldValue")) {
    shortened.oldValue = shortenValue(change.oldValue, limit);
  }

  if (Object.prototype.hasOwnProperty.call(change, "newValue")) {
    shortened.newValue = shortenValue(change.newValue, limit);
  }

  if (Object.prototype.hasOwnProperty.call(change, "summary")) {
    shortened.summary = Array.isArray(change.summary)
      ? limitLines({
          lines: change.summary.map((line: string): string => {
            return limitText(line, limit);
          }),
          limit: Math.max(1, Math.floor(limit / 64)),
          noun: "line",
        })
      : change.summary;
  }

  return shortened;
}

/*
 * In place of the changes a message has no room for: one change that counts
 * them, in the words the audit log cuts a text with - "[… 12 more changes]"
 * after the ones kept, "[… 12 changes]" when none is. A change of its own
 * keeps the record's shape, which a reader's parser holds it to.
 */
function countLeftOutChanges(data: {
  count: number;
  isAfterKept: boolean;
  schemaVersion: number;
}): AuditLogExportChange {
  const noun: string = data.count === 1 ? "change" : "changes";
  const marker: AuditLogExportChange = {
    field: `[… ${formatCount(data.count)} ${data.isAfterKept ? "more " : ""}${noun}]`,
  };

  if (data.schemaVersion >= AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION) {
    marker.summary = null;
  }

  return marker;
}

/*
 * An entry as one message of at most maxBytes bytes, for UDP. Whole when it
 * fits. Else what an audit trail needs most is kept longest - who, what,
 * when and on what, then which fields changed, then what they held:
 *
 *   1. each value of each change is shortened, to 4096 characters, then
 *      1024, 256, 64 and 16 - text keeps its start and says how much is
 *      left out ("[… 1,234 more characters]"), JSON says its size ("[12.3
 *      KB of JSON]"), as the audit log itself shortens a value - and each
 *      name of the entry to 128 characters;
 *   2. then as many changes as fit are kept, and one more counts the rest
 *      ("[… 12 more changes]");
 *   3. an entry still too long - only a long host name with the smallest
 *      size can make one - is sent as the shortest of these, whole.
 *
 * Every key of the record stays, so the message is always one whole JSON
 * entry of the version the export sends.
 */
export function fitSyslogMessage(data: {
  record: AuditLogExportRecord;
  hostName: string;
  maxBytes: number;
}): { message: string; isShortened: boolean } {
  const fits: (message: string) => boolean = (message: string): boolean => {
    return Buffer.byteLength(message, "utf8") <= data.maxBytes;
  };
  const write: (record: AuditLogExportRecord) => string = (
    record: AuditLogExportRecord,
  ): string => {
    return toSyslogMessage({ record, hostName: data.hostName });
  };

  const whole: string = write(data.record);

  if (fits(whole)) {
    return { message: whole, isShortened: false };
  }

  const named: AuditLogExportRecord = { ...data.record };

  for (const key of SHORTENED_NAMES) {
    const name: string | null = data.record[key];

    named[key] =
      typeof name === "string"
        ? limitText(name, AUDIT_LOG_EXPORT_SYSLOG_UDP_NAME_LIMIT)
        : name;
  }

  let shortest: AuditLogExportRecord = named;

  for (const limit of AUDIT_LOG_EXPORT_SYSLOG_UDP_VALUE_LIMITS) {
    shortest = {
      ...named,
      changes: data.record.changes.map(
        (change: AuditLogExportChange): AuditLogExportChange => {
          return shortenChange(change, limit);
        },
      ),
    };

    const message: string = write(shortest);

    if (fits(message)) {
      return { message, isShortened: true };
    }
  }

  // The most changes that fit, one more counting the rest: a message grows with each change kept.
  const changes: Array<AuditLogExportChange> = shortest.changes;
  const keeping: (kept: number) => string = (kept: number): string => {
    return write({
      ...shortest,
      changes: [
        ...changes.slice(0, kept),
        countLeftOutChanges({
          count: changes.length - kept,
          isAfterKept: kept > 0,
          schemaVersion: shortest.schemaVersion,
        }),
      ],
    });
  };

  let low: number = 0;
  let high: number = changes.length - 1;
  let best: string | null = null;

  while (low <= high) {
    const kept: number = Math.floor((low + high) / 2);
    const message: string = keeping(kept);

    if (fits(message)) {
      best = message;
      low = kept + 1;
    } else {
      high = kept - 1;
    }
  }

  if (best !== null) {
    return { message: best, isShortened: true };
  }

  return {
    message: changes.length > 0 ? keeping(0) : write(shortest),
    isShortened: true,
  };
}

// Which socket error is a setting to change rather than a receiver that was away.
const CERTIFICATE_ERROR_PREFIXES: ReadonlyArray<string> = [
  "UNABLE_TO_",
  "CERT_",
  "SELF_SIGNED_",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
];

export function describeSyslogError(data: {
  error: unknown;
  host: string;
  port: number;
  protocol: string;
}): AuditLogExportDeliveryError {
  /*
   * Read by shape, not by instanceof Error: a socket's error is made by
   * Node's own net and tls code, which a sandbox (jest's) sees as an object
   * of another realm.
   */
  const raw: { code?: unknown; message?: unknown } =
    data.error && typeof data.error === "object"
      ? (data.error as { code?: unknown; message?: unknown })
      : { message: String(data.error) };
  const code: string = typeof raw.code === "string" ? raw.code : "";
  const message: string =
    typeof raw.message === "string" ? raw.message : String(data.error);
  const target: string = `${data.host}:${data.port}`;

  // UDP has no connection to refuse: the receiver's host answered that its port is closed.
  if (data.protocol === AuditLogExportSyslogProtocol.Udp) {
    if (code === "ECONNREFUSED") {
      return new AuditLogExportDeliveryError(
        `Nothing receives syslog over UDP at ${target}: its host answered that the port is closed (ECONNREFUSED). Check the host, the port and the protocol. It is retried automatically.`,
        { retryable: true },
      );
    }

    if (code === "EMSGSIZE") {
      return new AuditLogExportDeliveryError(
        `A message was too long to send over UDP to ${target} (EMSGSIZE). Lower Maximum message size.`,
        { retryable: false },
      );
    }

    return new AuditLogExportDeliveryError(
      `Sending syslog over UDP to ${target} failed${
        code ? ` (${code})` : ""
      }: ${message.endsWith(".") ? message.slice(0, -1) : message}. It is retried automatically.`,
      { retryable: true },
    );
  }

  if (
    CERTIFICATE_ERROR_PREFIXES.some((prefix: string): boolean => {
      return code.startsWith(prefix);
    })
  ) {
    return new AuditLogExportDeliveryError(
      code === "ERR_TLS_CERT_ALTNAME_INVALID"
        ? `The syslog receiver's certificate is not for ${data.host} (${code}). Use the host name the certificate names.`
        : `The syslog receiver's certificate is not trusted (${code}). If a private CA signed it, paste that CA's certificate in CA certificate.`,
      { retryable: false },
    );
  }

  if (code === "ECONNREFUSED") {
    return new AuditLogExportDeliveryError(
      `Nothing accepted the connection at ${target} (ECONNREFUSED). Check the host, the port and the protocol. It is retried automatically.`,
      { retryable: true },
    );
  }

  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return new AuditLogExportDeliveryError(
      `The syslog receiver at ${target} did not answer in time (${code}). It is retried automatically.`,
      { retryable: true },
    );
  }

  if (code === "EPROTO" || code.startsWith("ERR_SSL")) {
    return new AuditLogExportDeliveryError(
      `The TLS connection to ${target} failed (${code}). Check that the receiver takes ${
        data.protocol === AuditLogExportSyslogProtocol.Tls ? "TLS" : "TCP"
      } on this port.`,
      { retryable: false },
    );
  }

  return new AuditLogExportDeliveryError(
    `The connection to the syslog receiver at ${target} failed${
      code ? ` (${code})` : ""
    }: ${message.endsWith(".") ? message.slice(0, -1) : message}. It is retried automatically.`,
    { retryable: true },
  );
}

export default class SyslogDestination implements AuditLogExportDestination {
  private readonly resolveTarget: SyslogTargetResolver;
  private readonly timeoutInMs: number;
  private readonly closeGraceInMs: number;
  private readonly udpSettleInMs: number;
  private readonly udpPauseInMs: number;
  private readonly createUdpSocket: SyslogUdpSocketFactory;
  private readonly hostName: string;

  public constructor(
    options: {
      resolveTarget?: SyslogTargetResolver | undefined;
      timeoutInMs?: number | undefined;
      closeGraceInMs?: number | undefined;
      udpSettleInMs?: number | undefined;
      udpPauseInMs?: number | undefined;
      createUdpSocket?: SyslogUdpSocketFactory | undefined;
      hostName?: string | undefined;
    } = {},
  ) {
    this.resolveTarget = options.resolveTarget || defaultResolver;
    this.timeoutInMs =
      options.timeoutInMs || AUDIT_LOG_EXPORT_SYSLOG_TIMEOUT_IN_MS;
    this.closeGraceInMs = options.closeGraceInMs || SYSLOG_CLOSE_GRACE_IN_MS;
    this.udpSettleInMs =
      options.udpSettleInMs ?? AUDIT_LOG_EXPORT_SYSLOG_UDP_SETTLE_IN_MS;
    this.udpPauseInMs =
      options.udpPauseInMs ?? AUDIT_LOG_EXPORT_SYSLOG_UDP_PAUSE_IN_MS;
    this.createUdpSocket = options.createUdpSocket || defaultUdpSocketFactory;
    this.hostName = getSyslogHostName(options.hostName ?? Host);
  }

  public async deliver(
    delivery: AuditLogExportDelivery,
  ): Promise<AuditLogExportDeliveryReceipt> {
    const settings: AuditLogExportSettings = delivery.settings;
    const read: (key: string) => string = (key: string): string => {
      return AuditLogExportSettingsUtil.readConfigText(settings, key);
    };

    const host: string = read("host");
    const port: number = Number(read("port"));
    const protocol: string = read("protocol");
    const framing: string = read("framing");

    let addresses: Array<ResolvedAddress>;

    try {
      addresses = await this.resolveTarget(host, delivery.egress);
    } catch (error) {
      const isUnreachable: boolean =
        error instanceof EgressGuardException &&
        (error.reason === EgressFailureReason.Unreachable ||
          error.reason === EgressFailureReason.ResolutionFailed);

      throw new AuditLogExportDeliveryError(
        error instanceof Error ? error.message : String(error),
        { retryable: isUnreachable },
      );
    }

    if (protocol === AuditLogExportSyslogProtocol.Udp) {
      const maxBytes: number = readSyslogUdpMessageSize(read("maxMessageSize"));

      // One datagram per message, nothing around it (RFC 5426).
      const datagrams: Array<Buffer> = delivery.batch.records.map(
        (record: AuditLogExportRecord): Buffer => {
          return Buffer.from(
            fitSyslogMessage({ record, hostName: this.hostName, maxBytes })
              .message,
            "utf8",
          );
        },
      );

      try {
        await this.sendDatagrams({ addresses, port, datagrams });
      } catch (error) {
        throw describeSyslogError({ error, host, port, protocol });
      }

      return { location: `syslog+udp://${host}:${port}`, isUnconfirmed: true };
    }

    const payload: Buffer = Buffer.concat(
      delivery.batch.records.map((record: AuditLogExportRecord): Buffer => {
        return frameSyslogMessage(
          toSyslogMessage({ record, hostName: this.hostName }),
          framing,
        );
      }),
    );

    try {
      await this.send({
        host,
        port,
        protocol,
        caCertificate: read("caCertificate"),
        addresses,
        payload,
      });
    } catch (error) {
      throw describeSyslogError({ error, host, port, protocol });
    }

    return {
      location: `${
        protocol === AuditLogExportSyslogProtocol.Tls ? "syslog+tls" : "syslog"
      }://${host}:${port}`,
    };
  }

  private send(data: {
    host: string;
    port: number;
    protocol: string;
    caCertificate: string;
    addresses: Array<ResolvedAddress>;
    payload: Buffer;
  }): Promise<void> {
    return new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void): void => {
        let settled: boolean = false;

        const lookup: ReturnType<
          typeof DataSourceEgressGuard.createPinnedLookup
        > = DataSourceEgressGuard.createPinnedLookup(data.addresses);

        const finish: (error?: Error | undefined) => void = (
          error?: Error | undefined,
        ): void => {
          if (settled) {
            return;
          }

          settled = true;

          if (error) {
            socket.destroy();
            reject(error);
            return;
          }

          resolve();
        };

        const onConnected: () => void = (): void => {
          socket.end(data.payload);
        };

        const socket: net.Socket =
          data.protocol === AuditLogExportSyslogProtocol.Tcp
            ? net.connect(
                {
                  host: data.host,
                  port: data.port,
                  lookup: lookup as never,
                },
                onConnected,
              )
            : tls.connect(
                {
                  host: data.host,
                  port: data.port,
                  lookup: lookup as never,
                  minVersion: "TLSv1.2",
                  rejectUnauthorized: true,
                  ...(net.isIP(data.host) === 0
                    ? { servername: data.host }
                    : {}),
                  ...(data.caCertificate ? { ca: [data.caCertificate] } : {}),
                },
                onConnected,
              );

        socket.setTimeout(this.timeoutInMs, (): void => {
          const timeout: NodeJS.ErrnoException = new Error(
            "the receiver did not answer in time",
          );
          timeout.code = "ETIMEDOUT";
          finish(timeout);
        });

        socket.on("error", (error: Error): void => {
          finish(error);
        });

        socket.on("close", (hadError: boolean): void => {
          if (!hadError) {
            finish();
          }
        });

        /*
         * Everything is written once the socket has finished. A receiver
         * closes its side when it reads the end; one that does not is given
         * a moment, then the connection is closed here - what it had to
         * read has been sent.
         */
        socket.on("finish", (): void => {
          setTimeout((): void => {
            if (!settled) {
              finish();
              socket.destroy();
            }
          }, this.closeGraceInMs).unref();
        });

        // A receiver that answers is drained, so the connection can close.
        socket.on("data", (): void => {
          // Syslog receivers do not answer; anything they send is ignored.
        });
      },
    );
  }

  /*
   * The datagrams to the first address checked that a socket can be pointed
   * at: an address this host cannot reach at all (IPv6 where it has none)
   * gives way to the next before anything is sent. Once one is sent, a
   * failure is the batch's - sending again elsewhere would send twice.
   */
  private async sendDatagrams(data: {
    addresses: Array<ResolvedAddress>;
    port: number;
    datagrams: Array<Buffer>;
  }): Promise<void> {
    let lastError: unknown = new Error("the host has no address to send to");

    for (const address of data.addresses) {
      const outcome: { isConnected: boolean; error: unknown } =
        await this.sendDatagramsTo({
          address,
          port: data.port,
          datagrams: data.datagrams,
        });

      if (!outcome.error) {
        return;
      }

      if (outcome.isConnected) {
        throw outcome.error;
      }

      lastError = outcome.error;
    }

    throw lastError;
  }

  /*
   * One socket pointed at one address (a connected UDP socket, so the
   * host's answer that the port is closed reaches it), each datagram sent
   * once the last has left, in bursts with a pause between, then a moment
   * for that answer. Never rejects: says whether the socket was pointed at
   * the address, and what failed.
   */
  private sendDatagramsTo(data: {
    address: ResolvedAddress;
    port: number;
    datagrams: Array<Buffer>;
  }): Promise<{ isConnected: boolean; error: unknown }> {
    return new Promise<{ isConnected: boolean; error: unknown }>(
      (
        resolve: (outcome: { isConnected: boolean; error: unknown }) => void,
      ): void => {
        let settled: boolean = false;
        let isConnected: boolean = false;
        let next: number = 0;
        let datagramsInBurst: number = 0;
        let bytesInBurst: number = 0;
        const timers: Array<NodeJS.Timeout> = [];

        const socket: dgram.Socket = this.createUdpSocket(
          data.address.family === 6 ? "udp6" : "udp4",
        );

        const finish: (error?: unknown) => void = (error?: unknown): void => {
          if (settled) {
            return;
          }

          settled = true;

          for (const timer of timers) {
            clearTimeout(timer);
          }

          try {
            socket.close();
          } catch {
            // Closed already.
          }

          resolve({ isConnected, error: error || null });
        };

        // Nothing is waited on forever, whatever the network does.
        timers.push(
          setTimeout((): void => {
            const error: NodeJS.ErrnoException = new Error(
              "the datagrams did not leave in time",
            );
            error.code = "ETIMEDOUT";
            finish(error);
          }, this.timeoutInMs),
        );

        // The host's answer that the port is closed arrives here, or with the next send.
        socket.on("error", (error: Error): void => {
          finish(error);
        });

        // Syslog receivers do not answer; anything they send is ignored.
        socket.on("message", (): void => {});

        const sendNext: () => void = (): void => {
          if (settled) {
            return;
          }

          if (next >= data.datagrams.length) {
            timers.push(
              setTimeout((): void => {
                finish();
              }, this.udpSettleInMs),
            );
            return;
          }

          const datagram: Buffer = data.datagrams[next]!;
          next++;

          socket.send(datagram, (error: Error | null): void => {
            if (error) {
              finish(error);
              return;
            }

            datagramsInBurst++;
            bytesInBurst += datagram.length;

            if (
              datagramsInBurst >= AUDIT_LOG_EXPORT_SYSLOG_UDP_BURST_DATAGRAMS ||
              bytesInBurst >= AUDIT_LOG_EXPORT_SYSLOG_UDP_BURST_BYTES
            ) {
              datagramsInBurst = 0;
              bytesInBurst = 0;
              timers.push(setTimeout(sendNext, this.udpPauseInMs));
              return;
            }

            sendNext();
          });
        };

        // The callback hears a failure too, though Node's types leave it out.
        socket.connect(
          data.port,
          data.address.address,
          (error?: Error): void => {
            if (error) {
              finish(error);
              return;
            }

            isConnected = true;
            sendNext();
          },
        );
      },
    );
  }
}
