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
  AuditLogExportSyslogFraming,
  AuditLogExportSyslogProtocol,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import {
  AuditLogExportRecord,
  serializeAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import EgressGuardException, {
  EgressFailureReason,
} from "Common/Types/Exception/EgressGuardException";
import {
  AuditLogExportDelivery,
  AuditLogExportDeliveryError,
  AuditLogExportDeliveryReceipt,
  AuditLogExportDestination,
} from "./Types";

/*
 * Syslog: one RFC 5424 message per entry, over TLS (RFC 5425, port 6514 by
 * default) or plain TCP, framed by octet counting (each message preceded by
 * its length) or by a line break, as the receiver expects:
 *
 *   <110>1 2026-10-24T09:15:03.000Z oneuptime.example.com oneuptime - audit-log - {"schemaVersion":1,...}
 *
 * Facility 13 (log audit), severity 6 (informational): <110>. The message
 * is the entry's JSON on one line (JSON never holds a raw line break, so a
 * line break can frame it).
 *
 * Every message of a batch goes over one connection, which is ended once
 * all of it is written; the batch counts as delivered when the connection
 * closes without an error. Syslog has no acknowledgement, so a receiver
 * that drops what it got cannot say so - one reason a file destination is
 * the archive and syslog the stream.
 *
 * The address goes through the egress policy first, and the connection
 * dials only the address that was checked (a pinned lookup), while TLS
 * still verifies the certificate against the host name.
 */

// Facility 13 (log audit) * 8 + severity 6 (informational).
export const AUDIT_LOG_EXPORT_SYSLOG_PRIORITY: number = 110;

export const AUDIT_LOG_EXPORT_SYSLOG_APP_NAME: string = "oneuptime";

export const AUDIT_LOG_EXPORT_SYSLOG_MESSAGE_ID: string = "audit-log";

export const AUDIT_LOG_EXPORT_SYSLOG_TIMEOUT_IN_MS: number = 30 * 1000;

// How long a receiver has to close its side once everything is written.
const SYSLOG_CLOSE_GRACE_IN_MS: number = 5 * 1000;

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
  const error: NodeJS.ErrnoException =
    data.error instanceof Error
      ? (data.error as NodeJS.ErrnoException)
      : new Error(String(data.error));
  const code: string = String(error.code || "");
  const target: string = `${data.host}:${data.port}`;

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
    }: ${error.message}. It is retried automatically.`,
    { retryable: true },
  );
}

export default class SyslogDestination implements AuditLogExportDestination {
  private readonly resolveTarget: SyslogTargetResolver;
  private readonly timeoutInMs: number;
  private readonly hostName: string;

  public constructor(
    options: {
      resolveTarget?: SyslogTargetResolver | undefined;
      timeoutInMs?: number | undefined;
      hostName?: string | undefined;
    } = {},
  ) {
    this.resolveTarget = options.resolveTarget || defaultResolver;
    this.timeoutInMs =
      options.timeoutInMs || AUDIT_LOG_EXPORT_SYSLOG_TIMEOUT_IN_MS;
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
          }, SYSLOG_CLOSE_GRACE_IN_MS).unref();
        });

        // A receiver that answers is drained, so the connection can close.
        socket.on("data", (): void => {
          // Syslog receivers do not answer; anything they send is ignored.
        });
      },
    );
  }
}
