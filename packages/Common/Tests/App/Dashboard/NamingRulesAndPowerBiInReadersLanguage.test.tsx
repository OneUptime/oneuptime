import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
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
  VIEWERS_IN_28_DAYS,
  VIEWS,
  getRefreshCountText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DashboardActivity";
import {
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/Naming/DeviceNamingApi",
  () => {
    return {
      __esModule: true,
      DEVICE_NAMING_ROUTES: {},
      planDeviceNaming: (...args: Array<unknown>) => {
        return planMock(...args);
      },
      applyDeviceNaming: jest.fn(),
      previewScanNames: jest.fn(),
      previewDiscoveredDeviceNames: jest.fn(),
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
            <button data-testid="modal-submit">{props.submitButtonText}</button>
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
    expect(GERMAN.translatePlural(VIEWS, 5, { count: 5 })).toBe(
      fill(wordsOf(DE, "{{count}} views"), { count: "5" }),
    );
    expect(GERMAN.translatePlural(VIEWS, 1, { count: 1 })).toBe(
      fill(wordsOf(DE, "{{count}} views_one"), { count: "1" }),
    );
    expect(GERMAN.translatePlural(VIEWERS_IN_28_DAYS, 12, { count: 12 })).toBe(
      fill(wordsOf(DE, "{{count}} viewers in the last 28 days"), {
        count: "12",
      }),
    );
  });
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
});
