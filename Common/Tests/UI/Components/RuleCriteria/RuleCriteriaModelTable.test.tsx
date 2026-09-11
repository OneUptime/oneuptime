import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import RuleBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { RuleCriteriaOperator } from "../../../../Types/Rules/RuleCriteria";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import type { ModelField } from "../../../../UI/Components/Forms/ModelForm";
import type Filter from "../../../../UI/Components/ModelFilter/Filter";
import type Column from "../../../../UI/Components/ModelTable/Column";
import {
  getRuleCriteriaTableConfiguration,
  replaceRuleCriteriaHelpMarkdown,
  RULE_CRITERIA_HELP_SECTION_BODY,
  type RuleCriteriaTableConfiguration,
  type RuleCriteriaTableHelpContent,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaModelTable";
import { getRuleCriteriaSummaryText } from "../../../../UI/Components/RuleCriteria/RuleCriteriaSummary";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

class ExampleRule extends RuleBaseModel {
  public name?: string;
  public monitorLabels?: Array<Label>;
  public monitorNamePattern?: string;
}

const FORM_FIELDS: Array<ModelField<ExampleRule>> = [
  {
    field: { name: true },
    title: "Name",
    stepId: "basic-info",
    fieldType: FormFieldSchemaType.Text,
  },
  {
    field: { monitorLabels: true },
    title: "Monitor Labels",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
  },
  {
    field: { monitorNamePattern: true },
    title: "Monitor Name Pattern",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.Text,
  },
];

const COLUMNS: Array<Column<ExampleRule>> = [
  { field: { name: true }, title: "Name", type: FieldType.Text },
  {
    field: { monitorLabels: true },
    title: "Monitor Labels",
    type: FieldType.EntityArray,
  },
  {
    field: { monitorNamePattern: true },
    title: "Monitor Name Pattern",
    type: FieldType.Text,
  },
];

const FILTERS: Array<Filter<ExampleRule>> = [
  { field: { name: true }, title: "Name", type: FieldType.Text },
  {
    field: { monitorNamePattern: true },
    title: "Monitor Name Pattern",
    type: FieldType.Text,
  },
];

const DASHBOARD_SOURCE_ROOT: string = path.join(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src",
);

function listTypescriptReactFiles(directoryPath: string): Array<string> {
  const result: Array<string> = [];

  for (const entry of fs.readdirSync(directoryPath, {
    withFileTypes: true,
  })) {
    const entryPath: string = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      result.push(...listTypescriptReactFiles(entryPath));
    } else if (entry.name.endsWith(".tsx")) {
      result.push(entryPath);
    }
  }

  return result;
}

