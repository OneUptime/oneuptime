import {
  PROBE_INGEST_URL,
  PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE,
  PROBE_SYSLOG_RECEIVER_ENABLED,
  PROBE_SYSLOG_RECEIVER_PORT,
} from "../Config";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import ProxyConfig from "../Utils/ProxyConfig";
import URL from "Common/Types/API/URL";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import { JSONObject } from "Common/Types/JSON";
import SyslogMessage from "Common/Types/Syslog/SyslogMessage";
import OneUptimeDate from "Common/Types/Date";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import dgram from "dgram";

/*
 * Syslog volume is far higher than SNMP traps, so messages are buffered and
 * flushed to the ingest endpoint in batches — every FLUSH_INTERVAL_MS or
 * once FLUSH_BATCH_SIZE messages accumulate, whichever comes first.
 * Per-message POSTs would not keep up.
 */
const FLUSH_INTERVAL_MS: number = 5000;
const FLUSH_BATCH_SIZE: number = 100;

/*
 * Hard cap on buffered messages. If the ingest endpoint is unreachable (or a
 * forward hangs), incoming datagrams would otherwise grow the buffer without
 * bound; past this many messages the oldest are dropped. Syslog is lossy by
 * design (UDP), so shedding old messages under back-pressure is correct.
 */
const MAX_BUFFERED_MESSAGES: number = FLUSH_BATCH_SIZE * 50;

// Give a stuck forward a bounded lifetime so isFlushing can never wedge.
const FLUSH_REQUEST_TIMEOUT_MS: number = 30000;

// Header fields extracted from an RFC 5424 / RFC 3164 message body.
interface ParsedSyslogBody {
  timestamp: Date | undefined;
  hostname: string | undefined;
  appName: string | undefined;
  message: string;
}

export default class SyslogReceiver {
  private static forwardedThisMinute: number = 0;
  private static minuteWindowStartedAt: number = 0;
  private static droppedThisMinute: number = 0;

  private static buffer: Array<SyslogMessage> = [];
  private static isFlushing: boolean = false;

  public static start(): void {
    if (!PROBE_SYSLOG_RECEIVER_ENABLED) {
      logger.debug(
        "Syslog receiver is disabled (PROBE_SYSLOG_RECEIVER_ENABLED=false).",
      );
      return;
    }

    let hasLoggedBindFailure: boolean = false;

    try {
      const socket: dgram.Socket = dgram.createSocket("udp4");

      socket.on("error", (error: Error) => {
        const errorCode: string | undefined = (error as NodeJS.ErrnoException)
          .code;

        /*
         * Socket-level bind failures (no privilege for ports < 1024
         * outside Docker, or the port is taken) arrive through this
         * event. Say clearly — once — that syslog is off and how to
         * fix it; polling is unaffected either way.
         */
        if (errorCode === "EACCES" || errorCode === "EADDRINUSE") {
          if (!hasLoggedBindFailure) {
            hasLoggedBindFailure = true;
            logger.error(
              `Syslog receiver could not bind UDP port ${PROBE_SYSLOG_RECEIVER_PORT} (${errorCode}). ` +
                `Syslog messages will not be received; monitoring checks are unaffected. ` +
                `Fix: run the probe with privileges for low ports, or set PROBE_SYSLOG_RECEIVER_PORT to a port above 1024, ` +
                `or set PROBE_SYSLOG_RECEIVER_ENABLED=false to silence this.`,
            );
          }
          return;
        }

        /*
         * Per-message socket errors are routine on an open UDP port
         * (scanners, malformed senders) — log and keep listening.
         */
        logger.debug(`Syslog receiver socket error: ${error}`);
      });

      socket.on("message", (datagram: Buffer, remoteInfo: dgram.RemoteInfo) => {
        try {
          SyslogReceiver.handleDatagram(datagram, remoteInfo.address);
        } catch (err) {
          logger.debug(`Syslog receiver message error: ${err}`);
        }
      });

      socket.bind(PROBE_SYSLOG_RECEIVER_PORT);

      setInterval(() => {
        SyslogReceiver.flush().catch((err: Error) => {
          logger.error(`Syslog batch forward failed: ${err}`);
        });
      }, FLUSH_INTERVAL_MS);

      // Bind completes asynchronously; failures surface via the error event.
      logger.info(
        `Syslog receiver starting on UDP port ${PROBE_SYSLOG_RECEIVER_PORT}`,
      );
    } catch (err) {
      /*
       * Binding can fail (port in use, no privilege for ports < 1024).
       * The probe's polling duties are unaffected — log loudly and move on.
       */
      logger.error(
        `Could not start syslog receiver on port ${PROBE_SYSLOG_RECEIVER_PORT}: ${err}`,
      );
    }
  }

