import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import IdentityArea from "../../../Server/Identity/Index";
import { SCIM_UNAVAILABLE_MESSAGE } from "../../../Server/Identity/Middleware/LicensedFeatureGate";
import {
  expectEverySsoProbeAnswered,
  IdentityServer,
  startIdentityServer,
  stubRenderedViews,
  stubSsoDatabaseReads,
} from "App/Tests/FeatureSet/Identity/SsoRouteProbes";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import { EnterpriseLicenseSnapshot } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import FakeEnterpriseModule, {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * The real enterprise identity routers (SCIM), mounted ONCE by the real core
 * Identity feature set next to core's own single sign-on routers, answering
 * over HTTP while the license lapses and is renewed:
 *
 *   - lapsed: SCIM answers 403 with a SCIM error body, and nothing reaches a
 *     handler or the database; single sign-on keeps answering exactly as with
 *     a valid license - it is core and never asks the license;
 *   - renewed (or unknown): the same mounted SCIM routes reach their handlers
 *     again, with no restart and no re-mount.
 *
 * The enterprise module is the fake from Common's test kit carrying the real
 * identity routers, so the license can be changed per test. The
 * authentication, reseller and status page authentication routers are
 * replaced by empty ones. Every request is one the handlers turn away before
 * touching the database: the SCIM lookups are spied to fail if reached, and
 * the SSO provider lookups find nothing (App's SsoRouteProbes).
 */
jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("App/FeatureSet/Identity/API/Authentication", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");

  return { __esModule: true, default: express.default.getRouter() };
});

jest.mock("App/FeatureSet/Identity/API/Reseller", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");

  return { __esModule: true, default: express.default.getRouter() };
});

jest.mock("App/FeatureSet/Identity/API/StatusPageAuthentication", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");

  return { __esModule: true, default: express.default.getRouter() };
});

const ID: string = "11111111-1111-4111-8111-111111111111";

let server: IdentityServer;
let fake: FakeEnterpriseModule;
let scimDatabaseReads: Array<jest.SpyInstance> = [];

interface HttpAnswer {
  status: number;
  body: string;
}

const request: (method: string, path: string) => Promise<HttpAnswer> = async (
  method: string,
  path: string,
): Promise<HttpAnswer> => {
  const response: globalThis.Response = await fetch(
    `${server.baseUrl}${path}`,
    {
      method,
      redirect: "manual",
    },
  );

  return { status: response.status, body: await response.text() };
};

const expectNoScimDatabaseRead: () => void = (): void => {
  for (const spy of scimDatabaseReads) {
    expect(spy).not.toHaveBeenCalled();
  }
};

beforeAll(async () => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  stubSsoDatabaseReads();
  stubRenderedViews();

  setTestBillingEnabled(false);

  fake = installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
    identityRouters: IdentityArea.getIdentityRouters!() as Array<ExpressRouter>,
  });

  server = await startIdentityServer();
});

beforeEach(() => {
  for (const spy of scimDatabaseReads) {
    spy.mockRestore();
  }

  scimDatabaseReads = [
    jest.spyOn(ProjectSCIMService, "findOneBy"),
    jest.spyOn(StatusPageSCIMService, "findOneBy"),
  ].map((spy: jest.SpyInstance): jest.SpyInstance => {
    return spy.mockImplementation(() => {
      throw new Error("the database must not be reached");
    });
  });
});

afterAll(async () => {
  await server.close();
  EnterpriseEdition.resetForTests();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a lapsed license: SCIM refuses over HTTP, single sign-on keeps answering", () => {
  beforeEach(() => {
    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
  });

  test.each([
    ["GET", `/scim/v2/${ID}/ServiceProviderConfig`],
    ["GET", `/api/identity/scim/v2/${ID}/Users`],
    ["POST", `/scim/v2/${ID}/Groups`],
    ["DELETE", `/status-page-scim/v2/${ID}/Users/${ID}`],
    ["GET", `/api/identity/status-page-scim/v2/${ID}/Users`],
  ])(
    "SCIM %s %s: 403 with a SCIM error body",
    async (method: string, path: string) => {
      const answer: HttpAnswer = await request(method, path);

      expect(answer.status).toBe(403);
      expect(JSON.parse(answer.body)).toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "403",
        detail: SCIM_UNAVAILABLE_MESSAGE,
      });
      expectNoScimDatabaseRead();
    },
  );

  test.each([
    ["license expired past grace", createLicenseSnapshotWithStatus("expired")],
    ["no license after the trial", createLicenseSnapshotWithStatus("missing")],
    ["invalid license", createLicenseSnapshotWithStatus("invalid")],
    [
      "valid license without SCIM or audit logs",
      createLicenseSnapshotWithStatus("valid", { features: [] }),
    ],
  ])(
    "%s: every SSO route answers with its own handler, at both prefixes",
    async (_label: string, snapshot: EnterpriseLicenseSnapshot) => {
      fake.setSnapshot(snapshot);

      await expectEverySsoProbeAnswered(server.baseUrl);
    },
  );

  test("the SSO answers do not ask the license", async () => {
    const reads: Array<jest.SpyInstance> = [
      jest.spyOn(EnterpriseEdition, "isFeatureActive"),
      jest.spyOn(fake.licensing, "getCachedSnapshot"),
      jest.spyOn(fake.licensing, "getSnapshot"),
    ];

    await expectEverySsoProbeAnswered(server.baseUrl);

    for (const spy of reads) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  test("an unknown path is still a 404 (the gates add no catch-all)", async () => {
    expect((await request("GET", `/scim/v2/${ID}/NoSuchResource`)).status).toBe(
      404,
    );
    expect((await request("GET", "/identity-not-a-route")).status).toBe(404);
  });
});

describe("renewed, or unknown: the same mounted routes reach their handlers again", () => {
  test.each([
    ["renewed (valid)", "valid"],
    ["renewed into grace", "grace"],
    ["not read yet (unknown)", null],
  ])("%s", async (_label: string, status: string | null) => {
    fake.setSnapshot(
      status === null
        ? null
        : createLicenseSnapshotWithStatus(status as "valid" | "grace"),
    );

    const scim: HttpAnswer = await request(
      "GET",
      `/scim/v2/${ID}/ServiceProviderConfig`,
    );

    // Reached the SCIM bearer-token check, past the license gate.
    expect(scim.status).not.toBe(403);
    expect(scim.body).toContain(
      "Bearer token is required for SCIM authentication",
    );
    expectNoScimDatabaseRead();

    // Single sign-on answers exactly as it did while the license was lapsed.
    await expectEverySsoProbeAnswered(server.baseUrl);
  });

  test("lapse and renewal alternate on the same server without a restart", async () => {
    const path: string = `/status-page-scim/v2/${ID}/Users`;

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
    expect((await request("GET", path)).status).not.toBe(403);

    fake.setSnapshot(createLicenseSnapshotWithStatus("invalid"));
    expect((await request("GET", path)).status).toBe(403);

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
    expect((await request("GET", path)).body).toContain(
      "Bearer token is required for SCIM authentication",
    );
  });

  test("billing on (the Cloud) ignores the license: SCIM and SSO are served", async () => {
    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
    setTestBillingEnabled(true);

    try {
      const scim: HttpAnswer = await request(
        "GET",
        `/scim/v2/${ID}/ServiceProviderConfig`,
      );

      expect(scim.body).toContain(
        "Bearer token is required for SCIM authentication",
      );

      await expectEverySsoProbeAnswered(server.baseUrl);
    } finally {
      setTestBillingEnabled(false);
    }
  });
});
