/**
 * @timezone America/New_York
 */
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ADD A CUSTOM DOMAIN, on the real Custom Domains pages - a status page's
 * (Status Pages > <page> > Custom Domains), a dashboard's (Dashboards >
 * <dashboard> > Custom Domains) and a form's (Forms > <form> > Custom
 * Domains): real ModelTable, Add Custom Domain (BasicFormModal) and DNS
 * Setup, with only the network stubbed. Every test runs on every page.
 *
 *   - Add Custom Domain asks for the address people will open, with the
 *     certificate options folded under Advanced. It used to ask for a
 *     subdomain and one of the project's verified domains, with a link out
 *     to Project Settings to add one.
 *   - On a verified domain it adds the custom domain as before (the
 *     domain's id, the subdomain, the status page, dashboard or form), and
 *     the new domain's DNS Setup opens at once, with the record to add.
 *   - On a domain not verified yet, DNS Setup shows its TXT record and the
 *     CNAME, and nothing is added until the TXT is found
 *     (AddCustomDomainModal.test.tsx walks that flow).
 *   - A refusal - a name in use - is said in the dialog, which stays.
 *   - Edit shows the certificate options at once: they are all it changes.
 */

let allPermissionsForTest: Array<string> = [];
let projectPermissionsForTest: unknown = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "StatusPageCNameRecord", {
    get: (): string => {
      return "statuspage.oneuptime.com";
    },
  });

  Object.defineProperty(mocked, "DashboardCNameRecord", {
    get: (): string => {
      return "dashboards.oneuptime.com";
    },
  });

  Object.defineProperty(mocked, "FormCNameRecord", {
    get: (): string => {
      return "forms.oneuptime.com";
    },
  });

  return mocked;
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
    },
  };
});

const PROJECT_ID: string = "0e000000-0000-4000-8000-000000000001";
const PARENT_ID: string = "0e000000-0000-4000-8000-000000000002";
const NEW_DOMAIN_ID: string = "0e000000-0000-4000-8000-000000000003";
const VERIFIED_DOMAIN_ID: string = "0e000000-0000-4000-8000-0000000000aa";
const UNVERIFIED_DOMAIN_ID: string = "0e000000-0000-4000-8000-0000000000bb";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0e000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import StatusPageDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Domains";
import DashboardCustomDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/CustomDomains";
import FormCustomDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/CustomDomains";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { DNS_SETUP_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import Domain from "../../../Models/DatabaseModels/Domain";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import FormDomain from "../../../Models/DatabaseModels/FormDomain";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission, { UserPermission } from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

interface PageCase {
  name: string;
  Page: (props: PageComponentProps) => React.ReactElement;
  path: string;
  modelType: unknown;
  parentColumn: "statusPageId" | "dashboardId" | "formId";
  addressPlaceholder: string;
  subdomainPlaceholder: string;
  subdomain: string;
  cnameRecord: string;
}

const PAGES: Array<PageCase> = [
  {
    name: "a status page",
    Page: StatusPageDomains as (
      props: PageComponentProps,
    ) => React.ReactElement,
    path: `/dashboard/${PROJECT_ID}/status-pages/${PARENT_ID}/domains`,
    modelType: StatusPageDomain,
    parentColumn: "statusPageId",
    addressPlaceholder: "status.example.com",
    subdomainPlaceholder: "status (leave blank for root)",
    subdomain: "status",
    cnameRecord: "statuspage.oneuptime.com",
  },
  {
    name: "a dashboard",
    Page: DashboardCustomDomains as (
      props: PageComponentProps,
    ) => React.ReactElement,
    path: `/dashboard/${PROJECT_ID}/dashboards/${PARENT_ID}/custom-domains`,
    modelType: DashboardDomain,
    parentColumn: "dashboardId",
    addressPlaceholder: "dashboard.example.com",
    subdomainPlaceholder: "dashboard (leave blank for root)",
    subdomain: "dashboard",
    cnameRecord: "dashboards.oneuptime.com",
  },
  {
    name: "a form",
    Page: FormCustomDomains as (
      props: PageComponentProps,
    ) => React.ReactElement,
    path: `/dashboard/${PROJECT_ID}/forms/${PARENT_ID}/custom-domains`,
    modelType: FormDomain,
    parentColumn: "formId",
    addressPlaceholder: "report.example.com",
    subdomainPlaceholder: "report (leave blank for root)",
    subdomain: "report",
    cnameRecord: "forms.oneuptime.com",
  },
];

