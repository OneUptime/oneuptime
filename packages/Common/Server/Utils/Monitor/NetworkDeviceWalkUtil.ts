import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorPauseState, {
  MONITOR_PAUSE_FLAGS_SELECT,
} from "../../../Utils/Monitor/MonitorPauseState";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import MonitorService from "../../Services/MonitorService";
import MonitorNetworkDeviceService from "../../Services/MonitorNetworkDeviceService";
import MonitorNetworkDevice from "../../../Models/DatabaseModels/MonitorNetworkDevice";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkDeviceOidTemplateService from "../../Services/NetworkDeviceOidTemplateService";
import NetworkDeviceOidTemplate from "../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import MonitorResourceUtil from "./MonitorResource";
import { NetworkDevicePollMode } from "./NetworkDeviceHydrationUtil";
import NetworkDeviceMetricUtil from "./NetworkDeviceMetricUtil";
import NetworkInventoryUtil from "./NetworkInventoryUtil";
import SnmpInterfaceRateUtil from "./SnmpInterfaceRateUtil";
import SnmpOidRateUtil, {
  SNMP_OID_COUNTER_BASELINE_KEY,
  SnmpOidCounterBaseline,
} from "./SnmpOidRateUtil";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MonitorType from "../../../Types/Monitor/MonitorType";
import PingMonitorResponse from "../../../Types/Monitor/PingMonitor/PingMonitorResponse";
import SnmpMonitorResponse from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import {
  PROBE_DID_NOT_WALK_TABLES_CAUSE,
  SnmpTableDefinition,
  SnmpTableFailureReason,
  SnmpTableSnapshot,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import { NetworkDeviceTransceiver } from "../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverHealthUtil from "../../../Utils/NetworkDevice/TransceiverHealthUtil";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ProbeCapability, {
  ProbeCapabilityUtil,
} from "../../../Types/Probe/ProbeCapability";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import logger from "../Logger";

/*
 * What the probe's ping of a device found, as the probe reports it
 * (PingMonitor.checkReachability): a verdict, the average RTT, the loss,
 * and why it failed when it did. Packet counts are optional because the
 * reachability ping is a short fixed burst whose counts the probe need not
 * report; the loss percentage is the number that matters.
 */
export interface NetworkDevicePingResult {
  isOnline: boolean;
  avgRttMs?: number | undefined;
  packetLossPercent?: number | undefined;
  packetsSent?: number | undefined;
  packetsReceived?: number | undefined;
  failureCause?: string | undefined;
  /*
   * For a device polled at a DNS name: the name, and the address the ping
   * resolved it to (issue #5185). Absent from older probes.
   */
  resolvedHost?: string | undefined;
  resolvedAddress?: string | undefined;
}

/*
 * Server half of device-owned polling.
 *
 * The device's assigned probe polls every polling-enabled NetworkDevice on
 * the device's own schedule - pinging it always, and walking it over SNMP
 * as well when it has usable credentials - and reports each poll here. This
 * util then:
 *
 *   1. computes interface rates against the device's previous walk
 *      (NetworkDevice.lastWalkLog) when interfaces were walked,
 *   2. syncs the device/interface/endpoint inventory, reachability and
 *      lastSeenAt,
 *   3. emits device-scoped metrics (so health charts work with zero
 *      monitors), and
 *   4. fans the poll out to every Network Device monitor referencing the
 *      device — each gets an event-driven ProbeMonitorResponse evaluated
 *      through the ordinary criteria pipeline (incidents, alerts, status).
 *
 * Monitors are pure alerting config here: they never poll, and deleting
 * every monitor leaves the device fully inventoried and charted.
 */
export default class NetworkDeviceWalkUtil {
  /*
   * How many device or monitor ids one statement of the monitor lookup
   * names. A poll and a trap name one or a few devices; the stale poll check
   * names a page of them.
   */
  public static readonly FAN_OUT_ID_CHUNK_SIZE: number = 500;

