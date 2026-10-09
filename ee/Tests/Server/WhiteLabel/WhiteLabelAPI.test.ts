import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import PartialEntity from "Common/Types/Database/PartialEntity";
import BadDataException from "Common/Types/Exception/BadDataException";
import MimeType from "Common/Types/File/MimeType";
import { JSONObject } from "Common/Types/JSON";
import {
  createWhiteLabelRouter,
  sendWhiteLabelImage,
  WHITE_LABEL_IMAGE_CACHE_CONTROL,
  WHITE_LABEL_IMAGE_CONTENT_SECURITY_POLICY,
} from "../../../Server/WhiteLabel/API/WhiteLabelAPI";
import { WhiteLabelImageKind } from "../../../Server/WhiteLabel/WhiteLabelImages";
import { WhiteLabelProvider } from "../../../Server/WhiteLabel/WhiteLabelProvider";
import { WhiteLabelSettings } from "../../../Server/WhiteLabel/WhiteLabelSettings";
import {
  findRoute,
  FoundRoute,
  listRoutes,
} from "../License/Helpers/LicenseTestKit";
import {
  ICO_BYTES,
  PNG_BYTES,
  SVG_TEXT,
  toDataUrlOf,
} from "./WhiteLabelFixtures";

/*
 * The white-label routes.
 *
 * What these pin:
 *   - every route starts with the license gate, ahead of the master-admin
 *     check: while the license does not allow white-labelling, a request -
 *     signed in or not, any method - ends exactly where a request for a path
 *     that does not exist ends. Proven over HTTP against a real express app
 *     with a 404 fallback, the way the App ends unknown /api requests;
 *   - with the license allowing it: the settings routes are master-admin
 *     only, a change is checked before anything is written, written as one
 *     update, and answered with the settings read back;
 *   - the images are served with the same protections every stored file
 *     gets, and an image that is not set is the same 404.
 */

const SETTINGS: WhiteLabelSettings = {
  productName: "Acme Monitoring",
  websiteUrl: null,
  logo: { type: MimeType.png, bytes: PNG_BYTES },
  darkLogo: null,
  favicon: { type: MimeType.svg, bytes: Buffer.from(SVG_TEXT) },
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
};

interface RouterHarness {
  router: ExpressRouter;
  allowed: { value: boolean };
  writes: Array<PartialEntity<GlobalConfig>>;
  settings: { value: WhiteLabelSettings };
}

const createHarness: () => RouterHarness = (): RouterHarness => {
  const allowed: { value: boolean } = { value: true };
  const writes: Array<PartialEntity<GlobalConfig>> = [];
  const settings: { value: WhiteLabelSettings } = { value: SETTINGS };

  const provider: WhiteLabelProvider = new WhiteLabelProvider({
    loadSettings: async (): Promise<WhiteLabelSettings> => {
      return settings.value;
    },
    isAllowed: (): boolean => {
      return allowed.value;
    },
  });

  const router: ExpressRouter = createWhiteLabelRouter({
    provider,
    writeSettings: async (
      update: PartialEntity<GlobalConfig>,
    ): Promise<void> => {
      writes.push(update);
      settings.value = {
        ...settings.value,
        productName:
          update.brandingProductName === undefined
            ? settings.value.productName
            : (update.brandingProductName as string | null),
      };
    },
    now: (): Date => {
      return new Date("2026-10-08T12:00:00.000Z");
    },
  });

  return { router, allowed, writes, settings };
};

interface FakeResponse {
  headers: Record<string, string>;
  statusCode: number;
  body: unknown;
  set: (name: string, value: string) => FakeResponse;
  status: (code: number) => FakeResponse;
  send: (body: unknown) => FakeResponse;
}

const fakeResponse: () => FakeResponse = (): FakeResponse => {
  const response: FakeResponse = {
    headers: {},
    statusCode: 0,
    body: undefined,
    set: (name: string, value: string): FakeResponse => {
      response.headers[name.toLowerCase()] = value;
      return response;
    },
    status: (code: number): FakeResponse => {
      response.statusCode = code;
      return response;
    },
    send: (body: unknown): FakeResponse => {
      response.body = body;
      return response;
    },
  };

  return response;
};

