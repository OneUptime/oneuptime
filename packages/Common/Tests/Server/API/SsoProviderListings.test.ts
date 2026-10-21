import ProjectOidcAPI from "../../../Server/API/ProjectOIDC";
import ProjectSsoAPI from "../../../Server/API/ProjectSSO";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import StatusPageOidcService from "../../../Server/Services/StatusPageOidcService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSsoService from "../../../Server/Services/StatusPageSsoService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageOIDC from "../../../Models/DatabaseModels/StatusPageOidc";
import StatusPageSSO from "../../../Models/DatabaseModels/StatusPageSso";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import { mockRouter } from "./Helpers";
import logger from "../../../Server/Utils/Logger";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * The provider lists that sign-in pages offer, and the status page's own
 * "should I force SSO / offer SSO" flags.
 *
 * Single sign-on is part of the Community Edition: the SAML/OIDC sign-in
 * routes answer in every edition, so in EVERY edition and license state - the
 * Community Edition (billing off and on), the Enterprise Edition licensed, in
 * its trial or grace, lapsed, with a license that leaves SCIM and audit logs
 * out, or in an unknown license state, and OneUptime Cloud - these routes
 * list the enabled providers, and the master page reports the stored "Require
 * SSO for login" and the real number of enabled SAML providers. Nothing here
 * asks the license.
 *
 * Billing and the edition are pinned in every test. This suite runs without
 * ee/: it uses the fake enterprise module only.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const PROJECT_SSO_ROUTE: string = `${new ProjectSSO()
  .getCrudApiPath()
  ?.toString()}/:projectId/sso-list`;
const PROJECT_OIDC_ROUTE: string = `${new ProjectOIDC()
  .getCrudApiPath()
  ?.toString()}/:projectId/oidc-list`;
const STATUS_PAGE_SSO_ROUTE: string = "/status-page/sso/:statusPageId";
const STATUS_PAGE_OIDC_ROUTE: string = "/status-page/oidc/:statusPageId";
const MASTER_PAGE_ROUTE: string = "/status-page/master-page/:statusPageId";

const EDITION_CASES: Array<EditionStateCase> = createEditionStateCases();

const buildProjectSso: () => ProjectSSO = (): ProjectSSO => {
  const sso: ProjectSSO = new ProjectSSO();
  sso._id = ObjectID.generate().toString();
  sso.name = "Okta";
  return sso;
};

const buildProjectOidc: () => ProjectOIDC = (): ProjectOIDC => {
  const oidc: ProjectOIDC = new ProjectOIDC();
  oidc._id = ObjectID.generate().toString();
  oidc.name = "Entra ID";
  return oidc;
};

const buildStatusPageSso: () => StatusPageSSO = (): StatusPageSSO => {
  const sso: StatusPageSSO = new StatusPageSSO();
  sso._id = ObjectID.generate().toString();
  sso.name = "Okta";
  return sso;
};

const buildStatusPageOidc: () => StatusPageOIDC = (): StatusPageOIDC => {
  const oidc: StatusPageOIDC = new StatusPageOIDC();
  oidc._id = ObjectID.generate().toString();
  oidc.name = "Entra ID";
  return oidc;
};

const invoke: (data: {
  route: string;
  params: Record<string, string>;
}) => Promise<void> = async (data: {
  route: string;
  params: Record<string, string>;
}): Promise<void> => {
  const headers: Record<string, string> = { host: "app.example.com" };

  const req: ExpressRequest = {
    params: data.params,
    query: {},
    body: {},
    cookies: {},
    headers,
    get: (name: string): string | undefined => {
      return headers[name.toLowerCase()];
    },
    socket: {},
    ips: [],
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("post", data.route).handlerFunction(req, res, next);

  expect(next).not.toHaveBeenCalled();
};

const listedItems: () => Array<unknown> = (): Array<unknown> => {
  expect(Response.sendEntityArrayResponse).toHaveBeenCalledTimes(1);

  const call: Array<unknown> = (Response.sendEntityArrayResponse as jest.Mock)
    .mock.calls[0] as Array<unknown>;

  const items: Array<unknown> = call[2] as Array<unknown>;
  const count: PositiveNumber = call[3] as PositiveNumber;

  expect(count.toNumber()).toBe(items.length);

  return items;
};

// The master page's payload for a status page as stored.
const readMasterPage: (stored: {
  requireSsoForLogin: boolean;
}) => Promise<JSONObject> = async (stored: {
  requireSsoForLogin: boolean;
}): Promise<JSONObject> => {
  const statusPage: StatusPage = new StatusPage();
  statusPage.id = STATUS_PAGE_ID;
  statusPage.pageTitle = "Customer Status";
  statusPage.requireSsoForLogin = stored.requireSsoForLogin;

  getJestSpyOn(StatusPageService, "findOneById").mockResolvedValue(statusPage);
  getJestSpyOn(StatusPageFooterLinkService, "findBy").mockResolvedValue([]);
  getJestSpyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);
  getJestSpyOn(StatusPageDomainService, "findOneBy").mockResolvedValue(null);

  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  await invoke({
    route: MASTER_PAGE_ROUTE,
    params: { statusPageId: STATUS_PAGE_ID.toString() },
  });

  expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

  return (Response.sendJsonObjectResponse as jest.Mock).mock
    .calls[0]![2] as JSONObject;
};

