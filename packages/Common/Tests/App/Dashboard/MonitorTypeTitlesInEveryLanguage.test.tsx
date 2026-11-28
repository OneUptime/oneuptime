import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import getMonitorTypeFormField from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorTypeFormField";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { getMonitorsTable } from "../../../Server/Utils/AI/Toolbox/MonitorsTableWords";
import { getAIReadCardMonitorTypeTerms } from "../../../Types/AI/AIActionWords";
import { AIChatWidget } from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";
import MonitorType, {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "../../../Types/Monitor/MonitorType";
import CardSelect, {
  CardSelectOptionGroup,
} from "../../../UI/Components/CardSelect/CardSelect";
import Field from "../../../UI/Components/Forms/Types/Field";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
  readDashboardSameAsEnglish,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A MONITOR'S TYPE, IN EVERY DASHBOARD LANGUAGE (#7981).
 *
 * A monitor's type is one of the first words people meet: the type picker
 * on Create Monitor, the Type column of the Monitors list, the monitor's
 * own page and Ask AI's Type fact and Type cell all draw the type's title
 * (MonitorTypeHelper.getAllMonitorTypeProps) through the Dashboard's
 * files. A German page said "Eingehende Anfrage" for Incoming Request and
 * then "Incoming Email" and "Custom JavaScript Code" right below it; a
 * Chinese page said "Synthetic Monitor", "SQL Query", "Database Health" and
 * "External Status Page" in English - not because the language keeps them,
 * but because nobody had worded them.
 *
 * Every title is worded in every language now, apart from the ones a
 * language writes as English does, listed below with why. Each of those is
 * on the language's same-as-English lists, so the toolchain counts it as
 * worded and the build ships it as the language's own.
 */

// Product and protocol names every language writes as they are.
const NAMES_KEPT_EVERYWHERE: ReadonlyArray<string> = [
  "API",
  "Ceph",
  "DNS",
  "DNSSEC",
  "Docker Swarm",
  "IP",
  "Kubernetes",
  "NTP",
  "OpenStack",
  "Ping",
  "Proxmox",
  "VMware",
  // The XCP-ng monitor type (#11093), named as the product writes itself.
  "XCP-ng",
];

/*
 * The other titles a language writes as English does, each with why. A
 * title that is missing from here and reads as English in a language is
 * one nobody worded: the test below fails and names it.
 */
const KEPT_IN_LANGUAGE: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  da: {
    Port: "Danish says port",
    "AI / LLM": "AI and LLM are what Danish calls them",
    "Server / VM": "server and VM are Danish words",
  },
  de: {
    Website: "German says Website",
    Host: "German says Host",
    Port: "German says Port",
    Traces: "the product calls them Traces in German",
    "Server / VM": "Server and VM are German words",
  },
  es: {
    Manual: "Spanish writes manual the same",
    Host: "Spanish says host",
  },
  fr: {
    Port: "French writes port the same",
    Exceptions: "French writes exceptions the same",
    Traces: "French writes traces the same",
  },
  hi: {
    "AI / LLM": "Hindi pages write AI and LLM in Latin letters",
  },
  it: {
    Host: "Italian says host",
    "Server / VM": "server and VM are Italian words",
  },
  ja: {
    "AI / LLM": "Japanese pages write AI and LLM in Latin letters",
  },
  ko: {
    "AI / LLM": "Korean pages write AI and LLM in Latin letters",
  },
  nl: {
    Website: "Dutch says website",
    Host: "Dutch says host",
    "AI / LLM": "AI and LLM are what Dutch calls them",
    Traces: "Dutch says traces",
    "Server / VM": "server and VM are Dutch words",
  },
  no: {
    Port: "Norwegian says port",
    "AI / LLM": "AI and LLM are what Norwegian calls them",
    "Server / VM": "server and VM are Norwegian words",
  },
  pt: {
    Manual: "Portuguese writes manual the same",
    Host: "Portuguese says host",
  },
  sv: {
    Port: "Swedish says port",
    "AI / LLM": "AI and LLM are what Swedish calls them",
    "Server / VM": "server and VM are Swedish words",
  },
  "zh-CN": {
    "AI / LLM": "Chinese pages write AI and LLM in Latin letters",
  },
  "zh-TW": {
    "AI / LLM": "Chinese pages write AI and LLM in Latin letters",
  },
};

const TITLES: ReadonlyArray<string> = MonitorTypeHelper.getAllMonitorTypeProps()
  .map((props: MonitorTypeProps): string => {
    return props.title;
  })
  .filter((title: string, index: number, all: Array<string>): boolean => {
    return all.indexOf(title) === index;
  });

const keptIn: (language: string) => ReadonlyArray<string> = (
  language: string,
): ReadonlyArray<string> => {
  return [
    ...NAMES_KEPT_EVERYWHERE,
    ...Object.keys(KEPT_IN_LANGUAGE[language] || {}),
  ];
};

/*
 * The titles `words` leaves in English that `language` does not keep: a
 * value missing, empty or the English text itself.
 */
