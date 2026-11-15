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
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * THE CHECKS AND RECONCILIATIONS LISTS FIT THEIR CARD AT 1280PX (#7534).
 *
 * Beside the side menu, at a 1280px window, a card is about 940px wide.
 * Two Data Observability lists ran past it, and the sticky actions column
 * - Run Now and the row's ⋯ - covered the column before it:
 *
 *   - Checks, in German, was 46px wider than its card: the Alert column's
 *     "Ungewöhnlich niedrig" read "Ungewöhnlich", "Keine Warnung" lost its
 *     last letters.
 *   - Reconciliations, in English, cut its Status badges to "In Ste..." and
 *     "Drifte..."; in German only "St" of the Status heading showed.
 *
 * A list that does not fit its card folds the columns its page marks
 * foldable, each value drawn under the column the page names (TableFit,
 * Column.foldInto): a check's Alert under its Status, a reconciliation's
 * Target under its Source and its Difference under its Status, each with
 * its column's name. Run Now and the ⋯ stay where they are. Where the list
 * fits - the Checks list in English, any list in a wider window - every
 * column is drawn as before.
 *
 * jsdom lays nothing out: the card's box and each header cell's width are
 * handed out here as Chromium draws them in each language (the table's
 * width is the sum of its header cells, TableFitInTable's way). The real
 * pages are drawn - DataCheckTable and the Reconciliations page, through
 * the real ModelTable and Table - over a fake ModelAPI.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // A project owner: may read, run and delete every check.
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
            return "75340000-0000-4000-8000-000000000001";
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        // No open alert: each check's Status is what its last run says.
        getCheckHealth: async (): Promise<Map<string, unknown>> => {
          return new Map();
        },
      },
    };
  },
);

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import {
  DataCheckAlertCondition,
  DataCheckRunStatus,
  DataCheckType,
} from "../../../Types/DataObservability/DataCheckType";
import {
  DataReconciliationMeasure,
  DataReconciliationStatus,
  DataReconciliationToleranceType,
} from "../../../Types/DataObservability/DataReconciliation";
import ObjectID from "../../../Types/ObjectID";
import {
  TABLE_FOLDED_VALUE_CLASS_NAME,
  TABLE_FOLDED_VALUE_TEST_ID,
  TABLE_FOLDED_VALUE_TITLE_TEST_ID,
} from "../../../UI/Components/Table/TableFoldedValues";
import { forgetRememberedTableFits } from "../../../UI/Components/Table/useTableFit";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import DataCheckTable from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckTable";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DataObservabilityReconciliationsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Reconciliations";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { PROJECT_ID } from "./SideMenuHarness";

// The window, and the card beside the side menu in it (TableLayout).
const LAPTOP_WINDOW: number = 1280;
const LAPTOP_CARD: number = 938;
// A wide screen, where the card has room for every column.
const WIDE_WINDOW: number = 1920;
const WIDE_CARD: number = 1578;
// A small laptop beside the side menu: a card narrower than 48rem always folds.
const TABLET_WINDOW: number = 1100;
const TABLET_CARD: number = 758;

let boxWidth: number = LAPTOP_CARD;

/*
 * Each header cell's width, by its column, in each language: what each
 * column's widest value and its header need, with its padding, as Chromium
 * lays the rows below out in Inter at 1280px. The select box is 48px.
 */
type ColumnWidths = Record<string, number>;

const SELECT_BOX_WIDTH: number = 48;

const CHECKS_WIDTHS: Record<string, ColumnWidths> = {
  // 878px in all: the English list fits its 938px card.
  en: {
    Name: 300,
    "Last Value": 96,
    Status: 196,
    Alert: 126,
    Actions: 112,
  },
  // 984px: 46px past the card, Run Now over the Alert column.
  de: {
    Name: 300,
    "Last Value": 104,
    Status: 230,
    Alert: 166,
    Actions: 136,
  },
};

const RECONCILIATIONS_WIDTHS: Record<string, ColumnWidths> = {
  // 994px: 56px past the card, Run Now over the Status badges.
  en: {
    Reconciliation: 280,
    Source: 170,
    Target: 170,
    Difference: 96,
    Status: 110,
    Actions: 120,
  },
  // 1,058px: the Status column all but hidden.
  de: {
    Reconciliation: 280,
    Source: 170,
    Target: 170,
    Difference: 100,
    Status: 120,
    Actions: 170,
  },
};

let widths: ColumnWidths = CHECKS_WIDTHS["en"]!;
let language: string = "en";

// A word of the Dashboard's, in the language drawn.
function word(english: string): string {
  if (language === "en") {
    return english;
  }

  const words: string | undefined = readDashboardLocale(language)[english];

  if (!words) {
    throw new Error(`${language} has no word for "${english}"`);
  }

  return words;
}

