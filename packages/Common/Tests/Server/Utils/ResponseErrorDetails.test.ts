import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import ResponseUtil from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadDataExceptionWithDetails from "../../../Types/Exception/BadDataExceptionWithDetails";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";

/*
 * A FAILURE THAT SAYS MORE THAN ITS MESSAGE (issue #7080).
 *
 * Test LLM Provider answers a failed test as bad data, as it always has,
 * and now sends what it sent the provider and what came back beside the
 * message. BadDataExceptionWithDetails carries that; sendErrorResponse
 * puts it in the body, at the same 400, and never lets it replace the
 * message.
 */

interface CapturedResponse {
  statusCode: number | null;
  body: unknown;
}

describe("sendErrorResponse with details", () => {
  let captured: CapturedResponse;
  let response: ExpressResponse;
  let request: ExpressRequest;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
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

    request = { headers: {}, socket: {} } as unknown as ExpressRequest;
  });

  test("is still bad data, at 400", () => {
    const error: BadDataExceptionWithDetails = new BadDataExceptionWithDetails(
      "The test failed.",
      { exchanges: [] },
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.code).toBe(ExceptionCode.BadDataException);
    expect(error.details).toEqual({ exchanges: [] });
  });

  test("sends the details beside the message", () => {
    ResponseUtil.sendErrorResponse(
      request,
      response,
      new BadDataExceptionWithDetails("The test failed.", {
        exchanges: [{ method: "POST", url: "https://p.example/" }],
      }),
    );

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({
      message: "The test failed.",
      exchanges: [{ method: "POST", url: "https://p.example/" }],
    });
  });

  test("a detail named message never replaces the message", () => {
    ResponseUtil.sendErrorResponse(
      request,
      response,
      new BadDataExceptionWithDetails("The real reason.", {
        message: "Something else.",
      }),
    );

    expect(captured.body).toEqual({ message: "The real reason." });
  });

  test("any other exception sends its message alone, as before", () => {
    ResponseUtil.sendErrorResponse(
      request,
      response,
      new BadDataException("Plain bad data."),
    );

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ message: "Plain bad data." });
  });
});
