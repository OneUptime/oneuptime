import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import { ComponentProps as ConfirmModalProps } from "../../../UI/Components/Modal/ConfirmModal";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Filter from "../../../UI/Components/ModelFilter/Filter";
import StatusPageDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Domains";
import DashboardCustomDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/CustomDomains";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  CUSTOM_DOMAIN_STATUS,
  CustomDomainCopy,
  CustomDomainKindCopy,
  CustomDomainState,
  DASHBOARD_CUSTOM_DOMAIN_COPY,
  DNS_SETUP_TEST_IDS,
  STATUS_PAGE_CUSTOM_DOMAIN_COPY,
  STATUS_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import { CustomDomainModel } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainKinds";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import Domain from "../../../Models/DatabaseModels/Domain";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Permission from "../../../Types/Permission";

/*
 * Custom Domains, on a status page (Status Pages > <page> > Custom Domains)
 * and on a dashboard (Dashboards > <dashboard> > Custom Domains): add a
 * domain, the DNS record opens right away, and the free certificate is
 * issued without a button.
 *
 * Putting a status page on your own domain used to take four actions in two
 * places - verify the domain in Project Settings, add the custom domain in
 * two steps, find "Add CNAME" (which added nothing), then find "Order Free
 * SSL" while the Status column said "Action Required: Please order SSL
 * certificate." for an order the worker placed on its own anyway. The
 * dashboard page kept all of that after the status page lost it. Both pages
 * are one table now, and every test here runs on both:
 *
 *   - adding a domain is one page: Subdomain and Domain - verified domains
 *     only, with a link to add one - and the certificate options folded
 *     under Advanced;
 *   - the new domain's DNS Setup dialog opens as soon as it is added;
 *   - DNS Setup (the old Add CNAME) shows until the record is verified;
 *     there is no Order Free SSL; Reissue SSL stays;
 *   - the Status column is the same plain states, with one timing;
 *   - Check now and Reissue SSL change the domain, so somebody who may only
 *     read it sees them locked, with the permission they need.
 *
 * The ModelTable is replaced by a stand-in that renders the page's own
 * Status column and row actions for the rows given, and hands the test the
 * props the page gave it; the DNS Setup dialog is the real one, and so is
 * the Reissue SSL dialog's text.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * Getters defined on the copy, not in an object literal: the compiled
 * spread copies a literal's getter once, as a value. Both kinds read the
 * same record here; one page is rendered at a time.
 */
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  const cnameRecord: PropertyDescriptor = {
    get: (): string => {
      return (globalThis as unknown as { __cnameRecord: string }).__cnameRecord;
    },
  };

  Object.defineProperty(mocked, "StatusPageCNameRecord", cnameRecord);
  Object.defineProperty(mocked, "DashboardCNameRecord", cnameRecord);

  return mocked;
});

let mockRows: Array<CustomDomainModel> = [];
let mockTableProps: ModelTableProps<CustomDomainModel> | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (
      props: ModelTableProps<CustomDomainModel>,
    ): React.ReactElement => {
      mockTableProps = props;

      const statusColumn: { getElement?: unknown } | undefined =
        props.columns.find((column: { title?: string }) => {
          return column.title === "Status";
        });

      const getStatus: (item: CustomDomainModel) => React.ReactElement = (
        statusColumn as {
          getElement: (item: CustomDomainModel) => React.ReactElement;
        }
      ).getElement;

      return (
        <section data-testid={props.id}>
          <p data-testid="card-description">{props.cardProps?.description}</p>
          {mockRows.map((row: CustomDomainModel): React.ReactElement => {
            return (
              <div key={row.fullDomain} data-testid={`row-${row.fullDomain}`}>
                <p data-testid="status">{getStatus(row)}</p>
                {(props.actionButtons || [])
                  .filter(
                    (
                      action: ActionButtonSchema<CustomDomainModel>,
                    ): boolean => {
                      return (
                        !action.isVisible || Boolean(action.isVisible(row))
                      );
                    },
                  )
                  .map(
                    (
                      action: ActionButtonSchema<CustomDomainModel>,
                    ): React.ReactElement => {
                      return (
                        <button
                          key={action.title}
                          disabled={Boolean(action.disabled)}
                          data-tooltip={action.tooltip || ""}
                          onClick={() => {
                            action.onClick(
                              row,
                              () => {},
                              () => {},
                            );
                          }}
                        >
                          {action.title}
                        </button>
                      );
                    },
                  )}
              </div>
            );
          })}
        </section>
      );
    },
  };
});