// A header cell's width: its column's, by the title it draws.
function headerWidth(cell: Element): number {
  if (cell.querySelector("input[type='checkbox']")) {
    return SELECT_BOX_WIDTH;
  }

  const title: string = withoutIsolateMarks(cell.textContent || "").trim();

  for (const column of Object.keys(widths)) {
    if (title === word(column)) {
      return widths[column]!;
    }
  }

  throw new Error(`No width for the column "${title}" in ${language}`);
}

function rect(width: number): DOMRect {
  return {
    width: width,
    height: 40,
    top: 0,
    left: 0,
    right: width,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON: (): unknown => {
      return {};
    },
  } as DOMRect;
}

function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

const NOW: number = Date.now();

function minutesAgo(minutes: number): Date {
  return new Date(NOW - minutes * 60 * 1000);
}

function check(
  index: number,
  name: string,
  alertCondition: DataCheckAlertCondition | null,
): DataCheck {
  return Object.assign(new DataCheck(), {
    _id: `75340000-0000-4000-8000-00000000010${index}`,
    name: name,
    checkType: DataCheckType.NullPercent,
    columnName: "customer_id",
    isEnabled: true,
    lastRunStatus: DataCheckRunStatus.Ran,
    lastRunAt: minutesAgo(5),
    lastValue: 0.4,
    alertCondition: alertCondition,
    alertThreshold: null,
  });
}

// One check that alerts when unusually high, one when unusually low, one with no alert.
const CHECKS: Array<DataCheck> = [
  check(1, "customer_id is filled in", DataCheckAlertCondition.UnusuallyHigh),
  check(2, "Rows per tenant", DataCheckAlertCondition.UnusuallyLow),
  check(3, "status takes its usual values", null),
];

function reconciliation(
  index: number,
  name: string,
  status: DataReconciliationStatus,
  difference: number,
): DataReconciliation {
  return Object.assign(new DataReconciliation(), {
    _id: `75340000-0000-4000-8000-00000000020${index}`,
    name: name,
    sourceMeasure: DataReconciliationMeasure.RowCount,
    targetMeasure: DataReconciliationMeasure.RowCount,
    toleranceType: DataReconciliationToleranceType.Percent,
    tolerance: 0.5,
    sourceDataAsset: { assetKey: "public.orders" },
    targetDataAsset: { assetKey: "analytics.orders" },
    sourceValue: 1204,
    targetValue: 1204 + difference,
    difference: difference,
    differencePercent: (difference / 1204) * 100,
    status: status,
    comparedAt: minutesAgo(5),
  });
}

const RECONCILIATIONS: Array<DataReconciliation> = [
  reconciliation(
    1,
    "Orders: app and warehouse",
    DataReconciliationStatus.InStep,
    0,
  ),
  reconciliation(
    2,
    "Orders after the migration",
    DataReconciliationStatus.Drifted,
    -14,
  ),
];

function rowsOf(modelType: { new (): BaseModel }): Array<BaseModel> {
  if (modelType === DataCheck) {
    return CHECKS;
  }

  if (modelType === DataReconciliation) {
    return RECONCILIATIONS;
  }

  return [];
}

function pageProps(path: string): PageComponentProps {
  return {
    pageRoute: new Route(`/dashboard/${PROJECT_ID}/${path}`),
    currentProject: null,
    hasPaymentMethod: true,
  } as unknown as PageComponentProps;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
    },
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
  boxWidth = LAPTOP_CARD;
  setWindowWidth(LAPTOP_WINDOW);

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
        const data: Array<BaseModel> = rowsOf(options.modelType);

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
        return rowsOf(options.modelType).length;
      },
    );
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);

  jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element): DOMRect {
      if (this.getAttribute("data-testid") === "table-scroll") {
        return rect(boxWidth);
      }

      if (this.tagName === "TABLE") {
        let width: number = 0;

        this.querySelectorAll("thead th").forEach((cell: Element) => {
          width += headerWidth(cell);
        });

        return rect(width);
      }

      return rect(0);
    });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  forgetRememberedTableFits();
  await i18next.changeLanguage("en");
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 25; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function draw(data: {
  inLanguage: string;
  window: number;
  card: number;
  columnWidths: Record<string, ColumnWidths>;
  element: React.ReactElement;
  waitFor: string;
}): Promise<void> {
  language = data.inLanguage;
  widths = data.columnWidths[data.inLanguage]!;
  boxWidth = data.card;
  setWindowWidth(data.window);
  await i18next.changeLanguage(data.inLanguage);

  await act(async () => {
    render(<MemoryRouter>{data.element}</MemoryRouter>);
  });
  await settle();

  expect(await screen.findByText(data.waitFor)).toBeInTheDocument();
  await settle();
}