  public static async processWalkResult(data: {
    probeId: ObjectID;
    networkDeviceId: ObjectID;
    /*
     * Device reachability: answered ping OR the walk succeeded. A caller
     * that predates ping-first polling passes only a walk; its verdict is
     * then the device's verdict.
     */
    isOnline?: boolean | undefined;
    /*
     * How the probe polled - "ping" (no credentials, ping only) or "snmp"
     * (ping and a walk in parallel). Absent from a pre-ping-first caller,
     * and read as "snmp" then: such a probe only ever walked.
     */
    pollMode?: NetworkDevicePollMode | undefined;
    // The probe's ping, when it ran one (older probes send none).
    pingResponse?: NetworkDevicePingResult | undefined;
    /*
     * The SNMP walk, when one ran - success or failure. Undefined on a
     * ping-only poll, and never synthesized from the ping.
     */
    snmpResponse?: SnmpMonitorResponse | undefined;
    /*
     * What the reporting probe declared it can do (ProbeCapability). An
     * older probe declares nothing.
     */
    probeCapabilities?: Array<string> | undefined;
    monitoredAt: Date;
    /*
     * When OneUptime's ingest API received the poll, before the queue it
     * waited in: a page the monitors' evaluation starts is timed from then
     * (OnCallPageTiming). Absent, the record's creation is the trigger.
     */
    dataReceivedAt?: Date | undefined;
  }): Promise<void> {
    /*
     * Scope the lookup to the reporting probe (the auth middleware only
     * proves the caller is SOME valid probe) — without this any probe that
     * learned a foreign device id could overwrite another project's
     * inventory or trigger its monitors.
     */
    const device: NetworkDevice | null = await NetworkDeviceService.findOneBy({
      query: {
        _id: data.networkDeviceId,
        probeId: data.probeId,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        siteId: true,
        lastWalkLog: true,
        // For joining walked SNMP tables back to their definitions.
        snmpTables: true,
        oidTemplateId: true,
        snmpTableSnapshot: true,
        // To tell a pulled optic from one still in place, and for its trend.
        transceiverSnapshot: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!device || !device.id || !device.projectId) {
      logger.warn(
        `Device poll ignored: device ${data.networkDeviceId.toString()} is not assigned to probe ${data.probeId.toString()}.`,
      );
      return;
    }

    const pollMode: NetworkDevicePollMode = data.pollMode ?? "snmp";

    /*
     * The device verdict. A ping-first probe states it (ping OR walk); an
     * older probe only walked, so its walk verdict IS the device verdict -
     * and, matching the inventory's convention, a walk that reports no
     * verdict at all counts as answered.
     */
    const isOnline: boolean =
      data.isOnline ??
      (data.snmpResponse ? data.snmpResponse.isOnline !== false : false);

    const pingResponse: PingMonitorResponse | undefined =
      NetworkDeviceWalkUtil.toPingMonitorResponse(data.pingResponse);

    /*
     * One receipt time for the poll - for its rates and for the baseline
     * kept below: when OneUptime's ingest API received it, not when this
     * worker got to it (OneUptime issue #7194). A rate is a counter's growth
     * over the time between two polls. Timed by the worker, a poll that sat
     * in a queue backlog was rated over the seconds between two dequeues
     * instead of the minutes between two polls, so draining a backlog read
     * every interface's traffic as a burst many times its size - for the
     * charts and for every rate criteria. The ingest API's clock is
     * OneUptime's own, as the baseline's time always was; a job queued
     * before the stamp existed has none, and is timed now.
     */
    const receivedAt: Date =
      data.dataReceivedAt && !isNaN(data.dataReceivedAt.getTime())
        ? data.dataReceivedAt
        : OneUptimeDate.getCurrentDate();
    const previousWalkLog: JSONObject | undefined = device.lastWalkLog as
      | JSONObject
      | undefined;

    /*
     * Interface rates are counter deltas against the previous walk. Compute
     * them on the FULL interface set, before inventory pruning, so muted
     * ports still get fresh rates in the inventory table. Nothing to do on
     * a poll that ran no walk.
     */
    if (data.snmpResponse) {
      SnmpInterfaceRateUtil.attachInterfaceRates({
        snmpResponse: data.snmpResponse,
        previousWalkLog: previousWalkLog,
        now: receivedAt,
      });
    }

    /*
     * The same for the counter OIDs a poll reads (SNMP OID Rate (per
     * second)): each one's growth since the previous poll that read it,
     * against the counters the device's lastWalkLog keeps.
     */
    if (data.snmpResponse) {
      SnmpOidRateUtil.attachOidRates({
        snmpResponse: data.snmpResponse,
        previousBaseline: SnmpOidRateUtil.readBaseline(previousWalkLog),
        now: receivedAt,
      });
    }

    const counterBaseline: SnmpOidCounterBaseline | undefined =
      SnmpOidRateUtil.getCounterBaseline({
        snmpResponse: data.snmpResponse,
        now: receivedAt,
      });

    /*
     * Persist this walk as the next delta baseline — but only when it
     * actually walked interfaces or read counter OIDs. Keeping the last GOOD
     * counters across failed polls (and across ping-only polls, which walk
     * nothing) means rates resume with a correct (longer-window) delta
     * instead of losing a cycle.
     *
     * Hook-free single-statement write, deliberately. A 48-interface walk
     * log is ~28 KB of jsonb, stored out of line: the full updateOneById
     * pipeline SELECTs the row before writing it (the column is in the
     * payload), so every poll detoasted the PREVIOUS log a second time —
     * it was already read above — only to overwrite it. Measured against
     * the seeded 80,000-device fleet, that pre-read costs 8 buffer hits and
     * ~0.6 ms where the same lookup without the column costs 4 and
     * ~0.06 ms; at 267 walks/sec it is pure waste on the product's hottest
     * table. It does NOT shrink the ~12 KB of WAL the rewrite itself emits
     * (a plain one-column update is 144 B) — that is what storing less
     * would fix, and it is a separate change.
     *
     * Nothing rides on the hooks for THIS write. NetworkDevice declares
     * neither @EnableWorkflow nor @EnableAuditLog, so _updateBy's workflow,
     * realtime and audit branches are inert for the model, and the payload
     * carries exactly one column: no site-rule identity column
     * (hostname/name/sysName), no siteId, no monitor binding, no
     * monitoringMethod. Both of NetworkDeviceService's real update hooks —
     * site-assignment re-evaluation and the monitor-status stamp — are
     * therefore no-ops here. The inventory sync below still writes those
     * columns through the hooked path, which is where they have to stay.
     * Do not add a column to this payload: anything that lands here stops
     * firing hooks silently.
     *
     * One thing IS lost, deliberately: `updateColumnsByIdWithoutHooks` does
     * not bump the @VersionColumn, so this write leaves `version` alone where
     * `updateOneById` incremented it. Nothing in the product reads
     * NetworkDevice.version, and `sanitizeUpdateData` strips it from client
     * payloads. Note this is the opposite call from the one the interface
     * upsert makes a file away — NetworkInterfaceService hand-writes
     * `version + 1` in its raw statements — and the difference is intended: a
     * batched write REPLACES a path that bumped it and is the row's normal
     * update path, whereas this is a delta-baseline cache write that happens
     * every five minutes and would otherwise be the only thing moving the
     * counter at all.
     *
     * A poll received BEFORE the one the baseline already holds - it waited
     * longer in the queue than the poll after it, a retried job, say - is
     * not put back over it: the newer reading stays the baseline, and this
     * one, older than it, has no rate either (a negative window).
     */
    const hasWalkedInterfaces: boolean = Boolean(
      data.snmpResponse &&
        data.snmpResponse.interfaces &&
        data.snmpResponse.interfaces.length > 0,
    );

    const previousCounters: SnmpOidCounterBaseline | undefined =
      SnmpOidRateUtil.readBaseline(previousWalkLog);

    const replacesInterfaces: boolean =
      hasWalkedInterfaces &&
      NetworkDeviceWalkUtil.isReceivedAfter(
        receivedAt,
        previousWalkLog?.["monitoredAt"],
      );

    const replacesCounters: boolean =
      Boolean(counterBaseline) &&
      NetworkDeviceWalkUtil.isReceivedAfter(
        receivedAt,
        previousCounters?.readAt,
      );

    if (data.snmpResponse && (replacesInterfaces || replacesCounters)) {
      /*
       * What the next poll's rates are computed against, and nothing else.
       *
       * The interfaces, for SnmpInterfaceRateUtil, which reads
       * `snmpResponse.interfaces` and touches nothing else; and the counter
       * OIDs' readings, for SnmpOidRateUtil - a few numbers, the counters
       * only. Every other field was dead weight in a jsonb column rewritten
       * on every poll of every device, and `oidResponses` is the one that
       * grows: OID Collection Templates make long health-OID lists normal,
       * so storing them here would add tens of KB per device per poll of
       * pure TOAST churn on the product's hottest table, for data nothing
       * ever reads back.
       *
       * A part this poll did not read keeps the one before - and the time
       * it was read - so a poll that walked no interfaces leaves their rates
       * a correct (longer) window, and one that read no counter leaves the
       * counters theirs.
       */
      const lastWalkLog: JSONObject = replacesInterfaces
        ? {
            snmpResponse: {
              interfaces: JSON.parse(
                JSON.stringify(data.snmpResponse.interfaces),
              ),
            },
            monitoredAt: receivedAt,
          }
        : {
            ...(previousWalkLog?.["snmpResponse"] !== undefined
              ? { snmpResponse: previousWalkLog["snmpResponse"] }
              : {}),
            ...(previousWalkLog?.["monitoredAt"] !== undefined
              ? { monitoredAt: previousWalkLog["monitoredAt"] }
              : {}),
          };

      const keptCounters: SnmpOidCounterBaseline | undefined = replacesCounters
        ? counterBaseline
        : previousCounters;

      if (keptCounters) {
        lastWalkLog[SNMP_OID_COUNTER_BASELINE_KEY] =
          keptCounters as unknown as JSONObject;
      }

      await NetworkDeviceWalkUtil.writeWalkBaseline({
        deviceId: device.id,
        lastWalkLog: lastWalkLog,
      });
    }

    /*
     * SNMP tables arrive as raw values per row index and column OID. Join
     * them back to their definitions BEFORE anything reads the response, so
     * the inventory, the metrics and every criteria below see named columns
     * and labelled rows. Never fatal: a table that cannot be read this cycle
     * keeps its stored rows.
     */
    let snmpTableSnapshot: Array<SnmpTableSnapshot> | undefined = undefined;

    try {
      snmpTableSnapshot = await NetworkDeviceWalkUtil.applyTableDefinitions({
        device: device,
        snmpResponse: data.snmpResponse,
        probeCapabilities: data.probeCapabilities,
        monitoredAt: data.monitoredAt,
      });
    } catch (err) {
      logger.error(
        `Failed to read SNMP tables for device ${device.id.toString()}:`,
      );
      logger.error(err);
    }

    /*
     * Transceivers: this poll's optics folded into what the device had
     * stored, and judged - before inventory, metrics and criteria read the
     * response. Never fatal: a poll that cannot judge its optics leaves the
     * stored ones alone. Timed at the poll's receipt, like everything else
     * the poll saw (OneUptime issue #7389).
     */
    let transceiverSnapshot: Array<NetworkDeviceTransceiver> | undefined =
      undefined;

    try {
      transceiverSnapshot = NetworkDeviceWalkUtil.applyTransceivers({
        device: device,
        snmpResponse: data.snmpResponse,
        now: receivedAt,
      });
    } catch (err) {
      logger.error(
        `Failed to read transceivers for device ${device.id.toString()}:`,
      );
      logger.error(err);
    }

    /*
     * Inventory sync also prunes data.snmpResponse.interfaces down to
     * monitored ports, so the metrics and criteria below only see ports the
     * user cares about. It stamps what the poll saw with the same receipt
     * time, and writes nothing a newer poll of the device has written
     * already (OneUptime issue #7389).
     */
    await NetworkInventoryUtil.updateFromWalk({
      projectId: device.projectId,
      deviceId: device.id,
      snmpResponse: data.snmpResponse,
      isOnline: isOnline,
      pollMode: pollMode,
      snmpTableSnapshot: snmpTableSnapshot,
      transceiverSnapshot: transceiverSnapshot,
      probeId: data.probeId,
      receivedAt: receivedAt,
      dnsResolution: data.pingResponse
        ? {
            hostname:
              typeof data.pingResponse.resolvedHost === "string"
                ? data.pingResponse.resolvedHost
                : undefined,
            address:
              typeof data.pingResponse.resolvedAddress === "string"
                ? data.pingResponse.resolvedAddress
                : undefined,
          }
        : undefined,
    });

    try {
      await NetworkDeviceMetricUtil.saveWalkMetrics({
        projectId: device.projectId,
        networkDeviceId: device.id,
        deviceName: device.name,
        probeId: data.probeId,
        snmpResponse: data.snmpResponse,
        // Walk time only: a ping-only poll writes no response-time point.
        responseTimeInMs: data.snmpResponse?.responseTimeInMs,
        isOnline: isOnline,
        pingResponse: pingResponse,
      });
    } catch (err) {
      // Metrics must never fail the walk pipeline.
      logger.error(
        `Failed to save device metrics for ${device.id.toString()}:`,
      );
      logger.error(err);
    }

    /*
     * The probe's raw transceiver readings have done their job - folded
     * into the snapshot and charted. The monitors judge the merged
     * `transceivers`, so the raw copy is not carried into the log of every
     * monitor watching the device.
     */
    if (data.snmpResponse) {
      delete data.snmpResponse.transceiverResults;
    }

    /*
     * Why the poll failed, for the incident/alert narrative. The walk's own
     * cause is passed through whenever a walk ran (it is the more specific
     * of the two, and the "SNMP walk failing" alert reads it); the ping's
     * cause is only worth stating when the device is actually unreachable
     * - on an ICMP-filtered device whose walk succeeds, "ping timed out" is
     * not a failure of anything.
     */
    const failureCause: string =
      data.snmpResponse?.failureCause ||
      (!isOnline ? data.pingResponse?.failureCause : undefined) ||
      "";

    // --- Fan out to the monitors alerting on this device ---
    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: device.projectId,
        deviceIds: [device.id.toString()],
      });

    for (const monitor of monitors) {
      if (MonitorPauseState.isPaused(monitor)) {
        continue;
      }

      if (!monitor.id || !monitor.projectId) {
        continue;
      }

      for (const monitorStep of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        const referencedDeviceId: string | undefined =
          monitorStep.data?.networkDeviceMonitor?.networkDeviceId;

        if (
          !referencedDeviceId ||
          referencedDeviceId !== device.id.toString()
        ) {
          continue;
        }

        /*
         * `isOnline` is the device verdict; `snmpResponse` is the real walk
         * or undefined - NEVER a synthesized failure, so walk-dependent
         * criteria see "not evaluated" rather than "breaching" on a
         * ping-only device. `responseTimeInMs` is the walk's time only.
         */
        const walkResponse: ProbeMonitorResponse = {
          projectId: monitor.projectId,
          monitorId: monitor.id,
          monitorStepId: monitorStep.id,
          probeId: data.probeId,
          snmpResponse: data.snmpResponse,
          pingResponse: pingResponse,
          isOnline: isOnline,
          responseTimeInMs: data.snmpResponse?.responseTimeInMs,
          isTimeout: data.snmpResponse?.isTimeout,
          failureCause: failureCause,
          monitoredAt: data.monitoredAt,
          ingestedAt: OneUptimeDate.getCurrentDate(),
          ...(data.dataReceivedAt
            ? { dataReceivedAt: data.dataReceivedAt }
            : {}),
        };

        try {
          await MonitorResourceUtil.monitorResource(walkResponse);
        } catch (err) {
          logger.error(
            `Error evaluating device poll for monitor ${monitor.id.toString()}:`,
          );
          logger.error(err);
        }
      }
    }

    logger.debug(
      `Device poll for ${device.id.toString()} (${pollMode}) processed: evaluated ${monitors.length} watching monitor(s).`,
    );
  }

