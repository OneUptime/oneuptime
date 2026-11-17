// UX rule: Docs/ux/README.md#help-dialogs
import LogFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/LogFilterConfig";
import TraceFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/TraceFilterConfig";
import {
  FilterBuilderConfig,
  FilterFieldDefinition,
  FilterFieldValueOption,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/Types";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE FILTER HELP DESCRIBES THE BUILDER, NOT A QUERY NOBODY CAN TYPE (#9133).
 *
 * Logs and Traces > Settings > Drop Filters and Pipelines pick their records
 * with a visual builder (Components/FilterQueryBuilder): a Field, an
 * Operator and a Value from dropdowns, joined by All conditions or Any
 * condition. It has no text mode. Their help taught a query language
 * instead - "kind = 'SPAN_KIND_CLIENT' AND statusCode != 2", LIKE
 * wildcards, "Status codes: 0 Unset, 1 Ok, 2 Error" - which nobody could
 * type anywhere on the page.
 *
 * So the four help documents write a condition as the builder draws it,
 * "**Span Name** · contains · `healthcheck`", and this holds each to the
 * builder's own words:
 *
 *   - no query: no operator keyword, stored column name or numeric status;
 *   - every condition's field is a field of that builder (or a custom
 *     attribute), its operator one the builder offers, and a value its
 *     dropdown offers is written as the dropdown's label (Error, not 2);
 *   - the Fields line lists exactly the builder's fields, the Operators
 *     line every operator, and both connectors are named as drawn.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const readSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
};

// The markdown a settings page shows in its help, as markdown.
const readHelp: (relativePath: string) => string = (
  relativePath: string,
): string => {
  const raw: string = readSource(relativePath);
  const opening: string = "const documentationMarkdown: string = `";
  const start: number = raw.indexOf(opening);
  const end: number = raw.indexOf("\n`;", start);

  if (start === -1 || end === -1) {
    throw new Error(`${relativePath} has no documentationMarkdown`);
  }

  return raw.substring(start + opening.length, end).replace(/\\`/g, "`");
};

// The operators the builder offers, by the words it draws for them.
const OPERATOR_LABELS: Array<string> = Array.from(
  readSource("Components/FilterQueryBuilder/FilterCondition.tsx").matchAll(
    /\{ value: "(?:=|!=|LIKE|IN)", label: "([^"]+)"/g,
  ),
).map((match: RegExpMatchArray): string => {
  return match[1]!;
});

const BUILDER_FIELD_SOURCE: string = readSource(
  "Components/FilterQueryBuilder/FilterQueryBuilderField.tsx",
);
const CONDITION_SOURCE: string = readSource(
  "Components/FilterQueryBuilder/FilterCondition.tsx",
);

interface HelpPage {
  name: string;
  file: string;
  config: FilterBuilderConfig;
}

const HELP_PAGES: Array<HelpPage> = [
  {
    name: "Logs > Drop Filters",
    file: "Pages/Logs/Settings/DropFilters.tsx",
    config: LogFilterConfig,
  },
  {
    name: "Logs > Pipelines",
    file: "Pages/Logs/Settings/Pipelines.tsx",
    config: LogFilterConfig,
  },
  {
    name: "Traces > Drop Filters",
    file: "Pages/Traces/Settings/DropFilters.tsx",
    config: TraceFilterConfig,
  },
  {
    name: "Traces > Pipelines",
    file: "Pages/Traces/Settings/Pipelines.tsx",
    config: TraceFilterConfig,
  },
];

/*
 * A condition as the help writes it: a field (bold, or "the custom
 * attribute `key`"), an operator and a value (bold, or as code).
 */
