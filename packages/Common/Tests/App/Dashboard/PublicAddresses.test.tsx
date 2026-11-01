import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Every address a status page, a public dashboard or a form answers at
 * (Components/CustomDomain/PublicAddresses): the list a status page's
 * Overview draws in its Status Page Link card, a dashboard's Sharing page
 * under its public choice, and a form's Share page in its Share Link card.
 *
 * The Overview used to show one underlined monospace address on OneUptime's
 * own domain, whatever custom domains the page had, and nothing said whether
 * status.acme.com worked yet. Now:
 *
 *   - the custom domains come first: each live one a link to
 *     https://<domain>, opened in a new tab, with Copy link; each one not
 *     live yet with no link, "Not live yet" and why - the Custom Domains
 *     page's words - with DNS Setup, that page's own dialog, when there is
 *     something to do;
 *   - then the OneUptime address, which always works;
 *   - with no custom domain, a quiet line offers to add one - only to
 *     whoever may add one, where the installation serves custom domains;
 *   - the domains are read only for whoever may read them; a read that
 *     fails leaves the OneUptime address, says so, and can be tried again.
 *
 * Only the network, the clipboard, the permission gate and the browser's
 * config are replaced; the list, its rows, the DNS Setup dialog and the
 * shared buttons are the real ones.
 */

let mockCnameRecord: string = "statuspage.oneuptime.com";
// Whether the installation issues free certificates: yes unless a test says.
let mockIssuesFreeCertificates: boolean = true;

/*
 * Getters defined on the copy, not in an object literal: the compiled
 * spread copies a literal's getter once, as a value.
 */
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  const cnameRecord: PropertyDescriptor = {
    get: (): string => {
      return mockCnameRecord;
    },
  };

  Object.defineProperty(mocked, "StatusPageCNameRecord", cnameRecord);
  Object.defineProperty(mocked, "DashboardCNameRecord", cnameRecord);
  Object.defineProperty(mocked, "FormCNameRecord", cnameRecord);
  Object.defineProperty(mocked, "CUSTOM_DOMAIN_FREE_CERTIFICATES", {
    get: (): boolean => {
      return mockIssuesFreeCertificates;
    },
  });

  return mocked;
});

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the list catches it.
 */
const getListMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();
const copyMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "the-project" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>): unknown => {
        return apiGetMock(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string })?.message || "Server Error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Clipboard", () => {
  return {
    __esModule: true,
    default: {
      copyToClipboard: (...args: Array<unknown>): unknown => {
        return copyMock(...args);
      },
    },
  };
});

