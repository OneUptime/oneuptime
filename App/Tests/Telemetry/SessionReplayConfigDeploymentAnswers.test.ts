import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { SESSION_REPLAY_APP_IDENTIFIER_HEADER } from "Common/Types/Rum/SessionReplay";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";

/*
 * GET /session-replay/v1/config - the two deployment-level answers.
 *
 * Both of these are module-load constants, so they need their own file:
 * SESSION_REPLAY_DEBUG (which asks every recorder this instance serves to
 * print its decisions) and a build manifest that is absent, which is the
 * `recorder-not-built` case.
 *
 * That last one is the reason this file exists at all. On a self-hosted
 * install where session replay has never worked, the overwhelmingly likely
 * cause is that the recorder bundle was never produced - so there is no
 * artifact to serve and no version to pin - and the endpoint answered
 * `enabled:false` for it exactly as it does for an application somebody
 * switched off. The customer then spends their time in a settings page that
 * was already correct, because nothing anywhere said which of the two it was.
 */

const registeredGetHandlers: Record<string, Array<unknown>> = {};

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return {
          post: (): void => {
            // Chunk-path registration is irrelevant to this suite.
          },
          get: (uri: string, ...handlers: Array<unknown>) => {
            registeredGetHandlers[uri] = handlers;
          },
        };
      },
    },
    headerValueToString: (value: unknown): string | undefined => {
      if (typeof value === "string") {
        return value;
      }
      if (Array.isArray(value)) {
        return value[0] as string | undefined;
      }
      return undefined;
    },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngest", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      middleware: jest.fn(),
      isDisabled: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
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
    getLogAttributesFromRequest: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (): void => {
        // No-op decorator: the real one needs a live tracer provider.
      };
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  const counter: { add: unknown } = { add: jest.fn() };
  const histogram: { record: unknown } = { record: jest.fn() };

  return {
    __esModule: true,
    default: {
      getIngestCounter: () => {
        return counter;
      },
      getIngestDuration: () => {
        return histogram;
      },
      getIngestPayloadBytes: () => {
        return histogram;
      },
    },
  };
});

jest.mock("Common/Server/Utils/SessionReplay/SessionReplayGateCache", () => {
  return {
    __esModule: true,
    default: {
      getPolicy: jest.fn(),
      isOriginAllowed: jest.fn().mockReturnValue(true),
    },
  };
});

jest.mock("Common/Server/Utils/SessionReplay/SessionReplayTargeting", () => {
  return {
    __esModule: true,
    default: {
      consumeTarget: jest.fn(),
      isUsableUserRef: (userRef: unknown): boolean => {
        return (
          typeof userRef === "string" &&
          userRef.trim().length > 0 &&
          userRef.length <= 512
        );
      },
    },
  };
});

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getProjectIdFromSecretKey: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RumApplicationService", () => {
  return {
    __esModule: true,
    default: {
      markSessionReplayChunkReceived: jest.fn(),
      updateLastSeen: jest.fn(),
      markSessionReplayBudgetExceeded: jest.fn(),
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/SessionReplayIngestService",
  () => {
    return {
      __esModule: true,
      default: {
        gateChunkRequest: jest.fn(),
        getInlineStagingMaxBytes: () => {
          return 65536;
        },
        isUnprocessableParseError: (): boolean => {
          return false;
        },
      },
      SessionReplayGateOutcome: {
        Accepted: "accepted",
        Stop: "stop",
        OriginRefused: "origin-refused",
        RateLimited: "rate-limited",
        StorageUnavailable: "storage-unavailable",
      },
    };
  },
);

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addSessionReplayIngestJob: jest.fn(),
      },
    };
  },
);

/* Diagnostics ON for the whole file - the switch this suite exists to cover. */
jest.mock("../../FeatureSet/Telemetry/Config", () => {
  return {
    __esModule: true,
    SESSION_REPLAY_ENABLED_BY_DEFAULT: true,
    SESSION_REPLAY_INGEST_ENABLED: true,
    SESSION_REPLAY_TRUSTED_GEO_HEADER: "",
    SESSION_REPLAY_DEBUG: true,
  };
});

