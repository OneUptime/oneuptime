import {
  PROBE_INGEST_URL,
  PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE,
  PROBE_SYSLOG_RECEIVER_ENABLED,
  PROBE_SYSLOG_RECEIVER_PORT,
} from "../Config";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import SyslogStreamFramer from "../Utils/Syslog/SyslogStreamFramer";
import URL from "Common/Types/API/URL";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import { JSONObject } from "Common/Types/JSON";
import SyslogMessage, {
  MAX_SYSLOG_RAW_LENGTH,
} from "Common/Types/Syslog/SyslogMessage";
import OneUptimeDate from "Common/Types/Date";
import API from "Common/Utils/API";
import SyslogEventNormalizer from "Common/Utils/Syslog/SyslogEventNormalizer";
import {
  ParsedSyslogMessage,
  parseSyslogMessage,
} from "Common/Utils/Syslog/SyslogMessageParser";
import {
  DEFAULT_SYSLOG_FACILITY,
  DEFAULT_SYSLOG_SEVERITY,
} from "Common/Utils/Syslog/SyslogSeverity";
import logger from "Common/Server/Utils/Logger";
import dgram from "dgram";
import net from "net";

/*
 * THE PROBE'S SYSLOG RECEIVER.
 *
 * Network devices are pointed at the probe; the probe hears their syslog
 * on one port - over UDP (one datagram, one message) and over TCP (RFC
 * 6587, see SyslogStreamFramer) - and forwards it to the OneUptime
 * instance in batches. The instance works out which device a message is
 * from, what its vendor's format says and whether it is an event; the
 * probe only has to deliver the line as the device wrote it.
 *
 * Syslog volume is far higher than SNMP traps, so messages are buffered and
 * flushed to the ingest endpoint in batches - every FLUSH_INTERVAL_MS or
 * once FLUSH_BATCH_SIZE messages accumulate, whichever comes first.
 * Per-message POSTs would not keep up.
 */
const FLUSH_INTERVAL_MS: number = 5000;
const FLUSH_BATCH_SIZE: number = 100;

/*
 * Hard cap on buffered messages. If the ingest endpoint is unreachable (or a
 * forward hangs), incoming messages would otherwise grow the buffer without
 * bound; past this many messages the oldest are dropped. Syslog is lossy by
 * design, so shedding old messages under back-pressure is correct.
 */
const MAX_BUFFERED_MESSAGES: number = FLUSH_BATCH_SIZE * 50;

/*
 * ...and on the text they hold. A message is usually a few hundred
 * characters, but a sender may fill a whole datagram with one, and five
 * thousand of those is more memory than a probe should spend on a buffer.
 */
const MAX_BUFFERED_CHARACTERS: number = 32 * 1024 * 1024;

// Give a stuck forward a bounded lifetime so isFlushing can never wedge.
const FLUSH_REQUEST_TIMEOUT_MS: number = 30000;

/*
 * TCP connections held open at once, per address family. A device keeps
 * one connection for as long as it is up, so this is how many devices can
 * send over TCP to one probe; UDP has no such limit.
 */
const MAX_TCP_CONNECTIONS: number = 512;

/*
 * A device that is switched off never closes its connection. Keep-alive
 * probes find the ones nobody is at the other end of, so they do not use
 * up the connections above; a device that is merely quiet stays connected.
 */
const TCP_KEEP_ALIVE_INITIAL_DELAY_MS: number = 60000;

// Characters that mark binary data rather than a line of text.
const TAB: number = 0x09;
const FIRST_PRINTABLE: number = 0x20;
const DELETE: number = 0x7f;
const REPLACEMENT_CHARACTER: number = 0xfffd;

const LETTER_OR_DIGIT: RegExp = /[A-Za-z0-9]/;

// An IPv4 address a dual-stack socket reports as "::ffff:10.0.0.2".
const IPV4_MAPPED_PREFIX: string = "::ffff:";

// A message, and the reading of its header it was built from.
interface ReadSyslogLine {
  message: SyslogMessage;
  parsed: ParsedSyslogMessage;
}

export default class SyslogReceiver {
  private static forwardedThisMinute: number = 0;
  private static minuteWindowStartedAt: number = 0;
  private static droppedThisMinute: number = 0;
  private static eventsKeptPastLimitThisMinute: number = 0;

