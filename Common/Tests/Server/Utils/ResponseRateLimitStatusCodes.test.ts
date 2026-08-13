import { beforeEach, describe, expect, test } from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import ResponseUtil from "../../../Server/Utils/Response";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * The public dashboard rate limiter answers by handing an exception to
 * Response.sendErrorResponse, which turns `error.code` into the HTTP status.
 * That indirection is the whole reason these two exception types exist, and it
 * is where a refusal would silently degrade: an exception whose code is not a
 * real status falls back to 500, and a client that sees 500 retries as if the
 * server were broken instead of backing off.
 *
 * These tests pin the codes to the wire, not just to the constructor.
 */

interface CapturedResponse {
  statusCode: number | null;
  body: unknown;
}

describe("rate limit responses on the wire", () => {
  let captured: CapturedResponse;
  let response: ExpressResponse;
  let request: ExpressRequest;

  beforeEach(() => {
    captured = { statusCode: null, body: undefined };

    response = {
      status: (code: number): ExpressResponse => {
        captured.statusCode = code;
        return response;
      },
      send: (body: unknown): void => {
        captured.body = body;
      },
    } as unknown as ExpressResponse;

    request = {
      headers: {},
      socket: {},
    } as unknown as ExpressRequest;
  });

  describe("TooManyRequestsException", () => {
    test("carries 429", () => {
      expect(new TooManyRequestsException("slow down").code).toBe(429);
      expect(new TooManyRequestsException("slow down").code).toBe(
        ExceptionCode.TooManyRequestsException,
      );
    });

    test("keeps its message", () => {
      expect(new TooManyRequestsException("slow down").message).toBe(
        "slow down",
      );
    });

    test("reaches the client as 429, not as a 500", () => {
      ResponseUtil.sendErrorResponse(
        request,
        response,
        new TooManyRequestsException("Too many requests. Please try again later."),
      );

      expect(captured.statusCode).toBe(429);
      expect(captured.body).toEqual({
        message: "Too many requests. Please try again later.",
      });
    });
  });

  describe("ServiceUnavailableException", () => {
    test("carries 503", () => {
      expect(new ServiceUnavailableException("try later").code).toBe(503);
      expect(new ServiceUnavailableException("try later").code).toBe(
        ExceptionCode.ServiceUnavailableException,
      );
    });

    test("reaches the client as 503, not as a 500", () => {
      ResponseUtil.sendErrorResponse(
        request,
        response,
        new ServiceUnavailableException("Unable to verify the password."),
      );

      expect(captured.statusCode).toBe(503);
    });

    /*
     * 503 rather than 500 matters: a viewer whose password attempt was refused
     * because the counter was unreachable should be told to retry, not shown a
     * server error that reads as "this dashboard is broken".
     */
    test("is distinguishable from a server error", () => {
      expect(ExceptionCode.ServiceUnavailableException).not.toBe(
        ExceptionCode.ServerException,
      );
    });
  });

  describe("exception code table", () => {
    test("does not collide the new codes with existing ones", () => {
      const codes: Array<number> = Object.values(ExceptionCode).filter(
        (value: unknown): value is number => {
          return typeof value === "number";
        },
      );

      expect(
        codes.filter((code: number) => {
          return code === 429;
        }),
      ).toHaveLength(1);

      expect(
        codes.filter((code: number) => {
          return code === 503;
        }),
      ).toHaveLength(1);
    });

    /* The pre-existing mapping still holds, so nothing was shifted. */
    test("leaves the existing codes alone", () => {
      expect(new BadDataException("bad").code).toBe(400);
      expect(ExceptionCode.NotFoundException).toBe(404);
      expect(ExceptionCode.ServerException).toBe(500);
    });
  });
});
