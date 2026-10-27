import { mockRouter } from "./Helpers";
import OpenSourceDeploymentAPI from "../../../Server/API/OpenSourceDeploymentAPI";
import OpenSourceDeploymentService from "../../../Server/Services/OpenSourceDeploymentService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import OpenSourceDeployment from "../../../Models/DatabaseModels/OpenSourceDeployment";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../Utils/API";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * oneuptime.com hears from self-hosted installs twice over: a sign-up with
 * release emails ticked registers the instance with its contact details,
 * and every install checks in once a day with its URL and version. Both
 * keep one record per instance URL (OpenSourceDeploymentService
 * .recordInstance). Neither records what is no install: CI and end-to-end
 * runs, which sign up on names reserved for testing (example.com, .test,
 * .invalid), and instances nobody else can reach (localhost, loopback).
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    OpenSourceDeploymentWebhookUrl:
      "https://hooks.acme.io/open-source-deployment",
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

const REGISTER_ROUTE: string = "/open-source-deployment/register";
const CHECK_IN_ROUTE: string = "/open-source-deployment/check-in";

// Instance URLs no install that someone else reaches is ever at.
const UNREACHABLE_INSTANCE_URLS: Array<string> = [
  "http://localhost/",
  "http://localhost",
  "http://localhost:8080/",
  "http://127.0.0.1/",
  "https://oneuptime.test/",
  "",
];

let recordInstance: ReturnType<typeof jest.spyOn>;
let post: ReturnType<typeof jest.spyOn>;

function signUp(email: string): JSONObject {
  return {
    email,
    name: "Jane Doe",
    companyName: "Acme",
    companyPhoneNumber: "+15555550123",
    oneuptimeVersion: "10.0.5",
    instanceUrl: "https://oneuptime.acme.io/",
  };
}

async function call(route: string, body: JSONObject): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("POST", route).handlerFunction(
    {
      body,
      headers: {},
      params: {},
      query: {},
    } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    next,
  );

  return next;
}

async function register(body: JSONObject): Promise<void> {
  expect(await call(REGISTER_ROUTE, body)).not.toHaveBeenCalled();
}

async function checkIn(body: JSONObject): Promise<void> {
  expect(await call(CHECK_IN_ROUTE, body)).not.toHaveBeenCalled();
}

function recorded(): OpenSourceDeployment {
  expect(recordInstance).toHaveBeenCalledTimes(1);

  return recordInstance.mock.calls[0]![0] as OpenSourceDeployment;
}

function expectNothingRecorded(): void {
  expect(recordInstance).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();

  // The install is told all went well, so it has nothing to log.
  expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new OpenSourceDeploymentAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  recordInstance = jest
    .spyOn(OpenSourceDeploymentService, "recordInstance")
    .mockResolvedValue(undefined);

  post = jest.spyOn(API, "post").mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /open-source-deployment/register", () => {
  test("records an install signed up on a real address, and passes it to the webhook", async () => {
    await register(signUp("jane@acme.io"));

    const deployment: OpenSourceDeployment = recorded();

    expect(deployment.email).toBe("jane@acme.io");
    expect(deployment.name).toBe("Jane Doe");
    expect(deployment.companyName).toBe("Acme");
    expect(deployment.oneuptimeVersion).toBe("10.0.5");
    expect(deployment.instanceUrl).toBe("https://oneuptime.acme.io/");

    expect(post).toHaveBeenCalledTimes(1);

    const { url, data } = post.mock.calls[0]![0] as {
      url: URL;
      data: JSONObject;
    };

    expect(url.toString()).toBe("https://hooks.acme.io/open-source-deployment");
    expect(data["email"]).toBe("jane@acme.io");
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  test.each([
    // Faker.generateEmail's, which every end-to-end sign-up uses.
    "jane.k3j4h5g6@example.com",
    "template-sync-1761523200000@example.test",
    "passkey-0b6f2c1e@oneuptime-e2e.invalid",
    "ops@acme-commerce.example",
    "dev@oneuptime.localhost",
    "Jane@EXAMPLE.NET",
  ])("skips a sign-up on %s, which only a test uses", async (email: string) => {
    await register(signUp(email));

    expectNothingRecorded();
  });

  test("still records a name that only looks reserved", async () => {
    await register(signUp("jane@example.com.au"));

    expect(recorded().email).toBe("jane@example.com.au");
    expect(post).toHaveBeenCalledTimes(1);
  });

  test.each(UNREACHABLE_INSTANCE_URLS)(
    "skips an install at %p, which nobody else can reach",
    async (instanceUrl: string) => {
      await register({ ...signUp("jane@acme.io"), instanceUrl });

      expectNothingRecorded();
    },
  );
});

describe("POST /open-source-deployment/check-in", () => {
  test("records the instance's URL and version, and nothing about anyone", async () => {
    await checkIn({
      instanceUrl: "https://oneuptime.acme.io/",
      oneuptimeVersion: "10.0.6",
    });

    const deployment: OpenSourceDeployment = recorded();

    expect(deployment.instanceUrl).toBe("https://oneuptime.acme.io/");
    expect(deployment.oneuptimeVersion).toBe("10.0.6");
    expect(deployment.email).toBeUndefined();
    expect(deployment.name).toBeUndefined();
    expect(deployment.companyName).toBeUndefined();
    expect(deployment.companyPhoneNumber).toBeUndefined();
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  test("ignores contact details a caller adds", async () => {
    await checkIn({
      ...signUp("jane@acme.io"),
      oneuptimeVersion: "10.0.6",
    });

    expect(recorded().email).toBeUndefined();
    expect(recorded().name).toBeUndefined();
  });

  test("does not pass a check-in to the webhook", async () => {
    await checkIn({
      instanceUrl: "https://oneuptime.acme.io/",
      oneuptimeVersion: "10.0.6",
    });

    expect(post).not.toHaveBeenCalled();
  });

  test("records a check-in that names no version as unknown", async () => {
    await checkIn({ instanceUrl: "https://oneuptime.acme.io/" });

    expect(recorded().oneuptimeVersion).toBe("unknown");
  });

  test.each([
    ...UNREACHABLE_INSTANCE_URLS,
    "not a url",
    "ftp://files.acme.io/",
  ])(
    "skips a check-in from %p, which nobody else can reach",
    async (instanceUrl: string) => {
      await checkIn({ instanceUrl, oneuptimeVersion: "10.0.6" });

      expectNothingRecorded();
    },
  );

  test("hands a failure to record to Express", async () => {
    const failure: Error = new Error("database unavailable");

    recordInstance.mockRejectedValue(failure as never);

    const next: NextFunction = await call(CHECK_IN_ROUTE, {
      instanceUrl: "https://oneuptime.acme.io/",
      oneuptimeVersion: "10.0.6",
    });

    expect(next).toHaveBeenCalledWith(failure);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });
});
