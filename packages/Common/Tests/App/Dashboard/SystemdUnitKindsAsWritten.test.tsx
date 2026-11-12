import "@testing-library/jest-dom";
import {
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
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { settle } from "./HostTooltipHarness";
import { createTranslator, Translator } from "../../../Types/Translator";
import OneUptimeDate from "../../../Types/Date";

/*
 * #6731: A SYSTEMD UNIT'S KIND, AS SYSTEMD WRITES IT, IN EVERY LANGUAGE.
 *
 * The Systemd Units list, its Type filter and a unit's page - its Unit Type
 * tile and the Type chip under its name - rendered from the real locale
 * files through a real i18next instance, in English, German, Arabic and
 * Persian.
 *
 * The page used to title-case the end of the unit's name ("Target") and
 * look that up as a word: German read a .target unit's kind as "Ziel",
 * Arabic as "القيمة المستهدفة" (a target value), Persian a .mount unit's as
 * "اتصال" (a connection) - words other screens of the Dashboard mean
 * something else by, for a kind `systemctl` prints, a unit's file is named
 * with and `systemctl list-units --type=` takes, in every language, as
 * written. Every kind is now shown so, as code, and the filter offers and
 * matches the kinds as written.
 *
 * The rest of what the two pages say - the filter bar's count, the search
 * box, the Availability tile, the Last sample chip, the timeline's note and
 * the State Changes card - is read in the reader's words, every number in
 * the reader's digits: "فعال در ۳ از ۴ نمونه", never "فعال در 3 از ۴".
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const TABLE_ID: string = "host-systemd-units-table";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const lastParamMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: () => {
        return lastParamMock();
      },
      navigate: () => {},
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="line-chart" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import HostSystemdUnits from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnits";
import HostSystemdUnitView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnitView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  SYSTEMD_UNIT_KIND_CLASS_NAME,
  SYSTEMD_UNIT_KIND_FIGURE_CLASS_NAME,
  SYSTEMD_UNIT_KIND_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Host/SystemdUnitKind";
import { SYSTEMD_UNIT_KINDS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnits";
import { EMPTY_VALUE_MARK } from "../../../UI/Components/Detail/EmptyValue";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";

type Locale = Record<string, string>;

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

interface Reader {
  language: string;
  locale: Locale;
}

const READERS: Array<Reader> = [
  { language: "en", locale: englishLocale as unknown as Locale },
  { language: "de", locale: germanLocale as unknown as Locale },
  { language: "ar", locale: arabicLocale as unknown as Locale },
  { language: "fa", locale: persianLocale as unknown as Locale },
];

/*
 * One unit of every kind systemd defines, each named as a real one is, and
 * one whose name has no kind at its end. Already in the A to Z order the
 * list opens on.
 */
const UNIT_NAMES: Array<string> = [
  "cups.path",
  "dev-sda1.device",
  "docker.socket",
  "logrotate.timer",
  "multi-user.target",
  "nginx.service",
  "proc-sys-fs-binfmt_misc.automount",
  "session-4.scope",
  "swapfile.swap",
  "user.slice",
  "var-lib-docker.mount",
  "weird-unit-name",
];

// A unit's kind, as its name ends: "" for the one that has none.
function kindOf(name: string): string {
  const dot: number = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1);
}

const instances: Map<string, i18n> = new Map();

function instanceFor(reader: Reader): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: reader.language,
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      [reader.language]: { translation: reader.locale },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
}

// A word as the reader's language has it ("Typ" for Type in German).
function word(reader: Reader, english: string): string {
  return reader.locale[english] || english;
}

/*
 * The words the reader's language has for a kind as a page word, title-
 * cased or not, where it has one other than the kind itself: German's
 * "Ziel" for Target, Arabic's "الخدمة" for Service. None of them may stand
 * for a unit's kind.
 */
function pageWordsForKinds(reader: Reader): Array<string> {
  const words: Set<string> = new Set();

  for (const kind of SYSTEMD_UNIT_KINDS) {
    const titled: string = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;

    for (const english of [kind, titled]) {
      const translated: string | undefined = reader.locale[english];

      if (translated && translated !== kind && translated !== titled) {
        words.add(translated);
      }
    }
  }

  return Array.from(words);
}

