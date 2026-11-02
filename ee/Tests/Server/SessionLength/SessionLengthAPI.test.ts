import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import { RequestSession } from "Common/Server/Middleware/UserAuthorization";
import { SessionLengthsImpact } from "Common/Server/Services/UserSessionService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import JSONWebTokenData from "Common/Types/JsonWebTokenData";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SEPARATE_SSO_SESSION_LENGTHS_PROBLEM,
  SESSION_IDLE_TIMEOUT_PROBLEM,
  SESSION_LENGTH_PROBLEM,
  SessionLengths,
} from "Common/Types/UserSession/SessionLength";
import {
  createSessionLengthRouter,
  parseSessionLengthPreview,
  SESSION_LENGTH_PREVIEW_ROUTE,
  SessionLengthRouterDependencies,
} from "../../../Server/SessionLength/API/SessionLengthAPI";
import {
  findRoute,
  FoundRoute,
  listRoutes,
} from "../License/Helpers/LicenseTestKit";

/*
 * POST /api/session-length/preview: what a change to the session lengths
 * would do to the people signed in now, asked by Admin Dashboard >
 * Settings > Session Length before it saves a change that signs people out.
 *
 * What these pin:
 *   - one route, master admins only, routes only on the router;
 *   - the body is the setting the change would leave, read column by column
 *     as GlobalConfigService takes a write - and refused with the very words
 *     it refuses one with - so the preview counts exactly what saving would
 *     end;
 *   - it counts with the asker's own session, and answers how many people
 *     the change signs out and whether the asker is one of them; nothing is
 *     changed;
 *   - over HTTP, nobody but a master admin learns anything from it.
 */

const SESSION_ID: string = "5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e";

interface Harness {
  router: ExpressRouter;
  counted: Array<{ lengths: SessionLengths; sessionId?: ObjectID | undefined }>;
  impact: { value: SessionLengthsImpact | Error };
  session: { value: RequestSession };
}

const createHarness: () => Harness = (): Harness => {
  const harness: Harness = {
    router: undefined as unknown as ExpressRouter,
    counted: [],
    impact: { value: { peopleCount: 3, includesSession: false } },
    session: {
      value: {
        kind: "user",
        session: {
          sessionId: new ObjectID(SESSION_ID),
          isMasterAdmin: true,
        } as unknown as JSONWebTokenData,
      },
    },
  };

  const dependencies: SessionLengthRouterDependencies = {
    countPeoplePastLengths: async (data: {
      lengths: SessionLengths;
      sessionId?: ObjectID | undefined;
    }): Promise<SessionLengthsImpact> => {
      harness.counted.push(data);

      if (harness.impact.value instanceof Error) {
        throw harness.impact.value;
      }

      return harness.impact.value;
    },
    readRequestSession: async (): Promise<RequestSession> => {
      return harness.session.value;
    },
  };

  harness.router = createSessionLengthRouter(dependencies);

  return harness;
};

// Calls the route's own handler, after the master-admin check.
const ask: (
  harness: Harness,
  body: unknown,
) => Promise<{ sent: JSONObject | null; nextArgument: unknown }> = async (
  harness: Harness,
  body: unknown,
): Promise<{ sent: JSONObject | null; nextArgument: unknown }> => {
  let sent: JSONObject | null = null;
  let nextArgument: unknown = undefined;

  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(
      (
        _req: ExpressRequest,
        _res: ExpressResponse,
        value: JSONObject,
      ): void => {
        sent = value;
      },
    );

  const route: FoundRoute = findRoute(
    harness.router,
    "post",
    SESSION_LENGTH_PREVIEW_ROUTE,
  );

  await route.handler(
    { body } as unknown as ExpressRequest,
    {},
    (argument?: unknown): void => {
      nextArgument = argument;
    },
  );

  return { sent, nextArgument };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the router", () => {
  test("serves exactly the preview", () => {
    expect(listRoutes(createHarness().router)).toEqual([
      "POST /session-length/preview",
    ]);
  });

  test("starts it with the master-admin check", () => {
    const route: FoundRoute = findRoute(
      createHarness().router,
      "post",
      SESSION_LENGTH_PREVIEW_ROUTE,
    );

    expect(route.handlers[0]).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
    expect(route.handlers).toHaveLength(2);
  });

  test("holds routes only - no router.use() layer", () => {
    const stack: Array<Record<string, unknown>> = (
      createHarness().router as unknown as {
        stack: Array<Record<string, unknown>>;
      }
    ).stack;

    for (const layer of stack) {
      expect(layer["route"]).toBeTruthy();
    }
  });
});

