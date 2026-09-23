import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";

/*
 * POST /incoming-email/sendgrid/:secret -- the SendGrid Inbound Parse webhook.
 *
 * It decides which monitor ADDRESS a message was sent to, and enqueues it for
 * the worker. With custom addresses there are two shapes: the generated
 * `monitor-{secretKey}@` address (the job carries `secretKey`) and a custom
 * name (the job carries `customLocalPart`). Mail to anything else on -- or off
 * -- the inbound domain is refused here, before it reaches the queue.
 *
 * The provider is the real SendGridInboundProvider, so its parsing of the
 * webhook form is part of what is exercised.
 */

const DOMAIN: string = "inbound.oneuptime.example";
const WEBHOOK_SECRET: string = "hook-secret";
const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";

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
  pathSecret?: string | undefined;
}) => Promise<void>;

// The multipart fields SendGrid Inbound Parse posts.
const invokeRoute: InvokeRouteFunction = async (input: {
  to: string;
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
      "Invalid monitor email address. The email was not sent to a monitor's address on the inbound email domain.",
    );
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
