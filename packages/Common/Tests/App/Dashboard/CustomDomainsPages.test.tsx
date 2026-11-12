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
import splitActionButtons, {
  SplitActionButtonsResult,
} from "../../../UI/Components/ActionButton/SplitActionButtons";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Filter from "../../../UI/Components/ModelFilter/Filter";
import StatusPageDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Domains";
import DashboardCustomDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/CustomDomains";
import FormCustomDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/CustomDomains";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  CUSTOM_DOMAIN_STATUS,
  CustomDomainCopy,
  CustomDomainKindCopy,
  CustomDomainState,
  DASHBOARD_CUSTOM_DOMAIN_COPY,
  DNS_SETUP_TEST_IDS,
  FORM_CUSTOM_DOMAIN_COPY,
  STATUS_PAGE_CUSTOM_DOMAIN_COPY,
  STATUS_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import {
  CustomDomainKind,
  CustomDomainModel,
  DASHBOARD_CUSTOM_DOMAINS,
  FORM_CUSTOM_DOMAINS,
  STATUS_PAGE_CUSTOM_DOMAINS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainKinds";
import { getAddCustomDomainFields } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/AddCustomDomainModal";
import { CustomDomainAddressCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainAddress";
import { CUSTOM_DOMAIN_NAME_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainName";
import FieldType from "../../../UI/Components/Types/FieldType";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import FormDomain from "../../../Models/DatabaseModels/FormDomain";
import Domain from "../../../Models/DatabaseModels/Domain";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { HTTP_PROTOCOL } from "../../../UI/Config";
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
 * are one table now - and a form's (Forms > <form> > Custom Domains) is the
 * same table - and every test here runs on all three:
 *
 *   - adding a domain is a dialog of its own: the address people will
 *     open, and the certificate options folded under Advanced;
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
  Object.defineProperty(mocked, "FormCNameRecord", cnameRecord);

  /*
   * OneUptime Cloud: a self-hosted server's readiness, read when DNS Setup
   * or Add Custom Domain opens, is AddCustomDomainModal.test.tsx's.
   */
  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return true;
    },
  });

  // Whether the installation issues free certificates: yes unless a test says.
  Object.defineProperty(mocked, "CUSTOM_DOMAIN_FREE_CERTIFICATES", {
    get: (): boolean => {
      return (
        (globalThis as unknown as { __issuesFreeCertificates?: boolean })
          .__issuesFreeCertificates !== false
      );
    },
  });

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

      // The Domain column draws its own cell: a link once the domain is live.
      const domainColumn: { getElement?: unknown } | undefined =
        props.columns.find((column: { title?: string }) => {
          return column.title === "Domain";
        });

      const getDomain: (item: CustomDomainModel) => React.ReactNode = (
        item: CustomDomainModel,
      ): React.ReactNode => {
        const getElement: unknown = domainColumn?.getElement;

        return typeof getElement === "function"
          ? (getElement as (row: CustomDomainModel) => React.ReactElement)(item)
          : item.fullDomain;
      };

      return (
        <section data-testid={props.id}>
          <p data-testid="card-description">{props.cardProps?.description}</p>
          {mockRows.map((row: CustomDomainModel): React.ReactElement => {
            return (
              <div key={row.fullDomain} data-testid={`row-${row.fullDomain}`}>
                <div data-testid="domain-cell">{getDomain(row)}</div>
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
  parentColumn: "statusPageId" | "dashboardId" | "formId";
  cnameRecord: string;
  route: string;
  crudApiPath: string;
  copy: CustomDomainKindCopy;
  kind: CustomDomainKind;
  // Add Custom Domain's example address.
  addressPlaceholder: string;
  cardDescription: string;
  /*
   * A role that may change the kind's domains: a member, for a status page's
   * and a dashboard's; an admin, for a form's, which a member tier never
   * manages (Models/DatabaseModels/FormDomain).
   */
  editorRole: Permission;
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
    kind: STATUS_PAGE_CUSTOM_DOMAINS,
    addressPlaceholder: "status.example.com",
    cardDescription:
      "Serve this status page on your own domain. Point each domain's CNAME record to statuspage.oneuptime.com, and we issue its SSL certificate and renew it for you.",
    editorRole: Permission.ProjectMember,
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
    kind: DASHBOARD_CUSTOM_DOMAINS,
    addressPlaceholder: "dashboard.example.com",
    cardDescription:
      "Serve this dashboard on your own domain. Point each domain's CNAME record to dashboards.oneuptime.com, and we issue its SSL certificate and renew it for you.",
    editorRole: Permission.ProjectMember,
    table: {
      id: "dashboard-domains-table",
      name: "Dashboard > Domains",
      userPreferencesKey: "dashboard-domains-table",
      saveFilterTableId: "dashboard-domains-table",
    },
  },
  {
    name: "a form",
    Page: FormCustomDomains,
    modelType: FormDomain,
    parentColumn: "formId",
    cnameRecord: "forms.oneuptime.com",
    route: "/dashboard/forms",
    crudApiPath: "/form-domain",
    copy: FORM_CUSTOM_DOMAIN_COPY,
    kind: FORM_CUSTOM_DOMAINS,
    addressPlaceholder: "report.example.com",
    cardDescription:
      "Serve this form on your own domain, at its root. Point each domain's CNAME record to forms.oneuptime.com, and we issue its SSL certificate and renew it for you.",
    editorRole: Permission.ProjectAdmin,
    table: {
      id: "form-domains-table",
      name: "Form > Custom Domains",
      userPreferencesKey: "form-domains-table",
      saveFilterTableId: "form-domains-table",
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

function setIssuesFreeCertificates(value: boolean): void {
  (
    globalThis as unknown as { __issuesFreeCertificates?: boolean }
  ).__issuesFreeCertificates = value;
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

  // The fields the Create or the Edit dialog is given, as ModelTable picks them.
  function formFieldsOn(
    modalType: ModalType,
  ): Array<ModelField<CustomDomainModel>> {
    return (tableProps().formFields || []).filter(
      (field: ModelField<CustomDomainModel>) => {
        return modalType === ModalType.Create
          ? !field.doNotShowWhenCreating
          : !field.doNotShowWhenEditing;
      },
    );
  }

  function formKeys(modalType: ModalType): Array<string | undefined> {
    return formFieldsOn(modalType).map(
      (field: ModelField<CustomDomainModel>) => {
        return Object.keys(field.field || {})[0];
      },
    );
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
    setIssuesFreeCertificates(true);
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

  /*
   * The Domain column: a live domain opens, in a new tab, as the page's own
   * list of addresses draws it; one that is not live yet is its name alone
   * (its Status says why). It used to be the name alone, live or not.
   */
  describe("the Domain column", () => {
    function domainCellOf(fullDomain: string): HTMLElement {
      return within(rowOf(fullDomain)).getByTestId("domain-cell");
    }

    test("a live domain opens over HTTPS in a new tab; one not live yet is its name alone", () => {
      renderPage();

      for (const live of [PROVISIONED, UPLOADED]) {
        const link: HTMLElement = within(domainCellOf(live)).getByTestId(
          CUSTOM_DOMAIN_NAME_TEST_IDS.link,
        );

        expect(link).toHaveAttribute("href", `https://${live}`);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        expect(link.textContent).toBe(`${live} (opens in a new tab)`);
      }

      for (const notLive of [UNVERIFIED, VERIFIED, ORDERED]) {
        const cell: HTMLElement = domainCellOf(notLive);

        expect(within(cell).queryByRole("link")).not.toBeInTheDocument();
        expect(
          within(cell).getByTestId(CUSTOM_DOMAIN_NAME_TEST_IDS.name),
        ).toHaveTextContent(notLive);
      }
    });

    test("its certificate decides: one that has expired is not a link, though the row still says provisioned", async () => {
      renderPage();

      await loadCertificates([
        {
          domainId: rowNamed(PROVISIONED)._id as string,
          expiresAt: "2026-01-01T00:00:00.000Z",
        },
      ]);

      expect(
        within(domainCellOf(PROVISIONED)).queryByRole("link"),
      ).not.toBeInTheDocument();
      expect(statusOf(PROVISIONED)).toContain("Certificate expired");
      // The uploaded certificate's domain is still live.
      expect(within(domainCellOf(UPLOADED)).getByRole("link")).toHaveAttribute(
        "href",
        `https://${UPLOADED}`,
      );
    });

    /*
     * The table's cells clip what is drawn past their sides (overflow-x:
     * clip), so a focus ring round the link lost its left edge. The
     * keyboard's focus is a heavy underline, drawn inside the cell.
     */
    test("a live domain shows the keyboard's focus as a heavy underline, not a ring the cell would clip", () => {
      renderPage();

      const link: HTMLElement = within(domainCellOf(PROVISIONED)).getByTestId(
        CUSTOM_DOMAIN_NAME_TEST_IDS.link,
      );

      expect(link).toHaveClass(
        "focus:outline-none",
        "focus-visible:underline",
        "focus-visible:decoration-2",
      );
      expect(link.className).not.toContain("focus-visible:ring");
    });

    test("the column still reads, sorts and filters by the domain's full name", () => {
      renderPage();

      const column: { field?: Record<string, unknown>; type?: unknown } = (
        tableProps().columns as Array<{
          title: string;
          field?: Record<string, unknown>;
          type?: unknown;
        }>
      ).find((candidate: { title: string }) => {
        return candidate.title === "Domain";
      })!;

      expect(column.field).toEqual({ fullDomain: true });
      expect(column.type).toBe(FieldType.Element);
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

    /*
     * The row draws one button and a ⋯ menu (RowActions, SplitActionButtons).
     * Reissue SSL's plainer style used to win the button wherever both were
     * offered: a row saying "Could not issue a free certificate yet" offered
     * to reissue a certificate it never had, with DNS Setup - whose Check now
     * tries again and says why - in its menu.
     */
    test("DNS Setup is the row's button wherever it is offered, Reissue SSL in its menu", async () => {
      const FAILING_ORDERED: string = "failing-ordered.acme.com";

      renderPage([
        domain(EXPIRED, {
          isCnameVerified: true,
          isSslOrdered: true,
          isSslProvisioned: true,
        }),
        domain(FAILING_ORDERED, { isCnameVerified: true, isSslOrdered: true }),
      ]);
      await loadCertificates([
        {
          domainId: rowNamed(EXPIRED)._id as string,
          expiresAt: "2026-01-01T00:00:00.000Z",
        },
        {
          domainId: rowNamed(FAILING_ORDERED)._id as string,
          lastOrderError: ORDER_ERROR,
          lastOrderFailedAt: "2026-10-03T11:00:00.000Z",
        },
        {
          domainId: rowNamed(PROVISIONED)._id as string,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ]);

      const rowButtons: (fullDomain: string) => {
        primary: string | undefined;
        menu: Array<string>;
      } = (
        fullDomain: string,
      ): { primary: string | undefined; menu: Array<string> } => {
        const split: SplitActionButtonsResult<CustomDomainModel> =
          splitActionButtons<CustomDomainModel>({
            actionButtons: tableProps().actionButtons,
            item: rowNamed(fullDomain),
          });

        return {
          primary: split.primary?.button.title,
          menu: split.moreMenu.map(
            (entry: { button: ActionButtonSchema<CustomDomainModel> }) => {
              return entry.button.title;
            },
          ),
        };
      };

      for (const fullDomain of [EXPIRED, FAILING_ORDERED]) {
        expect(rowButtons(fullDomain)).toEqual({
          primary: "DNS Setup",
          menu: ["Reissue SSL"],
        });
      }

      for (const fullDomain of [UNVERIFIED, VERIFIED]) {
        expect(rowButtons(fullDomain)).toEqual({
          primary: "DNS Setup",
          menu: [],
        });
      }

      // A served certificate has nothing to set up: Reissue SSL is the button.
      expect(rowButtons(PROVISIONED)).toEqual({
        primary: "Reissue SSL",
        menu: [],
      });
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
        `${page.crudApiPath}/check-dns/${rowNamed(UNVERIFIED)._id}`,
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
      // Why, then the permission to ask for - not the roles that hold it too.
      expect(reissue.getAttribute("data-tooltip")).toBe(
        `${LOCKED_REASON_START} ${PermissionGate.getNeededPermissionsSentence(
          new page.modelType().getUpdatePermissions(),
        )}`,
      );
      /*
       * One permission of its own for a status page's and a dashboard's
       * domains; a form's take Edit Form too.
       */
      const tooltip: string = reissue.getAttribute("data-tooltip") || "";

      expect(
        tooltip.includes(" You need this permission: ") ||
          tooltip.includes(" You need one of these permissions: "),
      ).toBe(true);
      expect(reissue.getAttribute("data-tooltip")).not.toContain(
        "Project Owner",
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
      ["an editor role", [page.editorRole]],
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

    test("before the permissions have arrived, Reissue SSL is not offered rather than locked with nothing to say", () => {
      mockPermissions = [];

      renderPage();

      for (const fullDomain of [ORDERED, PROVISIONED]) {
        expect(
          within(rowOf(fullDomain)).queryByRole("button", {
            name: "Reissue SSL",
          }),
        ).toBeNull();
      }
    });

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
    /*
     * Add Custom Domain is a dialog of its own (AddCustomDomainModal, and
     * AddCustomDomainModal.test.tsx for its flow): one field, the address,
     * and the project's domain verified in place when it is not yet. The
     * table's own form is Edit's alone.
     */
    test("is a dialog of its own, opened by the table's Add Custom Domain", () => {
      renderPage();

      expect(tableProps().onCreateClick).toBeDefined();
      expect(tableProps().createVerb).toBe("Add");
      expect(tableProps().singularName).toBe("Custom Domain");
      expect(tableProps().isCreateable).toBe(true);
      // Nothing of the table's own create form is left.
      expect(formKeys(ModalType.Create)).toEqual([]);
      expect(tableProps().onCreateSuccess).toBeUndefined();
      expect(tableProps().formSteps || []).toEqual([]);
    });

    test("Add Custom Domain asks for the address, with this page's example", async () => {
      getJestSpyOn(API, "get").mockResolvedValue(
        new HTTPResponse(200, { target: "", checks: [] }, {}) as never,
      );

      renderPage();

      expect(screen.queryByTestId("modal")).toBeNull();

      await act(async (): Promise<void> => {
        tableProps().onCreateClick!();
      });

      const dialog: HTMLElement = screen.getByTestId("modal");

      expect(dialog).toHaveTextContent(CustomDomainCopy.addTitle);
      expect(
        within(dialog).getByPlaceholderText(page.copy.addressPlaceholder),
      ).toBeInTheDocument();
      expect(page.copy.addressPlaceholder).toBe(page.addressPlaceholder);
    });

    test("on a verified domain the new domain's DNS Setup opens as soon as it is added", async () => {
      getJestSpyOn(API, "get").mockResolvedValue(
        new HTTPResponse(200, { target: "", checks: [] }, {}) as never,
      );

      const projectDomain: Domain = new Domain();
      projectDomain._id = ObjectID.generate().toString();
      projectDomain.domain = "acme.com" as never;
      projectDomain.isVerified = true;

      getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
        data: [projectDomain],
        count: 1,
        skip: 0,
        limit: 1,
      } as never);

      const create: jest.SpyInstance<any, any> = getJestSpyOn(
        ModelAPI,
        "create",
      ).mockResolvedValue(
        new HTTPResponse(
          200,
          {
            _id: ObjectID.generate().toString(),
            fullDomain: "new.acme.com",
            subdomain: "new",
          },
          {},
        ) as never,
      );

      renderPage([], { _id: PROJECT_ID.toString() } as unknown as Project);

      await act(async (): Promise<void> => {
        tableProps().onCreateClick!();
      });

      await act(async (): Promise<void> => {
        fireEvent.change(
          within(screen.getByTestId("modal")).getByPlaceholderText(
            page.copy.addressPlaceholder,
          ),
          { target: { value: "new.acme.com" } },
        );
      });

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(screen.getByTestId("modal")).getByRole("button", {
            name: CustomDomainCopy.addSubmit,
          }),
        );
      });

      await act(async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      });

      expect(create).toHaveBeenCalledTimes(1);

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

    /*
     * The name is fixed once the domain is added - the subdomain and the
     * domain's columns take no update - so the certificate is all an edit
     * can change.
     */
    test("Edit asks only for the certificate options", () => {
      renderPage();

      expect(formKeys(ModalType.Edit)).toEqual([
        "isCustomCertificate",
        "customCertificate",
        "customCertificateKey",
      ]);
    });

    /*
     * Folded under More fields on Edit too, they left the Edit dialog with
     * nothing in it but the fold's line.
     */
    test("Edit shows the certificate options at once, not folded, saying what Add says", () => {
      renderPage();

      const onEdit: Array<ModelField<CustomDomainModel>> = formFieldsOn(
        ModalType.Edit,
      );

      expect(onEdit).toHaveLength(3);

      for (const field of onEdit) {
        expect(field.collapsibleSection).toBeUndefined();
        expect(field.doNotShowWhenCreating).toBe(true);
      }

      // The same switch, saying the same, as Add Custom Domain's.
      const addSwitch: Field<FormValues<JSONObject>> | undefined =
        getAddCustomDomainFields(page.kind).find(
          (field: Field<FormValues<JSONObject>>) => {
            return Object.keys(field.field || {})[0] === "isCustomCertificate";
          },
        ) as Field<FormValues<JSONObject>> | undefined;
      const editSwitch: ModelField<CustomDomainModel> = onEdit[0]!;

      expect(Object.keys(editSwitch.field || {})).toEqual([
        "isCustomCertificate",
      ]);
      expect(editSwitch.title).toBe(addSwitch?.title);
      expect(editSwitch.description).toBe(addSwitch?.description);
      expect(editSwitch.fieldType).toBe(addSwitch?.fieldType);
      expect(editSwitch.defaultValue).toBe(false);

      // The certificate and its key, only while the switch is on.
      for (const field of onEdit.slice(1)) {
        expect(
          field.showIf!({
            isCustomCertificate: false,
          } as FormValues<CustomDomainModel>),
        ).toBe(false);
        expect(
          (
            field.required as (values: FormValues<CustomDomainModel>) => boolean
          )({ isCustomCertificate: true } as FormValues<CustomDomainModel>),
        ).toBe(true);
      }
    });

    /*
     * A form domain's columns describe the certificate and its key for the
     * API reference ("... while isCustomCertificate is on"), in English; the
     * form would draw that under the field. The title and the PEM
     * placeholder say what goes there, on every kind.
     */
    test("the certificate and its key show none of the API reference's words", () => {
      renderPage();

      const certificateFields: Array<ModelField<CustomDomainModel>> = (
        tableProps().formFields || []
      ).filter((field: ModelField<CustomDomainModel>) => {
        return ["customCertificate", "customCertificateKey"].includes(
          Object.keys(field.field || {})[0] || "",
        );
      });

      expect(certificateFields).toHaveLength(2);

      for (const field of certificateFields) {
        expect(field.hideColumnDescription).toBe(true);
        expect(field.description).toBeUndefined();
      }
    });

    test("Add's certificate options are one folded Advanced section, which says which certificate the domain will use", () => {
      const fields: Array<Field<FormValues<JSONObject>>> =
        getAddCustomDomainFields(page.kind) as unknown as Array<
          Field<FormValues<JSONObject>>
        >;

      const keyOf: (field: Field<FormValues<JSONObject>>) => string = (
        field: Field<FormValues<JSONObject>>,
      ): string => {
        return Object.keys(field.field || {})[0] || "";
      };

      expect(fields.map(keyOf)).toEqual([
        "address",
        "isCustomCertificate",
        "customCertificate",
        "customCertificateKey",
      ]);

      const sections: Array<unknown> = fields
        .slice(1)
        .map((field: Field<FormValues<JSONObject>>) => {
          return field.collapsibleSection;
        });

      expect(sections[0]).toBeDefined();
      expect(sections[1]).toBe(sections[0]);
      expect(sections[2]).toBe(sections[0]);
      expect(fields[0]!.collapsibleSection).toBeUndefined();

      const section: FormFieldCollapsibleSection<FormValues<JSONObject>> =
        fields[1]!.collapsibleSection!;

      expect(section.title).toBe(MORE_FIELDS_SECTION_TITLE);
      expect(section.openWhenConfigured).toBe(false);
      expect(section.getSummary!({} as FormValues<JSONObject>)).toEqual([
        CustomDomainCopy.advancedSummaryFreeCertificate,
      ]);
      expect(
        section.getSummary!({
          isCustomCertificate: true,
        } as FormValues<JSONObject>),
      ).toEqual([CustomDomainCopy.advancedSummaryUploadedCertificate]);

      // The address is needed, and must be one.
      expect(fields[0]!.required).toBe(true);
      expect(
        fields[0]!.customValidation!({
          address: "not a domain",
        } as FormValues<JSONObject>),
      ).toBe(CustomDomainAddressCopy.invalidAddress);
      expect(
        fields[0]!.customValidation!({
          address: page.addressPlaceholder,
        } as FormValues<JSONObject>),
      ).toBeNull();
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

  /*
   * An installation without a Let's Encrypt account key issues no free
   * certificate: a self-hosted one that ends TLS at its own proxy. A
   * verified domain there read "Issuing a free certificate, usually within
   * 15 minutes." for ever, and kept offering DNS Setup for an order that
   * could never be placed.
   */
  describe("on an installation that issues no free certificates", () => {
    beforeEach(() => {
      setIssuesFreeCertificates(false);
    });

    afterEach(() => {
      setIssuesFreeCertificates(true);
    });

    test("a verified domain is verified, and says where its HTTPS comes from", () => {
      renderPage();

      for (const verified of [VERIFIED, ORDERED, PROVISIONED]) {
        expect([verified, statusOf(verified)]).toEqual([
          verified,
          CUSTOM_DOMAIN_STATUS[
            CustomDomainState.VerifiedWithoutFreeCertificate
          ],
        ]);
      }

      expect(statusOf(UNVERIFIED)).toBe(
        CUSTOM_DOMAIN_STATUS[CustomDomainState.WaitingForDns],
      );
      expect(statusOf(UPLOADED)).toBe(
        CUSTOM_DOMAIN_STATUS[CustomDomainState.UsesUploadedCertificate],
      );
      expect(screen.queryByText(/Issuing a free certificate/)).toBeNull();
    });

    test("a verified domain opens, as the installation itself is reached", () => {
      renderPage();

      const link: HTMLElement = within(
        within(rowOf(VERIFIED)).getByTestId("domain-cell"),
      ).getByTestId(CUSTOM_DOMAIN_NAME_TEST_IDS.link);

      expect(link).toHaveAttribute("href", `${HTTP_PROTOCOL}${VERIFIED}`);
      expect(link).toHaveAttribute("target", "_blank");

      // One on an uploaded certificate is HTTPS, as anywhere.
      expect(
        within(within(rowOf(UPLOADED)).getByTestId("domain-cell")).getByTestId(
          CUSTOM_DOMAIN_NAME_TEST_IDS.link,
        ),
      ).toHaveAttribute("href", `https://${UPLOADED}`);
    });

    test("DNS Setup is offered until the record is found, then never: there is no order to place", () => {
      renderPage();

      expect(
        within(rowOf(UNVERIFIED)).getByRole("button", {
          name: CustomDomainCopy.dnsSetupTitle,
        }),
      ).toBeInTheDocument();

      for (const verified of [VERIFIED, ORDERED, PROVISIONED, UPLOADED]) {
        expect([
          verified,
          within(rowOf(verified)).queryByRole("button", {
            name: CustomDomainCopy.dnsSetupTitle,
          }),
        ]).toEqual([verified, null]);
      }
    });

    /*
     * Reissue SSL asks Let's Encrypt for a new certificate, which needs the
     * account key this installation has none of: even a domain ordered
     * while it had one (ordered, provisioned) is not offered it here.
     */
    test("Reissue SSL is not offered: there is no certificate of ours to replace", () => {
      renderPage();

      for (const row of [
        UNVERIFIED,
        VERIFIED,
        ORDERED,
        PROVISIONED,
        UPLOADED,
      ]) {
        expect([
          row,
          within(rowOf(row)).queryByRole("button", { name: "Reissue SSL" }),
        ]).toEqual([row, null]);
      }
    });

    test("an order the server recorded as failed is not shown as a failure", async () => {
      renderPage();

      await loadCertificates([
        {
          domainId: rowNamed(VERIFIED)._id!.toString(),
          lastOrderError:
            "No lets encrypt account key found in environment variables. Please add one.",
        },
      ]);

      expect(statusOf(VERIFIED)).toBe(
        CUSTOM_DOMAIN_STATUS[CustomDomainState.VerifiedWithoutFreeCertificate],
      );
      expect(errorOf(VERIFIED)).toBeNull();
    });

    test("the card points domains at the record, promising no certificate", () => {
      renderPage();

      expect(screen.getByTestId("card-description")).toHaveTextContent(
        page.copy.cardDescriptionWithoutFreeCertificates.replace(
          "{{cnameRecord}}",
          page.cnameRecord,
        ),
      );
      expect(screen.getByTestId("card-description")).not.toHaveTextContent(
        "we issue its SSL certificate",
      );
    });

    test("Add Custom Domain's folded certificate options say the proxy serves it, unless a certificate is uploaded", () => {
      const section: FormFieldCollapsibleSection<FormValues<JSONObject>> = (
        getAddCustomDomainFields(page.kind) as unknown as Array<
          Field<FormValues<JSONObject>>
        >
      )[1]!.collapsibleSection!;

      expect(section.getSummary!({} as FormValues<JSONObject>)).toEqual([
        CustomDomainCopy.advancedSummaryWithoutFreeCertificate,
      ]);
      expect(
        section.getSummary!({
          isCustomCertificate: true,
        } as FormValues<JSONObject>),
      ).toEqual([CustomDomainCopy.advancedSummaryUploadedCertificate]);
    });
  });

  test("every Status sentence is in the copy, so it is translated", () => {
    expect(Object.keys(CUSTOM_DOMAIN_STATUS).sort()).toEqual(
      Object.values(CustomDomainState).sort(),
    );
  });

  /*
   * A cell holds one line unless its column says it wraps, and clips the
   * rest: "Issuing a free certificate, usually within 15 minutes." lost its
   * end at 1280px, and an order's failure under it more.
   */
  test("the Status column wraps its sentence rather than cutting it off", () => {
    renderPage();

    const status: { wrapContent?: boolean } | undefined = (
      mockTableProps!.columns as Array<{
        title?: string;
        wrapContent?: boolean;
      }>
    ).find((column: { title?: string }) => {
      return column.title === "Status";
    });

    expect(status?.wrapContent).toBe(true);
  });
});
