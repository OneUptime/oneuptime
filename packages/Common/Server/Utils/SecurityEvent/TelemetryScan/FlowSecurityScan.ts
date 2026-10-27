import { ResponseJSON } from "@clickhouse/client";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  FlowPairRow,
  FlowWindow,
  LARGE_TRANSFER_MIN_BYTES,
  MAX_FLOW_ROWS_PER_SIGNAL,
  NETWORK_SWEEP_MIN_HOSTS,
  NetworkSweepRow,
  PORT_SCAN_MIN_PORTS,
  PortScanRow,
  buildLargeTransferEvent,
  buildNetworkSweepEvent,
  buildPortScanEvent,
  buildThreatIntelTrafficEvent,
  selectThreatIntelCandidates,
} from "../../../../Utils/SecurityEvent/TelemetryScan/FlowSignals";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import NetworkFlowService from "../../../Services/NetworkFlowService";
import ThreatIntelIndicatorService, {
  ActiveIndicator,
} from "../../../Services/ThreatIntelIndicatorService";
import { Statement } from "../../AnalyticsDatabase/Statement";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  TelemetryScanWindow,
  buildFlowAddressesStatement,
  buildFlowsOfAddressesStatement,
  buildLargeTransferStatement,
  buildNetworkSweepStatement,
  buildPortScanStatement,
} from "./TelemetryScanStatements";
import {
  readRowDate,
  readRowNumber,
  readRowNumberArray,
  readRowText,
  readRowTextArray,
} from "./TelemetryScanRows";
import { TelemetryWindowRead } from "./TelemetryScanTypes";

/*
 * "Your OneUptime data" - network flows: a window of arrived flow records,
 * summed per address and pair by the database, read for port scans,
 * network sweeps and large transfers out, and - when the project has threat
 * intel - for traffic with an address a feed knows
 * (Utils/SecurityEvent/TelemetryScan/FlowSignals.ts).
 *
 * A window is read whole, in a few summing queries that each return at most
 * MAX_FLOW_ROWS_PER_SIGNAL rows. The threat-intel check asks about the
 * window's MAX_THREAT_INTEL_ADDRESSES busiest public addresses, then reads
 * the traffic of the ones a feed knows. A threat-intel lookup that fails is
 * logged and the window's other findings are still stored.
 */

// The busiest public addresses of a window threat intel is asked about.
export const MAX_THREAT_INTEL_ADDRESSES: number = 2000;

// The addresses of a window the database is asked for, before the public ones are kept.
export const MAX_FLOW_ADDRESSES_READ: number = 5000;

function toPortScanRow(row: JSONObject): PortScanRow {
  return {
    srcIp: readRowText(row["srcIp"]),
    dstIp: readRowText(row["dstIp"]),
    ports: readRowNumber(row["ports"]),
    samplePorts: readRowNumberArray(row["samplePorts"]),
    flows: readRowNumber(row["flows"]),
    bytes: readRowNumber(row["bytes"]),
    packets: readRowNumber(row["packets"]),
    firstSeen: readRowDate(row["firstSeen"]) || new Date(0),
    lastSeen: readRowDate(row["lastSeen"]) || new Date(0),
    deviceId: readRowText(row["deviceId"]),
  };
}

function toNetworkSweepRow(row: JSONObject): NetworkSweepRow {
  return {
    srcIp: readRowText(row["srcIp"]),
    dstPort: readRowNumber(row["dstPort"]),
    hosts: readRowNumber(row["hosts"]),
    sampleHosts: readRowTextArray(row["sampleHosts"]),
    flows: readRowNumber(row["flows"]),
    bytes: readRowNumber(row["bytes"]),
    packets: readRowNumber(row["packets"]),
    firstSeen: readRowDate(row["firstSeen"]) || new Date(0),
    lastSeen: readRowDate(row["lastSeen"]) || new Date(0),
    deviceId: readRowText(row["deviceId"]),
  };
}

function toFlowPairRow(row: JSONObject): FlowPairRow {
  return {
    srcIp: readRowText(row["srcIp"]),
    dstIp: readRowText(row["dstIp"]),
    dstPort: readRowNumber(row["topPort"]),
    protocol: readRowNumber(row["topProtocol"]),
    flows: readRowNumber(row["flows"]),
    bytes: readRowNumber(row["bytes"]),
    packets: readRowNumber(row["packets"]),
    firstSeen: readRowDate(row["firstSeen"]) || new Date(0),
    lastSeen: readRowDate(row["lastSeen"]) || new Date(0),
    deviceId: readRowText(row["deviceId"]),
  };
}

async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  const result: Results = await NetworkFlowService.executeQuery(statement);
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return (response.data || []) as Array<JSONObject>;
}

function pushEvent(
  events: Array<NormalizedSecurityEvent>,
  event: NormalizedSecurityEvent | null,
): void {
  if (event) {
    events.push(event);
  }
}

