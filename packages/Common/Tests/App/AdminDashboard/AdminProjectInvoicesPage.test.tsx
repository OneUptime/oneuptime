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
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * ADMIN DASHBOARD > PROJECTS > (PROJECT) > INVOICES, on the real page, in the
 * real locales.
 *
 * Staff extending a trial found the plan invoice raised as the trial ended
 * still open, with the payment provider retrying it. This page lists a
 * project's invoices, newest first, read live from the provider, and voids
 * one that is still owed - asking first, naming the invoice and its amount,
 * because a void cannot be undone. A paid invoice offers no Void at all.
 *
 * The HTTP client, the admin model API, the page chrome and the side menu
 * are stand-ins; the page, its table, its dialog and its words are real.
 */

jest.setTimeout(60000);

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165004";

const WAIT: { timeout: number } = { timeout: 20000 };

let mockBillingEnabled: boolean = true;

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getItem: (...args: Array<unknown>): unknown => {
          return mockGetItem(...args);
        },
        getList: async (): Promise<unknown> => {
          return { data: [], count: 0, skip: 0, limit: 0 };
        },
      },
    };
  },
);

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import ProjectInvoices from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Invoices";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import { InvoiceStatus } from "../../../Models/DatabaseModels/BillingInvoice";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { InvoiceBilledFor } from "../../../Types/Billing/AdminProjectInvoice";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import BaseAPI from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";

const ADMIN_DASHBOARD: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

type Locale = Record<string, unknown> & {
  pages: { projectInvoices: Record<string, string> };
};

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(
      path.join(ADMIN_DASHBOARD, "Locales", `${locale}.json`),
      "utf8",
    ),
  ) as Locale;
}