type ListRequest = {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
};

// The button that opens Add Custom Domain, the same on every page.
const ADD_BUTTON: string = "Add Custom Domain";

// The custom domains the page lists: none, unless a test says.
let domainRowsForTest: Array<unknown> = [];

function domainListRequests(): Array<ListRequest> {
  return getListMock.mock.calls
    .map((call: Array<any>) => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest) => {
      return request.modelType === Domain;
    });
}

function holding(permissions: Array<Permission>): void {
  allPermissionsForTest = permissions;
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

describe.each(PAGES)("adding $name custom domain", (page: PageCase) => {
  const pageProps: PageComponentProps = {
    pageRoute: new Route(page.path),
    hasPaymentMethod: true,
    currentProject: { _id: PROJECT_ID },
  } as unknown as PageComponentProps;

  beforeEach(() => {
    holding([Permission.ProjectOwner]);
    PermissionGate.clearPermissionPropsCache();
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
    window.history.replaceState(window.history.state, "", page.path);

    getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
      new ObjectID(PARENT_ID),
    );

    getListMock.mockImplementation(async (request: any): Promise<any> => {
      if (request.modelType === Domain) {
        // The project's domains: one verified, one not.
        const domains: Array<{
          _id: string;
          domain: string;
          isVerified: boolean;
        }> = [
          { _id: VERIFIED_DOMAIN_ID, domain: "acme.com", isVerified: true },
          {
            _id: UNVERIFIED_DOMAIN_ID,
            domain: "not-verified-yet.com",
            isVerified: false,
          },
        ].filter((row: { isVerified: boolean }) => {
          return (
            request.query?.isVerified === undefined ||
            request.query.isVerified === row.isVerified
          );
        });

        return {
          data: domains.map(
            (row: { _id: string; domain: string; isVerified: boolean }) => {
              const model: Domain = new Domain();
              model._id = row._id;
              model.domain = row.domain as never;
              model.isVerified = row.isVerified;
              model.domainVerificationText = `oneuptime-verification-${row.domain.split(".")[0]}`;
              return model;
            },
          ),
          count: domains.length,
          skip: 0,
          limit: request.limit,
        };
      }

      // The page's custom domains: none yet, unless a test says.
      return {
        data: domainRowsForTest,
        count: domainRowsForTest.length,
        skip: 0,
        limit: 10,
      };
    });

    // A row read on its own (an Edit dialog's): none, unless a test says.
    getItemMock.mockImplementation(async (): Promise<null> => {
      return null;
    });

    // The server readiness notice: nothing to say here (OneUptime Cloud's).
    getJestSpyOn(API, "get").mockResolvedValue({
      isFailure: (): boolean => {
        return true;
      },
    } as never);

    // The server answers a create with the new row, its full domain worked out.
    createMock.mockImplementation(async (): Promise<any> => {
      return {
        data: {
          _id: NEW_DOMAIN_ID,
          fullDomain: `${page.subdomain}.acme.com`,
          subdomain: page.subdomain,
          isCustomCertificate: false,
          isCnameVerified: false,
        },
      };
    });

    createOrUpdateMock.mockImplementation(async (): Promise<any> => {
      return {
        data: {
          _id: NEW_DOMAIN_ID,
          fullDomain: `${page.subdomain}.acme.com`,
          subdomain: page.subdomain,
          isCustomCertificate: false,
          isCnameVerified: false,
        },
      };
    });
  });

  afterEach(() => {
    cleanup();
    getListMock.mockReset();
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    createMock.mockReset();
    domainRowsForTest = [];
    jest.restoreAllMocks();
  });

  async function openAddDialog(): Promise<HTMLElement> {
    render(<page.Page {...pageProps} />);

    const addButton: HTMLElement = await waitFor(
      (): HTMLElement => {
        const button: HTMLElement | undefined = screen
          .getAllByTestId("card-button")
          .find((candidate: HTMLElement): boolean => {
            return (candidate.textContent || "").includes(ADD_BUTTON);
          });

        if (!button) {
          throw new Error(`No ${ADD_BUTTON} button yet`);
        }

        return button;
      },
      { timeout: 10000 },
    );

    fireEvent.click(addButton);

    const modal: HTMLElement = await screen.findByTestId("modal");

    await within(modal).findByPlaceholderText(page.addressPlaceholder);
    await act(async (): Promise<void> => {});

    return modal;
  }

  async function addAddress(modal: HTMLElement, address: string): Promise<void> {
    fireEvent.change(within(modal).getByPlaceholderText(page.addressPlaceholder), {
      target: { value: address },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(within(modal).getByRole("button", { name: "Continue" }));
    });
  }

  test("Add Custom Domain asks for the address, with the certificate options folded under Advanced", async () => {
    const modal: HTMLElement = await openAddDialog();

    expect(
      within(modal).getByPlaceholderText(page.addressPlaceholder),
    ).toBeVisible();

    // No subdomain, no list of verified domains, no link out of the page.
    expect(within(modal).queryByPlaceholderText(page.subdomainPlaceholder)).toBe(
      null,
    );
    expect(within(modal).queryByRole("combobox", { name: /^Domain/ })).toBe(
      null,
    );
    expect(within(modal).queryByRole("link", { name: "Add a domain" })).toBe(
      null,
    );

    const advanced: HTMLElement = within(modal).getByRole("button", {
      name: "More fields",
    });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(
      within(modal).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(
      "We issue a free SSL certificate for this domain and renew it automatically.",
    );

    // No steps, and no Next.
    expect(
      within(modal).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(modal).queryByRole("button", { name: "Next" })).toBeNull();
  });

  test("on a verified domain it adds the custom domain as before, and its DNS Setup opens at once", async () => {
    const modal: HTMLElement = await openAddDialog();

    await addAddress(modal, `${page.subdomain}.acme.com`);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createMock.mock.calls[0]![0];

    expect(request.modelType).toBe(page.modelType);
    expect(request.model.subdomain).toBe(page.subdomain);
    expect(request.model.domainId?.toString()).toBe(VERIFIED_DOMAIN_ID);
    expect(request.model[page.parentColumn]?.toString()).toBe(PARENT_ID);
    expect(request.model.projectId?.toString()).toBe(PROJECT_ID);
    // Left as it starts: the free certificate.
    expect(Boolean(request.model.isCustomCertificate)).toBe(false);

    // The DNS Setup of the new domain, in place of Add Custom Domain.
    const dnsSetup: HTMLElement = await waitFor((): HTMLElement => {
      const dialog: HTMLElement = screen.getByTestId("modal");
      expect(
        within(dialog).getByRole("heading", { name: "DNS Setup" }),
      ).toBeInTheDocument();
      return dialog;
    });

    expect(
      within(dnsSetup).getByTestId(DNS_SETUP_TEST_IDS.recordName),
    ).toHaveTextContent(`${page.subdomain}.acme.com`);
    expect(
      within(dnsSetup).getByTestId(DNS_SETUP_TEST_IDS.recordValue),
    ).toHaveTextContent(page.cnameRecord);
    // One record: the project's domain is verified already.
    expect(
      within(dnsSetup).queryByTestId(DNS_SETUP_TEST_IDS.txtRecord),
    ).toBeNull();
    expect(
      within(dnsSetup).getByRole("button", { name: "Check now" }),
    ).toBeInTheDocument();
  });

  test("on a domain not verified yet, DNS Setup shows its TXT record and the CNAME, and nothing is added yet", async () => {
    const modal: HTMLElement = await openAddDialog();

    await addAddress(modal, `${page.subdomain}.not-verified-yet.com`);

    const dnsSetup: HTMLElement = await waitFor((): HTMLElement => {
      const dialog: HTMLElement = screen.getByTestId("modal");
      expect(
        within(dialog).getByTestId(DNS_SETUP_TEST_IDS.txtRecord),
      ).toBeInTheDocument();
      return dialog;
    });

    expect(
      within(dnsSetup).getByTestId(DNS_SETUP_TEST_IDS.txtRecordName),
    ).toHaveTextContent("not-verified-yet.com");
    expect(
      within(dnsSetup).getByTestId(DNS_SETUP_TEST_IDS.txtRecordValue),
    ).toHaveTextContent("oneuptime-verification-not-verified-yet");
    expect(
      within(dnsSetup).getByTestId(DNS_SETUP_TEST_IDS.recordName),
    ).toHaveTextContent(`${page.subdomain}.not-verified-yet.com`);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("a name already in use is said in the dialog, and no DNS Setup opens for a domain not added", async () => {
    const fullDomain: string = `${page.subdomain}.acme.com`;
    const inUse: string = `${fullDomain} is already in use: a domain can show only one status page, dashboard or form. Choose another subdomain, or remove ${fullDomain} where it is used first.`;

    createMock.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(400, { message: inUse }, {});
    });

    const modal: HTMLElement = await openAddDialog();

    await addAddress(modal, fullDomain);

    await waitFor(() => {
      expect(within(modal).getAllByText(inUse)).toHaveLength(1);
    });

    expect(within(modal).queryByRole("heading", { name: "DNS Setup" })).toBe(
      null,
    );
    expect(
      within(modal).getByPlaceholderText(page.addressPlaceholder),
    ).toBeVisible();
  });

  /*
   * The name is fixed once the domain is added, so the certificate is all
   * an edit can change: Edit shows its options at once. Folded under More
   * fields, as on Add, they left the Edit dialog with a fold's line and
   * nothing else.
   */
  test("Edit shows the certificate options at once, with no fold", async () => {
    const row: any = new (page.modelType as { new (): any })();
    row._id = NEW_DOMAIN_ID;
    row.fullDomain = `${page.subdomain}.acme.com`;
    row.subdomain = page.subdomain;
    row.isCnameVerified = true;
    row.isSslOrdered = true;
    row.isSslProvisioned = true;
    row.isCustomCertificate = false;
    domainRowsForTest = [row];

    getItemMock.mockImplementation(async (): Promise<unknown> => {
      return row;
    });

    render(<page.Page {...pageProps} />);

    const tableRow: HTMLElement = await waitFor(
      (): HTMLElement => {
        const cell: HTMLElement | undefined = screen
          .getAllByText(`${page.subdomain}.acme.com`)
          .find((candidate: HTMLElement): boolean => {
            return Boolean(candidate.closest("tr"));
          });

        if (!cell) {
          throw new Error("No row yet");
        }

        return cell.closest("tr") as HTMLElement;
      },
      { timeout: 10000 },
    );

    fireEvent.click(within(tableRow).getByTestId("row-actions-more-button"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Edit" }),
    );

    const modal: HTMLElement = await screen.findByTestId("modal");

    await within(modal).findByText("Upload Custom Certificate");
    await act(async (): Promise<void> => {});

    expect(within(modal).getByText("Upload Custom Certificate")).toBeVisible();
    expect(
      within(modal).queryByRole("button", { name: "More fields" }),
    ).toBeNull();
    // Nothing of the name, which an edit could not change.
    expect(
      within(modal).queryByPlaceholderText(page.addressPlaceholder),
    ).toBeNull();
    expect(
      within(modal).queryByPlaceholderText(page.subdomainPlaceholder),
    ).toBeNull();
    expect(
      within(modal).queryByRole("combobox", { name: /^Domain/ }),
    ).toBeNull();
  });

  test("leaving the address empty is refused on the form, and nothing is read or added", async () => {
    const modal: HTMLElement = await openAddDialog();
    const domainReads: number = domainListRequests().length;

    await act(async (): Promise<void> => {
      fireEvent.click(within(modal).getByRole("button", { name: "Continue" }));
    });

    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(domainListRequests()).toHaveLength(domainReads);
    expect(within(modal).getByText(/Domain is required/)).toBeInTheDocument();
  });
});
