import {
  ProbeIngestJobData,
  IncomingEmailJobData,
} from "../../Services/Queue/TelemetryQueueService";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import OneUptimeDate from "Common/Types/Date";
import MonitorTestService from "Common/Server/Services/MonitorTestService";
import MonitorService from "Common/Server/Services/MonitorService";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceWalkUtil from "Common/Server/Utils/Monitor/NetworkDeviceWalkUtil";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeService from "Common/Server/Services/ProbeService";
import SnmpTrapLogWriter from "../../Services/SnmpTrapLogWriter";
import { JSONObject } from "Common/Types/JSON";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { redactMonitorSecret } from "Common/Server/Utils/Monitor/MonitorPayloadRedaction";

export async function processProbeFromQueue(
  jobData: ProbeIngestJobData,
): Promise<void> {
  const probeResponse: ProbeMonitorResponse = JSONFunctions.deserialize(
    jobData.probeMonitorResponse?.["probeMonitorResponse"] as JSONObject,
  ) as unknown as ProbeMonitorResponse;

  if (!probeResponse) {
    throw new BadDataException("ProbeMonitorResponse not found");
  }

  // this is when the resource was ingested.
  probeResponse.ingestedAt = OneUptimeDate.getCurrentDate();

  if (jobData.jobType === "probe-response") {
    // Handle regular probe response
    await MonitorResourceUtil.monitorResource(probeResponse);
  } else if (jobData.jobType === "monitor-test" && jobData.testId) {
    // Handle monitor test response
    const testId: ObjectID = new ObjectID(jobData.testId);

    if (!testId) {
      throw new BadDataException("TestId not found");
    }

    probeResponse.ingestedAt = OneUptimeDate.getCurrentDate();

    // save the probe response to the monitor test.
    const stepResponse: MonitorStepProbeResponse = {
      [probeResponse.monitorStepId.toString()]: {
        ...JSON.parse(JSON.stringify(probeResponse)),
        monitoredAt: OneUptimeDate.getCurrentDate(),
      } as ProbeMonitorResponse,
    };

    await MonitorTestService.mergeStepProbeResponse({
      testId: testId,
      monitorStepProbeResponse: stepResponse,
    });
  } else {
    throw new BadDataException(`Invalid job type: ${jobData.jobType}`);
  }
}

/*
 * Fans an SNMP trap out to the SNMP monitors it belongs to: monitors that
 * are (a) assigned to the probe that received the trap and (b) configured
 * with a hostname matching the trap's source IP address (exact match, or
 * via the cached-DNS fallback for devices registered by name). Each match
 * gets an event-driven ProbeMonitorResponse carrying only snmpTrapResponse
 * — MonitorResource evaluates it against trap criteria without touching
 * the monitor's check state.
 *
 * Every trap is also persisted to the telemetry Log table (one row per
 * matched device; unmatched traps land in the probe's project when the
 * probe is project-scoped) so trap history is queryable — see
 * SnmpTrapLogWriter.
 */
