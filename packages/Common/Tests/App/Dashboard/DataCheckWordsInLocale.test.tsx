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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE CHECKS TAB IN THE READER'S WORDS (#7221, #7223).
 *
 * Suggested Checks named each check and said why in English on every page,
 * and Add saved the English; and what a check measures - Null Percent,
 * Orphan Count, Row Count - read English under each check's name, in the
 * Check dropdown and filter, and in each suggestion's facts. Each is now
 * drawn in the reader's language, read here from the locale files
 * themselves; English reads exactly as before.
 *
 * The table and the reconciliations' list are captured instead of rendered
 * (only the props they hand ModelTable are under test); the suggestions
 * are drawn by the real component and the real suggestDataChecks, their
 * reads mocked.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];
const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const getDismissalsMock: MockFunction = getJestMockFunction();
const dismissMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationDismissalUtil",
  () => {
    return {
      __esModule: true,
      default: {
        getDismissals: (...args: Array<any>) => {
          return getDismissalsMock(...args);
        },
        dismiss: (...args: Array<any>) => {
          return dismissMock(...args);
        },
      },
    };
  },
);

/*
 * The components come last: requiring them runs the factories above.
 */
import DataObservabilityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import DataCheckTable, {
  DATA_CHECK_FACTS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckTable";
import {
  DATA_CHECK_FACT_CLASS_NAME,
  DATA_CHECK_FACTS_LINE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckFactsLine";
import { DATA_CHECK_TYPE_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckTypeWords";
import { DATA_CHECK_FORMAT_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckFormatWords";
import {
  DATA_CHECK_FORMATS,
  DataCheckFormat,
} from "../../../Types/DataObservability/DataCheckFormats";
import SuggestedDataChecks, {
  SUGGESTED_CHECK_BUTTONS_CLASS_NAME,
  SUGGESTED_CHECK_FACTS_TEST_ID,
  SUGGESTED_CHECK_NAME_TEST_ID,
  SUGGESTED_CHECK_REASON_TEST_ID,
  SUGGESTED_CHECK_ROW_CLASS_NAME,
  SUGGESTED_CHECKS_ERROR_TEST_ID,
  SUGGESTED_CHECKS_LIST_CLASS_NAME,
  SuggestedChecksWhatFailed,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/SuggestedDataChecks";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  CustomSqlRefusal,
  DataReconciliationRefusal,
  MongoPipelineRefusal,
} from "../../../Types/DataObservability/DataCheckRefusals";
import APIException from "../../../Types/Exception/ApiException";
import {
  getExplanationWords,
  getUnexplainedServerErrorMessage,
  readUnexplainedError,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import { BILLING_ENABLED } from "../../../UI/Config";
import { joinSentences } from "../../../UI/Utils/SentenceSeparator";
import DataObservabilityReconciliationsPage, {
  RECONCILIATION_MEASURES_LINE_CLASS_NAME,
  RECONCILIATION_STATUS_MESSAGE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Reconciliations";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import Route from "../../../Types/API/Route";
import { DataAssetColumn } from "../../../Types/DataObservability/DataAssetColumn";
import {
  DATA_CHECK_SUGGESTION_SENTENCES,
  DataCheckSuggestion,
  DataCheckSuggestionWords,
  suggestDataChecks,
} from "../../../Types/DataObservability/DataCheckSuggestions";
import {
  DATA_CHECK_TYPES,
  DataCheckRunStatus,
  DataCheckType,
} from "../../../Types/DataObservability/DataCheckType";
import { DataColumnSensitivity } from "../../../Types/DataObservability/DataColumnSensitivity";
import {
  DataReconciliationMeasure,
  DataReconciliationToleranceType,
} from "../../../Types/DataObservability/DataReconciliation";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import ObjectID from "../../../Types/ObjectID";
import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

interface CapturedColumn {
  title?: string;
  field?: Record<string, unknown>;
  getElement?: (item: never) => ReactElement;
  hideBelowLargeScreen?: boolean;
  foldInto?: string;
  showTitleWhenFolded?: boolean;
}

interface CapturedFormField {
  field?: Record<string, unknown>;
  dropdownOptions?: Array<DropdownOption>;
}

interface CapturedFilter {
  field?: Record<string, unknown>;
  filterDropdownOptions?: Array<DropdownOption>;
}

// A suggestion as the card draws it.
interface DrawnSuggestion {
  name: string;
  facts: string;
  reason: string;
}

const TABLE: string = "8b000000-0000-4000-8000-000000000002";
const STORE: string = "8b000000-0000-4000-8000-000000000003";
const CUSTOMERS_TABLE: string = "8b000000-0000-4000-8000-000000000004";
const CHECK: string = "10000000-0000-4000-8000-000000000301";

// The languages the tab is read in below, from the locale files themselves.
const LANGUAGES: Array<string> = ["de", "ar"];

/*
 * Languages whose Format dropdown read English (#7532): Dutch and Italian
 * left Country Code English, and no language had ISO Date.
 */
const FORMAT_LANGUAGES: Array<string> = ["nl", "it"];

// Languages whose Dismiss can break inside a button: Japanese anywhere, Persian at its space.
const BREAKABLE_DISMISS_LANGUAGES: Array<string> = ["ja", "fa"];

// The marks that set a name apart in a drawn sentence (FSI, PDI and kin).
const ISOLATE_MARKS: RegExp = /[⁦-⁩]/;

function column(
  name: string,
  dataType: string,
  isNullable: boolean = true,
): DataAssetColumn {
  return { name, dataType, isNullable, position: 1 };
}

// A table offered every kind of suggestion there is.
const ORDERS: Array<DataAssetColumn> = [
  column("id", "bigint", false),
  column("customer_id", "bigint"),
  column("tenant_id", "text", false),
  column("contact_email", "varchar"),
  column("total", "numeric", false),
  column("status", "text", false),
  column("contact", "varchar"),
];

const CONTACT_IS_AN_EMAIL: DataColumnSensitivity = {
  column: "contact",
  dataTypeId: "email-address",
  dataTypeName: "Email address",
  sensitivity: DataSensitivity.Confidential,
  isFromName: false,
};

// Every suggestion the card draws for ORDERS, in its order, as before #7221.
const ENGLISH_AS_BEFORE: Array<DrawnSuggestion> = [
  {
    name: "id is unique",
    facts: "Duplicate Percent · Above 0",
    reason: "An id that repeats breaks every join and lookup on it.",
  },
  {
    name: "Every customer_id has a customers row",
    facts: "Orphan Count · Above 0",
    reason:
      "Rows whose customer_id has no match in public.customers are orphans: a delete that did not cascade, or a load out of order.",
  },
  {
    name: "customer_id is filled in as usual",
    facts: "Null Percent · Unusually High",
    reason:
      "A deploy that stops setting customer_id shows as more empty values than usual.",
  },
  {
    name: "Rows per customer",
    facts: "Row Count · Unusually Low",
    reason:
      "One customer that stops sending data is lost in the table's total: counted per customer_id, it alerts on its own.",
  },
  {
    name: "Rows per tenant",
    facts: "Row Count · Unusually Low",
    reason:
      "One tenant that stops sending data is lost in the table's total: counted per tenant_id, it alerts on its own.",
  },
  {
    name: "contact_email looks like an email address",
    facts: "Format Mismatch Percent · Above 1",
    reason:
      "Values that are not email addresses are bad input, or a column filled from the wrong field.",
  },
  {
    name: "total is not negative",
    facts: "Minimum · Below 0",
    reason: "A negative total is usually a sign or unit error.",
  },
  {
    name: "status takes its usual values",
    facts: "Distinct Count · Unusually High",
    reason:
      "A status that suddenly has more different values than usual is a new, unexpected value being written.",
  },
  {
    name: "contact looks like Email address",
    facts: "Format Mismatch Percent · Above 1",
    reason:
      "Data Security says this column holds Email address. Values that do not look like it are bad input, or a column filled from the wrong field.",
  },
];

/*
 * The English the suggestions' sentences are written in, word by word: none
 * of it may be left in another language's line. German keeps "Join", the
 * word its readers use for one.
 */
const ENGLISH_WORDS: Set<string> = new Set(
  Object.values(DATA_CHECK_SUGGESTION_SENTENCES)
    .flatMap((sentence: string): Array<string> => {
      return (
        sentence
          .replace(/\{\{\s*\w+\s*\}\}/g, " ")
          .toLowerCase()
          .match(/\p{L}{4,}/gu) || []
      );
    })
    .filter((word: string): boolean => {
      return word !== "join";
    }),
);

// The names the suggestions give, which go into every language as they are.
const NAMES: Array<string> = [
  "public.customers",
  "contact_email",
  "customer_id",
  "tenant_id",
  "customers",
  "customer",
  "contact",
  "status",
  "tenant",
  "total",
  "id",
];

// The English words a line leaves in, its names aside.
function englishWordsIn(text: string): Array<string> {
  let words: string = withoutIsolateMarks(text);

  for (const name of NAMES) {
    words = words.split(name).join(" ");
  }

  return (words.toLowerCase().match(/\p{L}{4,}/gu) || []).filter(
    (word: string): boolean => {
      return ENGLISH_WORDS.has(word);
    },
  );
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

function latestProps(): Record<string, unknown> {
  expect(mockCapturedTableProps.length).toBeGreaterThan(0);
  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

function capturedColumn(title: string): CapturedColumn {
  const found: CapturedColumn | undefined = (
    latestProps()["columns"] as Array<CapturedColumn>
  ).find((candidate: CapturedColumn): boolean => {
    return candidate.title === title;
  });

  expect(found).toBeDefined();

  return found!;
}

// The suggestions ORDERS is offered, as the card works them out.
function offered(): Array<DataCheckSuggestion> {
  return suggestDataChecks({
    tableName: "orders",
    columns: ORDERS,
    otherTables: [
      {
        tableKey: "public.customers",
        name: "customers",
        columns: [column("id", "bigint", false)],
      },
    ],
    existing: [],
    dismissedIds: [],
    sensitiveColumns: [CONTACT_IS_AN_EMAIL],
  });
}

// A suggestion's words as `language`'s Dashboard words them, unmarked.
function wordsIn(language: string, words: DataCheckSuggestionWords): string {
  return dashboardTranslator(language).translateTemplate(
    words.template,
    words.values,
  );
}

// The suggestions card for ORDERS in `language`, each suggestion as drawn.
async function drawSuggestions(language: string): Promise<Array<HTMLElement>> {
  await inLanguage(language);
  await act(async () => {
    render(
      <SuggestedDataChecks
        dataAssetId={new ObjectID(TABLE)}
        dataStoreId={new ObjectID(STORE)}
        tableName="orders"
        columns={ORDERS}
        onChecksAdded={() => {}}
      />,
    );
  });

  await screen.findAllByTestId(SUGGESTED_CHECK_NAME_TEST_ID);

  return screen.getAllByRole("listitem");
}

function read(item: HTMLElement): DrawnSuggestion {
  const name: HTMLElement = within(item).getByTestId(
    SUGGESTED_CHECK_NAME_TEST_ID,
  );

  return {
    name: name.textContent || "",
    facts: (name.nextElementSibling as HTMLElement).textContent || "",
    reason:
      within(item).getByTestId(SUGGESTED_CHECK_REASON_TEST_ID).textContent ||
      "",
  };
}

// What Add or Add All saved, check by check.
function saved(): Array<DataCheck> {
  return createMock.mock.calls.map((call: Array<unknown>): DataCheck => {
    return (call[0] as { model: DataCheck }).model;
  });
}

function check(fields: Record<string, unknown>): DataCheck {
  const row: DataCheck = new DataCheck();
  Object.assign(row, {
    _id: CHECK,
    name: "a check",
    checkType: DataCheckType.NullPercent,
    isEnabled: true,
    lastRunStatus: DataCheckRunStatus.Ran,
    ...fields,
  });
  return row;
}

// The line under a check's name, as drawn.
interface DrawnFactsLine {
  text: string;
  facts: Array<string>;
  // The line's classes, and the classes of the box each fact is drawn in.
  lineClassName: string;
  boxClassNames: Array<string>;
}

// The line under a check's name in the Checks table, in `language`.
async function factsLine(
  language: string,
  fields: Record<string, unknown>,
): Promise<DrawnFactsLine> {
  await inLanguage(language);
  await act(async () => {
    render(<DataCheckTable dataAssetId={new ObjectID(TABLE)} />);
  });

  const element: ReactElement = (
    capturedColumn("Name").getElement as (item: DataCheck) => ReactElement
  )(check(fields));

  cleanup();

  const { container } = render(<MemoryRouter>{element}</MemoryRouter>);
  const line: HTMLElement = within(container).getByTestId(
    DATA_CHECK_FACTS_TEST_ID,
  );

  return {
    text: line.textContent || "",
    facts: Array.from(line.querySelectorAll("bdi")).map(
      (fact: HTMLElement): string => {
        return fact.textContent || "";
      },
    ),
    lineClassName: line.className,
    boxClassNames: Array.from(line.querySelectorAll("bdi")).map(
      (fact: HTMLElement): string => {
        return fact.parentElement?.className || "";
      },
    ),
  };
}

async function checkTypeOptions(): Promise<{
  form: Array<DropdownOption>;
  filter: Array<DropdownOption>;
}> {
  await act(async () => {
    render(<DataCheckTable dataAssetId={new ObjectID(TABLE)} />);
  });

  const form: CapturedFormField | undefined = (
    latestProps()["formFields"] as Array<CapturedFormField>
  ).find((field: CapturedFormField): boolean => {
    return Boolean(field.field?.["checkType"]);
  });
  const filter: CapturedFilter | undefined = (
    latestProps()["filters"] as Array<CapturedFilter>
  ).find((candidate: CapturedFilter): boolean => {
    return Boolean(candidate.field?.["checkType"]);
  });

  expect(form?.dropdownOptions).toBeDefined();
  expect(filter?.filterDropdownOptions).toBeDefined();

  return {
    form: form!.dropdownOptions!,
    filter: filter!.filterDropdownOptions!,
  };
}

// A reconciliation's line under its name, in `language`.
async function reconciliationLine(
  language: string,
  item: DataReconciliation,
): Promise<string> {
  return (await reconciliationCell(language, item)).textContent || "";
}

// A reconciliation's Reconciliation cell - its name, and the line under it.
async function reconciliationCell(
  language: string,
  item: DataReconciliation,
): Promise<HTMLElement> {
  await inLanguage(language);
  await act(async () => {
    render(
      <MemoryRouter>
        <DataObservabilityReconciliationsPage
          pageRoute={new Route("/")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });

  const element: ReactElement = (
    capturedColumn("Reconciliation").getElement as (
      item: DataReconciliation,
    ) => ReactElement
  )(item);

  cleanup();

  const { container } = render(<MemoryRouter>{element}</MemoryRouter>);

  return container;
}

function reconciliation(): DataReconciliation {
  const item: DataReconciliation = new DataReconciliation();
  Object.assign(item, {
    name: "",
    sourceMeasure: DataReconciliationMeasure.DistinctCount,
    targetMeasure: DataReconciliationMeasure.RowCount,
    toleranceType: DataReconciliationToleranceType.Percent,
    tolerance: 5,
  });
  return item;
}

beforeAll(async () => {
  // English unless a test reads the page in another language: with no English file, each word is its own.
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      [...LANGUAGES, ...BREAKABLE_DISMISS_LANGUAGES, ...FORMAT_LANGUAGES].map(
        (language: string) => {
          return [language, { translation: readDashboardLocale(language) }];
        },
      ),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  goTo(`/dashboard/${PROJECT_ID}/data-observability/checks`);
  mockCapturedTableProps.length = 0;
  getListMock.mockReset();
  createMock.mockReset();
  getDismissalsMock.mockReset();
  dismissMock.mockReset();
  dismissMock.mockResolvedValue(undefined);
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType?: unknown } = args[0] as {
      modelType?: unknown;
    };

    if (request.modelType !== DataAsset) {
      return { data: [], count: 0, skip: 0, limit: 0 };
    }

    // The store's other table, which customer_id points at.
    const customers: DataAsset = new DataAsset();
    Object.assign(customers, {
      _id: CUSTOMERS_TABLE,
      schemaName: "public",
      name: "customers",
      columns: [column("id", "bigint", false)],
    });

    return { data: [customers], count: 1, skip: 0, limit: 0 };
  });
  createMock.mockResolvedValue({ data: undefined });
  getDismissalsMock.mockResolvedValue([]);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  jest
    .spyOn(DataObservabilityApi, "getTableSensitivity")
    .mockResolvedValue([CONTACT_IS_AN_EMAIL]);
  // Each added check's alert: none, as for a check with no monitor.
  jest
    .spyOn(DataObservabilityApi, "syncCheckAlert")
    .mockResolvedValue({ monitorId: null });
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("Suggested Checks (#7221)", () => {
  test("in English, every suggestion's name, facts and reason read exactly as before", async () => {
    const items: Array<HTMLElement> = await drawSuggestions("en");

    // Byte for byte: no mark sets a name apart in an English line.
    expect(items.map(read)).toEqual(ENGLISH_AS_BEFORE);
  });

  test.each(LANGUAGES)(
    "in %s, each suggestion's name and reason are the language's words, with its names as they are",
    async (language: string) => {
      const items: Array<HTMLElement> = await drawSuggestions(language);
      const suggestions: Array<DataCheckSuggestion> = offered();

      expect(items).toHaveLength(ENGLISH_AS_BEFORE.length);
      expect(suggestions).toHaveLength(items.length);

      items.forEach((item: HTMLElement, index: number) => {
        const drawn: DrawnSuggestion = read(item);
        const suggestion: DataCheckSuggestion = suggestions[index]!;

        expect({
          id: suggestion.id,
          name: withoutIsolateMarks(drawn.name),
          reason: withoutIsolateMarks(drawn.reason),
        }).toEqual({
          id: suggestion.id,
          name: wordsIn(language, suggestion.nameWords),
          reason: wordsIn(language, suggestion.reasonWords),
        });
        expect({
          id: suggestion.id,
          english: [
            ...englishWordsIn(drawn.name),
            ...englishWordsIn(drawn.reason),
          ],
        }).toEqual({ id: suggestion.id, english: [] });
      });
    },
  );

  test.each(LANGUAGES)(
    "in %s, each suggestion's facts name what it measures as the language's file words it",
    async (language: string) => {
      const items: Array<HTMLElement> = await drawSuggestions(language);
      const words: Record<string, string> = readDashboardLocale(language);
      const suggestions: Array<DataCheckSuggestion> = offered();

      items.forEach((item: HTMLElement, index: number) => {
        const type: DataCheckType = suggestions[index]!.checkType;
        const facts: string = withoutIsolateMarks(read(item).facts);

        expect({ type, starts: facts.startsWith(`${words[type]} · `) }).toEqual(
          { type, starts: true },
        );

        // Kept in English only where the language keeps the word (de: Minimum).
        if (type !== DataCheckType.Minimum) {
          expect({ type, english: facts.startsWith(`${type} · `) }).toEqual({
            type,
            english: false,
          });
        }
      });
    },
  );

  test("in Arabic, a name is set apart where it is drawn: the check Add saves has no mark of it", async () => {
    const items: Array<HTMLElement> = await drawSuggestions("ar");
    const first: DataCheckSuggestion = offered()[0]!;

    // Drawn: "id" is set apart in the Arabic sentence.
    expect(read(items[0]!).name).toMatch(ISOLATE_MARKS);

    await act(async () => {
      fireEvent.click(within(items[0]!).getAllByRole("button")[0]!);
    });
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const [added] = saved();

    expect(added!.name).toBe(wordsIn("ar", first.nameWords));
    expect(added!.description).toBe(wordsIn("ar", first.reasonWords));
    expect(added!.name).not.toMatch(ISOLATE_MARKS);
    expect(added!.description).not.toMatch(ISOLATE_MARKS);
    expect(added!.name).toBe(
      readDashboardLocale("ar")[
        DATA_CHECK_SUGGESTION_SENTENCES.uniqueName
      ]!.replace("{{column}}", "id"),
    );
    // What it checks is saved as before.
    expect(added!.checkType).toBe(DataCheckType.DuplicatePercent);
    expect(added!.columnName).toBe("id");
  });

  test("in German, Add All saves each suggestion in the reader's words", async () => {
    await drawSuggestions("de");

    const addAll: HTMLElement | undefined = screen
      .getAllByRole("button")
      .find((button: HTMLElement): boolean => {
        return (button.textContent || "").includes(
          readDashboardLocale("de")["Add All"]!,
        );
      });

    expect(addAll).toBeDefined();

    await act(async () => {
      fireEvent.click(addAll!);
    });
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(ENGLISH_AS_BEFORE.length);
    });

    expect(
      saved().map((added: DataCheck) => {
        return [added.name, added.description, added.checkType];
      }),
    ).toEqual(
      offered().map((suggestion: DataCheckSuggestion) => {
        return [
          wordsIn("de", suggestion.nameWords),
          wordsIn("de", suggestion.reasonWords),
          suggestion.checkType,
        ];
      }),
    );

    for (const added of saved()) {
      expect(added.name).not.toMatch(ISOLATE_MARKS);
      expect(added.description).not.toMatch(ISOLATE_MARKS);
    }
  });

  test("in German, Add cuts a name past 100 characters and a reason past 500, as a check holds them", async () => {
    // A MongoDB field may be named at any length: one long money field.
    const longName: string = `total_${"a".repeat(520)}`;
    const columns: Array<DataAssetColumn> = [
      column(longName, "numeric", false),
    ];

    await inLanguage("de");
    await act(async () => {
      render(
        <SuggestedDataChecks
          dataAssetId={new ObjectID(TABLE)}
          dataStoreId={new ObjectID(STORE)}
          tableName="orders"
          columns={columns}
          onChecksAdded={() => {}}
        />,
      );
    });

    const items: Array<HTMLElement> = await screen.findAllByRole("listitem");

    expect(items).toHaveLength(1);

    await act(async () => {
      fireEvent.click(within(items[0]!).getAllByRole("button")[0]!);
    });
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const suggestion: DataCheckSuggestion | undefined = suggestDataChecks({
      tableName: "orders",
      columns,
      otherTables: [],
      existing: [],
      dismissedIds: [],
      sensitiveColumns: [],
    }).find((candidate: DataCheckSuggestion): boolean => {
      return candidate.id === `not-negative:${longName}`;
    });
    const name: string = wordsIn("de", suggestion!.nameWords);
    const reason: string = wordsIn("de", suggestion!.reasonWords);
    const [added] = saved();

    // The German words run past what a check's name and description hold.
    expect(name.length).toBeGreaterThan(100);
    expect(reason.length).toBeGreaterThan(500);
    expect(added!.name).toBe(name.slice(0, 100));
    expect(added!.description).toBe(reason.slice(0, 500));
  });

  /*
   * Keyed to the viewport (md), Add and Dismiss stood beside a
   * suggestion's words from 768px, where the card beside the table's side
   * menu is some 430px wide: the words had 150px, and a German reason ran
   * to seven lines. The row follows the card's width now, and its facts
   * wrap between themselves as the Checks list's do.
   */
  test("in German, each suggestion puts its buttons under its words until the card has room beside them", async () => {
    const items: Array<HTMLElement> = await drawSuggestions("de");

    expect(items[0]!.parentElement?.className).toBe(
      SUGGESTED_CHECKS_LIST_CLASS_NAME,
    );

    for (const item of items) {
      expect(item.className).toBe(SUGGESTED_CHECK_ROW_CLASS_NAME);

      const facts: HTMLElement = within(item).getByTestId(
        SUGGESTED_CHECK_FACTS_TEST_ID,
      );

      expect(facts.className).toBe(DATA_CHECK_FACTS_LINE_CLASS_NAME);
      expect(
        Array.from(facts.querySelectorAll("bdi")).map(
          (fact: HTMLElement): string => {
            return fact.parentElement?.className || "";
          },
        ),
      ).toEqual([DATA_CHECK_FACT_CLASS_NAME, DATA_CHECK_FACT_CLASS_NAME]);

      // Add, then Dismiss, in a row of their own.
      const buttons: Array<HTMLElement> = within(item).getAllByRole("button");

      expect(buttons).toHaveLength(2);
      for (const button of buttons) {
        expect(button.parentElement?.className).toBe(
          SUGGESTED_CHECK_BUTTONS_CLASS_NAME,
        );
      }
    }

    // The card's width decides, not the window's.
    expect(SUGGESTED_CHECKS_LIST_CLASS_NAME.split(" ")).toContain(
      "[container-type:inline-size]",
    );
    expect(SUGGESTED_CHECK_ROW_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "flex-col",
        "[@container(min-width:36rem)]:flex-row",
      ]),
    );
    expect(SUGGESTED_CHECK_ROW_CLASS_NAME).not.toMatch(
      /(^|\s)(sm|md|lg|xl):flex-row(\s|$)/,
    );

    /*
     * Under the words, Add starts where they do: a Button has no margin of
     * its own (#9128), and the row's gap spaces the buttons.
     */
    expect(SUGGESTED_CHECK_BUTTONS_CLASS_NAME.split(" ")).toContain("gap-2");
    expect(SUGGESTED_CHECK_BUTTONS_CLASS_NAME).not.toContain("button]");
  });

  /*
   * On a phone, Add is as wide as the row (a NORMAL button's w-full) and
   * Dismiss as wide as its words: the two shrank together, and Dismiss
   * gave up most of its width - Japanese broke it mid-word ("非表 / 示") and
   * Persian's two words stacked. Each button's words stay on one line.
   */
  test.each(BREAKABLE_DISMISS_LANGUAGES)(
    "in %s, Dismiss keeps its words on one line beside Add",
    async (language: string) => {
      const items: Array<HTMLElement> = await drawSuggestions(language);
      const words: Record<string, string> = readDashboardLocale(language);

      // Words that can break: Japanese between any two of its characters, Persian at its space.
      expect(words["Dismiss"]).toMatch(language === "fa" ? / / : /^.{2,}$/u);

      for (const item of items) {
        const dismiss: HTMLElement = within(item).getByRole("button", {
          name: words["Dismiss"]!,
        });

        expect(dismiss.parentElement?.className).toBe(
          SUGGESTED_CHECK_BUTTONS_CLASS_NAME,
        );
      }

      expect(SUGGESTED_CHECK_BUTTONS_CLASS_NAME.split(" ")).toContain(
        "whitespace-nowrap",
      );
    },
  );

  test("in English, Add saves the name and reason exactly as before", async () => {
    const items: Array<HTMLElement> = await drawSuggestions("en");

    await act(async () => {
      fireEvent.click(within(items[1]!).getAllByRole("button")[0]!);
    });
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    expect(saved()[0]!.name).toBe(ENGLISH_AS_BEFORE[1]!.name);
    expect(saved()[0]!.description).toBe(ENGLISH_AS_BEFORE[1]!.reason);
  });

  /*
   * Why a suggestion was not added is the server's message - English,
   * whatever the page's language. Drawn as a paragraph of the page's, an
   * Arabic page put its full stop at its start; it is a line of its own
   * now (IsolatedLine), as each suggestion's name and reason are (#7221's
   * review).
   */
  const NOT_ADDED: string = "You do not have permission to create a check.";

  test.each(["en", "ar"])(
    "in %s, a suggestion Add could not save says why in the server's words, read the way they are written",
    async (language: string) => {
      createMock.mockRejectedValue(new Error(NOT_ADDED));

      const items: Array<HTMLElement> = await drawSuggestions(language);

      await act(async () => {
        fireEvent.click(within(items[0]!).getAllByRole("button")[0]!);
      });

      const error: HTMLElement = await screen.findByTestId(
        SUGGESTED_CHECKS_ERROR_TEST_ID,
      );

      expect(error.tagName).toBe("P");
      expect(withoutIsolateMarks(error.textContent || "")).toBe(NOT_ADDED);
      expect(error).toHaveClass("mb-3", "text-sm", "text-red-600");

      if (language === "en") {
        // On an English page, a paragraph as before.
        expect(error).not.toHaveAttribute("dir");
        expect(error).not.toHaveClass("w-fit");
      } else {
        // Left to right, as wide as its words at the page's start.
        expect(error).toHaveAttribute("dir", "ltr");
        expect(error).toHaveClass("break-words", "w-fit", "max-w-full");
        expect(error).not.toHaveClass("text-end");
      }

      // The suggestion stays, to add again.
      expect(screen.getAllByTestId(SUGGESTED_CHECK_NAME_TEST_ID)).toHaveLength(
        ENGLISH_AS_BEFORE.length,
      );
    },
  );
});

/*
 * WHY SUGGESTED CHECKS DID NOT DO WHAT WAS ASKED, IN THE READER'S LANGUAGE
 * (#7530).
 *
 * The card's red line was API.getFriendlyMessage's answer drawn as it
 * came: the server's refusals in English on every page, and a failure
 * nobody explained as its English sentence with no reference to copy. A
 * refusal of the server's is a key of the locales now, and an unexplained
 * failure is ErrorExplanation: what did not happen (the suggestions were
 * not loaded, the check was not added, the suggestion was not dismissed),
 * why, what to do next and the reference.
 */
describe("why Suggested Checks did not do what was asked (#7530)", () => {
  // The words of `language`'s locale: English for a key it has no words for.
  function wordsOf(language: string): (text: string) => string {
    const words: Record<string, string> =
      language === "en" ? {} : readDashboardLocale(language);

    return (text: string): string => {
      return words[text] || text;
    };
  }

  // The words ErrorExplanation says for `message`, in `language`.
  function explanationIn(language: string, message: string): string {
    const said: (text: string) => string = wordsOf(language);
    const words: { why: string; next: string } = getExplanationWords({
      error: readUnexplainedError(message)!,
      isCloud: BILLING_ENABLED,
      isMasterAdmin: false,
      isVisitor: false,
    });

    return joinSentences([said(words.why), said(words.next)]);
  }

  // Add on the first suggestion, failing with `rejection`; the card's error.
  async function addFailsWith(
    language: string,
    rejection: unknown,
  ): Promise<HTMLElement> {
    createMock.mockRejectedValue(rejection);

    const items: Array<HTMLElement> = await drawSuggestions(language);

    await act(async () => {
      fireEvent.click(within(items[0]!).getAllByRole("button")[0]!);
    });

    return await screen.findByTestId(SUGGESTED_CHECKS_ERROR_TEST_ID);
  }

  test.each([
    [
      "de",
      new HTTPErrorResponse(502, "<html>Bad Gateway</html>" as never, {}),
      SERVER_DOWN_MESSAGE,
    ],
    [
      "de",
      new HTTPErrorResponse(500, {}, {}),
      UNEXPLAINED_ERROR_MESSAGES.server,
    ],
    [
      "ar",
      new APIException(
        "Request failed to https://oneuptime.example.com/api/data-check. Network Error",
      ),
      UNEXPLAINED_ERROR_MESSAGES.unreachable,
    ],
    [
      "fa",
      new HTTPErrorResponse(
        503,
        "<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>" as never,
        {},
      ),
      SERVER_DOWN_MESSAGE,
    ],
  ])(
    "in %s, an Add nobody explained says the check was not added, why and what to do next",
    async (language: string, rejection: unknown, message: string) => {
      const error: HTMLElement = await addFailsWith(language, rejection);
      const said: (text: string) => string = wordsOf(language);

      expect(error.tagName).toBe("P");
      expect(error).toHaveClass("mb-3", "text-sm", "text-red-600");
      expect(within(error).getByTestId("error-what-failed")).toHaveTextContent(
        said(SuggestedChecksWhatFailed.add),
      );
      expect(within(error).getByTestId("error-why-and-next").textContent).toBe(
        explanationIn(language, message),
      );
      expect(error.textContent).not.toContain(message);
      expect(error.textContent).not.toContain("<");
      expect(said(SuggestedChecksWhatFailed.add)).not.toBe(
        SuggestedChecksWhatFailed.add,
      );
      // The suggestion stays, to add again.
      expect(screen.getAllByTestId(SUGGESTED_CHECK_NAME_TEST_ID)).toHaveLength(
        ENGLISH_AS_BEFORE.length,
      );
    },
  );

  test("in Persian, an Add nobody explained leaves no English word in the line", async () => {
    const error: HTMLElement = await addFailsWith(
      "fa",
      new HTTPErrorResponse(504, {}, {}),
    );

    expect(error).not.toHaveAttribute("dir");
    // The product's name and the command to run are the only Latin letters.
    expect(
      (error.textContent || "").replace(
        /OneUptime|npm run doctor|oneuptime/g,
        "",
      ),
    ).not.toMatch(/[A-Za-z]/);
  });

  test("a server failure's reference is code, with a Copy button", async () => {
    const error: HTMLElement = await addFailsWith(
      "en",
      new HTTPErrorResponse(
        500,
        {
          error: getUnexplainedServerErrorMessage("1f0c9a2b"),
          reference: "1f0c9a2b",
        },
        {},
      ),
    );
    const reference: HTMLElement = within(error).getByTestId("error-reference");

    expect(within(error).getByTestId("error-what-failed")).toHaveTextContent(
      "The check was not added.",
    );
    expect(within(reference).getByText("1f0c9a2b").tagName).toBe("CODE");
    expect(
      within(reference).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
  });

  test.each([
    CustomSqlRefusal.notARead,
    CustomSqlRefusal.writes,
    MongoPipelineRefusal.noPipeline,
  ])(
    "in German, the server's refusal %j reads in German, a line of the page's",
    async (refusal: string) => {
      const error: HTMLElement = await addFailsWith(
        "de",
        new HTTPErrorResponse(400, { message: refusal }, {}),
      );
      const said: string = wordsOf("de")(refusal);

      expect(said).not.toBe(refusal);
      expect(withoutIsolateMarks(error.textContent || "")).toBe(said);
      expect(
        within(error).queryByTestId("error-explanation"),
      ).not.toBeInTheDocument();
    },
  );

  test("in German, suggestions that could not be read say so, and why", async () => {
    getListMock.mockRejectedValue(new HTTPErrorResponse(502, "" as never, {}));

    await inLanguage("de");
    await act(async () => {
      render(
        <SuggestedDataChecks
          dataAssetId={new ObjectID(TABLE)}
          dataStoreId={new ObjectID(STORE)}
          tableName="orders"
          columns={ORDERS}
          onChecksAdded={() => {}}
        />,
      );
    });

    const error: HTMLElement = await screen.findByTestId(
      SUGGESTED_CHECKS_ERROR_TEST_ID,
    );
    const said: (text: string) => string = wordsOf("de");

    expect(within(error).getByTestId("error-what-failed")).toHaveTextContent(
      said(SuggestedChecksWhatFailed.read),
    );
    expect(within(error).getByTestId("error-why-and-next").textContent).toBe(
      explanationIn("de", SERVER_DOWN_MESSAGE),
    );
    expect(said(SuggestedChecksWhatFailed.read)).not.toBe(
      SuggestedChecksWhatFailed.read,
    );
  });

  test("in German, a suggestion that could not be dismissed says so, and stays", async () => {
    dismissMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const items: Array<HTMLElement> = await drawSuggestions("de");
    const said: (text: string) => string = wordsOf("de");

    await act(async () => {
      fireEvent.click(
        within(items[0]!).getByRole("button", { name: said("Dismiss") }),
      );
    });

    const error: HTMLElement = await screen.findByTestId(
      SUGGESTED_CHECKS_ERROR_TEST_ID,
    );

    expect(within(error).getByTestId("error-what-failed")).toHaveTextContent(
      said(SuggestedChecksWhatFailed.dismiss),
    );
    expect(within(error).getByTestId("error-why-and-next").textContent).toBe(
      explanationIn("de", UNEXPLAINED_ERROR_MESSAGES.unreachable),
    );
    expect(said(SuggestedChecksWhatFailed.dismiss)).not.toBe(
      SuggestedChecksWhatFailed.dismiss,
    );
    expect(screen.getAllByTestId(SUGGESTED_CHECK_NAME_TEST_ID)).toHaveLength(
      ENGLISH_AS_BEFORE.length,
    );
  });
});

/*
 * The Reconciliations page said why a reconciliation's checks were not set
 * up with the failure's raw message: a gateway's HTML page, or an empty
 * body's nothing. It says API.getFriendlyMessage's answer now, inside its
 * own sentence, in the reader's language (#7530).
 */
describe("why a reconciliation was not set up (#7530)", () => {
  async function saveFailsWith(
    language: string,
    rejection: unknown,
  ): Promise<HTMLElement> {
    jest
      .spyOn(DataObservabilityApi, "syncReconciliation")
      .mockRejectedValue(rejection);

    await inLanguage(language);
    await act(async () => {
      render(
        <MemoryRouter>
          <DataObservabilityReconciliationsPage
            pageRoute={new Route("/")}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );
    });

    const onCreateSuccess: (item: DataReconciliation) => Promise<unknown> =
      latestProps()["onCreateSuccess"] as (
        item: DataReconciliation,
      ) => Promise<unknown>;
    const item: DataReconciliation = new DataReconciliation();
    item.id = new ObjectID(TABLE);

    await act(async () => {
      await onCreateSuccess(item);
    });

    const notice: HTMLElement | null =
      document.querySelector<HTMLElement>("p.bg-yellow-50");

    expect(notice).not.toBeNull();

    return notice!;
  }

  test("a gateway's page is never shown as its markup", async () => {
    const notice: HTMLElement = await saveFailsWith(
      "en",
      new HTTPErrorResponse(
        502,
        "<html><head><title>502 Bad Gateway</title></head></html>" as never,
        {},
      ),
    );

    expect(notice.textContent).not.toContain("<");
    expect(notice.textContent).toContain(UnexplainedErrorWords.serverDownWhy);
  });

  test("in German, a refusal of the server's reads in German inside the page's sentence", async () => {
    const notice: HTMLElement = await saveFailsWith(
      "de",
      new HTTPErrorResponse(
        400,
        { message: DataReconciliationRefusal.sourceNeedsTable },
        {},
      ),
    );
    const words: Record<string, string> = readDashboardLocale("de");

    expect(notice.textContent).toContain(
      words[DataReconciliationRefusal.sourceNeedsTable]!,
    );
    expect(notice.textContent).not.toContain(
      DataReconciliationRefusal.sourceNeedsTable,
    );
  });
});

describe("what a check measures, under its name (#7223)", () => {
  const FIELDS: Record<string, unknown> = {
    checkType: DataCheckType.NullPercent,
    columnName: "total",
    segmentColumn: "tenant_id",
    isManagedByFile: true,
  };

  test("in English, the line reads exactly as before, each fact in its own direction", async () => {
    const line: { text: string; facts: Array<string> } = await factsLine(
      "en",
      FIELDS,
    );

    expect(line.text).toBe("Null Percent · total · by tenant_id · From a file");
    expect(line.facts).toEqual([
      "Null Percent",
      "total",
      "by tenant_id",
      "From a file",
    ]);
  });

  test.each([
    ["de", "Anteil NULL-Werte · total · nach tenant_id · Aus einer Datei"],
    ["ar", "نسبة NULL · total · حسب tenant_id · من ملف"],
  ])("in %s, it reads %j", async (language: string, expected: string) => {
    const line: { text: string; facts: Array<string> } = await factsLine(
      language,
      FIELDS,
    );

    expect(withoutIsolateMarks(line.text)).toBe(expected);
    expect(line.facts[0]).toBe(readDashboardLocale(language)["Null Percent"]);
  });

  test.each(LANGUAGES)(
    "in %s, every type a check has is named as the language's file words it",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const type of Object.values(DataCheckType)) {
        const line: { text: string; facts: Array<string> } = await factsLine(
          language,
          { checkType: type, columnName: null, segmentColumn: null },
        );

        expect({ type, facts: line.facts }).toEqual({
          type,
          facts: [words[type]],
        });

        cleanup();
      }
    },
  );

  /*
   * One line cut short with an ellipsis, a German check's line lost its
   * last fact on a phone and at 768px ("... · Aus ei..."), and held the
   * Name column at its 20rem cap at 1280px (DataCheckFactsLine).
   */
  test("in German, the line wraps between its facts, each a box of its own", async () => {
    const line: DrawnFactsLine = await factsLine("de", {
      ...FIELDS,
      columnName: "customer_account_reference_id",
    });

    expect(line.lineClassName).toBe(DATA_CHECK_FACTS_LINE_CLASS_NAME);
    expect(line.boxClassNames).toEqual([
      DATA_CHECK_FACT_CLASS_NAME,
      DATA_CHECK_FACT_CLASS_NAME,
      DATA_CHECK_FACT_CLASS_NAME,
      DATA_CHECK_FACT_CLASS_NAME,
    ]);
    expect(withoutIsolateMarks(line.text)).toBe(
      "Anteil NULL-Werte · customer_account_reference_id · nach tenant_id · Aus einer Datei",
    );
  });

  test("a check with only a type says only that", async () => {
    const line: { text: string; facts: Array<string> } = await factsLine("de", {
      checkType: DataCheckType.RowCount,
      columnName: null,
      segmentColumn: null,
      isManagedByFile: false,
    });

    expect(line.text).toBe("Zeilenanzahl");
  });
});

describe("the Check dropdown and the Check filter (#7223)", () => {
  test("offer every type a person adds, each by its name, its value what is saved", async () => {
    const options: {
      form: Array<DropdownOption>;
      filter: Array<DropdownOption>;
    } = await checkTypeOptions();

    for (const list of [options.form, options.filter]) {
      expect(
        list.map((option: DropdownOption) => {
          return option.value;
        }),
      ).toEqual([...DATA_CHECK_TYPES]);
      expect(
        list.map((option: DropdownOption) => {
          return option.label;
        }),
      ).toEqual(
        DATA_CHECK_TYPES.map((type: DataCheckType): string => {
          return DATA_CHECK_TYPE_LABELS[type];
        }),
      );
    }
  });

  test.each(LANGUAGES)(
    "in %s, each option reads as the language's file words it",
    async (language: string) => {
      const options: Array<DropdownOption> = (await checkTypeOptions()).form;
      const words: Record<string, string> = readDashboardLocale(language);

      cleanup();
      await inLanguage(language);

      for (const option of options) {
        const { container } = render(
          <Dropdown
            options={options}
            value={option}
            onChange={() => {}}
            ariaLabel="Check"
          />,
        );

        expect({
          type: option.value,
          drawn: withoutIsolateMarks(
            container.querySelector(".ou-select__single-value")?.textContent ||
              "",
          ),
        }).toEqual({
          type: option.value,
          drawn: words[option.value as string],
        });

        cleanup();
      }
    },
  );
});

// The Format dropdown of the check form, as DataCheckTable hands it to ModelTable.
async function formatOptions(): Promise<Array<DropdownOption>> {
  await act(async () => {
    render(<DataCheckTable dataAssetId={new ObjectID(TABLE)} />);
  });

  const form: CapturedFormField | undefined = (
    latestProps()["formFields"] as Array<CapturedFormField>
  ).find((field: CapturedFormField): boolean => {
    return Boolean(field.field?.["formatPreset"]);
  });

  expect(form?.dropdownOptions).toBeDefined();

  return form!.dropdownOptions!;
}

// Each option, as a Dropdown draws it picked, in the language i18next is in.
function drawnOptions(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    const { container } = render(
      <Dropdown
        options={options}
        value={option}
        onChange={() => {}}
        ariaLabel="Format"
      />,
    );
    const drawn: string = withoutIsolateMarks(
      container.querySelector(".ou-select__single-value")?.textContent || "",
    );

    cleanup();

    return drawn;
  });
}

describe("the Format dropdown (#7532)", () => {
  test("offers every format, each by its name, its value what is saved", async () => {
    const options: Array<DropdownOption> = await formatOptions();

    expect(
      options.map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual([...DATA_CHECK_FORMATS]);
    expect(
      options.map((option: DropdownOption) => {
        return option.label;
      }),
    ).toEqual(
      DATA_CHECK_FORMATS.map((format: DataCheckFormat): string => {
        return DATA_CHECK_FORMAT_LABELS[format];
      }),
    );
  });

  test("in English, each format reads exactly as before", async () => {
    const options: Array<DropdownOption> = await formatOptions();

    cleanup();

    expect(drawnOptions(options)).toEqual([
      "Email",
      "UUID",
      "Country Code",
      "URL",
      "IP Address",
      "ISO Date",
      "Phone Number",
      "Custom",
    ]);
  });

  test.each([...FORMAT_LANGUAGES, ...LANGUAGES])(
    "in %s, each format reads as the language's file words it, Country Code and ISO Date never in English",
    async (language: string) => {
      const options: Array<DropdownOption> = await formatOptions();
      const words: Record<string, string> = readDashboardLocale(language);

      cleanup();
      await inLanguage(language);

      const drawn: Array<string> = drawnOptions(options);

      expect(drawn).toEqual(
        DATA_CHECK_FORMATS.map((format: DataCheckFormat): string => {
          return words[format]!;
        }),
      );
      expect(drawn).not.toContain(DataCheckFormat.CountryCode);
      expect(drawn).not.toContain(DataCheckFormat.IsoDate);
      // UUID is written as it is, in every language.
      expect(drawn[DATA_CHECK_FORMATS.indexOf(DataCheckFormat.Uuid)]).toBe(
        "UUID",
      );
    },
  );

  test("in Dutch, the two formats the issue named read Landcode and ISO-datum", async () => {
    const options: Array<DropdownOption> = await formatOptions();

    cleanup();
    await inLanguage("nl");

    const drawn: Array<string> = drawnOptions(options);

    expect(drawn).toContain("Landcode");
    expect(drawn).toContain("ISO-datum");
  });
});

describe("a reconciliation's measures (#7223)", () => {
  test("in English, the line under its name reads exactly as before", async () => {
    expect(await reconciliationLine("en", reconciliation())).toBe(
      "Distinct Count against Row Count, within 5%",
    );
  });

  test.each(LANGUAGES)(
    "in %s, each measure is named as the Measure dropdown draws it",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const line: string = withoutIsolateMarks(
        await reconciliationLine(language, reconciliation()),
      );

      expect(line.startsWith(words["Distinct Count"]!)).toBe(true);
      expect(line).toContain(words["Row Count"]!);
      expect(line).not.toMatch(/Distinct Count|Row Count/);
    },
  );

  /*
   * Cut short at the column's 20rem, the German line lost its tolerance -
   * "Anzahl eindeutiger Werte gegen Anzahl eindeutiger..." - and held the
   * column at its cap. It wraps under the name now.
   */
  test("in German, the line wraps under the name, its tolerance never cut off", async () => {
    const cell: HTMLElement = await reconciliationCell("de", reconciliation());
    const lines: Array<HTMLElement> = Array.from(
      cell.querySelectorAll("span"),
    ).filter((span: HTMLElement): boolean => {
      return span.className === RECONCILIATION_MEASURES_LINE_CLASS_NAME;
    });

    expect(lines).toHaveLength(1);
    expect(withoutIsolateMarks(lines[0]!.textContent || "")).toMatch(/5 ?%$/);

    const classes: Array<string> =
      RECONCILIATION_MEASURES_LINE_CLASS_NAME.split(" ");

    // A table's cell keeps its words on one line unless told otherwise.
    expect(classes).toEqual(
      expect.arrayContaining(["block", "whitespace-normal", "break-words"]),
    );
    expect(classes).not.toContain("truncate");
  });
});

/*
 * #7534: at 1280px beside the side menu, the German Checks list ran 46px
 * past its card and the English Reconciliations list cut its Status
 * badges, under the sticky Run Now column. Where a list does not fit its
 * card, the table folds the columns its page marks foldable, under the
 * column each names (TableFit; DataObservabilityListsAt1280 draws them).
 */
describe("the lists' columns fold where they do not fit their card (#7534)", () => {
  // Every column, as the page hands it to ModelTable.
  function columns(): Array<CapturedColumn> {
    return latestProps()["columns"] as Array<CapturedColumn>;
  }

  // The column whose field is `field`, and the one each folds into.
  function byField(field: string): CapturedColumn {
    const found: CapturedColumn | undefined = columns().find(
      (candidate: CapturedColumn): boolean => {
        return Boolean(candidate.field?.[field]);
      },
    );

    expect(found).toBeDefined();

    return found!;
  }

  test.each(["en", ...LANGUAGES])(
    "in %s, a check's Alert folds under its Status, named; no other column folds",
    async (language: string) => {
      await inLanguage(language);
      await act(async () => {
        render(<DataCheckTable />);
      });

      const alert: CapturedColumn = byField("alertCondition");

      expect({
        hideBelowLargeScreen: alert.hideBelowLargeScreen,
        foldInto: alert.foldInto,
        showTitleWhenFolded: alert.showTitleWhenFolded,
      }).toEqual({
        hideBelowLargeScreen: true,
        // The Status column, which sorts by how each check stands (healthRank, #6554).
        foldInto: "healthRank",
        showTitleWhenFolded: true,
      });
      // It folds into a column the list draws.
      expect(byField("healthRank").hideBelowLargeScreen).toBeFalsy();
      expect(
        columns()
          .filter((column: CapturedColumn): boolean => {
            return Boolean(column.hideBelowLargeScreen);
          })
          .map((column: CapturedColumn): string | undefined => {
            return column.title;
          }),
      ).toEqual(["Alert"]);
    },
  );

  test("a table's own Checks tab folds its Alert the same way", async () => {
    await act(async () => {
      render(<DataCheckTable dataAssetId={new ObjectID(TABLE)} />);
    });

    expect(byField("alertCondition").foldInto).toBe("healthRank");
  });

  test.each(["en", ...LANGUAGES])(
    "in %s, a reconciliation's Target folds under its Source and its Difference under its Status, each named",
    async (language: string) => {
      await inLanguage(language);
      await act(async () => {
        render(
          <MemoryRouter>
            <DataObservabilityReconciliationsPage
              pageRoute={new Route("/")}
              currentProject={null}
              hasPaymentMethod={false}
            />
          </MemoryRouter>,
        );
      });

      for (const [field, into] of [
        ["targetDataAsset", "sourceDataAsset"],
        ["difference", "status"],
      ] as Array<[string, string]>) {
        const column: CapturedColumn = byField(field);

        expect({
          field,
          hideBelowLargeScreen: column.hideBelowLargeScreen,
          foldInto: column.foldInto,
          showTitleWhenFolded: column.showTitleWhenFolded,
        }).toEqual({
          field,
          hideBelowLargeScreen: true,
          foldInto: into,
          showTitleWhenFolded: true,
        });
        expect(byField(into).hideBelowLargeScreen).toBeFalsy();
      }

      // The name, the source and the status are always drawn.
      expect(
        columns()
          .filter((column: CapturedColumn): boolean => {
            return !column.hideBelowLargeScreen;
          })
          .map((column: CapturedColumn): string | undefined => {
            return column.title;
          }),
      ).toEqual(["Reconciliation", "Source", "Status"]);
    },
  );

  test("why a reconciliation waits or failed wraps under its badge, never one line cut short", async () => {
    const item: DataReconciliation = reconciliation();

    Object.assign(item, {
      status: "Waiting",
      statusMessage:
        "The sides were last read 42 minutes apart: waiting for both to be read together.",
    });

    await inLanguage("de");
    await act(async () => {
      render(
        <MemoryRouter>
          <DataObservabilityReconciliationsPage
            pageRoute={new Route("/")}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );
    });

    const element: ReactElement = (
      capturedColumn("Status").getElement as (
        item: DataReconciliation,
      ) => ReactElement
    )(item);

    cleanup();

    const { container } = render(<MemoryRouter>{element}</MemoryRouter>);
    const message: HTMLElement = within(container).getByText(
      item.statusMessage!,
    );

    expect(message.className).toBe(RECONCILIATION_STATUS_MESSAGE_CLASS_NAME);

    const classes: Array<string> =
      RECONCILIATION_STATUS_MESSAGE_CLASS_NAME.split(" ");

    expect(classes).toEqual(
      expect.arrayContaining([
        "block",
        "max-w-xs",
        "whitespace-normal",
        "break-words",
      ]),
    );
    expect(classes).not.toContain("truncate");
  });
});
