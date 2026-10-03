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
 * ADD A CUSTOM DOMAIN, on the real Status Pages > <page> > Custom Domains
 * page - real ModelTable, ModelFormModal, ModelForm and EntityDropdown -
 * with only the network stubbed.
 *
 *   - Create opens one page: Subdomain, Domain, and the certificate
 *     options folded under Advanced. No steps.
 *   - Domain offers the project's verified domains only: the list the
 *     form fetches and the dropdown's own search both ask for
 *     isVerified = true, and an unverified domain is never on the menu.
 *   - Create adds the domain as before (the verified domain's id, the
 *     subdomain, the status page), and the new domain's DNS Setup opens at
 *     once, with the record to add.
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

  return mocked;
});

const getListMock: MockFunction = getJestMockFunction();
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
      getItem: async (): Promise<null> => {
        return null;
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
const STATUS_PAGE_ID: string = "0e000000-0000-4000-8000-000000000002";
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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { DNS_SETUP_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/CustomDomain/StatusPageCustomDomainCopy";
import Domain from "../../../Models/DatabaseModels/Domain";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
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

const pageProps: PageComponentProps = {
  pageRoute: new Route(
    `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/domains`,
  ),
  hasPaymentMethod: true,
  currentProject: { _id: PROJECT_ID },
} as unknown as PageComponentProps;

type ListRequest = {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
};

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

beforeEach(() => {
  holding([Permission.ProjectOwner]);
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/domains`,
  );

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(STATUS_PAGE_ID),
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

    // The status page has no custom domain yet.
    return { data: [], count: 0, skip: 0, limit: 10 };
  });

  // The server answers a create with the new row, its full domain worked out.
  createOrUpdateMock.mockImplementation(async (): Promise<any> => {
    return {
      data: {
        _id: NEW_DOMAIN_ID,
        fullDomain: "status.acme.com",
        subdomain: "status",
        isCustomCertificate: false,
        isCnameVerified: false,
      },
    };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
});

async function openCreateForm(): Promise<HTMLElement> {
  render(<StatusPageDomains {...pageProps} />);

  const createButton: HTMLElement = await waitFor(
    (): HTMLElement => {
      const button: HTMLElement | undefined = screen
        .getAllByTestId("card-button")
        .find((candidate: HTMLElement): boolean => {
          return (candidate.textContent || "").includes(
            "Create Status Page Domain",
          );
        });

      if (!button) {
        throw new Error("No Create Status Page Domain button yet");
      }

      return button;
    },
    { timeout: 10000 },
  );

  fireEvent.click(createButton);

  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByPlaceholderText("status (leave blank for root)");
  await act(async (): Promise<void> => {});

  return modal;
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

describe("adding a status page custom domain", () => {
  test("the form is one page: Subdomain, Domain, and the certificate options folded under Advanced", async () => {
    const modal: HTMLElement = await openCreateForm();

    expect(
      within(modal).getByPlaceholderText("status (leave blank for root)"),
    ).toBeVisible();
    expect(
      within(modal).getByRole("combobox", { name: /^Domain/ }),
    ).toBeInTheDocument();

    const advanced: HTMLElement = within(modal).getByRole("button", {
      name: /^Advanced/,
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
      within(modal).getByPlaceholderText("status (leave blank for root)"),
      { target: { value: "status" } },
    );

    const menu: HTMLElement = await openDomainMenu(modal);

    await act(async (): Promise<void> => {
      fireEvent.click(within(menu).getByRole("option", { name: "acme.com" }));
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", {
          name: "Create Status Page Domain",
        }),
      );
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createOrUpdateMock.mock.calls[0]![0];

    expect(request.formType).toBe(FormType.Create);
    expect(request.modelType).toBe(StatusPageDomain);
    expect(request.model.subdomain).toBe("status");
    expect(request.model.domain?._id?.toString()).toBe(VERIFIED_DOMAIN_ID);
    expect(request.model.statusPageId?.toString()).toBe(STATUS_PAGE_ID);
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
    ).toHaveTextContent("status.acme.com");
    expect(
      within(dnsSetup).getByTestId(DNS_SETUP_TEST_IDS.recordValue),
    ).toHaveTextContent("statuspage.oneuptime.com");
    expect(
      within(dnsSetup).getByRole("button", { name: "Check now" }),
    ).toBeInTheDocument();
  });

  test("leaving Domain empty is refused on the form, and nothing is created", async () => {
    const modal: HTMLElement = await openCreateForm();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", {
          name: "Create Status Page Domain",
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
