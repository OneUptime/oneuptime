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
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE CHECKS TAB NAMES A CHECK'S ALERT IN THE READER'S WORDS (#6976).
 *
 * Beside Write a Check from a Sentence, the Checks tab names a check's
 * alert in three more places, and each had the fault the issue found in
 * the sentence: the checks' Alert column drew the condition's English
 * value and its number on every page ("Above 0"); a suggested check put a
 * translated condition before its number in every language
 * ("上回る 0", "초과 0", "ऊपर 0" where Japanese, Korean and Hindi say
 * "0 を上回る", "0 초과", "0 से ऊपर") and left Unusually High in English;
 * and the Alert When dropdown offered Unusually High and Unusually Low in
 * English. All of them now draw DataCheckAlertConditionWords' words.
 *
 * The table is captured instead of rendered (only the props the Checks
 * table hands ModelTable are under test); the suggestions are drawn by the
 * real component, its reads mocked.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];
const getListMock: MockFunction = getJestMockFunction();
const getDismissalsMock: MockFunction = getJestMockFunction();
const suggestDataChecksMock: MockFunction = getJestMockFunction();

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
      },
    };
  },
);

jest.mock("../../../Types/DataObservability/DataCheckSuggestions", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Types/DataObservability/DataCheckSuggestions",
  ) as Record<string, unknown>;

  return {
    ...actual,
    suggestDataChecks: (...args: Array<any>) => {
      return suggestDataChecksMock(...args);
    },
  };
});

/*
 * The components come last: requiring them runs the factories above.
 */
import DataObservabilityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import DataCheckTable from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckTable";
import SuggestedDataChecks, {
  SUGGESTED_CHECK_NAME_TEST_ID,
  SUGGESTED_CHECK_REASON_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/SuggestedDataChecks";
import { DATA_CHECK_ALERT_CONDITION_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckAlertConditionWords";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import {
  DATA_CHECK_ALERT_CONDITIONS,
  DataCheckAlertCondition,
  DataCheckRunStatus,
  DataCheckType,
} from "../../../Types/DataObservability/DataCheckType";
import {
  DATA_CHECK_SUGGESTION_SENTENCES,
  DataCheckSuggestion,
  DataCheckSuggestionWords,
} from "../../../Types/DataObservability/DataCheckSuggestions";
import ObjectID from "../../../Types/ObjectID";
import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import ProjectUtil from "../../../UI/Utils/Project";
import { CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

interface CapturedColumn {
  title?: string;
  getElement?: (item: DataCheck) => ReactElement;
  getExportValue?: (item: DataCheck) => string;
}

interface CapturedFormField {
  field?: Record<string, unknown>;
  description?: string;
  dropdownOptions?: Array<DropdownOption>;
}

const TABLE: string = "8b000000-0000-4000-8000-000000000002";
const CHECK: string = "10000000-0000-4000-8000-000000000301";

// The languages the tab is read in below, from the locale files themselves.
const LANGUAGES: Array<string> = ["de", "ja", "ko", "hi", "ar", "fa"];

// What a condition's English left on the page looks like.
const ENGLISH_CONDITION_WORDS: RegExp =
  /\b(?:above|below|unusually|high|low)\b/i;

// The Threshold field's description, naming the two conditions it serves.
const THRESHOLD_DESCRIPTION: string =
  "The value an Above or Below alert compares with.";

// Above or Below left in English inside a translated description.
const ENGLISH_ABOVE_OR_BELOW: RegExp = /\b(?:Above|Below)\b/;

/*
 * French, Spanish and Portuguese name the conditions Au-dessus de, Por
 * encima de, Acima de: a sentence that names the option drops the "de"
 * ("une alerte Au-dessus ou En dessous").
 */
const TRAILING_DE: RegExp = /\s+de$/u;

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

function check(fields: Record<string, unknown>): DataCheck {
  const row: DataCheck = new DataCheck();
  Object.assign(row, {
    _id: CHECK,
    name: "a check",
    checkType: DataCheckType.CustomSql,
    isEnabled: true,
    lastRunStatus: DataCheckRunStatus.Ran,
    ...fields,
  });
  return row;
}

function latestProps(): Record<string, unknown> {
  expect(mockCapturedTableProps.length).toBeGreaterThan(0);
  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

function alertColumn(): CapturedColumn {
  const found: CapturedColumn | undefined = (
    latestProps()["columns"] as Array<CapturedColumn>
  ).find((column: CapturedColumn): boolean => {
    return column.title === "Alert";
  });

  expect(found).toBeDefined();

  return found!;
}

function formField(name: string): CapturedFormField {
  const field: CapturedFormField | undefined = (
    latestProps()["formFields"] as Array<CapturedFormField>
  ).find((candidate: CapturedFormField): boolean => {
    return Boolean(candidate.field?.[name]);
  });

  expect(field).toBeDefined();

  return field!;
}

function alertWhenOptions(): Array<DropdownOption> {
  const field: CapturedFormField | undefined = (
    latestProps()["formFields"] as Array<CapturedFormField>
  ).find((candidate: CapturedFormField): boolean => {
    return Boolean(candidate.field?.["alertCondition"]);
  });

  expect(field?.dropdownOptions).toBeDefined();

  return field!.dropdownOptions!;
}

// The Checks table in `language`, and what its Alert column draws for a check.
async function alertCell(
  language: string,
  fields: Record<string, unknown>,
): Promise<string> {
  await inLanguage(language);
  await act(async () => {
    render(<DataCheckTable dataAssetId={new ObjectID(TABLE)} />);
  });

  const item: DataCheck = check(fields);
  const element: ReactElement = alertColumn().getElement!(item);

  cleanup();

  const { container } = render(<MemoryRouter>{element}</MemoryRouter>);

  return withoutIsolateMarks(container.textContent || "");
}

// An id's suggestion, worded as DataCheckSuggestions words it (#7221).
const UNIQUE_ID_WORDS: {
  nameWords: DataCheckSuggestionWords;
  reasonWords: DataCheckSuggestionWords;
} = {
  nameWords: {
    template: DATA_CHECK_SUGGESTION_SENTENCES.uniqueName,
    values: { column: "id" },
  },
  reasonWords: {
    template: DATA_CHECK_SUGGESTION_SENTENCES.uniqueReason,
    values: { column: "id" },
  },
};

function suggestion(
  alertCondition: DataCheckAlertCondition,
  alertThreshold?: number,
  words: {
    nameWords: DataCheckSuggestionWords;
    reasonWords: DataCheckSuggestionWords;
  } = UNIQUE_ID_WORDS,
): DataCheckSuggestion {
  return {
    id: `suggestion-${alertCondition}-${alertThreshold}`,
    name: "id is unique",
    reason: "An id that repeats breaks every join and lookup on it.",
    ...words,
    checkType: DataCheckType.DuplicatePercent,
    columnName: "id",
    alertCondition: alertCondition,
    alertThreshold: alertThreshold,
  };
}

// The suggestions card in `language`, with one suggestion, and its fact line.
async function suggestionLine(
  language: string,
  offered: DataCheckSuggestion,
): Promise<string> {
  suggestDataChecksMock.mockReturnValue([offered]);
  await inLanguage(language);

  await act(async () => {
    render(
      <SuggestedDataChecks
        dataAssetId={new ObjectID(TABLE)}
        dataStoreId={null}
        tableName="orders"
        columns={[]}
        onChecksAdded={() => {}}
      />,
    );
  });

  // The name is the reader's words now (#7221): found by what it is.
  const name: HTMLElement = await screen.findByTestId(
    SUGGESTED_CHECK_NAME_TEST_ID,
  );
  const line: HTMLElement = name.nextElementSibling as HTMLElement;

  return withoutIsolateMarks(line.textContent || "");
}

beforeAll(async () => {
  // English unless a test reads the page in another language: with no English file, each word is its own.
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
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
  getDismissalsMock.mockReset();
  suggestDataChecksMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
  getDismissalsMock.mockResolvedValue([]);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  jest.spyOn(DataObservabilityApi, "getTableSensitivity").mockResolvedValue([]);
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("the checks' Alert column", () => {
  test("in English: the condition and its number, as before", async () => {
    expect(
      await alertCell("en", {
        alertCondition: DataCheckAlertCondition.Above,
        alertThreshold: 0,
      }),
    ).toBe("Above 0");
    expect(
      await alertCell("en", {
        alertCondition: DataCheckAlertCondition.UnusuallyHigh,
      }),
    ).toBe("Unusually High");
    expect(await alertCell("en", {})).toBe("No alert");
  });

  test("in English: a large number written the reader's way, and Above with no number its name alone", async () => {
    expect(
      await alertCell("en", {
        alertCondition: DataCheckAlertCondition.Below,
        alertThreshold: 12500,
      }),
    ).toBe("Below 12,500");
    expect(
      await alertCell("en", {
        alertCondition: DataCheckAlertCondition.Above,
      }),
    ).toBe("Above");
  });

  test.each([
    ["de", DataCheckAlertCondition.Above, 0, "Über 0"],
    ["de", DataCheckAlertCondition.Below, 5, "Unter 5"],
    [
      "de",
      DataCheckAlertCondition.UnusuallyHigh,
      undefined,
      "Ungewöhnlich hoch",
    ],
    ["ja", DataCheckAlertCondition.Above, 0, "0 を上回る"],
    ["ja", DataCheckAlertCondition.UnusuallyLow, undefined, "異常に低い"],
    ["ko", DataCheckAlertCondition.Above, 0, "0 초과"],
    ["ko", DataCheckAlertCondition.Below, 5, "5 미만"],
    ["hi", DataCheckAlertCondition.Above, 0, "0 से ऊपर"],
    ["ar", DataCheckAlertCondition.Below, 5, "أدنى من 5"],
    ["fa", DataCheckAlertCondition.Above, 5, "بالاتر از ۵"],
  ])(
    "in %s, %s (threshold: %s) reads %j",
    async (
      language: string,
      condition: DataCheckAlertCondition,
      threshold: number | undefined,
      expected: string,
    ) => {
      expect(
        await alertCell(language, {
          alertCondition: condition,
          alertThreshold: threshold,
        }),
      ).toBe(expected);
    },
  );

  test.each(LANGUAGES)(
    "in %s, no condition is drawn in English",
    async (language: string) => {
      for (const condition of DATA_CHECK_ALERT_CONDITIONS) {
        const cell: string = await alertCell(language, {
          alertCondition: condition,
          alertThreshold: 3,
        });

        expect({
          condition,
          cell,
          english: ENGLISH_CONDITION_WORDS.test(cell),
        }).toEqual({ condition, cell, english: false });
      }
    },
  );

  test("its export keeps the value a check is saved with, in any language", async () => {
    await inLanguage("de");
    await act(async () => {
      render(<DataCheckTable dataAssetId={new ObjectID(TABLE)} />);
    });

    expect(
      alertColumn().getExportValue!(
        check({
          alertCondition: DataCheckAlertCondition.Above,
          alertThreshold: 0,
        }),
      ),
    ).toBe(DataCheckAlertCondition.Above);
  });
});

describe("the Alert When dropdown", () => {
  test("offers every condition, each by a name the locale files word", async () => {
    await act(async () => {
      render(<DataCheckTable dataAssetId={new ObjectID(TABLE)} />);
    });

    const options: Array<DropdownOption> = alertWhenOptions();

    expect(
      options.map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual([...DATA_CHECK_ALERT_CONDITIONS]);
    expect(
      options.map((option: DropdownOption) => {
        return option.label;
      }),
    ).toEqual(["Unusually High", "Unusually Low", "Above", "Below"]);

    for (const option of options) {
      expect(option.label).toBe(
        DATA_CHECK_ALERT_CONDITION_LABELS[
          option.value as DataCheckAlertCondition
        ],
      );
      expect(readDashboardLocale("en")[option.label]).toBe(option.label);

      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          label: option.label,
          language,
          worded: isWordedInDashboardLocale(option.label, language),
        }).toEqual({ label: option.label, language, worded: true });
      }
    }
  });

  test.each([
    ["de", "Ungewöhnlich hoch"],
    ["ja", "異常に高い"],
    ["fa", readDashboardLocale("fa")["Unusually High"]!],
  ])(
    "in %s, a chosen Unusually High reads %j",
    async (language: string, expected: string) => {
      await act(async () => {
        render(<DataCheckTable dataAssetId={new ObjectID(TABLE)} />);
      });

      const options: Array<DropdownOption> = alertWhenOptions();

      cleanup();
      await inLanguage(language);

      const { container } = render(
        <Dropdown
          options={options}
          value={options[0]}
          onChange={() => {}}
          ariaLabel="Alert When"
        />,
      );

      expect(
        withoutIsolateMarks(
          container.querySelector(".ou-select__single-value")?.textContent ||
            "",
        ),
      ).toBe(expected);
    },
  );
});

describe("the Threshold field", () => {
  test("names Above and Below as the Alert When dropdown does, in every language", async () => {
    await act(async () => {
      render(<DataCheckTable dataAssetId={new ObjectID(TABLE)} />);
    });

    expect(formField("alertThreshold").description).toBe(THRESHOLD_DESCRIPTION);

    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);
      const said: string = locale[THRESHOLD_DESCRIPTION] || "";

      expect({ language, english: ENGLISH_ABOVE_OR_BELOW.test(said) }).toEqual({
        language,
        english: false,
      });

      for (const condition of [
        DataCheckAlertCondition.Above,
        DataCheckAlertCondition.Below,
      ]) {
        const label: string =
          locale[DATA_CHECK_ALERT_CONDITION_LABELS[condition]] || "";

        expect({
          language,
          label,
          named: said.includes(label.replace(TRAILING_DE, "")),
        }).toEqual({ language, label, named: true });
      }
    }
  });

  test("the check above catches English left in, and a word the dropdown does not show", () => {
    const hindi: Record<string, string> = readDashboardLocale("hi");
    const arabic: Record<string, string> = readDashboardLocale("ar");

    // The Hindi and Arabic descriptions before the dropdown was translated.
    expect(
      ENGLISH_ABOVE_OR_BELOW.test(
        "वह मान जिससे Above या Below अलर्ट तुलना करता है।",
      ),
    ).toBe(true);
    expect(
      "القيمة التي يقارن بها تنبيه «أعلى من» أو «أقل من».".includes(
        arabic["Below"] || "-",
      ),
    ).toBe(false);
    expect(hindi[THRESHOLD_DESCRIPTION]).toContain(`“${hindi["Above"]}”`);
    expect(arabic[THRESHOLD_DESCRIPTION]).toContain(`«${arabic["Below"]}»`);
  });
});

describe("a suggested check", () => {
  test("in English: its type, then the condition and its number, as before", async () => {
    expect(
      await suggestionLine("en", suggestion(DataCheckAlertCondition.Above, 0)),
    ).toBe("Duplicate Percent · Above 0");
  });

  test.each([
    ["de", DataCheckAlertCondition.Above, 0, "Über 0"],
    ["ja", DataCheckAlertCondition.Above, 0, "0 を上回る"],
    ["ko", DataCheckAlertCondition.Above, 0, "0 초과"],
    ["hi", DataCheckAlertCondition.Above, 0, "0 से ऊपर"],
    [
      "de",
      DataCheckAlertCondition.UnusuallyHigh,
      undefined,
      "Ungewöhnlich hoch",
    ],
    ["ar", DataCheckAlertCondition.Below, 5, "أدنى من 5"],
  ])(
    "in %s, %s (threshold: %s) ends with %j",
    async (
      language: string,
      condition: DataCheckAlertCondition,
      threshold: number | undefined,
      expected: string,
    ) => {
      const line: string = await suggestionLine(
        language,
        suggestion(condition, threshold),
      );

      expect(line.endsWith(expected)).toBe(true);
      expect(line).not.toMatch(ENGLISH_CONDITION_WORDS);
    },
  );

  test("Japanese no longer puts the condition before the number", async () => {
    const line: string = await suggestionLine(
      "ja",
      suggestion(DataCheckAlertCondition.Above, 0),
    );

    expect(line).not.toContain("上回る 0");
    expect(line.indexOf("0")).toBeLessThan(line.indexOf("上回る"));
  });
});

describe("a suggested check's own words", () => {
  test.each(["ar", "fa"])(
    "in %s, its name and reason are the page's words (#7221), read the page's way with no dir of their own",
    async (language: string) => {
      await suggestionLine(
        language,
        suggestion(DataCheckAlertCondition.Above, 0),
      );

      const words: Record<string, string> = readDashboardLocale(language);
      const name: HTMLElement = screen.getByTestId(
        SUGGESTED_CHECK_NAME_TEST_ID,
      );
      const reason: HTMLElement = screen.getByTestId(
        SUGGESTED_CHECK_REASON_TEST_ID,
      );

      // The column's own name in the language's sentence, set apart.
      expect(withoutIsolateMarks(name.textContent || "")).toBe(
        words[DATA_CHECK_SUGGESTION_SENTENCES.uniqueName]!.replace(
          "{{column}}",
          "id",
        ),
      );
      expect(reason.textContent).toBe(
        words[DATA_CHECK_SUGGESTION_SENTENCES.uniqueReason],
      );
      expect(name).not.toHaveAttribute("dir");
      expect(reason).not.toHaveAttribute("dir");
    },
  );

  test.each(["ar", "fa"])(
    "in %s, a line its language has no words for yet reads left to right, the reason's full stop at its end",
    async (language: string) => {
      await suggestionLine(
        language,
        suggestion(DataCheckAlertCondition.Above, 0, {
          nameWords: {
            template: "{{column}} keeps a promise no locale file words",
            values: { column: "id" },
          },
          reasonWords: {
            template: "A reason no locale file words.",
            values: {},
          },
        }),
      );

      const name: HTMLElement = screen.getByTestId(
        SUGGESTED_CHECK_NAME_TEST_ID,
      );
      const reason: HTMLElement = screen.getByTestId(
        SUGGESTED_CHECK_REASON_TEST_ID,
      );

      expect(name).toHaveAttribute("dir", "ltr");
      expect(withoutIsolateMarks(name.textContent || "")).toBe(
        "id keeps a promise no locale file words",
      );
      expect(reason).toHaveAttribute("dir", "ltr");
      expect(reason.textContent).toBe("A reason no locale file words.");
      // A paragraph that wraps: as wide as its words, at the page's start.
      expect(reason.className.split(" ")).toEqual(
        expect.arrayContaining(
          CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
        ),
      );
    },
  );

  test.each(["en", "de"])(
    "in %s, the lines read the page's way and are drawn as before, with no dir of their own",
    async (language: string) => {
      await suggestionLine(
        language,
        suggestion(DataCheckAlertCondition.Above, 0),
      );

      for (const testId of [
        SUGGESTED_CHECK_NAME_TEST_ID,
        SUGGESTED_CHECK_REASON_TEST_ID,
      ]) {
        const line: HTMLElement = screen.getByTestId(testId);

        expect(line).not.toHaveAttribute("dir");
        expect(line.className).not.toContain(
          CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
        );
      }
    },
  );
});
