import {
  PROBE_INGEST_URL,
  PROBE_IPFIX_RECEIVER_PORT,
  PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE,
  PROBE_NETFLOW_RECEIVER_ENABLED,
  PROBE_NETFLOW_RECEIVER_PORT,
  PROBE_SFLOW_RECEIVER_PORT,
} from "../Config";
import FlowAggregator from "../Utils/NetFlow/FlowAggregator";
import FlowDatagramDecoder, {
  FlowDatagramOutcome,
  FlowDatagramResult,
} from "../Utils/NetFlow/FlowDatagramDecoder";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import URL from "Common/Types/API/URL";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import { JSONObject } from "Common/Types/JSON";
import { NetworkFlowCollectorPortsUtil } from "Common/Types/NetFlow/NetworkFlowCollectorPorts";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import dgram from "dgram";

/*
 * The probe's flow collector: NetFlow v5, NetFlow v9, IPFIX and sFlow on
 * UDP 2055, 4739 and 6343 (every port reads every format).
 *
 * Each datagram is decoded (FlowDatagramDecoder) into flow records of one
 * shape. Records of the same conversation that arrive together are summed
 * (FlowAggregator) and forwarded to the ingest endpoint in batches - every
 * FLUSH_INTERVAL_MS, or as soon as FLUSH_RECORD_BATCH_SIZE conversations
 * are waiting - where the server matches them to devices and stores them.
 */
const FLUSH_INTERVAL_MS: number = 5000;

// Upper bound on records per POST.
const FLUSH_RECORD_BATCH_SIZE: number = 1500;

/*
 * Hard cap on conversations waiting to be forwarded. If the ingest
 * endpoint is unreachable (or a forward hangs), the oldest are dropped past
 * it: flow export is lossy by design, and shedding old records under
 * back-pressure is the right trade against running the probe out of memory.
 */
const MAX_BUFFERED_RECORDS: number = FLUSH_RECORD_BATCH_SIZE * 10;

// Give a stuck forward a bounded lifetime so isFlushing can never wedge.
const FLUSH_REQUEST_TIMEOUT_MS: number = 30000;

// How often the collector says what went wrong with whom (once per minute at most).
const PROBLEM_REPORT_INTERVAL_MS: number = 60000;

// Exporters the collector keeps statistics for (the busiest stay).
const MAX_TRACKED_EXPORTERS: number = 2000;

export interface FlowExporterStatistics {
  exporterAddress: string;
  format: string | null;
  datagrams: number;
  flows: number;
  malformedDatagrams: number;
  unsupportedDatagrams: number;
  unsupportedFormat: string | null;
  dataSetsWaitingForTemplate: number;
  droppedDatagrams: number;
  lastSeenAt: number;
}

export interface FlowSource {
  address: string;
  port: number;
}

export default class NetFlowReceiver {
  private static acceptedThisMinute: number = 0;
  private static minuteWindowStartedAt: number = 0;
  private static droppedThisMinute: number = 0;

  private static aggregator: FlowAggregator = new FlowAggregator(
    MAX_BUFFERED_RECORDS,
  );
  private static isFlushing: boolean = false;

  /*
   * One decoder for the life of the process: NetFlow v9 and IPFIX data is
   * decoded with templates learned from earlier datagrams.
   */
  private static decoder: FlowDatagramDecoder = new FlowDatagramDecoder();

  private static exporterStatistics: Map<string, FlowExporterStatistics> =
    new Map();
  private static lastProblemReportAt: number = 0;

  // The UDP ports to listen on, from the probe's settings.
  public static getListeningPorts(): Array<number> {
    return NetworkFlowCollectorPortsUtil.getListeningPorts({
      netFlowPort: PROBE_NETFLOW_RECEIVER_PORT,
      ipfixPort: PROBE_IPFIX_RECEIVER_PORT,
      sFlowPort: PROBE_SFLOW_RECEIVER_PORT,
    });
  }

  public static start(): void {
    if (!PROBE_NETFLOW_RECEIVER_ENABLED) {
      logger.info(
        "Flow collector is off (PROBE_NETFLOW_RECEIVER_ENABLED=false): NetFlow, IPFIX and sFlow are not received.",
      );
      return;
    }

    const ports: Array<number> = NetFlowReceiver.getListeningPorts();

    if (ports.length === 0) {
      logger.info(
        "Flow collector has no port to listen on (every flow receiver port is 0).",
      );
      return;
    }

    for (const port of ports) {
      // IPv4 is the primary: a bind failure there is an error worth reading.
      NetFlowReceiver.startSocket("udp4", port);
      /*
       * IPv6 on the same port, best effort: a host without IPv6 fails this
       * bind, which is logged as a warning while IPv4 keeps receiving.
       */
      NetFlowReceiver.startSocket("udp6", port);
    }

    setInterval(() => {
      NetFlowReceiver.flush().catch((err: Error) => {
        logger.error(`Flow batch forward failed: ${err}`);
      });
      NetFlowReceiver.reportProblems();
    }, FLUSH_INTERVAL_MS);
  }

