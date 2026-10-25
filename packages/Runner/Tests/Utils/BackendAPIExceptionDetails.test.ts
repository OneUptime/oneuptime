/*
 * ---------------------------------------------------------------------------
 * BackendAPI.getExceptionDetails: the exception's details for an exception's
 * AI task, asked for the task this Runner claimed (taskId) so the server can
 * say why it was started - and read back with where the exception is in
 * OneUptime. What does not hold together reads as nothing: a pull request
 * never links what the answer does not fully say.
 * ---------------------------------------------------------------------------
 */

import BackendAPI, { ExceptionDetails } from "../../Utils/BackendAPI";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
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
  };
});

interface PostCall {
  url: URL;
  data: JSONObject;
}

const EXCEPTION_URL: string =
  "https://oneuptime.example/dashboard/p/exceptions/e";
const FINDING_URL: string =
  "https://oneuptime.example/dashboard/p/exceptions/ai/insights/i";

function answer(extra: JSONObject = {}): JSONObject {
  return {
    exception: {
      id: "exception-1",
      message: "TypeError: boom",
      stackTrace: "    at getOrder (/app/src/orders.ts:42:17)",
      exceptionType: "TypeError",
      fingerprint: "abc",
      aiClassification: "code-fault",
      url: EXCEPTION_URL,
    },
    service: { id: "service-1", name: "checkout", description: "" },
    ...extra,
  };
}

function postCall(): PostCall {
  expect(postMock).toHaveBeenCalledTimes(1);

  return postMock.mock.calls[0]?.[0] as PostCall;
}

describe("BackendAPI.getExceptionDetails", () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        answer({
          startedBy: {
            finding: "New exception in checkout: TypeError",
            findingUrl: FINDING_URL,
            isStartedByOneUptime: true,
          },
        }),
        {},
      ),
    );
  });

  test("asks for the task it claimed, and reads why it was started and where the exception is", async () => {
    const result: ExceptionDetails = await new BackendAPI().getExceptionDetails(
      "exception-1",
      "task-1",
    );

    expect(postCall().data).toEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      exceptionId: "exception-1",
      taskId: "task-1",
    });
    expect(result.exception.url).toBe(EXCEPTION_URL);
    expect(result.startedBy).toEqual({
      finding: "New exception in checkout: TypeError",
      findingUrl: FINDING_URL,
      isStartedByOneUptime: true,
    });
  });

  test("with no task: the exception alone is asked for, as before", async () => {
    await new BackendAPI().getExceptionDetails("exception-1");

    expect(postCall().data).toEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      exceptionId: "exception-1",
    });
  });

  test("an older server's answer: no page, no reason", async () => {
    const older: JSONObject = answer();
    delete (older["exception"] as JSONObject)["url"];
    postMock.mockResolvedValue(new HTTPResponse<JSONObject>(200, older, {}));

    const result: ExceptionDetails = await new BackendAPI().getExceptionDetails(
      "exception-1",
      "task-1",
    );

    expect(result.exception.url).toBeNull();
    expect(result.startedBy).toBeNull();
  });

  test("a refusal throws its reason", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Exception not found" }, {}),
    );

    await expect(
      new BackendAPI().getExceptionDetails("exception-1", "task-1"),
    ).rejects.toThrow("Exception not found");
  });
});

describe("BackendAPI.readExceptionStartedBy", () => {
  test("the whole answer: as it is", () => {
    expect(
      BackendAPI.readExceptionStartedBy({
        finding: "New exception in checkout",
        findingUrl: FINDING_URL,
        isStartedByOneUptime: false,
      }),
    ).toEqual({
      finding: "New exception in checkout",
      findingUrl: FINDING_URL,
      isStartedByOneUptime: false,
    });
  });

  test("only a true says OneUptime started it on its own", () => {
    for (const value of [undefined, null, false]) {
      expect(
        BackendAPI.readExceptionStartedBy({
          finding: "New exception in checkout",
          findingUrl: FINDING_URL,
          isStartedByOneUptime: value,
        })?.isStartedByOneUptime,
      ).toBe(false);
    }
  });

  test("what does not hold together reads as nothing", () => {
    expect(BackendAPI.readExceptionStartedBy(undefined)).toBeNull();
    expect(BackendAPI.readExceptionStartedBy(null)).toBeNull();
    expect(
      BackendAPI.readExceptionStartedBy({ findingUrl: FINDING_URL }),
    ).toBeNull();
    expect(
      BackendAPI.readExceptionStartedBy({ finding: "x", findingUrl: "" }),
    ).toBeNull();
    expect(
      BackendAPI.readExceptionStartedBy({
        finding: 42 as unknown as string,
        findingUrl: FINDING_URL,
      }),
    ).toBeNull();
  });
});