export default class FlowSecurityScan {
  @CaptureSpan()
  public static async readWindow(data: {
    window: TelemetryScanWindow;
  }): Promise<TelemetryWindowRead> {
    const window: TelemetryScanWindow = data.window;
    const flowWindow: FlowWindow = {
      from: window.arrivedAfter,
      to: window.arrivedUntil,
    };
    const events: Array<NormalizedSecurityEvent> = [];

    const [portScans, sweeps, transfers] = await Promise.all([
      readRows(
        buildPortScanStatement({
          ...window,
          minPorts: PORT_SCAN_MIN_PORTS,
          limit: MAX_FLOW_ROWS_PER_SIGNAL,
        }),
      ),
      readRows(
        buildNetworkSweepStatement({
          ...window,
          minHosts: NETWORK_SWEEP_MIN_HOSTS,
          limit: MAX_FLOW_ROWS_PER_SIGNAL,
        }),
      ),
      readRows(
        buildLargeTransferStatement({
          ...window,
          minBytes: LARGE_TRANSFER_MIN_BYTES,
          limit: MAX_FLOW_ROWS_PER_SIGNAL,
        }),
      ),
    ]);

    for (const row of portScans) {
      pushEvent(events, buildPortScanEvent(toPortScanRow(row), flowWindow));
    }

    for (const row of sweeps) {
      pushEvent(
        events,
        buildNetworkSweepEvent(toNetworkSweepRow(row), flowWindow),
      );
    }

    for (const row of transfers) {
      pushEvent(
        events,
        buildLargeTransferEvent(toFlowPairRow(row), flowWindow),
      );
    }

    const threatIntel: {
      events: Array<NormalizedSecurityEvent>;
      rows: number;
    } = await this.readThreatIntelTraffic({
      projectId: window.projectId,
      window,
      flowWindow,
    });

    events.push(...threatIntel.events);

    return {
      events,
      recordsRead:
        portScans.length + sweeps.length + transfers.length + threatIntel.rows,
      pageRows: 0,
      hasMore: false,
    };
  }

  /*
   * Traffic with an address a feed knows: the window's busiest public
   * addresses looked up, then the traffic of each one found. Nothing is
   * read for a project with no threat intel.
   */
  public static async readThreatIntelTraffic(data: {
    projectId: ObjectID;
    window: TelemetryScanWindow;
    flowWindow: FlowWindow;
  }): Promise<{ events: Array<NormalizedSecurityEvent>; rows: number }> {
    const found: { events: Array<NormalizedSecurityEvent>; rows: number } = {
      events: [],
      rows: 0,
    };

    try {
      if (
        !(await ThreatIntelIndicatorService.hasIndicatorsForProject(
          data.projectId,
        ))
      ) {
        return found;
      }

      const addressRows: Array<JSONObject> = await readRows(
        buildFlowAddressesStatement({
          ...data.window,
          limit: MAX_FLOW_ADDRESSES_READ,
        }),
      );

      found.rows += addressRows.length;

      const candidates: Array<string> = selectThreatIntelCandidates(
        addressRows.map((row: JSONObject): string => {
          return readRowText(row["address"]);
        }),
        MAX_THREAT_INTEL_ADDRESSES,
      );

      if (candidates.length === 0) {
        return found;
      }

      const indicators: Array<ActiveIndicator> =
        await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
          projectId: data.projectId,
          values: candidates,
          now: OneUptimeDate.getCurrentDate(),
        });

      const known: Set<string> = new Set();

      for (const indicator of indicators) {
        const value: string = (indicator.indicatorValue || "").trim();

        if (candidates.includes(value)) {
          known.add(value);
        }
      }

      if (known.size === 0) {
        return found;
      }

      const knownAddresses: Array<string> = Array.from(known).slice(
        0,
        MAX_FLOW_ROWS_PER_SIGNAL,
      );

      const trafficRows: Array<JSONObject> = await readRows(
        buildFlowsOfAddressesStatement({
          ...data.window,
          addresses: knownAddresses,
          limit: MAX_FLOW_ROWS_PER_SIGNAL,
        }),
      );

      found.rows += trafficRows.length;

      for (const row of trafficRows) {
        const pair: FlowPairRow = toFlowPairRow(row);
        const knownAddress: string = known.has(pair.dstIp)
          ? pair.dstIp
          : known.has(pair.srcIp)
            ? pair.srcIp
            : "";

        pushEvent(
          found.events,
          buildThreatIntelTrafficEvent(pair, data.flowWindow, knownAddress),
        );
      }
    } catch (error) {
      logger.warn(
        `FlowSecurityScan: could not check project ${data.projectId.toString()}'s network flows against threat intel; the window's other findings are stored.`,
      );
      logger.warn(error);
    }

    return found;
  }
}
