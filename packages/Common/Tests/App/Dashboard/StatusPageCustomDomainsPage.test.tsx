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
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import StatusPageDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Domains";
import {
  DNS_SETUP_TEST_IDS,
  STATUS_PAGE_CUSTOM_DOMAIN_STATUS,
  STATUS_TEST_IDS,
  StatusPageCustomDomainCopy,
  StatusPageCustomDomainState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/CustomDomain/StatusPageCustomDomainCopy";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import Domain from "../../../Models/DatabaseModels/Domain";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import { ADVANCED_FORM_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * Status Pages > <page> > Custom Domains: add a domain, the DNS record opens
 * right away, and the free certificate is issued without a button.
 *
 * Putting a status page on your own domain used to take four actions in two
 * places - verify the domain in Project Settings, add the custom domain in
 * two steps, find "Add CNAME" (which added nothing), then find "Order Free
 * SSL" while the Status column said "Action Required: Please order SSL
 * certificate." for an order the worker placed on its own anyway. This
 * pins the page as it is now:
 *
 *   - adding a domain is one page: Subdomain and Domain - verified domains
 *     only, with a link to add one - and the certificate options folded
 *     under Advanced;
 *   - the new domain's DNS Setup dialog opens as soon as it is added;
 *   - DNS Setup (the old Add CNAME) shows until the record is verified;
 *     there is no Order Free SSL; Reissue SSL stays;
 *   - the Status column is four plain states, with one timing.
 *
 * The ModelTable is replaced by a stand-in that renders the page's own
 * Status column and row actions for the rows given, and hands the test the
 * props the page gave it; the DNS Setup dialog is the real one.
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

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "StatusPageCNameRecord", {
    get: (): string => {
      return (globalThis as unknown as { __cnameRecord: string }).__cnameRecord;
    },
  });

  return mocked;
});

