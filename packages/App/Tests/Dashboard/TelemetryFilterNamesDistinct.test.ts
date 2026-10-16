import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  RESOURCE_FACET_CATALOG,
  ResourceFacetDefinition,
} from "Common/Types/Telemetry/ResourceFacetCatalog";
import LogFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/LogFilterConfig";
import TraceFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/TraceFilterConfig";
import {
  FilterBuilderConfig,
  FilterFieldDefinition,
  FilterFieldValueOption,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/Types";
import {
  SECURITY_EVENT_FACETS,
  SecurityEventFacetDefinition,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsFacets";

/*
 * Every telemetry filter has a name of its own, in every Dashboard language.
 *
 * The traces explorer's sidebar has two span filters: Span Type, whose one
 * choice is Root spans, and Span Kind, OpenTelemetry's SpanKind (Server,
 * Client, Producer, Consumer, Internal). Japanese named both スパンの種類 and
 * Spanish both "Tipo de span", so the sidebar showed two filters with one
 * name, a Root spans chip and a Server chip read the same key, and the
 * Japanese docs page had to explain each with a parenthesis. Danish and
 * Norwegian drew "Span-type" beside an English "Span Type".
 *
 * This reads the filters each screen offers side by side - the sections of
 * every explorer's sidebar, the fields of the trace and log filter builders
 * and the choices of each, the group-by dimensions of the analytics views
 * and of the dashboard trace chart - from the code that draws them, and
 * holds every pair in one screen to two different names in every language:
 * the locale's wording, or the English the Dashboard falls back to when the
 * locale has none. Names that differ only in case, spacing or hyphens
 * ("Span-type" and "Span Type") count as one name.
 *
 * The sidebars draw these titles in the reader's language
 * (FacetSectionHeader); Common/Tests/App/Dashboard/
 * TracesFilterNamesInEveryLanguage renders them.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Dashboard/src",
);
const COMMON_UI: string = path.join(REPO_ROOT, "packages/Common/UI");
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

type Locale = Record<string, unknown>;

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.slice(0, -".json".length);
  })
  .sort();

const LOCALES: Record<string, Locale> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
}

const ENGLISH: Locale = LOCALES["en"] as Locale;

// What the Dashboard draws for an English label in this language.
function drawn(language: string, english: string): string {
  const value: unknown = (LOCALES[language] as Locale)[english];

  return typeof value === "string" && value.trim() ? value : english;
}

// Runs of spaces, dashes, underscores and middle dots read as one gap.
const GAP: RegExp = /[\s\p{Pd}_·・]+/gu;

/*
 * A name as a reader tells it from another: "Span-type", "Span Type" and
 * "SPAN TYPE" are one name; full-width letters are their usual ones.
 */
function comparable(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(GAP, " ").trim();
}

// --- Reading the filters each screen draws, from the code that draws them.

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function nameOf(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }

  return undefined;
}

// The first node under `root` that `match` accepts, depth first.
function find(
  root: ts.Node,
  match: (node: ts.Node) => boolean,
): ts.Node | undefined {
  let found: ts.Node | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (match(node)) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(root);

  return found;
}

// What the variable `name` is set to, wherever in the file it is declared.
function variableValue(file: string, name: string): ts.Node {
  const declaration: ts.Node | undefined = find(
    parse(file),
    (node: ts.Node): boolean => {
      return (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer !== undefined
      );
    },
  );

  if (!declaration) {
    throw new Error(`${path.relative(REPO_ROOT, file)} declares no ${name}.`);
  }

  return (declaration as ts.VariableDeclaration).initializer as ts.Node;
}

// The body of the function `name` the file declares.
function functionBody(file: string, name: string): ts.Node {
  const declaration: ts.Node | undefined = find(
    parse(file),
    (node: ts.Node): boolean => {
      return (
        ts.isFunctionDeclaration(node) &&
        node.name?.text === name &&
        node.body !== undefined
      );
    },
  );

  if (!declaration) {
    throw new Error(
      `${path.relative(REPO_ROOT, file)} declares no function ${name}.`,
    );
  }

  return (declaration as ts.FunctionDeclaration).body as ts.Node;
}

/*
 * Every string set as a property under the node, in order: `title: "Span
 * Kind"` for "title", or every property's string for no name (a title map).
 */
function propertyStrings(root: ts.Node, property?: string): Array<string> {
  const values: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (property === undefined || nameOf(node.name) === property) &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      values.push(node.initializer.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(root);

  return values;
}

// Whether the code under the node calls the function `name`.
function calls(root: ts.Node, name: string): boolean {
  return (
    find(root, (node: ts.Node): boolean => {
      return (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === name
      );
    }) !== undefined
  );
}

const RESOURCE_LABELS: Array<string> = RESOURCE_FACET_CATALOG.map(
  (definition: ResourceFacetDefinition): string => {
    return definition.label;
  },
);

/*
 * The section titles of an explorer's sidebar: the titles its facetConfigs
 * set, and every resource type's when it lists them
 * (buildResourceFacetConfigs).
 */
function explorerSidebar(file: string): Array<string> {
  const configs: ts.Node = variableValue(file, "facetConfigs");

  return [
    ...propertyStrings(configs, "title"),
    ...(calls(configs, "buildResourceFacetConfigs") ? RESOURCE_LABELS : []),
  ];
}

/*
 * The logs explorer's section titles: getFacetTitle's map, and every
 * resource type's label, which it reads from the catalog.
 */
function logsSidebar(): Array<string> {
  const body: ts.Node = functionBody(
    path.join(COMMON_UI, "Components/LogsViewer/components/LogsFacetSidebar.tsx"),
    "getFacetTitle",
  );

  return [
    ...propertyStrings(body),
    ...(calls(body, "getResourceFacetDefinition") ? RESOURCE_LABELS : []),
  ];
}

function optionLabels(file: string, variable: string): Array<string> {
  return propertyStrings(variableValue(file, variable), "label");
}

function fieldLabels(config: FilterBuilderConfig): Array<string> {
  return config.fields.map((field: FilterFieldDefinition): string => {
    return field.label;
  });
}

// The choices of each dropdown field of a filter builder, by field.
function choiceSets(
  builder: string,
  config: FilterBuilderConfig,
): Array<LabelSet> {
  return config.fields
    .filter((field: FilterFieldDefinition): boolean => {
      return (field.valueOptions || []).length > 0;
    })
    .map((field: FilterFieldDefinition): LabelSet => {
      return {
        screen: `${builder}: the choices of ${field.label}`,
        labels: (field.valueOptions || []).map(
          (option: FilterFieldValueOption): string => {
            return option.label;
          },
        ),
      };
    });
}

interface LabelSet {
  // Where a reader meets these names side by side.
  screen: string;
  labels: Array<string>;
}

const TRACES_VIEWER: string = path.join(
  DASHBOARD_SRC,
  "Components/Traces/TracesViewer.tsx",
);

const TRACES_SIDEBAR: Array<string> = explorerSidebar(TRACES_VIEWER);

const SIDEBARS: Array<LabelSet> = [
  { screen: "the Traces explorer's sidebar", labels: TRACES_SIDEBAR },
  {
    screen: "the Exceptions explorer's sidebar",
    labels: explorerSidebar(
      path.join(DASHBOARD_SRC, "Components/Exceptions/ExceptionsViewer.tsx"),
    ),
  },
  {
    screen: "the Metrics explorer's sidebar",
    labels: explorerSidebar(
      path.join(DASHBOARD_SRC, "Components/Metrics/MetricsViewer.tsx"),
    ),
  },
  { screen: "the Logs explorer's sidebar", labels: logsSidebar() },
  {
    screen: "the Security Events explorer's sidebar",
    labels: SECURITY_EVENT_FACETS.map(
      (facet: SecurityEventFacetDefinition): string => {
        return facet.title;
      },
    ),
  },
];

const FILTER_BUILDERS: Array<LabelSet> = [
  {
    screen: "the span filter builder (drop filters, scrub rules, pipelines)",
    labels: fieldLabels(TraceFilterConfig),
  },
  ...choiceSets("the span filter builder", TraceFilterConfig),
  {
    screen: "the log filter builder (drop filters, scrub rules, pipelines)",
    labels: fieldLabels(LogFilterConfig),
  },
  ...choiceSets("the log filter builder", LogFilterConfig),
];

const GROUP_BY: Array<LabelSet> = [
  {
    screen: "the Traces explorer's analytics: group by",
    labels: optionLabels(
      path.join(DASHBOARD_SRC, "Components/Traces/TracesAnalyticsView.tsx"),
      "DIMENSION_OPTIONS",
    ),
  },
  {
    screen: "the Logs explorer's analytics: group by",
    labels: optionLabels(
      path.join(COMMON_UI, "Components/LogsViewer/components/LogsAnalyticsView.tsx"),
      "DIMENSION_OPTIONS",
    ),
  },
  {
    screen: "a dashboard's trace chart: split by",
    labels: optionLabels(
      path.join(
        DASHBOARD_SRC,
        "Components/Dashboard/Canvas/TraceChartQueryEditor.tsx",
      ),
      "SPECIAL_SPLIT_OPTIONS",
    ),
  },
];

const LABEL_SETS: Array<LabelSet> = [...SIDEBARS, ...FILTER_BUILDERS, ...GROUP_BY];

/*
 * The pairs of one screen that read as one name in this language:
 * "the Traces explorer's sidebar: Span Type and Span Kind both read スパンの種類".
 */
function sameNames(language: string, set: LabelSet): Array<string> {
  const firstByName: Map<string, string> = new Map<string, string>();
  const found: Array<string> = [];

  for (const label of Array.from(new Set(set.labels))) {
    const name: string = drawn(language, label);
    const key: string = comparable(name);
    const first: string | undefined = firstByName.get(key);

    if (first === undefined) {
      firstByName.set(key, label);
      continue;
    }

    found.push(
      `${set.screen}: ${first} and ${label} both read ${drawn(language, first)} / ${name}`,
    );
  }

  return found;
}

const SPAN_TYPE: string = "Span Type";
const SPAN_KIND: string = "Span Kind";

describe("the filters this test reads, from the code that draws them", () => {
  test("every Dashboard locale is read: English and the 16 languages", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES).toContain("ja");
    expect(LANGUAGES).toContain("es");
  });

  test("the Traces explorer's sidebar has both span filters, among its own and the resource types'", () => {
    expect(TRACES_SIDEBAR).toEqual(
      expect.arrayContaining([
        "Service",
        "Status",
        SPAN_TYPE,
        "Has Exception",
        SPAN_KIND,
        "Span Name",
        ...RESOURCE_LABELS,
      ]),
    );
  });

  test("every screen offers at least one filter, and the side-by-side ones two or more", () => {
    for (const set of LABEL_SETS) {
      expect({ screen: set.screen, read: set.labels.length > 0 }).toEqual({
        screen: set.screen,
        read: true,
      });
    }

    for (const set of [...SIDEBARS, ...FILTER_BUILDERS, ...GROUP_BY].filter(
      (candidate: LabelSet): boolean => {
        return candidate.screen !== "the Metrics explorer's sidebar";
      },
    )) {
      expect({ screen: set.screen, sideBySide: set.labels.length > 1 }).toEqual(
        { screen: set.screen, sideBySide: true },
      );
    }
  });

  test("Span Kind is a filter of the span filter builder and a group-by of both trace analytics", () => {
    const named: (screen: string) => Array<string> = (
      screen: string,
    ): Array<string> => {
      return (
        LABEL_SETS.find((set: LabelSet): boolean => {
          return set.screen === screen;
        }) as LabelSet
      ).labels;
    };

    expect(
      named("the span filter builder (drop filters, scrub rules, pipelines)"),
    ).toContain(SPAN_KIND);
    expect(named("the Traces explorer's analytics: group by")).toContain(
      SPAN_KIND,
    );
    expect(named("a dashboard's trace chart: split by")).toContain(SPAN_KIND);
  });

  test("every sidebar title is a key of the Dashboard's English locale, so each language can name it", () => {
    const missing: Array<string> = SIDEBARS.flatMap(
      (set: LabelSet): Array<string> => {
        return set.labels
          .filter((label: string): boolean => {
            return ENGLISH[label] !== label;
          })
          .map((label: string): string => {
            return `${set.screen}: ${label}`;
          });
      },
    );

    expect(missing).toEqual([]);
  });
});