  /*
   * Materializes this walk's SNMP tables onto `snmpResponse.tables` and
   * returns the snapshot the device should store - or undefined when the
   * stored snapshot must not be touched.
   *
   * `snmpResponse.tables` holds only what THIS walk produced (a table that
   * failed carries its failure cause and no rows), because criteria must
   * judge the current walk, never a remembered one. The stored snapshot is
   * merged instead: a table that failed keeps its last good rows so the
   * device's Tables view does not blank on a timeout.
   *
   * Undefined (leave the column alone) covers: no walk, a walk that was
   * handed no tables, and a lookup failure. An empty array clears it, which
   * is what happens once every table is removed from the device and its
   * template.
   *
   * A walk that answered without `tableResults` from a probe that does not
   * declare ProbeCapability.SnmpTables is a probe that predates SNMP tables:
   * it reads the device's OIDs and interfaces and ignores the tables it is
   * handed, on every poll, for as long as it runs. Leaving the snapshot
   * alone then would show "waiting for the first walk" forever, so every
   * defined table is stored as not walked, with the reason - keeping any
   * rows an earlier walk stored - and the device's Wi-Fi and SNMP Tables
   * views say to update the probe. Criteria still judge only what this walk
   * read: nothing, as before.
   */
  public static async applyTableDefinitions(data: {
    device: NetworkDevice;
    snmpResponse: SnmpMonitorResponse | undefined;
    probeCapabilities?: Array<string> | undefined;
    monitoredAt: Date;
  }): Promise<Array<SnmpTableSnapshot> | undefined> {
    const snmpResponse: SnmpMonitorResponse | undefined = data.snmpResponse;

    if (!snmpResponse || snmpResponse.isOnline === false) {
      return undefined;
    }

    const storedSnapshot: Array<SnmpTableSnapshot> =
      data.device.snmpTableSnapshot || [];

    /*
     * A probe that walks tables answers every config that lists them with
     * tableResults, so one that declares it and sent none was handed none
     * (or the tables were added after it claimed this poll; its next poll
     * walks them).
     */
    const probeWalksTables: boolean = ProbeCapabilityUtil.has(
      data.probeCapabilities,
      ProbeCapability.SnmpTables,
    );

    /*
     * The common case - a device with no tables at all - costs no query:
     * nothing was walked and nothing is stored, so there is nothing to join
     * and nothing to clear. Only a probe that may have ignored the tables it
     * was handed needs a look, and only at a device that can have tables.
     * For a device linked to an OID Collection Template that is one template
     * read per poll, until its probe is updated to one that declares
     * ProbeCapability.SnmpTables.
     */
    if (
      !snmpResponse.tableResults &&
      storedSnapshot.length === 0 &&
      (probeWalksTables || !NetworkDeviceWalkUtil.canHaveTables(data.device))
    ) {
      return undefined;
    }

    const definitions: Array<SnmpTableDefinition> =
      await NetworkDeviceWalkUtil.resolveTableDefinitions(data.device);

    if (definitions.length === 0) {
      // Every table was removed: drop the rows nothing collects any more.
      return storedSnapshot.length > 0 ? [] : undefined;
    }

    const definedKeys: Array<string> = definitions.map(
      (table: SnmpTableDefinition) => {
        return table.key;
      },
    );

    if (!snmpResponse.tableResults) {
      if (probeWalksTables) {
        return undefined;
      }

      logger.debug(
        `Device ${data.device.id?.toString()}: the probe answered without walking its ${definitions.length} SNMP table(s); it predates SNMP tables.`,
      );

      return SnmpTableListUtil.capSnapshotsForStorage(
        SnmpTableListUtil.mergeWithPrevious({
          current: SnmpTableListUtil.notWalked({
            tables: definitions,
            failureCause: PROBE_DID_NOT_WALK_TABLES_CAUSE,
            failureReason: SnmpTableFailureReason.ProbeDidNotWalkTables,
          }),
          previous: storedSnapshot,
          definedKeys: definedKeys,
        }),
      );
    }

    const current: Array<SnmpTableSnapshot> = SnmpTableListUtil.materialize({
      tables: definitions,
      results: snmpResponse.tableResults,
      collectedAt: data.monitoredAt,
    });

    snmpResponse.tables = current;

    return SnmpTableListUtil.capSnapshotsForStorage(
      SnmpTableListUtil.mergeWithPrevious({
        current: current,
        previous: storedSnapshot,
        definedKeys: definedKeys,
      }),
    );
  }