  private static buffer: Array<SyslogMessage> = [];
  private static bufferedCharacters: number = 0;
  private static isFlushing: boolean = false;

  public static start(): void {
    if (!PROBE_SYSLOG_RECEIVER_ENABLED) {
      logger.debug(
        "Syslog receiver is disabled (PROBE_SYSLOG_RECEIVER_ENABLED=false).",
      );
      return;
    }

    // IPv4 socket — the primary; bind failures are loud errors.
    SyslogReceiver.startSocket("udp4");

    /*
     * IPv6 socket — best effort, same port and handler. A host without
     * IPv6 fails this bind; that is logged as a warning and IPv4
     * reception continues unaffected.
     */
    SyslogReceiver.startSocket("udp6");

    // The same port over TCP, for devices and relays that send it that way.
    SyslogReceiver.startTcpServer("IPv4");
    SyslogReceiver.startTcpServer("IPv6");

    setInterval(() => {
      SyslogReceiver.flush().catch((err: Error) => {
        logger.error(`Syslog batch forward failed: ${err}`);
      });
    }, FLUSH_INTERVAL_MS);
  }

  private static startSocket(socketType: "udp4" | "udp6"): void {
    let hasLoggedBindFailure: boolean = false;

    try {
      const socket: dgram.Socket = dgram.createSocket({
        type: socketType,
        /*
         * The udp6 socket must be v6-only: a dual-stack [::] bind collides
         * (EADDRINUSE on Linux) with the udp4 socket already bound to
         * 0.0.0.0 on the same port.
         */
        ipv6Only: socketType === "udp6",
      });

      socket.on("error", (error: Error) => {
        const errorCode: string | undefined = (error as NodeJS.ErrnoException)
          .code;

        /*
         * Socket-level bind failures (no privilege for ports < 1024
         * outside Docker, the port is taken, or — for udp6 — the host
         * has no IPv6) arrive through this event. Say clearly — once —
         * what is off and how to fix it; polling is unaffected either way.
         */
        if (
          errorCode === "EACCES" ||
          errorCode === "EADDRINUSE" ||
          errorCode === "EAFNOSUPPORT" ||
          errorCode === "EADDRNOTAVAIL"
        ) {
          if (!hasLoggedBindFailure) {
            hasLoggedBindFailure = true;

            if (socketType === "udp6") {
              logger.warn(
                `Syslog receiver could not bind udp6 port ${PROBE_SYSLOG_RECEIVER_PORT} (${errorCode}); ` +
                  `this host may not have IPv6. IPv6 syslog will not be received; IPv4 reception is unaffected.`,
              );
            } else {
              logger.error(
                `Syslog receiver could not bind UDP port ${PROBE_SYSLOG_RECEIVER_PORT} (${errorCode}). ` +
                  `Syslog messages will not be received; monitoring checks are unaffected. ` +
                  `Fix: run the probe with privileges for low ports, or set PROBE_SYSLOG_RECEIVER_PORT to a port above 1024, ` +
                  `or set PROBE_SYSLOG_RECEIVER_ENABLED=false to silence this.`,
              );
            }
          }
          return;
        }

        /*
         * Per-message socket errors are routine on an open UDP port
         * (scanners, malformed senders) — log and keep listening.
         */
        logger.debug(`Syslog receiver socket error (${socketType}): ${error}`);
      });

      socket.on("message", (datagram: Buffer, remoteInfo: dgram.RemoteInfo) => {
        try {
          SyslogReceiver.handleDatagram(datagram, remoteInfo.address);
        } catch (err) {
          logger.debug(`Syslog receiver message error: ${err}`);
        }
      });

      socket.bind(PROBE_SYSLOG_RECEIVER_PORT);

      // Bind completes asynchronously; failures surface via the error event.
      logger.info(
        `Syslog receiver starting on ${socketType} port ${PROBE_SYSLOG_RECEIVER_PORT}`,
      );
    } catch (err) {
      /*
       * Binding can fail (port in use, no privilege for ports < 1024, no
       * IPv6 on the host). The probe's polling duties are unaffected —
       * log and move on; a udp6 failure still leaves udp4 receiving.
       */
      if (socketType === "udp6") {
        logger.warn(
          `Could not start syslog receiver udp6 socket on port ${PROBE_SYSLOG_RECEIVER_PORT}: ${err}. Continuing with IPv4 only.`,
        );
        return;
      }

      logger.error(
        `Could not start syslog receiver on port ${PROBE_SYSLOG_RECEIVER_PORT}: ${err}`,
      );
    }
  }

