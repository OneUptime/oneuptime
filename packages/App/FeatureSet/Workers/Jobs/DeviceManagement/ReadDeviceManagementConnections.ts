import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import DeviceManagementReadRunner, {
  DeviceManagementReadOutcome,
} from "Common/Server/Utils/DeviceManagement/DeviceManagementReadRunner";
import DeviceManagementScheduler, {
  DEVICE_MANAGEMENT_READ_JOB,
  DEVICE_MANAGEMENT_READ_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/DeviceManagement/DeviceManagementScheduler";

/*
 * Device management connections (an Esper tenant, Inventory > Managed
 * Devices): Esper has no webhooks, so every minute, queue a read of each
 * connection that is due; each read runs as a job of its own
 * (DeviceManagementReadRunner), which imports the fleet and records how it
 * went on the connection.
 */

export async function runDeviceManagementRead(job?: QueueJob): Promise<void> {
  const connectionId: unknown = job?.data?.["connectionId"];

  if (typeof connectionId !== "string" || !ObjectID.isValidUUID(connectionId)) {
    throw new BadDataException(
      "A valid device management connection ID is required.",
    );
  }

  const outcome: DeviceManagementReadOutcome =
    await DeviceManagementReadRunner.run(new ObjectID(connectionId));

  // The outcome is on the connection; the log line names no device.
  logger.debug(
    `${DEVICE_MANAGEMENT_READ_JOB} ${connectionId}: ${outcome.status}`,
  );
}

JobDictionary.setJobFunction(
  DEVICE_MANAGEMENT_READ_JOB,
  runDeviceManagementRead,
);
JobDictionary.setTimeoutInMs(
  DEVICE_MANAGEMENT_READ_JOB,
  DEVICE_MANAGEMENT_READ_JOB_TIMEOUT_MS,
);

RunCron(
  "DeviceManagementConnection:ReadDueConnections",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 2 * 60 * 1000,
  },
  async () => {
    await DeviceManagementScheduler.enqueueDueConnections(new Date());
  },
);