function unitReading(
  name: string,
  msAgo: number = 15_000,
  state: string = "active",
): Record<string, unknown> {
  return {
    time: new Date(Date.now() - msAgo),
    // The state each unit is in; the zero-valued rest are not fetched.
    value: 1,
    attributes: {
      "resource.systemd.unit.name": name,
      "systemd.unit.active_state": state,
      "resource.host.name": "web-01",
    },
  };
}

/*
 * The reader's translator, built on the locale file the page reads: what
 * the page should say, in the reader's words and digits.
 */
function translatorFor(reader: Reader): Translator {
  return createTranslator((text: string): string | undefined => {
    return reader.locale[text];
  }, reader.language);
}

// A fixed text as the reader's page draws it.
function textFor(reader: Reader, english: string): string {
  return translatorFor(reader).translateText(english) || english;
}

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[۰-۹]/;

/*
 * The innermost elements reading `text`, isolate marks aside: the element
 * that draws a sentence, not each of the elements around it.
 */
function elementsReading(text: string): Array<HTMLElement> {
  const wanted: string = withoutIsolateMarks(text).trim();
  const reads: (element: Element) => boolean = (element: Element): boolean => {
    return withoutIsolateMarks(element.textContent || "").trim() === wanted;
  };

  return Array.from(document.body.querySelectorAll<HTMLElement>("*")).filter(
    (element: HTMLElement): boolean => {
      return (
        reads(element) &&
        !Array.from(element.children).some((child: Element): boolean => {
          return reads(child);
        })
      );
    },
  );
}