  /*
   * The TCP listener, on the same port number as the UDP one. As there:
   * IPv4 is the primary, IPv6 is best effort, and a listener that cannot
   * bind says so once and leaves everything else running - UDP syslog
   * included.
   */
  private static startTcpServer(family: "IPv4" | "IPv6"): void {
    let hasLoggedBindFailure: boolean = false;

    try {
      const server: net.Server = net.createServer((socket: net.Socket) => {
        SyslogReceiver.handleConnection(socket);
      });

      server.maxConnections = MAX_TCP_CONNECTIONS;

      server.on("error", (error: Error) => {
        const errorCode: string | undefined = (error as NodeJS.ErrnoException)
          .code;

        if (hasLoggedBindFailure) {
          return;
        }

        hasLoggedBindFailure = true;

        if (family === "IPv6") {
          logger.warn(
            `Syslog receiver could not listen on IPv6 TCP port ${PROBE_SYSLOG_RECEIVER_PORT} (${errorCode}); ` +
              `this host may not have IPv6. Syslog over TCP is still received over IPv4.`,
          );
          return;
        }

        logger.error(
          `Syslog receiver could not listen on TCP port ${PROBE_SYSLOG_RECEIVER_PORT} (${errorCode}). ` +
            `Syslog sent over TCP will not be received; syslog over UDP and monitoring checks are unaffected. ` +
            `Fix: set PROBE_SYSLOG_RECEIVER_PORT to a free port above 1024, ` +
            `or set PROBE_SYSLOG_RECEIVER_ENABLED=false to silence this.`,
        );
      });

      server.listen({
        port: PROBE_SYSLOG_RECEIVER_PORT,
        host: family === "IPv6" ? "::" : "0.0.0.0",
        // As with UDP: [::] must not also claim the IPv4 port.
        ipv6Only: family === "IPv6",
      });

      logger.info(
        `Syslog receiver starting on ${family} TCP port ${PROBE_SYSLOG_RECEIVER_PORT}`,
      );
    } catch (err) {
      if (family === "IPv6") {
        logger.warn(
          `Could not start syslog receiver IPv6 TCP listener on port ${PROBE_SYSLOG_RECEIVER_PORT}: ${err}. Continuing with IPv4 only.`,
        );
        return;
      }

      logger.error(
        `Could not start syslog receiver TCP listener on port ${PROBE_SYSLOG_RECEIVER_PORT}: ${err}`,
      );
    }
  }

  /*
   * One device's TCP connection: its bytes are cut into messages, and each
   * message is handled like a datagram from the same address. The probe
   * never writes to the connection - syslog has nothing to say back.
   */
  public static handleConnection(connection: net.Socket): void {
    const sourceIpAddress: string = SyslogReceiver.toSourceIpAddress(
      connection.remoteAddress,
    );

    if (!sourceIpAddress) {
      // Closed before it could be read: nobody to attribute anything to.
      connection.destroy();
      return;
    }

    const framer: SyslogStreamFramer = new SyslogStreamFramer();

    connection.setKeepAlive(true, TCP_KEEP_ALIVE_INITIAL_DELAY_MS);

    const handleLines: (lines: Array<string>) => void = (
      lines: Array<string>,
    ): void => {
      for (const line of lines) {
        try {
          SyslogReceiver.handleLine(line, sourceIpAddress);
        } catch (err) {
          logger.debug(`Syslog receiver message error: ${err}`);
        }
      }
    };

    connection.on("data", (chunk: Buffer | string): void => {
      handleLines(
        framer.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
      );

      if (framer.isBroken) {
        logger.debug(
          `Syslog receiver closed a TCP connection from ${sourceIpAddress}: what it sent is not syslog.`,
        );
        connection.destroy();
      }
    });

    connection.on("end", (): void => {
      handleLines(framer.end());
    });

    // A reset connection is routine (a device rebooting): nothing to do.
    connection.on("error", (error: Error): void => {
      logger.debug(
        `Syslog receiver TCP connection error (${sourceIpAddress}): ${error}`,
      );
    });
  }

