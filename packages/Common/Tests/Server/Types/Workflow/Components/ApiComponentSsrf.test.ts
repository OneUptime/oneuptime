import ApiDelete from "../../../../../Server/Types/Workflow/Components/API/Delete";
import ApiGet from "../../../../../Server/Types/Workflow/Components/API/Get";
import ApiPatch from "../../../../../Server/Types/Workflow/Components/API/Patch";
import ApiPost from "../../../../../Server/Types/Workflow/Components/API/Post";
import ApiPut from "../../../../../Server/Types/Workflow/Components/API/Put";
import ComponentCode, {
  RunOptions,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import API from "../../../../../Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";

/*
 * GHSA-v5xh-rw9h-77fv: the API workflow components sent a request to whatever
 * URL the workflow author typed in, with no blocklist. Any member of any
 * project could point one at http://169.254.169.254/latest/meta-data/ and read
 * the cloud instance credentials straight out of the component's
 * "response-body" return value, or sweep the cluster's internal services by
 * watching the status codes.
 *
 * These tests pin the guard at the one place all five verbs share
 * (ApiComponentUtils.sanitizeArgs) - for every verb, so a new component cannot
 * be added that quietly skips it.
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

type ApiMethodName = "get" | "post" | "put" | "patch" | "delete";

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

const apiComponents: Array<[string, ApiMethodName, () => ComponentCode]> = [
  [
    "Get",
    "get",
    (): ComponentCode => {
      return new ApiGet();
    },
  ],
  [
    "Post",
    "post",
    (): ComponentCode => {
      return new ApiPost();
    },
  ],
  [
    "Put",
    "put",
    (): ComponentCode => {
      return new ApiPut();
    },
  ],
  [
    "Patch",
    "patch",
    (): ComponentCode => {
      return new ApiPatch();
    },
  ],
  [
    "Delete",
    "delete",
    (): ComponentCode => {
      return new ApiDelete();
    },
  ],
];

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

function getApiMock(apiMethodName: ApiMethodName): jest.Mock {
  return API[apiMethodName] as unknown as jest.Mock;
}

let lookupSpy: LookupSpy;

beforeEach(() => {
  jest.clearAllMocks();
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
  lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(apiComponents)(
  "API %s workflow component SSRF guard",
  (
    _label: string,
    apiMethodName: ApiMethodName,
    createComponent: () => ComponentCode,
  ) => {
    const blockedUrls: Array<[string, string]> = [
      ["cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
      [
        "cloud metadata endpoint on an explicit port",
        "http://169.254.169.254:80/latest/meta-data/",
      ],
      ["GCP metadata by name", "http://metadata.google.internal/"],
      ["loopback", "http://127.0.0.1:8080/admin"],
      ["localhost", "http://localhost:3000/api/status"],
      ["RFC-1918 10/8", "http://10.0.0.5/internal"],
      ["RFC-1918 172.16/12", "http://172.16.4.1/internal"],
      ["RFC-1918 192.168/16", "http://192.168.1.1/router"],
      ["CGNAT", "http://100.64.0.1/"],
      ["IPv6 loopback", "http://[::1]:9200/_cluster/health"],
      ["IPv6 link-local", "http://[fe80::1]/"],
      ["IPv6 unique-local", "http://[fd00::1]/"],
      ["the unspecified address", "http://0.0.0.0/"],
    ];

    test.each(blockedUrls)(
      "refuses to request %s and never reaches the HTTP client",
      async (_reason: string, url: string) => {
        await expect(
          createComponent().run({ url }, makeOptions()),
        ).rejects.toThrow();

        expect(getApiMock(apiMethodName)).not.toHaveBeenCalled();
      },
    );

    test("refuses a public hostname that resolves to an internal address", async () => {
      // The DNS-rebinding shape: the name looks fine, the answer does not.
      lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

      await expect(
        createComponent().run(
          { url: "https://metadata.attacker.example/latest/meta-data/" },
          makeOptions(),
        ),
      ).rejects.toThrow();

      expect(getApiMock(apiMethodName)).not.toHaveBeenCalled();
    });

    test("refuses a non-http scheme", async () => {
      await expect(
        createComponent().run({ url: "file:///etc/passwd" }, makeOptions()),
      ).rejects.toThrow();

      expect(getApiMock(apiMethodName)).not.toHaveBeenCalled();
    });

    test("still allows an ordinary public URL", async () => {
      getApiMock(apiMethodName).mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { ok: true }, {}),
      );

      const result: { returnValues: JSONObject } = await createComponent().run(
        { url: "https://api.example.com/v1/deploy" },
        makeOptions(),
      );

      expect(getApiMock(apiMethodName)).toHaveBeenCalledTimes(1);
      expect(result.returnValues["response-status"]).toBe(200);
    });

    test("sends the allowed request with redirects turned off", async () => {
      getApiMock(apiMethodName).mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { ok: true }, {}),
      );

      await createComponent().run(
        { url: "https://api.example.com/v1/deploy" },
        makeOptions(),
      );

      const request: { options?: { doNotFollowRedirects?: boolean } } =
        getApiMock(apiMethodName).mock.calls[0]![0] as {
          options?: { doNotFollowRedirects?: boolean };
        };

      /*
       * Validating the URL is only half the fix. Following a 3xx would let a
       * host that passes the blocklist hand the server an internal address
       * afterwards, which is the same vulnerability one hop later.
       */
      expect(request.options?.doNotFollowRedirects).toBe(true);
    });
  },
);
