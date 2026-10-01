import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";

/*
 * POST /incoming-email/sendgrid/:secret -- the SendGrid Inbound Parse webhook.
 *
 * It decides which ADDRESSES a message was sent to, and enqueues a job for
 * each. A monitor's address has two shapes: the generated
 * `monitor-{secretKey}@` address (the job carries `secretKey`) and a custom
 * name (the job carries `customLocalPart`). A workflow's Incoming Email
 * trigger has `workflow-{secretKey}@` (the job carries `workflowSecretKey`).
 * Mail to anything else on -- or off -- the inbound domain is refused here,
 * before it reaches the queue.
 *
 * The provider is the real SendGridInboundProvider, so its parsing of the
 * webhook form is part of what is exercised.
 */

const DOMAIN: string = "inbound.oneuptime.example";
const WEBHOOK_SECRET: string = "hook-secret";
const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const WORKFLOW_SECRET: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const WORKFLOW_ADDRESS: string = `workflow-${WORKFLOW_SECRET}@${DOMAIN}`;

const mockRegisteredHandlers: Record<
  string,
  (req: ExpressRequest, res: ExpressResponse) => Promise<void>
> = {};

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return {
          post: (uri: string, ...handlers: Array<unknown>) => {
            mockRegisteredHandlers[uri] = handlers[
              handlers.length - 1
            ] as (typeof mockRegisteredHandlers)[string];
          },
        };
      },
    },
  };
});

jest.mock("Common/Server/Middleware/MultipartFormData", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock(
  "Common/Server/Services/InboundEmail/InboundEmailProviderFactory",
  () => {
    const SendGridInboundProvider: new (config: {
      inboundDomain: string;
      webhookSecret?: string;
    }) => unknown = (
      jest.requireActual(
        "Common/Server/Services/InboundEmail/Providers/SendGridInboundProvider",
      ) as { default: never }
    ).default;

    const provider: unknown = new SendGridInboundProvider({
      inboundDomain: "inbound.oneuptime.example",
      webhookSecret: "hook-secret",
    });

    return {
      __esModule: true,
      default: {
        isConfigured: jest.fn(() => {
          return true;
        }),
        getProvider: jest.fn(() => {
          return provider;
        }),
      },
    };
  },
);

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(() => {
      return {};
    }),
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addIncomingEmailJob: jest.fn(),
      },
    };
  },
);

import Response from "Common/Server/Utils/Response";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
// Importing the router module registers the route on the mocked router.
import "../../FeatureSet/Telemetry/API/ProbeIngest/IncomingEmail";

type MockedFn = jest.Mock;

const addJobMock: MockedFn =
  TelemetryQueueService.addIncomingEmailJob as unknown as MockedFn;
const sendJsonMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendErrorMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

type InvokeRouteFunction = (input: {
  to: string;
  cc?: string | undefined;
  envelope?: string | undefined;
  pathSecret?: string | undefined;
}) => Promise<void>;

// The multipart fields SendGrid Inbound Parse posts.
const invokeRoute: InvokeRouteFunction = async (input: {
  to: string;
  cc?: string | undefined;
  envelope?: string | undefined;
  pathSecret?: string | undefined;
}): Promise<void> => {
  const handler: (req: ExpressRequest, res: ExpressResponse) => Promise<void> =
    mockRegisteredHandlers["/incoming-email/sendgrid/:secret"]!;

  await handler(
    {
      params: { secret: input.pathSecret ?? WEBHOOK_SECRET },
      headers: {},
      body: {
        from: "Backups <nightly-backups@acme.example>",
        to: input.to,
        ...(input.cc !== undefined ? { cc: input.cc } : {}),
        ...(input.envelope !== undefined ? { envelope: input.envelope } : {}),
        subject: "Nightly backups completed",
        text: "Backup finished in 42 minutes.",
      },
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
  );
};

type EnqueuedJobFunction = () => JSONObject;

const enqueuedJob: EnqueuedJobFunction = (): JSONObject => {
  expect(addJobMock).toHaveBeenCalledTimes(1);

  return (addJobMock.mock.calls as unknown as Array<Array<JSONObject>>)[0]![0]!;
};

type EnqueuedJobsFunction = () => Array<JSONObject>;

const enqueuedJobs: EnqueuedJobsFunction = (): Array<JSONObject> => {
  return (addJobMock.mock.calls as unknown as Array<Array<JSONObject>>).map(
    (call: Array<JSONObject>) => {
      return call[0]!;
    },
  );
};

type ErrorMessageFunction = () => string;

const errorMessage: ErrorMessageFunction = (): string => {
  expect(sendErrorMock).toHaveBeenCalledTimes(1);

  return (
    (sendErrorMock.mock.calls as unknown as Array<Array<unknown>>)[0]![2] as
      | Error
      | undefined
  )?.message as string;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the webhook route is registered", () => {
  test("on the SendGrid path with the webhook secret segment", () => {
    expect(
      typeof mockRegisteredHandlers["/incoming-email/sendgrid/:secret"],
    ).toBe("function");
  });
});