/*
 * NO published artifact. getRecorderVersion() returns null when
 * public/dist/manifest.json is missing, unparseable, or fails validation -
 * which is exactly the state of a deployment whose recorder build never ran.
 */
jest.mock("../../FeatureSet/BrowserRecorder/Manifest", () => {
  return {
    __esModule: true,
    ARTIFACT_CONTENT_TYPE: "application/javascript",
    LOADER_CACHE_CONTROL: "public, max-age=300",
    RECORDER_CACHE_CONTROL: "public, max-age=31536000, immutable",
    RECORDER_VERSION_PATTERN: /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/,
    getArtifactFilePath: jest.fn(),
    getPinnedRecorderPath: jest.fn(),
    getRecorderVersion: (): string | null => {
      return null;
    },
    getRecorderIntegrity: (): string | null => {
      return null;
    },
  };
});

import Response from "Common/Server/Utils/Response";
import SessionReplayGateCache from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
// Importing the router module registers the routes on the mocked router.
import "../../FeatureSet/Telemetry/API/SessionReplayIngest";

type MockedFn = ReturnType<typeof jest.fn>;

const getPolicyMock: MockedFn =
  SessionReplayGateCache.getPolicy as unknown as MockedFn;
const sendJsonMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const APP_IDENTIFIER: string = "checkout-web";
const CONFIG_ROUTE: string = "/session-replay/v1/config";

interface FakeResponse {
  headers: Record<string, string>;
  setHeader: (name: string, value: string) => void;
}

function buildResponse(): FakeResponse {
  const res: FakeResponse = {
    headers: {},
    setHeader: (name: string, value: string): void => {
      res.headers[name] = value;
    },
  };

  return res;
}

function buildRequest(): unknown {
  return {
    projectId: PROJECT_ID,
    headers: {
      [SESSION_REPLAY_APP_IDENTIFIER_HEADER]: APP_IDENTIFIER,
    },
  };
}

async function callConfigRoute(): Promise<JSONObject> {
  const handlers: Array<unknown> = registeredGetHandlers[CONFIG_ROUTE] || [];
  const terminal: unknown = handlers[handlers.length - 1];

  expect(typeof terminal).toBe("function");

  await (
    terminal as (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void>
  )(
    buildRequest() as ExpressRequest,
    buildResponse() as unknown as ExpressResponse,
    jest.fn() as unknown as NextFunction,
  );

  expect(sendJsonMock).toHaveBeenCalledTimes(1);

  return sendJsonMock.mock.calls[0]?.[2] as JSONObject;
}

describe("GET /session-replay/v1/config (deployment-level answers)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * The self-hosted answer. Nothing on the customer's page can fix this and
   * no dashboard setting reaches it, so naming it is the whole point: the
   * recorder logs the reason verbatim, and the docs map it to "rebuild and
   * redeploy the OneUptime app".
   */
  test("reports recorder-not-built when no artifact has been published", async () => {
    getPolicyMock.mockResolvedValue(null as never);

    const body: JSONObject = await callConfigRoute();

    expect(body["enabled"]).toBe(false);
    expect(body["disabledReason"]).toBe("recorder-not-built");

    /*
     * Checked BEFORE the policy, deliberately. An instance with no artifact
     * cannot record for ANY application, so consulting the per-application
     * policy first would report a per-application cause for an
     * instance-wide fault.
     */
    expect(getPolicyMock).not.toHaveBeenCalled();
  });

  /*
   * The switch has to survive onto the DISABLED response too. That response
   * is the one a customer chasing silence most needs explained, and a
   * recorder that is not logging cannot tell them what it says.
   */
  test("asks recorders to log even when it is telling them not to record", async () => {
    getPolicyMock.mockResolvedValue(null as never);

    const body: JSONObject = await callConfigRoute();

    expect(body["debug"]).toBe(true);
  });
});
