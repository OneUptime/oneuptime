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
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
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

  // Update monitor with last email received time
  await MonitorService.updateOneById({
    id: new ObjectID(monitor._id.toString()),
    data: {
      incomingEmailMonitorLastEmailReceivedAt: now,
      incomingEmailMonitorRequest: incomingEmailRequest as unknown as Record<
        string,
        unknown
      >,
      incomingEmailMonitorHeartbeatCheckedAt: now,
    },
    props: {
      isRoot: true,
    },
  });

  // Process monitor resource
  await MonitorResourceUtil.monitorResource(incomingEmailRequest);
}

logger.debug("Probe ingest processing functions loaded");
