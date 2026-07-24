import {
  PROBE_INGEST_URL,
  PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE,
  PROBE_NETFLOW_RECEIVER_ENABLED,
  PROBE_NETFLOW_RECEIVER_PORT,
} from "../Config";
import NetFlowV5Parser, {
  NetFlowV5Record,
  ParsedNetFlowV5Datagram,
} from "../Utils/NetFlow/NetFlowV5Parser";
import NetFlowV9Parser, {
  NetFlowV9Record,
  ParsedNetFlowV9Datagram,
} from "../Utils/NetFlow/NetFlowV9Parser";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import ProxyConfig from "../Utils/ProxyConfig";
import URL from "Common/Types/API/URL";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import { JSONObject } from "Common/Types/JSON";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import dgram from "dgram";

/*
 * NetFlow exports arrive continuously from routers, so flow records are
 * buffered and flushed to the ingest endpoint in batches — every
 * FLUSH_INTERVAL_MS or once FLUSH_DATAGRAM_BATCH_SIZE datagrams' worth of
 * records accumulate, whichever comes first. A v5 datagram carries up to
 * 30 records (a v9 datagram lands in the same ballpark — the MTU caps how
 * many template-sized records fit), so a datagram-count trigger roughly
 * bounds the batch at FLUSH_DATAGRAM_BATCH_SIZE * 30 records; the flush
 * loop's FLUSH_RECORD_BATCH_SIZE splice hard-caps each POST regardless.
 */
const FLUSH_INTERVAL_MS: number = 5000;
const FLUSH_DATAGRAM_BATCH_SIZE: number = 50;

// Upper bound on records per POST (50 datagrams * 30 records each).
const FLUSH_RECORD_BATCH_SIZE: number = FLUSH_DATAGRAM_BATCH_SIZE * 30;

/*
 * Hard cap on buffered records. If the ingest endpoint is unreachable (or a
 * forward hangs), incoming datagrams would otherwise grow the buffer without
 * bound; past this many records the oldest are dropped. NetFlow is lossy by
 * design, so shedding old records under back-pressure is the correct trade.
 */
const MAX_BUFFERED_RECORDS: number = FLUSH_RECORD_BATCH_SIZE * 10;

// Give a stuck forward a bounded lifetime so isFlushing can never wedge.
const FLUSH_REQUEST_TIMEOUT_MS: number = 30000;

/*
 * Both NetFlow versions put the version number in the first two bytes of
 * the datagram, so it can be peeked before choosing a parser.
 */
const NETFLOW_V5_VERSION: number = 5;
const NETFLOW_V9_VERSION: number = 9;

export default class NetFlowReceiver {
  private static acceptedThisMinute: number = 0;
  private static minuteWindowStartedAt: number = 0;
  private static droppedThisMinute: number = 0;

  private static buffer: Array<NetworkFlowRecord> = [];
  private static bufferedDatagramCount: number = 0;
  private static isFlushing: boolean = false;

  /*
   * v9 parsing is stateful — data FlowSets are decoded with templates
   * learned from earlier datagrams — so the receiver keeps one parser
   * instance whose template cache persists for the life of the process.
   */
  private static netFlowV9Parser: NetFlowV9Parser = new NetFlowV9Parser();

