import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A list in a table's cell - a row's resources, monitors, teams, hosts -
 * shows three items and folds the rest behind one sentence: "2 more
 * monitors". The count used to be glued in front of words looked up on
 * their own ("more monitors"), which read "2 件のモニター（ほか）" in
 * Japanese, kept the words English in every language but German and
 * Spanish, and could not take a language's plural forms ("Ещё мониторов: 5",
 * "Ещё 21 монитор"). Every list now hands TableColumnListComponent a whole
 * plural sentence (Components/TableColumnList/MoreItemsTemplates), worded
 * in each of the Dashboard's 17 languages.
 *
 * The real list components are drawn in a table's cell under an i18next
 * instance built from each language's own locale file.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import {
  MORE_HOSTS_TEMPLATE,
  MORE_ITEMS_TEMPLATES,
  MORE_MONITORS_TEMPLATE,
  MORE_RESOURCES_TEMPLATE,
  MORE_TEAMS_TEMPLATE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TableColumnList/MoreItemsTemplates";
import MonitorsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Monitors";
import TeamsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Team/TeamsElement";
import HostsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Host/Hosts";
import AffectedResourcesCell from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesCell";
import { TableCellContext } from "../../../UI/Components/Table/TableCellContext";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Team from "../../../Models/DatabaseModels/Team";
import Host from "../../../Models/DatabaseModels/Host";
import ObjectID from "../../../Types/ObjectID";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleFile = Record<string, unknown>;

const readLocale: (fileName: string) => LocaleFile = (
  fileName: string,
): LocaleFile => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, fileName), "utf8"),
  ) as LocaleFile;
};

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIRECTORY)
  .filter((fileName: string): boolean => {
    return fileName.endsWith(".json");
  })
  .sort();

const ENGLISH: LocaleFile = readLocale("en.json");

// Languages that call some counts "one" (Intl.PluralRules), besides English.
const HAS_ONE_FORM: (language: string) => boolean = (
  language: string,
): boolean => {
  return new Intl.PluralRules(language)
    .resolvedOptions()
    .pluralCategories.includes("one");
};

afterEach(() => {
  cleanup();
});

describe("every list's fold is one sentence in every language", () => {
  test("seventeen languages", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test("English holds both forms of every sentence, word for word", () => {
    for (const template of MORE_ITEMS_TEMPLATES) {
      expect([template.other, ENGLISH[template.other]]).toEqual([
        template.other,
        template.other,
      ]);
      expect([template.other, ENGLISH[`${template.other}_one`]]).toEqual([
        template.other,
        template.one,
      ]);
      // A sentence with its count, both ways.
      expect(template.one).toContain("{{count}}");
      expect(template.other).toContain("{{count}}");
    }
  });

  test.each(
    LOCALE_FILES.filter((fileName: string): boolean => {
      return fileName !== "en.json";
    }),
  )("%s words every sentence, with its count inside it", (fileName: string) => {
    const file: LocaleFile = readLocale(fileName);
    const language: string = fileName.replace(".json", "");

    for (const template of MORE_ITEMS_TEMPLATES) {
      for (const key of [template.other, `${template.other}_one`]) {
        const sentence: string = String(file[key] ?? "");

        expect([fileName, key, sentence.includes("{{count}}")]).toEqual([
          fileName,
          key,
          true,
        ]);
      }

      // Translated: never the English sentence left in place.
      const other: string = String(file[template.other] ?? "");

      expect([fileName, template.other, other !== template.other]).toEqual([
        fileName,
        template.other,
        true,
      ]);

      // A language with a "one" form words that form too.
      if (HAS_ONE_FORM(language)) {
        const one: string = String(file[`${template.other}_one`] ?? "");

        expect([fileName, template.other, one !== template.one]).toEqual([
          fileName,
          template.other,
          true,
        ]);
      }
    }
  });

  /*
   * Every list in the product draws its fold with its own sentence: no
   * caller hands over loose words (the removed moreText) or builds the
   * button's text itself (the removed getMoreText).
   */
  test("every list in the product hands its fold a whole sentence", () => {
    const repository: string = path.join(__dirname, "../../../../..");
    const roots: Array<string> = [
      path.join(repository, "packages/App/FeatureSet/Dashboard/src"),
      path.join(repository, "packages/Common/UI"),
      path.join(repository, "ee"),
    ].filter((root: string): boolean => {
      return fs.existsSync(root);
    });

    const sources: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "Tests") {
            walk(full);
          }
        } else if (entry.name.endsWith(".tsx")) {
          sources.push(full);
        }
      }
    };

    roots.forEach(walk);

    const callers: Array<string> = [];

    for (const file of sources) {
      const source: string = fs.readFileSync(file, "utf8");
      const calls: Array<string> = source
        .split("<TableColumnListComponent")
        .slice(1)
        .map((rest: string): string => {
          return rest.slice(0, rest.indexOf("/>") + 2);
        });

      for (const call of calls) {
        callers.push(path.relative(repository, file));

        expect([file, call.includes("moreTemplate=")]).toEqual([file, true]);
        expect([file, call.includes("moreText=")]).toEqual([file, false]);
        expect([file, call.includes("getMoreText=")]).toEqual([file, false]);
      }
    }

    /*
     * The lists of the product: rows' resources, monitors, teams, hosts,
     * labels, templates and the rest.
     */
    expect(callers.length).toBeGreaterThanOrEqual(16);
  });
});

