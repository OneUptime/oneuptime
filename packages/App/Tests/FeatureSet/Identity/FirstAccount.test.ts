import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";

/*
 * A self-hosted server waiting for its first account (#5229's follow-ups).
 * A new install's sign-in page asked for an email and a password nobody had,
 * and the first visitor had to find "Register" for themselves. While a
 * self-hosted server has no user and no project (the state in which the
 * next signup becomes its admin) and lets people sign up:
 *
 *   - its sign-in page (/accounts, /accounts/login) sends the browser on to
 *     /accounts/register, keeping the query, never stored;
 *   - POST /identity/first-account says so, for the register page.
 *
 * OneUptime Cloud is never waiting and never asks the database. Once the
 * server has had an account this process stops asking.
 *
 * The real helper, router and redirect hook, behind a real HTTP server
 * (express 4 from Common, as the server resolves it); the two reads the
 * helper makes are stubbed.
 */

const mockState: {
  awaiting: boolean;
  signupDisabled: boolean;
  fails: boolean;
  asked: number;
} = { awaiting: true, signupDisabled: false, fails: false, asked: 0 };

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      isAwaitingFirstAccount: async (): Promise<boolean> => {
        mockState.asked++;
        if (mockState.fails) {
          throw new Error("database down");
        }
        return mockState.awaiting;
      },
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      shouldDisableSignup: async (): Promise<boolean> => {
        return mockState.signupDisabled;
      },
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import FirstAccountAPI from "../../../FeatureSet/Identity/API/FirstAccount";
import {
  FirstAccountSources,
  REGISTER_PAGE_PATH,
  SIGN_IN_PAGE_PATHS,
  forgetFirstAccountForTests,
  isSignInPagePath,
  isWaitingForFirstAccount,
  sendToRegisterBeforeFirstAccount,
} from "../../../FeatureSet/Identity/Utils/FirstAccount";

const REPO_PACKAGES: string = path.resolve(__dirname, "../../../..");

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const express: any = require(
  path.join(REPO_PACKAGES, "Common", "node_modules", "express"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

interface Reply {
  status: number;
  location: string | undefined;
  cacheControl: string | undefined;
  body: string;
}

let server: http.Server;
let origin: string;

const request: (method: string, url: string) => Promise<Reply> = (
  method: string,
  url: string,
): Promise<Reply> => {
  return new Promise(
    (resolve: (reply: Reply) => void, reject: (error: Error) => void) => {
      const sent: http.ClientRequest = http.request(
        `${origin}${url}`,
        {
          method,
          headers: { "content-type": "application/json" },
        },
        (response: http.IncomingMessage) => {
          let body: string = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              location: response.headers.location,
              cacheControl: response.headers["cache-control"] as
                | string
                | undefined,
              body,
            });
          });
        },
      );
      sent.on("error", reject);
      sent.end(method === "POST" ? "{}" : undefined);
    },
  );
};

beforeAll(async () => {
  const app: any = express();
  app.use(express.json());
  // Mounted as Identity/Index.ts mounts it.
  app.use(["/api/identity", "/"], FirstAccountAPI);
  // The Accounts app's index page, through its hook as Frontend/Index.ts renders it.
  app.get(["/accounts", "/accounts/*"], async (req: any, res: any) => {
    await sendToRegisterBeforeFirstAccount(req, res);
    if (!res.headersSent) {
      res.status(200).send("<html>the Accounts app</html>");
    }
  });

  server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  mockState.awaiting = true;
  mockState.signupDisabled = false;
  mockState.fails = false;
  mockState.asked = 0;
  forgetFirstAccountForTests();
});

describe("the sign-in page of a server with no account yet", () => {
  test.each(["/accounts", "/accounts/", "/accounts/login", "/accounts/login/"])(
    "%s sends the browser to register, and the redirect is never stored",
    async (page: string) => {
      const reply: Reply = await request("GET", page);

      expect(reply.status).toBe(302);
      expect(reply.location).toBe(REGISTER_PAGE_PATH);
      expect(reply.cacheControl).toBe("no-store");
    },
  );

  test("the query the visitor came with goes along", async () => {
    const reply: Reply = await request(
      "GET",
      "/accounts/login?email=ada%40example.com&utm_source=readme",
    );

    expect(reply.location).toBe(
      "/accounts/register?email=ada%40example.com&utm_source=readme",
    );
  });

  test.each([
    "/accounts/register",
    "/accounts/sso",
    "/accounts/forgot-password",
    "/accounts/verify-email/abc",
    "/accounts/loginx",
  ])("%s is drawn as usual", async (page: string) => {
    const reply: Reply = await request("GET", page);

    expect(reply.status).toBe(200);
    expect(reply.location).toBeUndefined();
  });

  test("POST /identity/first-account says the server is waiting, at both mounts, never stored", async () => {
    for (const route of ["/api/identity/first-account", "/first-account"]) {
      const reply: Reply = await request("POST", route);

      expect(reply.status).toBe(200);
      expect(JSON.parse(reply.body)).toEqual({ isAwaitingFirstAccount: true });
      expect(reply.cacheControl).toBe("no-store");
    }
  });
});

