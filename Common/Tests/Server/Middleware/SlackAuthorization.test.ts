import { describe, expect, test, beforeEach } from "@jest/globals";
import crypto from "crypto";
import SlackAuthorization from "../../../Server/Middleware/SlackAuthorization";
import Response from "../../../Server/Utils/Response";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";

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
  const TIMESTAMP: string = "1700000000";
  const RAW_BODY: string = "token=abc&team_id=T123&command=%2Foneuptime";

  const sendErrorResponse: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;

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
  ) => OneUptimeRequest;

  const buildRequest: BuildRequestFunction = (
    signature: string | undefined,
    body: string = RAW_BODY,
  ): OneUptimeRequest => {
    const headers: Record<string, string> = {
      "x-slack-request-timestamp": TIMESTAMP,
    };

    if (signature !== undefined) {
      headers["x-slack-signature"] = signature;
    }

    return { headers, rawBody: body } as unknown as OneUptimeRequest;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  test("calls next when the signature matches the timestamp and body", async () => {
    const req: OneUptimeRequest = buildRequest(sign(TIMESTAMP, RAW_BODY));

    await SlackAuthorization.isAuthorizedSlackRequest(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
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
      },
    );
  });
});
