import { ResponseJSON } from "@clickhouse/client";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeProbeKind from "../../../../Types/Probe/OneUptimeProbeKind";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  FlowWindow,
  NetworkSweepRow,
  PortScanRow,
} from "../../../../Utils/SecurityEvent/TelemetryScan/FlowSignals";
import { ProbeJob } from "../../../../Utils/SecurityEvent/TelemetryScan/ProbeJob";
import {
  ProbeFlowIdentity,
  ProbeScanDestination,
  ProbeSweepDestination,
  ProbeTrafficSplit,
  buildProbeNetworkSweepEvent,
  buildProbePortScanEvent,
  splitProbePortScan,
  splitProbeSweep,
} from "../../../../Utils/SecurityEvent/TelemetryScan/ProbeFlowSignals";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import NetworkFlowService from "../../../Services/NetworkFlowService";
import { Statement } from "../../AnalyticsDatabase/Statement";
import logger from "../../Logger";
import OneUptimeProbeAddresses, {
  OneUptimeProbe,
  OneUptimeProbeRead,
} from "../../Probe/OneUptimeProbeAddresses";
import ProbeJobReader from "./ProbeJobReader";
import {
  FlowSourceFilter,
  TelemetryScanWindow,
  buildProbeScanDestinationsStatement,
  buildProbeSweepDestinationsStatement,
} from "./TelemetryScanStatements";
import { readRowNumber, readRowText } from "./TelemetryScanRows";

/*
 * ONEUPTIME'S OWN PROBES IN A WINDOW OF THE PROJECT'S NETWORK FLOWS
 * (#10429): which sources are OneUptime's own probes, and what a port scan
 * or network sweep from one of them is.
 *
 * A source is one of OneUptime's own probes when its address is one the
 * one list of their addresses holds (Probe/OneUptimeProbeAddresses) - the
 * project's probes' and OneUptime's own, each only while it was checking
 * in, and OneUptime Cloud's addresses - the same list the blocklist never
 * blocks. Its scans and sweeps are read apart from everyone's
 * (FlowSourceFilter), so a probe's polls never take another source's place
 * in a read's rows, then read again destination by destination and held to
 * what the probe is set to do (ProbeJobReader, ProbeFlowSignals): set aside
 * as its own work, or reported for what is beyond it.
 *
 * Why an address alone is never enough. An address is a claim: a probe
 * lists its own interfaces, and another machine may share a probe's
 * address behind a NAT, or send from it. So nothing from a probe's address
 * is set aside unless each of its destinations is one the probe is set to
 * reach, on the port and protocol it reaches it by - work a project member
 * gave the probe, recorded in OneUptime. Someone sending from the address
 * sets aside, at most, traffic that looks exactly like that work; anything
 * more - another port, another host, a sweep wider than the scan's range -
 * is counted as anyone's.
 *
 * Fail toward a person: probes that cannot be read set nothing aside, and a
 * probe whose work cannot be read, or whose flows cannot be read again, has
 * its scans and sweeps reported as anyone's, naming it.
 */

// How long before a window a probe may have last checked in and still have sent its flows.
export const PROBE_ALIVE_GRACE_IN_MINUTES: number = 15;

// The most of the project's probes, and of OneUptime's, one window reads.
export const MAX_PROBES_READ: number = 1000;

// The most of OneUptime's own probe addresses a window's reads are held apart by.
export const MAX_PROBE_SOURCE_ADDRESSES: number = 2000;

// The most destinations one flagged row is read again for.
export const MAX_PROBE_DESTINATIONS_READ: number = 20000;

const ROOT: { isRoot: true } = { isRoot: true };

// Which of OneUptime's own probes are which addresses, in one window.
export class ProbeFlowSources {
  private byAddress: Map<string, Array<OneUptimeProbe>> = new Map();
  private ranges: Array<{ block: NetworkAddressBlock; probe: OneUptimeProbe }> =
    [];
  // The single addresses a window's reads are held apart by.
  private held: Set<string> = new Set();
  private globalProbeIds: Array<ObjectID>;