describe("once the server has an account", () => {
  test("the sign-in page is drawn, and the server says it is not waiting", async () => {
    mockState.awaiting = false;

    expect((await request("GET", "/accounts/login")).status).toBe(200);
    expect(
      JSON.parse((await request("POST", "/api/identity/first-account")).body),
    ).toEqual({ isAwaitingFirstAccount: false });
  });

  test("this process stops asking: an account is never taken back", async () => {
    mockState.awaiting = false;
    await request("GET", "/accounts/login");
    const asked: number = mockState.asked;

    mockState.awaiting = true;
    const later: Reply = await request("GET", "/accounts/login");

    expect(later.status).toBe(200);
    expect(mockState.asked).toBe(asked);
  });

  test("while it waits, every load asks again, so the first signup ends the redirect", async () => {
    await request("GET", "/accounts/login");
    await request("GET", "/accounts/login");
    expect(mockState.asked).toBe(2);

    mockState.awaiting = false;
    expect((await request("GET", "/accounts/login")).status).toBe(200);
  });
});

describe("when there is nowhere to send anyone", () => {
  test("a server that does not let people sign up keeps its sign-in page", async () => {
    mockState.signupDisabled = true;

    expect((await request("GET", "/accounts/login")).status).toBe(200);
    expect(JSON.parse((await request("POST", "/first-account")).body)).toEqual({
      isAwaitingFirstAccount: false,
    });
  });

  test("a read that fails draws the usual sign-in page", async () => {
    mockState.fails = true;

    expect((await request("GET", "/accounts/login")).status).toBe(200);
    expect(JSON.parse((await request("POST", "/first-account")).body)).toEqual({
      isAwaitingFirstAccount: false,
    });
  });
});

describe("isWaitingForFirstAccount", () => {
  const sources: (
    overrides: Partial<FirstAccountSources>,
  ) => FirstAccountSources & { asked: Array<string> } = (
    overrides: Partial<FirstAccountSources>,
  ): FirstAccountSources & { asked: Array<string> } => {
    const asked: Array<string> = [];
    return {
      asked,
      isBillingEnabled: false,
      isAwaitingFirstAccount: async (): Promise<boolean> => {
        asked.push("accounts");
        return true;
      },
      isSignupDisabled: async (): Promise<boolean> => {
        asked.push("signup");
        return false;
      },
      ...overrides,
    };
  };

  test("OneUptime Cloud is never waiting, and the database is never asked", async () => {
    const cloud: FirstAccountSources & { asked: Array<string> } = sources({
      isBillingEnabled: true,
    });

    await expect(isWaitingForFirstAccount(cloud)).resolves.toBe(false);
    expect(cloud.asked).toEqual([]);
  });

  test("a self-hosted server with no account that lets people sign up is waiting", async () => {
    const selfHosted: FirstAccountSources & { asked: Array<string> } = sources(
      {},
    );

    await expect(isWaitingForFirstAccount(selfHosted)).resolves.toBe(true);
    expect(selfHosted.asked).toEqual(["accounts", "signup"]);
  });
});

describe("isSignInPagePath", () => {
  test("the Accounts app's sign-in routes, with or without a trailing slash", () => {
    expect(SIGN_IN_PAGE_PATHS).toEqual(["/accounts", "/accounts/login"]);
    for (const page of [
      "/accounts",
      "/accounts/",
      "/accounts/login",
      "/accounts/login//",
    ]) {
      expect(isSignInPagePath(page)).toBe(true);
    }
    for (const page of [
      "/",
      "/accounts/register",
      "/accounts/login/x",
      "/dashboard",
    ]) {
      expect(isSignInPagePath(page)).toBe(false);
    }
  });

  test("they are the routes the Accounts app draws its sign-in page at", () => {
    const app: string = fs.readFileSync(
      path.join(REPO_PACKAGES, "App/FeatureSet/Accounts/src/App.tsx"),
      "utf8",
    );

    for (const page of SIGN_IN_PAGE_PATHS) {
      expect(app).toContain(`<Route path="${page}" element={<LoginPage />} />`);
    }
    expect(app).toContain(
      `<Route path="${REGISTER_PAGE_PATH}" element={<RegisterPage />} />`,
    );
  });
});

describe("the wiring", () => {
  test("Frontend/Index.ts gives the Accounts app the redirect hook, and Identity/Index.ts mounts the route", () => {
    const frontend: string = fs.readFileSync(
      path.join(REPO_PACKAGES, "App/FeatureSet/Frontend/Index.ts"),
      "utf8",
    );
    const identity: string = fs.readFileSync(
      path.join(REPO_PACKAGES, "App/FeatureSet/Identity/Index.ts"),
      "utf8",
    );
    const accountsRegistration: string = frontend.slice(
      frontend.indexOf('routePrefix: "/accounts"'),
    );

    expect(
      accountsRegistration.slice(0, accountsRegistration.indexOf("});")),
    ).toContain(
      "getVariablesToRenderIndexPage: sendToRegisterBeforeFirstAccount",
    );
    expect(identity).toContain(
      'app.use([`/${APP_NAME}`, "/"], FirstAccountAPI);',
    );
  });
});
