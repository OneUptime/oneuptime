import ApiDelete from "../../../../../Server/Types/Workflow/Components/API/Delete";
import ApiGet from "../../../../../Server/Types/Workflow/Components/API/Get";
import ApiPatch from "../../../../../Server/Types/Workflow/Components/API/Patch";
import ApiPost from "../../../../../Server/Types/Workflow/Components/API/Post";
import ApiPut from "../../../../../Server/Types/Workflow/Components/API/Put";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import API from "../../../../../Utils/API";
import { afterAll, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";

/*
 * The default export of Utils/API is the only thing these components talk to,
 * so it is replaced wholesale. Everything else - sanitizeArgs, URL parsing,
 * HTTPResponse/HTTPErrorResponse and the component metadata - stays real,
 * because the ports and the return values are exactly what is under test.
 */
jest.mock("../../../../../Utils/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    },
  };
});

/*
 * A customer's workflow did PUT /api/workflow-variable/<id> with a body the
 * server rejected, and the workflow log still said "Executing Port: Success".
 *
 * The reason is that on the server Utils/API RESOLVES with an
 * HTTPErrorResponse for a 4xx/5xx (only the UI subclass throws), so the
 * try/catch in these components never saw the failure and the response fell
 * through to the success port. These tests pin the resolved-error path, the
 * ordinary success path, and the thrown-transport-error path for every HTTP
 * verb the workflow builder exposes.
 */

type ApiMethodName = "get" | "post" | "put" | "patch" | "delete";

type ComponentFactory = () => ComponentCode;

interface OptionsFixture {
  options: RunOptions;
  log: jest.Mock;
  onError: jest.Mock;
}

const TEST_URL: string = "https://oneuptime.com/api/workflow-variable/abc";

function makeOptions(): OptionsFixture {
  const log: jest.Mock = jest.fn();
  const onError: jest.Mock = jest.fn((exception: Exception): Exception => {
    return exception;
  });

  return {
    log,
    onError,
    options: {
      log: log as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: onError as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    },
  };
}

/*
 * The workflow builder hands every argument over as a string, so the JSON
 * bodies and headers are supplied the way the runner really supplies them and
 * sanitizeArgs is exercised for real.
 */
function makeArgs(): JSONObject {
  return {
    url: TEST_URL,
    "request-body": '{"content":"the-token","name":"Airflow-Token"}',
    "request-headers": '{"apikey":"a-project-api-key"}',
  };
}

function getApiMock(apiMethodName: ApiMethodName): jest.Mock {
  return API[apiMethodName] as unknown as jest.Mock;
}

const apiComponents: Array<[string, ApiMethodName, ComponentFactory, string]> =
  [
    [
      "Get",
      "get",
      (): ComponentCode => {
        return new ApiGet();
      },
      ComponentID.ApiGet,
    ],
    [
      "Post",
      "post",
      (): ComponentCode => {
        return new ApiPost();
      },
      ComponentID.ApiPost,
    ],
    [
      "Put",
      "put",
      (): ComponentCode => {
        return new ApiPut();
      },
      ComponentID.ApiPut,
    ],
    [
      "Patch",
      "patch",
      (): ComponentCode => {
        return new ApiPatch();
      },
      ComponentID.ApiPatch,
    ],
    [
      "Delete",
      "delete",
      (): ComponentCode => {
        return new ApiDelete();
      },
      ComponentID.ApiDelete,
    ],
  ];

/*
 * sanitizeArgs now runs the URL through SSRFProtection, which resolves the
 * hostname. Pin the lookup to a public address so these tests stay offline and
 * deterministic - what they are about is port routing, not the blocklist.
 */
const lookupSpy: jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
> = jest.spyOn(dns.promises, "lookup") as never;