describe("mail to a generated address", () => {
  test("is queued with the secret key and no custom name", async () => {
    await invokeRoute({ to: `monitor-${SECRET}@${DOMAIN}` });

    const job: JSONObject = enqueuedJob();

    expect(job["secretKey"]).toBe(SECRET);
    expect(job["customLocalPart"]).toBeUndefined();
    expect(job["emailTo"]).toBe(`monitor-${SECRET}@${DOMAIN}`);
    expect(job["emailSubject"]).toBe("Nightly backups completed");

    expect(sendJsonMock).toHaveBeenCalledTimes(1);
    expect(
      (sendJsonMock.mock.calls as unknown as Array<Array<unknown>>)[0]![2],
    ).toEqual({ status: "accepted", message: "Email queued for processing" });
  });

  test('is read out of a "Name <address>" recipient', async () => {
    await invokeRoute({ to: `Backups Monitor <monitor-${SECRET}@${DOMAIN}>` });

    expect(enqueuedJob()["secretKey"]).toBe(SECRET);
  });
});

describe("mail to a custom address", () => {
  test("is queued with the custom name and no secret key", async () => {
    await invokeRoute({ to: `nightly-backups@${DOMAIN}` });

    const job: JSONObject = enqueuedJob();

    expect(job["customLocalPart"]).toBe("nightly-backups");
    expect(job["secretKey"]).toBeUndefined();
  });

  test("is matched case-insensitively and queued lowercased", async () => {
    await invokeRoute({
      to: `Backups <Nightly-Backups@${DOMAIN.toUpperCase()}>`,
    });

    expect(enqueuedJob()["customLocalPart"]).toBe("nightly-backups");
  });

  test("a monitor- name that is not a key is a custom name", async () => {
    await invokeRoute({ to: `monitor-backups@${DOMAIN}` });

    const job: JSONObject = enqueuedJob();

    expect(job["customLocalPart"]).toBe("monitor-backups");
    expect(job["secretKey"]).toBeUndefined();
  });
});

describe("mail that is not for a monitor", () => {
  test.each([
    "nightly-backups@acme.example",
    `nightly-backups@mail.${DOMAIN}`,
    `back+ups@${DOMAIN}`,
    `back..ups@${DOMAIN}`,
    `.backups@${DOMAIN}`,
    "not-an-address",
  ])("%p is refused and never queued", async (to: string) => {
    await invokeRoute({ to: to });

    expect(addJobMock).not.toHaveBeenCalled();
    expect(errorMessage()).toBe(
      "Invalid recipient. The email was not sent to the address of a monitor or a workflow on the inbound email domain.",
    );
  });

  test("an envelope that names no monitor or workflow is refused, whatever To says", async () => {
    /*
     * The envelope is who this delivery is for. A To header that happens to
     * name a monitor is the same email delivered to someone else.
     */
    await invokeRoute({
      to: `monitor-${SECRET}@${DOMAIN}`,
      envelope: JSON.stringify({ to: ["someone@acme.example"] }),
    });

    expect(addJobMock).not.toHaveBeenCalled();
    expect(errorMessage()).toContain("Invalid recipient.");
  });

  test("a request with the wrong webhook secret is refused before parsing", async () => {
    await invokeRoute({
      to: `nightly-backups@${DOMAIN}`,
      pathSecret: "wrong",
    });

    expect(addJobMock).not.toHaveBeenCalled();
    expect(errorMessage()).toBe("Invalid webhook signature");
  });
});

