import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * AN INVOICE'S STATUS, IN THE READER'S LANGUAGE, LOOKED UP ONCE (#7781, #8078).
 *
 * Settings > Invoices draws each invoice's status as a pill, and its Invoice
 * Status filter offers every status in the same words. The words agree with
 * the invoice, which most of these languages make feminine - Spanish "una
 * factura pagada", French "une facture payée" - as Stripe's own invoices
 * read: "Pagada", "Anulada", never the masculine "Pagado", "Anulado" they
 * were first worded in (#8078). Arabic's فاتورة is feminine too.
 *
 * Each status is a key the pill looks up where it draws it: once. The list
 * used to put the status in the reader's words and hand those to the pill,
 * which looked them up again, so a word that is also a key read as that
 * key's wording. A made-up language below words "Paid" as "Open" to show
 * it: looked up twice, a paid invoice read "Open"'s word.
 *
 * The real page, over a fake ModelAPI.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

// The invoices page loads Stripe's script only to pay: never here.
jest.mock(
  "@stripe/stripe-js/pure",
  () => {
    return {
      loadStripe: async () => {
        return {};
      },
    };
  },
  { virtual: true },
);

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80780000-0000-4000-8000-000000000101";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BillingInvoice, {
  InvoiceStatus,
} from "../../../Models/DatabaseModels/BillingInvoice";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import SettingsInvoices from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Invoices";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { PROJECT_ID } from "./SideMenuHarness";

// A made-up language whose "Paid" is a key of its own: "Open".
const LOOKED_UP_TWICE: string = "xx";

function invoice(id: string, number: string, status: string): BillingInvoice {
  return Object.assign(new BillingInvoice(), {
    _id: `80780000-0000-4000-8000-0000000002${id}`,
    invoiceNumber: number,
    status: status,
    amount: 1200,
    currencyCode: "usd",
    invoiceDate: new Date("2026-11-14T09:00:00Z"),
  });
}

const INVOICES: Array<BillingInvoice> = [
  invoice("01", "INV-PAID", InvoiceStatus.Paid),
  invoice("02", "INV-VOID", InvoiceStatus.Void),
  invoice("03", "INV-OPEN", InvoiceStatus.Open),
  invoice("04", "INV-UNCOLLECTIBLE", InvoiceStatus.Uncollectible),
  invoice("05", "INV-NONE", InvoiceStatus.Undefined),
  // A status a newer Stripe added, which no release words yet.
  invoice("06", "INV-PROCESSING", "processing"),
];

// The statuses, in the order the Invoice Status filter offers them.
const STATUS_KEYS: ReadonlyArray<string> = [
  "Paid",
  "Draft",
  "Void",
  "Uncollectible",
  "Deleted",
  "Open (invoice status)",
  "Undefined",
];

// How each language words the statuses that agree with the invoice.
const AGREEING: Record<string, Record<string, string>> = {
  es: { Paid: "Pagada", Void: "Anulada", Open: "Pendiente" },
  fr: { Paid: "Payée", Void: "Annulée", Open: "À payer" },
  it: { Paid: "Pagata", Void: "Annullata", Open: "Da pagare" },
  pt: { Paid: "Paga", Void: "Anulada", Open: "Em aberto" },
  ar: {
    Paid: "مدفوعة",
    Void: "ملغاة",
    Open: "غير مدفوعة",
    Uncollectible: "غير قابلة للتحصيل",
  },
};

function pageProps(): PageComponentProps {
  return {
    pageRoute: new Route(`/dashboard/${PROJECT_ID}/settings/invoices`),
    currentProject: null,
    hasPaymentMethod: true,
  } as unknown as PageComponentProps;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...Object.keys(AGREEING)]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  resources[LOOKED_UP_TWICE] = {
    translation: {
      ...readDashboardLocale("en"),
      Paid: "Open",
      Open: "Open it",
    },
  };

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/settings/invoices`,
  );

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const data: Array<BaseModel> =
          options.modelType === BillingInvoice ? INVOICES : [];

        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
      }): Promise<number> => {
        return options.modelType === BillingInvoice ? INVOICES.length : 0;
      },
    );
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/*
 * The invoices, opened from a link that has picked the paid ones, so the
 * filter bar shows its chip and its Edit Filters button. The fake ModelAPI
 * lists every invoice whatever the filter.
 */
async function openInvoices(language: string): Promise<void> {
  const params: Record<string, string> = TableFilterUrlState.getLinkQueryParams(
    "settings-invoices-table",
    { filter: { status: InvoiceStatus.Paid } },
  );
  const search: string = Object.keys(params)
    .map((name: string): string => {
      return `${name}=${params[name]}`;
    })
    .join("&");

  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/settings/invoices?${search}`,
  );

  await i18next.changeLanguage(language);
  await act(async () => {
    render(
      <MemoryRouter>
        <SettingsInvoices {...pageProps()} />
      </MemoryRouter>,
    );
  });
  await settle();

  expect(await screen.findByText("INV-PAID")).toBeInTheDocument();
}

