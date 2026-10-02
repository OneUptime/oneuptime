import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  RULE_CRITERIA_STEP_ID,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";
import { replaceRuleCriteriaHelpMarkdown } from "../../../../UI/Components/RuleCriteria/RuleCriteriaModelTable";

/*
 * "Instead of saying 'incident title pattern,' we can just say 'incident
 * title,' so we can remove 'pattern' from the dropdown labels, so it is easier
 * for people to understand." - the maintainer, on the Criteria dropdown of a
 * rule's conditions.
 *
 * A condition's criteria are the titles of the fields on a rule form's
 * "match-criteria" step: the conditions builder lists those titles in its
 * Criteria dropdown and the rule table's summary repeats them. The operator
 * ("Matches pattern", "Is in") says how a value is compared, so a title names
 * only what is compared. This holds every rule form in the project to that,
 * and the help text people can see on those pages too.
 */

// packages/Common/Tests/UI/Components/RuleCriteria -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * What a criteria name must never say: the column's regex nature ("Pattern",
 * "Regex"), an operator folded into the name ("Host IP Is In"), or the verb
 * of the step it is on ("Match Labels").
 */
const RETIRED_NAME_SHAPES: Array<RegExp> = [
  /\bPattern\b/i,
  /\bRegex\b/i,
  /\bIs In\b/i,
  /^\W*Match\b/i,
];

function readsAsPlainName(title: string): boolean {
  return RETIRED_NAME_SHAPES.every((shape: RegExp): boolean => {
    return !shape.test(title);
  });
}

const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
);

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files,
});

const ruleForms: Array<FormFacts> = forms.filter((form: FormFacts): boolean => {
  return form.isRuleModel;
});

interface Criterion {
  form: FormFacts;
  field: FormFieldFacts;
}

const criteria: Array<Criterion> = ruleForms.flatMap(
  (form: FormFacts): Array<Criterion> => {
    return form.fields
      .filter((field: FormFieldFacts): boolean => {
        return field.stepId === RULE_CRITERIA_STEP_ID;
      })
      .map((field: FormFieldFacts): Criterion => {
        return { form, field };
      });
  },
);

function describeCriterion(criterion: Criterion): string {
  return `${criterion.field.file}:${criterion.field.line} ${criterion.form.label} - ${criterion.field.key}: "${criterion.field.title}"`;
}

function criteriaTitlesOf(file: string, formLabel: RegExp): Array<string> {
  return criteria
    .filter((criterion: Criterion): boolean => {
      return (
        criterion.form.file.endsWith(file) &&
        formLabel.test(criterion.form.label)
      );
    })
    .map((criterion: Criterion): string => {
      return criterion.field.title;
    });
}

describe("rule conditions name their criteria plainly", () => {
  // A broken walk must not pass by finding nothing.
  test("the scan really read the rule forms", () => {
    expect(ruleForms.length).toBeGreaterThan(60);
    expect(criteria.length).toBeGreaterThan(200);
  });

  test("every criterion has a title of its own", () => {
    const untitled: Array<string> = criteria
      .filter((criterion: Criterion): boolean => {
        return criterion.field.title.trim().length === 0;
      })
      .map(describeCriterion);

    expect(untitled).toEqual([]);
  });

  test("no criterion is named for its pattern, regex or operator", () => {
    const retired: Array<string> = criteria
      .filter((criterion: Criterion): boolean => {
        return !readsAsPlainName(criterion.field.title);
      })
      .map(describeCriterion);

    expect(retired).toEqual([]);
  });

  test("the guard itself tells the old names from the new ones", () => {
    for (const oldName of [
      "Incident Title Pattern",
      "Name Regex Pattern",
      "Messaging System Pattern",
      "Host IP Is In",
      "Match Labels",
      "Title Pattern",
    ]) {
      expect({ oldName, plain: readsAsPlainName(oldName) }).toEqual({
        oldName,
        plain: false,
      });
    }

    for (const newName of [
      "Incident Title",
      "Monitor Name",
      "Messaging System",
      "IP Address",
      "Resource Labels",
      "`${criteriaSubject} Title`",
    ]) {
      expect({ newName, plain: readsAsPlainName(newName) }).toEqual({
        newName,
        plain: true,
      });
    }
  });

  /*
   * The rule from the maintainer's screenshot, and its neighbours: every
   * incident rule lists the same criteria, in the same words.
   */
  test.each([
    "IncidentPrivacyRules.tsx",
    "IncidentLabelRules.tsx",
    "IncidentOwnerRules.tsx",
    "IncidentOnCallRules.tsx",
    "IncidentGroupingRules.tsx",
  ])("%s's incident rules list the plain incident criteria", (file: string) => {
    expect(
      criteriaTitlesOf(
        `Pages/Incidents/Settings/${file}`,
        /Incident (?!Episode)/,
      ),
    ).toEqual([
      "Monitors",
      "Incident Severities",
      "Incident Labels",
      "Monitor Labels",
      "Incident Title",
      "Incident Description",
      "Monitor Name",
      "Monitor Description",
    ]);
  });

  test("the alert rules say Alert where the incident rules say Incident", () => {
    expect(
      criteriaTitlesOf(
        "Pages/Alerts/Settings/AlertPrivacyRules.tsx",
        /Alert Privacy Rules$/,
      ),
    ).toEqual([
      "Monitors",
      "Alert Severities",
      "Alert Labels",
      "Monitor Labels",
      "Alert Title",
      "Alert Description",
      "Monitor Name",
      "Monitor Description",
    ]);
  });

  test("episode rules name the episode's title and description", () => {
    expect(
      criteriaTitlesOf(
        "Pages/Incidents/Settings/IncidentPrivacyRules.tsx",
        /Episode/,
      ),
    ).toEqual([
      "Incident Severities",
      "Episode Labels",
      "Episode Title",
      "Episode Description",
    ]);
  });

  test("scheduled maintenance rules say Event, like their Event Labels", () => {
    expect(
      criteriaTitlesOf(
        "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceLabelRules.tsx",
        /./,
      ),
    ).toEqual([
      "Monitors",
      "Event Labels",
      "Monitor Labels",
      "Event Title",
      "Event Description",
      "Monitor Name",
      "Monitor Description",
    ]);
  });

  test.each([
    ["Pages/Cloud/Settings/LabelRules.tsx", "Resource"],
    ["Pages/Rum/Settings/LabelRules.tsx", "Application"],
    ["Pages/Serverless/Settings/LabelRules.tsx", "Function"],
  ])(
    "%s names its criteria after what it matches",
    (file: string, subject: string) => {
      expect(criteriaTitlesOf(file, /./)).toEqual([
        `${subject} Labels`,
        `${subject} Name`,
        `${subject} Description`,
      ]);
    },
  );

  test("network discovery rules name the address and SNMP identity", () => {
    expect(
      criteriaTitlesOf("Pages/NetworkDevice/Settings/AutoImportRules.tsx", /./),
    ).toEqual([
      "IP Address",
      "System Name",
      "System Description",
      "System Object ID",
    ]);
    expect(
      criteriaTitlesOf("Pages/NetworkSite/AssignmentRules.tsx", /./),
    ).toEqual(["IP Address", "Hostname"]);
  });
});

