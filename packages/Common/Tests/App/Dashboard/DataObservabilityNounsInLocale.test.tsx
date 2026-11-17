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
 * A DATABASE'S VIEW AND TABLE, AND A SCHEMA CHANGE, READ AS NOUNS (#8078).
 *
 * #7781 made every data asset kind and every schema change a key of the
 * Dashboard's locales, and three of them took a word that every language
 * words as something else: "View" is the View buttons' verb ("Ver",
 * "Anzeigen", "Voir"), "Table" a table on the page (French "Tableau"), and
 * "Change" the Change buttons' verb ("Cambiar", "Ändern", "Modifier"). So a
 * Spanish catalog said a view's kind was "Ver" ("see it"), and the Schema
 * Changes list headed its column and its filter "Cambiar" ("change it").
 *
 * Each has a key that names its meaning now (Common/Types/MeaningKeys),
 * worded as the noun - "Vista", "Sicht", "Vue"; "Tabla", "Tabelle",
 * "Table"; "Cambio", "Änderung", "Modification" - and English still reads
 * "View", "Table" and "Change". Read here on the real pages, over a fake
 * ModelAPI, in Spanish, German and French: the Tables list's Kind filter,
 * its chip and the line under a view's name; the Schema Changes list's
 * column, its filter's label and its chip; a table's Overview; and a
 * lineage card's line under its name. Then the same in English.
 *
 * The same pages' titles after #8176, #7535 and #7533: a database's table
 * titled the Tables, Unused Tables and Schema Changes lists and a table's
 * side menu with the bare "Table", a table on the page (French "Tableau",
 * Chinese 表格); the dbt Tests card headed its tests with the Test buttons'
 * verb ("Testen", "Tester", "Probar"); and the Reconciliations card's
 * Create button kept the model's English name ("Data Reconciliation
 * erstellen" under "Abgleiche").
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // A project owner: may read every list below.
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
            return "80780000-0000-4000-8000-000000000001";
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

// A lineage card's helpers load React Flow, which jsdom cannot draw.
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div");
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return { __esModule: true, default: {} };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Pipelines",
  () => {
    return {
      __esModule: true,
      getRunStatePill: (): React.ReactElement => {
        return React.createElement("span");
      },
    };
  },
);