// The status pill of the invoice numbered `number`: under the Invoice Status header.
function statusOf(number: string): string {
  const language: string = i18next.language;
  const header: string =
    language === "en" || language === LOOKED_UP_TWICE
      ? "Invoice Status"
      : readDashboardLocale(language)["Invoice Status"] || "Invoice Status";
  const column: number = screen
    .getAllByRole("columnheader")
    .findIndex((cell: HTMLElement): boolean => {
      return (cell.textContent || "").trim() === header;
    });
  const row: HTMLElement = screen
    .getByText(number)
    .closest("tr") as HTMLElement;
  const cells: Array<HTMLElement> = within(row).getAllByRole("cell");

  expect(column).toBeGreaterThanOrEqual(0);

  return (cells[column]?.textContent || "").trim();
}

// Every value the Invoice Status filter offers, as its menu draws them.
async function statusOptions(
  language: string,
  field: string,
): Promise<Array<string>> {
  // The made-up language words the page's controls as English does.
  const words: Record<string, string> = readDashboardLocale(
    language === LOOKED_UP_TWICE ? "en" : language,
  );

  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: words["Edit Filters"] || "Edit Filters",
      }),
    );
  });
  await settle();

  const label: HTMLElement = screen.getByText(field, { selector: "label" });
  const row: HTMLElement = label.parentElement!.parentElement as HTMLElement;
  const input: HTMLInputElement = row.querySelector<HTMLInputElement>(
    "input[role='combobox']",
  ) as HTMLInputElement;

  await act(async () => {
    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
  });
  await settle();

  return within(document.querySelector(".ou-select__menu") as HTMLElement)
    .getAllByTestId("dropdown-option-label")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });
}

describe("the words the cases below lean on", () => {
  test.each(Object.keys(AGREEING))(
    "%s words the invoice's statuses as an invoice takes them",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const expected: Record<string, string> = AGREEING[language] || {};

      expect(words["Paid"]).toBe(expected["Paid"]);
      expect(words["Void"]).toBe(expected["Void"]);
      expect(words["Open (invoice status)"]).toBe(expected["Open"]);

      if (expected["Uncollectible"]) {
        expect(words["Uncollectible"]).toBe(expected["Uncollectible"]);
      }
    },
  );

  test("the masculine forms the statuses were first worded in are gone", () => {
    expect(readDashboardLocale("es")["Paid"]).not.toBe("Pagado");
    expect(readDashboardLocale("es")["Void"]).not.toBe("Anulado");
    expect(readDashboardLocale("fr")["Paid"]).not.toBe("Payé");
    expect(readDashboardLocale("fr")["Void"]).not.toBe("Annulé");
    expect(readDashboardLocale("it")["Paid"]).not.toBe("Pagato");
    expect(readDashboardLocale("pt")["Paid"]).not.toBe("Pago");
    expect(readDashboardLocale("ar")["Paid"]).not.toBe("مدفوع");
  });
});

describe.each(Object.keys(AGREEING))("invoices in %s", (language: string) => {
  test("each invoice's pill and the Invoice Status menu read its status as an invoice takes it", async () => {
    const words: Record<string, string> = readDashboardLocale(language);
    const expected: Record<string, string> = AGREEING[language] || {};

    await openInvoices(language);

    expect(statusOf("INV-PAID")).toBe(expected["Paid"]);
    expect(statusOf("INV-VOID")).toBe(expected["Void"]);
    expect(statusOf("INV-OPEN")).toBe(expected["Open"]);
    expect(statusOf("INV-UNCOLLECTIBLE")).toBe(words["Uncollectible"]);
    // No status: the word the filter offers it in.
    expect(statusOf("INV-NONE")).toBe(words["Undefined"]);

    expect(
      await statusOptions(
        language,
        words["Invoice Status"] || "Invoice Status",
      ),
    ).toEqual(
      STATUS_KEYS.map((key: string): string => {
        return words[key] || key;
      }),
    );
  });
});

describe("an invoice's status is looked up once, where it is drawn", () => {
  test("a language whose Paid is a key of its own reads that word, never that key's wording", async () => {
    await openInvoices(LOOKED_UP_TWICE);

    // Looked up twice, the pill read "Open"'s wording: "Open it".
    expect(statusOf("INV-PAID")).toBe("Open");
    expect(document.body.textContent).not.toContain("Open it");

    const options: Array<string> = await statusOptions(
      LOOKED_UP_TWICE,
      "Invoice Status",
    );

    expect(options[0]).toBe("Open");
    expect(options).not.toContain("Open it");
  });
});

describe("invoices in English", () => {
  test("every status reads in Stripe's words: an open invoice Open, never its key's own English", async () => {
    await openInvoices("en");

    expect(statusOf("INV-PAID")).toBe("Paid");
    expect(statusOf("INV-VOID")).toBe("Void");
    expect(statusOf("INV-OPEN")).toBe("Open");
    expect(statusOf("INV-UNCOLLECTIBLE")).toBe("Uncollectible");
    expect(statusOf("INV-NONE")).toBe("Undefined");
    // A status no release words yet, as Stripe names it, with a capital.
    expect(statusOf("INV-PROCESSING")).toBe("Processing");

    expect(await statusOptions("en", "Invoice Status")).toEqual([
      "Paid",
      "Draft",
      "Void",
      "Uncollectible",
      "Deleted",
      "Open",
      "Undefined",
    ]);
    expect(document.body.textContent).not.toContain("(invoice status)");
  });
});