type MakeFunction<T> = (index: number) => T;

const makeMonitor: MakeFunction<Monitor> = (index: number): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  monitor.id = new ObjectID(monitor._id);
  monitor.name = `Monitor ${index}`;
  monitor.projectId = new ObjectID("10000000-0000-4000-8000-000000000001");
  return monitor;
};

const makeTeam: MakeFunction<Team> = (index: number): Team => {
  const team: Team = new Team();
  team._id = `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  team.id = new ObjectID(team._id);
  team.name = `Team ${index}`;
  team.projectId = new ObjectID("10000000-0000-4000-8000-000000000001");
  return team;
};

const makeHost: MakeFunction<Host> = (index: number): Host => {
  const host: Host = new Host();
  host._id = `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  host.id = new ObjectID(host._id);
  host.name = `Host ${index}`;
  host.projectId = new ObjectID("10000000-0000-4000-8000-000000000001");
  return host;
};

const many: <T>(make: MakeFunction<T>, count: number) => Array<T> = <T,>(
  make: MakeFunction<T>,
  count: number,
): Array<T> => {
  return Array.from({ length: count }, (_value: unknown, index: number): T => {
    return make(index + 1);
  });
};

type ReaderFunction = (fileName: string) => Promise<i18n>;

const readerFor: ReaderFunction = async (fileName: string): Promise<i18n> => {
  const language: string = fileName.replace(".json", "");
  const reader: i18n = createInstance();

  await reader.init({
    lng: language,
    fallbackLng: language,
    resources: { [language]: { translation: readLocale(fileName) } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return reader;
};

const inCell: (reader: i18n, element: ReactElement) => ReactElement = (
  reader: i18n,
  element: ReactElement,
): ReactElement => {
  return (
    <I18nextProvider i18n={reader}>
      <TableCellContext.Provider value={true}>
        {element}
      </TableCellContext.Provider>
    </I18nextProvider>
  );
};

/*
 * The sentence a language's file gives for a count, as translatePlural
 * reads it: the "one" form for the counts the language calls one, the
 * general form for every other.
 */
const expected: (
  fileName: string,
  template: PluralTemplate,
  count: number,
) => string = (
  fileName: string,
  template: PluralTemplate,
  count: number,
): string => {
  const language: string = fileName.replace(".json", "");
  const file: LocaleFile = readLocale(fileName);
  const category: string = new Intl.PluralRules(language).select(count);
  const sentence: string = String(
    (category === "one" ? file[`${template.other}_one`] : undefined) ??
      file[template.other],
  );

  return sentence.replace(
    "{{count}}",
    new Intl.NumberFormat(language).format(count),
  );
};

describe("the real lists say it", () => {
  test.each(LOCALE_FILES)(
    "%s: five monitors fold to the sentence for two",
    async (fileName: string) => {
      const reader: i18n = await readerFor(fileName);

      render(
        inCell(reader, <MonitorsElement monitors={many(makeMonitor, 5)} />),
      );

      expect(
        screen.getByRole("button", {
          name: expected(fileName, MORE_MONITORS_TEMPLATE, 2),
        }),
      ).toBeInTheDocument();
    },
  );

  test("in Russian, 24 monitors fold to its 'one' form for 21", async () => {
    const reader: i18n = await readerFor("ru.json");

    render(
      inCell(reader, <MonitorsElement monitors={many(makeMonitor, 24)} />),
    );

    expect(
      screen.getByRole("button", { name: "Ещё 21 монитор" }),
    ).toBeInTheDocument();
  });

  test("an incident's or an alert's resources, a row's teams and hosts fold to their own sentences", async () => {
    const reader: i18n = await readerFor("ja.json");

    render(
      inCell(
        reader,
        <>
          <AffectedResourcesCell
            monitors={many(makeMonitor, 3)}
            hosts={many(makeHost, 3)}
          />
          <TeamsElement teams={many(makeTeam, 6)} />
          <HostsElement hosts={many(makeHost, 7)} />
        </>,
      ),
    );

    expect(
      screen.getByRole("button", {
        name: expected("ja.json", MORE_RESOURCES_TEMPLATE, 3),
      }),
    ).toHaveTextContent("ほか 3 件のリソース");
    expect(
      screen.getByRole("button", {
        name: expected("ja.json", MORE_TEAMS_TEMPLATE, 3),
      }),
    ).toHaveTextContent("ほか 3 件のチーム");
    expect(
      screen.getByRole("button", {
        name: expected("ja.json", MORE_HOSTS_TEMPLATE, 4),
      }),
    ).toHaveTextContent("ほか 4 件のホスト");
  });
});
