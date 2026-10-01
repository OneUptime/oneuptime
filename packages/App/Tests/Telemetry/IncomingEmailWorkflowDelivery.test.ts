/*
 * The queue worker's half of the Incoming Email trigger: a job for a
 * workflow's address (`workflow-{secretKey}@`) is handed to the workflow
 * service, which finds the workflow and starts the run
 * (Common/Server/Types/Workflow/Components/IncomingEmail.ts).
 *
 * Pinned here:
 *   - it goes to the workflow service's delivery route, with the cluster key,
 *     carrying the key and the email - and never through the monitor path;
 *   - the email is handed over whole: every address in To and Cc, both
 *     bodies, the headers, the attachments, and the time the webhook took it;
 *   - a refused or failed delivery throws, so the queue retries the job,
 *     while mail the trigger declines (an address nobody has any more, a
 *     workflow that is off) does not;
 *   - the key - the address - is never written to the log.
 *
 * The workflow service is reached through Common's API.post, which is
 * mocked; MonitorService and MonitorResource are mocked to prove they are not
 * used.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(() => {
        return Promise.resolve();
      }),
    },
  };
});

jest.mock(
  "Common/Server/Services/InboundEmail/InboundEmailProviderFactory",
  () => {
    return {
      __esModule: true,
      default: {
        getInboundDomain: jest.fn(() => {
          return "inbound.oneuptime.example";
        }),
      },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

import { processIncomingEmailFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import IncomingEmailWorkflowDelivery from "../../FeatureSet/Telemetry/Services/IncomingEmailWorkflowDelivery";
import {
  IncomingEmailJobData,
  ProbeIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { WorkflowHostname } from "Common/Server/EnvironmentConfig";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  IncomingEmailTriggerDeliveryStatus,
  IncomingEmailTriggerEmail,
} from "Common/Types/Workflow/IncomingEmailTrigger";
import API from "Common/Utils/API";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const DOMAIN: string = "inbound.oneuptime.example";
const WORKFLOW_SECRET: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const WORKFLOW_ADDRESS: string = `workflow-${WORKFLOW_SECRET}@${DOMAIN}`;

const RECEIVED_AT: Date = new Date("2026-10-01T08:30:00.000Z");

const post: jest.Mock = API.post as unknown as jest.Mock;
const findMonitor: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const debug: jest.Mock = logger.debug as unknown as jest.Mock;

type JobFunction = (
  overrides?: Partial<IncomingEmailJobData>,
  ingestionTimestamp?: Date | string,
) => ProbeIngestJobData;

// What the inbound webhook queues for mail to a workflow's address.
const job: JobFunction = (
  overrides?: Partial<IncomingEmailJobData>,
  ingestionTimestamp?: Date | string,
): ProbeIngestJobData => {
  return {
    jobType: "incoming-email",
    ingestionTimestamp: (ingestionTimestamp ?? RECEIVED_AT) as Date,
    incomingEmail: {
      workflowSecretKey: WORKFLOW_SECRET,
      emailFrom: "alerts@vendor.example",
      emailTo: WORKFLOW_ADDRESS,
      emailToAddresses: [WORKFLOW_ADDRESS, "ops@acme.example"],
      emailCcAddresses: ["oncall@acme.example"],
      emailSubject: "Disk space low on db-1",
      emailBody: "Only 4% left.",
      emailBodyHtml: "<p>Only 4% left.</p>",
      emailHeaders: { "Message-ID": "<abc@vendor.example>" },
      attachments: [
        { filename: "graph.png", contentType: "image/png", size: 2048 },
      ],
      ...(overrides || {}),
    },
  };
};

type PostedFunction = () => {
  url: URL;
  data: { secretKey: string; email: IncomingEmailTriggerEmail };
  headers: Record<string, string>;
};

const posted: PostedFunction = (): {
  url: URL;
  data: { secretKey: string; email: IncomingEmailTriggerEmail };
  headers: Record<string, string>;
} => {
  expect(post).toHaveBeenCalledTimes(1);

  return post.mock.calls[0]![0] as never;
};

const answer: (status: IncomingEmailTriggerDeliveryStatus) => void = (
  status: IncomingEmailTriggerDeliveryStatus,
): void => {
  post.mockResolvedValue(
    new HTTPResponse(200, { status: status }, {}) as never,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  answer(IncomingEmailTriggerDeliveryStatus.Scheduled);
});

describe("mail for a workflow's address", () => {
  it("is handed to the workflow service's delivery route", async () => {
    await processIncomingEmailFromQueue(job());

    const url: URL = posted().url;

    expect(url.toString()).toBe(
      `http://${WorkflowHostname.toString()}/workflow/incoming-email/deliver`,
    );
    expect(url.toString()).toBe(
      IncomingEmailWorkflowDelivery.getDeliveryUrl().toString(),
    );
  });

  it("with the cluster key, which the route requires", async () => {
    await processIncomingEmailFromQueue(job());

    expect(posted().headers).toEqual(
      ClusterKeyAuthorization.getClusterKeyHeaders(),
    );
  });

  it("carrying the workflow's key", async () => {
    await processIncomingEmailFromQueue(job());

    expect(posted().data.secretKey).toBe(WORKFLOW_SECRET);
  });

  it("carrying the whole email", async () => {
    await processIncomingEmailFromQueue(job());

    expect(posted().data.email).toEqual({
      from: "alerts@vendor.example",
      to: [WORKFLOW_ADDRESS, "ops@acme.example"],
      cc: ["oncall@acme.example"],
      subject: "Disk space low on db-1",
      body: "Only 4% left.",
      htmlBody: "<p>Only 4% left.</p>",
      headers: { "Message-ID": "<abc@vendor.example>" },
      attachments: [
        { filename: "graph.png", contentType: "image/png", size: 2048 },
      ],
      receivedAt: RECEIVED_AT.toISOString(),
    });
  });

  it("received when the webhook took it, also after the job's round trip through the queue", async () => {
    await processIncomingEmailFromQueue(job({}, RECEIVED_AT.toISOString()));

    expect(posted().data.email.receivedAt).toBe(RECEIVED_AT.toISOString());
  });

  it("a job without a time it can read is received now", async () => {
    const before: number = Date.now();

    await processIncomingEmailFromQueue(job({}, "not a date"));

    expect(
      new Date(posted().data.email.receivedAt).getTime(),
    ).toBeGreaterThanOrEqual(before - 1000);
  });

  it("never goes near the monitor path", async () => {
    await processIncomingEmailFromQueue(job());

    expect(findMonitor).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
    expect(MonitorService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
  });

  it("never writes the key to the log", async () => {
    await processIncomingEmailFromQueue(job());

    expect(JSON.stringify(debug.mock.calls)).not.toContain(WORKFLOW_SECRET);
  });
});

describe("what the workflow service answers", () => {
  it.each([
    IncomingEmailTriggerDeliveryStatus.NoWorkflow,
    IncomingEmailTriggerDeliveryStatus.NotIncomingEmailTrigger,
    IncomingEmailTriggerDeliveryStatus.WorkflowDisabled,
  ])(
    "%p is not a failure, so the job is not retried",
    async (status: IncomingEmailTriggerDeliveryStatus) => {
      answer(status);

      await expect(processIncomingEmailFromQueue(job())).resolves.toBe(
        undefined,
      );
      await expect(
        IncomingEmailWorkflowDelivery.deliver({
          emailData: job().incomingEmail!,
          receivedAt: RECEIVED_AT,
        }),
      ).resolves.toBe(status);
    },
  );

  it("an error answer fails the job, so the queue retries it", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "Invalid cluster key provided" },
        {},
      ) as never,
    );

    await expect(processIncomingEmailFromQueue(job())).rejects.toThrow(
      "The workflow service did not take an incoming email: Invalid cluster key provided",
    );
  });

  it("an unreachable workflow service fails the job too", async () => {
    post.mockRejectedValue(new Error("connect ECONNREFUSED") as never);

    await expect(processIncomingEmailFromQueue(job())).rejects.toThrow(
      "connect ECONNREFUSED",
    );
  });
});

describe("jobs queued before workflows received email", () => {
  it("without address lists, To is read from the one recipient monitors used", async () => {
    await processIncomingEmailFromQueue(
      job({
        emailTo: `Workflow <${WORKFLOW_ADDRESS}>`,
        emailToAddresses: undefined,
        emailCcAddresses: undefined,
      }),
    );

    expect(posted().data.email.to).toEqual([WORKFLOW_ADDRESS]);
    expect(posted().data.email.cc).toEqual([]);
  });

  it("a job for a monitor's address still goes the monitor's way", async () => {
    findMonitor.mockResolvedValue(null as never);

    await expect(
      processIncomingEmailFromQueue(
        job({
          workflowSecretKey: undefined,
          secretKey: "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba",
        }),
      ),
    ).rejects.toThrow();

    expect(findMonitor).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("IncomingEmailWorkflowDelivery.deliver on its own", () => {
  it("refuses a job that is not for a workflow", async () => {
    await expect(
      IncomingEmailWorkflowDelivery.deliver({
        emailData: job({ workflowSecretKey: undefined }).incomingEmail!,
        receivedAt: RECEIVED_AT,
      }),
    ).rejects.toThrow("This incoming email is not addressed to a workflow.");

    expect(post).not.toHaveBeenCalled();
  });

  it("an answer with no status is taken as scheduled", async () => {
    post.mockResolvedValue(new HTTPResponse(200, {}, {}) as never);

    await expect(
      IncomingEmailWorkflowDelivery.deliver({
        emailData: job().incomingEmail!,
        receivedAt: RECEIVED_AT,
      }),
    ).resolves.toBe(IncomingEmailTriggerDeliveryStatus.Scheduled);
  });

  it("the email it builds has every field, even from a sparse job", () => {
    const email: IncomingEmailTriggerEmail =
      IncomingEmailWorkflowDelivery.getEmail({
        emailData: {
          workflowSecretKey: WORKFLOW_SECRET,
          emailFrom: "",
          emailTo: "",
          emailSubject: "",
          emailBody: "",
          emailBodyHtml: undefined,
          emailHeaders: undefined,
          attachments: undefined,
        },
        receivedAt: RECEIVED_AT,
      });

    expect(email).toEqual({
      from: "",
      to: [],
      cc: [],
      subject: "",
      body: "",
      htmlBody: undefined,
      headers: undefined,
      attachments: undefined,
      receivedAt: RECEIVED_AT.toISOString(),
    } as unknown as JSONObject);
  });
});
