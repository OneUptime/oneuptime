import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import ResponseUtil from "../../../Server/Utils/Response";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  AI_RUN_REFUSALS,
  AiRunRefusalCode,
  readAiRunRefusalCode,
} from "../../../Types/AI/AiRunRefusal";
import AiRunRefusalException from "../../../Types/Exception/AiRunRefusalException";
import { JSONObject } from "../../../Types/JSON";

/*
 * A REFUSAL'S CODE GOES BESIDE ITS MESSAGE, AND THE DASHBOARD READS IT
 * BACK (#7359).
 *
 * The server answers a refused Try again or Investigate now with its
 * English sentence as the message - what the API and older Dashboards
 * read - and the code beside it; the Dashboard reads the same body as an
 * HTTPErrorResponse, whose message is still the sentence, and finds the
 * code to word in the reader's language.
 */

interface CapturedResponse {
  statusCode: number | null;
  body: JSONObject | undefined;
}

describe("a refusal sent and read back", () => {
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
      send: (body: JSONObject): void => {
        captured.body = body;
      },
    } as unknown as ExpressResponse;

    request = { headers: {}, socket: {} } as unknown as ExpressRequest;
  });

  test.each(Object.values(AiRunRefusalCode))(
    "%s: 400, the English sentence as the message, the code beside it",
    (code: AiRunRefusalCode) => {
      ResponseUtil.sendErrorResponse(
        request,
        response,
        new AiRunRefusalException(code),
      );

      expect(captured.statusCode).toBe(400);
      expect(captured.body).toEqual({
        message: AI_RUN_REFUSALS[code],
        refusalCode: code,
      });

      // What the Dashboard reads off the same body.
      const read: HTTPErrorResponse = new HTTPErrorResponse(
        400,
        captured.body!,
        {},
      );

      expect(read.message).toBe(AI_RUN_REFUSALS[code]);
      expect(readAiRunRefusalCode(read.data)).toBe(code);
    },
  );
});
