import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import i18next, { createInstance, i18n } from "i18next";
import React, { ReactElement, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { ComponentProps as ModalProps } from "../../../UI/Components/Modal/Modal";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import NamingLookupTableEditor, {
  EMPTY_LOOKUP_TABLE_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/NamingLookupTableEditor";
import NamePatternInput from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/NamePatternInput";
import ApplyNamingRulesModal from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/ApplyNamingRulesModal";
import { getLookupTableFieldError } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/NamingRuleFormFields";
import {
  RefreshError,
  RefreshLine,
  VIEWERS_IN_28_DAYS,
  VIEWS,
  getRefreshCountText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DashboardActivity";
import TableDashboards from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/TableDashboards";
import { DataObservabilityTableDashboard } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { DataBiRefreshStatus } from "../../../Types/DataObservability/DataDashboardActivity";
import ObjectID from "../../../Types/ObjectID";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import {
  DeviceNamingApplyResult,
  DeviceNamingOutcome,
  DeviceNamingPlan,
  NamingLookupEntry,
  NamingLookupKey,
} from "../../../Types/NetworkDevice/DeviceNaming";
import {
  NAMING_LOOKUP_BAD_KEY_PROBLEMS,
  NAMING_LOOKUP_KEY_EXAMPLES,
  NAMING_LOOKUP_KEY_TITLES,
} from "../../../Utils/NetworkDevice/Naming/NamingLookup";
import {
  NamePatternProblem,
  getNamePatternProblem,
} from "../../../Utils/NetworkDevice/Naming/NamePattern";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  whenCodeCanBeSetApart,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  DrawnLine,
  drawLine,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

/*
 * NETWORK NAMING RULES AND POWER BI VIEWS AND REFRESHES, ON THE PAGE, IN THE
 * READER'S LANGUAGE (#6671, #6686).
 *
 * The naming rules' screens - the lookup table of a rule, its name pattern
 * field, the Apply Naming Rules dialog and the rule form's own check of the
 * table - and the Power BI lines of BI Dashboards, rendered by an i18next
 * that reads the Dashboard's real locale files. In German every sentence is
 * German, and a lookup table of each kind asks for its own rows in a whole
 * sentence: the one sentence it replaced put the key's title in the middle
 * of it, lowercased, so German read "den letzter teil der ip-adresse". In
 * Arabic and Persian the page shows the locale file's sentence, its code
 * drawn as it is written.
 */

const planMock: jest.Mock = jest.fn();
const applyMock: jest.Mock = jest.fn();
const tableDashboardsMock: jest.Mock = jest.fn();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/DeviceNamingApi",
  () => {
    return {
      __esModule: true,
      DEVICE_NAMING_ROUTES: {},
      planDeviceNaming: (...args: Array<unknown>) => {
        return planMock(...args);
      },
      applyDeviceNaming: (...args: Array<unknown>) => {
        return applyMock(...args);
      },
      previewScanNames: jest.fn(),
      previewDiscoveredDeviceNames: jest.fn(),
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        getTableDashboards: (...args: Array<unknown>) => {
          return tableDashboardsMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Medium: 1, Large: 2 },
    default: (props: ModalProps) => {
      return (
        <div role="dialog" aria-label={props.title}>
          <p data-testid="modal-description">{props.description}</p>
          {props.isBodyLoading ? <p>Loading plan</p> : props.children}
          {props.onSubmit && (
            <button
              data-testid="modal-submit"
              onClick={() => {
                props.onSubmit?.();
              }}
            >
              {props.submitButtonText}
            </button>
          )}
        </div>
      );
    },
  };
});

type Locale = Record<string, string>;

const EN: Locale = englishLocale as unknown as Locale;
const DE: Locale = germanLocale as unknown as Locale;
const RIGHT_TO_LEFT: Record<string, Locale> = {
  ar: arabicLocale as unknown as Locale,
  fa: persianLocale as unknown as Locale,
};

const KINDS: Array<NamingLookupKey> = Object.values(NamingLookupKey);

// A key of the wrong kind for each kind of table.
const BAD_KEYS: Record<NamingLookupKey, string> = {
  [NamingLookupKey.LastIpOctet]: "300",
  [NamingLookupKey.IpAddress]: "10.48.145",
  [NamingLookupKey.MacAddress]: "00:05:0b",
  // A row with a value and no key.
  [NamingLookupKey.DiscoveredName]: "",
};

// The locale's sentence with its values in, as the Translator fills it.
function fill(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }

  return text;
}

// The locale's own words for a key: never missing, never the English.
function wordsOf(locale: Locale, key: string): string {
  const words: string | undefined = locale[key];

  expect({ key, words }).toEqual({ key, words: expect.any(String) });
  expect({ key, same: words === EN[key] }).toEqual({ key, same: false });

  return words as string;
}

function instanceFor(language: string, locale: Locale): i18n {
  const instance: i18n = createInstance();

  void instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
}

function translatorFor(language: string, locale: Locale): Translator {
  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

const TableHarness: (props: {
  kind: NamingLookupKey;
  initial: Array<NamingLookupEntry>;
}) => ReactElement = (props: {
  kind: NamingLookupKey;
  initial: Array<NamingLookupEntry>;
}): ReactElement => {
  const [rows, setRows] = useState<Array<NamingLookupEntry>>(props.initial);

  return (
    <NamingLookupTableEditor
      kind={props.kind}
      entries={rows}
      onChange={setRows}
    />
  );
};

const PatternHarness: (props: { initial: string }) => ReactElement = (props: {
  initial: string;
}): ReactElement => {
  const [value, setValue] = useState<string>(props.initial);

  return <NamePatternInput value={value} onChange={setValue} />;
};

const PLAN: DeviceNamingPlan = {
  hasRules: true,
  devicesChecked: 6,
  followingCount: 2,
  isTruncated: false,
  items: [
    {
      deviceId: "device-1",
      currentName: "dmb-5",
      isNamedByPerson: false,
      outcome: DeviceNamingOutcome.Named,
      name: "UN1216DRTPLR02",
      ruleId: "rule-1",
      ruleName: "Menu boards",
    },
    {
      deviceId: "device-2",
      currentName: "Drive-thru screen 6",
      isNamedByPerson: true,
      outcome: DeviceNamingOutcome.Named,
      name: "UN1216DRTSCR06",
      ruleId: "rule-1",
      ruleName: "Menu boards",
    },
    {
      deviceId: "device-3",
      currentName: "10.99.0.51",
      isNamedByPerson: false,
      outcome: DeviceNamingOutcome.MissingValue,
      missing: "site.code",
      ruleId: "rule-1",
      ruleName: "Menu boards",
    },
    {
      deviceId: "device-4",
      currentName: "core-router",
      isNamedByPerson: true,
      outcome: DeviceNamingOutcome.NoMatchingRule,
    },
  ],
};

let german: i18n;

beforeAll(async () => {
  german = instanceFor("de", DE);

  // The rule form's checks read the global i18next, as the Dashboard's do.
  await i18next.init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  planMock.mockReset();
  applyMock.mockReset();
  tableDashboardsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

function inGerman(element: ReactElement): void {
  render(
    <I18nextProvider i18n={german}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>,
  );
}

describe("the naming rules, in German", () => {
  test.each(KINDS)(
    "an empty %s table asks for its rows in one German sentence",
    (kind: NamingLookupKey) => {
      inGerman(<TableHarness kind={kind} initial={[]} />);

      const shown: string =
        screen.getByTestId("naming-lookup-empty").textContent || "";
      const title: string = wordsOf(DE, NAMING_LOOKUP_KEY_TITLES[kind]);

      expect(shown).toBe(wordsOf(DE, EMPTY_LOOKUP_TABLE_SENTENCES[kind]));
      // The key's title is not lowercased into the sentence any more.
      if (title.toLowerCase() !== title) {
        expect(shown).not.toContain(title.toLowerCase());
      }
    },
  );

  test("no two kinds of table ask for their rows in the same German words", () => {
    const sentences: Set<string> = new Set(
      KINDS.map((kind: NamingLookupKey): string => {
        return wordsOf(DE, EMPTY_LOOKUP_TABLE_SENTENCES[kind]);
      }),
    );

    expect(sentences.size).toBe(KINDS.length);
  });

  test("a table with a row: its columns and its count, in German", () => {
    inGerman(
      <TableHarness
        kind={NamingLookupKey.LastIpOctet}
        initial={[{ key: "51", value: "MNUPLR01" }]}
      />,
    );

    const headers: Array<string> = screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return header.textContent || "";
      });

    expect(headers).toEqual(
      expect.arrayContaining([
        wordsOf(DE, "Last part of the IP address"),
        wordsOf(DE, "Value"),
      ]),
    );
    expect(
      screen.getByText(fill(wordsOf(DE, "{{count}} rows_one"), { count: "1" })),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("naming-lookup-empty")).toBeNull();
  });

  test("the name pattern field: its buttons, its example and a pattern's problem, in German", () => {
    inGerman(<PatternHarness initial="UN{site.code}{lookup}" />);

    const chips: HTMLElement = screen.getByTestId("name-pattern-chips");

    expect(chips).toHaveAttribute(
      "aria-label",
      wordsOf(DE, "Insert into the name pattern"),
    );
    expect(within(chips).getByText(wordsOf(DE, "Insert:"))).toBeInTheDocument();
    expect(
      screen.getByTestId("name-pattern-chip-{site.code}"),
    ).toHaveTextContent(wordsOf(DE, "Site code"));

    const example: HTMLElement = screen.getByTestId("name-pattern-example");

    expect(example).toHaveTextContent("UN1216MNUPLR01");
    expect(example).toHaveTextContent(
      wordsOf(DE, "for a device at 10.48.145.51 in the site coded 1216"),
    );

    cleanup();
    inGerman(<PatternHarness initial="UN{unit}" />);

    const problem: NamePatternProblem = getNamePatternProblem(
      "UN{unit}",
    ) as NamePatternProblem;

    expect(screen.getByTestId("name-pattern-problem").textContent).toBe(
      fill(wordsOf(DE, problem.template), problem.values),
    );
  });

  test.each(KINDS)(
    "the rule form says a %s table's key of the wrong kind in one German sentence",
    (kind: NamingLookupKey) => {
      const error: string | null = getLookupTableFieldError({
        namePattern: "{lookup}",
        lookupKey: kind,
        lookupEntries: [{ key: BAD_KEYS[kind], value: "MNUPLR01" }],
      } as never);

      expect(error).toBe(
        fill(wordsOf(DE, NAMING_LOOKUP_BAD_KEY_PROBLEMS[kind]), {
          row: "1",
          key: BAD_KEYS[kind],
          example: NAMING_LOOKUP_KEY_EXAMPLES[kind],
        }),
      );
    },
  );

  test("the Apply Naming Rules dialog, in German", async () => {
    planMock.mockResolvedValue(PLAN);

    inGerman(<ApplyNamingRulesModal onClose={() => {}} />);

    const plan: HTMLElement = await screen.findByTestId("naming-plan");

    expect(screen.getByTestId("naming-plan-summary").textContent).toBe(
      fill(
        wordsOf(
          DE,
          "{{count}} devices checked: {{rename}} to rename, {{following}} already follow your rules, {{attention}} need attention.",
        ),
        { count: "6", rename: "2", following: "2", attention: "1" },
      ),
    );
    expect(plan).toHaveTextContent(wordsOf(DE, "Will be renamed"));
    expect(plan).toHaveTextContent(wordsOf(DE, "Named by a person"));
    expect(
      within(screen.getByTestId("naming-plan-need-attention")).getByText(
        wordsOf(
          DE,
          "Its site has no site code, or it is in no site. Add the code on the site's settings.",
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("naming-plan-not-covered").textContent).toBe(
      fill(
        wordsOf(
          DE,
          "{{count}} devices are not covered by any naming rule and keep their names._one",
        ),
        { count: "1" },
      ),
    );
    expect(screen.getByTestId("modal-submit").textContent).toBe(
      fill(wordsOf(DE, "Rename {{count}} devices_one"), { count: "1" }),
    );
    expect(screen.getByTestId("modal-description").textContent).toBe(
      wordsOf(
        DE,
        "Rename devices to follow your naming rules. Nothing changes until you confirm.",
      ),
    );

    // Not one of the dialog's English sentences is left on it.
    for (const english of [
      "to rename",
      "Will be renamed",
      "Named by a person",
      "is not covered",
      "Nothing changes until you confirm",
    ]) {
      expect(document.body.textContent).not.toContain(english);
    }
  });

  test("a project with no rules is told, in German, where to add one", async () => {
    planMock.mockResolvedValue({
      hasRules: false,
      devicesChecked: 0,
      items: [],
      followingCount: 0,
      isTruncated: false,
    });

    inGerman(<ApplyNamingRulesModal onClose={() => {}} />);

    const noRules: HTMLElement = await screen.findByTestId(
      "naming-plan-no-rules",
    );

    expect(noRules).toHaveTextContent(
      wordsOf(DE, "No naming rules are enabled yet"),
    );
    expect(noRules).toHaveTextContent(
      wordsOf(
        DE,
        "Add a naming rule, such as UN{site.code}{lookup}, then apply it here.",
      ),
    );
    expect(noRules).toHaveTextContent(wordsOf(DE, "Go to Naming Rules"));
  });
});

describe("Power BI views and refreshes, in German", () => {
  const GERMAN: Translator = translatorFor("de", DE);

  test("a week's refreshes: how many, and how many failed", () => {
    expect(
      getRefreshCountText(GERMAN, {
        refreshCount: 24,
        failureCount: 3,
      } as never),
    ).toBe(
      fill(wordsOf(DE, "{{failed}} of {{count}} failed in the last 7 days"), {
        failed: "3",
        count: "24",
      }),
    );
    expect(
      getRefreshCountText(GERMAN, {
        refreshCount: 24,
        failureCount: 0,
      } as never),
    ).toBe(
      fill(wordsOf(DE, "{{count}} refreshes in the last 7 days"), {
        count: "24",
      }),
    );
    expect(
      getRefreshCountText(GERMAN, {
        refreshCount: 1,
        failureCount: 0,
      } as never),
    ).toBe(
      fill(wordsOf(DE, "{{count}} refreshes in the last 7 days_one"), {
        count: "1",
      }),
    );
  });

  test("views and viewers, one and many", () => {
    expect(GERMAN.translatePlural(VIEWS, 5)).toBe(
      fill(wordsOf(DE, "{{count}} views"), { count: "5" }),
    );
    expect(GERMAN.translatePlural(VIEWS, 1)).toBe(
      fill(wordsOf(DE, "{{count}} views_one"), { count: "1" }),
    );
    expect(GERMAN.translatePlural(VIEWERS_IN_28_DAYS, 12)).toBe(
      fill(wordsOf(DE, "{{count}} viewers in the last 28 days"), {
        count: "12",
      }),
    );
  });

  /*
   * A count written the German way (#6671 review): the screens filled
   * {{count}} with the raw number, so a much-opened dashboard read "12873
   * Aufrufe" and a busy refresh schedule "1203 von 1408".
   */
  test("a count in the thousands is written the German way", () => {
    expect(GERMAN.translatePlural(VIEWS, 12873)).toBe(
      fill(wordsOf(DE, "{{count}} views"), { count: "12.873" }),
    );
    expect(GERMAN.translatePlural(VIEWERS_IN_28_DAYS, 2400)).toBe(
      fill(wordsOf(DE, "{{count}} viewers in the last 28 days"), {
        count: "2.400",
      }),
    );
    expect(
      getRefreshCountText(GERMAN, {
        refreshCount: 1408,
        failureCount: 1203,
      } as never),
    ).toBe(
      fill(wordsOf(DE, "{{failed}} of {{count}} failed in the last 7 days"), {
        failed: "1.203",
        count: "1.408",
      }),
    );
    expect(
      getRefreshCountText(GERMAN, {
        refreshCount: 1408,
        failureCount: 0,
      } as never),
    ).toBe(
      fill(wordsOf(DE, "{{count}} refreshes in the last 7 days"), {
        count: "1.408",
      }),
    );
  });
});

const FA: Locale = RIGHT_TO_LEFT["fa"] as Locale;
const AR: Locale = RIGHT_TO_LEFT["ar"] as Locale;
const LATIN_DIGIT: RegExp = /[0-9]/;

/*
 * Persian writes its figures in Persian digits: the count the Translator
 * fills in, and the 7 and 28 of the sentence around it, as fa.json does in
 * every other "in the last N days".
 */
describe("Power BI views and refreshes, in Persian and Arabic", () => {
  const PERSIAN: Translator = translatorFor("fa", FA);
  const ARABIC: Translator = translatorFor("ar", AR);

  test("Persian: the counts and the days in Persian digits, not one Latin digit", () => {
    const lines: Array<[string, string]> = [
      [
        PERSIAN.translatePlural(VIEWS, 12873),
        fill(wordsOf(FA, "{{count}} views"), { count: "۱۲٬۸۷۳" }),
      ],
      [
        PERSIAN.translatePlural(VIEWERS_IN_28_DAYS, 1),
        fill(wordsOf(FA, "{{count}} viewers in the last 28 days_one"), {
          count: "۱",
        }),
      ],
      [
        PERSIAN.translatePlural(VIEWERS_IN_28_DAYS, 42),
        fill(wordsOf(FA, "{{count}} viewers in the last 28 days"), {
          count: "۴۲",
        }),
      ],
      [
        getRefreshCountText(PERSIAN, {
          refreshCount: 1408,
          failureCount: 3,
        } as never) as string,
        fill(wordsOf(FA, "{{failed}} of {{count}} failed in the last 7 days"), {
          failed: "۳",
          count: "۱٬۴۰۸",
        }),
      ],
      [
        getRefreshCountText(PERSIAN, {
          refreshCount: 24,
          failureCount: 0,
        } as never) as string,
        fill(wordsOf(FA, "{{count}} refreshes in the last 7 days"), {
          count: "۲۴",
        }),
      ],
      [
        getRefreshCountText(PERSIAN, {
          refreshCount: 1,
          failureCount: 0,
        } as never) as string,
        fill(wordsOf(FA, "{{count}} refreshes in the last 7 days_one"), {
          count: "۱",
        }),
      ],
    ];

    for (const [shown, expected] of lines) {
      expect(withoutIsolates(shown)).toBe(expected);
      expect({ shown, latin: LATIN_DIGIT.test(shown) }).toEqual({
        shown,
        latin: false,
      });
    }
  });

  test("Persian: the naming rules' figures in prose are Persian digits too", () => {
    for (const key of [
      "Only the first 20,000 devices were checked. Select devices on the Devices list to check the rest.",
      "The device's MAC address as 12 digits and letters, without separators.",
      "{{count}} refreshes in the last 7 days",
      "{{count}} refreshes in the last 7 days_one",
      "{{count}} viewers in the last 28 days",
      "{{count}} viewers in the last 28 days_one",
      "{{failed}} of {{count}} failed in the last 7 days",
    ]) {
      const words: string = wordsOf(FA, key);

      expect({ key, latin: LATIN_DIGIT.test(words) }).toEqual({
        key,
        latin: false,
      });
    }

    expect(
      FA[
        "Only the first 20,000 devices were checked. Select devices on the Devices list to check the rest."
      ],
    ).toContain(PERSIAN.formatNumber(20000));
  });

  test("Arabic: the counts in the Latin digits Arabic is written with here, grouped", () => {
    expect(withoutIsolates(ARABIC.translatePlural(VIEWS, 12873))).toBe(
      fill(wordsOf(AR, "{{count}} views"), { count: "12,873" }),
    );
    expect(
      withoutIsolates(
        getRefreshCountText(ARABIC, {
          refreshCount: 1408,
          failureCount: 1203,
        } as never) as string,
      ),
    ).toBe(
      fill(wordsOf(AR, "{{failed}} of {{count}} failed in the last 7 days"), {
        failed: "1,203",
        count: "1,408",
      }),
    );
  });
});

/*
 * The three files that draw Power BI's counts and refresh errors: none
 * hands translatePlural a count of its own (which skipped the reader's way
 * of writing it), and none draws a refresh's error on a span of the page's
 * direction (RefreshError, below).
 */
describe("the Power BI screens' source", () => {
  const DASHBOARD_SOURCE: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src",
  );
  const FILES: Array<string> = [
    "Components/DataObservability/DashboardActivity.tsx",
    "Components/DataObservability/TableDashboards.tsx",
    "Pages/DataObservability/BiDashboards.tsx",
  ];

  // translatePlural handed a {{count}} of its own for a Power BI count.
  const COUNT_OF_ITS_OWN: RegExp =
    /translatePlural\(\s*(?:VIEWS|VIEWERS_IN_28_DAYS|REFRESHES_IN_A_WEEK)\s*,\s*[^,()]+(?:\([^()]*\))?\s*,\s*\{/;
  const COUNT_OF_ITS_OWN_ALL: RegExp = new RegExp(COUNT_OF_ITS_OWN.source, "g");
  const RAW_REFRESH_COUNT: RegExp = /count:\s*history\.refreshCount\b/g;
  // A span that draws an error, titled with it, in the page's direction.
  const ERROR_SPAN: RegExp = /<span[^>]*title=\{[^}]*[eE]rror\}/;
  const ERROR_SPAN_ALL: RegExp = new RegExp(ERROR_SPAN.source, "g");

  test.each(FILES)("%s", (file: string) => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SOURCE, file),
      "utf-8",
    );

    expect(source.match(COUNT_OF_ITS_OWN_ALL)).toBeNull();
    expect(source.match(RAW_REFRESH_COUNT)).toBeNull();
    expect(source.match(ERROR_SPAN_ALL)).toBeNull();
  });

  test("the check itself catches a count of its own and an error's span", () => {
    expect(
      COUNT_OF_ITS_OWN.test(
        "translator.translatePlural(VIEWS, viewer.views, {\n count: viewer.views,\n })",
      ),
    ).toBe(true);
    expect(
      COUNT_OF_ITS_OWN.test("translator.translatePlural(VIEWS, viewer.views)"),
    ).toBe(false);
    expect(
      ERROR_SPAN.test(
        '<span\n className="max-w-md truncate"\n title={dashboard.lastRefreshError}\n>',
      ),
    ).toBe(true);
    expect(
      ERROR_SPAN.test(
        '<RefreshError\n error={dashboard.lastRefreshError}\n className="max-w-md truncate"\n/>',
      ),
    ).toBe(false);
  });
});

const ENGLISH_ERROR: string =
  "The credentials provided for the SQL source are invalid.";

describe("a Power BI refresh's English error, on a page read either way", () => {
  function inLanguageOf(language: string, element: ReactElement): void {
    const locale: Locale =
      language === "de" ? DE : (RIGHT_TO_LEFT[language] as Locale);

    render(
      <I18nextProvider i18n={instanceFor(language, locale)}>
        <MemoryRouter>{element}</MemoryRouter>
      </I18nextProvider>,
    );
  }

  /*
   * Power BI's errors are English. On an Arabic or Persian page the line
   * read the page's way: cut short, it lost its start ("...source are
   * invalid") and its full stop moved to its other end.
   */
  test.each(["ar", "fa"])(
    "%s: the error reads its own way, is cut at its end and keeps its title",
    (language: string) => {
      inLanguageOf(
        language,
        <RefreshError
          error={ENGLISH_ERROR}
          className="max-w-md truncate text-xs text-red-600"
        />,
      );

      const line: HTMLElement = screen.getByTestId("refresh-error");

      expect(line.tagName).toBe("SPAN");
      expect(line).toHaveAttribute("dir", "ltr");
      expect(line).toHaveAttribute("title", ENGLISH_ERROR);
      expect(line.textContent).toBe(ENGLISH_ERROR);
      expect(line.className.split(" ")).toEqual(
        expect.arrayContaining([
          "max-w-md",
          "truncate",
          "text-red-600",
          LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
        ]),
      );
    },
  );

  test("German: an English error reads the page's way, drawn as it was", () => {
    inLanguageOf(
      "de",
      <RefreshError
        error={ENGLISH_ERROR}
        className="max-w-md truncate text-xs text-red-600"
      />,
    );

    const line: HTMLElement = screen.getByTestId("refresh-error");

    expect(line).not.toHaveAttribute("dir");
    expect(line.className).toBe("max-w-md truncate text-xs text-red-600");
  });

  test("a refresh line: the error on its own line, beside the status", () => {
    inLanguageOf(
      "ar",
      <RefreshLine
        refresh={{
          status: DataBiRefreshStatus.Failed,
          startedAt: "2026-11-10T08:00:00.000Z",
          endedAt: "2026-11-10T08:01:00.000Z",
          type: "Scheduled",
          error: ENGLISH_ERROR,
        }}
      />,
    );

    expect(screen.getByTestId("refresh-error")).toHaveAttribute("dir", "ltr");
  });

  test.each(["fa", "ar"])(
    "%s: a table's dashboards, their counts written the page's way and the error its own",
    async (language: string) => {
      const dashboard: DataObservabilityTableDashboard = {
        dataDashboardId: "dashboard-1",
        name: "Store sales",
        url: null,
        tool: "PowerBi",
        folder: null,
        owner: "ana@example.com",
        via: null,
        viewCount: 12873,
        viewerCount: 1,
        lastViewedAt: null,
        lastRefreshStatus: DataBiRefreshStatus.Failed,
        lastRefreshAt: null,
        lastRefreshError: ENGLISH_ERROR,
      };

      tableDashboardsMock.mockResolvedValue([dashboard]);

      inLanguageOf(
        language,
        <TableDashboards
          dataAssetId={new ObjectID("10000000-0000-4000-8000-000000000002")}
        />,
      );

      const list: HTMLElement = await screen.findByTestId("table-dashboards");
      const locale: Locale = RIGHT_TO_LEFT[language] as Locale;
      const thousands: string = language === "fa" ? "۱۲٬۸۷۳" : "12,873";

      expect(withoutIsolates(list.textContent || "")).toContain(
        fill(wordsOf(locale, "{{count}} views"), { count: thousands }),
      );
      expect(within(list).getByTestId("refresh-error")).toHaveAttribute(
        "dir",
        "ltr",
      );

      fireEvent.click(within(list).getByRole("button", { expanded: false }));

      const one: string = fill(
        wordsOf(locale, "{{count}} viewers in the last 28 days_one"),
        { count: language === "fa" ? "۱" : "1" },
      );

      expect(withoutIsolates(list.textContent || "")).toContain(one);

      if (language === "fa") {
        expect(LATIN_DIGIT.test(one)).toBe(false);
      }
    },
  );
});

/*
 * Where each unit of `written` is in `shown`, the same text with isolates'
 * marks added (Tests/App/Dashboard/CodeInHelpTextsOnThePage).
 */
function placesIn(written: string, shown: string): Array<number> {
  const places: Array<number> = [];
  let at: number = 0;

  for (let index: number = 0; index < shown.length; index++) {
    if (at < written.length && shown[index] === written[at]) {
      places.push(index);
      at++;
    }
  }

  return places;
}

// Whether `code`, where `shown` names it, is drawn as it is written.
function isCodeDrawnAsWritten(shown: string, code: string): boolean {
  const written: string = withoutIsolates(shown);
  const start: number = written.indexOf(code);

  expect(start).toBeGreaterThanOrEqual(0);

  const places: Array<number> = placesIn(written, shown);
  const line: DrawnLine = drawLine(shown, "rtl");

  return isDrawnAsWritten(
    line,
    places[start] as number,
    (places[start + code.length - 1] as number) + 1,
  );
}

describe.each(["ar", "fa"])("the naming rules, in %s", (language: string) => {
  const locale: Locale = RIGHT_TO_LEFT[language] as Locale;
  let instance: i18n;

  beforeAll(async () => {
    await whenCodeCanBeSetApart(language);
    instance = createInstance();
    await instance
      .use(productNamePostProcessor)
      .use(codeReadsAsWrittenPostProcessor)
      .init({
        lng: language,
        fallbackLng: "en",
        postProcess: getTranslationPostProcess(),
        resources: {
          en: { translation: englishLocale },
          [language]: { translation: locale },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });
  });

  function inLanguage(element: ReactElement): void {
    render(
      <I18nextProvider i18n={instance}>
        <MemoryRouter>{element}</MemoryRouter>
      </I18nextProvider>,
    );
  }

  test.each(KINDS)(
    "an empty %s table asks for its rows in the page's language",
    (kind: NamingLookupKey) => {
      inLanguage(<TableHarness kind={kind} initial={[]} />);

      const shown: string =
        screen.getByTestId("naming-lookup-empty").textContent || "";

      expect(withoutIsolates(shown)).toBe(
        wordsOf(locale, EMPTY_LOOKUP_TABLE_SENTENCES[kind]),
      );
    },
  );

  test("the name pattern field's example: the address and site code it names drawn as written", () => {
    inLanguage(<PatternHarness initial="UN{site.code}{lookup}" />);

    const example: HTMLElement = screen.getByTestId("name-pattern-example");
    const line: string =
      within(example).getByText((_content: string, element: Element | null) => {
        return (
          withoutIsolates(element?.textContent || "") ===
          locale["for a device at 10.48.145.51 in the site coded 1216"]
        );
      }).textContent || "";

    expect(isCodeDrawnAsWritten(line, "10.48.145.51")).toBe(true);
    expect(isCodeDrawnAsWritten(line, "1216")).toBe(true);
  });

  test("a project with no rules is told where to add one, the sample pattern drawn as written", async () => {
    planMock.mockResolvedValue({
      hasRules: false,
      devicesChecked: 0,
      items: [],
      followingCount: 0,
      isTruncated: false,
    });

    inLanguage(<ApplyNamingRulesModal onClose={() => {}} />);

    const noRules: HTMLElement = await screen.findByTestId(
      "naming-plan-no-rules",
    );
    const sentence: string = wordsOf(
      locale,
      "Add a naming rule, such as UN{site.code}{lookup}, then apply it here.",
    );
    const shown: string =
      within(noRules).getByText((_content: string, element: Element | null) => {
        return withoutIsolates(element?.textContent || "") === sentence;
      }).textContent || "";

    expect(isCodeDrawnAsWritten(shown, "UN{site.code}{lookup}")).toBe(true);
  });

  /*
   * A device's name, on a line of its own: an English one reads its own
   * way, where dir="auto" had it read its own way and line up on the left
   * (#6686 review). The name breaks anywhere (break-all), so a long one
   * wraps onto more lines, and since #6849 a line that wraps is as wide as
   * its words, up to its holder (CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME):
   * a short name starts where the page's lines do, and each line of a long
   * one runs from its own start. Aligned to its end (text-end), as a line
   * that never wraps is, a long name's wrapped lines lined up on the right,
   * ragged on the left where they start (#6900).
   */
  const expectsWrappedNameReadingItsOwnWay: (name: HTMLElement) => void = (
    name: HTMLElement,
  ): void => {
    const classes: Array<string> = name.className.split(" ");

    expect(name).toHaveAttribute("dir", "ltr");
    expect(classes).toEqual(
      expect.arrayContaining([
        "block",
        "break-all",
        ...CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
      ]),
    );
    expect(classes).not.toContain(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  };

  test("the names of devices that need attention, and of those left alone, read their own way", async () => {
    planMock.mockResolvedValue({
      ...PLAN,
      items: PLAN.items.map((item: DeviceNamingPlan["items"][number]) => {
        return item.deviceId === "device-3"
          ? { ...item, currentName: "Drive-thru board 3" }
          : item;
      }),
    });
    applyMock.mockResolvedValue({
      renamed: 0,
      skipped: [
        {
          deviceId: "device-1",
          reason:
            "The device was renamed since the preview, so it was left alone.",
        },
      ],
    } as DeviceNamingApplyResult);

    inLanguage(<ApplyNamingRulesModal onClose={() => {}} />);

    const attention: HTMLElement = await screen.findByTestId(
      "naming-plan-attention",
    );
    const attentionName: HTMLElement =
      within(attention).getByText("Drive-thru board 3");

    expect(attentionName.tagName).toBe("SPAN");
    expectsWrappedNameReadingItsOwnWay(attentionName);
    expect(attention.querySelectorAll("[dir=auto]").length).toBe(0);

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-submit"));
    });

    const skipped: HTMLElement = await screen.findByTestId(
      "naming-apply-skipped",
    );
    const skippedName: HTMLElement = within(skipped).getByText("dmb-5");

    expectsWrappedNameReadingItsOwnWay(skippedName);
    expect(skipped.querySelectorAll("[dir=auto]").length).toBe(0);
  });
});