let mockRows: Array<StatusPageDomain> = [];
let mockTableProps: ModelTableProps<StatusPageDomain> | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<StatusPageDomain>): React.ReactElement => {
      mockTableProps = props;

      const statusColumn: { getElement?: unknown } | undefined =
        props.columns.find((column: { title?: string }) => {
          return column.title === "Status";
        });

      const getStatus: (item: StatusPageDomain) => React.ReactElement = (
        statusColumn as {
          getElement: (item: StatusPageDomain) => React.ReactElement;
        }
      ).getElement;

      return (
        <section data-testid={props.id}>
          <p data-testid="card-description">{props.cardProps?.description}</p>
          {mockRows.map((row: StatusPageDomain): React.ReactElement => {
            return (
              <div key={row.fullDomain} data-testid={`row-${row.fullDomain}`}>
                <p data-testid="status">{getStatus(row)}</p>
                {(props.actionButtons || [])
                  .filter(
                    (action: ActionButtonSchema<StatusPageDomain>): boolean => {
                      return (
                        !action.isVisible || Boolean(action.isVisible(row))
                      );
                    },
                  )
                  .map(
                    (
                      action: ActionButtonSchema<StatusPageDomain>,
                    ): React.ReactElement => {
                      return (
                        <button
                          key={action.title}
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

function domain(
  fullDomain: string,
  state: {
    isCnameVerified?: boolean;
    isCustomCertificate?: boolean;
    isSslOrdered?: boolean;
    isSslProvisioned?: boolean;
  },
): StatusPageDomain {
  const row: StatusPageDomain = new StatusPageDomain();
  row._id = ObjectID.generate().toString();
  row.fullDomain = fullDomain;
  row.subdomain = fullDomain.split(".")[0] || "";
  row.isCnameVerified = state.isCnameVerified ?? false;
  row.isCustomCertificate = state.isCustomCertificate ?? false;
  row.isSslOrdered = state.isSslOrdered ?? false;
  row.isSslProvisioned = state.isSslProvisioned ?? false;
  return row;
}

const UNVERIFIED: string = "unverified.acme.com";
const VERIFIED: string = "verified.acme.com";
const ORDERED: string = "ordered.acme.com";
const PROVISIONED: string = "provisioned.acme.com";
const UPLOADED: string = "uploaded.acme.com";
const PROJECT_ID: ObjectID = ObjectID.generate();

function setCnameRecord(value: string): void {
  (globalThis as unknown as { __cnameRecord: string }).__cnameRecord = value;
}

function renderPage(moreRows: Array<StatusPageDomain> = []): void {
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
      <StatusPageDomains
        pageRoute={new Route("/dashboard/status-pages")}
        currentProject={null}
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

function tableProps(): ModelTableProps<StatusPageDomain> {
  expect(mockTableProps).not.toBeNull();
  return mockTableProps!;
}

function fieldOf(key: string): ModelField<StatusPageDomain> {
  const field: ModelField<StatusPageDomain> | undefined = (
    tableProps().formFields || []
  ).find((candidate: ModelField<StatusPageDomain>) => {
    return Object.keys(candidate.field || {})[0] === key;
  });

  expect(field).toBeDefined();
  return field!;
}

const STATUS_PAGE_ID: ObjectID = ObjectID.generate();

const ORDER_ERROR: string =
  "Unable to order certificate for failing.acme.com. Please contact support at support@oneuptime.com for more information.";

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

function rowNamed(fullDomain: string): StatusPageDomain {
  const row: StatusPageDomain | undefined = mockRows.find(
    (candidate: StatusPageDomain) => {
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

describe("Status page Custom Domains page", () => {
  beforeEach(() => {
    setCnameRecord("statuspage.oneuptime.com");
    mockTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(STATUS_PAGE_ID);
    jest
      .spyOn(Navigation, "getCurrentRoute")
      .mockReturnValue(new Route("/dashboard/status-pages"));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
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

      const page: string = document.body.textContent || "";

      expect(page).not.toContain("Action Required");
      expect(page).not.toContain("order SSL");
      expect(page).not.toContain("1 hour");
      expect(page).not.toContain("30 minutes");
      expect(page).not.toContain("3 hours");
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

    test("reads this status page's certificates whenever the table loads its rows", async () => {
      renderPage();

      const get: jest.SpyInstance<any, any> = await loadCertificates([]);

      expect(get).toHaveBeenCalledTimes(1);
      expect(String(get.mock.calls[0]![0].url)).toContain(
        `/status-page-domain/certificates/${STATUS_PAGE_ID.toString()}`,
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
      ).toHaveTextContent(StatusPageCustomDomainCopy.dnsSetupVerifiedExpired);
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
          (action: ActionButtonSchema<StatusPageDomain>) => {
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
      ).toHaveTextContent("statuspage.oneuptime.com");
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
          (field: ModelField<StatusPageDomain>) => {
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

    /*
     * The server refuses a domain that is not verified, so listing one only
     * led to "This domain is not verified" after the form was filled in.
     */
    test("Domain lists verified domains only, and links to where a domain is added", () => {
      renderPage();

      const domainField: ModelField<StatusPageDomain> = fieldOf("domain");

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

      const sections: Array<FormFieldCollapsibleSection<StatusPageDomain>> = [
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
      expect(sections[0]!.title).toBe(ADVANCED_FORM_SECTION_TITLE);
      expect(sections[0]!.openWhenConfigured).toBe(false);

      expect(fieldOf("subdomain").collapsibleSection).toBeUndefined();
      expect(fieldOf("domain").collapsibleSection).toBeUndefined();
    });

    test("folded, Advanced says which certificate the domain will use", () => {
      renderPage();

      const section: FormFieldCollapsibleSection<StatusPageDomain> = fieldOf(
        "isCustomCertificate",
      ).collapsibleSection!;

      expect(section.getSummary!({} as FormValues<StatusPageDomain>)).toEqual([
        StatusPageCustomDomainCopy.advancedSummaryFreeCertificate,
      ]);
      expect(
        section.getSummary!({
          isCustomCertificate: true,
        } as FormValues<StatusPageDomain>),
      ).toEqual([
        StatusPageCustomDomainCopy.advancedSummaryUploadedCertificate,
      ]);
    });

    test("the switch starts off, as the column does, and the certificate and key are needed only when it is on", () => {
      renderPage();

      expect(fieldOf("isCustomCertificate").defaultValue).toBe(false);

      for (const key of ["customCertificate", "customCertificateKey"]) {
        const field: ModelField<StatusPageDomain> = fieldOf(key);
        const required: (values: FormValues<StatusPageDomain>) => boolean =
          field.required as (values: FormValues<StatusPageDomain>) => boolean;

        expect(
          required({
            isCustomCertificate: true,
          } as FormValues<StatusPageDomain>),
        ).toBe(true);
        expect(
          required({
            isCustomCertificate: false,
          } as FormValues<StatusPageDomain>),
        ).toBe(false);
        expect(
          field.showIf!({
            isCustomCertificate: false,
          } as FormValues<StatusPageDomain>),
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

      const created: StatusPageDomain = domain("new.acme.com", {});

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

      const created: StatusPageDomain = new StatusPageDomain();
      created._id = ObjectID.generate().toString();

      const fetched: StatusPageDomain = domain("read-again.acme.com", {});
      fetched._id = created._id;

      const getItem: jest.SpyInstance<any, any> = getJestSpyOn(
        ModelAPI,
        "getItem",
      ).mockResolvedValue(fetched as never);

      await act(async (): Promise<void> => {
        await tableProps().onCreateSuccess!(created, ModalType.Create);
      });

      expect(getItem).toHaveBeenCalledTimes(1);
      expect(
        (getItem.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
      ).toBe(created._id);
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
        "Serve this status page on your own domain. Point each domain's CNAME record to statuspage.oneuptime.com, and we issue its SSL certificate and renew it for you.",
      );
      expect(screen.getByTestId("card-description")).not.toHaveTextContent(
        "Important",
      );
    });

    test("without a status page CNAME record it says custom domains are not enabled", () => {
      setCnameRecord("");
      renderPage();

      expect(screen.getByTestId("card-description")).toHaveTextContent(
        "Custom Domains not enabled for this OneUptime installation.",
      );
    });
  });

  test("every Status sentence is in the copy, so it is translated", () => {
    expect(Object.keys(STATUS_PAGE_CUSTOM_DOMAIN_STATUS).sort()).toEqual(
      Object.values(StatusPageCustomDomainState).sort(),
    );
  });
});