  /*
   * Folds this walk's transceivers into the device's stored ones
   * (TransceiverHealthUtil.mergeSnapshot), puts what the criteria judge on
   * `snmpResponse.transceivers`, and returns the snapshot the device should
   * store - or undefined when the stored one must not be touched.
   *
   * What the criteria judge:
   *
   *   - the merged state, when this poll read the optics;
   *   - the STORED state, when it tried and could not (a timeout, a table
   *     too long, an agent that answered nothing at all where it used to
   *     report optics) - so an open "not detected" or "past its alarm
   *     threshold" alert does not resolve on a poll that could not look,
   *     and reopen on the next one;
   *   - nothing, when this poll did not try (an older probe, interface
   *     walking off): the transceiver criteria are then not evaluated.
   */
  public static applyTransceivers(data: {
    device: NetworkDevice;
    snmpResponse: SnmpMonitorResponse | undefined;
    now: Date;
  }): Array<NetworkDeviceTransceiver> | undefined {
    const snmpResponse: SnmpMonitorResponse | undefined = data.snmpResponse;

    if (!snmpResponse) {
      return undefined;
    }

    // Only the server judges optics: anything a probe put here is dropped.
    delete snmpResponse.transceivers;

    if (snmpResponse.isOnline === false) {
      return undefined;
    }

    const stored: Array<NetworkDeviceTransceiver> = Array.isArray(
      data.device.transceiverSnapshot,
    )
      ? data.device.transceiverSnapshot
      : [];

    const merged: Array<NetworkDeviceTransceiver> | undefined =
      TransceiverHealthUtil.mergeSnapshot({
        previous: stored,
        results: snmpResponse.transceiverResults,
        source: snmpResponse.transceiverSource,
        interfaces: (snmpResponse.interfaces || []).map(
          (walked: SnmpInterface) => {
            return {
              interfaceIndex: walked.interfaceIndex,
              name: walked.name,
              alias: walked.alias,
              isAdministrativelyUp: walked.isAdministrativelyUp,
            };
          },
        ),
        now: data.now,
      });

    const triedAndCouldNotRead: boolean =
      Boolean(snmpResponse.transceiverWalkFailure) ||
      (snmpResponse.transceiverResults !== undefined && merged === undefined);

    let judged: Array<NetworkDeviceTransceiver> | undefined = merged;

    if (!judged && triedAndCouldNotRead) {
      judged = stored;
    }

    if (!judged && snmpResponse.transceiverResults !== undefined) {
      judged = [];
    }

    if (judged) {
      snmpResponse.transceivers = judged.map(
        (transceiver: NetworkDeviceTransceiver) => {
          return { ...transceiver };
        },
      );
    }

    return merged;
  }

