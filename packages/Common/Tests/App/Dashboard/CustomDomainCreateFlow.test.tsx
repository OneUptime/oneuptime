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
 * Domains): real ModelTable, ModelFormModal, ModelForm and EntityDropdown,
 * with only the network stubbed. Every test runs on every page.
 *
 *   - Create opens one page: Subdomain, Domain, and the certificate
 *     options folded under Advanced. No steps (the dashboard form walked
 *     two, Basic and More).
 *   - Domain offers the project's verified domains only: the list the
 *     form fetches and the dropdown's own search both ask for
 *     isVerified = true, and an unverified domain is never on the menu.
 *   - Create adds the domain as before (the verified domain's id, the
 *     subdomain, the status page, dashboard or form), and the new domain's
 *     DNS Setup opens at once, with the record to add.
 *   - A refusal about the subdomain (a name in use) or the domain (no
 *     longer verified) is said under that field, once; any other stays
 *     over the form.
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
      create: async (): Promise<unknown> => {
        return { data: {} };
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
import { FormType } from "../../../UI/Components/Forms/ModelForm";
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
  createButton: string;
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
    createButton: "Create Status Page Domain",
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
    createButton: "Create Dashboard Domain",
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
    createButton: "Create Form Domain",
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

async function openDomainMenu(modal: HTMLElement): Promise<HTMLElement> {
  const input: HTMLElement = await within(modal).findByRole("combobox", {
    name: /^Domain/,
  });

  await act(async (): Promise<void> => {
    fireEvent.focus(input);
  });

  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 30);
    });
  });

  return screen.getByTestId("entity-dropdown-menu");
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
          data: domains.map((row: { _id: string; domain: string }) => {
            const model: Domain = new Domain();
            model._id = row._id;
            model.domain = row.domain as never;
            return model;
          }),
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

    // The server answers a create with the new row, its full domain worked out.
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
    domainRowsForTest = [];
    jest.restoreAllMocks();
  });

  async function openCreateForm(): Promise<HTMLElement> {
    render(<page.Page {...pageProps} />);

    const createButton: HTMLElement = await waitFor(
      (): HTMLElement => {
        const button: HTMLElement | undefined = screen
          .getAllByTestId("card-button")
          .find((candidate: HTMLElement): boolean => {
            return (candidate.textContent || "").includes(page.createButton);
          });

        if (!button) {
          throw new Error(`No ${page.createButton} button yet`);
        }

        return button;
      },
      { timeout: 10000 },
    );

    fireEvent.click(createButton);

    const modal: HTMLElement = await screen.findByTestId("modal");

    await within(modal).findByPlaceholderText(page.subdomainPlaceholder);
    await act(async (): Promise<void> => {});

    return modal;
  }

  test("the form is one page: Subdomain, Domain, and the certificate options folded under Advanced", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(
      within(modal).getByPlaceholderText(page.subdomainPlaceholder),
    ).toBeVisible();
    expect(
      within(modal).getByRole("combobox", { name: /^Domain/ }),
    ).toBeInTheDocument();

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

    // The link to where a domain is added, beside the field.
    const link: HTMLElement = within(modal).getByRole("link", {
      name: "Add a domain",
    });
    expect(link.getAttribute("href")).toContain(
      `/dashboard/${PROJECT_ID}/settings/domains`,
    );
  });

  test("Domain offers verified domains only, whichever list fills it", async () => {
    const modal: HTMLElement = await openCreateForm();

    const menu: HTMLElement = await openDomainMenu(modal);

    expect(domainListRequests().length).toBeGreaterThanOrEqual(2);

    for (const request of domainListRequests()) {
      expect(request.query).toEqual(
        expect.objectContaining({ isVerified: true }),
      );
    }

    const options: Array<string> = within(menu)
      .getAllByRole("option")
      .map((option: HTMLElement) => {
        return option.textContent?.trim() || "";
      });

    expect(options).toEqual(["acme.com"]);
    expect(within(menu).queryByText("not-verified-yet.com")).toBeNull();
  });

  test("Create adds the domain as before, and its DNS Setup opens at once", async () => {
    const modal: HTMLElement = await openCreateForm();

    fireEvent.change(
      within(modal).getByPlaceholderText(page.subdomainPlaceholder),
      { target: { value: page.subdomain } },
    );

    const menu: HTMLElement = await openDomainMenu(modal);

    await act(async (): Promise<void> => {
      fireEvent.click(within(menu).getByRole("option", { name: "acme.com" }));
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", {
          name: page.createButton,
        }),
      );
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.formType).toBe(FormType.Create);
    expect(request.modelType).toBe(page.modelType);
    expect(request.model.subdomain).toBe(page.subdomain);
    expect(request.model.domain?._id?.toString()).toBe(VERIFIED_DOMAIN_ID);
    expect(request.model[page.parentColumn]?.toString()).toBe(PARENT_ID);
    expect(request.model.projectId?.toString()).toBe(PROJECT_ID);
    // Left as it starts: the free certificate.
    expect(Boolean(request.model.isCustomCertificate)).toBe(false);

    // The DNS Setup of the new domain, in place of the create form.
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
    expect(
      within(dnsSetup).getByRole("button", { name: "Check now" }),
    ).toBeInTheDocument();
  });

  async function fillAndCreate(modal: HTMLElement): Promise<void> {
    fireEvent.change(
      within(modal).getByPlaceholderText(page.subdomainPlaceholder),
      { target: { value: page.subdomain } },
    );

    const menu: HTMLElement = await openDomainMenu(modal);

    await act(async (): Promise<void> => {
      fireEvent.click(within(menu).getByRole("option", { name: "acme.com" }));
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", {
          name: page.createButton,
        }),
      );
    });
  }

  // The nearest box that holds both: a field's own, or the whole form's.
  function boxHoldingBoth(first: HTMLElement, second: HTMLElement): Element {
    let box: Element | null = first.parentElement;

    while (box && !box.contains(second)) {
      box = box.parentElement;
    }

    expect(box).not.toBeNull();
    return box!;
  }

  /*
   * A name another status page, dashboard or form already has used to be
   * said in red over the whole form, while the subdomain to change sat
   * under it: now it is said under the subdomain, once.
   */
  test("a name already in use is said under Subdomain, and changing the subdomain puts it away", async () => {
    const fullDomain: string = `${page.subdomain}.acme.com`;
    const inUse: string = `${fullDomain} is already in use: a domain can show only one status page, dashboard or form. Choose another subdomain, or remove ${fullDomain} where it is used first.`;

    createOrUpdateMock.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(400, { message: inUse }, {});
    });

    const modal: HTMLElement = await openCreateForm();

    await fillAndCreate(modal);

    await waitFor(() => {
      expect(within(modal).getAllByText(inUse)).toHaveLength(1);
    });

    const subdomain: HTMLElement = within(modal).getByPlaceholderText(
      page.subdomainPlaceholder,
    );
    // The Domain field, by the link beside its title (picked, it is a button).
    const domain: HTMLElement = within(modal).getByRole("link", {
      name: "Add a domain",
    });

    expect(subdomain).toHaveAttribute("aria-invalid", "true");

    // Under the subdomain: the box holding both is its own, not the form's.
    expect(
      boxHoldingBoth(within(modal).getByText(inUse), subdomain).contains(
        domain,
      ),
    ).toBe(false);

    // The form stays, for another subdomain: no DNS Setup for a domain not added.
    expect(within(modal).queryByRole("heading", { name: "DNS Setup" })).toBe(
      null,
    );

    fireEvent.change(subdomain, { target: { value: "help" } });

    expect(within(modal).queryByText(inUse)).toBeNull();
  });

  test("a domain that is no longer verified is said under Domain", async () => {
    const notVerified: string =
      "This domain is not verified. Please verify it in Project Settings > Advanced > Domains.";

    createOrUpdateMock.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(400, { message: notVerified }, {});
    });

    const modal: HTMLElement = await openCreateForm();

    await fillAndCreate(modal);

    await waitFor(() => {
      expect(within(modal).getAllByText(notVerified)).toHaveLength(1);
    });

    const subdomain: HTMLElement = within(modal).getByPlaceholderText(
      page.subdomainPlaceholder,
    );
    // The Domain field, by the link beside its title (picked, it is a button).
    const domain: HTMLElement = within(modal).getByRole("link", {
      name: "Add a domain",
    });

    expect(
      boxHoldingBoth(within(modal).getByText(notVerified), domain).contains(
        subdomain,
      ),
    ).toBe(false);
  });

  test("an answer about neither field stays over the form", async () => {
    const unreachable: string =
      "We could not reach OneUptime. Check your connection and try again.";

    createOrUpdateMock.mockImplementation(async (): Promise<never> => {
      throw new HTTPErrorResponse(500, { message: unreachable }, {});
    });

    const modal: HTMLElement = await openCreateForm();

    await fillAndCreate(modal);

    await waitFor(() => {
      expect(within(modal).getAllByText(unreachable)).toHaveLength(1);
    });

    // Over the form: the box holding it and the subdomain holds Domain too.
    expect(
      boxHoldingBoth(
        within(modal).getByText(unreachable),
        within(modal).getByPlaceholderText(page.subdomainPlaceholder),
      ).contains(within(modal).getByRole("link", { name: "Add a domain" })),
    ).toBe(true);
    expect(
      within(modal).getByPlaceholderText(page.subdomainPlaceholder),
    ).not.toHaveAttribute("aria-invalid", "true");
  });

  /*
   * The name is fixed once the domain is added, so the certificate is all
   * an edit can change: Edit shows its options at once. Folded under More
   * fields, as on Create, they left the Edit dialog with a fold's line and
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
      within(modal).queryByPlaceholderText(page.subdomainPlaceholder),
    ).toBeNull();
    expect(
      within(modal).queryByRole("combobox", { name: /^Domain/ }),
    ).toBeNull();
    expect(
      within(modal).queryByRole("link", { name: "Add a domain" }),
    ).toBeNull();
  });

  test("leaving Domain empty is refused on the form, and nothing is created", async () => {
    const modal: HTMLElement = await openCreateForm();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", {
          name: page.createButton,
        }),
      );
    });

    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    });

    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(within(modal).getByText(/Domain is required/)).toBeInTheDocument();
  });
});
