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

/*
 * Dashboards > <dashboard> > Custom Domains tells the truth about what
 * happens next.
 *
 * Until the DashboardCerts worker existed a dashboard domain was verified and
 * ordered only when someone pressed a button, so the page asked for exactly
 * that ("Action Required: Please order SSL certificate.") while its dialogs
 * promised verification that never came. The worker now verifies, orders,
 * provisions and renews on its own; the page says so, and keeps Verify CNAME
 * and Order Free SSL as ways not to wait.
 *
 * The ModelTable is replaced by a stand-in that renders the page's own Status
 * column and row actions for the rows given; the dialogs are the page's own,
 * with ConfirmModal reduced to its title, text and submit button.
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
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    DashboardCNameRecord: "oneuptime.example.com",
  };
});

let mockRows: Array<DashboardDomain> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<DashboardDomain>): React.ReactElement => {
      const statusColumn: { getElement?: unknown } | undefined =
        props.columns.find((column: { title?: string }) => {
          return column.title === "Status";
        });

      const getStatus: (item: DashboardDomain) => React.ReactElement = (
        statusColumn as {
          getElement: (item: DashboardDomain) => React.ReactElement;
        }
      ).getElement;

      return (
        <section data-testid={props.id}>
          {mockRows.map((row: DashboardDomain): React.ReactElement => {
            return (
              <div key={row.fullDomain} data-testid={`row-${row.fullDomain}`}>
                <p data-testid="status">{getStatus(row)}</p>
                {(props.actionButtons || [])
                  .filter(
                    (action: ActionButtonSchema<DashboardDomain>): boolean => {
                      return !action.isVisible || Boolean(action.isVisible(row));
                    },
                  )
                  .map(
                    (
                      action: ActionButtonSchema<DashboardDomain>,
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

import DashboardCustomDomains from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/CustomDomains";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

function domain(
  fullDomain: string,
  state: {
    isCnameVerified?: boolean;
    isCustomCertificate?: boolean;
    isSslOrdered?: boolean;
    isSslProvisioned?: boolean;
  },
): DashboardDomain {
  const row: DashboardDomain = new DashboardDomain();
  row._id = ObjectID.generate().toString();
  row.fullDomain = fullDomain;
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

function renderPage(): void {
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
  ];

  render(
    <MemoryRouter>
      <DashboardCustomDomains
        pageRoute={new Route("/dashboard/dashboards")}
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

describe("Dashboard Custom Domains page", () => {
  beforeEach(() => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(ObjectID.generate());
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(ObjectID.generate());
    jest
      .spyOn(Navigation, "getCurrentRoute")
      .mockReturnValue(new Route("/dashboard/dashboards"));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("the Status column", () => {
    test("a verified domain without a certificate needs nothing from anyone: the certificate is ordered for it", () => {
      renderPage();

      expect(statusOf(VERIFIED)).toBe(
        "No action is required. We will order a free SSL certificate for this domain within 15 minutes.",
      );
      expect(statusOf(VERIFIED)).not.toContain("Action Required");
      expect(screen.queryByText(/Please order SSL certificate/)).toBeNull();
    });

    test("an unverified domain still asks for its CNAME record, the one thing only the customer can do", () => {
      renderPage();

      expect(statusOf(UNVERIFIED)).toBe(
        "Action Required: Please add your CNAME record.",
      );
    });

    test("an ordered certificate is waiting to be served, and a served one is renewed automatically", () => {
      renderPage();

      expect(statusOf(ORDERED)).toContain("No action is required.");
      expect(statusOf(ORDERED)).toContain("will be provisioned");

      expect(statusOf(PROVISIONED)).toBe(
        "Certificate Provisioned. We will automatically renew this certificate. No action required.",
      );
    });

    test("an uploaded certificate needs no order", () => {
      renderPage();

      expect(statusOf(UPLOADED)).toBe(
        "No action is required. Please allow 30 minutes for the certificate to be provisioned.",
      );
    });
  });

  describe("the row actions", () => {
    test("Order Free SSL stays on a verified domain without a certificate, as a way not to wait", () => {
      renderPage();

      expect(
        within(rowOf(VERIFIED)).getByRole("button", { name: "Order Free SSL" }),
      ).toBeInTheDocument();

      for (const fullDomain of [UNVERIFIED, ORDERED, PROVISIONED, UPLOADED]) {
        expect(
          within(rowOf(fullDomain)).queryByRole("button", {
            name: "Order Free SSL",
          }),
        ).toBeNull();
      }
    });

    test("Add CNAME shows only until the domain is verified", () => {
      renderPage();

      expect(
        within(rowOf(UNVERIFIED)).getByRole("button", { name: "Add CNAME" }),
      ).toBeInTheDocument();
      expect(
        within(rowOf(VERIFIED)).queryByRole("button", { name: "Add CNAME" }),
      ).toBeNull();
    });
  });

  describe("the dialogs", () => {
    test("Add CNAME says the record is checked every 15 minutes, and Verify CNAME checks it now", () => {
      renderPage();

      fireEvent.click(
        within(rowOf(UNVERIFIED)).getByRole("button", { name: "Add CNAME" }),
      );

      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: "Add CNAME",
      });

      expect(dialog).toHaveTextContent(UNVERIFIED);
      expect(dialog).toHaveTextContent("oneuptime.example.com");
      expect(dialog).toHaveTextContent(
        "We check for this record every 15 minutes and verify your domain automatically once it is live. To check right away, click Verify CNAME.",
      );
      expect(dialog).not.toHaveTextContent("24 hours");
      expect(
        within(dialog).getByRole("button", { name: "Verify CNAME" }),
      ).toBeInTheDocument();
    });

    test("Order Free SSL says the order happens anyway, and this only skips the wait", () => {
      renderPage();

      fireEvent.click(
        within(rowOf(VERIFIED)).getByRole("button", { name: "Order Free SSL" }),
      );

      const dialog: HTMLElement = screen.getByRole("dialog", {
        name: "Order Free SSL Certificate for this Dashboard",
      });

      expect(dialog).toHaveTextContent(
        "We order a free SSL certificate from Let's Encrypt for this domain automatically. To order it now instead of waiting up to 15 minutes, click the button below. The certificate is served within 15 minutes of being ordered.",
      );
      expect(dialog).not.toHaveTextContent("3 hours");
      expect(
        within(dialog).getByRole("button", { name: "Order Free SSL" }),
      ).toBeInTheDocument();
    });
  });
});