  /*
   * Whether a device has, or may have, SNMP tables to walk: tables of its
   * own, or an OID Collection Template that may hold some. Read off the row
   * alone, without the template.
   */
  public static canHaveTables(device: NetworkDevice): boolean {
    return (
      (device.snmpTables || []).length > 0 || Boolean(device.oidTemplateId)
    );
  }

  /*
   * The device's effective tables, resolved the same way the poll hand-out
   * resolved them (template first, device-specific merged over it by key).
   * Resolved again here rather than echoed back by the probe: the probe
   * only ever sees column OIDs, and names and value labels have no reason
   * to cross the wire twice per poll.
   */
  public static async resolveTableDefinitions(
    device: NetworkDevice,
  ): Promise<Array<SnmpTableDefinition>> {
    let templateTables: Array<SnmpTableDefinition> = [];

    if (device.oidTemplateId && device.projectId) {
      const template: NetworkDeviceOidTemplate | null =
        await NetworkDeviceOidTemplateService.findOneBy({
          query: {
            _id: device.oidTemplateId,
            // Never read another project's template, whatever the FK says.
            projectId: device.projectId,
          },
          select: {
            _id: true,
            tables: true,
          },
          props: {
            isRoot: true,
          },
        });

      templateTables = template?.tables || [];
    }

    return SnmpTableListUtil.resolveEffectiveTables({
      templateTables: templateTables,
      deviceTables: device.snmpTables,
    }).tables;
  }