  private static handleDatagram(
    datagram: Buffer,
    sourceIpAddress: string,
  ): void {
    const parsed: SyslogMessage | null = SyslogReceiver.parseMessage(
      datagram.toString("utf8"),
      sourceIpAddress,
      OneUptimeDate.getCurrentDate(),
    );

    if (!parsed) {
      logger.debug(
        `Syslog receiver skipped malformed message from ${sourceIpAddress}`,
      );
      return;
    }

    if (!SyslogReceiver.consumeRateLimitSlot()) {
      return;
    }

    SyslogReceiver.buffer.push(parsed);

    /*
     * Shed the oldest messages if the buffer has outgrown its cap (server
     * unreachable / forward hung), to bound memory.
     */
    if (SyslogReceiver.buffer.length > MAX_BUFFERED_MESSAGES) {
      const overflow: number =
        SyslogReceiver.buffer.length - MAX_BUFFERED_MESSAGES;
      SyslogReceiver.buffer.splice(0, overflow);
      logger.warn(
        `Syslog receiver buffer exceeded ${MAX_BUFFERED_MESSAGES} messages; dropped ${overflow} oldest message(s) (ingest may be unreachable).`,
      );
    }

    if (SyslogReceiver.buffer.length >= FLUSH_BATCH_SIZE) {
      SyslogReceiver.flush().catch((err: Error) => {
        logger.error(`Syslog batch forward failed: ${err}`);
      });
    }
  }

  /*
   * Parses a raw syslog datagram in RFC 5424
   * ("<PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD MSG") or RFC 3164
   * ("<PRI>Mmm dd hh:mm:ss host tag: msg") format. A message without a
   * valid <PRI> prefix (priority 0-191) is considered malformed and returns
   * null. A message with a valid <PRI> but an unrecognized body is kept
   * with the whole body as the message text — devices routinely emit
   * slightly non-conformant syslog and dropping it would lose data.
   */
  public static parseMessage(
    raw: string,
    sourceIpAddress: string,
    receivedAt: Date,
  ): SyslogMessage | null {
    const trimmed: string = (raw || "").trim();

    if (!trimmed) {
      return null;
    }

    const priorityMatch: RegExpMatchArray | null =
      trimmed.match(/^<(\d{1,3})>/);

    if (!priorityMatch) {
      return null;
    }

    const priority: number = parseInt(priorityMatch[1]!, 10);

    // Valid PRI is 0-191 (facility 0-23, severity 0-7).
    if (isNaN(priority) || priority > 191) {
      return null;
    }

    const facility: number = Math.floor(priority / 8);
    const severity: number = priority % 8;
    const body: string = trimmed.slice(priorityMatch[0]!.length);

    const base: SyslogMessage = {
      sourceIpAddress: sourceIpAddress,
      facility: facility,
      severity: severity,
      timestamp: receivedAt,
      message: body.trim(),
      receivedAt: receivedAt,
    };

    const parsedBody: ParsedSyslogBody | null =
      SyslogReceiver.parseRfc5424Body(body) ||
      SyslogReceiver.parseRfc3164Body(body);

    if (parsedBody) {
      return {
        ...base,
        timestamp: parsedBody.timestamp || receivedAt,
        hostname: parsedBody.hostname,
        appName: parsedBody.appName,
        message: parsedBody.message,
      };
    }

    // Unrecognized body — keep the whole body with the receive time.
    return base;
  }

