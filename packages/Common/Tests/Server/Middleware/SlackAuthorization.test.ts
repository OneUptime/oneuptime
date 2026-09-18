import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import SlackAuthorization from "../../../Server/Middleware/SlackAuthorization";
import Response from "../../../Server/Utils/Response";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";

const SIGNING_SECRET: string = "slack-app-signing-secret";

/*
 * Only the signing secret is overridden. Logger and CaptureSpan also read from
 * EnvironmentConfig, so the rest of the module has to stay real.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    SlackAppSigningSecret: "slack-app-signing-secret",
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendTextResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setStringIfNotExists: jest.fn(),
    },
  };
});

/*
 * Companion to WhatsAppAuthorization.test.ts. This middleware had the same
 * unguarded crypto.timingSafeEqual: the value came off the attacker-controlled
 * X-Slack-Signature header, and timingSafeEqual throws RangeError when the two
 * buffers differ in byte length. A missing header was worse still - it reached
 * Buffer.from(undefined) and threw a TypeError before the comparison. Both now
 * have to come back as the intended 400.
 */
describe("SlackAuthorization.isAuthorizedSlackRequest", () => {
  const NOW_IN_SECONDS: number = 1_800_000_000;
  const TIMESTAMP: string = NOW_IN_SECONDS.toString();
  const RAW_BODY: string = "token=abc&team_id=T123&command=%2Foneuptime";

  const sendErrorResponse: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;
  const sendTextResponse: jest.Mock =
    Response.sendTextResponse as unknown as jest.Mock;
  const setStringIfNotExists: jest.Mock =
    GlobalCache.setStringIfNotExists as unknown as jest.Mock;

  const res: ExpressResponse = {} as ExpressResponse;
  let next: NextFunction;

  type SignFunction = (timestamp: string, body: string) => string;

  const sign: SignFunction = (timestamp: string, body: string): string => {
    return `v0=${crypto
      .createHmac("sha256", SIGNING_SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`;
  };

  type BuildRequestFunction = (
    signature: string | undefined,
    body?: string,
    timestamp?: string | null,
  ) => OneUptimeRequest;

  const buildRequest: BuildRequestFunction = (
    signature: string | undefined,
    body: string = RAW_BODY,
    timestamp: string | null = TIMESTAMP,
  ): OneUptimeRequest => {
    const headers: Record<string, string> = {};

    if (timestamp !== null) {
      headers["x-slack-request-timestamp"] = timestamp;
    }

    if (signature !== undefined) {
      headers["x-slack-signature"] = signature;
    }

    return { headers, rawBody: body } as unknown as OneUptimeRequest;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(NOW_IN_SECONDS * 1000);
    setStringIfNotExists.mockResolvedValue(true);
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("calls next when the signature matches the timestamp and body", async () => {
    const req: OneUptimeRequest = buildRequest(sign(TIMESTAMP, RAW_BODY));

    await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(setStringIfNotExists).toHaveBeenCalledWith(
      "slack-request-replay",
      sign(TIMESTAMP, RAW_BODY).slice("v0=".length),
      TIMESTAMP,
      { expiresInSeconds: 5 * 60 + 1 },
    );
  });

  test("rejects a well-formed signature computed over a different body", async () => {
    const req: OneUptimeRequest = buildRequest(
      sign(TIMESTAMP, `${RAW_BODY}&tampered=1`),
      RAW_BODY,
    );

    await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalledWith(
      req,
      res,
      new BadDataException("Slack Signature Verification Failed."),
    );
    expect(setStringIfNotExists).not.toHaveBeenCalled();
  });

  test("accepts a request exactly five minutes old", async () => {
    const timestamp: string = (NOW_IN_SECONDS - 5 * 60).toString();
    const req: OneUptimeRequest = buildRequest(
      sign(timestamp, RAW_BODY),
      RAW_BODY,
      timestamp,
    );

    await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
  });

  test("accepts a request exactly five minutes in the future and covers the full replay window", async () => {
    const timestamp: string = (NOW_IN_SECONDS + 5 * 60).toString();
    const req: OneUptimeRequest = buildRequest(
      sign(timestamp, RAW_BODY),
      RAW_BODY,
      timestamp,
    );

    await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(setStringIfNotExists).toHaveBeenCalledWith(
      "slack-request-replay",
      sign(timestamp, RAW_BODY).slice("v0=".length),
      timestamp,
      { expiresInSeconds: 10 * 60 + 1 },
    );
  });

  test("rejects a correctly signed request older than five minutes", async () => {
    const timestamp: string = (NOW_IN_SECONDS - 5 * 60 - 1).toString();
    const req: OneUptimeRequest = buildRequest(
      sign(timestamp, RAW_BODY),
      RAW_BODY,
      timestamp,
    );

    await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalledWith(
      req,
      res,
      new BadDataException("Slack Signature Verification Failed."),
    );
    expect(setStringIfNotExists).not.toHaveBeenCalled();
  });

  test("rejects a correctly signed request more than five minutes in the future", async () => {
    const timestamp: string = (NOW_IN_SECONDS + 5 * 60 + 1).toString();
    const req: OneUptimeRequest = buildRequest(
      sign(timestamp, RAW_BODY),
      RAW_BODY,
      timestamp,
    );

    await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalledWith(
      req,
      res,
      new BadDataException("Slack Signature Verification Failed."),
    );
  });

  test("acknowledges a duplicate without invoking the Slack handler", async () => {
    setStringIfNotExists.mockResolvedValue(false);
    const req: OneUptimeRequest = buildRequest(sign(TIMESTAMP, RAW_BODY));

    await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(sendTextResponse).toHaveBeenCalledWith(req, res, "");
  });

  test("uses the canonical digest so signature casing cannot bypass replay detection", async () => {
    const lowercaseSignature: string = sign(TIMESTAMP, RAW_BODY);
    const uppercaseSignature: string = `v0=${lowercaseSignature
      .slice("v0=".length)
      .toUpperCase()}`;
    const firstRequest: OneUptimeRequest = buildRequest(lowercaseSignature);
    const replayRequest: OneUptimeRequest = buildRequest(uppercaseSignature);

    setStringIfNotExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await SlackAuthorization.isAuthorizedSlackRequest(firstRequest, res, next);
    await SlackAuthorization.isAuthorizedSlackRequest(replayRequest, res, next);

    const canonicalDigest: string = lowercaseSignature.slice("v0=".length);
    expect(setStringIfNotExists).toHaveBeenNthCalledWith(
      1,
      "slack-request-replay",
      canonicalDigest,
      TIMESTAMP,
      { expiresInSeconds: 5 * 60 + 1 },
    );
    expect(setStringIfNotExists).toHaveBeenNthCalledWith(
      2,
      "slack-request-replay",
      canonicalDigest,
      TIMESTAMP,
      { expiresInSeconds: 5 * 60 + 1 },
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(sendTextResponse).toHaveBeenCalledWith(replayRequest, res, "");
  });

  test("allows repeated URL verification requests to reach their idempotent handler", async () => {
    const signature: string = sign(TIMESTAMP, RAW_BODY);
    const firstRequest: OneUptimeRequest = buildRequest(signature);
    const secondRequest: OneUptimeRequest = buildRequest(signature);

    Object.assign(firstRequest, {
      route: { path: "/slack/events" },
      body: { type: "url_verification" },
    });
    Object.assign(secondRequest, {
      route: { path: "/slack/events" },
      body: { type: "url_verification" },
    });

    await SlackAuthorization.isAuthorizedSlackRequest(firstRequest, res, next);
    await SlackAuthorization.isAuthorizedSlackRequest(secondRequest, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(setStringIfNotExists).not.toHaveBeenCalled();
  });

  test("allows repeated options loads to reach their idempotent handler", async () => {
    const signature: string = sign(TIMESTAMP, RAW_BODY);
    const firstRequest: OneUptimeRequest = buildRequest(signature);
    const secondRequest: OneUptimeRequest = buildRequest(signature);

    Object.assign(firstRequest, {
      route: { path: "/slack/options-load" },
    });
    Object.assign(secondRequest, {
      route: { path: "/slack/options-load" },
    });

    await SlackAuthorization.isAuthorizedSlackRequest(firstRequest, res, next);
    await SlackAuthorization.isAuthorizedSlackRequest(secondRequest, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(setStringIfNotExists).not.toHaveBeenCalled();
  });

  test("fails closed when distributed replay protection is unavailable", async () => {
    setStringIfNotExists.mockRejectedValue(new Error("cache unavailable"));
    const req: OneUptimeRequest = buildRequest(sign(TIMESTAMP, RAW_BODY));

    await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalledWith(
      req,
      res,
      new ServiceUnavailableException(
        "Slack request verification is temporarily unavailable.",
      ),
    );
  });

  const malformedTimestamps: Array<[string, string | null]> = [
    ["absent", null],
    ["empty", ""],
    ["non-numeric", "not-a-timestamp"],
    ["partially numeric", `${TIMESTAMP}abc`],
    ["fractional", `${TIMESTAMP}.5`],
    ["negative", "-1"],
    ["outside the safe integer range", "999999999999999999999"],
  ];

  describe("rejects a malformed timestamp", () => {
    test.each(malformedTimestamps)(
      "%s",
      async (_label: string, timestamp: string | null) => {
        const signedTimestamp: string = timestamp || TIMESTAMP;
        const req: OneUptimeRequest = buildRequest(
          sign(signedTimestamp, RAW_BODY),
          RAW_BODY,
          timestamp,
        );

        await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(sendErrorResponse).toHaveBeenCalledWith(
          req,
          res,
          new BadDataException("Slack Signature Verification Failed."),
        );
        expect(setStringIfNotExists).not.toHaveBeenCalled();
      },
    );
  });

  /*
   * Every one of these is a byte length other than the 67 of a real
   * "v0=" + 64 hex header, which is exactly what used to reach
   * timingSafeEqual and throw. The absent and empty cases used to throw
   * even earlier, inside Buffer.from.
   */
  const malformedSignatures: Array<[string, string | undefined]> = [
    ["absent", undefined],
    ["an empty string", ""],
    ["a bare word", "nope"],
    ["the prefix with no digest", "v0="],
    ["a short digest", "v0=abc123"],
    ["a long digest", `v0=${"a".repeat(65)}`],
    ["the right length but non-hex characters", `v0=${"z".repeat(64)}`],
    ["64 hex characters with no prefix", "a".repeat(64)],
    ["the wrong version prefix", `v1=${"a".repeat(64)}`],
  ];

  describe("rejects a malformed signature with 400 rather than throwing", () => {
    test.each(malformedSignatures)(
      "%s",
      async (_label: string, signature: string | undefined) => {
        const req: OneUptimeRequest = buildRequest(signature);

        await expect(
          SlackAuthorization.isAuthorizedSlackRequest(req, res, next),
        ).resolves.toBeUndefined();

        expect(next).not.toHaveBeenCalled();
        expect(sendErrorResponse).toHaveBeenCalledWith(
          req,
          res,
          new BadDataException("Slack Signature Verification Failed."),
        );
        expect(setStringIfNotExists).not.toHaveBeenCalled();
      },
    );
  });

  test("normalizes an array signature header without throwing", async () => {
    const req: OneUptimeRequest = buildRequest(undefined);
    req.headers["x-slack-signature"] = ["not-a-signature"];

    await expect(
      SlackAuthorization.isAuthorizedSlackRequest(req, res, next),
    ).resolves.toBeUndefined();

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalledWith(
      req,
      res,
      new BadDataException("Slack Signature Verification Failed."),
    );
    expect(setStringIfNotExists).not.toHaveBeenCalled();
  });
});