// The Reissue SSL dialog, reduced to its title, text and submit button.
jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: ConfirmModalProps): React.ReactElement => {
      return (
        <div role="dialog" aria-label={props.title}>
          <h2>{props.title}</h2>
          <div>{props.description}</div>
          <button>{props.submitButtonText}</button>
        </div>
      );
    },
  };
});

interface PageCase {
  name: string;
  Page: React.FunctionComponent<PageComponentProps>;
  modelType: { new (): CustomDomainModel };
  parentColumn: "statusPageId" | "dashboardId";
  cnameRecord: string;
  route: string;
  crudApiPath: string;
  copy: CustomDomainKindCopy;
  cardDescription: string;
  table: {
    id: string;
    name: string;
    userPreferencesKey: string;
    saveFilterTableId: string;
  };
}

const PAGES: Array<PageCase> = [
  {
    name: "a status page",
    Page: StatusPageDomains,
    modelType: StatusPageDomain,
    parentColumn: "statusPageId",
    cnameRecord: "statuspage.oneuptime.com",
    route: "/dashboard/status-pages",
    crudApiPath: "/status-page-domain",
    copy: STATUS_PAGE_CUSTOM_DOMAIN_COPY,
    cardDescription:
      "Serve this status page on your own domain. Point each domain's CNAME record to statuspage.oneuptime.com, and we issue its SSL certificate and renew it for you.",
    table: {
      id: "domains-table",
      name: "Status Page > Domains",
      userPreferencesKey: "status-page-domains-table",
      saveFilterTableId: "status-page-domains-table",
    },
  },
  {
    name: "a dashboard",
    Page: DashboardCustomDomains,
    modelType: DashboardDomain,
    parentColumn: "dashboardId",
    cnameRecord: "dashboards.oneuptime.com",
    route: "/dashboard/dashboards",
    crudApiPath: "/dashboard-domain",
    copy: DASHBOARD_CUSTOM_DOMAIN_COPY,
    cardDescription:
      "Serve this dashboard on your own domain. Point each domain's CNAME record to dashboards.oneuptime.com, and we issue its SSL certificate and renew it for you.",
    table: {
      id: "dashboard-domains-table",
      name: "Dashboard > Domains",
      userPreferencesKey: "dashboard-domains-table",
      saveFilterTableId: "dashboard-domains-table",
    },
  },
];

const UNVERIFIED: string = "unverified.acme.com";
const VERIFIED: string = "verified.acme.com";
const ORDERED: string = "ordered.acme.com";
const PROVISIONED: string = "provisioned.acme.com";
const UPLOADED: string = "uploaded.acme.com";
const PROJECT_ID: ObjectID = ObjectID.generate();
const PARENT_ID: ObjectID = ObjectID.generate();

const ORDER_ERROR: string =
  "Unable to order certificate for failing.acme.com. Please contact support at support@oneuptime.com for more information.";

function setCnameRecord(value: string): void {
  (globalThis as unknown as { __cnameRecord: string }).__cnameRecord = value;
}

// What the signed-in member holds in the project; an admin unless a test says.
let mockPermissions: Array<Permission> = [Permission.ProjectAdmin];