async function drawChecks(
  inLanguage: string,
  window: number = LAPTOP_WINDOW,
  card: number = LAPTOP_CARD,
): Promise<void> {
  await draw({
    inLanguage,
    window,
    card,
    columnWidths: CHECKS_WIDTHS,
    element: <DataCheckTable />,
    waitFor: "Rows per tenant",
  });
}

async function drawReconciliations(
  inLanguage: string,
  window: number = LAPTOP_WINDOW,
  card: number = LAPTOP_CARD,
): Promise<void> {
  await draw({
    inLanguage,
    window,
    card,
    columnWidths: RECONCILIATIONS_WIDTHS,
    element: (
      <DataObservabilityReconciliationsPage
        {...pageProps("data-observability/reconciliations")}
      />
    ),
    waitFor: "Orders after the migration",
  });
}

// The list's column headers that name a column, as drawn.
function columnHeaders(): Array<string> {
  return Array.from(document.querySelectorAll<HTMLElement>("thead th"))
    .filter((cell: HTMLElement): boolean => {
      return !cell.querySelector("input[type='checkbox']");
    })
    .map((cell: HTMLElement): string => {
      return withoutIsolateMarks(cell.textContent || "").trim();
    })
    .filter((title: string): boolean => {
      return title !== word("Actions");
    });
}

// The row that draws `name`.
function rowOf(name: string): HTMLElement {
  const row: HTMLElement | null = screen.getByText(name).closest("tr");

  if (!row) {
    throw new Error(`No row for ${name}`);
  }

  return row;
}

// The values folded into a row's cells: each column's name and what it says.
function foldedValuesOf(
  row: HTMLElement,
): Array<{ title: string; value: string }> {
  return within(row)
    .queryAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)
    .map((line: HTMLElement): { title: string; value: string } => {
      const title: string =
        within(line).queryByTestId(TABLE_FOLDED_VALUE_TITLE_TEST_ID)
          ?.textContent || "";

      return {
        title: title,
        value: withoutIsolateMarks(
          (line.textContent || "").slice(title.length),
        ).trim(),
      };
    });
}

// The cell of a row under the column titled `title`.
function cellOf(row: HTMLElement, title: string): HTMLElement {
  const headers: Array<HTMLElement> = Array.from(
    document.querySelectorAll<HTMLElement>("thead th"),
  );
  const index: number = headers.findIndex((cell: HTMLElement): boolean => {
    return withoutIsolateMarks(cell.textContent || "").trim() === title;
  });

  if (index < 0) {
    throw new Error(`No column ${title}`);
  }

  return row.querySelectorAll<HTMLElement>("td")[index] as HTMLElement;
}

describe("the Checks list at 1280px beside the side menu (#7534)", () => {
  test("in German, the list folds: the Alert column goes under each check's Status, named, its words whole", async () => {
    await drawChecks("de");

    expect(columnHeaders()).toEqual([
      word("Name"),
      word("Last Value"),
      word("Status"),
    ]);
    expect(columnHeaders()).not.toContain(word("Alert"));

    const expected: Array<[string, string]> = [
      ["customer_id is filled in", word("Unusually High")],
      ["Rows per tenant", word("Unusually Low")],
      ["status takes its usual values", word("No alert")],
    ];

    for (const [name, alert] of expected) {
      const row: HTMLElement = rowOf(name);
      const status: HTMLElement = cellOf(row, word("Status"));

      // Under the Status, with the column's name: "Warnung Ungewöhnlich niedrig".
      expect(foldedValuesOf(status)).toEqual([
        { title: word("Alert"), value: alert },
      ]);
    }

    // The words the issue saw cut short are drawn whole.
    expect(word("Unusually Low")).toBe("Ungewöhnlich niedrig");
    expect(word("No alert")).toBe("Keine Warnung");
  });

  test("in German, a folded alert wraps inside the Status column rather than widen it", async () => {
    await drawChecks("de");

    const line: HTMLElement = within(rowOf("Rows per tenant")).getByTestId(
      TABLE_FOLDED_VALUE_TEST_ID,
    );

    expect(line.className).toBe(TABLE_FOLDED_VALUE_CLASS_NAME);
    expect(line.className.split(" ")).toContain("whitespace-normal");
  });

  test("in German, each row keeps Run Now where it was", async () => {
    await drawChecks("de");

    for (const check of CHECKS) {
      expect(
        within(rowOf(check.name!)).getByRole("button", {
          name: word("Run Now"),
        }),
      ).toBeInTheDocument();
    }
  });

  /*
   * #8345: measured in Chromium at 1100px, the German list still ran 11px
   * past its card with "Jetzt ausführen" on every row. The row's button
   * says the verb, and is named by its whole title.
   */
  test.each([
    ["en", "Run"],
    ["de", "Ausführen"],
  ])(
    "in %s, each row's button says %s, named by its whole title",
    async (inLanguage: string, shown: string) => {
      await drawChecks(inLanguage);

      for (const check of CHECKS) {
        const button: HTMLElement = within(rowOf(check.name!)).getByRole(
          "button",
          { name: word("Run Now") },
        );

        expect(withoutIsolateMarks(button.textContent || "").trim()).toBe(
          shown,
        );
      }

      expect(word("Run Now").toLowerCase()).toContain(shown.toLowerCase());
    },
  );

  test("in English, the list fits: every column is drawn as before, nothing folded", async () => {
    await drawChecks("en");

    expect(columnHeaders()).toEqual(["Name", "Last Value", "Status", "Alert"]);
    expect(screen.queryAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)).toEqual([]);

    const row: HTMLElement = rowOf("Rows per tenant");

    expect(cellOf(row, "Alert")).toHaveTextContent("Unusually Low");
    expect(
      within(row).getByRole("button", { name: "Run Now" }),
    ).toBeInTheDocument();
  });

  test("in German on a wide screen, the card has room: every column is drawn", async () => {
    await drawChecks("de", WIDE_WINDOW, WIDE_CARD);

    expect(columnHeaders()).toContain(word("Alert"));
    expect(screen.queryAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)).toEqual([]);
  });

  test("beside the side menu at 1100px, a card narrower than 48rem folds the alert though the rows would fit", async () => {
    await drawChecks("en", TABLET_WINDOW, TABLET_CARD);

    expect(columnHeaders()).not.toContain("Alert");
    expect(foldedValuesOf(cellOf(rowOf("Rows per tenant"), "Status"))).toEqual([
      { title: "Alert", value: "Unusually Low" },
    ]);
  });
});