function extractMatchCriteriaHelpMarkdown(source: string): Array<string> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    "RuleTable.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const result: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const markdown: string = node.getText(sourceFile).slice(1, -1);

      if (
        markdown.match(/^#{3,4} Match Criteria(?: \(Filtering\))?$/m) !== null
      ) {
        result.push(markdown);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}

describe("rule criteria table integration", () => {
  test("replaces stale legacy match columns and filters with one summary", () => {
    const configuration: RuleCriteriaTableConfiguration<ExampleRule> =
      getRuleCriteriaTableConfiguration({
        model: new ExampleRule(),
        formFields: FORM_FIELDS,
        columns: COLUMNS,
        filters: FILTERS,
        selectMoreFields: { name: true },
      });

    expect(
      configuration.columns.map((column: Column<ExampleRule>) => {
        return column.title;
      }),
    ).toEqual(["Name", "Match Criteria"]);
    expect(
      configuration.filters.map((filter: Filter<ExampleRule>) => {
        return filter.title;
      }),
    ).toEqual(["Name"]);
    expect(configuration.selectMoreFields).toMatchObject({
      criteria: true,
      monitorLabels: true,
      monitorNamePattern: true,
      name: true,
    });
  });

  test("summarizes configured All and Any criteria without exposing relation ids", () => {
    const rule: ExampleRule = new ExampleRule();
    rule.criteria = {
      schemaVersion: 1,
      filterCondition: FilterCondition.Any,
      filters: [
        {
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ["label-a", "label-b"],
        },
        {
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "api",
        },
      ],
    };

    expect(
      getRuleCriteriaSummaryText({ fields: FORM_FIELDS, item: rule }),
    ).toBe(
      "Match any: Monitor Labels has any of 2 selected values; Monitor Name Pattern contains “api”",
    );

    rule.criteria.filterCondition = FilterCondition.All;
    expect(
      getRuleCriteriaSummaryText({ fields: FORM_FIELDS, item: rule }),
    ).toContain("Match all:");
  });

  test("summarizes legacy rows and safely labels empty or malformed criteria", () => {
    const legacyRule: ExampleRule = new ExampleRule();
    legacyRule.monitorNamePattern = "^api";

    expect(
      getRuleCriteriaSummaryText({ fields: FORM_FIELDS, item: legacyRule }),
    ).toBe("Match all: Monitor Name Pattern matches pattern “^api”");

    expect(
      getRuleCriteriaSummaryText({
        fields: FORM_FIELDS,
        item: new ExampleRule(),
      }),
    ).toBe("Matches all resources");

    const malformedRule: ExampleRule = new ExampleRule();
    malformedRule.criteria = { broken: true } as never;
    expect(
      getRuleCriteriaSummaryText({ fields: FORM_FIELDS, item: malformedRule }),
    ).toBe("Invalid match criteria");
  });

  test("leaves non-rule table configuration untouched", () => {
    const helpContent: RuleCriteriaTableHelpContent = {
      title: "Monitor help",
      markdown: "### Match Criteria\n\nMonitor-specific content.",
    };
    const configuration: RuleCriteriaTableConfiguration<Monitor> =
      getRuleCriteriaTableConfiguration({
        model: new Monitor(),
        formFields: FORM_FIELDS as never,
        columns: COLUMNS as never,
        filters: FILTERS as never,
        helpContent,
      });

    expect(configuration.columns).toBe(COLUMNS);
    expect(configuration.filters).toBe(FILTERS);
    expect(configuration.helpContent).toBe(helpContent);
  });

  test("replaces only the stale match section and preserves other help sections", () => {
    const helpContent: RuleCriteriaTableHelpContent = {
      title: "Example rule help",
      description: "How this rule works",
      markdown: `
### How This Rule Works

The overview stays here.

### Match Criteria

A rule matches only when **all** criteria pass.

- **Labels** — any selected label.
- **Name Pattern** — regex only.

### Action

The action stays here.
`,
    };
    const configuration: RuleCriteriaTableConfiguration<ExampleRule> =
      getRuleCriteriaTableConfiguration({
        model: new ExampleRule(),
        formFields: FORM_FIELDS,
        columns: COLUMNS,
        filters: FILTERS,
        helpContent,
      });

    expect(configuration.helpContent).toEqual({
      title: helpContent.title,
      description: helpContent.description,
      markdown: expect.stringContaining(RULE_CRITERIA_HELP_SECTION_BODY),
    });
    expect(configuration.helpContent?.markdown).toContain(
      "The overview stays here.",
    );
    expect(configuration.helpContent?.markdown).toContain(
      "### Action\n\nThe action stays here.",
    );
    expect(configuration.helpContent?.markdown).not.toContain(
      "all** criteria pass",
    );
    expect(configuration.helpContent?.markdown).not.toContain("regex only");
  });

  test("preserves grouping help while replacing its nested filtering section", () => {
    const markdown: string = `
### Match Criteria vs Group By

The comparison stays here.

#### Match Criteria (Filtering)

An alert must pass ALL specified criteria.

#### Group By (Partitioning)

The grouping explanation stays here.

### More Details

More details stay here.
`;
    const transformed: string = replaceRuleCriteriaHelpMarkdown(markdown);

    expect(transformed).toContain("### Match Criteria vs Group By");
    expect(transformed).toContain("The comparison stays here.");
    expect(transformed).toContain(
      "#### Match Criteria (Filtering)\n\n" + RULE_CRITERIA_HELP_SECTION_BODY,
    );
    expect(transformed).toContain(
      "#### Group By (Partitioning)\n\nThe grouping explanation stays here.",
    );
    expect(transformed).toContain(
      "### More Details\n\nMore details stay here.",
    );
    expect(transformed).not.toContain("must pass ALL");
  });

  test("normalizes every static rule help document through the shared behavior", () => {
    const staticRuleFormFiles: Array<string> = listTypescriptReactFiles(
      DASHBOARD_SOURCE_ROOT,
    ).filter((filePath: string): boolean => {
      return (
        fs
          .readFileSync(filePath, "utf8")
          .match(/id\s*:\s*["']match-criteria["']/) !== null
      );
    });
    const helpFormFiles: Array<string> = staticRuleFormFiles.filter(
      (filePath: string): boolean => {
        return (
          fs.readFileSync(filePath, "utf8").match(/helpContent=\{\{/) !== null
        );
      },
    );
    const helpMarkdown: Array<string> = helpFormFiles.flatMap(
      (filePath: string): Array<string> => {
        return extractMatchCriteriaHelpMarkdown(
          fs.readFileSync(filePath, "utf8"),
        );
      },
    );

    expect(staticRuleFormFiles).toHaveLength(61);
    expect(helpFormFiles).toHaveLength(54);
    expect(helpMarkdown).toHaveLength(60);

    for (const markdown of helpMarkdown) {
      const transformed: string = replaceRuleCriteriaHelpMarkdown(markdown);

      expect(transformed).not.toBe(markdown);
      expect(transformed).toContain(RULE_CRITERIA_HELP_SECTION_BODY);
      expect(transformed).toContain("Match all (AND)");
      expect(transformed).toContain("Match any (OR)");
      expect(transformed).toContain("Has none of");
      expect(transformed).toContain("Does not match pattern");
    }
  });
});