function words(locale: string, key: string): string {
  const value: string | undefined =
    readLocale(locale).pages.projectInvoices[key];

  if (!value) {
    throw new Error(
      `The ${locale} locale has no pages.projectInvoices.${key}.`,
    );
  }

  return value;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

// The invoices as the payment provider holds them, newest first.
let storedInvoices: Array<JSONObject> = [];

function invoices(): Array<JSONObject> {
  return [
    {
      id: "in_plan_nov",
      invoiceNumber: "ACME-0007",
      invoiceDate: "2026-11-13T20:31:00.000Z",
      amount: 2200,
      currencyCode: "usd",
      status: InvoiceStatus.Open,
      downloadableLink: "https://pay.stripe.com/invoice/in_plan_nov/pdf",
      billedFor: InvoiceBilledFor.Plan,
    },
    {
      id: "in_usage_oct",
      invoiceNumber: "ACME-0006",
      invoiceDate: "2026-10-13T20:31:00.000Z",
      amount: 125050,
      currencyCode: "usd",
      status: InvoiceStatus.Paid,
      downloadableLink: "https://pay.stripe.com/invoice/in_usage_oct/pdf",
      billedFor: InvoiceBilledFor.Usage,
    },
  ];
}

let getSpy: jest.SpiedFunction<typeof BaseAPI.get>;
let putSpy: jest.SpiedFunction<typeof BaseAPI.put>;

interface Request {
  url: URL;
  data?: JSONObject | undefined;
}

function requestOf(
  spy:
    | jest.SpiedFunction<typeof BaseAPI.get>
    | jest.SpiedFunction<typeof BaseAPI.put>,
  index: number,
): Request {
  return (spy.mock.calls[index] as unknown as Array<Request>)[0]!;
}

// The page's reads of the invoices list, among whatever else reads.
function invoiceListReads(): Array<Request> {
  return (getSpy.mock.calls as unknown as Array<Array<Request>>)
    .map((call: Array<Request>): Request => {
      return call[0]!;
    })
    .filter((request: Request): boolean => {
      return request.url.toString().includes("/admin-invoices");
    });
}

// The provider voids what it is asked to, and lists it void after.
function voidsGoThrough(): void {
  putSpy.mockImplementation((async (
    request: Request,
  ): Promise<HTTPResponse<JSONObject>> => {
    const invoiceId: string = (request.data!["data"] as JSONObject)[
      "paymentProviderInvoiceId"
    ] as string;

    storedInvoices = storedInvoices.map((invoice: JSONObject): JSONObject => {
      return invoice["id"] === invoiceId
        ? { ...invoice, status: InvoiceStatus.Void }
        : invoice;
    });

    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as unknown as typeof BaseAPI.put);
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(locale: string = "en"): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <ProjectInvoices />
    </I18nextProvider>,
  );

  await flush();
}

// The table row an invoice is drawn in, by its number.
async function rowOf(invoiceNumber: string): Promise<HTMLElement> {
  const cell: HTMLElement = await screen.findByText(invoiceNumber, {}, WAIT);
  const row: HTMLElement | null = cell.closest("tr");

  if (!row) {
    throw new Error(`No table row holds ${invoiceNumber}.`);
  }

  return row;
}

async function openVoidDialog(invoiceNumber: string): Promise<HTMLElement> {
  const row: HTMLElement = await rowOf(invoiceNumber);

  fireEvent.click(within(row).getByTestId("row-actions-more-button"));
  await flush();

  fireEvent.click(
    await screen.findByRole("menuitem", { name: /Void Invoice/ }, WAIT),
  );
  await flush();

  return await screen.findByTestId("row-actions-dialog", {}, WAIT);
}

describe("Admin > Project > Invoices", () => {
  beforeEach(() => {
    mockBillingEnabled = true;
    window.history.pushState({}, "", `/admin/projects/${PROJECT_ID}/invoices`);

    mockGetItem.mockReset();
    mockGetItem.mockImplementation(async (): Promise<Project> => {
      const project: Project = new Project();
      project._id = PROJECT_ID;
      project.name = "Acme Production";
      return project;
    });

    getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

    storedInvoices = invoices();

    getSpy = jest.spyOn(BaseAPI, "get");
    getSpy.mockImplementation((async (
      request: Request,
    ): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        request.url.toString().includes("/admin-invoices")
          ? { invoices: storedInvoices }
          : {},
        {},
      );
    }) as unknown as typeof BaseAPI.get);

    putSpy = jest.spyOn(BaseAPI, "put");
    voidsGoThrough();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("lives at the project's own address, under Projects", () => {
    expect(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROJECT_INVOICES] as Route,
        {
          modelId: new ObjectID(PROJECT_ID),
        },
      ).toString(),
    ).toBe(`/admin/projects/${PROJECT_ID}/invoices`);

    // The router draws this page at that address.
    const app: string = fs.readFileSync(
      path.join(ADMIN_DASHBOARD, "App.tsx"),
      "utf8",
    );

    expect(app).toContain(
      'import ProjectInvoices from "./Pages/Projects/View/Invoices";',
    );
    expect(app.replace(/\s+/g, " ")).toContain(
      'path={RouteMap[PageMap.PROJECT_INVOICES]?.toString() || ""} element={<ProjectInvoices />}',
    );
  });

  test("reads the project's invoices from the master-admin route", async () => {
    await renderPage();
    await rowOf("ACME-0007");

    expect(invoiceListReads()).toHaveLength(1);
    expect(invoiceListReads()[0]!.url.toString()).toContain(
      `/project/${PROJECT_ID}/admin-invoices`,
    );
  });

  test("lists each invoice with its date, what it bills for, its amount and its status", async () => {
    await renderPage();

    const planRow: HTMLElement = await rowOf("ACME-0007");
    const usageRow: HTMLElement = await rowOf("ACME-0006");

    expect(within(planRow).getByText("22.00 USD")).toBeInTheDocument();
    expect(
      within(planRow).getByText(words("en", "billedForPlan")),
    ).toBeInTheDocument();
    expect(
      within(planRow).getByText(words("en", "statusOpen")),
    ).toBeInTheDocument();

    expect(within(usageRow).getByText("1,250.50 USD")).toBeInTheDocument();
    expect(
      within(usageRow).getByText(words("en", "billedForUsage")),
    ).toBeInTheDocument();
    expect(
      within(usageRow).getByText(words("en", "statusPaid")),
    ).toBeInTheDocument();
  });

  test("offers Void on an invoice still owed, and not on a paid one", async () => {
    await renderPage();

    const planRow: HTMLElement = await rowOf("ACME-0007");
    fireEvent.click(within(planRow).getByTestId("row-actions-more-button"));
    await flush();

    expect(
      await screen.findByRole("menuitem", { name: /Void Invoice/ }, WAIT),
    ).toBeInTheDocument();

    cleanup();
    await renderPage();

    const usageRow: HTMLElement = await rowOf("ACME-0006");

    // Download is the paid row's one action: there is nothing in a menu.
    expect(
      within(usageRow).queryByTestId("row-actions-more-button"),
    ).not.toBeInTheDocument();
    expect(within(usageRow).queryByText(/Void/)).not.toBeInTheDocument();
  });

  test("asks before voiding, naming the invoice and its amount", async () => {
    await renderPage();

    const dialog: HTMLElement = await openVoidDialog("ACME-0007");

    expect(
      within(dialog).getByText(
        "Void invoice ACME-0007 for 22.00 USD? The customer will no longer owe it, and the payment provider stops trying to collect it. This cannot be undone.",
      ),
    ).toBeInTheDocument();

    // Asking voids nothing.
    expect(putSpy).not.toHaveBeenCalled();
  });

  test("voids the invoice it names, says so, and lists it void", async () => {
    await renderPage();

    const dialog: HTMLElement = await openVoidDialog("ACME-0007");

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    await flush();

    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledTimes(1);
    }, WAIT);

    const request: Request = requestOf(putSpy, 0);

    expect(request.url.toString()).toContain(
      `/project/${PROJECT_ID}/admin-void-invoice`,
    );
    expect(request.data).toEqual({
      data: { paymentProviderInvoiceId: "in_plan_nov" },
    });

    expect(
      await screen.findByTestId("admin-project-invoices-success", {}, WAIT),
    ).toHaveTextContent(
      "Invoice ACME-0007 voided. The customer no longer owes it.",
    );

    // The list is read again, and the invoice now reads void.
    const planRow: HTMLElement = await rowOf("ACME-0007");

    await waitFor(() => {
      expect(
        within(planRow).getByText(words("en", "statusVoid")),
      ).toBeInTheDocument();
    }, WAIT);
    expect(invoiceListReads().length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("row-actions-dialog")).not.toBeInTheDocument();
  });

  test("a refused void says why in the dialog, which stays open", async () => {
    putSpy.mockImplementation((async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(
        400,
        { message: "This invoice does not belong to this project." },
        {},
      );
    }) as unknown as typeof BaseAPI.put);

    await renderPage();

    const dialog: HTMLElement = await openVoidDialog("ACME-0007");

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    await flush();

    expect(
      await within(dialog).findByText(
        "This invoice does not belong to this project.",
        {},
        WAIT,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("row-actions-dialog")).toBeInTheDocument();
    expect(
      screen.queryByTestId("admin-project-invoices-success"),
    ).not.toBeInTheDocument();
  });

  test("Download opens the invoice's PDF in a new tab", async () => {
    const navigateSpy: jest.SpiedFunction<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await renderPage();

    const usageRow: HTMLElement = await rowOf("ACME-0006");

    fireEvent.click(within(usageRow).getByRole("button", { name: "Download" }));
    await flush();

    expect(navigateSpy).toHaveBeenCalledWith(
      URL.fromString("https://pay.stripe.com/invoice/in_usage_oct/pdf"),
      { openInNewTab: true },
    );
  });

  test("a project with no invoices says so", async () => {
    storedInvoices = [];

    await renderPage();

    const empty: HTMLElement = await screen.findByTestId(
      "admin-project-invoices-empty",
      {},
      WAIT,
    );

    expect(empty).toHaveTextContent(words("en", "emptyTitle"));
  });

  test("a list that could not be read says why", async () => {
    getSpy.mockImplementation((async (): Promise<HTTPErrorResponse> => {
      // As the server answers a payment provider's refusal: a 400 with its words.
      return new HTTPErrorResponse(
        400,
        { message: "The payment provider did not answer." },
        {},
      );
    }) as unknown as typeof BaseAPI.get);

    await renderPage();

    expect(
      await screen.findByText(/The payment provider did not answer/, {}, WAIT),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("admin-project-invoices-empty"),
    ).not.toBeInTheDocument();
  });

  test("reads in the admin's language", async () => {
    await renderPage("de");

    const planRow: HTMLElement = await rowOf("ACME-0007");

    expect(words("de", "statusOpen")).not.toEqual(words("en", "statusOpen"));
    expect(
      within(planRow).getByText(words("de", "statusOpen")),
    ).toBeInTheDocument();
    expect(
      within(planRow).getByText(words("de", "billedForPlan")),
    ).toBeInTheDocument();
  });

  test("on a server without billing, it says there are no invoices and reads nothing", async () => {
    mockBillingEnabled = false;

    await renderPage();

    expect(
      await screen.findByText(words("en", "billingDisabled"), {}, WAIT),
    ).toBeInTheDocument();
    expect(invoiceListReads()).toEqual([]);
  });
});