// Runs a route's handlers in order, the way express does, until one does not call next().
const runRoute: (
  route: FoundRoute,
  req: Record<string, unknown>,
  res: unknown,
) => Promise<{ nextArgument: unknown; stoppedAt: number }> = async (
  route: FoundRoute,
  req: Record<string, unknown>,
  res: unknown,
): Promise<{ nextArgument: unknown; stoppedAt: number }> => {
  for (let index: number = 0; index < route.handlers.length; index++) {
    let calledNext: boolean = false;
    let nextArgument: unknown = undefined;

    await route.handlers[index]!(req, res, (argument?: unknown): void => {
      calledNext = true;
      nextArgument = argument;
    });

    if (!calledNext) {
      return { nextArgument: undefined, stoppedAt: index };
    }

    if (nextArgument !== undefined) {
      return { nextArgument, stoppedAt: index };
    }
  }

  return { nextArgument: undefined, stoppedAt: route.handlers.length };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the router", () => {
  test("serves exactly these routes", () => {
    expect(listRoutes(createHarness().router)).toEqual([
      "GET /branding/dark-logo",
      "GET /branding/favicon",
      "GET /branding/logo",
      "GET /branding/settings",
      "PUT /branding/settings",
    ]);
  });

  test("starts every route with the license gate, the settings routes then with the master-admin check", () => {
    const router: ExpressRouter = createHarness().router;
    const gates: Set<unknown> = new Set<unknown>();

    for (const [method, path] of [
      ["get", "/branding/settings"],
      ["put", "/branding/settings"],
      ["get", "/branding/logo"],
      ["get", "/branding/dark-logo"],
      ["get", "/branding/favicon"],
    ] as Array<[string, string]>) {
      const route: FoundRoute = findRoute(router, method, path);
      gates.add(route.handlers[0]);

      expect(route.handlers[0]).not.toBe(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );

      if (path === "/branding/settings") {
        expect(route.handlers[1]).toBe(
          MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
        );
      }
    }

    // One gate, shared by every route.
    expect(gates.size).toBe(1);
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

describe("while the license does not allow white-labelling", () => {
  test.each([
    ["get", "/branding/settings"],
    ["put", "/branding/settings"],
    ["get", "/branding/logo"],
    ["get", "/branding/dark-logo"],
    ["get", "/branding/favicon"],
  ])(
    "%s %s passes the request on at the gate, before anything else looks at it",
    async (method: string, path: string) => {
      const harness: RouterHarness = createHarness();
      harness.allowed.value = false;

      const masterAdminSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        MasterAdminAuthorization,
        "isAuthorizedMasterAdminMiddleware",
      );

      const result: { nextArgument: unknown; stoppedAt: number } =
        await runRoute(
          findRoute(harness.router, method, path),
          { body: { productName: "Acme" } },
          fakeResponse(),
        );

      expect(result).toEqual({ nextArgument: "route", stoppedAt: 0 });
      expect(masterAdminSpy).not.toHaveBeenCalled();
      expect(harness.writes).toEqual([]);
    },
  );
});

describe("with the license allowing it", () => {
  test("GET /branding/settings answers with the settings", async () => {
    const harness: RouterHarness = createHarness();
    const sendSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation((): void => {
        return undefined;
      });
    const route: FoundRoute = findRoute(
      harness.router,
      "get",
      "/branding/settings",
    );

    await route.handler({}, fakeResponse(), jest.fn());

    const body: JSONObject = sendSpy.mock.calls[0]![2] as JSONObject;

    expect(body["productName"]).toBe("Acme Monitoring");
    expect((body["logo"] as JSONObject)["type"]).toBe(MimeType.png);
    expect(body["darkLogo"]).toBeNull();
  });

  test("PUT /branding/settings checks, writes one update, and answers with what was saved", async () => {
    const harness: RouterHarness = createHarness();
    const sendSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation((): void => {
        return undefined;
      });
    const route: FoundRoute = findRoute(
      harness.router,
      "put",
      "/branding/settings",
    );
    const next: ReturnType<typeof jest.fn> = jest.fn();

    await route.handler(
      {
        body: {
          productName: "Acme Cloud",
          favicon: toDataUrlOf(MimeType.ico, ICO_BYTES),
        },
      },
      fakeResponse(),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]).toEqual({
      brandingProductName: "Acme Cloud",
      brandingFavicon: toDataUrlOf(MimeType.ico, ICO_BYTES),
      brandingUpdatedAt: new Date("2026-10-08T12:00:00.000Z"),
    });
    expect((sendSpy.mock.calls[0]![2] as JSONObject)["productName"]).toBe(
      "Acme Cloud",
    );
  });

  test("PUT /branding/settings writes nothing when the change cannot be saved", async () => {
    const harness: RouterHarness = createHarness();
    const route: FoundRoute = findRoute(
      harness.router,
      "put",
      "/branding/settings",
    );
    const next: ReturnType<typeof jest.fn> = jest.fn();

    await route.handler(
      { body: { productName: "Acme <b>", logo: "data:image/png;base64,***" } },
      fakeResponse(),
      next,
    );

    expect(harness.writes).toEqual([]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
  });

  test("an image that is set is served with the protections every stored file gets", async () => {
    const harness: RouterHarness = createHarness();
    const response: FakeResponse = fakeResponse();

    await runRoute(
      findRoute(harness.router, "get", "/branding/logo"),
      {},
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect((response.body as Buffer).equals(PNG_BYTES)).toBe(true);
    expect(response.headers["content-type"]).toBe(MimeType.png);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBe(
      WHITE_LABEL_IMAGE_CONTENT_SECURITY_POLICY,
    );
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["cache-control"]).toBe(
      WHITE_LABEL_IMAGE_CACHE_CONTROL,
    );
    expect(response.headers["content-disposition"]).toMatch(/^inline;/);
  });

  test("an SVG is served as an attachment, so opening it on its own renders nothing", async () => {
    const harness: RouterHarness = createHarness();
    const response: FakeResponse = fakeResponse();

    await runRoute(
      findRoute(harness.router, "get", "/branding/favicon"),
      {},
      response,
    );

    expect(response.headers["content-type"]).toBe(MimeType.svg);
    expect(response.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(response.headers["content-security-policy"]).toContain("sandbox");
  });

  test("an image that is not set ends like a route that does not exist", async () => {
    const harness: RouterHarness = createHarness();

    const result: { nextArgument: unknown; stoppedAt: number } = await runRoute(
      findRoute(harness.router, "get", "/branding/dark-logo"),
      {},
      fakeResponse(),
    );

    expect(result.nextArgument).toBe("route");
  });
});

describe("over HTTP: an installation that may not white-label cannot tell these routes from none", () => {
  let server: http.Server;
  let baseUrl: string;
  const harness: RouterHarness = createHarness();

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson());
    app.use("/api", harness.router);
    // How the App ends a request nothing answered (StartServer.addDefaultRoutes).
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

  beforeEach(() => {
    harness.allowed.value = false;
  });

  const request: (
    method: string,
    path: string,
  ) => Promise<{ status: number; body: string }> = async (
    method: string,
    path: string,
  ): Promise<{ status: number; body: string }> => {
    const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-a-real-token",
      },
      ...(method === "PUT"
        ? { body: JSON.stringify({ productName: "x" }) }
        : {}),
    });

    return { status: response.status, body: await response.text() };
  };

  test.each([
    ["GET", "/api/branding/settings"],
    ["PUT", "/api/branding/settings"],
    ["GET", "/api/branding/logo"],
    ["GET", "/api/branding/dark-logo"],
    ["GET", "/api/branding/favicon"],
  ])(
    "%s %s answers exactly what a path that does not exist answers",
    async (method: string, path: string) => {
      const unknown: { status: number; body: string } = await request(
        method,
        "/api/no-such-route",
      );
      const answer: { status: number; body: string } = await request(
        method,
        path,
      );

      expect(answer).toEqual(unknown);
      expect(answer.status).toBe(404);
    },
  );

  test("with the license allowing it, the same request reaches the master-admin check", async () => {
    harness.allowed.value = true;

    const answer: { status: number; body: string } = await request(
      "GET",
      "/api/branding/settings",
    );

    expect(answer.status).not.toBe(404);
    expect([401, 403, 422]).toContain(answer.status);
  });
});

describe("sendWhiteLabelImage", () => {
  test("names the file after the image, with the extension of its type", () => {
    const response: FakeResponse = fakeResponse();

    sendWhiteLabelImage(
      {} as never,
      response as never,
      WhiteLabelImageKind.DarkLogo,
      { type: MimeType.png, bytes: PNG_BYTES },
    );

    expect(response.headers["content-disposition"]).toContain(
      'filename="logo-dark.png"',
    );
  });
});