import PublicAddresses from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/PublicAddresses";
import PublicAddressCopy, {
  PUBLIC_ADDRESS_TEST_IDS,
  PublicAddressKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/PublicAddressCopy";
import {
  CUSTOM_DOMAIN_STATUS,
  CustomDomainCopy,
  CustomDomainState,
  DNS_SETUP_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import {
  CustomDomainKind,
  CustomDomainModel,
  DASHBOARD_CUSTOM_DOMAINS,
  FORM_CUSTOM_DOMAINS,
  STATUS_PAGE_CUSTOM_DOMAINS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainKinds";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import CustomDomainCertificates, {
  CustomDomainCertificate,
} from "../../../Types/CustomDomain/CustomDomainCertificates";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { APP_API_URL, HTTP_PROTOCOL } from "../../../UI/Config";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "7a7a7a7a-0000-4000-8000-0000000000aa";
const PARENT_ID: string = "7b7b7b7b-0000-4000-8000-0000000000bb";
const OTHER_PARENT_ID: string = "7c7c7c7c-0000-4000-8000-0000000000cc";
const DAY: number = 24 * 60 * 60 * 1000;

interface KindCase {
  name: string;
  kind: CustomDomainKind;
  parentColumn: string;
  oneUptimeUrl: string;
  customDomainsRoute: string;
  example: string;
  certificatesPath: string;
  verifyPath: string;
}

const KINDS: Array<KindCase> = [
  {
    name: "a status page",
    kind: STATUS_PAGE_CUSTOM_DOMAINS,
    parentColumn: "statusPageId",
    oneUptimeUrl: `https://oneuptime.com/status-page/${PARENT_ID}`,
    customDomainsRoute: `/dashboard/${PROJECT_ID}/status-pages/${PARENT_ID}/domains`,
    example: "status.example.com",
    certificatesPath: `/status-page-domain/certificates/${PARENT_ID}`,
    verifyPath: "/status-page-domain/verify-cname/",
  },
  {
    name: "a dashboard",
    kind: DASHBOARD_CUSTOM_DOMAINS,
    parentColumn: "dashboardId",
    oneUptimeUrl: `https://oneuptime.com/public-dashboard/${PARENT_ID}`,
    customDomainsRoute: `/dashboard/${PROJECT_ID}/dashboards/${PARENT_ID}/custom-domains`,
    example: "dashboard.example.com",
    certificatesPath: `/dashboard-domain/certificates/${PARENT_ID}`,
    verifyPath: "/dashboard-domain/verify-cname/",
  },
  {
    name: "a form",
    kind: FORM_CUSTOM_DOMAINS,
    parentColumn: "formId",
    // A form's link names its share key; any address does for the list.
    oneUptimeUrl: `https://oneuptime.com/accounts/form/${PARENT_ID}`,
    customDomainsRoute: `/dashboard/${PROJECT_ID}/forms/${PARENT_ID}/custom-domains`,
    example: "report.example.com",
    certificatesPath: `/form-domain/certificates/${PARENT_ID}`,
    verifyPath: "/form-domain/verify-cname/",
  },
];

const STATUS_PAGE: KindCase = KINDS[0]!;

type DomainState =
  | "live"
  | "dns"
  | "issuing"
  | "unordered"
  | "failed"
  | "expired"
  | "uploaded"
  | "renewal";

interface StoredDomain {
  id: string;
  fullDomain: string;
  state: DomainState;
}

let domains: Array<StoredDomain> | Error = [];
let certificatesAnswer: "ok" | "refused" | "throws" = "ok";
let gates: Record<ModelAction, PermissionGateResult> = {
  [ModelAction.Create]: { isAllowed: true },
  [ModelAction.Read]: { isAllowed: true },
  [ModelAction.Update]: { isAllowed: true },
  [ModelAction.Delete]: { isAllowed: true },
};
let hasSnapshot: boolean = true;
let currentKind: KindCase = STATUS_PAGE;

function domainId(index: number): string {
  return `7d7d7d7d-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// The row a stored domain reads as, from where it is on its way to HTTPS.
function row(stored: StoredDomain): CustomDomainModel {
  const model: CustomDomainModel = new currentKind.kind.modelType();
  model._id = stored.id;
  model.fullDomain = stored.fullDomain;
  model.subdomain = stored.fullDomain.split(".")[0] || "";
  model.isCnameVerified = stored.state !== "dns";
  model.isSslOrdered = !["dns", "unordered", "uploaded"].includes(stored.state);
  model.isSslProvisioned = ["live", "expired", "renewal"].includes(
    stored.state,
  );
  model.isCustomCertificate = stored.state === "uploaded";
  return model;
}

// Its certificate, as the certificates route answers.
function certificateOf(
  stored: StoredDomain,
): CustomDomainCertificate | undefined {
  const now: number = Date.now();

  switch (stored.state) {
    case "live":
      return { domainId: stored.id, expiresAt: new Date(now + 60 * DAY) };
    case "issuing":
      return { domainId: stored.id };
    case "failed":
      return {
        domainId: stored.id,
        lastOrderError: "CAA record forbids letsencrypt.org",
      };
    case "expired":
      return { domainId: stored.id, expiresAt: new Date(now - DAY) };
    case "renewal":
      return {
        domainId: stored.id,
        expiresAt: new Date(now + 10 * DAY),
        lastOrderError: "Timeout during connect",
      };
    default:
      return undefined;
  }
}

function storedDomains(): Array<StoredDomain> {
  return domains instanceof Error ? [] : domains;
}

function response(data: JSONObject): unknown {
  return {
    isFailure: (): boolean => {
      return false;
    },
    data: data,
  };
}

function refusedResponse(message: string): unknown {
  return {
    isFailure: (): boolean => {
      return true;
    },
    message: message,
  };
}

beforeEach(() => {
  domains = [];
  certificatesAnswer = "ok";
  gates = {
    [ModelAction.Create]: { isAllowed: true },
    [ModelAction.Read]: { isAllowed: true },
    [ModelAction.Update]: { isAllowed: true },
    [ModelAction.Delete]: { isAllowed: true },
  };
  hasSnapshot = true;
  mockCnameRecord = "statuspage.oneuptime.com";
  mockIssuesFreeCertificates = true;
  currentKind = STATUS_PAGE;

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    if (domains instanceof Error) {
      throw domains;
    }

    const rows: Array<CustomDomainModel> = domains.map(row);

    return { data: rows, count: rows.length, skip: 0, limit: rows.length };
  });

  apiGetMock.mockReset();
  apiGetMock.mockImplementation(async (...args: Array<unknown>) => {
    const url: string = (
      args[0] as { url: { toString: () => string } }
    ).url.toString();

    if (url.includes("/verify-cname/")) {
      return response({ certificateStatus: "Issuing" });
    }

    if (certificatesAnswer === "throws") {
      throw new Error("The server is down");
    }

    if (certificatesAnswer === "refused") {
      return refusedResponse("Refused");
    }

    return response(
      CustomDomainCertificates.toJSON(
        storedDomains()
          .map(certificateOf)
          .filter(
            (
              certificate: CustomDomainCertificate | undefined,
            ): certificate is CustomDomainCertificate => {
              return Boolean(certificate);
            },
          ),
      ),
    );
  });

  copyMock.mockReset();
  copyMock.mockImplementation(async (): Promise<boolean> => {
    return true;
  });

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (_model: unknown, action: unknown): PermissionGateResult => {
      return gates[action as ModelAction];
    },
  );

  getJestSpyOn(PermissionGate, "hasPermissionSnapshot").mockImplementation(
    (): boolean => {
      return hasSnapshot;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function addresses(
  kindCase: KindCase,
  parentId: string = PARENT_ID,
  note?: ReactElement,
): ReactElement {
  return (
    <PublicAddresses
      kind={kindCase.kind}
      parentId={new ObjectID(parentId)}
      oneUptimeUrl={URL.fromString(
        kindCase.oneUptimeUrl.split(PARENT_ID).join(parentId),
      )}
      customDomainsRoute={new Route(kindCase.customDomainsRoute)}
      exampleDomain={kindCase.example}
      note={note}
    />
  );
}

async function renderList(
  kindCase: KindCase = STATUS_PAGE,
  note?: ReactElement,
): Promise<void> {
  currentKind = kindCase;

  await act(async (): Promise<void> => {
    render(addresses(kindCase, PARENT_ID, note));
  });

  await flush();
}

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId(PUBLIC_ADDRESS_TEST_IDS.row);
}

function rowFor(address: string): HTMLElement {
  const found: HTMLElement | undefined = rows().find(
    (element: HTMLElement): boolean => {
      return element.getAttribute("data-address") === address;
    },
  );

  expect([address, Boolean(found)]).toEqual([address, true]);

  return found!;
}

// Each row as "live|not live <address>", in order.
function listed(): Array<string> {
  return rows().map((element: HTMLElement): string => {
    return `${element.getAttribute("data-live") === "true" ? "live" : "not live"} ${element.getAttribute("data-address")}`;
  });
}

function oneUptimeText(kindCase: KindCase): string {
  return kindCase.oneUptimeUrl.replace("https://", "");
}

/*
 * A request's address, built from the API's own: CI runs with
 * HOST=localhost, a local run with the default host.
 */
function apiUrl(route: string): string {
  return URL.fromString(APP_API_URL.toString()).addRoute(route).toString();
}

describe.each(KINDS)("the addresses of $name", (kindCase: KindCase) => {
  test("with no custom domain: the OneUptime address, to open and copy, and a quiet line to add a domain", async () => {
    await renderList(kindCase);

    expect(listed()).toEqual([`live ${oneUptimeText(kindCase)}`]);

    const only: HTMLElement = rows()[0]!;

    expect(only).toHaveAttribute("data-kind", PublicAddressKind.OneUptime);
    expect(only).toHaveTextContent(PublicAddressCopy.oneUptimeAddress);

    const link: HTMLElement = within(only).getByRole("link");

    expect(link).toHaveAttribute("href", kindCase.oneUptimeUrl);
    expect(link).toHaveAttribute("target", "_blank");
    // The address, and - for screen readers - that it leaves the Dashboard.
    expect(link.textContent).toBe(
      `${oneUptimeText(kindCase)} ${PublicAddressCopy.opensInNewTab}`,
    );
    expect(link.querySelector(".sr-only")).toHaveTextContent(
      PublicAddressCopy.opensInNewTab,
    );

    const add: HTMLElement = screen.getByTestId(
      PUBLIC_ADDRESS_TEST_IDS.addCustomDomain,
    );

    expect(add).toHaveTextContent(
      `Use your own domain, such as ${kindCase.example}. Add a custom domain`,
    );
    expect(
      within(add).getByRole("link", {
        name: PublicAddressCopy.addCustomDomainLink,
      }),
    ).toHaveAttribute("href", kindCase.customDomainsRoute);
    expect(within(add).getByRole("link")).not.toHaveAttribute("target");

    // No domain: no certificate to ask about.
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  test("reads the page's own custom domains, in this project, sorted by name, with the columns a row needs", async () => {
    await renderList(kindCase);

    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
      limit: number;
      skip: number;
    } = getListMock.mock.calls[0]![0] as {
      modelType: unknown;
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
      limit: number;
      skip: number;
    };

    expect(request.modelType).toBe(kindCase.kind.modelType);
    expect(Object.keys(request.query).sort()).toEqual(
      ["projectId", kindCase.parentColumn].sort(),
    );
    expect(String(request.query["projectId"])).toBe(PROJECT_ID);
    expect(String(request.query[kindCase.parentColumn])).toBe(PARENT_ID);
    expect(request.select).toEqual({
      _id: true,
      fullDomain: true,
      subdomain: true,
      isCnameVerified: true,
      isSslOrdered: true,
      isSslProvisioned: true,
      isCustomCertificate: true,
    });
    expect(request.sort).toEqual({ fullDomain: SortOrder.Ascending });
    expect(request.skip).toBe(0);
    expect(request.limit).toBeGreaterThanOrEqual(1000);
  });

  test("a live custom domain comes first: a link to https://<domain> in a new tab, with Copy link", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "live" },
    ];

    await renderList(kindCase);

    expect(listed()).toEqual([
      "live status.acme.com",
      `live ${oneUptimeText(kindCase)}`,
    ]);

    const domainRow: HTMLElement = rowFor("status.acme.com");

    expect(domainRow).toHaveAttribute(
      "data-kind",
      PublicAddressKind.CustomDomain,
    );
    expect(domainRow).toHaveTextContent(PublicAddressCopy.customDomain);

    const link: HTMLElement = within(domainRow).getByRole("link");

    // The domain's root, over HTTPS.
    expect(link).toHaveAttribute("href", "https://status.acme.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.textContent).toBe(
      `status.acme.com ${PublicAddressCopy.opensInNewTab}`,
    );

    const copy: HTMLElement = within(domainRow).getByRole("button", {
      name: "Copy link to status.acme.com",
    });

    expect(copy).toHaveTextContent(PublicAddressCopy.copyLink);

    await act(async () => {
      fireEvent.click(copy);
    });
    await flush();

    expect(copyMock).toHaveBeenCalledWith("https://status.acme.com");
    expect(copy).toHaveTextContent(PublicAddressCopy.copied);

    // Its certificate is read, by its own route, to tell issued from expired.
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    const certificates: { url: { toString: () => string } } = apiGetMock.mock
      .calls[0]![0] as { url: { toString: () => string } };

    expect(certificates.url.toString()).toBe(apiUrl(kindCase.certificatesPath));

    // A page with a custom domain is not offered one more.
    expect(
      screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.addCustomDomain),
    ).not.toBeInTheDocument();
  });

  test("Copy link on the OneUptime address copies the whole address", async () => {
    await renderList(kindCase);

    await act(async () => {
      fireEvent.click(
        within(rows()[0]!).getByRole("button", {
          name: `Copy link to ${oneUptimeText(kindCase)}`,
        }),
      );
    });
    await flush();

    expect(copyMock).toHaveBeenCalledWith(kindCase.oneUptimeUrl);
  });

  test("a custom domain waiting for DNS: no link, not live yet and why, with DNS Setup", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "dns" },
    ];

    await renderList(kindCase);

    const domainRow: HTMLElement = rowFor("status.acme.com");

    expect(domainRow).toHaveAttribute("data-live", "false");
    expect(within(domainRow).queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(domainRow).queryByRole("button", { name: /Copy/ }),
    ).not.toBeInTheDocument();
    expect(
      within(domainRow).getByTestId(PUBLIC_ADDRESS_TEST_IDS.notLive),
    ).toHaveTextContent(PublicAddressCopy.notLiveYet);
    expect(
      within(domainRow).getByTestId(PUBLIC_ADDRESS_TEST_IDS.reason),
    ).toHaveTextContent(CUSTOM_DOMAIN_STATUS[CustomDomainState.WaitingForDns]);
    expect(
      within(domainRow).getByTestId(PUBLIC_ADDRESS_TEST_IDS.dnsSetup),
    ).toHaveTextContent(CustomDomainCopy.dnsSetupTitle);

    /*
     * Named for its domain, as Copy link is for its address, so a screen
     * reader's list of buttons tells two domains' DNS Setup apart.
     */
    const dnsSetup: HTMLElement = within(domainRow).getByRole("button", {
      name: "DNS Setup for status.acme.com",
    });

    expect(dnsSetup).toBe(
      within(domainRow).getByTestId(PUBLIC_ADDRESS_TEST_IDS.dnsSetup),
    );
    expect(dnsSetup).toHaveAttribute("title", "DNS Setup for status.acme.com");

    // Not verified: its certificate says nothing yet, so it is not read.
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  test("DNS Setup opens the Custom Domains page's own dialog on the domain, and Check now reads the list again", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "dns" },
    ];

    await renderList(kindCase);

    await act(async () => {
      fireEvent.click(screen.getByTestId(PUBLIC_ADDRESS_TEST_IDS.dnsSetup));
    });
    await flush();

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(
      within(dialog).getByTestId(DNS_SETUP_TEST_IDS.recordName),
    ).toHaveTextContent("status.acme.com");
    expect(
      within(dialog).getByTestId(DNS_SETUP_TEST_IDS.recordValue),
    ).toHaveTextContent("statuspage.oneuptime.com");

    // The record is in place now: Check now finds it.
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "issuing" },
    ];

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Check now" }),
      );
    });
    await flush();

    const verify: { url: { toString: () => string } } = apiGetMock.mock
      .calls[0]![0] as { url: { toString: () => string } };

    expect(verify.url.toString()).toBe(
      apiUrl(`${kindCase.verifyPath}${domainId(1)}`),
    );
    expect(
      within(screen.getByTestId("modal")).getByTestId(
        DNS_SETUP_TEST_IDS.verified,
      ),
    ).toBeInTheDocument();

    // The list was read again, behind the dialog, without blinking.
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.loading),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor("status.acme.com")).getByTestId(
        PUBLIC_ADDRESS_TEST_IDS.reason,
      ),
    ).toHaveTextContent(
      CUSTOM_DOMAIN_STATUS[CustomDomainState.IssuingCertificate],
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    await flush();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });
});

describe("each state of a custom domain", () => {
  test.each([
    ["its certificate issued", "live", true, null, false],
    [
      "a renewal that failed, its certificate still valid",
      "renewal",
      true,
      null,
      false,
    ],
    ["an uploaded certificate", "uploaded", true, null, false],
    ["waiting for DNS", "dns", false, CustomDomainState.WaitingForDns, true],
    [
      "waiting for its certificate",
      "issuing",
      false,
      CustomDomainState.IssuingCertificate,
      false,
    ],
    [
      "verified, its certificate not ordered yet",
      "unordered",
      false,
      CustomDomainState.IssuingCertificate,
      true,
    ],
    [
      "an order that keeps failing",
      "failed",
      false,
      CustomDomainState.CertificateFailed,
      true,
    ],
    [
      "an expired certificate",
      "expired",
      false,
      CustomDomainState.CertificateExpired,
      true,
    ],
  ])(
    "%s",
    async (
      _label: string,
      state: string,
      isLive: boolean,
      reason: CustomDomainState | null,
      offersDnsSetup: boolean,
    ) => {
      domains = [
        {
          id: domainId(1),
          fullDomain: "status.acme.com",
          state: state as DomainState,
        },
      ];

      await renderList();

      const domainRow: HTMLElement = rowFor("status.acme.com");

      expect(domainRow).toHaveAttribute("data-live", String(isLive));
      expect(Boolean(within(domainRow).queryByRole("link"))).toBe(isLive);
      expect(
        Boolean(
          within(domainRow).queryByRole("button", {
            name: "Copy link to status.acme.com",
          }),
        ),
      ).toBe(isLive);
      expect(
        Boolean(
          within(domainRow).queryByTestId(PUBLIC_ADDRESS_TEST_IDS.notLive),
        ),
      ).toBe(!isLive);

      if (reason) {
        expect(
          within(domainRow).getByTestId(PUBLIC_ADDRESS_TEST_IDS.reason),
        ).toHaveTextContent(CUSTOM_DOMAIN_STATUS[reason]);
      } else {
        expect(domainRow).toHaveTextContent(PublicAddressCopy.customDomain);
      }

      expect(
        Boolean(
          within(domainRow).queryByTestId(PUBLIC_ADDRESS_TEST_IDS.dnsSetup),
        ),
      ).toBe(offersDnsSetup);
    },
  );

  test("DNS Setup on an expired certificate says it expired, and that Check now tries again", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "expired" },
    ];

    await renderList();

    await act(async () => {
      fireEvent.click(screen.getByTestId(PUBLIC_ADDRESS_TEST_IDS.dnsSetup));
    });
    await flush();

    expect(
      within(screen.getByTestId("modal")).getByTestId(
        DNS_SETUP_TEST_IDS.whatHappensNext,
      ),
    ).toHaveTextContent(CustomDomainCopy.dnsSetupVerifiedExpired);
  });
});

describe("several custom domains", () => {
  test("the live ones first, then those not live yet, each in alphabetical order, then the OneUptime address", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status-old.acme.com", state: "failed" },
      { id: domainId(2), fullDomain: "status.acme.io", state: "uploaded" },
      { id: domainId(3), fullDomain: "status-eu.acme.com", state: "dns" },
      { id: domainId(4), fullDomain: "status.acme.com", state: "live" },
      { id: domainId(5), fullDomain: "status-apac.acme.com", state: "issuing" },
    ];

    await renderList();

    expect(listed()).toEqual([
      "live status.acme.com",
      "live status.acme.io",
      "not live status-apac.acme.com",
      "not live status-eu.acme.com",
      "not live status-old.acme.com",
      `live ${oneUptimeText(STATUS_PAGE)}`,
    ]);

    // The list is named, and is a list.
    const list: HTMLElement = screen.getByRole("list", {
      name: PublicAddressCopy.listLabel,
    });

    expect(within(list).getAllByRole("listitem")).toHaveLength(6);

    // The certificates are read once, for all of them.
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });
});

describe("the certificates", () => {
  test("not read when every domain waits for DNS or serves an uploaded certificate", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "dns" },
      { id: domainId(2), fullDomain: "status.acme.io", state: "uploaded" },
    ];

    await renderList();

    expect(apiGetMock).not.toHaveBeenCalled();
    expect(listed()).toEqual([
      "live status.acme.io",
      "not live status.acme.com",
      `live ${oneUptimeText(STATUS_PAGE)}`,
    ]);
  });

  test.each(["refused", "throws"] as const)(
    "a read that is %s leaves each domain to its own row",
    async (answer: "refused" | "throws") => {
      certificatesAnswer = answer;
      domains = [
        // Provisioned: live by its row, whatever its certificate.
        { id: domainId(1), fullDomain: "status.acme.com", state: "expired" },
        { id: domainId(2), fullDomain: "status-eu.acme.com", state: "issuing" },
      ];

      await renderList();

      expect(listed()).toEqual([
        "live status.acme.com",
        "not live status-eu.acme.com",
        `live ${oneUptimeText(STATUS_PAGE)}`,
      ]);
      expect(
        screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.error),
      ).not.toBeInTheDocument();
    },
  );
});

/*
 * An installation without a Let's Encrypt account key issues no free
 * certificate. Its verified domains read "Not live yet - Issuing a free
 * certificate" for ever here, while the server already linked them in every
 * email (getUsableCustomDomain, rule 3).
 */
describe.each(KINDS)(
  "the addresses of $name, on an installation that issues no free certificates",
  (kindCase: KindCase) => {
    beforeEach(() => {
      mockIssuesFreeCertificates = false;
    });

    afterEach(() => {
      mockIssuesFreeCertificates = true;
    });

    test("a verified domain is live: a link to open, with Copy link", async () => {
      domains = [
        { id: domainId(1), fullDomain: "status.acme.com", state: "unordered" },
        { id: domainId(2), fullDomain: "eu.acme.com", state: "failed" },
        { id: domainId(3), fullDomain: "waiting.acme.com", state: "dns" },
      ];

      await renderList(kindCase);

      expect(listed()).toEqual([
        "live eu.acme.com",
        "live status.acme.com",
        "not live waiting.acme.com",
        `live ${oneUptimeText(kindCase)}`,
      ]);

      const live: HTMLElement = rowFor("status.acme.com");

      expect(
        within(live).getByTestId(PUBLIC_ADDRESS_TEST_IDS.link),
      ).toHaveAttribute("href", `${HTTP_PROTOCOL}status.acme.com`);
      expect(
        within(live).getByRole("button", {
          name: "Copy link to status.acme.com",
        }),
      ).toBeInTheDocument();
      expect(
        within(live).queryByTestId(PUBLIC_ADDRESS_TEST_IDS.notLive),
      ).toBeNull();
    });

    test("no certificate is read: none says where a domain is", async () => {
      domains = [
        { id: domainId(1), fullDomain: "status.acme.com", state: "issuing" },
      ];

      await renderList(kindCase);

      expect(apiGetMock).not.toHaveBeenCalled();
    });

    test("a domain still waiting for DNS keeps its DNS Setup", async () => {
      domains = [
        { id: domainId(1), fullDomain: "waiting.acme.com", state: "dns" },
      ];

      await renderList(kindCase);

      expect(
        within(rowFor("waiting.acme.com")).getByTestId(
          PUBLIC_ADDRESS_TEST_IDS.dnsSetup,
        ),
      ).toBeInTheDocument();
    });
  },
);

describe("who sees what", () => {
  test("someone who may not read the custom domains is not asked about them: the OneUptime address alone, no offer", async () => {
    gates[ModelAction.Read] = {
      isAllowed: false,
      disabledReason: "You need Read Status Page Domain.",
    };
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "live" },
    ];

    await renderList();

    expect(getListMock).not.toHaveBeenCalled();
    expect(apiGetMock).not.toHaveBeenCalled();
    expect(listed()).toEqual([`live ${oneUptimeText(STATUS_PAGE)}`]);
    expect(
      screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.addCustomDomain),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.loading),
    ).not.toBeInTheDocument();
  });

  test("before the permissions have arrived the domains are read anyway: the server has the last word", async () => {
    hasSnapshot = false;
    gates[ModelAction.Read] = { isAllowed: false };
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "live" },
    ];

    await renderList();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(listed()).toEqual([
      "live status.acme.com",
      `live ${oneUptimeText(STATUS_PAGE)}`,
    ]);
  });

  test("someone who may not add a custom domain is not offered one", async () => {
    gates[ModelAction.Create] = {
      isAllowed: false,
      disabledReason: "You need Create Status Page Domain.",
    };

    await renderList();

    expect(listed()).toEqual([`live ${oneUptimeText(STATUS_PAGE)}`]);
    expect(
      screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.addCustomDomain),
    ).not.toBeInTheDocument();
  });

  test("someone who may not edit a domain still gets DNS Setup, with the record and Check now locked", async () => {
    gates[ModelAction.Update] = {
      isAllowed: false,
      disabledReason: "You need Edit Status Page Domain.",
    };
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "dns" },
    ];

    await renderList();

    await act(async () => {
      fireEvent.click(screen.getByTestId(PUBLIC_ADDRESS_TEST_IDS.dnsSetup));
    });
    await flush();

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(
      within(dialog).getByTestId(DNS_SETUP_TEST_IDS.recordName),
    ).toHaveTextContent("status.acme.com");
    expect(
      within(dialog).getByTestId(DNS_SETUP_TEST_IDS.checkNowLocked),
    ).toHaveTextContent("You need Edit Status Page Domain.");
    expect(
      within(dialog).getByRole("button", { name: "Check now" }),
    ).toBeDisabled();
  });

  test("an installation with no custom domains offers none, and still lists any a page has", async () => {
    mockCnameRecord = "";

    await renderList();

    expect(
      screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.addCustomDomain),
    ).not.toBeInTheDocument();

    cleanup();
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "live" },
    ];

    await renderList();

    expect(listed()).toEqual([
      "live status.acme.com",
      `live ${oneUptimeText(STATUS_PAGE)}`,
    ]);
  });
});

describe("while the domains are read, and when they cannot be", () => {
  test("while they are read: the shape of a row, said to screen readers", async () => {
    let finish: () => void = () => {
      // Replaced below.
    };

    getListMock.mockImplementation((): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({ data: [], count: 0, skip: 0, limit: 0 });
        };
      });
    });

    await renderList();

    const loading: HTMLElement = screen.getByTestId(
      PUBLIC_ADDRESS_TEST_IDS.loading,
    );

    expect(loading).toHaveAttribute("role", "status");
    expect(loading).toHaveTextContent(PublicAddressCopy.loading);
    expect(rows()).toHaveLength(0);

    await act(async () => {
      finish();
    });
    await flush();

    expect(
      screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.loading),
    ).not.toBeInTheDocument();
    expect(listed()).toEqual([`live ${oneUptimeText(STATUS_PAGE)}`]);
  });

  test("a read that fails keeps the OneUptime address, says so, and Try again reads them again", async () => {
    domains = new Error("The server is down");

    await renderList();

    expect(listed()).toEqual([`live ${oneUptimeText(STATUS_PAGE)}`]);

    const error: HTMLElement = screen.getByTestId(
      PUBLIC_ADDRESS_TEST_IDS.error,
    );

    expect(error).toHaveTextContent(PublicAddressCopy.loadError);
    // No offer to add a domain while nobody knows whether there is one.
    expect(
      screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.addCustomDomain),
    ).not.toBeInTheDocument();

    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "live" },
    ];

    await act(async () => {
      fireEvent.click(
        within(error).getByRole("button", { name: PublicAddressCopy.tryAgain }),
      );
    });
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(listed()).toEqual([
      "live status.acme.com",
      `live ${oneUptimeText(STATUS_PAGE)}`,
    ]);
    expect(
      screen.queryByTestId(PUBLIC_ADDRESS_TEST_IDS.error),
    ).not.toBeInTheDocument();
  });

  test("the answer for a page left behind is dropped: another page's domains never show here", async () => {
    const answers: Array<(value: unknown) => void> = [];

    getListMock.mockImplementation((): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void) => {
        answers.push(resolve);
      });
    });

    let rerender: (ui: ReactElement) => void = () => {
      // Replaced below.
    };

    await act(async (): Promise<void> => {
      rerender = render(addresses(STATUS_PAGE, PARENT_ID)).rerender;
    });

    await act(async (): Promise<void> => {
      rerender(addresses(STATUS_PAGE, OTHER_PARENT_ID));
    });

    const other: CustomDomainModel = new STATUS_PAGE.kind.modelType();
    other._id = domainId(9);
    other.fullDomain = "status.other.com";
    other.isCnameVerified = false;

    // The other page answers first; the first page's answer comes late.
    await act(async () => {
      answers[1]!({ data: [other], count: 1, skip: 0, limit: 1 });
    });
    await flush();

    const late: CustomDomainModel = new STATUS_PAGE.kind.modelType();
    late._id = domainId(8);
    late.fullDomain = "status.first.com";
    late.isCnameVerified = false;

    await act(async () => {
      answers[0]!({ data: [late], count: 1, skip: 0, limit: 1 });
    });
    await flush();

    expect(listed()).toEqual([
      "not live status.other.com",
      `live oneuptime.com/status-page/${OTHER_PARENT_ID}`,
    ]);
  });
});

describe("a long address", () => {
  test("is cut short to fit its row, with the whole address on hover", async () => {
    const longDomain: string =
      "status-for-the-checkout-and-payments-platform-in-europe-west.acme-commerce.example";

    domains = [{ id: domainId(1), fullDomain: longDomain, state: "live" }];

    await renderList();

    const link: HTMLElement = within(rowFor(longDomain)).getByRole("link");
    const text: HTMLElement = link.querySelector(".truncate") as HTMLElement;

    expect(text).toHaveClass("min-w-0", "truncate");
    expect(text).toHaveAttribute("title", `https://${longDomain}`);

    // The OneUptime address: its host, with the rest of it quieter.
    const oneUptime: HTMLElement = within(
      rowFor(oneUptimeText(STATUS_PAGE)),
    ).getByRole("link");

    expect(oneUptime.querySelector(".truncate")).toHaveAttribute(
      "title",
      STATUS_PAGE.oneUptimeUrl,
    );
    expect(
      within(oneUptime).getByText(`/status-page/${PARENT_ID}`),
    ).toHaveClass("text-gray-500");
  });
});