// A table's Overview reads the table its layout read: a view, here.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/TableView/TableViewContext",
  () => {
    return {
      __esModule: true,
      useTableViewContext: (): { dataAsset: unknown } => {
        return { dataAsset: mockOverviewAsset };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/ReportDataProblem",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("span");
      },
    };
  },
);

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataAssetFeed, {
  DataAssetFeedEventType,
} from "../../../Models/DatabaseModels/DataAssetFeed";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import DataAssetKind, {
  DATA_ASSET_KINDS,
} from "../../../Types/DataObservability/DataAssetKind";
import {
  DataLineageNodeKind,
  DataTableLineageNode,
} from "../../../Types/DataObservability/DataTableLineage";
import { DataCheckType } from "../../../Types/DataObservability/DataCheckType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import Button from "../../../UI/Components/Button/Button";
import DataAssetTable from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataAssetTable";
import DbtTestTable from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DbtTestTable";
import DataObservabilityReconciliationsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Reconciliations";
import TableViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/TableView/SideMenu";
import DataObservabilityUnusedTablesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/UnusedTables";
import {
  DATA_ASSET_KIND_LABELS,
  DATA_ASSET_KIND_OPTIONS,
  getDataAssetKindText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataAssetKindWords";
import { getLineageCardSubtitle } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraph";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DataObservabilitySchemaChangesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/SchemaChanges";
import TableOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/TableView/Overview";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { PROJECT_ID } from "./SideMenuHarness";

// The languages the issue was found in, each word as its Dashboard writes it.
interface Expected {
  language: string;
  view: string;
  viewVerb: string;
  table: string;
  change: string;
  changeVerb: string;
}

const LANGUAGES: ReadonlyArray<Expected> = [
  {
    language: "es",
    view: "Vista",
    viewVerb: "Ver",
    table: "Tabla",
    change: "Cambio",
    changeVerb: "Cambiar",
  },
  {
    language: "de",
    view: "Sicht",
    viewVerb: "Anzeigen",
    table: "Tabelle",
    change: "Änderung",
    changeVerb: "Ändern",
  },
  {
    language: "fr",
    view: "Vue",
    viewVerb: "Voir",
    table: "Table",
    change: "Modification",
    changeVerb: "Modifier",
  },
];

/*
 * The languages that word a table on the page and a database's table apart
 * (#8176): Data Observability titled its lists of tables, a table's page and
 * its side menu's section with the bare "Table", a table on the page.
 */
interface TableWords {
  language: string;
  // A database's table: "Table (database object)".
  database: string;
  // A table on the page: the bare "Table".
  page: string;
}

const TABLE_LANGUAGES: ReadonlyArray<TableWords> = [
  { language: "fr", database: "Table", page: "Tableau" },
  { language: "zh-CN", database: "表", page: "表格" },
  { language: "zh-TW", database: "資料表", page: "表格" },
  { language: "hi", database: "टेबल", page: "तालिका" },
];

// A view, as the Tables list and its Overview read it.
const VIEW_ASSET: DataAsset = Object.assign(new DataAsset(), {
  _id: "80780000-0000-4000-8000-000000000011",
  assetKey: "analytics.daily_revenue",
  name: "daily_revenue",
  schemaName: "analytics",
  assetKind: DataAssetKind.View,
  dataStoreName: "warehouse",
  dataStoreKind: "PostgreSQL",
  isDropped: false,
});

let mockOverviewAsset: DataAsset = VIEW_ASSET;

// A column added to a watched table.
const COLUMN_ADDED: DataAssetFeed = Object.assign(new DataAssetFeed(), {
  _id: "80780000-0000-4000-8000-000000000021",
  dataAssetFeedEventType: DataAssetFeedEventType.ColumnAdded,
  feedInfoInMarkdown: "Column email added.",
  postedAt: new Date("2026-11-14T09:00:00Z"),
});

// A test dbt runs on a watched table, as an upload of its artifacts records it.
const DBT_TEST: DataCheck = Object.assign(new DataCheck(), {
  _id: "80780000-0000-4000-8000-000000000031",
  name: "not_null_orders_customer_id",
  description: "Every order has a customer.",
  checkType: DataCheckType.DbtTest,
  isEnabled: true,
  lastRunStatus: "Passed",
});

function rowsOf(modelType: { new (): BaseModel }): Array<BaseModel> {
  if (modelType === DataAsset) {
    return [VIEW_ASSET];
  }

  if (modelType === DataCheck) {
    return [DBT_TEST];
  }

  if (modelType === DataAssetFeed) {
    return [COLUMN_ADDED];
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

function locale(language: string): Record<string, string> {
  return readDashboardLocale(language);
}

// A word of the Dashboard's, in `language`.
function word(language: string, english: string): string {
  if (language === "en") {
    return english;
  }

  const words: string | undefined = locale(language)[english];

  if (!words) {
    throw new Error(`${language} has no word for "${english}"`);
  }

  return words;
}

// A dropdown filter's chip, as the filter bar words it: "Tipo es Vista".
function chipText(language: string, field: string, value: string): string {
  return word(language, "{{field}} is {{value}}")
    .replace("{{field}}", field)
    .replace("{{value}}", value);
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of [
    "en",
    "es",
    "de",
    "fr",
    ...TABLE_LANGUAGES.map((expected: TableWords): string => {
      return expected.language;
    }),
  ]) {
    resources[language] = { translation: locale(language) };
  }

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
  mockOverviewAsset = VIEW_ASSET;

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

// A list opened from a link that has already picked a filter's value.
async function renderFiltered(data: {
  path: string;
  tableId: string;
  filter: JSONObject;
  element: React.ReactElement;
}): Promise<void> {
  const params: Record<string, string> = TableFilterUrlState.getLinkQueryParams(
    data.tableId,
    { filter: data.filter },
  );
  const search: string = Object.keys(params)
    .map((name: string): string => {
      return `${name}=${params[name]}`;
    })
    .join("&");

  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/${data.path}?${search}`,
  );

  await act(async () => {
    render(<MemoryRouter>{data.element}</MemoryRouter>);
  });
  await settle();
}

// The chip over the list that starts with a filter's name.
function chipOf(field: string): string {
  const chip: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid="applied-filter-chip"]',
    ),
  ).find((element: HTMLElement): boolean => {
    return (element.textContent || "").startsWith(`${field} `);
  });

  if (!chip) {
    throw new Error(`No chip for ${field}`);
  }

  return chip.textContent || "";
}

// Edit Filters, then one filter's menu: what it picked, and every value it offers.
async function openFilterMenu(
  language: string,
  field: string,
): Promise<{ picked: Array<string>; options: Array<string> }> {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: word(language, "Edit Filters") }),
    );
  });
  await settle();

  const label: HTMLElement = screen.getByText(field, { selector: "label" });
  const row: HTMLElement = label.parentElement!.parentElement as HTMLElement;
  const picked: Array<string> = within(row)
    .queryAllByTestId("dropdown-value-label")
    .map((value: HTMLElement): string => {
      return value.textContent || "";
    });
  const input: HTMLInputElement | null = row.querySelector<HTMLInputElement>(
    "input[role='combobox']",
  );

  if (!input) {
    throw new Error(`The ${field} filter has no menu`);
  }

  await act(async () => {
    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
  });
  await settle();

  const menu: HTMLElement | null =
    document.querySelector<HTMLElement>(".ou-select__menu");

  if (!menu) {
    throw new Error(`The ${field} menu did not open`);
  }

  return {
    picked,
    options: within(menu)
      .getAllByTestId("dropdown-option-label")
      .map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
  };
}

// The list's column headers, as drawn.
function columnHeaders(): Array<string> {
  return screen
    .getAllByRole("columnheader")
    .map((header: HTMLElement): string => {
      return (header.textContent || "").trim();
    });
}

async function openTablesFilteredToViews(language: string): Promise<void> {
  await i18next.changeLanguage(language);
  await renderFiltered({
    path: "data-observability/tables",
    tableId: "data-observability-tables",
    filter: { assetKind: DataAssetKind.View },
    element: <DataAssetTable isDropped={false} />,
  });

  expect(
    await screen.findByText("analytics.daily_revenue"),
  ).toBeInTheDocument();
}

async function openSchemaChangesFilteredToColumnsAdded(
  language: string,
): Promise<void> {
  await i18next.changeLanguage(language);
  await renderFiltered({
    path: "data-observability/schema-changes",
    tableId: "data-observability-schema-changes",
    filter: { dataAssetFeedEventType: DataAssetFeedEventType.ColumnAdded },
    element: (
      <DataObservabilitySchemaChangesPage
        {...pageProps("data-observability/schema-changes")}
      />
    ),
  });

  expect(await screen.findByText("Column email added.")).toBeInTheDocument();
}

describe("the words the cases below lean on", () => {
  test.each(LANGUAGES)(
    "$language words a database's view, its table and a schema change as nouns, apart from the buttons' verbs",
    (expected: Expected) => {
      const words: Record<string, string> = locale(expected.language);

      expect(words["View (database object)"]).toBe(expected.view);
      expect(words["Table (database object)"]).toBe(expected.table);
      expect(words["Change (schema change)"]).toBe(expected.change);
      // The bare words are still the buttons'.
      expect(words["View"]).toBe(expected.viewVerb);
      expect(words["Change"]).toBe(expected.changeVerb);
    },
  );

  test("French words a table on the page and a database's table apart", () => {
    expect(locale("fr")["Table"]).toBe("Tableau");
    expect(locale("fr")["Table (database object)"]).toBe("Table");
  });

  test("every kind is a key the Kind filter offers, a view's and a table's naming their meaning", () => {
    expect(
      DATA_ASSET_KIND_OPTIONS.map((option: { value?: unknown }): unknown => {
        return option.value;
      }),
    ).toEqual([...DATA_ASSET_KINDS]);
    expect(DATA_ASSET_KIND_LABELS[DataAssetKind.View]).toBe(
      "View (database object)",
    );
    expect(DATA_ASSET_KIND_LABELS[DataAssetKind.Table]).toBe(
      "Table (database object)",
    );

    for (const kind of DATA_ASSET_KINDS) {
      expect({
        kind,
        isKey: locale("en")[DATA_ASSET_KIND_LABELS[kind]] !== undefined,
      }).toEqual({ kind, isKey: true });
    }
  });
});

describe.each(LANGUAGES)("in $language", (expected: Expected) => {
  const language: string = expected.language;

  test("the Tables list, filtered to views: the chip, the Kind menu and the line under a view's name read the noun, never the View buttons' verb", async () => {
    await openTablesFilteredToViews(language);

    // The row: "warehouse · Vista".
    const row: HTMLElement = screen
      .getByText("analytics.daily_revenue")
      .closest("tr") as HTMLElement;

    expect(row).toHaveTextContent(`warehouse · ${expected.view}`);
    expect(row).not.toHaveTextContent(`· ${expected.viewVerb}`);

    // The chip: "Tipo es Vista".
    const kind: string = word(language, "Kind");

    expect(chipOf(kind)).toBe(chipText(language, kind, expected.view));

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(language, kind);

    expect(menu.picked).toEqual([expected.view]);
    expect(menu.options).toEqual(
      DATA_ASSET_KINDS.map((assetKind: DataAssetKind): string => {
        return word(language, DATA_ASSET_KIND_LABELS[assetKind]);
      }),
    );
    expect(menu.options[0]).toBe(expected.table);
    expect(menu.options[1]).toBe(expected.view);
    expect(menu.options).not.toContain(expected.viewVerb);

    // Where a table on the page is a word of its own: French "Tableau".
    if (word(language, "Table") !== expected.table) {
      expect(menu.options).not.toContain(word(language, "Table"));
    }

    expect(document.body.textContent).not.toContain("(database object)");
  });

  test("the Schema Changes list, filtered to the columns added: its column, its filter's label and its chip read the noun, never the Change buttons' verb", async () => {
    await openSchemaChangesFilteredToColumnsAdded(language);

    expect(columnHeaders()).toContain(expected.change);
    expect(columnHeaders()).not.toContain(expected.changeVerb);

    // The chip: "Cambio es Columna añadida".
    expect(chipOf(expected.change)).toBe(
      chipText(language, expected.change, word(language, "Column added")),
    );

    // The filter's label in Edit Filters.
    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu(language, expected.change);

    expect(menu.picked).toEqual([word(language, "Column added")]);
    expect(
      screen.queryByText(expected.changeVerb, { selector: "label" }),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("(schema change)");
  });

  test("a view's Overview names its kind with the noun", async () => {
    await i18next.changeLanguage(language);
    await act(async () => {
      render(
        <MemoryRouter>
          <TableOverviewPage
            {...pageProps(`data-observability/tables/${VIEW_ASSET._id}`)}
          />
        </MemoryRouter>,
      );
    });
    await settle();

    const kind: HTMLElement = screen.getByText(word(language, "Kind"), {
      selector: "dt",
    });

    expect(kind.nextElementSibling).toHaveTextContent(expected.view);
    expect(kind.nextElementSibling?.textContent).not.toBe(expected.viewVerb);
  });

  test("a lineage card says what a table and a view are with the nouns", () => {
    const translator: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator(language);
    const card: (kind: DataAssetKind) => DataTableLineageNode = (
      kind: DataAssetKind,
    ): DataTableLineageNode => {
      return {
        id: `table:${kind}`,
        kind: DataLineageNodeKind.Table,
        name: "orders",
        database: "Warehouse",
        assetKind: kind,
      } as unknown as DataTableLineageNode;
    };

    expect(getLineageCardSubtitle(card(DataAssetKind.Table), translator)).toBe(
      `Warehouse · ${expected.table}`,
    );
    expect(getLineageCardSubtitle(card(DataAssetKind.View), translator)).toBe(
      `Warehouse · ${expected.view}`,
    );
    expect(
      getLineageCardSubtitle(card(DataAssetKind.MaterializedView), translator),
    ).toBe(`Warehouse · ${word(language, "Materialized View")}`);
  });
});

describe("in English", () => {
  test("the Tables list reads View and Table: never a key's own English", async () => {
    await openTablesFilteredToViews("en");

    const row: HTMLElement = screen
      .getByText("analytics.daily_revenue")
      .closest("tr") as HTMLElement;

    expect(row).toHaveTextContent("warehouse · View");
    expect(chipOf("Kind")).toBe("Kind is View");

    const menu: { picked: Array<string>; options: Array<string> } =
      await openFilterMenu("en", "Kind");

    expect(menu.picked).toEqual(["View"]);
    expect(menu.options).toEqual([
      "Table",
      "View",
      "Materialized View",
      "Partitioned Table",
      "Foreign Table",
      "Storage Path",
    ]);
    expect(document.body.textContent).not.toContain("(database object)");
  });

  test("the Schema Changes list heads its column and its filter Change: never the key's own English", async () => {
    await openSchemaChangesFilteredToColumnsAdded("en");

    expect(columnHeaders()).toContain("Change");
    expect(chipOf("Change")).toBe("Change is Column added");

    await openFilterMenu("en", "Change");

    expect(screen.getByText("Change", { selector: "label" })).toBeVisible();
    expect(document.body.textContent).not.toContain("(schema change)");
  });

  test("a view's Overview and a lineage card name the kind View, and a table's Table", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <TableOverviewPage
            {...pageProps(`data-observability/tables/${VIEW_ASSET._id}`)}
          />
        </MemoryRouter>,
      );
    });
    await settle();

    expect(
      screen.getByText("Kind", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent("View");
    expect(document.body.textContent).not.toContain("(database object)");

    const english: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator("en");

    expect(getDataAssetKindText(english, DataAssetKind.Table)).toBe("Table");
    expect(getDataAssetKindText(english, DataAssetKind.View)).toBe("View");
  });

  test("a kind a newer server added reads as it is stored", () => {
    expect(
      getDataAssetKindText(dashboardTranslator("es"), "External Stage"),
    ).toBe("External Stage");
  });
});

// A list's page, drawn in `language` over the fake ModelAPI.
async function drawInLanguage(
  language: string,
  path: string,
  element: React.ReactElement,
): Promise<void> {
  await i18next.changeLanguage(language);
  window.history.replaceState(null, "", `/dashboard/${PROJECT_ID}/${path}`);

  await act(async () => {
    render(<MemoryRouter>{element}</MemoryRouter>);
  });
  await settle();
}

// The list's column headers that name a column: the select-all box's left out.
function namedColumnHeaders(): Array<string> {
  return screen
    .getAllByRole("columnheader")
    .filter((header: HTMLElement): boolean => {
      return !header.querySelector("input[type='checkbox']");
    })
    .map((header: HTMLElement): string => {
      return (header.textContent || "").trim();
    });
}

// The heading of each section of the side menu drawn, as drawn.
function sideMenuSections(): Array<string> {
  return Array.from(document.querySelectorAll<HTMLElement>("h6")).map(
    (heading: HTMLElement): string => {
      return (heading.textContent || "").trim();
    },
  );
}

/*
 * #8176: a database's table titled with the bare "Table" read as a table
 * on the page - French "Tableau", Chinese 表格, Hindi तालिका - over a list
 * of database tables, beside a Kind filter that said "Table".
 */
describe.each(TABLE_LANGUAGES)(
  "in $language, a database's table is titled as one (#8176)",
  (expected: TableWords) => {
    const language: string = expected.language;

    test("the words below: a database's table and a table on the page are two words", () => {
      expect(word(language, "Table (database object)")).toBe(expected.database);
      expect(word(language, "Table")).toBe(expected.page);
      expect(expected.database).not.toBe(expected.page);
    });

    test("the Tables list heads its first column with the database's table", async () => {
      await drawInLanguage(
        language,
        "data-observability/tables",
        <DataAssetTable isDropped={false} />,
      );

      expect(
        await screen.findByText("analytics.daily_revenue"),
      ).toBeInTheDocument();
      expect(namedColumnHeaders()[0]).toBe(expected.database);
      expect(columnHeaders()).not.toContain(expected.page);
      expect(document.body.textContent).not.toContain("(database object)");
    });

    test("the Schema Changes list heads its Table column with the database's table", async () => {
      await drawInLanguage(
        language,
        "data-observability/schema-changes",
        <DataObservabilitySchemaChangesPage
          {...pageProps("data-observability/schema-changes")}
        />,
      );

      expect(
        await screen.findByText("Column email added."),
      ).toBeInTheDocument();
      expect(columnHeaders()).toContain(expected.database);
      expect(columnHeaders()).not.toContain(expected.page);
    });

    test("the Unused Tables list heads its first column with the database's table", async () => {
      await drawInLanguage(
        language,
        "data-observability/tables/unused",
        <DataObservabilityUnusedTablesPage
          {...pageProps("data-observability/tables/unused")}
        />,
      );

      expect(
        await screen.findByText("analytics.daily_revenue"),
      ).toBeInTheDocument();
      expect(namedColumnHeaders()[0]).toBe(expected.database);
      expect(columnHeaders()).not.toContain(expected.page);
    });

    test("a table's side menu names its first section with the database's table", async () => {
      await drawInLanguage(
        language,
        `data-observability/tables/${VIEW_ASSET._id}`,
        <TableViewSideMenu modelId={new ObjectID(VIEW_ASSET._id!)} />,
      );

      expect(sideMenuSections()[0]).toBe(expected.database);
      expect(sideMenuSections()).not.toContain(expected.page);
    });
  },
);

describe("in English, a database's table is still titled Table (#8176)", () => {
  test("the Tables, Unused Tables and Schema Changes lists, and a table's side menu", async () => {
    await drawInLanguage(
      "en",
      "data-observability/tables",
      <DataAssetTable isDropped={false} />,
    );
    expect(namedColumnHeaders()[0]).toBe("Table");
    cleanup();

    await drawInLanguage(
      "en",
      "data-observability/tables/unused",
      <DataObservabilityUnusedTablesPage
        {...pageProps("data-observability/tables/unused")}
      />,
    );
    expect(namedColumnHeaders()[0]).toBe("Table");
    cleanup();

    await drawInLanguage(
      "en",
      "data-observability/schema-changes",
      <DataObservabilitySchemaChangesPage
        {...pageProps("data-observability/schema-changes")}
      />,
    );
    expect(columnHeaders()).toContain("Table");
    cleanup();

    await drawInLanguage(
      "en",
      `data-observability/tables/${VIEW_ASSET._id}`,
      <TableViewSideMenu modelId={new ObjectID(VIEW_ASSET._id!)} />,
    );
    expect(sideMenuSections()[0]).toBe("Table");
    expect(document.body.textContent).not.toContain("(database object)");
  });
});

// The dbt Tests card, opened from a link that has already narrowed it to some tests.
async function renderFilteredToNotNullTests(): Promise<void> {
  await renderFiltered({
    path: "data-observability/checks",
    tableId: "data-observability-dbt-tests",
    filter: { name: "not_null" },
    element: <DbtTestTable />,
  });
}

// The languages #7535 was found in: the Test buttons' verb, and a dbt test's noun.
interface DbtTestWords {
  language: string;
  noun: string;
  verb: string;
}

const DBT_TEST_LANGUAGES: ReadonlyArray<DbtTestWords> = [
  { language: "de", noun: "Test", verb: "Testen" },
  { language: "fr", noun: "Test", verb: "Tester" },
  { language: "es", noun: "Prueba", verb: "Probar" },
];

/*
 * #7535: the dbt Tests card headed its column of test names, and the
 * filter for it, with the Test buttons' verb: "Testen", "Tester", "Probar"
 * ("to try") over a column of tests. The heading shows with no results too.
 */
describe.each(DBT_TEST_LANGUAGES)(
  "in $language, the dbt Tests card (#7535)",
  (expected: DbtTestWords) => {
    const language: string = expected.language;

    test("heads its column of tests with the noun, never the Test buttons' verb", async () => {
      await drawInLanguage(
        language,
        "data-observability/checks",
        <DbtTestTable />,
      );

      expect(
        await screen.findByText("not_null_orders_customer_id"),
      ).toBeInTheDocument();
      expect(namedColumnHeaders()[0]).toBe(expected.noun);
      expect(columnHeaders()).not.toContain(expected.verb);
      expect(document.body.textContent).not.toContain("(dbt test)");
    });

    test("names its filter for the tests with the noun, in its chip and in Edit Filters", async () => {
      await i18next.changeLanguage(language);
      await renderFilteredToNotNullTests();

      // The chip: "Test enthält not_null", never "Testen enthält ...".
      expect(chipOf(expected.noun)).toContain("not_null");
      expect(() => {
        return chipOf(expected.verb);
      }).toThrow();

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: word(language, "Edit Filters") }),
        );
      });
      await settle();

      expect(
        screen.getByText(expected.noun, { selector: "label" }),
      ).toBeVisible();
      expect(
        screen.queryByText(expected.verb, { selector: "label" }),
      ).toBeNull();
    });

    test("while a Test button elsewhere keeps the verb", async () => {
      await i18next.changeLanguage(language);
      await act(async () => {
        render(<Button title="Test" onClick={() => {}} />);
      });

      expect(screen.getByRole("button")).toHaveTextContent(expected.verb);
    });
  },
);

describe("in English, the dbt Tests card heads its column Test (#7535)", () => {
  test("its column and its filter read Test, never the key's own English", async () => {
    await drawInLanguage("en", "data-observability/checks", <DbtTestTable />);

    expect(
      await screen.findByText("not_null_orders_customer_id"),
    ).toBeInTheDocument();
    expect(namedColumnHeaders()[0]).toBe("Test");
    cleanup();

    await renderFilteredToNotNullTests();

    expect(chipOf("Test")).toContain("not_null");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit Filters" }));
    });
    await settle();

    expect(screen.getByText("Test", { selector: "label" })).toBeVisible();
    expect(document.body.textContent).not.toContain("(dbt test)");
  });
});

/*
 * #7533: the Reconciliations card, titled "Abgleiche" like its side menu
 * entry, offered "Data Reconciliation erstellen": the model's name kept its
 * English in 15 of the 17 languages.
 */
describe("the Reconciliations card's Create button names a reconciliation as its title does (#7533)", () => {
  test.each([
    ["de", "Abgleich erstellen"],
    ["es", "Crear Conciliación"],
    ["en", "Create Data Reconciliation"],
  ])("in %s, %j", async (language: string, button: string) => {
    await drawInLanguage(
      language,
      "data-observability/reconciliations",
      <DataObservabilityReconciliationsPage
        {...pageProps("data-observability/reconciliations")}
      />,
    );

    const labels: Array<string> = screen
      .getAllByRole("button")
      .map((candidate: HTMLElement): string => {
        return (candidate.textContent || "").trim();
      });

    expect(labels).toContain(button);

    if (language !== "en") {
      expect(document.body.textContent).not.toContain("Data Reconciliation");
    }
  });
});