  // The sender's address as a device's address is written.
  private static toSourceIpAddress(address: string | undefined): string {
    let value: string = (address || "").trim();

    if (value.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)) {
      const mapped: string = value.slice(IPV4_MAPPED_PREFIX.length);

      if (net.isIPv4(mapped)) {
        value = mapped;
      }
    }

    // "fe80::1%eth0": the interface it arrived on is not part of the address.
    const zoneIndex: number = value.indexOf("%");

    return zoneIndex === -1 ? value : value.slice(0, zoneIndex);
  }

  private static handleDatagram(
    datagram: Buffer,
    sourceIpAddress: string,
  ): void {
    SyslogReceiver.handleLine(datagram.toString("utf8"), sourceIpAddress);
  }

  // One message, however it arrived.
  private static handleLine(line: string, sourceIpAddress: string): void {
    const read: ReadSyslogLine | null = SyslogReceiver.readLine(
      line,
      sourceIpAddress,
      OneUptimeDate.getCurrentDate(),
    );

    if (!read) {
      logger.debug(
        `Syslog receiver skipped malformed message from ${sourceIpAddress}`,
      );
      return;
    }

    if (!SyslogReceiver.consumeRateLimitSlot(read.parsed)) {
      return;
    }

    SyslogReceiver.buffer.push(read.message);
    SyslogReceiver.bufferedCharacters += SyslogReceiver.sizeOf(read.message);

    /*
     * Shed the oldest messages if the buffer has outgrown its cap (server
     * unreachable / forward hung), to bound memory.
     */
    let overflow: number = 0;

    while (
      SyslogReceiver.buffer.length > MAX_BUFFERED_MESSAGES ||
      (SyslogReceiver.bufferedCharacters > MAX_BUFFERED_CHARACTERS &&
        SyslogReceiver.buffer.length > 1)
    ) {
      const shed: SyslogMessage | undefined = SyslogReceiver.buffer.shift();

      if (!shed) {
        break;
      }

      SyslogReceiver.bufferedCharacters -= SyslogReceiver.sizeOf(shed);
      overflow++;
    }

    if (overflow > 0) {
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

  // The characters a buffered message holds on to.
  private static sizeOf(message: SyslogMessage): number {
    return message.message.length + (message.raw?.length || 0);
  }

  /*
   * Reads one message as a device sent it: RFC 5424
   * ("<PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD MSG"), RFC 3164
   * ("<PRI>Mmm dd hh:mm:ss host tag: msg"), or neither. The header is read
   * by the reader the OneUptime instance uses too (SyslogMessageParser), so
   * the two never disagree about what a line says; the line itself goes
   * along as `raw`, which is what the instance's vendor parsers read.
   *
   * Devices routinely send syslog that is slightly off, and dropping it
   * would lose data:
   *
   *   - A valid <PRI> and an unreadable header: kept, with everything after
   *     the priority as the message.
   *   - No <PRI> at all: kept when it is a line of text, as user.notice -
   *     what RFC 3164 has a relay assume. RouterOS sends its default and
   *     CEF formats this way.
   *
   * What is not a message returns null: nothing at all, a priority that
   * cannot be one ("<192>", "<abc>"), and bytes that are not text.
   */
  public static parseMessage(
    raw: string,
    sourceIpAddress: string,
    receivedAt: Date,
  ): SyslogMessage | null {
    return (
      SyslogReceiver.readLine(raw, sourceIpAddress, receivedAt)?.message || null
    );
  }

  private static readLine(
    raw: string,
    sourceIpAddress: string,
    receivedAt: Date,
  ): ReadSyslogLine | null {
    const line: string = SyslogReceiver.withoutPadding(raw).slice(
      0,
      MAX_SYSLOG_RAW_LENGTH,
    );

    if (!line) {
      return null;
    }

    const parsed: ParsedSyslogMessage | null = parseSyslogMessage(line);

    if (!parsed) {
      return null;
    }

    if (parsed.priority === undefined) {
      // "<abc>...": where a priority goes, and it is not one.
      if (line.startsWith("<") || !SyslogReceiver.isLineOfText(line)) {
        return null;
      }
    } else if (
      isNaN(parsed.priority) ||
      parsed.priority > 191 ||
      parsed.facility === undefined ||
      parsed.severity === undefined
    ) {
      // Valid PRI is 0-191 (facility 0-23, severity 0-7).
      return null;
    }

    const message: SyslogMessage = {
      sourceIpAddress: sourceIpAddress,
      facility: parsed.facility ?? DEFAULT_SYSLOG_FACILITY,
      severity: parsed.severity ?? DEFAULT_SYSLOG_SEVERITY,
      timestamp: parsed.timestamp || receivedAt,
      message: parsed.message,
      receivedAt: receivedAt,
      raw: parsed.raw,
    };

    if (parsed.hostname) {
      message.hostname = parsed.hostname;
    }

    if (parsed.appName) {
      message.appName = parsed.appName;
    }

    return { message: message, parsed: parsed };
  }

  // Without the white space and NULs some senders pad a message with.
  private static withoutPadding(raw: string): string {
    let end: number = (raw || "").length;

    while (end > 0 && raw.charCodeAt(end - 1) === 0) {
      end--;
    }

    return (raw || "").slice(0, end).trim();
  }

  /*
   * A line without a priority is taken only when it reads as text: it has
   * a letter or a digit, and no control characters and nothing that was
   * not valid UTF-8. An open UDP port hears other things than syslog
   * (scanners, a device pointed at the wrong port), and those are not
   * logs.
   */
  private static isLineOfText(line: string): boolean {
    if (!LETTER_OR_DIGIT.test(line)) {
      return false;
    }

    for (let index: number = 0; index < line.length; index++) {
      const code: number = line.charCodeAt(index);

      if (
        (code < FIRST_PRINTABLE && code !== TAB) ||
        code === DELETE ||
        code === REPLACEMENT_CHARACTER
      ) {
        return false;
      }
    }

    return true;
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

        for (const message of batch) {
          SyslogReceiver.bufferedCharacters -= SyslogReceiver.sizeOf(message);
        }

        if (SyslogReceiver.buffer.length === 0) {
          SyslogReceiver.bufferedCharacters = 0;
        }

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
            options: ProbeAPIRequest.getDefaultRequestOptions(ingestUrl, {
              timeout: FLUSH_REQUEST_TIMEOUT_MS,
            }),
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

  /*
   * The rate limit, with one exception to it.
   *
   * A firewall that logs every connection sends thousands of lines a
   * minute, and a limit that sheds whatever comes next would shed the one
   * line that matters - the link that just went down - as readily as the
   * ten thousand that do not. So past the limit the probe still forwards
   * what it recognises as a network event, on an allowance of the same
   * size; everything else is dropped until the minute is over.
   *
   * Under the limit nothing is inspected: a line is only read for its
   * event when the alternative is dropping it.
   */
  private static consumeRateLimitSlot(parsed: ParsedSyslogMessage): boolean {
    const now: number = Date.now();

    if (now - SyslogReceiver.minuteWindowStartedAt >= 60000) {
      if (SyslogReceiver.droppedThisMinute > 0) {
        logger.warn(
          `Syslog receiver dropped ${SyslogReceiver.droppedThisMinute} messages in the last minute (rate limit: ${PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE}/min)` +
            (SyslogReceiver.eventsKeptPastLimitThisMinute > 0
              ? `; forwarded ${SyslogReceiver.eventsKeptPastLimitThisMinute} past the limit because they are network events`
              : ""),
        );
      }
      SyslogReceiver.minuteWindowStartedAt = now;
      SyslogReceiver.forwardedThisMinute = 0;
      SyslogReceiver.droppedThisMinute = 0;
      SyslogReceiver.eventsKeptPastLimitThisMinute = 0;
    }

    if (
      SyslogReceiver.forwardedThisMinute < PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE
    ) {
      SyslogReceiver.forwardedThisMinute++;
      return true;
    }

    if (
      SyslogReceiver.eventsKeptPastLimitThisMinute <
        PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE &&
      SyslogReceiver.isNetworkEvent(parsed)
    ) {
      SyslogReceiver.eventsKeptPastLimitThisMinute++;
      return true;
    }

    SyslogReceiver.droppedThisMinute++;
    return false;
  }

  // Whether a vendor parser reads the line as something that happened.
  private static isNetworkEvent(parsed: ParsedSyslogMessage): boolean {
    try {
      return Boolean(SyslogEventNormalizer.normalizeParsed(parsed).eventName);
    } catch {
      return false;
    }
  }
}