beforeEach(() => {
  jest.clearAllMocks();
  lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe.each(apiComponents)(
  "API %s workflow component port routing",
  (
    _label: string,
    apiMethodName: ApiMethodName,
    createComponent: ComponentFactory,
    componentId: string,
  ) => {
    test("is wired to the matching component metadata and both of its ports", () => {
      const component: ComponentCode = createComponent();

      expect(component.getMetadata().id).toBe(componentId);
      expect(
        component.getMetadata().outPorts.map((port: { id: string }): string => {
          return port.id;
        }),
      ).toEqual(expect.arrayContaining(["success", "error"]));
    });

    test("routes an HTTP error the API resolved with - never throws - to the error port", async () => {
      getApiMock(apiMethodName).mockResolvedValue(
        new HTTPErrorResponse(
          400,
          { message: "Data in request body is missing or invalid." },
          {},
        ),
      );
      const fixture: OptionsFixture = makeOptions();

      const result: RunReturnType = await createComponent().run(
        makeArgs(),
        fixture.options,
      );

      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["response-status"]).toBe(400);
      expect(result.returnValues["error"]).toBeTruthy();
      expect(result.returnValues["error"]).toBe(
        "Data in request body is missing or invalid.",
      );
      expect(result.returnValues["response-body"]).toEqual({
        message: "Data in request body is missing or invalid.",
      });
      expect(getApiMock(apiMethodName)).toHaveBeenCalledTimes(1);
      expect(fixture.onError).not.toHaveBeenCalled();
    });

    test("keeps a 2xx response on the success port with no error value", async () => {
      getApiMock(apiMethodName).mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { updated: true }, {}),
      );
      const fixture: OptionsFixture = makeOptions();

      const result: RunReturnType = await createComponent().run(
        makeArgs(),
        fixture.options,
      );

      expect(result.executePort?.id).toBe("success");
      expect(result.returnValues["response-status"]).toBe(200);
      expect(result.returnValues["response-body"]).toEqual({ updated: true });
      expect(result.returnValues["error"]).toBeNull();
      expect(fixture.onError).not.toHaveBeenCalled();

      /*
       * The verb actually sent has to be the verb the component advertises -
       * a component that quietly called a different method would still satisfy
       * the port assertions above.
       */
      expect(getApiMock(apiMethodName)).toHaveBeenCalledTimes(1);
      const request: {
        url: URL;
        data: JSONObject;
        headers: JSONObject;
        options: { doNotFollowRedirects?: boolean };
      } = getApiMock(apiMethodName).mock.calls[0]![0] as {
        url: URL;
        data: JSONObject;
        headers: JSONObject;
        options: { doNotFollowRedirects?: boolean };
      };
      expect(request.url.toString()).toBe(TEST_URL);
      expect(request.data).toEqual({
        content: "the-token",
        name: "Airflow-Token",
      });
      expect(request.headers).toEqual({ apikey: "a-project-api-key" });
      /*
       * Redirects have to stay off, or the SSRF check sanitizeArgs just did is
       * worth nothing: a public host can 302 the server to an internal one.
       */
      expect(request.options.doNotFollowRedirects).toBe(true);
    });

    test("routes a thrown transport error to the error port with an error message", async () => {
      getApiMock(apiMethodName).mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:443"),
      );
      const fixture: OptionsFixture = makeOptions();

      const result: RunReturnType = await createComponent().run(
        makeArgs(),
        fixture.options,
      );

      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["error"]).toBe(
        "connect ECONNREFUSED 127.0.0.1:443",
      );
      expect(result.returnValues["errorMessage"]).toBeUndefined();
      expect(fixture.onError).not.toHaveBeenCalled();
    });

    test("routes an HTTP error the API threw to the error port", async () => {
      getApiMock(apiMethodName).mockRejectedValue(
        new HTTPErrorResponse(503, { message: "Service Unavailable" }, {}),
      );
      const fixture: OptionsFixture = makeOptions();

      const result: RunReturnType = await createComponent().run(
        makeArgs(),
        fixture.options,
      );

      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["response-status"]).toBe(503);
      expect(result.returnValues["error"]).toBe("Service Unavailable");
    });

    test("reports a 5xx with an empty body as an error rather than as success", async () => {
      getApiMock(apiMethodName).mockResolvedValue(
        new HTTPErrorResponse(500, {}, {}),
      );

      const result: RunReturnType = await createComponent().run(
        makeArgs(),
        makeOptions().options,
      );

      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["response-status"]).toBe(500);
      /* getReturnValues falls back to a generic message so the port is never silent. */
      expect(result.returnValues["error"]).toBe("Server Error.");
    });
  },
);
