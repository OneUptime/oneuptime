import ProjectOidcAPI from "../../../Server/API/ProjectOIDC";
import ProjectSsoAPI from "../../../Server/API/ProjectSSO";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import { EnterpriseLicenseStatus } from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
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
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import { mockRouter } from "./Helpers";
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
 * Design v2 section 0: the SAML/OIDC login routes are served only when the
 * Enterprise Edition is loaded - whatever its license says. So:
 *   - Enterprise Edition (any license state, any billing): providers are
 *     listed as configured, and a status page's SSO requirement is reported.
 *   - Community Edition: every list is empty and the status page reports no
 *     SSO, so no client sends a user into a route that answers 404. Nothing
 *     is even read from the provider tables.
 *
 * Billing and the edition are pinned in every test.
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

const ENTERPRISE_STATUSES: ReadonlyArray<EnterpriseLicenseStatus> = [
  "valid",
  "grace",
  "expired",
  "missing",
  "invalid",
];

type EditionCase = {
  label: string;
  billing: boolean;
  install: () => void;
  isLoaded: boolean;
};

const EDITION_CASES: Array<EditionCase> = [];

for (const billing of [false, true]) {
  EDITION_CASES.push({
    label: `Community Edition, billing=${billing}`,
    billing,
    install: (): void => {
      uninstallEnterpriseModule();
    },
    isLoaded: false,
  });

  for (const status of ENTERPRISE_STATUSES) {
    EDITION_CASES.push({
      label: `Enterprise Edition, ${status} license, billing=${billing}`,
      billing,
      install: (): void => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus(status),
        });
      },
      isLoaded: true,
    });
  }
}

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

describe("SSO provider listings and status page SSO flags, by edition", () => {
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

  describe.each(
    EDITION_CASES.map((editionCase: EditionCase): [string, EditionCase] => {
      return [editionCase.label, editionCase];
    }),
  )("%s", (_label: string, editionCase: EditionCase) => {
    beforeEach(() => {
      setTestBillingEnabled(editionCase.billing);
      editionCase.install();
    });

    test(`project SSO list ${editionCase.isLoaded ? "lists the enabled providers" : "is empty"}`, async () => {
      await invoke({
        route: PROJECT_SSO_ROUTE,
        params: { projectId: PROJECT_ID.toString() },
      });

      expect(listedItems()).toHaveLength(editionCase.isLoaded ? 1 : 0);

      if (editionCase.isLoaded) {
        expect(projectSsoFind).toHaveBeenCalledWith(
          expect.objectContaining({
            query: { projectId: PROJECT_ID, isEnabled: true },
            props: { isRoot: true },
          }),
        );
      } else {
        expect(projectSsoFind).not.toHaveBeenCalled();
      }
    });

    test(`project OIDC list ${editionCase.isLoaded ? "lists the enabled providers" : "is empty"}`, async () => {
      await invoke({
        route: PROJECT_OIDC_ROUTE,
        params: { projectId: PROJECT_ID.toString() },
      });

      expect(listedItems()).toHaveLength(editionCase.isLoaded ? 1 : 0);
      expect(projectOidcFind).toHaveBeenCalledTimes(
        editionCase.isLoaded ? 1 : 0,
      );
    });

    test(`status page SSO list ${editionCase.isLoaded ? "lists the enabled providers" : "is empty"}`, async () => {
      await invoke({
        route: STATUS_PAGE_SSO_ROUTE,
        params: { statusPageId: STATUS_PAGE_ID.toString() },
      });

      expect(listedItems()).toHaveLength(editionCase.isLoaded ? 1 : 0);
      expect(statusPageSsoFind).toHaveBeenCalledTimes(
        editionCase.isLoaded ? 1 : 0,
      );
    });

    test(`status page OIDC list ${editionCase.isLoaded ? "lists the enabled providers" : "is empty"}`, async () => {
      await invoke({
        route: STATUS_PAGE_OIDC_ROUTE,
        params: { statusPageId: STATUS_PAGE_ID.toString() },
      });

      expect(listedItems()).toHaveLength(editionCase.isLoaded ? 1 : 0);
      expect(statusPageOidcFind).toHaveBeenCalledTimes(
        editionCase.isLoaded ? 1 : 0,
      );
    });

    test(`master page ${editionCase.isLoaded ? "reports the stored SSO requirement and providers" : "reports no SSO (effective value) and leaves the stored value alone"}`, async () => {
      const statusPage: StatusPage = new StatusPage();
      statusPage.id = STATUS_PAGE_ID;
      statusPage.pageTitle = "Customer Status";
      statusPage.requireSsoForLogin = true;

      const findStatusPage: SpyInstance = getJestSpyOn(
        StatusPageService,
        "findOneById",
      ).mockResolvedValue(statusPage);
      getJestSpyOn(StatusPageFooterLinkService, "findBy").mockResolvedValue([]);
      getJestSpyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);
      getJestSpyOn(StatusPageDomainService, "findOneBy").mockResolvedValue(
        null,
      );

      await invoke({
        route: MASTER_PAGE_ROUTE,
        params: { statusPageId: STATUS_PAGE_ID.toString() },
      });

      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

      const payload: JSONObject = (Response.sendJsonObjectResponse as jest.Mock)
        .mock.calls[0]![2] as JSONObject;

      expect((payload["statusPage"] as JSONObject)["requireSsoForLogin"]).toBe(
        editionCase.isLoaded,
      );
      expect(payload["hasEnabledSSO"]).toBe(editionCase.isLoaded ? 2 : 0);
      expect(statusPageSsoCount).toHaveBeenCalledTimes(
        editionCase.isLoaded ? 1 : 0,
      );

      // The stored requirement is still read, never written.
      expect(findStatusPage).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ requireSsoForLogin: true }),
          props: { isRoot: true },
        }),
      );
    });
  });

  test("the master page reports a page that does not require SSO the same way on both editions", async () => {
    const statusPage: StatusPage = new StatusPage();
    statusPage.id = STATUS_PAGE_ID;
    statusPage.requireSsoForLogin = false;

    getJestSpyOn(StatusPageService, "findOneById").mockResolvedValue(
      statusPage,
    );
    getJestSpyOn(StatusPageFooterLinkService, "findBy").mockResolvedValue([]);
    getJestSpyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);
    getJestSpyOn(StatusPageDomainService, "findOneBy").mockResolvedValue(null);

    installFakeEnterpriseModule();

    await invoke({
      route: MASTER_PAGE_ROUTE,
      params: { statusPageId: STATUS_PAGE_ID.toString() },
    });

    const payload: JSONObject = (Response.sendJsonObjectResponse as jest.Mock)
      .mock.calls[0]![2] as JSONObject;

    expect((payload["statusPage"] as JSONObject)["requireSsoForLogin"]).toBe(
      false,
    );
  });
});
