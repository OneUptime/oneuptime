import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import NetworkControllerReadRunner, {
  NetworkControllerReadOutcome,
} from "Common/Server/Utils/NetworkController/NetworkControllerReadRunner";
import NetworkControllerScheduler, {
  NETWORK_CONTROLLER_READ_JOB,
  NETWORK_CONTROLLER_READ_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/NetworkController/NetworkControllerScheduler";

/*
 * Network controller connections (a Meraki organization, Network >
 * Traffic): every minute, queue a read of each connection that is due;
 * each read runs as a job of its own (NetworkControllerReadRunner), which
 * stores what it read and records how it went on the connection.
 */

export async function runNetworkControllerRead(job?: QueueJob): Promise<void> {
  const connectionId: unknown = job?.data?.["connectionId"];

  if (typeof connectionId !== "string" || !ObjectID.isValidUUID(connectionId)) {
    throw new BadDataException(
      "A valid network controller connection ID is required.",
    );
  }

  const outcome: NetworkControllerReadOutcome =
    await NetworkControllerReadRunner.run(new ObjectID(connectionId));

  // The outcome is on the connection; the log line names no traffic.
  logger.debug(
    `${NETWORK_CONTROLLER_READ_JOB} ${connectionId}: ${outcome.status}`,
  );
}

JobDictionary.setJobFunction(
  NETWORK_CONTROLLER_READ_JOB,
  runNetworkControllerRead,
);
JobDictionary.setTimeoutInMs(
  NETWORK_CONTROLLER_READ_JOB,
  NETWORK_CONTROLLER_READ_JOB_TIMEOUT_MS,
);

RunCron(
  "NetworkControllerConnection:ReadDueConnections",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 2 * 60 * 1000,
  },
  async () => {
    await NetworkControllerScheduler.enqueueDueConnections(new Date());
  },
);
