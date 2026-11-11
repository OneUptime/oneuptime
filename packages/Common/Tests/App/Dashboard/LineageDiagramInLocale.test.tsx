import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import {
  DataAlertLineageAnswer,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineageNode,
} from "../../../Types/DataObservability/DataTableLineage";
import { PluralTemplate } from "../../../Types/Translator";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  getAlertLineageNotes,
  getAlertLineageSentences,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/AlertLineageDiagram";
import { LINEAGE_DEPTH_OPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageDiagram";
import { getLineageDrawLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraph";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE LINEAGE DIAGRAMS READ IN EVERY DASHBOARD LANGUAGE (#6664).
 *
 * A table's Lineage tab, a pipeline's page and a data alert's page draw
 * the same diagram, and every word of it - the steps switch, the legend,
 * what lies each way, the counts of tables not drawn, the notes, and on an
 * alert's page the sentences saying which way to its cause and to the
 * alerts it caused is picked out - is translated into every Dashboard
 * language, each count in the reader's own plural. A sentence pointing at
 * a section below the diagram names it as that language's Lineage tab
 * titles it, so "Feeds below" leads to a section the reader can find.
 * Nothing is drawn here: React Flow and the pages the diagrams link to
 * are stand-ins.
 */

jest.mock("reactflow", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
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
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("a");
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Pipelines",
  () => {
    return {
      __esModule: true,
      getRunStatePill: (): ReactElement => {
        return React.createElement("span");
      },
    };
  },
);

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);

const COMPONENTS: ReadonlyArray<string> = [
  "LineageGraph.tsx",
  "LineageDiagram.tsx",
  "TableLineageDiagram.tsx",
  "PipelineLineageDiagram.tsx",
  "AlertLineageDiagram.tsx",
];

// Languages without a "one" form never show a plural's one form.
const WITHOUT_ONE_FORM: ReadonlyArray<string> = ["ja", "ko", "zh-CN", "zh-TW"];

// What the diagrams look up as they are: every text but a count's.
const TEXTS: ReadonlyArray<string> = [
  "1 step",
  "2 steps",
  "3 steps",
  "5 steps",
  "Steps shown each way",
  "Pipeline run",
  "Latest run failed",
  "Late, open alert or failed run",
  "Fresh or last run complete",
  "This table",
  "This pipeline",
  "Consequence",
  "{{pipeline}} failed",
  "Explore Lineage",
  "Could not read this table's lineage.",
  "Could not read this pipeline's lineage.",
  "Could not read this alert's lineage.",
  "No lineage has been seen for this table yet. It comes from OpenLineage events, dbt, Fivetran and Airbyte syncs, jobs in your traces, views and each database's query history.",
  "No table has been seen read or written by this pipeline yet. Its runs say which, through OpenLineage events, dbt, Fivetran and Airbyte syncs, and the database calls in its traces.",
  "This lineage is larger than one diagram holds: the nearest tables are drawn, problems first. Open a table to center the diagram on it.",
  "The alert that caused this one is not on this diagram: it is about a whole database, or further up than the diagram reaches.",
  "The way up to the alert that caused this one is highlighted.",
  "The tables this table is built from, and the tables and dashboards built from it",
  "The tables this pipeline reads and the tables it writes, with the lineage around them",
  "The lineage around this alert, with the way to the alert that caused it and to the alerts it caused",
  "Where this table's data comes from and where it goes, a few steps each way, with how each table and pipeline is now. Open a table to center the diagram on it.",
  "The tables this pipeline reads and the tables it writes, with how each is now. Pick more steps to see what they are built from and what is built from them.",
  "Where this alert's data comes from and where it goes, with how each table and pipeline is now.",
  // Drawing more where it is (#6667), and following a column (#6665).
  "Reset diagram",
  "Could not draw more of this lineage.",
  "Follow a column",
  "Column to follow",
  "{{column}} is highlighted where it comes from and where it goes.",
  "Some arrows on its way do not say which columns they carry, so it may go further than is highlighted.",
];

// Each count, by its general form: the key whose "_one" key is the one form.
const COUNTS: ReadonlyArray<string> = [
  "{{count}} tables upstream",
  "{{count}} tables downstream",
  "{{count}} problems upstream",
  "{{count}} problems downstream",
  "Reads {{count}} tables",
  "Writes {{count}} tables",
  "{{count}} more tables upstream are not drawn. Open this table to center the diagram on it.",
  "{{count}} more tables downstream are not drawn. Open this table to center the diagram on it.",
  "{{count}} more tables this one is built from are not drawn. Built From below lists them all.",
  "{{count}} more tables built from this one are not drawn. Feeds below lists them all.",
  "{{count}} more tables this pipeline reads are not drawn.",
  "{{count}} more tables this pipeline writes are not drawn.",
  "{{count}} more dashboards are built on these tables and are not drawn.",
  "The ways down to the {{count}} alerts this one caused are highlighted.",
  "The ways down to {{drawn}} of the {{count}} alerts this one caused are highlighted. The rest are further down than the diagram reaches.",
  "The {{count}} alerts this one caused are further down than the diagram reaches.",
  // What pressing a card's count draws: all of them, or the next of them.
  "Draw {{count}} more tables upstream",
  "Draw {{count}} more tables downstream",
  "Draw {{count}} more tables this pipeline reads",
  "Draw {{count}} more tables this pipeline writes",
  "Draw {{batch}} of the {{count}} more tables upstream",
  "Draw {{batch}} of the {{count}} more tables downstream",
  "Draw {{batch}} of the {{count}} more tables this pipeline reads",
  "Draw {{batch}} of the {{count}} more tables this pipeline writes",
];

const UPSTREAM_TABLES: PluralTemplate = {
  one: "{{count}} table upstream",
  other: "{{count}} tables upstream",
};
const MORE_BUILT_FROM_HERE: string =
  "{{count}} more tables this one is built from are not drawn. Built From below lists them all.";
const MORE_FEEDS_HERE: string =
  "{{count}} more tables built from this one are not drawn. Feeds below lists them all.";

function locale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, `src/Locales/${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function translatorFor(language: string): Translator {
  const words: Record<string, unknown> = locale(language);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = words[text];

    return typeof value === "string" ? value : undefined;
  }, language);
}

function answer(
  fields: Partial<DataAlertLineageAnswer>,
): DataAlertLineageAnswer {
  return {
    lineage: null,
    hasCause: false,
    isCauseDrawn: false,
    consequenceCount: 0,
    drawnConsequenceCount: 0,
    ...fields,
  };
}

describe("the lineage diagrams' words", () => {
  test("are what the diagrams look up, each a key of the English locale with its one form", () => {
    const source: string = COMPONENTS.map((file: string): string => {
      return fs.readFileSync(
        path.join(DASHBOARD, "src/Components/DataObservability", file),
        "utf8",
      );
    }).join("\n");
    const english: Record<string, unknown> = locale("en");
    const strays: Array<string> = [];

    for (const text of TEXTS) {
      if (!source.includes(JSON.stringify(text)) || english[text] !== text) {
        strays.push(text);
      }
    }

    for (const count of COUNTS) {
      const one: unknown = english[`${count}_one`];

      if (
        !source.includes(JSON.stringify(count)) ||
        english[count] !== count ||
        typeof one !== "string" ||
        !source.includes(JSON.stringify(one))
      ) {
        strays.push(count);
      }
    }

    expect(strays).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every one of them, and both forms of every count",
    (language: string) => {
      const words: Record<string, unknown> = locale(language);
      const english: Record<string, unknown> = locale("en");
      const keys: Array<string> = [
        ...TEXTS,
        ...COUNTS,
        ...(WITHOUT_ONE_FORM.includes(language)
          ? []
          : COUNTS.map((count: string): string => {
              return `${count}_one`;
            })),
      ];
      const untranslated: Array<string> = keys.filter(
        (key: string): boolean => {
          return typeof words[key] !== "string" || words[key] === english[key];
        },
      );

      expect({ language, untranslated }).toEqual({
        language,
        untranslated: [],
      });
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s names the sections below the diagram as its Lineage tab titles them",
    (language: string) => {
      const words: Record<string, unknown> = locale(language);
      const builtFrom: string = String(words["Built From"]);
      const feeds: string = String(words["Feeds"]);
      const forms: Array<string> = WITHOUT_ONE_FORM.includes(language)
        ? [""]
        : ["", "_one"];

      for (const form of forms) {
        expect({
          language,
          form,
          namesBuiltFrom: String(
            words[`${MORE_BUILT_FROM_HERE}${form}`],
          ).includes(builtFrom),
          namesFeeds: String(words[`${MORE_FEEDS_HERE}${form}`]).includes(
            feeds,
          ),
        }).toEqual({ language, form, namesBuiltFrom: true, namesFeeds: true });
      }
    },
  );

  /*
   * The Columns tab heads a column's lineage "Comes From" and "Feeds" side
   * by side. Russian titled both "source" (Источник, Источники) and
   * Chinese both 来源 (来源, 数据来源): "Feeds" is where the data goes.
   */
  test.each(DASHBOARD_LANGUAGES)(
    "%s tells where a column comes from apart from what it feeds",
    (language: string) => {
      const words: Record<string, unknown> = locale(language);
      const comesFrom: string = String(words["Comes From"]).toLowerCase();
      const feeds: string = String(words["Feeds"]).toLowerCase();

      expect({
        language,
        oneInTheOther: feeds.includes(comesFrom) || comesFrom.includes(feeds),
      }).toEqual({ language, oneInTheOther: false });
    },
  );
});

describe("an alert's lineage, in words", () => {
  test("German says which way is picked out, each count in its own form", () => {
    expect(
      getAlertLineageSentences(
        translatorFor("de"),
        answer({
          hasCause: true,
          isCauseDrawn: true,
          consequenceCount: 3,
          drawnConsequenceCount: 3,
        }),
      ),
    ).toEqual([
      "Der Weg hinauf zu der Warnung, von der diese verursacht wurde, ist hervorgehoben.",
      "Die Wege hinab zu den 3 Warnungen, die diese verursacht hat, sind hervorgehoben.",
    ]);
  });

  test("German marks the sentence about the way drawn, and not the one about alerts out of reach", () => {
    expect(
      getAlertLineageNotes(
        translatorFor("de"),
        answer({
          hasCause: true,
          isCauseDrawn: true,
          consequenceCount: 3,
          drawnConsequenceCount: 0,
        }),
      ),
    ).toEqual([
      {
        text: "Der Weg hinauf zu der Warnung, von der diese verursacht wurde, ist hervorgehoben.",
        isHighlighted: true,
      },
      {
        text: "Die 3 Warnungen, die diese verursacht hat, liegen weiter nachgelagert, als das Diagramm reicht.",
        isHighlighted: false,
      },
    ]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words the alert card's description apart from the table tab's, without the ways",
    (language: string) => {
      const words: Record<string, unknown> = locale(language);
      const alertCard: string = String(
        words[
          "Where this alert's data comes from and where it goes, with how each table and pipeline is now."
        ],
      );
      const tableTab: string = String(
        words[
          "Where this table's data comes from and where it goes, a few steps each way, with how each table and pipeline is now. Open a table to center the diagram on it."
        ],
      );
      // The sentence that says a way is highlighted, in this language.
      const highlighted: string = String(
        words["The way up to the alert that caused this one is highlighted."],
      );

      expect({
        language,
        isOwnSentence: alertCard !== tableTab,
        // One sentence, shorter than the tab's two.
        isShorter: alertCard.length < tableTab.length,
        saysTheWays: alertCard.includes(highlighted),
      }).toEqual({
        language,
        isOwnSentence: true,
        isShorter: true,
        saysTheWays: false,
      });
    },
  );

  test("French says the one alert it caused without a count", () => {
    expect(
      getAlertLineageSentences(
        translatorFor("fr"),
        answer({ consequenceCount: 1, drawnConsequenceCount: 1 }),
      ),
    ).toEqual([
      "Le chemin qui descend jusqu'à l'alerte causée par celle-ci est mis en évidence.",
    ]);
  });

  test("Russian takes its one form for 21 of a count, and the sentence for one only for exactly one", () => {
    const russian: Translator = translatorFor("ru");

    expect(
      getAlertLineageSentences(
        russian,
        answer({ consequenceCount: 21, drawnConsequenceCount: 5 }),
      ),
    ).toEqual([
      "Выделены пути вниз к 5 из 21 оповещения, вызванного этим. Остальные находятся ниже по потоку, за пределами диаграммы.",
    ]);
    expect(
      getAlertLineageSentences(
        russian,
        answer({ consequenceCount: 22, drawnConsequenceCount: 5 }),
      ),
    ).toEqual([
      "Выделены пути вниз к 5 из 22 оповещений, вызванных этим. Остальные находятся ниже по потоку, за пределами диаграммы.",
    ]);
    expect(
      getAlertLineageSentences(
        russian,
        answer({ consequenceCount: 1, drawnConsequenceCount: 1 }),
      ),
    ).toEqual(["Выделен путь вниз к оповещению, вызванному этим."]);
    expect(
      getAlertLineageSentences(
        russian,
        answer({ consequenceCount: 21, drawnConsequenceCount: 21 }),
      ),
    ).toEqual(["Выделены пути вниз ко всем вызванным этим оповещениям (21)."]);
  });

  test("Arabic words a count of two or more as a count of the alerts", () => {
    const arabic: Translator = translatorFor("ar");

    expect(
      getAlertLineageSentences(
        arabic,
        answer({ hasCause: true, consequenceCount: 2 }),
      ),
    ).toEqual([
      "التنبيه الذي سبّب هذا التنبيه ليس في هذا المخطط: فهو يتعلق بقاعدة بيانات كاملة، أو يقع في المصدر أبعد مما يبلغه المخطط.",
      "التنبيهات التي سبّبها هذا التنبيه أبعد نزولًا مما يبلغه المخطط (العدد: 2).",
    ]);
    expect(
      getAlertLineageSentences(arabic, answer({ consequenceCount: 1 })),
    ).toEqual(["التنبيه الذي سبّبه هذا التنبيه أبعد نزولًا مما يبلغه المخطط."]);
  });

  test("Japanese counts the alerts with its counter, and Persian writes its own digits", () => {
    expect(
      getAlertLineageSentences(
        translatorFor("ja"),
        answer({ consequenceCount: 3, drawnConsequenceCount: 3 }),
      ),
    ).toEqual([
      "このアラートが引き起こした 3 件のアラートまでの下流の経路をハイライト表示しています。",
    ]);

    const persian: Array<string> = getAlertLineageSentences(
      translatorFor("fa"),
      answer({ consequenceCount: 3, drawnConsequenceCount: 3 }),
    );

    expect(persian).toHaveLength(1);
    expect(persian[0]).toContain("۳");
    expect(persian[0]).not.toContain("3");
    expect(persian[0]).not.toContain("alert");
  });
});

describe("what lies each way, and the steps switch", () => {
  test("count in each language's plural, zero included", () => {
    expect(translatorFor("de").translatePlural(UPSTREAM_TABLES, 1)).toBe(
      "1 Tabelle vorgelagert",
    );
    expect(translatorFor("de").translatePlural(UPSTREAM_TABLES, 2)).toBe(
      "2 Tabellen vorgelagert",
    );
    // French says zero in its one form.
    expect(translatorFor("fr").translatePlural(UPSTREAM_TABLES, 0)).toBe(
      "0 table en amont",
    );
    expect(translatorFor("ru").translatePlural(UPSTREAM_TABLES, 21)).toBe(
      "21 таблица выше по потоку",
    );
    expect(translatorFor("ru").translatePlural(UPSTREAM_TABLES, 5)).toBe(
      "Таблиц выше по потоку: 5",
    );
    expect(translatorFor("ar").translatePlural(UPSTREAM_TABLES, 0)).toBe(
      "الجداول في المصدر: 0",
    );
    expect(translatorFor("ar").translatePlural(UPSTREAM_TABLES, 1)).toBe(
      "1 جدول في المصدر",
    );
  });

  test("the switch offers its steps in the reader's words", () => {
    const labels: (language: string) => Array<string> = (
      language: string,
    ): Array<string> => {
      const translator: Translator = translatorFor(language);

      return LINEAGE_DEPTH_OPTIONS.map((option: { label: string }): string => {
        return translator.translateText(option.label) || option.label;
      });
    };

    expect(labels("de")).toEqual([
      "1 Schritt",
      "2 Schritte",
      "3 Schritte",
      "5 Schritte",
    ]);
    expect(labels("ar")).toEqual([
      "خطوة واحدة",
      "خطوتان",
      "3 خطوات",
      "5 خطوات",
    ]);
    expect(labels("fa")).toEqual(["۱ گام", "۲ گام", "۳ گام", "۵ گام"]);
  });
});

describe("what pressing a card's count draws, in words", () => {
  const TABLE: DataTableLineageNode = {
    id: "table:t",
    kind: DataLineageNodeKind.Table,
    side: DataLineageSide.Upstream,
    depth: -1,
    name: "raw.orders",
  };
  const PIPELINE: DataTableLineageNode = {
    id: "pipeline:p",
    kind: DataLineageNodeKind.Pipeline,
    side: DataLineageSide.Focus,
    depth: 0,
    name: "load_orders",
  };
  const label: (
    language: string,
    node: DataTableLineageNode,
    isUpstream: boolean,
    count: number,
  ) => string = (
    language: string,
    node: DataTableLineageNode,
    isUpstream: boolean,
    count: number,
  ): string => {
    return getLineageDrawLabel({
      translator: translatorFor(language),
      node,
      isUpstream,
      count,
    });
  };

  test("German says one table, a few, and ten of more than a card draws at once", () => {
    expect(label("de", TABLE, true, 1)).toBe(
      "Eine weitere vorgelagerte Tabelle zeichnen",
    );
    expect(label("de", TABLE, false, 4)).toBe(
      "4 weitere nachgelagerte Tabellen zeichnen",
    );
    expect(label("de", TABLE, true, 14)).toBe(
      "10 der 14 weiteren vorgelagerten Tabellen zeichnen",
    );
    expect(label("de", PIPELINE, true, 3)).toBe(
      "3 weitere Tabellen zeichnen, die diese Pipeline liest",
    );
    expect(label("de", PIPELINE, false, 30)).toBe(
      "10 der 30 weiteren Tabellen zeichnen, die diese Pipeline schreibt",
    );
  });

  test("Russian takes its one form for 21 of more than a card draws, and its other form for 22", () => {
    expect(label("ru", TABLE, true, 21)).toBe(
      "Показать 10 из 21 другой таблицы выше по потоку",
    );
    expect(label("ru", TABLE, true, 22)).toBe(
      "Показать 10 из 22 других таблиц выше по потоку",
    );
    expect(label("ru", TABLE, false, 1)).toBe(
      "Показать ещё одну таблицу ниже по потоку",
    );
    expect(label("ru", TABLE, false, 3)).toBe(
      "Показать другие таблицы ниже по потоку: 3",
    );
  });

  test("Arabic words two or more as a count, and Persian writes its own digits", () => {
    expect(label("ar", TABLE, true, 2)).toBe(
      "رسم جداول أخرى في المصدر (العدد: 2)",
    );
    expect(label("ar", TABLE, true, 1)).toBe("رسم جدول آخر في المصدر");

    const persian: string = label("fa", TABLE, true, 14);

    expect(persian).toContain("۱۰");
    expect(persian).toContain("۱۴");
    expect(persian).not.toMatch(/[0-9]/);
  });

  test("Japanese counts tables with its counter whatever the count", () => {
    expect(label("ja", TABLE, false, 1)).toBe(
      "下流のテーブルをさらに 1 個描画",
    );
    expect(label("ja", PIPELINE, true, 25)).toBe(
      "このパイプラインが読み取るほかの 25 個のテーブルのうち 10 個を描画",
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words the column a reader follows into its sentence, the column's name kept whole",
    (language: string) => {
      const sentence: string = translatorFor(language).translateTemplate(
        "{{column}} is highlighted where it comes from and where it goes.",
        { column: "customer_id" },
      );

      expect({ language, named: sentence.includes("customer_id") }).toEqual({
        language,
        named: true,
      });
    },
  );
});
