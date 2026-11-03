import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import NetworkControllerDeviceAddRunner, {
  NETWORK_CONTROLLER_DEVICE_ADD_JOB,
  NETWORK_CONTROLLER_DEVICE_ADD_JOB_TIMEOUT_MS,
  NetworkControllerDeviceAddOutcome,
} from "Common/Server/Utils/NetworkController/NetworkControllerDeviceAddRunner";

/*
 * Network controller connections (a Meraki organization, Network >
 * Traffic): Add devices. The add-devices route records the ask on the
 * connection and queues this job, which adds the organization's devices
 * that are no network device here (NetworkControllerDeviceAddRunner) and
 * records how it went on the connection.
 */

export async function runNetworkControllerDeviceAdd(
  job?: QueueJob,
): Promise<void> {
  const connectionId: unknown = job?.data?.["connectionId"];

  if (typeof connectionId !== "string" || !ObjectID.isValidUUID(connectionId)) {
    throw new BadDataException(
      "A valid network controller connection ID is required.",
    );
  }

  const outcome: NetworkControllerDeviceAddOutcome =
    await NetworkControllerDeviceAddRunner.run(new ObjectID(connectionId));

  // The outcome is on the connection; the log line names no device.
  logger.debug(
    `${NETWORK_CONTROLLER_DEVICE_ADD_JOB} ${connectionId}: ${outcome.status}`,
  );
}

JobDictionary.setJobFunction(
  NETWORK_CONTROLLER_DEVICE_ADD_JOB,
  runNetworkControllerDeviceAdd,
);
JobDictionary.setTimeoutInMs(
  NETWORK_CONTROLLER_DEVICE_ADD_JOB,
  NETWORK_CONTROLLER_DEVICE_ADD_JOB_TIMEOUT_MS,
);