describe("the Reconciliations list at 1280px beside the side menu (#7534)", () => {
  test.each(["en", "de"])(
    "in %s, the list folds: Target goes under Source and Difference under Status, each named, the Status badges whole",
    async (inLanguage: string) => {
      await drawReconciliations(inLanguage);

      expect(columnHeaders()).toEqual([
        word("Reconciliation"),
        word("Source"),
        word("Status"),
      ]);

      const drifted: HTMLElement = rowOf("Orders after the migration");

      expect(foldedValuesOf(cellOf(drifted, word("Source")))).toEqual([
        {
          title: word("Target"),
          value: expect.stringContaining("analytics.orders"),
        },
      ]);

      const status: HTMLElement = cellOf(drifted, word("Status"));
      const folded: Array<{ title: string; value: string }> =
        foldedValuesOf(status);

      expect(folded).toHaveLength(1);
      expect(folded[0]!.title).toBe(word("Difference"));
      expect(folded[0]!.value).toMatch(/-14|−14/);

      // The badges the issue saw cut short.
      expect(status).toHaveTextContent(word("Drifted"));
      expect(
        cellOf(rowOf("Orders: app and warehouse"), word("Status")),
      ).toHaveTextContent(word("In Step"));

      // Run Now stays at each row's end.
      expect(
        within(drifted).getByRole("button", { name: word("Run Now") }),
      ).toBeInTheDocument();
    },
  );

  test("in German, each row's button says Ausführen, named Jetzt ausführen, as the Checks list's does", async () => {
    await drawReconciliations("de");

    const button: HTMLElement = within(
      rowOf("Orders after the migration"),
    ).getByRole("button", { name: "Jetzt ausführen" });

    expect(withoutIsolateMarks(button.textContent || "").trim()).toBe(
      "Ausführen",
    );
  });

  test("on a wide screen, every column is drawn as before", async () => {
    await drawReconciliations("de", WIDE_WINDOW, WIDE_CARD);

    expect(columnHeaders()).toEqual([
      word("Reconciliation"),
      word("Source"),
      word("Target"),
      word("Difference"),
      word("Status"),
    ]);
    expect(screen.queryAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)).toEqual([]);
  });
});

describe("the harness (negative control)", () => {
  test("a list with no foldable column still runs past the card: only the folds make it fit", async () => {
    // The English Reconciliations list, every column held: 994px in a 938px card.
    language = "en";
    widths = RECONCILIATIONS_WIDTHS["en"]!;

    const total: number =
      SELECT_BOX_WIDTH +
      Object.values(widths).reduce((sum: number, width: number): number => {
        return sum + width;
      }, 0);

    expect(total).toBeGreaterThan(LAPTOP_CARD);
    expect(
      total - widths["Target"]! - widths["Difference"]!,
    ).toBeLessThanOrEqual(LAPTOP_CARD);

    // The German Checks list: 46px past its card, as the issue measured it.
    widths = CHECKS_WIDTHS["de"]!;

    const checks: number =
      SELECT_BOX_WIDTH +
      Object.values(widths).reduce((sum: number, width: number): number => {
        return sum + width;
      }, 0);

    expect(checks - LAPTOP_CARD).toBe(46);
  });
});