describe("an address the URL type would refuse", () => {
  /*
   * A label past DNS's 63 characters is refused by Common's URL type: the
   * card used to parse each address into one, and one such name threw and
   * took the whole card down. The address is now opened and copied as
   * stored.
   */
  test("still shows, opens and copies, and the rest of the list with it", async () => {
    const label: string = "a".repeat(64);
    const name: string = `${label}.acme.com`;

    domains = [
      { id: domainId(1), fullDomain: name, state: "live" },
      { id: domainId(2), fullDomain: "status.acme.com", state: "live" },
    ];

    await renderList();

    expect(listed()).toEqual([
      `live ${name}`,
      "live status.acme.com",
      `live ${oneUptimeText(STATUS_PAGE)}`,
    ]);
    expect(within(rowFor(name)).getByRole("link")).toHaveAttribute(
      "href",
      `https://${name}`,
    );

    await act(async () => {
      fireEvent.click(
        within(rowFor(name)).getByRole("button", {
          name: `Copy link to ${name}`,
        }),
      );
    });
    await flush();

    expect(copyMock).toHaveBeenCalledWith(`https://${name}`);
  });

  test("a live address opens in a new tab without handing the new page this one", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "live" },
    ];

    await renderList();

    const link: HTMLElement = within(rowFor("status.acme.com")).getByRole(
      "link",
    );

    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("a note about every address", () => {
  test("sits right under them, before the offer to add a domain", async () => {
    await renderList(
      STATUS_PAGE,
      <p data-testid="the-note">Visitors sign in to see this status page.</p>,
    );

    const note: HTMLElement = screen.getByTestId("the-note");
    const list: HTMLElement = screen.getByTestId(PUBLIC_ADDRESS_TEST_IDS.list);
    const add: HTMLElement = screen.getByTestId(
      PUBLIC_ADDRESS_TEST_IDS.addCustomDomain,
    );

    expect(
      list.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      note.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

/*
 * What the UI review changed in each row, as far as jsdom can tell; the
 * offline browser suite (packages/E2E/PublicAddresses) measures it.
 */
describe("a row's look", () => {
  test("the tile says what kind each address is, is not read out, and gives way to the address on a phone", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "live" },
      { id: domainId(2), fullDomain: "status-eu.acme.com", state: "dns" },
    ];

    await renderList();

    for (const address of [
      "status.acme.com",
      "status-eu.acme.com",
      oneUptimeText(STATUS_PAGE),
    ]) {
      const tile: HTMLElement = within(rowFor(address)).getByTestId(
        PUBLIC_ADDRESS_TEST_IDS.tile,
      );

      expect(tile).toHaveAttribute("aria-hidden", "true");
      // Below sm the address takes its width: the address is what is read.
      expect(tile).toHaveClass("max-sm:hidden");
      // Never the bare class a foreign stylesheet's .hidden would match.
      expect(tile).not.toHaveClass("hidden");
    }

    /*
     * With no tile on a phone, the action under the address needs no
     * indent to line up with it.
     */
    const copy: HTMLElement = within(rowFor("status.acme.com")).getByRole(
      "button",
      { name: "Copy link to status.acme.com" },
    );

    expect(copy.parentElement).not.toHaveClass("pl-11");
  });

  test("a live address is on a line of its own, which holds the link at the width of its words", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "live" },
    ];

    await renderList();

    const link: HTMLElement = within(rowFor("status.acme.com")).getByRole(
      "link",
    );

    /*
     * A flex line: the link inside it is as wide as its words and shrinks
     * to cut a long one short. As a block of its own, the link used to run
     * to the action, so a click on the empty space opened the page.
     */
    expect(link.parentElement).toHaveClass("flex", "min-w-0");
    expect(link).not.toHaveClass("max-w-full");
    expect(link).toHaveClass("min-w-0");
  });

  test("the keyboard's focus ring is drawn inside the link's line, round padding its negative margin gives back", async () => {
    domains = [
      { id: domainId(1), fullDomain: "status.acme.com", state: "live" },
    ];

    await renderList();

    for (const address of ["status.acme.com", oneUptimeText(STATUS_PAGE)]) {
      const link: HTMLElement = within(rowFor(address)).getByRole("link");

      expect(link).toHaveClass(
        "focus:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-inset",
        "focus-visible:ring-indigo-500",
        "px-1",
        "-mx-1",
      );
      // An outer ring's offset painted over the line under the address.
      expect(link).not.toHaveClass("focus-visible:ring-offset-2");
    }
  });
});