describe.each(PAGES)("Custom Domains on $name", (page: PageCase) => {
  function domain(
    fullDomain: string,
    state: {
      isCnameVerified?: boolean;
      isCustomCertificate?: boolean;
      isSslOrdered?: boolean;
      isSslProvisioned?: boolean;
    },
  ): CustomDomainModel {
    const row: CustomDomainModel = new page.modelType();
    row._id = ObjectID.generate().toString();
    row.fullDomain = fullDomain;
    row.subdomain = fullDomain.split(".")[0] || "";
    row.isCnameVerified = state.isCnameVerified ?? false;
    row.isCustomCertificate = state.isCustomCertificate ?? false;
    row.isSslOrdered = state.isSslOrdered ?? false;
    row.isSslProvisioned = state.isSslProvisioned ?? false;
    return row;
  }

  function renderPage(
    moreRows: Array<CustomDomainModel> = [],
    currentProject: Project | null = null,
  ): void {
    mockRows = [
      domain(UNVERIFIED, {}),
      domain(VERIFIED, { isCnameVerified: true }),
      domain(ORDERED, { isCnameVerified: true, isSslOrdered: true }),
      domain(PROVISIONED, {
        isCnameVerified: true,
        isSslOrdered: true,
        isSslProvisioned: true,
      }),
      domain(UPLOADED, { isCnameVerified: true, isCustomCertificate: true }),
      ...moreRows,
    ];

    render(
      <MemoryRouter>
        <page.Page
          pageRoute={new Route(page.route)}
          currentProject={currentProject}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  }

  function rowOf(fullDomain: string): HTMLElement {
    return screen.getByTestId(`row-${fullDomain}`);
  }

  function statusOf(fullDomain: string): string {
    return within(rowOf(fullDomain)).getByTestId("status").textContent || "";
  }

  function tableProps(): ModelTableProps<CustomDomainModel> {
    expect(mockTableProps).not.toBeNull();
    return mockTableProps!;
  }

  function fieldOf(key: string): ModelField<CustomDomainModel> {
    const field: ModelField<CustomDomainModel> | undefined = (
      tableProps().formFields || []
    ).find((candidate: ModelField<CustomDomainModel>) => {
      return Object.keys(candidate.field || {})[0] === key;
    });

    expect(field).toBeDefined();
    return field!;
  }

  /*
   * The certificates route answers; the table has loaded its rows, which is
   * when the page reads them.
   */
  async function loadCertificates(
    certificates: Array<JSONObject>,
  ): Promise<jest.SpyInstance<any, any>> {
    const get: jest.SpyInstance<any, any> = getJestSpyOn(
      API,
      "get",
    ).mockResolvedValue(
      new HTTPResponse(200, { domains: certificates }, {}) as never,
    );

    await act(async (): Promise<void> => {
      tableProps().onFetchSuccess!(mockRows, mockRows.length);
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    return get;
  }

  function rowNamed(fullDomain: string): CustomDomainModel {
    const row: CustomDomainModel | undefined = mockRows.find(
      (candidate: CustomDomainModel) => {
        return candidate.fullDomain === fullDomain;
      },
    );

    expect(row).toBeDefined();
    return row!;
  }

  function errorOf(fullDomain: string): string | null {
    return (
      within(rowOf(fullDomain)).queryByTestId(STATUS_TEST_IDS.certificateError)
        ?.textContent || null
    );
  }

  beforeEach(() => {
    setCnameRecord(page.cnameRecord);
    mockTableProps = null;
    mockPermissions = [Permission.ProjectAdmin];
    PermissionGate.clearPermissionPropsCache();
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockImplementation((): Array<Permission> => {
        return mockPermissions;
      });
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(PARENT_ID);
    jest
      .spyOn(Navigation, "getCurrentRoute")
      .mockReturnValue(new Route(page.route));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("the table", () => {
    test("lists this page's own domains, under the names it always had", () => {
      renderPage();

      const props: ModelTableProps<CustomDomainModel> = tableProps();

      expect(props.modelType).toBe(page.modelType);
      expect(props.id).toBe(page.table.id);
      expect(props.name).toBe(page.table.name);
      expect(props.userPreferencesKey).toBe(page.table.userPreferencesKey);
      expect(props.saveFilterProps?.tableId).toBe(page.table.saveFilterTableId);

      const query: Record<string, unknown> = props.query as Record<
        string,
        unknown
      >;

      expect(Object.keys(query).sort()).toEqual(
        [page.parentColumn, "projectId"].sort(),
      );
      expect(String(query[page.parentColumn])).toBe(PARENT_ID.toString());
      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    });

    test("a new domain belongs to this page and to the project", async () => {
      const project: Project = new Project();
      project._id = PROJECT_ID.toString();

      renderPage([], project);

      const created: CustomDomainModel = await tableProps().onBeforeCreate!(
        new page.modelType(),
        {},
        {},
      );

      expect(
        String(
          (created as unknown as Record<string, unknown>)[page.parentColumn],
        ),
      ).toBe(PARENT_ID.toString());
      expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
    });

    /*
     * Regression: "CNAME Valid" and "SSL Provisioned" had an empty field,
     * so picking Yes or No filtered nothing.
     */
    test("every filter filters a column", () => {
      renderPage();

      expect(
        tableProps().filters.map((filter: Filter<CustomDomainModel>) => {
          return [filter.title, Object.keys(filter.field || {})];
        }),
      ).toEqual([
        ["Domain", ["fullDomain"]],
        ["CNAME Valid", ["isCnameVerified"]],
        ["SSL Provisioned", ["isSslProvisioned"]],
      ]);
    });
  });

  describe("the Status column", () => {
    test("each state is one plain sentence", () => {
      renderPage();

      expect(statusOf(UNVERIFIED)).toBe(
        "Waiting for DNS: add the CNAME record.",
      );
      expect(statusOf(VERIFIED)).toBe(
        "Issuing a free certificate, usually within 15 minutes.",
      );
      expect(statusOf(ORDERED)).toBe(
        "Issuing a free certificate, usually within 15 minutes.",
      );
      expect(statusOf(PROVISIONED)).toBe(
        "Certificate issued, renews automatically.",
      );
      expect(statusOf(UPLOADED)).toBe("Uses your uploaded certificate.");
    });

    /*
     * The certificate is ordered on its own, so the page never asks for an
     * order - and it gives one timing, where it gave three hours, one hour
     * and thirty minutes.
     */
    test("never asks anyone to order a certificate, and gives one timing", () => {
      renderPage();

      const text: string = document.body.textContent || "";

      expect(text).not.toContain("Action Required");
      expect(text).not.toContain("order SSL");
      expect(text).not.toContain("1 hour");
      expect(text).not.toContain("30 minutes");
      expect(text).not.toContain("3 hours");
    });
  });

  /*
   * What the rows cannot say: an order that keeps failing, a certificate
   * that expired, a renewal that failed. The Status column used to say
   * "Issuing a free certificate, usually within 15 minutes." for a domain
   * whose order had been failing for days, and the reason was only in the
   * worker's log.
   */
  describe("the Status column, with each domain's certificate", () => {
    const FAILING: string = "failing.acme.com";
    const EXPIRED: string = "expired.acme.com";
    const RENEWAL_FAILED: string = "renewal-failed.acme.com";

    function renderWithCertificateTrouble(): void {
      renderPage([
        domain(FAILING, { isCnameVerified: true }),
        domain(EXPIRED, {
          isCnameVerified: true,
          isSslOrdered: true,
          isSslProvisioned: true,
        }),
        domain(RENEWAL_FAILED, {
          isCnameVerified: true,
          isSslOrdered: true,
          isSslProvisioned: true,
        }),
      ]);
    }

    function certificatesOfTheTroubledRows(): Array<JSONObject> {
      return [
        {
          domainId: rowNamed(FAILING)._id as string,
          lastOrderError: ORDER_ERROR,
          lastOrderFailedAt: "2026-10-03T11:00:00.000Z",
        },
        {
          domainId: rowNamed(EXPIRED)._id as string,
          expiresAt: "2026-01-01T00:00:00.000Z",
        },
        {
          domainId: rowNamed(RENEWAL_FAILED)._id as string,
          expiresAt: "2099-01-01T00:00:00.000Z",
          lastOrderError: "Unable to renew.",
          lastOrderFailedAt: "2026-10-03T11:00:00.000Z",
        },
        {
          domainId: rowNamed(PROVISIONED)._id as string,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ];
    }

    test("reads this page's certificates whenever the table loads its rows", async () => {
      renderPage();

      const get: jest.SpyInstance<any, any> = await loadCertificates([]);

      expect(get).toHaveBeenCalledTimes(1);
      expect(String(get.mock.calls[0]![0].url)).toContain(
        `${page.crudApiPath}/certificates/${PARENT_ID.toString()}`,
      );
    });

    test("a domain whose order keeps failing says so, and why", async () => {
      renderWithCertificateTrouble();
      await loadCertificates(certificatesOfTheTroubledRows());

      expect(statusOf(FAILING)).toContain(
        "Could not issue a free certificate yet. We keep trying.",
      );
      expect(statusOf(FAILING)).not.toContain("usually within 15 minutes");
      expect(errorOf(FAILING)).toBe(ORDER_ERROR);
    });

    test("a domain whose certificate has expired says so", async () => {
      renderWithCertificateTrouble();
      await loadCertificates(certificatesOfTheTroubledRows());

      expect(statusOf(EXPIRED)).toBe(
        "Certificate expired. We keep trying to renew it.",
      );
      expect(statusOf(EXPIRED)).not.toContain("Certificate issued");
    });

    test("a served domain whose renewal failed says so, and why", async () => {
      renderWithCertificateTrouble();
      await loadCertificates(certificatesOfTheTroubledRows());

      expect(statusOf(RENEWAL_FAILED)).toContain(
        "Certificate issued, but renewing it failed. We keep trying.",
      );
      expect(errorOf(RENEWAL_FAILED)).toBe("Unable to renew.");
    });

    test("the rest read as before, with no error line", async () => {
      renderWithCertificateTrouble();
      await loadCertificates(certificatesOfTheTroubledRows());

      expect(statusOf(PROVISIONED)).toBe(
        "Certificate issued, renews automatically.",
      );
      expect(statusOf(VERIFIED)).toBe(
        "Issuing a free certificate, usually within 15 minutes.",
      );
      expect(errorOf(PROVISIONED)).toBeNull();
      expect(errorOf(VERIFIED)).toBeNull();
    });

    test("a failing order and an expired certificate offer DNS Setup, whose Check now tries again", async () => {
      renderWithCertificateTrouble();
      await loadCertificates(certificatesOfTheTroubledRows());

      for (const fullDomain of [FAILING, EXPIRED]) {
        expect(
          within(rowOf(fullDomain)).getByRole("button", { name: "DNS Setup" }),
        ).toBeInTheDocument();
      }

      // A served certificate renews again on its own.
      expect(
        within(rowOf(RENEWAL_FAILED)).queryByRole("button", {
          name: "DNS Setup",
        }),
      ).toBeNull();
    });

    test("DNS Setup on an expired certificate's domain says it has expired", async () => {
      renderWithCertificateTrouble();
      await loadCertificates(certificatesOfTheTroubledRows());

      fireEvent.click(
        within(rowOf(EXPIRED)).getByRole("button", { name: "DNS Setup" }),
      );

      expect(
        within(screen.getByTestId("modal")).getByTestId(
          DNS_SETUP_TEST_IDS.whatHappensNext,
        ),
      ).toHaveTextContent(CustomDomainCopy.dnsSetupVerifiedExpired);
    });

    test("when the certificates cannot be read, each row shows what its own flags say", async () => {
      renderWithCertificateTrouble();

      getJestSpyOn(API, "get").mockRejectedValue(new Error("offline") as never);

      await act(async (): Promise<void> => {
        tableProps().onFetchSuccess!(mockRows, mockRows.length);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      });

      expect(statusOf(FAILING)).toBe(
        "Issuing a free certificate, usually within 15 minutes.",
      );
      expect(statusOf(EXPIRED)).toBe(
        "Certificate issued, renews automatically.",
      );
      expect(errorOf(FAILING)).toBeNull();
    });

    /*
     * The table reads the certificates again on every load; an answer that
     * comes back after a newer one must not overwrite it.
     */
    test("an older answer that arrives late does not overwrite a newer one", async () => {
      renderWithCertificateTrouble();

      let answerFirst: (value: unknown) => void = (): void => {};

      getJestSpyOn(API, "get")
        .mockImplementationOnce((() => {
          return new Promise((resolve: (value: unknown) => void) => {
            answerFirst = resolve;
          });
        }) as never)
        .mockResolvedValueOnce(
          new HTTPResponse(
            200,
            { domains: certificatesOfTheTroubledRows() },
            {},
          ) as never,
        );

      await act(async (): Promise<void> => {
        tableProps().onFetchSuccess!(mockRows, mockRows.length);
        tableProps().onFetchSuccess!(mockRows, mockRows.length);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      });

      expect(errorOf(FAILING)).toBe(ORDER_ERROR);

      // The first request's answer, now: nothing failing in it.
      await act(async (): Promise<void> => {
        answerFirst(new HTTPResponse(200, { domains: [] }, {}));
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      });

      expect(errorOf(FAILING)).toBe(ORDER_ERROR);
    });
  });

  describe("the row actions", () => {
    /*
     * And on a verified domain whose certificate is not ordered yet: an
     * order that keeps failing is seen, and retried, from Check now.
     */
    test("DNS Setup shows until the record is verified and the certificate ordered", () => {
      renderPage();

      for (const fullDomain of [UNVERIFIED, VERIFIED]) {
        expect(
          within(rowOf(fullDomain)).getByRole("button", { name: "DNS Setup" }),
        ).toBeInTheDocument();
      }

      for (const fullDomain of [ORDERED, PROVISIONED, UPLOADED]) {
        expect(
          within(rowOf(fullDomain)).queryByRole("button", {
            name: "DNS Setup",
          }),
        ).toBeNull();
      }
    });

    test("there is no Order Free SSL and no Add CNAME, on any row", () => {
      renderPage();

      expect(
        screen.queryByRole("button", { name: "Order Free SSL" }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "Add CNAME" })).toBeNull();
      expect(
        (tableProps().actionButtons || []).map(
          (action: ActionButtonSchema<CustomDomainModel>) => {
            return action.title;
          },
        ),
      ).toEqual(["DNS Setup", "Reissue SSL"]);
    });

    test("Reissue SSL stays, on a domain with a certificate of ours to replace", () => {
      renderPage();

      for (const fullDomain of [ORDERED, PROVISIONED]) {
        expect(
          within(rowOf(fullDomain)).getByRole("button", {
            name: "Reissue SSL",
          }),
        ).toBeInTheDocument();
      }

      for (const fullDomain of [UNVERIFIED, VERIFIED, UPLOADED]) {
        expect(
          within(rowOf(fullDomain)).queryByRole("button", {
            name: "Reissue SSL",
          }),
        ).toBeNull();
      }
    });

    test("Reissue SSL's dialog names this page's kind, says it stays online, and how often", () => {
      renderPage();

      fireEvent.click(
        within(rowOf(PROVISIONED)).getByRole("button", {
          name: "Reissue SSL",
        }),
      );

      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: page.copy.reissueTitle,
      });

      expect(dialog).toHaveTextContent(page.copy.reissueDescription);
      expect(dialog).toHaveTextContent(
        "a reissue can only be requested once every 24 hours.",
      );
      expect(
        within(dialog).getByRole("button", {
          name: "Reissue SSL Certificate",
        }),
      ).toBeInTheDocument();
    });

    test("DNS Setup opens the dialog with that domain's record", () => {
      renderPage();

      fireEvent.click(
        within(rowOf(UNVERIFIED)).getByRole("button", { name: "DNS Setup" }),
      );

      const dialog: HTMLElement = screen.getByTestId("modal");

      expect(
        within(dialog).getByTestId(DNS_SETUP_TEST_IDS.recordName),
      ).toHaveTextContent(UNVERIFIED);
      expect(
        within(dialog).getByTestId(DNS_SETUP_TEST_IDS.recordValue),
      ).toHaveTextContent(page.cnameRecord);
    });

    test("Check now in that dialog asks this page's kind of domain", async () => {
      renderPage();

      const get: jest.SpyInstance<any, any> = getJestSpyOn(
        API,
        "get",
      ).mockResolvedValue(
        new HTTPResponse(200, { certificateStatus: "Issuing" }, {}) as never,
      );

      fireEvent.click(
        within(rowOf(UNVERIFIED)).getByRole("button", { name: "DNS Setup" }),
      );

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(screen.getByTestId("modal")).getByRole("button", {
            name: "Check now",
          }),
        );
      });

      expect(String(get.mock.calls[0]![0].url)).toContain(
        `${page.crudApiPath}/verify-cname/${rowNamed(UNVERIFIED)._id}`,
      );
    });
  });

  /*
   * Check now and Reissue SSL verify the domain and order or replace its
   * certificate, which the server allows only to whoever may edit the
   * domain. The page says so before the click: both are locked for somebody
   * who may only read the domain, with the permission they need, while the
   * record to add and the Status column stay theirs to read.
   */
  describe("who may check and reissue", () => {
    const LOCKED_REASON_START: string = `You do not have permission to update this ${new page.modelType().singularName}.`;

    test("somebody who may only read the domains sees Reissue SSL locked, with the permission they need", () => {
      mockPermissions = [Permission.Viewer];

      renderPage();

      const reissue: HTMLElement = within(rowOf(PROVISIONED)).getByRole(
        "button",
        { name: "Reissue SSL" },
      );

      expect(reissue).toBeDisabled();
      expect(reissue.getAttribute("data-tooltip")).toContain(
        LOCKED_REASON_START,
      );
      expect(reissue.getAttribute("data-tooltip")).toContain(
        "You need one of these permissions:",
      );

      // The table's own permission gate decides Edit; the row keeps DNS Setup.
      expect(
        within(rowOf(UNVERIFIED)).getByRole("button", { name: "DNS Setup" }),
      ).toBeEnabled();
    });

    test("their DNS Setup shows the record, with Check now locked and the reason under it", async () => {
      mockPermissions = [Permission.Viewer];

      const get: jest.SpyInstance<any, any> = getJestSpyOn(
        API,
        "get",
      ).mockResolvedValue(
        new HTTPResponse(200, { certificateStatus: "Issuing" }, {}) as never,
      );

      renderPage();

      fireEvent.click(
        within(rowOf(UNVERIFIED)).getByRole("button", { name: "DNS Setup" }),
      );

      const dialog: HTMLElement = screen.getByTestId("modal");

      expect(
        within(dialog).getByTestId(DNS_SETUP_TEST_IDS.recordValue),
      ).toHaveTextContent(page.cnameRecord);

      const checkNow: HTMLElement = within(dialog).getByRole("button", {
        name: "Check now",
      });

      expect(checkNow).toBeDisabled();
      expect(
        within(dialog).getByTestId(DNS_SETUP_TEST_IDS.checkNowLocked),
      ).toHaveTextContent(LOCKED_REASON_START);

      await act(async (): Promise<void> => {
        fireEvent.click(checkNow);
      });

      expect(get).not.toHaveBeenCalled();
    });

    test.each([
      ["an editor role", [Permission.ProjectMember]],
      ["read and edit on the domain", "own"],
    ])(
      "%s gets Reissue SSL and Check now unlocked",
      (_label: string, held: Array<Permission> | string) => {
        const model: CustomDomainModel = new page.modelType();

        mockPermissions =
          held === "own"
            ? [
                ...model
                  .getReadPermissions()
                  .filter((permission: Permission) => {
                    return permission.startsWith("Read");
                  }),
                ...model
                  .getUpdatePermissions()
                  .filter((permission: Permission) => {
                    return permission.startsWith("Edit");
                  }),
              ]
            : (held as Array<Permission>);

        expect(mockPermissions.length).toBeGreaterThan(0);

        renderPage();

        expect(
          within(rowOf(PROVISIONED)).getByRole("button", {
            name: "Reissue SSL",
          }),
        ).toBeEnabled();

        fireEvent.click(
          within(rowOf(UNVERIFIED)).getByRole("button", { name: "DNS Setup" }),
        );

        const dialog: HTMLElement = screen.getByTestId("modal");

        expect(
          within(dialog).getByRole("button", { name: "Check now" }),
        ).toBeEnabled();
        expect(
          within(dialog).queryByTestId(DNS_SETUP_TEST_IDS.checkNowLocked),
        ).toBeNull();
      },
    );

    test("before the permissions have arrived, DNS Setup offers no Check now rather than a locked one", () => {
      mockPermissions = [];

      renderPage();

      fireEvent.click(
        within(rowOf(UNVERIFIED)).getByRole("button", { name: "DNS Setup" }),
      );

      const dialog: HTMLElement = screen.getByTestId("modal");

      expect(
        within(dialog).getByTestId(DNS_SETUP_TEST_IDS.recordName),
      ).toHaveTextContent(UNVERIFIED);
      expect(
        within(dialog).queryByRole("button", { name: "Check now" }),
      ).toBeNull();
      expect(
        within(dialog).queryByTestId(DNS_SETUP_TEST_IDS.checkNowLocked),
      ).toBeNull();
    });
  });

  describe("adding a domain", () => {
    test("is one page: no steps", () => {
      renderPage();

      expect(tableProps().formSteps || []).toEqual([]);

      for (const field of tableProps().formFields || []) {
        expect(field.stepId).toBeUndefined();
      }
    });

    test("asks for the subdomain and the domain, then the certificate options", () => {
      renderPage();

      expect(
        (tableProps().formFields || []).map(
          (field: ModelField<CustomDomainModel>) => {
            return Object.keys(field.field || {})[0];
          },
        ),
      ).toEqual([
        "subdomain",
        "domain",
        "isCustomCertificate",
        "customCertificate",
        "customCertificateKey",
      ]);
    });

    test("the subdomain's example is this page's own", () => {
      renderPage();

      expect(fieldOf("subdomain").placeholder).toBe(
        page.copy.subdomainPlaceholder,
      );
      expect(fieldOf("subdomain").description).toBe(
        page.copy.subdomainDescription,
      );
    });

    /*
     * The server refuses a domain that is not verified, so listing one only
     * led to "This domain is not verified" after the form was filled in.
     */
    test("Domain lists verified domains only, and links to where a domain is added", () => {
      renderPage();

      const domainField: ModelField<CustomDomainModel> = fieldOf("domain");

      expect(domainField.dropdownModal?.type).toBe(Domain);
      expect(domainField.dropdownModal?.query).toEqual({ isVerified: true });
      expect(domainField.required).toBe(true);
      expect(domainField.description).toBe(
        "Only domains verified in Project Settings → Domains are listed.",
      );
      expect(domainField.sideLink?.text).toBe("Add a domain");
      expect(domainField.sideLink?.url.toString()).toContain(
        `/${PROJECT_ID.toString()}/settings/domains`,
      );
      // A new tab: the form being filled in stays as it is.
      expect(domainField.sideLink?.openLinkInNewTab).toBe(true);
    });

    test("the certificate options are one folded Advanced section", () => {
      renderPage();

      const sections: Array<FormFieldCollapsibleSection<CustomDomainModel>> = [
        "isCustomCertificate",
        "customCertificate",
        "customCertificateKey",
      ].map((key: string) => {
        return fieldOf(key).collapsibleSection!;
      });

      expect(sections[0]).toBeDefined();
      // One section: the same object on each field.
      expect(sections[1]).toBe(sections[0]);
      expect(sections[2]).toBe(sections[0]);
      expect(sections[0]!.title).toBe(MORE_FIELDS_SECTION_TITLE);
      expect(sections[0]!.openWhenConfigured).toBe(false);

      expect(fieldOf("subdomain").collapsibleSection).toBeUndefined();
      expect(fieldOf("domain").collapsibleSection).toBeUndefined();
    });

    test("folded, Advanced says which certificate the domain will use", () => {
      renderPage();

      const section: FormFieldCollapsibleSection<CustomDomainModel> = fieldOf(
        "isCustomCertificate",
      ).collapsibleSection!;

      expect(section.getSummary!({} as FormValues<CustomDomainModel>)).toEqual([
        CustomDomainCopy.advancedSummaryFreeCertificate,
      ]);
      expect(
        section.getSummary!({
          isCustomCertificate: true,
        } as FormValues<CustomDomainModel>),
      ).toEqual([CustomDomainCopy.advancedSummaryUploadedCertificate]);
    });

    test("the switch starts off, as the column does, and the certificate and key are needed only when it is on", () => {
      renderPage();

      expect(fieldOf("isCustomCertificate").defaultValue).toBe(false);

      for (const key of ["customCertificate", "customCertificateKey"]) {
        const field: ModelField<CustomDomainModel> = fieldOf(key);
        const required: (values: FormValues<CustomDomainModel>) => boolean =
          field.required as (values: FormValues<CustomDomainModel>) => boolean;

        expect(
          required({
            isCustomCertificate: true,
          } as FormValues<CustomDomainModel>),
        ).toBe(true);
        expect(
          required({
            isCustomCertificate: false,
          } as FormValues<CustomDomainModel>),
        ).toBe(false);
        expect(
          field.showIf!({
            isCustomCertificate: false,
          } as FormValues<CustomDomainModel>),
        ).toBe(false);
      }
    });

    /*
     * The full domain is worked out when the domain is added and never
     * again, so a subdomain changed on Edit changed nothing on screen.
     */
    test("Edit does not offer the subdomain, which an edit could not change", () => {
      renderPage();

      expect(fieldOf("subdomain").doNotShowWhenEditing).toBe(true);
    });

    test("the new domain's DNS Setup opens as soon as it is added", async () => {
      renderPage();

      const created: CustomDomainModel = domain("new.acme.com", {});

      expect(screen.queryByTestId("modal")).toBeNull();

      await act(async (): Promise<void> => {
        await tableProps().onCreateSuccess!(created, ModalType.Create);
      });

      const dialog: HTMLElement = screen.getByTestId("modal");

      expect(
        within(dialog).getByRole("heading", { name: "DNS Setup" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByTestId(DNS_SETUP_TEST_IDS.recordName),
      ).toHaveTextContent("new.acme.com");
      expect(
        within(dialog).getByRole("button", { name: "Check now" }),
      ).toBeInTheDocument();
    });

    test("saving an edit does not open DNS Setup", async () => {
      renderPage();

      await act(async (): Promise<void> => {
        await tableProps().onCreateSuccess!(
          domain(ORDERED, { isCnameVerified: true }),
          ModalType.Edit,
        );
      });

      expect(screen.queryByTestId("modal")).toBeNull();
    });

    test("a created domain that came back without its name is read again before DNS Setup opens", async () => {
      renderPage();

      const created: CustomDomainModel = new page.modelType();
      created._id = ObjectID.generate().toString();

      const fetched: CustomDomainModel = domain("read-again.acme.com", {});
      fetched._id = created._id;

      const getItem: jest.SpyInstance<any, any> = getJestSpyOn(
        ModelAPI,
        "getItem",
      ).mockResolvedValue(fetched as never);

      await act(async (): Promise<void> => {
        await tableProps().onCreateSuccess!(created, ModalType.Create);
      });

      expect(getItem).toHaveBeenCalledTimes(1);

      const request: { id: ObjectID; modelType: unknown } = getItem.mock
        .calls[0]![0] as { id: ObjectID; modelType: unknown };

      expect(request.id.toString()).toBe(created._id);
      expect(request.modelType).toBe(page.modelType);
      expect(
        within(screen.getByTestId("modal")).getByTestId(
          DNS_SETUP_TEST_IDS.recordName,
        ),
      ).toHaveTextContent("read-again.acme.com");
    });
  });

  describe("the card", () => {
    test("says what the page is for, with the record to point a domain at", () => {
      renderPage();

      expect(screen.getByTestId("card-description")).toHaveTextContent(
        page.cardDescription,
      );
      expect(screen.getByTestId("card-description")).not.toHaveTextContent(
        "Important",
      );
    });

    test("without this kind's CNAME record it says custom domains are not enabled", () => {
      setCnameRecord("");
      renderPage();

      expect(screen.getByTestId("card-description")).toHaveTextContent(
        "Custom Domains not enabled for this OneUptime installation.",
      );
    });
  });

  test("every Status sentence is in the copy, so it is translated", () => {
    expect(Object.keys(CUSTOM_DOMAIN_STATUS).sort()).toEqual(
      Object.values(CustomDomainState).sort(),
    );
  });
});