beforeAll(() => {
  for (const reader of READERS) {
    instances.set(reader.language, instanceFor(reader));
  }
});

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  lastParamMock.mockReset();
  getItemMock.mockResolvedValue({
    _id: MODEL_ID,
    name: "web-01",
    hostIdentifier: "web-01",
    osType: "linux",
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

async function renderIn(
  reader: Reader,
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<void> {
  render(
    <I18nextProvider i18n={instances.get(reader.language)!}>
      <Page {...PAGE_PROPS} />
    </I18nextProvider>,
  );
  await settle();
}

test("every kind systemd defines is listed, and one unit has none", () => {
  expect(
    UNIT_NAMES.map(kindOf)
      .filter((kind: string): boolean => {
        return kind !== "";
      })
      .sort(),
  ).toEqual([...SYSTEMD_UNIT_KINDS].sort());
  expect(UNIT_NAMES.map(kindOf)).toContain("");
});

test("a tile's kind is a block as wide as the kind, so it starts where the tile's other figures start", () => {
  /*
   * A code element reads left to right on every page (Theme.css): as a
   * full-width block it set "mount" at the left of a Persian tile whose
   * title and neighbouring figures start at the right.
   */
  expect(SYSTEMD_UNIT_KIND_FIGURE_CLASS_NAME.split(" ")).toEqual(
    expect.arrayContaining(["block", "w-fit", "font-mono"]),
  );
  expect(SYSTEMD_UNIT_KIND_FIGURE_CLASS_NAME).not.toMatch(/\bw-full\b/);
});

test("the expected words are the reader's own: Persian's in Persian digits", () => {
  const persian: Translator = translatorFor(READERS[3]!);
  const sentence: string = persian.translatePlural(
    {
      one: "active in {{active}} of {{count}} sample",
      other: "active in {{active}} of {{count}} samples",
    },
    4,
    { active: persian.formatNumber(3) },
  );

  expect(withoutIsolateMarks(sentence)).toBe("فعال در ۳ از ۴ نمونه");

  // The negative control: the count passed as it is reads in Latin digits.
  expect(
    withoutIsolateMarks(
      persian.translatePlural(
        {
          one: "active in {{active}} of {{count}} sample",
          other: "active in {{active}} of {{count}} samples",
        },
        4,
        { active: 3 },
      ),
    ),
  ).toMatch(LATIN_DIGIT);
});

test("each language has a word of its own for some kind, which the page must not use", () => {
  // The words the old page drew: what this suite proves it no longer does.
  expect(pageWordsForKinds(READERS[1]!)).toEqual(
    expect.arrayContaining(["Dienst", "Ziel", "Gerät", "Pfad"]),
  );
  expect(pageWordsForKinds(READERS[2]!)).toEqual(
    expect.arrayContaining(["الخدمة", "القيمة المستهدفة", "نقطة التحميل"]),
  );
  expect(pageWordsForKinds(READERS[3]!)).toEqual(
    expect.arrayContaining(["سرویس", "هدف", "اتصال"]),
  );
});

/*
 * Every sentence the two pages draw, in every Dashboard language: each
 * string of their source that is a key of the English locale file - with
 * its "one" form where it has one - is worded in each language, with the
 * English's {{placeholders}}. Fourteen languages read 21 of them in
 * English ("Search units...", "Last sample {{time}}", the State Changes
 * card's sentences) until #6731's review.
 */
const SYSTEMD_PAGE_SOURCES: Array<string> = [
  "Pages/Host/View/SystemdUnits.tsx",
  "Pages/Host/View/SystemdUnitView.tsx",
].map((file: string): string => {
  return path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src",
    file,
  );
});

const STRING_LITERAL: RegExp =
  /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`$\\\n]*)`/g;

function systemdPageKeys(): Array<string> {
  const english: Record<string, string> = readDashboardLocale("en");
  const keys: Set<string> = new Set();

  for (const file of SYSTEMD_PAGE_SOURCES) {
    const source: string = fs.readFileSync(file, "utf8");

    for (const match of source.matchAll(STRING_LITERAL)) {
      const text: string = (match[1] ?? match[2] ?? match[3] ?? "").replace(
        /\\(["'\\])/g,
        "$1",
      );

      for (const key of [text, `${text}_one`]) {
        if (Object.prototype.hasOwnProperty.call(english, key)) {
          keys.add(key);
        }
      }
    }
  }

  return Array.from(keys).sort();
}

const SYSTEMD_PAGE_KEYS: Array<string> = systemdPageKeys();

test("the pages' sentences are read from their source, those #6731's review worded among them", () => {
  expect(SYSTEMD_PAGE_KEYS.length).toBeGreaterThan(40);
  expect(SYSTEMD_PAGE_KEYS).toEqual(
    expect.arrayContaining([
      "Search units...",
      "Last sample {{time}}",
      "{{count}} units",
      "{{count}} units_one",
      "{{shown}} of {{count}} units",
      "active in {{active}} of {{count}} samples",
      "active in {{active}} of {{count}} samples (capped)_one",
      "No unit metrics in range",
      "The unit state did not change in the selected time range.",
      'No "{{unitName}}" samples in this time range. Pick a wider range, or check that the collector\'s systemd receiver includes "{{unitName}}": see the Documentation tab.',
    ]),
  );
});

describe.each(DASHBOARD_LANGUAGES)(
  "the systemd pages' words in %s",
  (language: string) => {
    test("every sentence is worded in this language", () => {
      expect(
        SYSTEMD_PAGE_KEYS.filter((key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        }),
      ).toEqual([]);
    });

    test("every sentence keeps the English's placeholders", () => {
      const english: Record<string, string> = readDashboardLocale("en");
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of SYSTEMD_PAGE_KEYS) {
        expect({ key, placeholders: placeholdersOf(words[key] || "") }).toEqual(
          { key, placeholders: placeholdersOf(english[key]!) },
        );
      }
    });
  },
);

describe.each(READERS)(
  "the Systemd Units list in $language",
  (reader: Reader) => {
    beforeEach(() => {
      // Each unit active, read 15 seconds ago (not map's index and array).
      getListMock.mockResolvedValue({
        data: UNIT_NAMES.map((name: string): Record<string, unknown> => {
          return unitReading(name);
        }),
      });
    });

    function body(): HTMLElement {
      const found: HTMLElement | null = document.getElementById(
        `${TABLE_ID}-body`,
      );
      expect(found).not.toBeNull();
      return found!;
    }

    // Each row on screen: its unit's name and its Type cell.
    function rows(): Array<{ name: string; type: HTMLElement }> {
      return Array.from(body().querySelectorAll("tr")).map(
        (row: HTMLTableRowElement): { name: string; type: HTMLElement } => {
          const cells: NodeListOf<HTMLTableCellElement> =
            row.querySelectorAll("td");
          return {
            name: (cells[0]?.textContent || "").trim(),
            type: cells[1] as HTMLElement,
          };
        },
      );
    }

    /*
     * The Type chip - not the Type column's heading, which sorts - and the
     * list of kinds it opens.
     */
    function openTypeFilter(): HTMLElement {
      const chips: Array<HTMLElement> = screen
        .getAllByTestId("filter-chip")
        .map((place: HTMLElement): HTMLElement | null => {
          return within(place).queryByRole("button", {
            name: new RegExp(`^${word(reader, "Type")}$`),
          });
        })
        .filter((button: HTMLElement | null): button is HTMLElement => {
          return button !== null;
        });
      expect(chips).toHaveLength(1);
      const chip: HTMLElement = chips[0]!;
      fireEvent.click(chip);
      const dialog: HTMLElement = chip
        .closest('[data-testid="filter-chip"]')!
        .parentElement!.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog).not.toBeNull();
      return within(dialog).getByRole("listbox");
    }

    // What each option of the Type filter is called, top to bottom.
    function optionNames(listbox: HTMLElement): Array<string> {
      return within(listbox)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return (
            option.querySelector(".font-medium")?.textContent || ""
          ).trim();
        });
    }

    test("the Type column shows each unit's kind as code, exactly as its name ends", async () => {
      await renderIn(reader, HostSystemdUnits);

      expect(
        rows().map((row: { name: string }): string => {
          return row.name;
        }),
      ).toEqual(UNIT_NAMES);

      for (const row of rows()) {
        const kind: string = kindOf(row.name);
        const code: HTMLElement | null = within(row.type).queryByTestId(
          SYSTEMD_UNIT_KIND_TEST_ID,
        );

        if (!kind) {
          continue;
        }

        expect({ name: row.name, tag: code?.tagName }).toEqual({
          name: row.name,
          tag: "CODE",
        });
        expect(code).toHaveTextContent(new RegExp(`^${kind}$`));
        expect(code).toHaveAttribute("class", SYSTEMD_UNIT_KIND_CLASS_NAME);
        // The cell is the kind and nothing else.
        expect(row.type.textContent).toBe(kind);
      }
    });

    test("a unit whose name has no kind shows the quiet dash, never a word made up for it", async () => {
      await renderIn(reader, HostSystemdUnits);

      const weird: { name: string; type: HTMLElement } = rows().find(
        (row: { name: string }): boolean => {
          return row.name === "weird-unit-name";
        },
      )!;

      expect(
        within(weird.type).queryByTestId(SYSTEMD_UNIT_KIND_TEST_ID),
      ).toBeNull();
      expect(
        within(weird.type).getByTestId(TABLE_EMPTY_VALUE_TEST_ID),
      ).toBeInTheDocument();
      // Not the old "Unit" the page made up.
      expect(weird.type).not.toHaveTextContent(word(reader, "Unit"));
    });

    test("no row reads a kind as the language's word for it", async () => {
      await renderIn(reader, HostSystemdUnits);

      const text: string = withoutIsolateMarks(body().textContent || "");

      expect(
        pageWordsForKinds(reader).filter((pageWord: string): boolean => {
          return text.includes(pageWord);
        }),
      ).toEqual([]);
    });

    test("the Type filter offers the kinds as the column shows them, and the dash for none", async () => {
      await renderIn(reader, HostSystemdUnits);

      expect(optionNames(openTypeFilter())).toEqual([
        EMPTY_VALUE_MARK,
        ...[...SYSTEMD_UNIT_KINDS].sort(),
      ]);
    });

    test("picking a kind keeps the units of that kind, and the chip names it as written", async () => {
      await renderIn(reader, HostSystemdUnits);

      const listbox: HTMLElement = openTypeFilter();
      const target: HTMLElement = within(listbox)
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return (
            option.querySelector(".font-medium")?.textContent?.trim() ===
            "target"
          );
        })!;

      await act(async () => {
        fireEvent.click(target);
      });
      await settle();

      expect(
        rows().map((row: { name: string }): string => {
          return row.name;
        }),
      ).toEqual(["multi-user.target"]);
      expect(screen.getByTestId("filter-chip-value")).toHaveTextContent(
        /^target$/,
      );
    });

    test("the dash keeps the unit with no kind", async () => {
      await renderIn(reader, HostSystemdUnits);

      const listbox: HTMLElement = openTypeFilter();
      const none: HTMLElement = within(listbox)
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return (
            option.querySelector(".font-medium")?.textContent?.trim() ===
            EMPTY_VALUE_MARK
          );
        })!;

      await act(async () => {
        fireEvent.click(none);
      });
      await settle();

      expect(
        rows().map((row: { name: string }): string => {
          return row.name;
        }),
      ).toEqual(["weird-unit-name"]);
    });

    test("the filter bar counts the units, and the search box asks, in the reader's words and digits", async () => {
      await renderIn(reader, HostSystemdUnits);

      const translator: Translator = translatorFor(reader);
      const count: string = translator.translatePlural(
        { one: "{{count}} unit", other: "{{count}} units" },
        UNIT_NAMES.length,
      );
      const search: string = textFor(reader, "Search units...");

      expect(elementsReading(count)).toHaveLength(1);
      expect(screen.getByPlaceholderText(search)).toBeInTheDocument();

      if (reader.language !== "en") {
        expect(count).not.toContain("units");
        expect(search).not.toBe("Search units...");
      }

      if (reader.language === "fa") {
        expect(withoutIsolateMarks(count)).toContain("۱۲");
        expect(count).not.toMatch(LATIN_DIGIT);
      }
    });

    test("each kind's option counts its units in the reader's words and digits", async () => {
      await renderIn(reader, HostSystemdUnits);

      const translator: Translator = translatorFor(reader);
      const oneUnit: string = withoutIsolateMarks(
        translator.translatePlural(
          { one: "{{count}} unit", other: "{{count}} units" },
          1,
        ),
      );
      const sublabels: Array<string> = within(openTypeFilter())
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return withoutIsolateMarks(
            option.querySelector(".text-xs")?.textContent || "",
          ).trim();
        });

      // One unit of each kind, and one with none.
      expect(sublabels).toHaveLength(SYSTEMD_UNIT_KINDS.length + 1);
      expect(new Set(sublabels)).toEqual(new Set([oneUnit]));

      if (reader.language === "fa") {
        expect(oneUnit).toMatch(PERSIAN_DIGIT);
        expect(oneUnit).not.toMatch(LATIN_DIGIT);
      }
    });

    test("with a kind picked, the bar says how many of the units are shown, every count in the reader's digits", async () => {
      await renderIn(reader, HostSystemdUnits);

      const target: HTMLElement = within(openTypeFilter())
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return (
            option.querySelector(".font-medium")?.textContent?.trim() ===
            "target"
          );
        })!;

      await act(async () => {
        fireEvent.click(target);
      });
      await settle();

      const translator: Translator = translatorFor(reader);
      const shownOfAll: string = translator.translatePlural(
        {
          one: "{{shown}} of {{count}} unit",
          other: "{{shown}} of {{count}} units",
        },
        UNIT_NAMES.length,
        { shown: translator.formatNumber(1) },
      );

      expect(elementsReading(shownOfAll)).toHaveLength(1);

      if (reader.language === "fa") {
        expect(shownOfAll).toMatch(PERSIAN_DIGIT);
        expect(shownOfAll).not.toMatch(LATIN_DIGIT);
      }
    });
  },
);