const titlesLeftInEnglish: (
  words: Record<string, string>,
  language: string,
) => Array<string> = (
  words: Record<string, string>,
  language: string,
): Array<string> => {
  return TITLES.filter((title: string): boolean => {
    const value: string | undefined = words[title];

    return (
      (value === undefined || !value.trim() || value === title) &&
      !keptIn(language).includes(title)
    );
  });
};

describe("every monitor type's title, in every Dashboard language", () => {
  test("the titles are the type picker's and Ask AI's", () => {
    expect(TITLES.length).toBeGreaterThanOrEqual(39);
    expect([...TITLES].sort()).toEqual(
      [...getAIReadCardMonitorTypeTerms()]
        .filter((title: string, index: number, all: ReadonlyArray<string>) => {
          return all.indexOf(title) === index;
        })
        .sort(),
    );

    for (const title of TITLES) {
      expect({ title, isKey: readDashboardLocale("en")[title] }).toEqual({
        title,
        isKey: title,
      });
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every title it does not keep on purpose",
    (language: string) => {
      expect(
        titlesLeftInEnglish(readDashboardLocale(language), language),
      ).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps in English only what its same-as-English lists say it keeps",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const sameAsEnglish: ReadonlyArray<string> =
        readDashboardSameAsEnglish(language);

      for (const title of TITLES) {
        if (words[title] !== title) {
          continue;
        }

        // Kept on purpose: stated here, and on the lists the build reads.
        expect({
          language,
          title,
          stated: keptIn(language).includes(title),
        }).toEqual({ language, title, stated: true });
        expect({
          language,
          title,
          listed: sameAsEnglish.includes(title),
        }).toEqual({ language, title, listed: true });
      }
    },
  );

  test("each stated title is a title, and is still English in that language", () => {
    for (const language of Object.keys(KEPT_IN_LANGUAGE)) {
      expect(DASHBOARD_LANGUAGES).toContain(language);

      for (const title of Object.keys(KEPT_IN_LANGUAGE[language]!)) {
        expect({ language, title, isTitle: TITLES.includes(title) }).toEqual({
          language,
          title,
          isTitle: true,
        });
        // A language that has since worded it takes it off the list.
        expect({
          language,
          title,
          value: readDashboardLocale(language)[title],
        }).toEqual({ language, title, value: title });
      }
    }
  });

  // The titles the issue was filed for, as a German and a Chinese page say them.
  test.each([
    ["de", "Incoming Email", "Eingehende E-Mail"],
    ["de", "Custom JavaScript Code", "Benutzerdefinierter JavaScript-Code"],
    ["de", "Docker Container", "Docker-Container"],
    ["zh-CN", "Synthetic Monitor", "合成监视器"],
    ["zh-CN", "SQL Query", "SQL 查询"],
    ["zh-CN", "Database Health", "数据库健康状况"],
    ["zh-CN", "External Status Page", "外部状态页"],
    ["ja", "Incoming Email", "受信メール"],
    ["fr", "Synthetic Monitor", "Moniteur synthétique"],
    ["ru", "Server / VM", "Сервер / ВМ"],
  ])("%s names %s as %s", (language: string, title: string, word: string) => {
    expect(readDashboardLocale(language)[title]).toBe(word);
  });
});

describe("negative controls: an English title is caught, and named", () => {
  test("one title put back to English fails, and names the title", () => {
    const words: Record<string, string> = {
      ...readDashboardLocale("de"),
      "Incoming Email": "Incoming Email",
    };

    expect(titlesLeftInEnglish(words, "de")).toEqual(["Incoming Email"]);
  });

  test("a title missing from a file fails too", () => {
    const words: Record<string, string> = { ...readDashboardLocale("zh-CN") };

    delete words["Synthetic Monitor"];

    expect(titlesLeftInEnglish(words, "zh-CN")).toEqual(["Synthetic Monitor"]);
  });

  test("a title a language keeps on purpose is not flagged", () => {
    const words: Record<string, string> = readDashboardLocale("de");

    expect(words["Host"]).toBe("Host");
    expect(titlesLeftInEnglish(words, "de")).toEqual([]);
    // The same English in a language that does not keep it is flagged.
    expect(
      titlesLeftInEnglish({ ...readDashboardLocale("ru"), Host: "Host" }, "ru"),
    ).toEqual(["Host"]);
  });
});

/*
 * On the page: Ask AI's monitors table and the type picker, drawn through
 * the Dashboard's i18next in German and Chinese, with the types the issue
 * named.
 */
const PAGE_LANGUAGES: ReadonlyArray<string> = ["de", "zh-CN"];

const ENGLISH_TITLES_NOBODY_KEEPS: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  return TITLES.filter((title: string): boolean => {
    return !keptIn(language).includes(title);
  });
};

// The English titles a text says, word for word.
const englishTitlesIn: (text: string, language: string) => Array<string> = (
  text: string,
  language: string,
): Array<string> => {
  return ENGLISH_TITLES_NOBODY_KEEPS(language).filter((title: string) => {
    return text === title;
  });
};

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      PAGE_LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

// The monitors the issue named, as query_monitors lists them.
const TYPES_ON_THE_TABLE: ReadonlyArray<MonitorType> = [
  MonitorType.SyntheticMonitor,
  MonitorType.IncomingEmail,
  MonitorType.CustomJavaScriptCode,
  MonitorType.SQLQuery,
  MonitorType.Database,
  MonitorType.ExternalStatusPage,
  MonitorType.Docker,
  MonitorType.Podman,
  MonitorType.Server,
];

function monitorsTable(): AIChatWidget {
  const rows: Array<JSONObject> = TYPES_ON_THE_TABLE.map(
    (type: MonitorType, index: number): JSONObject => {
      return {
        name: `monitor-${index}`,
        type: type,
        currentStatus: "Operational",
      };
    },
  );

  return {
    ...getMonitorsTable({ problemsOnly: false, rows: rows }),
    id: "W1",
  };
}

// The Type column's cells, row by row (Monitor, Type, Status).
function typeCells(): Array<string> {
  const cells: Array<string> = screen
    .getAllByTestId("ai-chat-table-cell")
    .map((element: HTMLElement): string => {
      return withoutIsolateMarks(element.textContent || "").trim();
    });

  return cells.filter((_cell: string, index: number): boolean => {
    return index % 3 === 1;
  });
}

describe("Ask AI's monitors table, in German and Chinese", () => {
  test("in English, the Type cells are the titles (the control)", async () => {
    await inLanguage("en");
    render(<WidgetRenderer widgets={[monitorsTable()]} />);

    expect(typeCells()).toEqual(
      TYPES_ON_THE_TABLE.map((type: MonitorType): string => {
        return MonitorTypeHelper.getTitle(type);
      }),
    );
  });

  test.each(PAGE_LANGUAGES)(
    "%s: no Type cell says an English title",
    async (language: string) => {
      await inLanguage(language);
      render(<WidgetRenderer widgets={[monitorsTable()]} />);

      const cells: Array<string> = typeCells();
      const words: Record<string, string> = readDashboardLocale(language);

      expect(cells).toHaveLength(TYPES_ON_THE_TABLE.length);
      expect(
        cells.flatMap((cell: string): Array<string> => {
          return englishTitlesIn(cell, language);
        }),
      ).toEqual([]);
      expect(cells).toEqual(
        TYPES_ON_THE_TABLE.map((type: MonitorType): string => {
          return words[MonitorTypeHelper.getTitle(type)]!;
        }),
      );
    },
  );
});

const field: Field<Monitor> = getMonitorTypeFormField<Monitor>();

const Picker: () => React.ReactElement = (): React.ReactElement => {
  return (
    <CardSelect
      options={field.cardSelectOptions as Array<CardSelectOptionGroup>}
      value={undefined}
      onChange={() => {}}
      searchable={field.cardSelectSearchable}
      searchPlaceholder={field.cardSelectSearchPlaceholder}
      catalog={field.cardSelectCatalog}
    />
  );
};

// Each type the picker offers, and the text of its card once "More monitor types" is open.
function pickerCards(): Array<{ type: string; text: string }> {
  fireEvent.click(screen.getByTestId("card-select-more"));

  return screen.getAllByRole("radio").map((card: HTMLElement) => {
    return {
      type: (card.getAttribute("data-testid") || "").replace(
        "card-select-option-",
        "",
      ),
      // A card reads its title first, then its description.
      text: withoutIsolateMarks(card.textContent || "").trim(),
    };
  });
}

describe("the type picker on Create Monitor, in German and Chinese", () => {
  test("in English, each card starts with its type's title (the control)", async () => {
    await inLanguage("en");
    render(<Picker />);

    const cards: Array<{ type: string; text: string }> = pickerCards();

    expect(cards.length).toBeGreaterThanOrEqual(30);

    for (const card of cards) {
      const title: string = MonitorTypeHelper.getTitle(
        card.type as MonitorType,
      );

      expect({ type: card.type, starts: card.text.startsWith(title) }).toEqual({
        type: card.type,
        starts: true,
      });
    }
  });

  test.each(PAGE_LANGUAGES)(
    "%s: each card starts with its type's word, never its English title",
    async (language: string) => {
      await inLanguage(language);
      render(<Picker />);

      const words: Record<string, string> = readDashboardLocale(language);
      const cards: Array<{ type: string; text: string }> = pickerCards();

      expect(cards.length).toBeGreaterThanOrEqual(30);

      for (const card of cards) {
        const title: string = MonitorTypeHelper.getTitle(
          card.type as MonitorType,
        );
        const word: string = words[title] || title;

        expect({
          language,
          type: card.type,
          startsWithItsWord: card.text.startsWith(word),
          drawnInEnglish:
            ENGLISH_TITLES_NOBODY_KEEPS(language).includes(title) &&
            card.text.startsWith(title),
        }).toEqual({
          language,
          type: card.type,
          startsWithItsWord: true,
          drawnInEnglish: false,
        });
      }

      const shown: string = cards
        .map((card: { type: string; text: string }): string => {
          return card.text;
        })
        .join("\n");

      expect(shown).toContain(words["Incoming Email"]!);
      expect(shown).toContain(words["Synthetic Monitor"]!);
    },
  );
});