describe("one name per filter, in every language", () => {
  test.each(LANGUAGES)(
    "%s: no two filters a screen offers side by side read as one name",
    (language: string) => {
      const found: Array<string> = LABEL_SETS.flatMap(
        (set: LabelSet): Array<string> => {
          return sameNames(language, set);
        },
      );

      expect(found).toEqual([]);
    },
  );
});

describe("Span Type and Span Kind", () => {
  test.each(LANGUAGES.filter((language: string): boolean => {
    return language !== "en";
  }))(
    "%s names Span Type in its own words, apart from its Span Kind",
    (language: string) => {
      const spanType: string = drawn(language, SPAN_TYPE);
      const spanKind: string = drawn(language, SPAN_KIND);

      /*
       * A locale that words Span Kind with its word for "type" and leaves
       * Span Type in English shows one name in two languages: "Type de span"
       * beside "Span Type".
       */
      expect(spanType).not.toBe(SPAN_TYPE);
      expect(spanKind).not.toBe(SPAN_KIND);
      expect(comparable(spanType)).not.toBe(comparable(spanKind));
    },
  );

  /*
   * Span Kind is OpenTelemetry's SpanKind, and keeps the name OpenTelemetry's
   * own documentation gives it in these languages (opentelemetry.io/ja,
   * /es and /zh: "スパンの種類（SpanKind）", "Tipo de span", "Span 类型").
   * Span Type, OneUptime's own root-spans filter, took the new name.
   */
  test.each([
    ["ja", "スパンの種類", "スパンタイプ"],
    ["es", "Tipo de span", "Categoría de span"],
    ["zh-CN", "Span 类型", "Span 类别"],
  ])(
    "%s keeps OpenTelemetry's name for Span Kind, %s, and calls Span Type %s",
    (language: string, spanKind: string, spanType: string) => {
      expect(drawn(language, SPAN_KIND)).toBe(spanKind);
      expect(drawn(language, SPAN_TYPE)).toBe(spanType);
    },
  );

  test("English keeps both names as they were", () => {
    expect(drawn("en", SPAN_TYPE)).toBe(SPAN_TYPE);
    expect(drawn("en", SPAN_KIND)).toBe(SPAN_KIND);
  });
});

