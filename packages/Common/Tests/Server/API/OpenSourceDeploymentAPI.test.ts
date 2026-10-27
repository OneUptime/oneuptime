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
 * A self-hosted install registers here when its first user signs up with
 * release emails ticked - and so does every CI and end-to-end run, whose
 * sign-ups use addresses on names reserved for testing (example.com,
 * .test, .invalid). Those are not installs, so they are neither recorded
 * nor passed on to the webhook.
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

let create: ReturnType<typeof jest.spyOn>;
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

async function register(body: JSONObject): Promise<void> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("POST", REGISTER_ROUTE).handlerFunction(
    {
      body,
      headers: {},
      params: {},
      query: {},
    } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    next,
  );

  expect(next).not.toHaveBeenCalled();
}

describe("POST /open-source-deployment/register", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new OpenSourceDeploymentAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    create = jest
      .spyOn(OpenSourceDeploymentService, "create")
      .mockResolvedValue(new OpenSourceDeployment());

    post = jest.spyOn(API, "post").mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("records an install signed up on a real address, and passes it to the webhook", async () => {
    await register(signUp("jane@acme.io"));

    expect(create).toHaveBeenCalledTimes(1);

    const { data, props } = create.mock.calls[0]![0] as {
      data: OpenSourceDeployment;
      props: JSONObject;
    };

    expect(data.email).toBe("jane@acme.io");
    expect(data.companyName).toBe("Acme");
    expect(data.oneuptimeVersion).toBe("10.0.5");
    expect(data.instanceUrl).toBe("https://oneuptime.acme.io/");
    expect(props).toEqual({ isRoot: true });

    expect(post).toHaveBeenCalledTimes(1);

    const { url, data: sent } = post.mock.calls[0]![0] as {
      url: URL;
      data: JSONObject;
    };

    expect(url.toString()).toBe("https://hooks.acme.io/open-source-deployment");
    expect(sent["email"]).toBe("jane@acme.io");
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

    expect(create).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();

    // The install is told all went well, so it has nothing to log.
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  test("still records a name that only looks reserved", async () => {
    await register(signUp("jane@example.com.au"));

    expect(create).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("still skips an install left at http://localhost", async () => {
    await register({
      ...signUp("jane@acme.io"),
      instanceUrl: "http://localhost/",
    });

    expect(create).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });
});