  public constructor(data: {
    probes: Array<OneUptimeProbe>;
    // Every one of OneUptime's own probes, alive or not: OneUptime Cloud's addresses are theirs.
    globalProbeIds: Array<ObjectID>;
  }) {
    this.globalProbeIds = data.globalProbeIds;

    for (const probe of data.probes) {
      for (const address of probe.addresses) {
        const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
          address.value,
        );

        if (!block) {
          continue;
        }

        if (NetworkAddressBlockUtil.isSingleAddress(block)) {
          const kept: Array<OneUptimeProbe> =
            this.byAddress.get(block.text) || [];

          if (!kept.includes(probe)) {
            kept.push(probe);
          }

          this.byAddress.set(block.text, kept);
        } else {
          this.ranges.push({ block, probe });
        }
      }
    }

    this.held = new Set(
      Array.from(this.byAddress.keys()).slice(0, MAX_PROBE_SOURCE_ADDRESSES),
    );
  }

  public isEmpty(): boolean {
    return this.byAddress.size === 0 && this.ranges.length === 0;
  }

  /*
   * The single addresses, each once, at most MAX_PROBE_SOURCE_ADDRESSES: a
   * window's reads are held apart by these. A range - one of OneUptime
   * Cloud's - is matched on the rows instead (findProbes).
   */
  public getAddresses(): Array<string> {
    return Array.from(this.held);
  }

  // The read filter for everyone else's flows, or for the probes' own.
  public getFilter(only: boolean): FlowSourceFilter | undefined {
    const addresses: Array<string> = this.getAddresses();

    return addresses.length > 0 ? { addresses, only } : undefined;
  }

  /*
   * The probes a source address is: those holding the address itself,
   * else those whose range holds it. Empty when it is none of them.
   */
  public findProbes(address: string): Array<OneUptimeProbe> {
    const canonical: string | null =
      NetworkAddressBlockUtil.canonicalAddress(address);

    if (!canonical) {
      return [];
    }

    if (this.held.has(canonical)) {
      return this.byAddress.get(canonical) || [];
    }

    const inRange: Array<OneUptimeProbe> = [];

    for (const { block, probe } of this.ranges) {
      if (
        NetworkAddressBlockUtil.contains(block, canonical) &&
        !inRange.includes(probe)
      ) {
        inRange.push(probe);
      }
    }

    return inRange;
  }

  /*
   * The probes whose work is read for these: each probe itself, and for
   * OneUptime Cloud's addresses every one of OneUptime's probes, since the
   * setting does not say which one an address is.
   */
  public getJobProbeIds(probes: Array<OneUptimeProbe>): Array<ObjectID> {
    const ids: Set<string> = new Set();

    for (const probe of probes) {
      if (probe.kind === OneUptimeProbeKind.OneUptimeCloud) {
        for (const id of this.globalProbeIds) {
          ids.add(id.toString());
        }
      } else if (probe.probeId) {
        ids.add(probe.probeId);
      }
    }

    return Array.from(ids)
      .sort()
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }
}

// What the window's flagged rows from probes come to.
export interface ProbeFlowExamination {
  event: NormalizedSecurityEvent | null;
  // Rows the database returned for it.
  rows: number;
}

function toIdentity(probe: OneUptimeProbe): ProbeFlowIdentity {
  return { kind: probe.kind, probeId: probe.probeId, name: probe.name };
}

// Whether a probe was checking in while a window's flows were sent.
export function wasCheckingIn(
  probe: OneUptimeProbe,
  window: FlowWindow,
): boolean {
  if (probe.kind === OneUptimeProbeKind.OneUptimeCloud) {
    return true;
  }

  return Boolean(
    probe.lastAlive &&
      probe.lastAlive.getTime() >=
        window.from.getTime() - PROBE_ALIVE_GRACE_IN_MINUTES * 60 * 1000,
  );
}