  /*
   * Whether a poll received at `receivedAt` is newer than a reading the
   * baseline keeps, stamped `storedAt` (an ISO string out of jsonb). A
   * baseline with no readable time is replaced, as one with none at all.
   */
  public static isReceivedAfter(receivedAt: Date, storedAt: unknown): boolean {
    if (typeof storedAt !== "string" && !(storedAt instanceof Date)) {
      return true;
    }

    const stored: Date = new Date(storedAt);

    if (isNaN(stored.getTime())) {
      return true;
    }

    return receivedAt.getTime() > stored.getTime();
  }

  /*
   * Writes a poll's rate baseline (NetworkDevice.lastWalkLog) - and never
   * waits for the row, and never fails the poll (OneUptime issue #7194).
   *
   * This write used to queue for the device's row lock like any UPDATE, and
   * it was the one write of the walk pipeline without a try/catch: whenever
   * another writer held the device - the probe's claim of it, the inventory
   * of a poll still in flight, a router's ARP table merging readings into
   * hundreds of devices - for longer than lock_timeout, it failed with
   * "canceling statement due to lock timeout" and took the whole job with
   * it. The queue retried the job from the start, twice, so a busy database
   * got up to three times the work for each such poll, and the telemetry
   * queue fell further behind.
   *
   * A baseline that is not written loses nothing: the next poll's rates are
   * worked out against the one before, over a window that much longer, and
   * are just as right. So the write yields - FOR UPDATE SKIP LOCKED,
   * updateColumnsByIdIfUnlockedWithoutHooks - instead of queueing, and
   * anything else that goes wrong with it is logged rather than thrown. The
   * same guard as before: never onto a device deleted while the poll was
   * in flight.
   */
  public static async writeWalkBaseline(data: {
    deviceId: ObjectID;
    lastWalkLog: JSONObject;
  }): Promise<boolean> {
    try {
      const written: boolean =
        await NetworkDeviceService.updateColumnsByIdIfUnlockedWithoutHooks({
          id: data.deviceId,
          data: {
            lastWalkLog: data.lastWalkLog,
          } as any,
          /*
           * The hooked path finds rows with `withDeleted: false`, so a
           * device deleted between the read at the top of this walk and
           * here was never written to. The raw path matches on `_id` alone,
           * so keep that guard explicitly — a walk still in flight must not
           * push a fresh log back onto a row the user just deleted.
           */
          expectedData: {
            deletedAt: null,
          } as any,
        });

      if (!written) {
        logger.debug(
          `Network device ${data.deviceId.toString()}: rate baseline not written - another writer held the device, or it was deleted. The next poll's rates use the baseline before.`,
        );
      }

      return written;
    } catch (err) {
      logger.warn(
        `Network device ${data.deviceId.toString()}: rate baseline not written; the next poll's rates use the baseline before. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /*
   * The probe's ping result in the shape the criteria pipeline already
   * speaks (ProbeMonitorResponse.pingResponse, as Ping monitors report it),
   * so packet-loss criteria, metrics and evidence read it without a special
   * case. Undefined when the probe ran no ping (older probes).
   */
  public static toPingMonitorResponse(
    ping: NetworkDevicePingResult | undefined,
  ): PingMonitorResponse | undefined {
    if (!ping) {
      return undefined;
    }

    /*
     * Loss is the one number every reader wants; when the probe did not
     * measure it, the verdict implies it - an answered ping lost nothing
     * that matters, a silent one lost everything.
     */
    const packetLossPercent: number =
      typeof ping.packetLossPercent === "number" &&
      isFinite(ping.packetLossPercent)
        ? ping.packetLossPercent
        : ping.isOnline
          ? 0
          : 100;

    return {
      packetsSent: ping.packetsSent ?? 0,
      packetsReceived: ping.packetsReceived ?? 0,
      packetLossPercent: packetLossPercent,
      avgRoundTripTimeInMs:
        typeof ping.avgRttMs === "number" && isFinite(ping.avgRttMs)
          ? ping.avgRttMs
          : undefined,
    };
  }

  /*
   * Every Network Device monitor in the project whose steps name one of the
   * given devices, with its steps and the flags that say it is paused.
   * Shared by the poll fan-out above, the SNMP trap fan-out and the stale
   * poll check. The caller skips paused monitors and the steps that name
   * another device.
   *
   * Read through MonitorNetworkDevice, which Postgres keeps from every
   * monitor's steps (see the model): one index lookup by device, then the
   * monitors found, by id. The work is the device's, not the project's.
   *
   * It used to read the steps of every hand-made Network Device monitor in
   * the project (a monitor no template, rule or policy provisioned, which
   * names its device only in its steps), in OFFSET pages of 10,000, and keep
   * the ones naming the device - on every poll of every device and every
   * trap: at 100,000 devices polled every five minutes, about 333 reads of
   * all of them a second. The lookup by autoProvisionedNetworkDeviceId it
   * ran beside that is gone too: a provisioned monitor's steps name its
   * device like any other's, so the table holds it, and it also holds a
   * provisioned monitor whose steps were edited to name another device,
   * which neither query found.
   *
   * `select` adds columns to the monitors read (the stale poll check wants
   * createdAt).
   */
  public static async findMonitorsWatchingDevices(data: {
    projectId: ObjectID;
    deviceIds: Array<string>;
    select?: Select<Monitor> | undefined;
  }): Promise<Array<Monitor>> {
    const deviceIds: Array<string> = Array.from(
      new Set(
        data.deviceIds.filter((deviceId: string): boolean => {
          return ObjectID.isValidUUID(deviceId);
        }),
      ),
    );

    if (deviceIds.length === 0) {
      return [];
    }

    const monitorIds: Set<string> = new Set();

    for (const chunk of NetworkDeviceWalkUtil.toChunks(deviceIds)) {
      for (const monitorId of await NetworkDeviceWalkUtil.findMonitorIdsWatching(
        {
          projectId: data.projectId,
          deviceIds: chunk,
        },
      )) {
        monitorIds.add(monitorId);
      }
    }

    if (monitorIds.size === 0) {
      return [];
    }

    const monitors: Array<Monitor> = [];

    for (const chunk of NetworkDeviceWalkUtil.toChunks(
      Array.from(monitorIds).sort(),
    )) {
      monitors.push(
        ...(await MonitorService.findBy({
          query: {
            _id: QueryHelper.any(chunk),
            // A row and its monitor always share a project; asked anyway.
            projectId: data.projectId,
            monitorType: MonitorType.NetworkDevice,
          },
          select: {
            ...(data.select || {}),
            _id: true,
            projectId: true,
            monitorSteps: true,
            ...MONITOR_PAUSE_FLAGS_SELECT,
          },
          sort: {
            _id: SortOrder.Ascending,
          },
          limit: chunk.length,
          skip: 0,
          props: {
            isRoot: true,
          },
        })),
      );
    }

    return monitors;
  }

  /*
   * The ids of the monitors whose steps name one of the devices (at most
   * FAN_OUT_ID_CHUNK_SIZE of them), in pages by row id - a device has a
   * handful of monitors, so one page nearly always holds them all.
   */
  private static async findMonitorIdsWatching(data: {
    projectId: ObjectID;
    deviceIds: Array<string>;
  }): Promise<Array<string>> {
    const monitorIds: Array<string> = [];
    let cursor: ObjectID | undefined = undefined;

    for (;;) {
      const page: Array<MonitorNetworkDevice> =
        await MonitorNetworkDeviceService.findBy({
          query: {
            projectId: data.projectId,
            networkDeviceId: QueryHelper.any(data.deviceIds),
            ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
          },
          select: {
            _id: true,
            monitorId: true,
          },
          sort: {
            _id: SortOrder.Ascending,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      for (const row of page) {
        if (row.monitorId) {
          monitorIds.push(row.monitorId.toString());
        }
      }

      const last: ObjectID | null | undefined = page[page.length - 1]?.id;

      if (page.length < LIMIT_MAX || !last) {
        return monitorIds;
      }

      cursor = last;
    }
  }

  private static toChunks(ids: Array<string>): Array<Array<string>> {
    const chunks: Array<Array<string>> = [];

    for (
      let index: number = 0;
      index < ids.length;
      index += NetworkDeviceWalkUtil.FAN_OUT_ID_CHUNK_SIZE
    ) {
      chunks.push(
        ids.slice(index, index + NetworkDeviceWalkUtil.FAN_OUT_ID_CHUNK_SIZE),
      );
    }

    return chunks;
  }
}
