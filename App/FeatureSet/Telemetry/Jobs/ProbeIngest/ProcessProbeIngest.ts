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
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeService from "Common/Server/Services/ProbeService";
import SnmpTrapLogWriter from "../../Services/SnmpTrapLogWriter";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";

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

  // Monitors this probe is assigned to.
  const monitorProbes: Array<MonitorProbe> = await MonitorProbeService.findBy({
    query: {
      probeId: probeId,
    },
    select: {
      monitorId: true,
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  const monitorIds: Array<ObjectID> = monitorProbes
    .map((monitorProbe: MonitorProbe) => {
      return monitorProbe.monitorId;
    })
    .filter((monitorId: ObjectID | undefined): monitorId is ObjectID => {
      return Boolean(monitorId);
    });

  if (monitorIds.length === 0) {
    logger.debug(
      `SNMP trap from ${snmpTrap.sourceIpAddress}: probe ${probeId.toString()} has no monitors. Trap logged; skipping criteria evaluation.`,
    );
    return;
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

  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: {
      _id: QueryHelper.any(
        monitorIds.map((monitorId: ObjectID) => {
          return monitorId.toString();
        }),
      ),
      monitorType: MonitorType.NetworkDevice,
    },
    select: {
      _id: true,
      projectId: true,
      monitorSteps: true,
      disableActiveMonitoring: true,
      disableActiveMonitoringBecauseOfManualIncident: true,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

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

  const now: Date = OneUptimeDate.getCurrentDate();

  const incomingEmailRequest: IncomingEmailMonitorRequest = {
    projectId: monitor.projectId,
    monitorId: new ObjectID(monitor._id.toString()),
    emailFrom: emailData.emailFrom,
    emailTo: emailData.emailTo,
    emailSubject: emailData.emailSubject,
    emailBody: emailData.emailBody,
    emailBodyHtml: emailData.emailBodyHtml,
    emailHeaders: emailData.emailHeaders,
    emailReceivedAt: now,
    checkedAt: now,
    attachments: emailData.attachments,
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