export async function processSnmpTrapFromQueue(
  jobData: ProbeIngestJobData,
): Promise<void> {
  const requestBody: JSONObject | undefined = jobData.snmpTrap;

  if (!requestBody) {
    throw new BadDataException("SNMP trap data not found");
  }

  const snmpTrap: SnmpTrap = JSONFunctions.deserialize(
    requestBody["snmpTrap"] as JSONObject,
  ) as unknown as SnmpTrap;

  const probeIdAsString: string | undefined = requestBody["probeId"] as
    | string
    | undefined;

  if (!snmpTrap || !snmpTrap.sourceIpAddress || !snmpTrap.trapOid) {
    throw new BadDataException("SNMP trap is missing source or trap OID");
  }

  if (!probeIdAsString) {
    throw new BadDataException("Probe ID not found on SNMP trap request");
  }

  const probeId: ObjectID = new ObjectID(probeIdAsString);

  /*
   * Traps are matched through the NetworkDevice inventory: devices polled
   * by this probe whose hostname matches the trap source IP. Monitors then
   * match by referencing one of those devices. Resolved before the monitor
   * lookup so trap persistence happens even when the probe has no monitors.
   */
  const matchingDevices: Array<NetworkDevice> =
    await NetworkDeviceHydrationUtil.findDevicesByProbeAndSource({
      probeId: probeId,
      sourceIpAddress: snmpTrap.sourceIpAddress,
      select: {
        name: true,
      },
    });

  // Persist trap history first — it must not depend on monitor matching.
  if (matchingDevices.length > 0) {
    await SnmpTrapLogWriter.writeTrapLogRows({
      snmpTrap: snmpTrap,
      probeId: probeId,
      devices: matchingDevices,
    });
  } else {
    const probe: Probe | null = await ProbeService.findOneById({
      id: probeId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (probe?.projectId) {
      await SnmpTrapLogWriter.writeUnmatchedTrapLogRow({
        snmpTrap: snmpTrap,
        probeId: probeId,
        projectId: probe.projectId,
      });
    }
  }

  const matchingDeviceIds: Set<string> = new Set(
    matchingDevices
      .map((device: NetworkDevice) => {
        return device.id?.toString() || "";
      })
      .filter(Boolean),
  );

  if (matchingDeviceIds.size === 0) {
    logger.debug(
      `SNMP trap from ${snmpTrap.sourceIpAddress}: no NetworkDevice on probe ${probeId.toString()} matches this source. Trap logged as unmatched where possible.`,
    );
    return;
  }

  /*
   * Network Device monitors are not probe-executed (no MonitorProbe rows) —
   * they are the alerting layer over device walks and traps. Match monitors
   * the same way the walk fan-out does: every Network Device monitor in the
   * matched devices' projects whose steps reference a matched device.
   */
  const projectIds: Set<string> = new Set(
    matchingDevices
      .map((device: NetworkDevice) => {
        return device.projectId?.toString() || "";
      })
      .filter(Boolean),
  );

  const monitors: Array<Monitor> = [];

  for (const projectIdAsString of projectIds) {
    monitors.push(
      ...(await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: new ObjectID(projectIdAsString),
        deviceIds: Array.from(matchingDeviceIds),
      })),
    );
  }

  if (monitors.length === 0) {
    logger.debug(
      `SNMP trap from ${snmpTrap.sourceIpAddress}: no Network Device monitor references the matched device(s). Trap logged; skipping criteria evaluation.`,
    );
    return;
  }

  let matchedSteps: number = 0;

  for (const monitor of monitors) {
    if (
      monitor.disableActiveMonitoring ||
      monitor.disableActiveMonitoringBecauseOfManualIncident ||
      monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
    ) {
      continue;
    }

    if (!monitor.id || !monitor.projectId) {
      continue;
    }

    const monitorSteps: MonitorSteps | undefined = monitor.monitorSteps;

    for (const monitorStep of monitorSteps?.data?.monitorStepsInstanceArray ||
      []) {
      const referencedDeviceId: string | undefined =
        monitorStep.data?.networkDeviceMonitor?.networkDeviceId;

      if (!referencedDeviceId || !matchingDeviceIds.has(referencedDeviceId)) {
        continue;
      }

      matchedSteps++;

      const trapResponse: ProbeMonitorResponse = {
        projectId: monitor.projectId,
        monitorId: monitor.id,
        monitorStepId: monitorStep.id,
        probeId: probeId,
        snmpTrapResponse: snmpTrap,
        failureCause: "",
        monitoredAt: OneUptimeDate.getCurrentDate(),
        ingestedAt: OneUptimeDate.getCurrentDate(),
      };

      try {
        await MonitorResourceUtil.monitorResource(trapResponse);
      } catch (err) {
        logger.error(
          `Error processing SNMP trap for monitor ${monitor.id.toString()}:`,
        );
        logger.error(err);
      }
    }
  }

  logger.debug(
    `SNMP trap ${snmpTrap.trapOid} from ${snmpTrap.sourceIpAddress}: matched ${matchedSteps} monitor step(s) across ${monitors.length} SNMP monitor(s) on probe ${probeId.toString()}.`,
  );
}

/*
 * Processes one device walk reported by the device's assigned probe: rates,
 * inventory, device metrics, and fan-out to the monitors alerting on the
 * device. See NetworkDeviceWalkUtil for the pipeline itself.
 */
export async function processNetworkDeviceWalkFromQueue(
  jobData: ProbeIngestJobData,
): Promise<void> {
  const requestBody: JSONObject | undefined = jobData.networkDeviceWalk;

  if (!requestBody) {
    throw new BadDataException("Network device walk data not found");
  }

  const probeIdAsString: string | undefined = requestBody["probeId"] as
    | string
    | undefined;
  const networkDeviceIdAsString: string | undefined = requestBody[
    "networkDeviceId"
  ] as string | undefined;

  if (!probeIdAsString || !networkDeviceIdAsString) {
    throw new BadDataException(
      "Network device walk is missing probeId or networkDeviceId",
    );
  }

  /*
   * Validate the RAW value: JSONFunctions.deserialize(undefined) returns
   * {}, which is truthy — checking the deserialized result would make this
   * guard dead code.
   */
  if (!requestBody["snmpResponse"]) {
    throw new BadDataException("Network device walk has no snmpResponse");
  }

  const snmpResponse: SnmpMonitorResponse = JSONFunctions.deserialize(
    requestBody["snmpResponse"] as JSONObject,
  ) as unknown as SnmpMonitorResponse;

  const monitoredAtValue: unknown = requestBody["monitoredAt"];
  const monitoredAt: Date = monitoredAtValue
    ? new Date(monitoredAtValue as string)
    : OneUptimeDate.getCurrentDate();

  await NetworkDeviceWalkUtil.processWalkResult({
    probeId: new ObjectID(probeIdAsString),
    networkDeviceId: new ObjectID(networkDeviceIdAsString),
    snmpResponse: snmpResponse,
    monitoredAt: isNaN(monitoredAt.getTime())
      ? OneUptimeDate.getCurrentDate()
      : monitoredAt,
  });
}