const CONDITION: RegExp =
  /(?:\*\*([^*]+)\*\*|the custom attribute `([^`]+)`) · ([a-z ]+?) · (?:\*\*([^*]+)\*\*|`([^`]+)`)/g;

interface WrittenCondition {
  field: string | undefined;
  customAttribute: string | undefined;
  operator: string;
  boldValue: string | undefined;
  codeValue: string | undefined;
}

const conditionsIn: (markdown: string) => Array<WrittenCondition> = (
  markdown: string,
): Array<WrittenCondition> => {
  return Array.from(markdown.matchAll(CONDITION)).map(
    (match: RegExpMatchArray): WrittenCondition => {
      return {
        field: match[1],
        customAttribute: match[2],
        operator: match[3]!,
        boldValue: match[4],
        codeValue: match[5],
      };
    },
  );
};

const lineStarting: (markdown: string, start: string) => string = (
  markdown: string,
  start: string,
): string => {
  return (
    markdown.split("\n").find((line: string): boolean => {
      return line.startsWith(start);
    }) || ""
  );
};

const boldIn: (text: string) => Array<string> = (text: string): string[] => {
  return Array.from(text.matchAll(/\*\*([^*]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
};

describe("the guard's reading of the builder", () => {
  test("finds the builder's four operators", () => {
    expect(OPERATOR_LABELS).toEqual([
      "equals",
      "does not equal",
      "contains",
      "is one of",
    ]);
  });

  test("reads a condition as the help writes it", () => {
    expect(
      conditionsIn(
        "**Span Kind** · equals · **Client** and the custom attribute `source` · contains · `lb`",
      ),
    ).toEqual([
      {
        field: "Span Kind",
        customAttribute: undefined,
        operator: "equals",
        boldValue: "Client",
        codeValue: undefined,
      },
      {
        field: undefined,
        customAttribute: "source",
        operator: "contains",
        boldValue: undefined,
        codeValue: "lb",
      },
    ]);
  });
});

describe.each(HELP_PAGES)("the help on $name", (page: HelpPage) => {
  const help: string = readHelp(page.file);
  const fieldsByLabel: Map<string, FilterFieldDefinition> = new Map(
    page.config.fields.map(
      (field: FilterFieldDefinition): [string, FilterFieldDefinition] => {
        return [field.label, field];
      },
    ),
  );

  test("REGRESSION: teaches no query to type", () => {
    for (const query of [
      /\bLIKE\b/,
      /\bIN \(/,
      /\b(AND|OR)\b/,
      /\bstatusCode\b/,
      /\bseverityText\b/,
      /\bprimaryEntityId\b/,
      /SPAN_KIND_/,
      /`attributes\.<key>`/,
      /`[^`]*\s(=|!=)\s[^`]*`/,
      /`[012]` for/,
    ]) {
      expect({
        page: page.name,
        query: query.source,
        found: query.test(help),
      }).toEqual({ page: page.name, query: query.source, found: false });
    }
  });

  test("writes each condition in the builder's own words", () => {
    const conditions: Array<WrittenCondition> = conditionsIn(help);

    expect(conditions.length).toBeGreaterThan(0);
    // Every "·" is part of a condition the guard read.
    expect(help.split(" · ").length - 1).toBe(conditions.length * 2);

    for (const condition of conditions) {
      expect(OPERATOR_LABELS).toContain(condition.operator);

      if (condition.customAttribute !== undefined) {
        expect(page.config.supportCustomAttributes).toBe(true);
        expect(condition.customAttribute).not.toContain("attributes.");
        continue;
      }

      const field: FilterFieldDefinition | undefined = fieldsByLabel.get(
        condition.field || "",
      );
      expect({
        page: page.name,
        field: condition.field,
        known: Boolean(field),
      }).toEqual({ page: page.name, field: condition.field, known: true });

      const options: Array<FilterFieldValueOption> = field?.valueOptions || [];
      const offersAList: boolean =
        options.length > 0 &&
        (condition.operator === "equals" ||
          condition.operator === "does not equal");

      if (offersAList) {
        // Picked from the dropdown: written as its label, never its stored value.
        expect({
          page: page.name,
          condition: condition,
          label: options.some((option: FilterFieldValueOption): boolean => {
            return option.label === condition.boldValue;
          }),
        }).toEqual({ page: page.name, condition: condition, label: true });
      } else {
        // Typed in a text box: written as code.
        expect({ page: page.name, condition: condition, typed: true }).toEqual({
          page: page.name,
          condition: condition,
          typed: condition.codeValue !== undefined,
        });
      }
    }
  });

  test("lists exactly the builder's fields, and every operator", () => {
    const fields: Array<string> = boldIn(lineStarting(help, "- **Fields:**"));
    expect(fields).toEqual([
      "Fields:",
      ...page.config.fields.map((field: FilterFieldDefinition): string => {
        return field.label;
      }),
      page.config.customAttributeLabel || "",
    ]);

    const operators: Array<string> = boldIn(
      lineStarting(help, "- **Operators:**"),
    );
    for (const label of OPERATOR_LABELS) {
      expect(operators).toContain(label);
    }
  });

  test("names the parts of a condition and both connectors as the builder draws them", () => {
    for (const part of ["Field", "Operator", "Value"]) {
      expect(help).toContain(`**${part}**`);
      expect(CONDITION_SOURCE).toContain(`translator.translateText("${part}")`);
    }

    for (const connector of ["All conditions", "Any condition"]) {
      expect(help).toContain(`**${connector}**`);
      expect(BUILDER_FIELD_SOURCE).toContain(
        `translator.translateText("${connector}")`,
      );
    }
  });
});

describe("a span's status, as the Traces help says it", () => {
  test("is the Status dropdown's three labels, never its stored numbers", () => {
    const status: FilterFieldDefinition | undefined =
      TraceFilterConfig.fields.find((field: FilterFieldDefinition) => {
        return field.label === "Status";
      });
    const labels: Array<string> = (status?.valueOptions || []).map(
      (option: FilterFieldValueOption): string => {
        return option.label;
      },
    );

    expect(labels.sort()).toEqual(["Error", "Ok", "Unset"]);
    expect(readHelp("Pages/Traces/Settings/DropFilters.tsx")).toContain(
      "**Status** is **Error**, **Ok** or **Unset**.",
    );
  });

  test("says what a span is before it says how to pick one", () => {
    const help: string = readHelp("Pages/Traces/Settings/DropFilters.tsx");
    const definition: number = help.indexOf("A span is one step of a request");

    expect(definition).toBeGreaterThan(-1);
    expect(definition).toBeLessThan(help.indexOf("· contains ·"));
  });
});