  public static start(): void {
    if (!PROBE_NETFLOW_RECEIVER_ENABLED) {
      logger.debug(
        "NetFlow receiver is disabled (PROBE_NETFLOW_RECEIVER_ENABLED=false).",
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
         * event. Say clearly — once — that NetFlow is off and how to
         * fix it; polling is unaffected either way.
         */
        if (errorCode === "EACCES" || errorCode === "EADDRINUSE") {
          if (!hasLoggedBindFailure) {
            hasLoggedBindFailure = true;
            logger.error(
              `NetFlow receiver could not bind UDP port ${PROBE_NETFLOW_RECEIVER_PORT} (${errorCode}). ` +
                `NetFlow exports will not be received; monitoring checks are unaffected. ` +
                `Fix: free the port or set PROBE_NETFLOW_RECEIVER_PORT to another port, ` +
                `or set PROBE_NETFLOW_RECEIVER_ENABLED=false to silence this.`,
            );
          }
          return;
        }

        /*
         * Per-message socket errors are routine on an open UDP port
         * (scanners, malformed senders) — log and keep listening.
         */
        logger.debug(`NetFlow receiver socket error: ${error}`);
      });

      socket.on("message", (datagram: Buffer, remoteInfo: dgram.RemoteInfo) => {
        try {
          NetFlowReceiver.handleDatagram(datagram, remoteInfo.address);
        } catch (err) {
          logger.debug(`NetFlow receiver message error: ${err}`);
        }
      });

      socket.bind(PROBE_NETFLOW_RECEIVER_PORT);

      setInterval(() => {
        NetFlowReceiver.flush().catch((err: Error) => {
          logger.error(`NetFlow batch forward failed: ${err}`);
        });
      }, FLUSH_INTERVAL_MS);

      // Bind completes asynchronously; failures surface via the error event.
      logger.info(
        `NetFlow receiver starting on UDP port ${PROBE_NETFLOW_RECEIVER_PORT}`,
      );
    } catch (err) {
      /*
       * Binding can fail (port in use, no privilege for ports < 1024).
       * The probe's polling duties are unaffected — log loudly and move on.
       */
      logger.error(
        `Could not start NetFlow receiver on port ${PROBE_NETFLOW_RECEIVER_PORT}: ${err}`,
      );
    }
  }

  private static handleDatagram(
    datagram: Buffer,
    exporterIpAddress: string,
  ): void {
    // Both versions carry the version number in the first two bytes.
    if (datagram.length < 2) {
      logger.debug(
        `NetFlow receiver skipped malformed datagram from ${exporterIpAddress}`,
      );
      return;
    }

    const version: number = datagram.readUInt16BE(0);

    let records: Array<NetworkFlowRecord>;

    if (version === NETFLOW_V5_VERSION) {
      const parsed: ParsedNetFlowV5Datagram | null =
        NetFlowV5Parser.parse(datagram);

      if (!parsed) {
        logger.debug(
          `NetFlow receiver skipped malformed v5 datagram from ${exporterIpAddress}`,
        );
        return;
      }

      records = parsed.records.map((record: NetFlowV5Record) => {
        return NetFlowReceiver.toNetworkFlowRecord(record, exporterIpAddress);
      });
    } else if (version === NETFLOW_V9_VERSION) {
      const parsed: ParsedNetFlowV9Datagram | null =
        NetFlowReceiver.netFlowV9Parser.parse(datagram, exporterIpAddress);

      if (!parsed) {
        logger.debug(
          `NetFlow receiver skipped malformed v9 datagram from ${exporterIpAddress}`,
        );
        return;
      }

      /*
       * Routine right after an exporter (or this probe) restarts: data
       * arrives before the exporter's periodic template refresh. The
       * records are unrecoverable, but templates in THIS datagram were
       * still learned above, so subsequent data decodes.
       */
      if (parsed.dataFlowSetsSkippedForUnknownTemplate > 0) {
        logger.debug(
          `NetFlow receiver skipped ${parsed.dataFlowSetsSkippedForUnknownTemplate} v9 data FlowSet(s) from ${exporterIpAddress} (template not yet received)`,
        );
      }

      records = parsed.records.map((record: NetFlowV9Record) => {
        return NetFlowReceiver.toNetworkFlowRecord(record, exporterIpAddress);
      });
    } else {
      logger.debug(
        `NetFlow receiver skipped unsupported NetFlow version ${version} datagram from ${exporterIpAddress}`,
      );
      return;
    }

    // Rate limit counts DATAGRAMS (one router export), not flow records.
    if (!NetFlowReceiver.consumeRateLimitSlot()) {
      return;
    }

    for (const record of records) {
      NetFlowReceiver.buffer.push(record);
    }

    /*
     * Shed the oldest records if the buffer has outgrown its cap (server
     * unreachable / forward hung). Bounds memory; the dropped-count warning
     * rides the existing rate-limit reporting cadence.
     */
    if (NetFlowReceiver.buffer.length > MAX_BUFFERED_RECORDS) {
      const overflow: number =
        NetFlowReceiver.buffer.length - MAX_BUFFERED_RECORDS;
      NetFlowReceiver.buffer.splice(0, overflow);
      logger.warn(
        `NetFlow receiver buffer exceeded ${MAX_BUFFERED_RECORDS} records; dropped ${overflow} oldest record(s) (ingest may be unreachable).`,
      );
    }

    NetFlowReceiver.bufferedDatagramCount++;

    if (NetFlowReceiver.bufferedDatagramCount >= FLUSH_DATAGRAM_BATCH_SIZE) {
      NetFlowReceiver.flush().catch((err: Error) => {
        logger.error(`NetFlow batch forward failed: ${err}`);
      });
    }
  }

  /*
   * v5 and v9 records share the field names NetworkFlowRecord needs (the
   * v9 parser mirrors the v5 record shape on purpose), so one mapping
   * covers both.
   */
  private static toNetworkFlowRecord(
    record: NetFlowV5Record | NetFlowV9Record,
    exporterIpAddress: string,
  ): NetworkFlowRecord {
    return {
      exporterIpAddress: exporterIpAddress,
      sourceIpAddress: record.sourceIpAddress,
      destinationIpAddress: record.destinationIpAddress,
      sourcePort: record.sourcePort,
      destinationPort: record.destinationPort,
      protocolNumber: record.protocolNumber,
      octets: record.octets,
      packets: record.packets,
      flowStartAt: record.flowStartAt,
      flowEndAt: record.flowEndAt,
      inputInterfaceIndex: record.inputInterfaceIndex,
      outputInterfaceIndex: record.outputInterfaceIndex,
      tcpFlags: record.tcpFlags,
      tos: record.tos,
    };
  }

  private static async flush(): Promise<void> {
    if (NetFlowReceiver.isFlushing || NetFlowReceiver.buffer.length === 0) {
      return;
    }

    NetFlowReceiver.isFlushing = true;
    NetFlowReceiver.bufferedDatagramCount = 0;

    try {
      while (NetFlowReceiver.buffer.length > 0) {
        const batch: Array<NetworkFlowRecord> = NetFlowReceiver.buffer.splice(
          0,
          FLUSH_RECORD_BATCH_SIZE,
        );

        try {
          /*
           * Build the URL from a fresh copy of PROBE_INGEST_URL — Route
           * .addRoute mutates in place, so calling it on the shared global
           * would permanently append "/probe/network-flow" to the base URL
           * used by every probe request.
           */
          const ingestUrl: URL = URL.fromString(
            PROBE_INGEST_URL.toString(),
          ).addRoute("/probe/network-flow");

          await API.fetch<JSONObject>({
            method: HTTPMethod.POST,
            url: ingestUrl,
            data: {
              ...ProbeAPIRequest.getDefaultRequestBody(),
              flowRecords: batch as unknown as Array<JSONObject>,
            },
            options: {
              ...ProxyConfig.getRequestProxyAgents(ingestUrl),
              timeout: FLUSH_REQUEST_TIMEOUT_MS,
            },
          });
        } catch (err) {
          /*
           * Drop the failed batch rather than re-buffering it — NetFlow is
           * lossy by design (UDP) and re-queueing would grow memory without
           * bound while the server is unreachable.
           */
          logger.error(
            `NetFlow receiver failed to forward a batch of ${batch.length} flow record(s): ${err}`,
          );
        }
      }
    } finally {
      NetFlowReceiver.isFlushing = false;
    }
  }

  private static consumeRateLimitSlot(): boolean {
    const now: number = Date.now();

    if (now - NetFlowReceiver.minuteWindowStartedAt >= 60000) {
      if (NetFlowReceiver.droppedThisMinute > 0) {
        logger.warn(
          `NetFlow receiver dropped ${NetFlowReceiver.droppedThisMinute} datagrams in the last minute (rate limit: ${PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE}/min)`,
        );
      }
      NetFlowReceiver.minuteWindowStartedAt = now;
      NetFlowReceiver.acceptedThisMinute = 0;
      NetFlowReceiver.droppedThisMinute = 0;
    }

    if (
      NetFlowReceiver.acceptedThisMinute >= PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE
    ) {
      NetFlowReceiver.droppedThisMinute++;
      return false;
    }

    NetFlowReceiver.acceptedThisMinute++;
    return true;
  }
}