export async function processIncomingEmailFromQueue(
  jobData: ProbeIngestJobData,
): Promise<void> {
  const emailData: IncomingEmailJobData | undefined = jobData.incomingEmail;

  if (!emailData) {
    throw new BadDataException("Incoming email data not found");
  }

  const monitorSecretKeyAsString: string = emailData.secretKey;

  if (!monitorSecretKeyAsString) {
    throw new BadDataException("Invalid Secret Key");
  }

  const monitor: Monitor | null = await MonitorService.findOneBy({
    query: {
      incomingEmailSecretKey: new ObjectID(monitorSecretKeyAsString),
      monitorType: MonitorType.IncomingEmail,
    },
    select: {
      _id: true,
      projectId: true,
      disableActiveMonitoring: true,
      disableActiveMonitoringBecauseOfManualIncident: true,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
    },
    props: {
      isRoot: true,
    },
  });

  if (!monitor || !monitor._id) {
    throw new BadDataException(ExceptionMessages.MonitorNotFound);
  }

  if (!monitor.projectId) {
    throw new BadDataException("Project not found");
  }

  /*
   * Ingest boundary. This monitor's `incomingEmailSecretKey` IS its inbound
   * address -- `generateMonitorEmailAddress` builds
   * `monitor-{secretKey}@{inboundDomain}` and `extractSecretKeyFromEmail` reads
   * the key straight back out -- so every copy of the recipient in this payload
   * is a copy of a live bearer credential: `emailTo`, the `To:` header, and the
   * `Received:` / `Delivered-To:` headers the relay stamped on the way in.
   *
   * Mask it here, before the payload becomes evidence, rather than at each
   * sink. Everything downstream of this point is fed from `dataToProcess`, and
   * it fans out into places a read-only principal can select from:
   * `Monitor.incomingEmailMonitorRequest` just below, and -- via
   * `monitorResource` -> `MonitorSummaryCapture` -- `Incident.monitorSummary`
   * and `Alert.monitorSummary`, plus `MonitorLog.logBody`. One strip at the
   * boundary covers all of them and any sink added later, which is the same
   * shape as `stripAgentCredentials` on the server-monitor path.
   *
   * https://github.com/OneUptime/oneuptime/issues/3360
   */
  const redactedEmailData: IncomingEmailJobData = redactMonitorSecret(
    emailData,
    monitorSecretKeyAsString,
  );

  const now: Date = OneUptimeDate.getCurrentDate();

  const incomingEmailRequest: IncomingEmailMonitorRequest = {
    projectId: monitor.projectId,
    monitorId: new ObjectID(monitor._id.toString()),
    emailFrom: redactedEmailData.emailFrom,
    emailTo: redactedEmailData.emailTo,
    emailSubject: redactedEmailData.emailSubject,
    emailBody: redactedEmailData.emailBody,
    emailBodyHtml: redactedEmailData.emailBodyHtml,
    emailHeaders: redactedEmailData.emailHeaders,
    emailReceivedAt: now,
    checkedAt: now,
    attachments: redactedEmailData.attachments,
    onlyCheckForIncomingEmailReceivedAt: false,
  };

  /*
   * Update monitor with last email received time. Heartbeat write:
   * single-statement UPDATE, no hooks and no `version` bump. These columns
   * trigger no onUpdateSuccess work, and this deliberately drops the
   * per-update workflow trigger + audit-log entry Monitor's
   * @EnableWorkflow / @EnableAuditLog would otherwise fire on every email
   * (those are gated on the model flag, not on ignoreHooks) — a heartbeat
   * should not spam workflows/audit. See ServiceService.updateLastSeen.
   */
  await MonitorService.updateColumnsByIdWithoutHooks({
    id: new ObjectID(monitor._id.toString()),
    data: {
      incomingEmailMonitorLastEmailReceivedAt: now,
      incomingEmailMonitorRequest: incomingEmailRequest as unknown as Record<
        string,
        unknown
      >,
      incomingEmailMonitorHeartbeatCheckedAt: now,
    },
  });

  /*
   * Skip disabled monitors before invoking monitorResource(). Incoming Email
   * monitors keep receiving mail from an external sender regardless of being
   * disabled in OneUptime, and monitorResource() would only re-fetch the
   * monitor, take a per-monitor Redis lock, and throw MonitorDisabled — pure
   * waste. The last-email-received update above is intentionally left in place
   * so heartbeat tracking stays accurate across maintenance/incident windows:
   * the CheckOnlineStatus cron skips disabled monitors and resumes afterwards,
   * relying on that timestamp.
   */
  if (
    monitor.disableActiveMonitoring ||
    monitor.disableActiveMonitoringBecauseOfManualIncident ||
    monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
  ) {
    logger.debug(
      `Incoming email received for disabled monitor ${monitor._id.toString()}. Skipping evaluation.`,
    );
    return;
  }

  // Process monitor resource
  await MonitorResourceUtil.monitorResource(incomingEmailRequest);
}

logger.debug("Probe ingest processing functions loaded");