  private static startSocket(socketType: "udp4" | "udp6", port: number): void {
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
         * Bind failures (the port is taken, no privilege, or - for udp6 -
         * no IPv6 on the host) arrive through this event. Say clearly, once,
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
                `Flow collector could not bind udp6 port ${port} (${errorCode}); this host may not have IPv6. IPv4 reception on port ${port} is unaffected.`,
              );
            } else {
              logger.error(
                `Flow collector could not bind UDP port ${port} (${errorCode}). Flow records sent to this port will not be received; monitoring is unaffected. ` +
                  `Fix: free the port, or move the collector with PROBE_NETFLOW_RECEIVER_PORT / PROBE_IPFIX_RECEIVER_PORT / PROBE_SFLOW_RECEIVER_PORT (0 closes one), ` +
                  `or set PROBE_NETFLOW_RECEIVER_ENABLED=false to turn the collector off.`,
              );
            }
          }
          return;
        }

        /*
         * Per-message socket errors are routine on an open UDP port
         * (scanners, malformed senders) - log and keep listening.
         */
        logger.debug(`Flow collector socket error (${socketType}): ${error}`);
      });

      socket.on("message", (datagram: Buffer, remoteInfo: dgram.RemoteInfo) => {
        try {
          NetFlowReceiver.handleDatagram(datagram, {
            address: remoteInfo.address,
            port: remoteInfo.port,
          });
        } catch (err) {
          logger.debug(`Flow collector message error: ${err}`);
        }
      });

      socket.bind(port);

      // Bind completes asynchronously; failures surface via the error event.
      logger.info(
        `Flow collector listening for NetFlow, IPFIX and sFlow on ${socketType} port ${port}`,
      );
    } catch (err) {
      if (socketType === "udp6") {
        logger.warn(
          `Could not start the flow collector's udp6 socket on port ${port}: ${err}. Continuing with IPv4 only.`,
        );
        return;
      }

      logger.error(
        `Could not start the flow collector on port ${port}: ${err}`,
      );
    }
  }

  public static handleDatagram(
    datagram: Buffer,
    source: FlowSource | string,
  ): void {
    const from: FlowSource =
      typeof source === "string" ? { address: source, port: 0 } : source;

    const result: FlowDatagramResult = NetFlowReceiver.decoder.decode(
      datagram,
      from,
    );

    const statistics: FlowExporterStatistics =
      NetFlowReceiver.getExporterStatistics(result.exporterAddress);

    statistics.datagrams++;
    statistics.lastSeenAt = Date.now();
    statistics.dataSetsWaitingForTemplate += result.dataSetsWaitingForTemplate;

    if (result.format) {
      statistics.format = result.format;
    }

    if (result.outcome === FlowDatagramOutcome.Unsupported) {
      statistics.unsupportedDatagrams++;
      statistics.unsupportedFormat = result.unsupportedFormat;
      return;
    }

    if (result.outcome === FlowDatagramOutcome.Malformed) {
      statistics.malformedDatagrams++;
    }

    /*
     * Templates and option records were learned by decoding; a datagram
     * with no flows in it (templates only, or data still waiting for its
     * template) spends no rate-limit slot.
     */
    if (result.records.length === 0) {
      return;
    }

    // The rate limit counts DATAGRAMS (one export), not flow records.
    if (!NetFlowReceiver.consumeRateLimitSlot()) {
      statistics.droppedDatagrams++;
      return;
    }

    statistics.flows += result.records.length;

    for (const record of result.records) {
      NetFlowReceiver.aggregator.add(record);
    }

    const shed: number = NetFlowReceiver.aggregator.takeDroppedCount();

    if (shed > 0) {
      logger.warn(
        `Flow collector holds more than ${MAX_BUFFERED_RECORDS} conversations waiting to be forwarded; dropped the ${shed} oldest (OneUptime may be unreachable).`,
      );
    }

    if (NetFlowReceiver.aggregator.size >= FLUSH_RECORD_BATCH_SIZE) {
      NetFlowReceiver.flush().catch((err: Error) => {
        logger.error(`Flow batch forward failed: ${err}`);
      });
    }
  }

  private static getExporterStatistics(
    exporterAddress: string,
  ): FlowExporterStatistics {
    let statistics: FlowExporterStatistics | undefined =
      NetFlowReceiver.exporterStatistics.get(exporterAddress);

    if (!statistics) {
      statistics = {
        exporterAddress: exporterAddress,
        format: null,
        datagrams: 0,
        flows: 0,
        malformedDatagrams: 0,
        unsupportedDatagrams: 0,
        unsupportedFormat: null,
        dataSetsWaitingForTemplate: 0,
        droppedDatagrams: 0,
        lastSeenAt: 0,
      };

      NetFlowReceiver.exporterStatistics.set(exporterAddress, statistics);

      // Keep the map bounded: forget the exporter heard from longest ago.
      if (NetFlowReceiver.exporterStatistics.size > MAX_TRACKED_EXPORTERS) {
        let oldestAddress: string | null = null;
        let oldestSeenAt: number = Infinity;

        for (const [address, entry] of NetFlowReceiver.exporterStatistics) {
          if (address !== exporterAddress && entry.lastSeenAt < oldestSeenAt) {
            oldestSeenAt = entry.lastSeenAt;
            oldestAddress = address;
          }
        }

        if (oldestAddress !== null) {
          NetFlowReceiver.exporterStatistics.delete(oldestAddress);
        }
      }
    }

    return statistics;
  }

  // What the collector has heard from each exporter (for the probe's report).
  public static getExporterStatisticsSnapshot(): Array<FlowExporterStatistics> {
    return Array.from(NetFlowReceiver.exporterStatistics.values()).map(
      (statistics: FlowExporterStatistics): FlowExporterStatistics => {
        return { ...statistics };
      },
    );
  }

  /*
   * Once a minute at most, says in the probe's log what kept flows out:
   * formats it does not read, datagrams it could not read, data still
   * waiting for a template, and what the rate limit dropped.
   */
  private static reportProblems(): void {
    const now: number = Date.now();

    if (now - NetFlowReceiver.lastProblemReportAt < PROBLEM_REPORT_INTERVAL_MS) {
      return;
    }

    NetFlowReceiver.lastProblemReportAt = now;

    for (const statistics of NetFlowReceiver.exporterStatistics.values()) {
      if (statistics.unsupportedDatagrams > 0) {
        logger.warn(
          `Flow collector: ${statistics.exporterAddress} sends ${statistics.unsupportedFormat || "a flow format"} (${statistics.unsupportedDatagrams} datagram(s)), which is not supported. Configure it to export NetFlow v9, IPFIX or sFlow v5.`,
        );
      }

      if (statistics.malformedDatagrams > 0) {
        logger.warn(
          `Flow collector: ${statistics.malformedDatagrams} datagram(s) from ${statistics.exporterAddress} could not be read (cut short or not flow export).`,
        );
      }

      if (statistics.dataSetsWaitingForTemplate > 0 && statistics.flows === 0) {
        logger.info(
          `Flow collector: ${statistics.exporterAddress} sends ${statistics.format || "flow"} data, but not yet the templates to read it. They arrive with the device's next template refresh; set its template timeout to 60 seconds so that is soon.`,
        );
      }

      statistics.unsupportedDatagrams = 0;
      statistics.malformedDatagrams = 0;
      statistics.dataSetsWaitingForTemplate = 0;
      statistics.droppedDatagrams = 0;
    }
  }

  private static async flush(): Promise<void> {
    if (NetFlowReceiver.isFlushing || NetFlowReceiver.aggregator.size === 0) {
      return;
    }

    NetFlowReceiver.isFlushing = true;

    try {
      while (NetFlowReceiver.aggregator.size > 0) {
        const batch: Array<NetworkFlowRecord> =
          NetFlowReceiver.aggregator.drain(FLUSH_RECORD_BATCH_SIZE);

        try {
          /*
           * Build the URL from a fresh copy of PROBE_INGEST_URL - Route
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
            options: ProbeAPIRequest.getDefaultRequestOptions(ingestUrl, {
              timeout: FLUSH_REQUEST_TIMEOUT_MS,
            }),
          });
        } catch (err) {
          /*
           * Drop the failed batch rather than re-buffering it - flow export
           * is lossy by design (UDP), and re-queueing would grow memory
           * without bound while the server is unreachable.
           */
          logger.error(
            `Flow collector failed to forward a batch of ${batch.length} flow record(s): ${err}`,
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
          `Flow collector dropped ${NetFlowReceiver.droppedThisMinute} datagram(s) in the last minute (limit ${PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE} a minute): the Traffic pages are missing that traffic. Raise PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE if this probe has the room.`,
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