  private static parseRfc5424Body(body: string): ParsedSyslogBody | null {
    /*
     * VERSION SP TIMESTAMP SP HOSTNAME SP APP-NAME SP PROCID SP MSGID SP
     * STRUCTURED-DATA [SP MSG] — nil values are "-".
     */
    const match: RegExpMatchArray | null = body.match(
      /^(\d{1,2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*([\s\S]*)$/,
    );

    if (!match) {
      return null;
    }

    const timestampToken: string = match[2]!;
    const hostnameToken: string = match[3]!;
    const appNameToken: string = match[4]!;

    const timestamp: Date | undefined =
      timestampToken !== "-"
        ? OneUptimeDate.parseRfc5424Timestamp(timestampToken)
        : undefined;

    const hostname: string | undefined =
      hostnameToken !== "-" ? hostnameToken : undefined;

    const appName: string | undefined =
      appNameToken !== "-" ? appNameToken : undefined;

    const structuredDataAndMessage: string = (match[7] || "").trimStart();
    let message: string = structuredDataAndMessage;

    if (structuredDataAndMessage.startsWith("-")) {
      message = structuredDataAndMessage.slice(1).trimStart();
    } else if (structuredDataAndMessage.startsWith("[")) {
      message = SyslogReceiver.stripStructuredData(structuredDataAndMessage);
    }

    return {
      timestamp: timestamp,
      hostname: hostname,
      appName: appName,
      message: SyslogReceiver.stripBom(message),
    };
  }

  private static parseRfc3164Body(body: string): ParsedSyslogBody | null {
    // "Mmm dd hh:mm:ss host tag: msg"
    const match: RegExpMatchArray | null = body.match(
      /^([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([\s\S]*)$/,
    );

    if (!match) {
      return null;
    }

    const timestamp: Date | undefined = OneUptimeDate.parseRfc3164Timestamp(
      match[1]!,
    );

    const hostname: string = match[2]!;
    const rest: string = match[3] || "";

    let appName: string | undefined = undefined;
    let message: string = rest.trim();

    // "tag: message" — the tag may carry a pid suffix: "sshd[1234]".
    const tagMatch: RegExpMatchArray | null = rest.match(
      /^([A-Za-z0-9_./-]+)(\[\w+\])?:\s*([\s\S]*)$/,
    );

    if (tagMatch) {
      appName = tagMatch[1];
      message = (tagMatch[3] || "").trim();
    }

    return {
      timestamp: timestamp,
      hostname: hostname,
      appName: appName,
      message: message,
    };
  }

  /*
   * Skips past an RFC 5424 STRUCTURED-DATA block (one or more balanced
   * [sd-id param="value" ...] elements) and returns the trailing MSG part.
   * Bracket characters inside quoted param values are rare enough in
   * network-device syslog that a depth counter is sufficient for phase 1.
   */
  private static stripStructuredData(value: string): string {
    let depth: number = 0;

    for (let i: number = 0; i < value.length; i++) {
      const char: string = value[i]!;

      if (char === "[") {
        depth++;
      } else if (char === "]") {
        depth--;

        if (depth === 0) {
          let peekIndex: number = i + 1;

          while (peekIndex < value.length && value[peekIndex] === " ") {
            peekIndex++;
          }

          if (value[peekIndex] === "[") {
            i = peekIndex - 1;
            continue;
          }

          return value.slice(i + 1).trimStart();
        }
      }
    }

    // Unterminated structured data — no message part.
    return "";
  }

  private static stripBom(value: string): string {
    return value.replace(/^\uFEFF/, "");
  }

  private static async flush(): Promise<void> {
    if (SyslogReceiver.isFlushing || SyslogReceiver.buffer.length === 0) {
      return;
    }

    SyslogReceiver.isFlushing = true;

    try {
      while (SyslogReceiver.buffer.length > 0) {
        const batch: Array<SyslogMessage> = SyslogReceiver.buffer.splice(
          0,
          FLUSH_BATCH_SIZE,
        );

        try {
          /*
           * Build the URL from a fresh copy of PROBE_INGEST_URL — Route
           * .addRoute mutates in place, so calling it on the shared global
           * would permanently append "/probe/syslog" to the base URL used by
           * every probe request.
           */
          const ingestUrl: URL = URL.fromString(
            PROBE_INGEST_URL.toString(),
          ).addRoute("/probe/syslog");

          await API.fetch<JSONObject>({
            method: HTTPMethod.POST,
            url: ingestUrl,
            data: {
              ...ProbeAPIRequest.getDefaultRequestBody(),
              syslogMessages: batch as unknown as Array<JSONObject>,
            },
            options: {
              ...ProxyConfig.getRequestProxyAgents(ingestUrl),
              timeout: FLUSH_REQUEST_TIMEOUT_MS,
            },
          });
        } catch (err) {
          /*
           * Drop the failed batch rather than re-buffering it — syslog is
           * lossy by design (UDP) and re-queueing would grow memory without
           * bound while the server is unreachable.
           */
          logger.error(
            `Syslog receiver failed to forward a batch of ${batch.length} message(s): ${err}`,
          );
        }
      }
    } finally {
      SyslogReceiver.isFlushing = false;
    }
  }

  private static consumeRateLimitSlot(): boolean {
    const now: number = Date.now();

    if (now - SyslogReceiver.minuteWindowStartedAt >= 60000) {
      if (SyslogReceiver.droppedThisMinute > 0) {
        logger.warn(
          `Syslog receiver dropped ${SyslogReceiver.droppedThisMinute} messages in the last minute (rate limit: ${PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE}/min)`,
        );
      }
      SyslogReceiver.minuteWindowStartedAt = now;
      SyslogReceiver.forwardedThisMinute = 0;
      SyslogReceiver.droppedThisMinute = 0;
    }

    if (
      SyslogReceiver.forwardedThisMinute >= PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE
    ) {
      SyslogReceiver.droppedThisMinute++;
      return false;
    }

    SyslogReceiver.forwardedThisMinute++;
    return true;
  }
}