async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  const result: Results = await NetworkFlowService.executeQuery(statement);
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return (response.data || []) as Array<JSONObject>;
}

function toSweepDestination(row: JSONObject): ProbeSweepDestination {
  return {
    dstIp: readRowText(row["dstIp"]),
    dstName: readRowText(row["dstName"]),
    protocol: readRowNumber(row["protocol"]),
  };
}

function toScanDestination(row: JSONObject): ProbeScanDestination {
  return {
    dstPort: readRowNumber(row["dstPort"]),
    dstName: readRowText(row["dstName"]),
    protocol: readRowNumber(row["protocol"]),
  };
}

/*
 * The work of the probes sharing an address, read once a window: a
 * promise each, so the rows of one probe wait on one read. Null for work
 * that could not be read.
 */
export class ProbeJobCache {
  private jobs: Map<string, Promise<ProbeJob | null>> = new Map();

  private data: {
    projectId: ObjectID;
    sources: ProbeFlowSources;
    window: FlowWindow;
  };

  public constructor(data: {
    projectId: ObjectID;
    sources: ProbeFlowSources;
    window: FlowWindow;
  }) {
    this.data = data;
  }

  public get(probes: Array<OneUptimeProbe>): Promise<ProbeJob | null> {
    const probeIds: Array<ObjectID> = this.data.sources.getJobProbeIds(probes);
    const key: string = probeIds
      .map((probeId: ObjectID): string => {
        return probeId.toString();
      })
      .join(",");

    let job: Promise<ProbeJob | null> | undefined = this.jobs.get(key);

    if (!job) {
      job = ProbeJobReader.read({
        projectId: this.data.projectId,
        probeIds,
        window: this.data.window,
      }).catch((error: unknown): null => {
        logger.warn(
          `ProbeOwnTraffic: could not read what probes ${key} of project ${this.data.projectId.toString()} are set to do; their scans and sweeps are reported as anyone's.`,
        );
        logger.warn(error);
        return null;
      });

      this.jobs.set(key, job);
    }

    return job;
  }
}

export default class ProbeOwnTraffic {
  /*
   * OneUptime's own probes for a project's window: the project's probes and
   * OneUptime's that were checking in, and OneUptime Cloud's addresses.
   * Never throws: probes that cannot be read set nothing aside, and the
   * window's scans and sweeps are all counted as anyone's.
   */
  public static async readSources(data: {
    projectId: ObjectID;
    window: FlowWindow;
  }): Promise<ProbeFlowSources> {
    try {
      const [own, global]: [OneUptimeProbeRead, OneUptimeProbeRead] =
        await Promise.all([
          OneUptimeProbeAddresses.readProjectProbes({
            projectId: data.projectId,
            contains: null,
            limit: MAX_PROBES_READ,
            props: ROOT,
            withLastAlive: true,
          }),
          OneUptimeProbeAddresses.readGlobalProbes({
            contains: null,
            limit: MAX_PROBES_READ,
            withLastAlive: true,
          }),
        ]);

      const cloud: OneUptimeProbe | null =
        OneUptimeProbeAddresses.getOneUptimeCloud();

      return new ProbeFlowSources({
        probes: [
          ...own.probes,
          ...global.probes,
          ...(cloud ? [cloud] : []),
        ].filter((probe: OneUptimeProbe): boolean => {
          return wasCheckingIn(probe, data.window);
        }),
        globalProbeIds: global.probes
          .filter((probe: OneUptimeProbe): boolean => {
            return Boolean(probe.probeId);
          })
          .map((probe: OneUptimeProbe): ObjectID => {
            return new ObjectID(probe.probeId);
          }),
      });
    } catch (error) {
      logger.warn(
        `ProbeOwnTraffic: could not read OneUptime's own probes for project ${data.projectId.toString()}; nothing in this window is set aside as theirs.`,
      );
      logger.warn(error);

      return new ProbeFlowSources({ probes: [], globalProbeIds: [] });
    }
  }