describe("parseSessionLengthPreview: the setting a change would leave", () => {
  test("every column as it would be saved", () => {
    expect(
      parseSessionLengthPreview({
        sessionLengthInMinutes: 480,
        sessionIdleTimeoutInMinutes: 30,
        useSeparateSsoSessionLengths: true,
        ssoSessionLengthInMinutes: 60,
        ssoSessionIdleTimeoutInMinutes: null,
      }),
    ).toEqual({
      standard: { lengthInMinutes: 480, idleTimeoutInMinutes: 30 },
      sso: { lengthInMinutes: 60, idleTimeoutInMinutes: null },
    });
  });

  test("SSO sign-ins follow the rule for everyone while the switch is off", () => {
    expect(
      parseSessionLengthPreview({
        sessionLengthInMinutes: 480,
        ssoSessionLengthInMinutes: 60,
      }),
    ).toEqual({
      standard: { lengthInMinutes: 480, idleTimeoutInMinutes: null },
      sso: { lengthInMinutes: 480, idleTimeoutInMinutes: null },
    });
  });

  test.each([[undefined], [null], ["lengths"], [[480]], [{}]])(
    "a body of %p is the defaults: no lengths",
    (body: unknown) => {
      expect(parseSessionLengthPreview(body)).toEqual({
        standard: { lengthInMinutes: null, idleTimeoutInMinutes: null },
        sso: { lengthInMinutes: null, idleTimeoutInMinutes: null },
      });
    },
  );

  test.each([
    [{ sessionLengthInMinutes: 10 }, SESSION_LENGTH_PROBLEM],
    [{ ssoSessionLengthInMinutes: "480" }, SESSION_LENGTH_PROBLEM],
    [{ sessionIdleTimeoutInMinutes: 43201 }, SESSION_IDLE_TIMEOUT_PROBLEM],
    [
      { useSeparateSsoSessionLengths: "on" },
      SEPARATE_SSO_SESSION_LENGTHS_PROBLEM,
    ],
  ])(
    "%p is refused with the words a write of it is refused with",
    (body: unknown, problem: string) => {
      expect(() => {
        parseSessionLengthPreview(body);
      }).toThrow(new BadDataException(problem));
    },
  );
});

describe("the preview", () => {
  test("counts with the setting and the asker's own session, and says who it signs out", async () => {
    const harness: Harness = createHarness();

    const { sent, nextArgument } = await ask(harness, {
      sessionLengthInMinutes: 60,
    });

    expect(nextArgument).toBeUndefined();
    expect(harness.counted).toHaveLength(1);
    expect(harness.counted[0]!.lengths).toEqual({
      standard: { lengthInMinutes: 60, idleTimeoutInMinutes: null },
      sso: { lengthInMinutes: 60, idleTimeoutInMinutes: null },
    });
    expect(harness.counted[0]!.sessionId?.toString()).toBe(SESSION_ID);
    expect(sent).toEqual({ peopleSignedOut: 3, includesYou: false });
  });

  test("says when the asker is one of them", async () => {
    const harness: Harness = createHarness();
    harness.impact.value = { peopleCount: 1, includesSession: true };

    const { sent } = await ask(harness, { sessionIdleTimeoutInMinutes: 15 });

    expect(sent).toEqual({ peopleSignedOut: 1, includesYou: true });
  });

  test("an asker whose session is not a person's sign-in counts without one", async () => {
    const harness: Harness = createHarness();
    harness.session.value = { kind: "none" };

    await ask(harness, { sessionLengthInMinutes: 60 });

    expect(harness.counted[0]!.sessionId).toBeUndefined();
  });

  test("a setting that could not be saved is refused, and nothing is counted", async () => {
    const harness: Harness = createHarness();

    const { sent, nextArgument } = await ask(harness, {
      sessionLengthInMinutes: 5,
    });

    expect(nextArgument).toBeInstanceOf(BadDataException);
    expect(harness.counted).toEqual([]);
    expect(sent).toBeNull();
  });

  test("a count that fails is an error, never zero people", async () => {
    const harness: Harness = createHarness();
    harness.impact.value = new Error("the database went away");

    const { sent, nextArgument } = await ask(harness, {
      sessionLengthInMinutes: 60,
    });

    expect((nextArgument as Error).message).toBe("the database went away");
    expect(sent).toBeNull();
  });
});

describe("over HTTP: nobody but a master admin learns anything from it", () => {
  let server: http.Server;
  let baseUrl: string;
  const harness: Harness = createHarness();

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson());
    app.use("/api", harness.router);
    app.all("*", (_req: ExpressRequest, res: ExpressResponse) => {
      res.status(404).send({ message: "Page not found" });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  test("a request without a master admin's sign-in is refused, and nothing is counted", async () => {
    const response: globalThis.Response = await fetch(
      `${baseUrl}/api/session-length/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionLengthInMinutes: 60 }),
      },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(harness.counted).toEqual([]);
  });
});
