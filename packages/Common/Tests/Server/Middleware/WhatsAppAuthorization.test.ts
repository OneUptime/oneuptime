import { describe, expect, test, beforeEach } from "@jest/globals";
import crypto from "crypto";
import WhatsAppAuthorization from "../../../Server/Middleware/WhatsAppAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import Response from "../../../Server/Utils/Response";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * The config lookup is mocked so the signature branches can be exercised
 * without Postgres; the middleware under test must never need a database.
 */
jest.mock("../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
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
 * Regression cover for the unguarded crypto.timingSafeEqual in
 * isAuthorizedWhatsAppRequest. timingSafeEqual throws RangeError when the two
 * buffers differ in byte length, and the compared value came straight off the
 * attacker-controlled X-Hub-Signature-256 header with no try/catch anywhere
 * above it. The endpoint is unauthenticated by design - the signature IS the
 * authentication - so anyone could send `x-hub-signature-256: nope` and throw
 * the middleware instead of receiving the intended 400.
 */
describe("WhatsAppAuthorization.isAuthorizedWhatsAppRequest", () => {
  const APP_SECRET: string = "meta-whatsapp-app-secret";
  const RAW_BODY: string = JSON.stringify({
    object: "whatsapp_business_account",
  });

  const findOneBy: jest.Mock =
    GlobalConfigService.findOneBy as unknown as jest.Mock;
  const sendErrorResponse: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;

  const res: ExpressResponse = {} as ExpressResponse;
  let next: NextFunction;

  type SignFunction = (body: string) => string;

  const sign: SignFunction = (body: string): string => {
    return `sha256=${crypto
      .createHmac("sha256", APP_SECRET)
      .update(body)
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
    return {
      headers:
        signature === undefined ? {} : { "x-hub-signature-256": signature },
      rawBody: body,
    } as unknown as OneUptimeRequest;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
    findOneBy.mockResolvedValue({ metaWhatsAppAppSecret: APP_SECRET });
  });

  test("calls next when the signature matches the body", async () => {
    const req: OneUptimeRequest = buildRequest(sign(RAW_BODY));

    await WhatsAppAuthorization.isAuthorizedWhatsAppRequest(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
  });

  test("calls next when the signature matches but the digest is upper-case", async () => {
    const signature: string = sign(RAW_BODY);
    const req: OneUptimeRequest = buildRequest(
      `sha256=${signature.slice("sha256=".length).toUpperCase()}`,
    );

    await WhatsAppAuthorization.isAuthorizedWhatsAppRequest(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
  });

  test("rejects a well-formed signature computed over a different body", async () => {
    const req: OneUptimeRequest = buildRequest(
      sign(`${RAW_BODY} tampered`),
      RAW_BODY,
    );

    await WhatsAppAuthorization.isAuthorizedWhatsAppRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalledWith(
      req,
      res,
      new BadDataException("WhatsApp webhook signature verification failed."),
    );
  });

  test("rejects a well-formed signature computed with a different secret", async () => {
    const req: OneUptimeRequest = buildRequest(
      `sha256=${crypto
        .createHmac("sha256", "some-other-secret")
        .update(RAW_BODY)
        .digest("hex")}`,
    );

    await WhatsAppAuthorization.isAuthorizedWhatsAppRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalledWith(
      req,
      res,
      new BadDataException("WhatsApp webhook signature verification failed."),
    );
  });

  /*
   * An empty header value is indistinguishable from an absent one, so both
   * take the missing-header branch rather than the malformed-digest one.
   */
  test.each([
    ["absent", undefined],
    ["empty", ""],
  ])(
    "rejects an %s signature header",
    async (_label: string, signature: string | undefined) => {
      const req: OneUptimeRequest = buildRequest(signature);

      await WhatsAppAuthorization.isAuthorizedWhatsAppRequest(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(sendErrorResponse).toHaveBeenCalledWith(
        req,
        res,
        new BadDataException("Missing X-Hub-Signature-256 header."),
      );
    },
  );

  /*
   * Every one of these is a byte length other than the 71 of a real
   * "sha256=" + 64 hex header, which is exactly what used to reach
   * timingSafeEqual and throw.
   */
  const malformedSignatures: Array<[string, string]> = [
    ["a bare word", "nope"],
    ["the prefix with no digest", "sha256="],
    ["a short digest", "sha256=abc123"],
    ["a long digest", `sha256=${"a".repeat(65)}`],
    ["the right length but non-hex characters", `sha256=${"z".repeat(64)}`],
    ["64 hex characters with no prefix", "a".repeat(64)],
    ["the wrong prefix", `sha1=${"a".repeat(64)}`],
    ["a whitespace-padded digest", ` sha256=${"a".repeat(64)}`],
  ];

  describe("rejects a malformed signature with 400 rather than throwing", () => {
    test.each(malformedSignatures)(
      "%s",
      async (_label: string, signature: string) => {
        const req: OneUptimeRequest = buildRequest(signature);

        await expect(
          WhatsAppAuthorization.isAuthorizedWhatsAppRequest(req, res, next),
        ).resolves.toBeUndefined();

        expect(next).not.toHaveBeenCalled();
        expect(sendErrorResponse).toHaveBeenCalledWith(
          req,
          res,
          new BadDataException(
            "WhatsApp webhook signature verification failed.",
          ),
        );
      },
    );
  });

  /*
   * The shape check sits in front of the config lookup, so an unauthenticated
   * flood of garbage signatures costs no database round trips.
   */
  test("does not query the global config for a malformed signature", async () => {
    await WhatsAppAuthorization.isAuthorizedWhatsAppRequest(
      buildRequest("nope"),
      res,
      next,
    );

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("rejects when the app secret is not configured", async () => {
    findOneBy.mockResolvedValue({ metaWhatsAppAppSecret: "   " });

    const req: OneUptimeRequest = buildRequest(sign(RAW_BODY));

    await WhatsAppAuthorization.isAuthorizedWhatsAppRequest(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalledWith(
      req,
      res,
      new BadDataException("Meta WhatsApp App Secret is not configured."),
    );
  });
});