/*
 * The help panel of a rule table rewrites its "Match Criteria" section to
 * describe the builder (RuleCriteriaModelTable), so only what lies outside
 * that section is read as written. That part must not name criteria the old
 * way either.
 */
function listTsxFiles(directory: string): Array<string> {
  const result: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      result.push(...listTsxFiles(entryPath));
    } else if (entry.name.endsWith(".tsx")) {
      result.push(entryPath);
    }
  }

  return result;
}

// A template literal that is help markdown: it has a heading.
const MARKDOWN_HEADING: RegExp = /^#{2,4} /m;

// A page whose form has a Match Criteria step.
const MATCH_CRITERIA_STEP: RegExp = /id\s*:\s*["']match-criteria["']/;

function markdownTemplates(source: string): Array<string> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    "Page.tsx",
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
      const text: string = node.getText(sourceFile).slice(1, -1);

      if (MARKDOWN_HEADING.test(text)) {
        result.push(text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}

// A bold criteria name that still carries its column's Pattern / Regex.
const RETIRED_BOLD_NAME: RegExp =
  /\*\*[^*\n]*(?:\bPattern\b|\bRegex\b|\bIs In\b|^Match Labels)[^*\n]*\*\*/;

describe("the help on rule pages names criteria plainly", () => {
  const rulePages: Array<string> = listTsxFiles(DASHBOARD_SOURCE).filter(
    (file: string): boolean => {
      return MATCH_CRITERIA_STEP.test(fs.readFileSync(file, "utf8"));
    },
  );

  test("the walk found the rule pages", () => {
    expect(rulePages.length).toBeGreaterThan(60);
  });

  test("what the help panel shows never names a Pattern criterion", () => {
    const stale: Array<string> = [];

    for (const file of rulePages) {
      for (const markdown of markdownTemplates(fs.readFileSync(file, "utf8"))) {
        const shown: string = replaceRuleCriteriaHelpMarkdown(markdown);

        for (const line of shown.split("\n")) {
          if (RETIRED_BOLD_NAME.test(line)) {
            stale.push(
              `${path.relative(DASHBOARD_SOURCE, file)}: ${line.trim()}`,
            );
          }
        }
      }
    }

    expect(stale).toEqual([]);
  });

  test("the check catches a stale name outside the rewritten section", () => {
    const shown: string = replaceRuleCriteriaHelpMarkdown(`
### How Rules Work

- **Title / Description Pattern** — case-insensitive regex

### Match Criteria

- **Monitor Name Pattern** — rewritten away
`);

    expect(
      shown.split("\n").filter((line: string): boolean => {
        return RETIRED_BOLD_NAME.test(line);
      }),
    ).toEqual(["- **Title / Description Pattern** — case-insensitive regex"]);
  });
});