describe("mail to a workflow's address", () => {
  test("is queued with the workflow's key, and neither monitor key", async () => {
    await invokeRoute({ to: WORKFLOW_ADDRESS });

    const job: JSONObject = enqueuedJob();

    expect(job["workflowSecretKey"]).toBe(WORKFLOW_SECRET);
    expect(job["secretKey"]).toBeUndefined();
    expect(job["customLocalPart"]).toBeUndefined();
    expect(job["emailSubject"]).toBe("Nightly backups completed");
    expect(job["emailToAddresses"]).toEqual([WORKFLOW_ADDRESS]);
    expect(job["emailCcAddresses"]).toEqual([]);
  });

  test("is found in a list of recipients", async () => {
    await invokeRoute({
      to: `"Ops, Night shift" <ops@acme.example>, Workflow <${WORKFLOW_ADDRESS.toUpperCase()}>`,
    });

    const job: JSONObject = enqueuedJob();

    expect(job["workflowSecretKey"]).toBe(WORKFLOW_SECRET);
    expect(job["emailToAddresses"]).toEqual([
      "ops@acme.example",
      WORKFLOW_ADDRESS,
    ]);
  });

  test("is found in Cc", async () => {
    await invokeRoute({ to: "ops@acme.example", cc: WORKFLOW_ADDRESS });

    const job: JSONObject = enqueuedJob();

    expect(job["workflowSecretKey"]).toBe(WORKFLOW_SECRET);
    expect(job["emailCcAddresses"]).toEqual([WORKFLOW_ADDRESS]);
  });

  test("is found through the envelope when it was a blind copy or forwarded", async () => {
    await invokeRoute({
      to: "ops@acme.example",
      envelope: JSON.stringify({
        to: [WORKFLOW_ADDRESS],
        from: "bounces@acme.example",
      }),
    });

    expect(enqueuedJob()["workflowSecretKey"]).toBe(WORKFLOW_SECRET);
  });

  test("named twice on one email, it is queued once", async () => {
    await invokeRoute({ to: WORKFLOW_ADDRESS, cc: WORKFLOW_ADDRESS });

    expect(enqueuedJobs()).toHaveLength(1);
  });

  test("the response says the email was accepted", async () => {
    await invokeRoute({ to: WORKFLOW_ADDRESS });

    expect(sendErrorMock).not.toHaveBeenCalled();
    expect(
      (sendJsonMock.mock.calls as unknown as Array<Array<unknown>>)[0]![2],
    ).toEqual({ status: "accepted", message: "Email queued for processing" });
  });
});

describe("one email for several monitors and workflows", () => {
  test("is queued once for each of them, in order", async () => {
    await invokeRoute({
      to: `monitor-${SECRET}@${DOMAIN}, ${WORKFLOW_ADDRESS}`,
      cc: `nightly-backups@${DOMAIN}`,
    });

    const jobs: Array<JSONObject> = enqueuedJobs();

    expect(
      jobs.map((job: JSONObject) => {
        return {
          secretKey: job["secretKey"],
          customLocalPart: job["customLocalPart"],
          workflowSecretKey: job["workflowSecretKey"],
        };
      }),
    ).toEqual([
      {
        secretKey: SECRET,
        customLocalPart: undefined,
        workflowSecretKey: undefined,
      },
      {
        secretKey: undefined,
        customLocalPart: undefined,
        workflowSecretKey: WORKFLOW_SECRET,
      },
      {
        secretKey: undefined,
        customLocalPart: "nightly-backups",
        workflowSecretKey: undefined,
      },
    ]);
  });

  test("each job carries the same email", async () => {
    await invokeRoute({
      to: `monitor-${SECRET}@${DOMAIN}`,
      cc: WORKFLOW_ADDRESS,
    });

    for (const job of enqueuedJobs()) {
      expect(job["emailSubject"]).toBe("Nightly backups completed");
      expect(job["emailBody"]).toBe("Backup finished in 42 minutes.");
      expect(job["emailFrom"]).toBe("nightly-backups@acme.example");
    }
  });

  test("a monitor keeps the To address it has always evaluated", async () => {
    await invokeRoute({ to: `Monitor <monitor-${SECRET}@${DOMAIN}>` });

    expect(enqueuedJob()["emailTo"]).toBe(`monitor-${SECRET}@${DOMAIN}`);
  });

  test("addresses that are nobody's are skipped, not refused, when someone else is addressed", async () => {
    await invokeRoute({
      to: `team@acme.example, back+ups@${DOMAIN}, ${WORKFLOW_ADDRESS}`,
    });

    expect(enqueuedJob()["workflowSecretKey"]).toBe(WORKFLOW_SECRET);
    expect(sendErrorMock).not.toHaveBeenCalled();
  });

  test("with an envelope, only the envelope's recipient is queued, so a delivery per recipient never doubles up", async () => {
    /*
     * SendGrid posts once per recipient on the parse domain, each with its
     * own envelope. Both posts carry the same To header; routing by it would
     * queue the email twice for each.
     */
    await invokeRoute({
      to: `monitor-${SECRET}@${DOMAIN}, ${WORKFLOW_ADDRESS}`,
      envelope: JSON.stringify({ to: [WORKFLOW_ADDRESS] }),
    });

    const jobs: Array<JSONObject> = enqueuedJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!["workflowSecretKey"]).toBe(WORKFLOW_SECRET);
  });
});
