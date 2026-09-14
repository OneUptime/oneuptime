import ApiPost from "../../../../../Server/Types/Workflow/Components/API/Post";
import ComponentCode, {
  RunOptions,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import API from "../../../../../Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

/*
 * The workflow API components are the sink issue #3424 was filed against: a
 * self-hosted operator built a workflow to post alerts to their internal
 * Mattermost and got "Webhook URL resolves to a private, loopback, or
 * link-local address".
 *
 * A workflow URL is written by a member of the project it runs in, so these
 * components declare themselves eligible for the instance's private-network
 * exception. What matters here is what that eligibility does and does not
 * buy: nothing at all on an instance that configured nothing (every SaaS
 * deployment, and the default everywhere else), and never the forbidden tier
 * — a workflow author must not be able to read the cloud metadata endpoint,
 * however permissively the operator configured the instance.
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

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

const PROJECT_ID: ObjectID = ObjectID.generate();

function makeOptions(): RunOptions {
  return {
    log: jest.fn() as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: PROJECT_ID,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

function postMock(): jest.Mock {
  return API.post as unknown as jest.Mock;
}

describe("API workflow component — private network exception", () => {
  let lookupSpy: LookupSpy;
  let originalAllow: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();

    originalAllow = process.env[ALLOW_ENV];
    delete process.env[ALLOW_ENV];

    lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
    lookupSpy.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);

    postMock().mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalAllow === undefined) {
      delete process.env[ALLOW_ENV];
    } else {
      process.env[ALLOW_ENV] = originalAllow;
    }
  });

  test("an unconfigured instance still refuses an internal target", async () => {
    const component: ComponentCode = new ApiPost();

    await expect(
      component.run(
        { url: "http://mattermost.internal/hooks/abc" },
        makeOptions(),
      ),
    ).rejects.toThrow();

    expect(postMock()).not.toHaveBeenCalled();
  });

  test("a configured instance reaches the internal host", async () => {
    process.env[ALLOW_ENV] = "true";

    const component: ComponentCode = new ApiPost();

    const result: { returnValues: JSONObject } = await component.run(
      { url: "http://mattermost.internal/hooks/abc" },
      makeOptions(),
    );

    expect(postMock()).toHaveBeenCalledTimes(1);
    expect(result.returnValues["response-status"]).toBe(200);
  });

  /*
   * The whole point of the two-tier split. A workflow author must not be able
   * to read the instance's IAM credentials on the most permissive setting
   * the boolean offers.
   */
  test.each([
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://127.0.0.1:8080/admin",
    "http://localhost:3000/api/status",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://0.0.0.0/",
    "http://[::1]:9200/_cluster/health",
  ])("a configured instance still cannot reach %s", async (url: string) => {
    process.env[ALLOW_ENV] = "true";

    const component: ComponentCode = new ApiPost();

    await expect(component.run({ url }, makeOptions())).rejects.toThrow();
    expect(postMock()).not.toHaveBeenCalled();
  });

  test("an ordinary public URL is unaffected either way", async () => {
    const component: ComponentCode = new ApiPost();

    lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    await component.run(
      { url: "https://api.example.com/v1/deploy" },
      makeOptions(),
    );
    expect(postMock()).toHaveBeenCalledTimes(1);
  });
});