  /*
   * A network sweep from one of OneUptime's own probes' addresses: its
   * hosts read again and held to the probe's work, then set aside, or
   * reported for what is beyond it.
   */
  public static async examineSweep(data: {
    window: TelemetryScanWindow;
    flowWindow: FlowWindow;
    row: NetworkSweepRow;
    probes: Array<OneUptimeProbe>;
    jobs: ProbeJobCache;
  }): Promise<ProbeFlowExamination> {
    const identity: ProbeFlowIdentity = toIdentity(data.probes[0]!);
    let split: ProbeTrafficSplit | null = null;
    let rows: number = 0;

    try {
      const job: ProbeJob | null = await data.jobs.get(data.probes);

      if (job && job.isEmpty()) {
        split = {
          ownWork: 0,
          works: [],
          other: data.row.hosts,
          sampleOther: [...data.row.sampleHosts].sort().slice(0, 10),
        };
      } else if (job) {
        const destinations: Array<JSONObject> = await readRows(
          buildProbeSweepDestinationsStatement({
            ...data.window,
            srcIp: data.row.srcIp,
            dstPort: data.row.dstPort,
            limit: MAX_PROBE_DESTINATIONS_READ,
          }),
        );

        rows = destinations.length;
        split = splitProbeSweep({
          row: data.row,
          destinations: destinations.map(toSweepDestination),
          isCut: destinations.length >= MAX_PROBE_DESTINATIONS_READ,
          job,
        });
      }
    } catch (error) {
      logger.warn(
        `ProbeOwnTraffic: could not read again the sweep from ${data.row.srcIp} on port ${data.row.dstPort}; it is reported as anyone's.`,
      );
      logger.warn(error);
      split = null;
    }

    return {
      event: buildProbeNetworkSweepEvent({
        row: data.row,
        window: data.flowWindow,
        probe: identity,
        split,
      }),
      rows,
    };
  }

  // A port scan from one of OneUptime's own probes' addresses, the same way.
  public static async examinePortScan(data: {
    window: TelemetryScanWindow;
    flowWindow: FlowWindow;
    row: PortScanRow;
    probes: Array<OneUptimeProbe>;
    jobs: ProbeJobCache;
  }): Promise<ProbeFlowExamination> {
    const identity: ProbeFlowIdentity = toIdentity(data.probes[0]!);
    let split: ProbeTrafficSplit | null = null;
    let rows: number = 0;

    try {
      const job: ProbeJob | null = await data.jobs.get(data.probes);

      if (job && job.isEmpty()) {
        split = {
          ownWork: 0,
          works: [],
          other: data.row.ports,
          sampleOther: [...data.row.samplePorts]
            .sort((a: number, b: number): number => {
              return a - b;
            })
            .slice(0, 10)
            .map(String),
        };
      } else if (job) {
        const destinations: Array<JSONObject> = await readRows(
          buildProbeScanDestinationsStatement({
            ...data.window,
            srcIp: data.row.srcIp,
            dstIp: data.row.dstIp,
            limit: MAX_PROBE_DESTINATIONS_READ,
          }),
        );

        rows = destinations.length;
        split = splitProbePortScan({
          row: data.row,
          destinations: destinations.map(toScanDestination),
          isCut: destinations.length >= MAX_PROBE_DESTINATIONS_READ,
          job,
        });
      }
    } catch (error) {
      logger.warn(
        `ProbeOwnTraffic: could not read again the port scan from ${data.row.srcIp} of ${data.row.dstIp}; it is reported as anyone's.`,
      );
      logger.warn(error);
      split = null;
    }

    return {
      event: buildProbePortScanEvent({
        row: data.row,
        window: data.flowWindow,
        probe: identity,
        split,
      }),
      rows,
    };
  }
}
