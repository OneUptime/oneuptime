import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkSiteAssignmentRule from "../../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import StatusPageMonitorRule from "../../../../Models/DatabaseModels/StatusPageMonitorRule";
import RuleBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { RuleCriteriaOperator } from "../../../../Types/Rules/RuleCriteria";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import type { ModelField } from "../../../../UI/Components/Forms/ModelForm";
import type Filter from "../../../../UI/Components/ModelFilter/Filter";
import type Column from "../../../../UI/Components/ModelTable/Column";
import {
  getRuleCriteriaHelpSectionBody,
  getRuleCriteriaTableConfiguration,
  replaceRuleCriteriaHelpMarkdown,
  RULE_CRITERIA_HELP_SECTION_BODY,
  type RuleCriteriaTableConfiguration,
  type RuleCriteriaTableHelpContent,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaModelTable";
import {
  getRuleCriteriaSummaryText,
  RULE_CRITERIA_SUMMARY_MATCHES_EVERYTHING,
  RULE_CRITERIA_SUMMARY_MATCHES_NOTHING,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaSummary";
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
    title: "Monitor Name",
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
      "Match any: Monitor Labels has any of 2 selected values; Monitor Name contains “api”",
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
    ).toBe("Match all: Monitor Name matches pattern “^api”");

    expect(
      getRuleCriteriaSummaryText({
        fields: FORM_FIELDS,
        item: new ExampleRule(),
      }),
    ).toBe(RULE_CRITERIA_SUMMARY_MATCHES_EVERYTHING);
    expect(RULE_CRITERIA_SUMMARY_MATCHES_EVERYTHING).toBe(
      "Matches everything (no conditions)",
    );

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
      markdown: expect.stringContaining(
        getRuleCriteriaHelpSectionBody({
          fields: FORM_FIELDS.filter((field: ModelField<ExampleRule>) => {
            return field.stepId === "match-criteria";
          }),
        }),
      ),
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
    /*
     * A form with a Match Criteria step: written on the page, or the shared
     * label and owner rule form's Match step (Dashboard Utils/Form/
     * ResourceRuleForm).
     */
    const matchCriteriaForm: RegExp =
      /id\s*:\s*["']match-criteria["']|formSteps=\{get(?:Label|Owner)RuleFormSteps</;
    const staticRuleFormFiles: Array<string> = listTypescriptReactFiles(
      DASHBOARD_SOURCE_ROOT,
    ).filter((filePath: string): boolean => {
      return (
        fs.readFileSync(filePath, "utf8").match(matchCriteriaForm) !== null
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

    expect(staticRuleFormFiles).toHaveLength(68);
    expect(helpFormFiles).toHaveLength(61);
    // 67, and the five episode rule help texts that now have the heading too.
    expect(helpMarkdown).toHaveLength(72);

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

describe("the help panel's Match Criteria section", () => {
  const LABELS_FIELD: ModelField<ExampleRule> = FORM_FIELDS[1]!;
  const NAME_FIELD: ModelField<ExampleRule> = FORM_FIELDS[2]!;
  const ADDRESS_FIELD: ModelField<ExampleRule> = {
    field: { subnetCidr: true } as never,
    title: "IP Address",
    stepId: "match-criteria",
    fieldType: FormFieldSchemaType.Text,
  };

  test("lists every kind of operator when it does not know the fields", () => {
    const body: string = getRuleCriteriaHelpSectionBody({});

    expect(body).toBe(RULE_CRITERIA_HELP_SECTION_BODY);
    for (const line of [
      "**Match all (AND)** — every condition must be true.",
      "**Match any (OR)** — at least one condition must be true.",
      "**Equality** — Equals or Does not equal.",
      "**Text** — Contains, Does not contain, Starts with or Ends with.",
      "**Patterns** — Matches pattern or Does not match pattern.",
      "**Address ranges** — Is in or Is not in",
      "**Lists** — Has any of, Has all of or Has none of the selected values.",
      "A rule with no conditions applies to everything.",
    ]) {
      expect(body).toContain(line);
    }
  });

  test("only names the operators the page's fields offer", () => {
    const listsOnly: string = getRuleCriteriaHelpSectionBody({
      fields: [LABELS_FIELD],
    });
    expect(listsOnly).toContain("**Lists**");
    expect(listsOnly).not.toContain("**Text**");
    expect(listsOnly).not.toContain("**Patterns**");
    expect(listsOnly).not.toContain("**Equality**");
    expect(listsOnly).not.toContain("**Address ranges**");

    const textAndLists: string = getRuleCriteriaHelpSectionBody({
      fields: [LABELS_FIELD, NAME_FIELD],
    });
    expect(textAndLists).toContain("**Text**");
    expect(textAndLists).toContain("**Patterns**");
    expect(textAndLists).toContain("**Equality**");
    expect(textAndLists).not.toContain("**Address ranges**");

    const addressOnly: string = getRuleCriteriaHelpSectionBody({
      fields: [ADDRESS_FIELD],
    });
    expect(addressOnly).toContain("**Address ranges**");
    expect(addressOnly).not.toContain("**Patterns**");
    expect(addressOnly).not.toContain("**Text**");
  });

  test("says a rule needs a condition when its kind matches nothing without one", () => {
    const body: string = getRuleCriteriaHelpSectionBody({
      fields: [NAME_FIELD],
      requiresCondition: true,
    });

    expect(body).toContain("needs at least one condition");
    expect(body).not.toContain("applies to everything");
  });

  test("the table writes the section for its own model and fields", () => {
    const configuration: RuleCriteriaTableConfiguration<StatusPageMonitorRule> =
      getRuleCriteriaTableConfiguration({
        model: new StatusPageMonitorRule(),
        formFields: FORM_FIELDS as never,
        columns: COLUMNS as never,
        filters: FILTERS as never,
        helpContent: {
          title: "Monitor rules",
          markdown: "### Match Criteria\n\nOld text.\n\n### After\n\nKept.",
        },
      });

    expect(configuration.helpContent?.markdown).toContain(
      "needs at least one condition",
    );
    expect(configuration.helpContent?.markdown).not.toContain("Old text.");
    expect(configuration.helpContent?.markdown).toContain("### After\n\nKept.");
  });
});

describe("the rule summary", () => {
  test("says a rule that needs a condition matches nothing without one", () => {
    expect(
      getRuleCriteriaSummaryText({
        fields: FORM_FIELDS as never,
        item: new StatusPageMonitorRule(),
      }),
    ).toBe(RULE_CRITERIA_SUMMARY_MATCHES_NOTHING);
  });

  test("names an address range condition with Is in", () => {
    const rule: NetworkSiteAssignmentRule = new NetworkSiteAssignmentRule();
    rule.criteria = {
      schemaVersion: 1,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "subnetCidr",
          operator: RuleCriteriaOperator.MatchesPattern,
          value: "10.42.7.0/24",
        },
        {
          field: "hostnamePattern",
          operator: RuleCriteriaOperator.StartsWith,
          value: "unit-1042",
        },
      ],
    };

    expect(
      getRuleCriteriaSummaryText({
        fields: [
          {
            field: { subnetCidr: true },
            title: "IP Address",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
          },
          {
            field: { hostnamePattern: true },
            title: "Hostname",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
          },
        ],
        item: rule,
      }),
    ).toBe(
      "Match all: IP Address is in “10.42.7.0/24”; Hostname starts with “unit-1042”",
    );
  });

  test("names a criterion without a title by its column, less Pattern", () => {
    const rule: ExampleRule = new ExampleRule();
    rule.criteria = {
      schemaVersion: 1,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "api",
        },
      ],
    };

    expect(getRuleCriteriaSummaryText({ fields: [], item: rule })).toBe(
      "Match all: Monitor Name contains “api”",
    );
  });
});
