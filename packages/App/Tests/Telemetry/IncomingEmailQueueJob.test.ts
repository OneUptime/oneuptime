import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import Queue from "Common/Server/Infrastructure/Queue";

/*
 * TelemetryQueueService.addIncomingEmailJob carries an inbound email from the
 * webhook to the worker. It names the monitor address the mail was sent to:
 * `secretKey` for a generated address, `customLocalPart` for a custom one.
 *
 * Both are the monitor's credential, so neither may appear in the job ID --
 * job IDs surface in queue dashboards and logs, far from the monitor's ACL.
 *
 * The Queue module pulls in BullMQ at import time; only "what is enqueued"
 * is under test, so it is replaced wholesale.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Telemetry: "Telemetry",
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: jest.fn(),
      readBody: jest.fn(),
      deleteBody: jest.fn(),
    },
  };
});

import TelemetryQueueService, {
  TelemetryIngestJobData,
  TelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

type MockedFn = jest.Mock;

const addJobMock: MockedFn = Queue.addJob as unknown as MockedFn;

const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";

type EnqueuedFunction = () => {
  jobId: string;
  jobData: TelemetryIngestJobData;
};

const enqueued: EnqueuedFunction = (): {
  jobId: string;
  jobData: TelemetryIngestJobData;
} => {
  expect(addJobMock).toHaveBeenCalledTimes(1);

  const [queueName, jobId, jobName, jobData, options] = addJobMock.mock
    .calls[0] as [string, string, string, TelemetryIngestJobData, JSONObject];

  expect(queueName).toBe("Telemetry");
  expect(jobName).toBe("ProcessTelemetry");
  expect(options["skipExistenceCheck"]).toBe(true);

  return { jobId, jobData };
};

const EMAIL: {
  emailFrom: string;
  emailTo: string;
  emailSubject: string;
  emailBody: string;
} = {
  emailFrom: "alerts@acme.example",
  emailTo: "nightly-backups@inbound.oneuptime.example",
  emailSubject: "Nightly backups completed",
  emailBody: "Backup finished.",
};

describe("TelemetryQueueService.addIncomingEmailJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addJobMock.mockResolvedValue(undefined as never);
  });

  test("carries a custom address's name to the worker", async () => {
    await TelemetryQueueService.addIncomingEmailJob({
      customLocalPart: "nightly-backups",
      ...EMAIL,
    });

    const { jobData } = enqueued();

    expect(jobData.type).toBe(TelemetryType.ProbeIngest);
    expect(jobData.probeIngest?.jobType).toBe("incoming-email");
    expect(jobData.probeIngest?.incomingEmail?.customLocalPart).toBe(
      "nightly-backups",
    );
    expect(jobData.probeIngest?.incomingEmail?.secretKey).toBeUndefined();
    expect(jobData.probeIngest?.incomingEmail?.emailSubject).toBe(
      "Nightly backups completed",
    );
  });

  test("carries a generated address's secret key to the worker", async () => {
    await TelemetryQueueService.addIncomingEmailJob({
      secretKey: SECRET,
      ...EMAIL,
    });

    const { jobData } = enqueued();

    expect(jobData.probeIngest?.incomingEmail?.secretKey).toBe(SECRET);
    expect(jobData.probeIngest?.incomingEmail?.customLocalPart).toBeUndefined();
  });

  test("keeps the secret key out of the job id", async () => {
    await TelemetryQueueService.addIncomingEmailJob({
      secretKey: SECRET,
      ...EMAIL,
    });

    const { jobId } = enqueued();

    expect(jobId).toMatch(/^incoming-email-/);
    expect(jobId).not.toContain(SECRET);
  });

  test("keeps the custom name out of the job id", async () => {
    await TelemetryQueueService.addIncomingEmailJob({
      customLocalPart: "nightly-backups",
      ...EMAIL,
    });

    expect(enqueued().jobId).not.toContain("nightly-backups");
  });

  test("gives every job a distinct id", async () => {
    await TelemetryQueueService.addIncomingEmailJob({
      secretKey: SECRET,
      ...EMAIL,
    });
    await TelemetryQueueService.addIncomingEmailJob({
      secretKey: SECRET,
      ...EMAIL,
    });

    const ids: Array<string> = (
      addJobMock.mock.calls as unknown as Array<Array<string>>
    ).map((call: Array<string>) => {
      return call[1]!;
    });

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