describe("SSO provider listings and status page SSO flags in every edition", () => {
  const originalHost: string | undefined = process.env["HOST"];

  let projectSsoFind: SpyInstance;
  let projectOidcFind: SpyInstance;
  let statusPageSsoFind: SpyInstance;
  let statusPageOidcFind: SpyInstance;
  let statusPageSsoCount: SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new ProjectSsoAPI();
    new ProjectOidcAPI();
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env["HOST"] = "app.example.com";
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
    getJestSpyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    getJestSpyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    projectSsoFind = getJestSpyOn(
      ProjectSsoService,
      "findBy",
    ).mockResolvedValue([buildProjectSso()]);
    projectOidcFind = getJestSpyOn(
      ProjectOidcService,
      "findBy",
    ).mockResolvedValue([buildProjectOidc()]);
    statusPageSsoFind = getJestSpyOn(
      StatusPageSsoService,
      "findBy",
    ).mockResolvedValue([buildStatusPageSso()]);
    statusPageOidcFind = getJestSpyOn(
      StatusPageOidcService,
      "findBy",
    ).mockResolvedValue([buildStatusPageOidc()]);
    statusPageSsoCount = getJestSpyOn(
      StatusPageSsoService,
      "countBy",
    ).mockResolvedValue(new PositiveNumber(2));
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();

    if (originalHost === undefined) {
      delete process.env["HOST"];
    } else {
      process.env["HOST"] = originalHost;
    }
  });

  test("the cases include the Community Edition, lapsed Enterprise licenses and the Cloud", () => {
    expect(
      EDITION_CASES.filter((editionCase: EditionStateCase): boolean => {
        return !editionCase.isLoaded;
      }),
    ).toHaveLength(2);
    expect(
      EDITION_CASES.filter((editionCase: EditionStateCase): boolean => {
        return editionCase.isLoaded && !editionCase.isActive;
      }).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      EDITION_CASES.filter((editionCase: EditionStateCase): boolean => {
        return editionCase.isLoaded && editionCase.billing;
      }).length,
    ).toBeGreaterThan(0);
  });

  describe.each(
    EDITION_CASES.map(
      (editionCase: EditionStateCase): [string, EditionStateCase] => {
        return [editionCase.label, editionCase];
      },
    ),
  )("%s", (_label: string, editionCase: EditionStateCase) => {
    beforeEach(() => {
      editionCase.apply();
    });

    test("the project SSO list lists the enabled providers", async () => {
      await invoke({
        route: PROJECT_SSO_ROUTE,
        params: { projectId: PROJECT_ID.toString() },
      });

      expect(listedItems()).toHaveLength(1);
      expect(projectSsoFind).toHaveBeenCalledTimes(1);
      expect(projectSsoFind).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { projectId: PROJECT_ID, isEnabled: true },
          select: { name: true, description: true, _id: true },
          props: { isRoot: true },
        }),
      );
    });

    test("the project OIDC list lists the enabled providers", async () => {
      await invoke({
        route: PROJECT_OIDC_ROUTE,
        params: { projectId: PROJECT_ID.toString() },
      });

      expect(listedItems()).toHaveLength(1);
      expect(projectOidcFind).toHaveBeenCalledTimes(1);
      expect(projectOidcFind).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { projectId: PROJECT_ID, isEnabled: true },
          props: { isRoot: true },
        }),
      );
    });

    test("the status page SSO list lists the enabled providers", async () => {
      await invoke({
        route: STATUS_PAGE_SSO_ROUTE,
        params: { statusPageId: STATUS_PAGE_ID.toString() },
      });

      expect(listedItems()).toHaveLength(1);
      expect(statusPageSsoFind).toHaveBeenCalledTimes(1);
      expect(statusPageSsoFind).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { statusPageId: STATUS_PAGE_ID, isEnabled: true },
          props: { isRoot: true },
        }),
      );
    });

    test("the status page OIDC list lists the enabled providers", async () => {
      await invoke({
        route: STATUS_PAGE_OIDC_ROUTE,
        params: { statusPageId: STATUS_PAGE_ID.toString() },
      });

      expect(listedItems()).toHaveLength(1);
      expect(statusPageOidcFind).toHaveBeenCalledTimes(1);
      expect(statusPageOidcFind).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { statusPageId: STATUS_PAGE_ID, isEnabled: true },
          props: { isRoot: true },
        }),
      );
    });

    test("an empty provider table is an empty list", async () => {
      projectSsoFind.mockResolvedValue([]);

      await invoke({
        route: PROJECT_SSO_ROUTE,
        params: { projectId: PROJECT_ID.toString() },
      });

      expect(listedItems()).toEqual([]);
    });

    test("the master page reports the stored SSO requirement and the enabled providers", async () => {
      const payload: JSONObject = await readMasterPage({
        requireSsoForLogin: true,
      });

      expect((payload["statusPage"] as JSONObject)["requireSsoForLogin"]).toBe(
        true,
      );
      expect(payload["hasEnabledSSO"]).toBe(2);
      expect(statusPageSsoCount).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { isEnabled: true, statusPageId: STATUS_PAGE_ID },
          props: { isRoot: true },
        }),
      );
      expect(StatusPageService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ requireSsoForLogin: true }),
          props: { isRoot: true },
        }),
      );
    });

    test("the master page reports a page that does not require SSO, with no providers, as such", async () => {
      statusPageSsoCount.mockResolvedValue(new PositiveNumber(0));

      const payload: JSONObject = await readMasterPage({
        requireSsoForLogin: false,
      });

      expect((payload["statusPage"] as JSONObject)["requireSsoForLogin"]).toBe(
        false,
      );
      expect(payload["hasEnabledSSO"]).toBe(0);
    });
  });

  test("license changes never empty the lists or hide the requirement", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("valid"),
    });

    for (const snapshot of [
      createLicenseSnapshotWithStatus("expired"),
      createLicenseSnapshotWithStatus("valid"),
      createLicenseSnapshotWithStatus("invalid"),
      createLicenseSnapshot({ features: [] }),
      null,
    ]) {
      fake.setSnapshot(snapshot);
      (Response.sendEntityArrayResponse as jest.Mock).mockClear();

      await invoke({
        route: PROJECT_SSO_ROUTE,
        params: { projectId: PROJECT_ID.toString() },
      });

      expect(listedItems()).toHaveLength(1);

      const payload: JSONObject = await readMasterPage({
        requireSsoForLogin: true,
      });

      expect((payload["statusPage"] as JSONObject)["requireSsoForLogin"]).toBe(
        true,
      );
      expect(payload["hasEnabledSSO"]).toBe(2);
    }

    expect(projectSsoFind).toHaveBeenCalledTimes(5);
  });

  test("no listing asks the enterprise facade", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });
    const isFeatureActive: SpyInstance = getJestSpyOn(
      EnterpriseEdition,
      "isFeatureActive",
    );

    for (const [route, params] of [
      [PROJECT_SSO_ROUTE, { projectId: PROJECT_ID.toString() }],
      [PROJECT_OIDC_ROUTE, { projectId: PROJECT_ID.toString() }],
      [STATUS_PAGE_SSO_ROUTE, { statusPageId: STATUS_PAGE_ID.toString() }],
      [STATUS_PAGE_OIDC_ROUTE, { statusPageId: STATUS_PAGE_ID.toString() }],
    ] as Array<[string, Record<string, string>]>) {
      await invoke({ route, params });
    }

    await readMasterPage({ requireSsoForLogin: true });

    expect(isFeatureActive).not.toHaveBeenCalled();
  });
});
