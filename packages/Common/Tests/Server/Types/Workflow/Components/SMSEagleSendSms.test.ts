import SendSms from "../../../../../Server/Types/Workflow/Components/SMSEagle/SendSms";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import SSRFProtection from "../../../../../Server/Utils/SSRFProtection";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import API, { RequestOptions } from "../../../../../Utils/API";
import { beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../../Utils/API", () => {
  return {
    __esModule: true,
    default: { post: jest.fn() },
  };
});

jest.mock("../../../../../Server/Utils/SSRFProtection", () => {
  return {
    __esModule: true,
    default: { validateWebhookTargetIsSafe: jest.fn() },
  };
});

const apiPostMock: jest.Mock = API.post as unknown as jest.Mock;
const ssrfMock: jest.Mock =
  SSRFProtection.validateWebhookTargetIsSafe as unknown as jest.Mock;

const ACCESS_TOKEN: string = "abc123def456";

function makeOptions(): RunOptions {
  return {
    log: jest.fn() as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

function makeArgs(overrides: JSONObject = {}): JSONObject {
  return {
    "api-url": "https://192.168.0.100",
    "access-token": ACCESS_TOKEN,
    to: "+15551234567",
    text: "Database is down",
    ...overrides,
  };
}

function queued(id: number): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    [{ status: "queued", message: "OK", number: "+15551234567", id: id }],
    {},
  );
}

interface PostRequest {
  url: URL;
  data: JSONObject;
  headers: JSONObject;
  options: RequestOptions;
}

function getPostRequest(): PostRequest {
  return apiPostMock.mock.calls[0]![0] as PostRequest;
}

async function runAndGetError(args: JSONObject): Promise<Error> {
  try {
    await new SendSms().run(args, makeOptions());
  } catch (err) {
    return err as Error;
  }

  throw new Error("Expected the component to throw");
}

beforeEach(() => {
  jest.clearAllMocks();
  ssrfMock.mockResolvedValue(undefined);
});

describe("SMSEagle SendSms - sending", () => {
  test("sends to the device's APIv2 SMS endpoint and returns the message id", async () => {
    apiPostMock.mockResolvedValue(queued(42));

    const result: RunReturnType = await new SendSms().run(
      makeArgs(),
      makeOptions(),
    );

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(getPostRequest().url.toString()).toBe(
      "https://192.168.0.100/api/v2/messages/sms",
    );
    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues).toEqual({ "message-id": "42" });
  });

  test("sends the number and text as the request body", async () => {
    apiPostMock.mockResolvedValue(queued(1));

    await new SendSms().run(
      makeArgs({ text: "Line 1\nLine 2" }),
      makeOptions(),
    );

    expect(getPostRequest().data).toEqual({
      to: ["+15551234567"],
      text: "Line 1\nLine 2",
    });
  });

  test("sends the access token in the access-token header", async () => {
    apiPostMock.mockResolvedValue(queued(1));

    await new SendSms().run(makeArgs(), makeOptions());

    expect(getPostRequest().headers).toEqual({ "access-token": ACCESS_TOKEN });
  });

  test("trims whitespace a pasted or stored token picked up", async () => {
    apiPostMock.mockResolvedValue(queued(1));

    await new SendSms().run(
      makeArgs({ "access-token": `  ${ACCESS_TOKEN}\n` }),
      makeOptions(),
    );

    expect(getPostRequest().headers["access-token"]).toBe(ACCESS_TOKEN);
  });

  test("does not double the slash after a device URL that ends with one", async () => {
    apiPostMock.mockResolvedValue(queued(1));

    await new SendSms().run(
      makeArgs({ "api-url": "https://192.168.0.100/" }),
      makeOptions(),
    );

    expect(getPostRequest().url.toString()).toBe(
      "https://192.168.0.100/api/v2/messages/sms",
    );
  });

  test("does not follow redirects", async () => {
    apiPostMock.mockResolvedValue(queued(1));

    await new SendSms().run(makeArgs(), makeOptions());

    expect(getPostRequest().options).toEqual({ doNotFollowRedirects: true });
  });
});

describe("SMSEagle SendSms - the device URL is checked first", () => {
  test("checks the URL against SSRF, allowing private-network targets", async () => {
    apiPostMock.mockResolvedValue(queued(1));

    await new SendSms().run(makeArgs(), makeOptions());

    expect(ssrfMock).toHaveBeenCalledWith("https://192.168.0.100", {
      allowPrivateNetworkTargets: true,
    });
  });

  test("refuses a URL the SSRF check rejects, without sending", async () => {
    ssrfMock.mockRejectedValue(
      new BadDataException("URL points to a link-local address."),
    );

    const error: Error = await runAndGetError(makeArgs());

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("URL points to a link-local address.");
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});

describe("SMSEagle SendSms - SMSEagle errors go to the error port", () => {
  test("an HTTP error returns SMSEagle's message", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPErrorResponse(401, { message: "Invalid access token" }, {}),
    );

    const result: RunReturnType = await new SendSms().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe("Invalid access token");
  });

  test("a 400 returns SMSEagle's message for each parameter", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: { to: "This value should not be blank." } },
        {},
      ),
    );

    const result: RunReturnType = await new SendSms().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "to: This value should not be blank.",
    );
  });

  test("a 400 for several parameters names each of them", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message: {
            to: "This value should not be blank.",
            text: "This value should not be blank.",
          },
        },
        {},
      ),
    );

    const result: RunReturnType = await new SendSms().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.returnValues["error"]).toBe(
      "to: This value should not be blank.; text: This value should not be blank.",
    );
  });

  test("an HTTP error with no message names the HTTP status", async () => {
    apiPostMock.mockResolvedValue(new HTTPErrorResponse(500, {}, {}));

    const result: RunReturnType = await new SendSms().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "SMSEagle answered with HTTP 500.",
    );
  });

  test("an HTML error page is not quoted, the HTTP status is", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPErrorResponse(
        403,
        "<html><head><title>Error 403</title></head></html>" as unknown as JSONObject,
        {},
      ),
    );

    const result: RunReturnType = await new SendSms().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "SMSEagle answered with HTTP 403.",
    );
  });

  test("a 200 that is not queued is still an error", async () => {
    apiPostMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        [{ status: "error", message: "Modem not ready" }],
        {},
      ),
    );

    const result: RunReturnType = await new SendSms().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe("Modem not ready");
  });

  test("a device that cannot be reached goes to the error port with the reason", async () => {
    apiPostMock.mockRejectedValue(
      new APIException(
        "Request failed to https://192.168.0.100/api/v2/messages/sms. connect ECONNREFUSED",
      ),
    );

    const result: RunReturnType = await new SendSms().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "Request failed to https://192.168.0.100/api/v2/messages/sms. connect ECONNREFUSED",
    );
  });

  test("any other thrown error goes to the error port with a generic message", async () => {
    apiPostMock.mockRejectedValue(new Error("unexpected"));

    const result: RunReturnType = await new SendSms().run(
      makeArgs(),
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "The request could not be sent to SMSEagle.",
    );
  });
});

describe("SMSEagle SendSms - argument validation", () => {
  test.each([
    ["api-url", "SMSEagle URL not found"],
    ["access-token", "SMSEagle Access Token not found"],
    ["to", "Phone Number not found"],
    ["text", "SMS message not found"],
  ])(
    "refuses a missing %s without sending",
    async (argument: string, expectedMessage: string) => {
      const args: JSONObject = makeArgs();
      delete args[argument];

      const error: Error = await runAndGetError(args);

      expect(error.message).toBe(expectedMessage);
      expect(apiPostMock).not.toHaveBeenCalled();
    },
  );
});
