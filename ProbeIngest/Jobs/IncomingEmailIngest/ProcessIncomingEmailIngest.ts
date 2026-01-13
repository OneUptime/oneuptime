import { IncomingEmailIngestJobData } from "../../Services/Queue/IncomingEmailIngestQueueService";
import logger from "Common/Server/Utils/Logger";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { PROBE_INGEST_CONCURRENCY } from "../../Config";

// Set up the worker for processing incoming email ingest queue
QueueWorker.getWorker(
  QueueName.IncomingEmailIngest,
  async (job: QueueJob): Promise<void> => {
    logger.debug(`Processing incoming email ingestion job: ${job.name}`);

    try {
      const jobData: IncomingEmailIngestJobData =
        job.data as IncomingEmailIngestJobData;

      await processIncomingEmailFromQueue(jobData);

      logger.debug(
        `Successfully processed incoming email ingestion job: ${job.name}`,
      );
    } catch (error) {
      /*
       * Certain BadDataException cases are expected / non-actionable and should not fail the job.
       * These include disabled monitors (manual, maintenance, explicitly disabled) and missing monitors
       * (e.g. secret key referencing a deleted monitor). Retrying provides no value and only creates noise.
       */
      if (
        error instanceof BadDataException &&
        (error.message === ExceptionMessages.MonitorNotFound ||
          error.message === ExceptionMessages.MonitorDisabled)
      ) {
        return;
      }

      logger.error(`Error processing incoming email ingestion job:`);
      logger.error(error);
      throw error; // rethrow other errors so they are visible and retried if needed.
    }
  },
  { concurrency: PROBE_INGEST_CONCURRENCY }, // Use same concurrency as probe ingest
);

async function processIncomingEmailFromQueue(
  jobData: IncomingEmailIngestJobData,
): Promise<void> {
  const monitorSecretKeyAsString: string = jobData.secretKey;

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

  const emailHeaders: Dictionary<string> | undefined = jobData.emailHeaders;

  const incomingEmailRequest: IncomingEmailMonitorRequest = {
    projectId: monitor.projectId,
    monitorId: new ObjectID(monitor._id.toString()),
    emailFrom: jobData.emailFrom,
    emailTo: jobData.emailTo,
    emailSubject: jobData.emailSubject,
    emailBody: jobData.emailBody,
    emailBodyHtml: jobData.emailBodyHtml,
    emailHeaders: emailHeaders,
    emailReceivedAt: now,
    checkedAt: now,
    attachments: jobData.attachments,
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

logger.debug("Incoming email ingest worker initialized");