describe.each(READERS)(
  "a systemd unit's page in $language",
  (reader: Reader) => {
    function showUnit(name: string): void {
      lastParamMock.mockReturnValue(name);
      getListMock.mockResolvedValue({
        data: [unitReading(name), unitReading(name)],
      });
    }

    async function renderUnit(name: string): Promise<void> {
      showUnit(name);
      await renderIn(reader, HostSystemdUnitView);
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }

    // The hero's chips, as a reader reads them.
    function heroChips(): Array<string> {
      const heading: HTMLElement = screen.getByRole("heading", {
        name: lastParamMock() as string,
      });
      const hero: HTMLElement = heading.closest(".rounded-xl") || document.body;
      return Array.from(
        hero.querySelectorAll<HTMLElement>(
          "span.rounded-md > span.font-medium",
        ),
      ).map((chip: HTMLElement): string => {
        return withoutIsolateMarks(chip.textContent || "");
      });
    }

    // The chip the page would draw for `kind`, in the reader's language.
    function typeChip(kind: string): string {
      return word(reader, "Type: {{type}}").replace("{{type}}", kind);
    }

    test.each([
      ["multi-user.target", "target"],
      ["var-lib-docker.mount", "mount"],
      ["nginx.service", "service"],
    ])(
      "%s: the Unit Type tile shows %s as code, in the figure's size",
      async (name: string, kind: string) => {
        await renderUnit(name);

        const code: HTMLElement = screen.getByTestId(SYSTEMD_UNIT_KIND_TEST_ID);

        expect(code.tagName).toBe("CODE");
        expect(code).toHaveTextContent(new RegExp(`^${kind}$`));
        expect(code).toHaveAttribute(
          "class",
          SYSTEMD_UNIT_KIND_FIGURE_CLASS_NAME,
        );

        const tile: HTMLElement = code.closest(".rounded-xl") as HTMLElement;

        expect(tile).toHaveTextContent(word(reader, "Unit Type"));
        expect(
          pageWordsForKinds(reader).filter((pageWord: string): boolean => {
            return withoutIsolateMarks(tile.textContent || "").includes(
              pageWord,
            );
          }),
        ).toEqual([]);
      },
    );

    test.each([
      ["multi-user.target", "target"],
      ["var-lib-docker.mount", "mount"],
      ["nginx.service", "service"],
    ])(
      "%s: the chip under the name reads the type as %s",
      async (name: string, kind: string) => {
        await renderUnit(name);

        expect(heroChips()).toContain(typeChip(kind));
        expect(
          heroChips().filter((chip: string): boolean => {
            return pageWordsForKinds(reader).some((pageWord: string) => {
              return chip.includes(pageWord);
            });
          }),
        ).toEqual([]);
      },
    );

    test("a unit whose name has no kind shows the dash in the tile and no Type chip", async () => {
      await renderUnit("weird-unit-name");

      expect(screen.queryByTestId(SYSTEMD_UNIT_KIND_TEST_ID)).toBeNull();
      // The hero still has its other chips (when the unit last reported).
      expect(heroChips().length).toBeGreaterThan(0);

      const typePrefix: string = typeChip("").trim();

      expect(
        heroChips().filter((chip: string): boolean => {
          return chip.startsWith(typePrefix);
        }),
      ).toEqual([]);
      // Not the old "Unit" the page made up for it.
      expect(heroChips()).not.toContain(typeChip(word(reader, "Unit")));
      expect(screen.getAllByText(EMPTY_VALUE_MARK).length).toBeGreaterThan(0);
    });

    // The Availability tile's line under its figure.
    function availabilityLine(): string {
      const title: HTMLElement = screen.getByText(
        textFor(reader, "Availability"),
      );
      const tile: HTMLElement = title.closest(".rounded-xl") as HTMLElement;
      const lines: Array<HTMLElement> = Array.from(
        tile.querySelectorAll<HTMLElement>("div.mt-1.text-xs"),
      );

      expect(lines).toHaveLength(1);

      return withoutIsolateMarks(lines[0]!.textContent || "").trim();
    }

    test("the Availability tile counts the active samples in the reader's words and digits", async () => {
      lastParamMock.mockReturnValue("nginx.service");
      getListMock.mockResolvedValue({
        data: [
          unitReading("nginx.service", 15_000, "active"),
          unitReading("nginx.service", 45_000, "inactive"),
          unitReading("nginx.service", 75_000, "active"),
          unitReading("nginx.service", 105_000, "active"),
        ],
      });
      await renderIn(reader, HostSystemdUnitView);

      const translator: Translator = translatorFor(reader);
      const expected: string = translator.translatePlural(
        {
          one: "active in {{active}} of {{count}} sample",
          other: "active in {{active}} of {{count}} samples",
        },
        4,
        { active: translator.formatNumber(3) },
      );

      expect(availabilityLine()).toBe(withoutIsolateMarks(expected).trim());

      if (reader.language !== "en") {
        expect(availabilityLine()).not.toContain("samples");
      }

      if (reader.language === "fa") {
        expect(availabilityLine()).toBe("فعال در ۳ از ۴ نمونه");
      }
    });

    test("the chip under the name says when the last sample came, in the reader's words", async () => {
      await renderUnit("nginx.service");

      const template: string = textFor(reader, "Last sample {{time}}");
      const words: Array<string> = template
        .split("{{time}}")
        .map((part: string): string => {
          return part.trim();
        })
        .filter((part: string): boolean => {
          return part.length > 0;
        });

      expect(words.length).toBeGreaterThan(0);
      expect(
        heroChips().filter((chip: string): boolean => {
          return words.every((part: string): boolean => {
            return chip.includes(part);
          });
        }),
      ).toHaveLength(1);

      if (reader.language !== "en") {
        expect(heroChips().join(" ")).not.toContain("Last sample");
      }
    });

    test("the State Changes card says the state did not change, in the reader's words", async () => {
      await renderUnit("nginx.service");

      const said: string = textFor(
        reader,
        "The unit state did not change in the selected time range.",
      );

      expect(elementsReading(said)).toHaveLength(1);

      if (reader.language !== "en") {
        expect(said).not.toContain("did not change");
      }
    });

    test("the State Changes card lists the changes under a description in the reader's words", async () => {
      lastParamMock.mockReturnValue("nginx.service");
      getListMock.mockResolvedValue({
        data: [
          unitReading("nginx.service", 15_000, "active"),
          unitReading("nginx.service", 45_000, "failed"),
          unitReading("nginx.service", 75_000, "active"),
        ],
      });
      await renderIn(reader, HostSystemdUnitView);

      const said: string = textFor(
        reader,
        "State changes observed in the selected time range, newest first.",
      );

      expect(elementsReading(said)).toHaveLength(1);

      if (reader.language !== "en") {
        expect(said).not.toContain("State changes observed");
      }
    });

    test("when the range hits the sample cap, the timeline and State Changes name the cap in the reader's digits", async () => {
      const name: string = "nginx.service";
      const readings: Array<Record<string, unknown>> = [];

      // As many samples as one fetch returns, half a second apart.
      for (let i: number = 0; i < 2000; i++) {
        readings.push(unitReading(name, 1_000 + i * 500));
      }

      lastParamMock.mockReturnValue(name);
      getListMock.mockResolvedValue({ data: readings });
      await renderIn(reader, HostSystemdUnitView);

      const translator: Translator = translatorFor(reader);
      const cap: string = translator.formatNumber(2000);
      const oldest: Date = readings[readings.length - 1]!["time"] as Date;
      const timelineNote: string = translator.translateTemplate(
        "Worst observed state per interval, from the most recent {{limit}} samples. Exact changes are listed under State Changes.",
        { limit: cap },
      );
      const unchanged: string = translator.translateTemplate(
        "The unit state did not change since {{date}} — the selected range exceeded the {{limit}}-sample cap.",
        {
          date: OneUptimeDate.getDateAsLocalFormattedString(oldest),
          limit: cap,
        },
      );

      expect(elementsReading(timelineNote)).toHaveLength(1);
      expect(elementsReading(unchanged)).toHaveLength(1);
      expect(withoutIsolateMarks(timelineNote)).toContain(
        withoutIsolateMarks(cap),
      );

      if (reader.language === "fa") {
        expect(withoutIsolateMarks(cap)).toBe("۲٬۰۰۰");

        for (const sentence of [timelineNote, unchanged]) {
          expect(withoutIsolateMarks(sentence)).not.toMatch(/2,?000/);
        }
      }
    });

    test("a unit with no samples in the range says so in the reader's words", async () => {
      lastParamMock.mockReturnValue("nginx.service");
      getListMock.mockResolvedValue({ data: [] });
      await renderIn(reader, HostSystemdUnitView);

      const title: string = textFor(reader, "No unit metrics in range");

      expect(elementsReading(title)).toHaveLength(1);

      if (reader.language !== "en") {
        expect(title).not.toBe("No unit metrics in range");
      }
    });
  },
);