describe("telling names apart", () => {
  test("case, spaces, hyphens and full-width letters make no new name", () => {
    expect(comparable("Span-type")).toBe(comparable("Span Type"));
    expect(comparable("SPAN TYPE")).toBe(comparable("span  type"));
    expect(comparable("Ｓｐａｎ　Ｔｙｐｅ")).toBe(comparable("Span Type"));
    expect(comparable("スパン・タイプ")).toBe(comparable("スパン タイプ"));
  });

  test("different words are different names", () => {
    expect(comparable("Span-kategori")).not.toBe(comparable("Span-type"));
    expect(comparable("スパンタイプ")).not.toBe(comparable("スパンの種類"));
    expect(comparable("Categoría de span")).not.toBe(
      comparable("Tipo de span"),
    );
  });

  test("a pair that reads as one name is reported with both filters and the name", () => {
    expect(
      sameNames("ja", {
        screen: "a screen",
        labels: [SPAN_KIND, "Kind"],
      }),
    ).toEqual([]);
    expect(
      sameNames("ja", {
        screen: "a screen",
        labels: ["Type", "Kind"],
      }),
    ).toEqual(["a screen: Type and Kind both read 種類 / 種類"]);
    // A label listed twice is one filter, not a pair.
    expect(
      sameNames("ja", { screen: "a screen", labels: [SPAN_KIND, SPAN_KIND] }),
    ).toEqual([]);
  });

  test("a label no locale has is drawn in English, and compared so", () => {
    expect(drawn("ja", "No such label, anywhere")).toBe(
      "No such label, anywhere",
    );
  });
});
