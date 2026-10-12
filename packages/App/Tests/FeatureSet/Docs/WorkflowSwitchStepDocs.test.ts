import { readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import slugify from "Common/Server/Types/MarkdownSlugify";
import ComponentMetadata, {
  Argument,
  Port,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Components from "Common/Types/Workflow/Components";
import { ConditionComparisonId } from "Common/Types/Workflow/Components/ConditionComparison";
import {
  MAX_SWITCH_CASES,
  SWITCH_DEFAULT_PORT,
} from "Common/Types/Workflow/Components/Switch";
import {
  SwitchCase,
  describeSwitchEvaluation,
  evaluateSwitch,
  getSwitchCaseLabel,
} from "Common/Types/Workflow/Components/SwitchCases";
import { WorkflowDocsPaths } from "Common/Types/Workflow/Documentation/DocumentationLinks";
import {
  ADD_CASE_LABEL,
  CASES_LABEL,
} from "Common/UI/Components/Workflow/Switch/SwitchModel";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Switch / Case step's section of the workflow Components guide.
 *
 * The step's "How to use" help links to the section by anchor, and the docs
 * answer in the reader's language, so every language has it, under the
 * step's English name. Each copy names the step's settings and its Default
 * output as the step does, its buttons as that language's Dashboard draws
 * them, and quotes the line a run's Steps tab shows as the runner writes it.
 * The English section is held to the limit, the output names and the run
 * line the code really produces.
 */

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const PAGE: string = "workflows/components";
const HEADING: string = "## Switch / Case";
const LINK: string = "[Switch / Case](#switch-case)";

const SWITCH_EDITOR_SOURCE: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../Common/UI/Components/Workflow/Switch/SwitchEditor.tsx",
  ),
  "utf8",
);

const SWITCH: ComponentMetadata = (Components as Array<ComponentMetadata>).find(
  (component: ComponentMetadata): boolean => {
    return component.id === ComponentID.Switch;
  },
) as ComponentMetadata;

type HeadingsFunction = (markdown: string) => Array<string>;

// A page's "## " headings, in order.
const headings: HeadingsFunction = (markdown: string): Array<string> => {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("## ");
    })
    .map((line: string): string => {
      return line.substring(3).trim();
    });
};

type SectionFunction = (markdown: string) => string;

// The text under "## Switch / Case", up to the next "## " heading.
const switchSection: SectionFunction = (markdown: string): string => {
  const start: number = markdown.indexOf(`\n${HEADING}\n`);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.substring(start + HEADING.length + 2);
  const end: number = rest.indexOf("\n## ");

  return end === -1 ? rest : rest.substring(0, end);
};

type LinesFunction = (markdown: string, needle: string) => Array<string>;

const linesWith: LinesFunction = (
  markdown: string,
  needle: string,
): Array<string> => {
  return markdown.split("\n").filter((line: string): boolean => {
    return line.includes(needle);
  });
};

// The two cases of the example: production first, then staging.
const EXAMPLE_CASES: Array<SwitchCase> = [
  {
    id: "case-1",
    comparison: ConditionComparisonId.EqualTo,
    value: "production",
    compareAs: "",
  },
  {
    id: "case-2",
    comparison: ConditionComparisonId.EqualTo,
    value: "staging",
    compareAs: "",
  },
];

// What a run of those cases with "staging" says in its Steps tab.
const EXAMPLE_REASON: string = describeSwitchEvaluation({
  evaluation: evaluateSwitch({
    valueToCheck: "staging",
    cases: EXAMPLE_CASES,
  }),
  configuredCases: EXAMPLE_CASES,
});

describe("the Switch / Case section of the Components guide", () => {
  test("is where the step's help links to", () => {
    expect(WorkflowDocsPaths.switchCase).toBe(
      "/workflows/components#switch-case",
    );
    expect(slugify("Switch / Case")).toBe("switch-case");
  });

  test("is in every language, under the step's own name, right after Conditions", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(17);

    for (const language of LANGUAGES) {
      const all: Array<string> = headings(readPage(language, PAGE));
      const at: number = all.indexOf("Switch / Case");

      expect({
        language,
        before: all[at - 1],
        after: all[at + 1],
        anchor: slugify(all[at] || ""),
      }).toEqual({
        language,
        before: "Conditions",
        after: "Sleep",
        anchor: "switch-case",
      });
    }
  });

  test("names the step's settings and its Default output as the step does, in every language", () => {
    const settings: Array<string> = (SWITCH.arguments as Array<Argument>).map(
      (argument: Argument): string => {
        return argument.name;
      },
    );
    const outputs: Array<string> = (SWITCH.outPorts as Array<Port>).map(
      (port: Port): string => {
        return port.title;
      },
    );

    expect(SWITCH.title).toBe("Switch / Case");
    expect(settings).toEqual(["Value to check", CASES_LABEL]);
    expect(outputs).toEqual([SWITCH_DEFAULT_PORT.title]);

    for (const language of LANGUAGES) {
      const section: string = switchSection(readPage(language, PAGE));

      for (const name of [...settings, ...outputs, SWITCH.title, "Yes"]) {
        expect({
          language,
          name,
          named: section.includes(`**${name}**`),
        }).toEqual({ language, name, named: true });
      }

      // A table row for each setting, in the order the settings show them.
      expect({
        language,
        rows: section
          .split("\n")
          .filter((line: string): boolean => {
            return line.startsWith("| **");
          })
          .map((line: string): string => {
            return line.substring(2, line.indexOf("**", 4) + 2);
          }),
      }).toEqual({
        language,
        rows: settings.map((name: string): string => {
          return `**${name}**`;
        }),
      });
    }
  });

  test("names the buttons as each language's Dashboard draws them", () => {
    // The settings draw these, through the translator.
    expect(ADD_CASE_LABEL).toBe("Add case");
    expect(SWITCH_EDITOR_SOURCE).toContain("title={ADD_CASE_LABEL}");
    expect(SWITCH_EDITOR_SOURCE).toContain('title="Put back"');

    for (const language of LANGUAGES) {
      const section: string = switchSection(readPage(language, PAGE));

      for (const label of [
        "Add Component",
        "Popular",
        ADD_CASE_LABEL,
        "Put back",
        "Compare as",
        "Steps",
      ]) {
        const drawn: string = drawnDashboardLabel(language, label);

        expect({
          language,
          label,
          named: section.includes(`**${drawn}**`),
        }).toEqual({ language, label, named: true });
      }

      // Every locale words the new buttons; none is left in English.
      if (language !== "en") {
        for (const label of [ADD_CASE_LABEL, "Put back"]) {
          expect({
            language,
            label,
            drawn: drawnDashboardLabel(language, label),
          }).not.toEqual({ language, label, drawn: label });
        }
      }
    }
  });

  test("quotes the line a run's Steps tab shows, as the runner writes it, in every language", () => {
    expect(EXAMPLE_REASON).toBe(
      "Case 2 matched: the value is equal to “staging”. Case 1 did not.",
    );

    for (const language of LANGUAGES) {
      const section: string = switchSection(readPage(language, PAGE));

      expect({
        language,
        quoted: section.includes(`*${EXAMPLE_REASON}*`),
      }).toEqual({ language, quoted: true });
    }
  });

  test("names the outputs of its example as the canvas draws them, in every language", () => {
    const equalTo: string = getSwitchCaseLabel(
      {
        id: "case-1",
        comparison: ConditionComparisonId.EqualTo,
        value: "production",
        compareAs: "",
      },
      0,
    );
    const greaterThan: string = getSwitchCaseLabel(
      {
        id: "case-2",
        comparison: ConditionComparisonId.GreaterThan,
        value: "500",
        compareAs: "number",
      },
      1,
    );

    expect([equalTo, greaterThan]).toEqual([
      "production",
      "is greater than 500",
    ]);

    for (const language of LANGUAGES) {
      const section: string = switchSection(readPage(language, PAGE));

      for (const output of [equalTo, greaterThan]) {
        expect({
          language,
          output,
          named: section.includes(`*${output}*`),
        }).toEqual({ language, output, named: true });
      }

      for (const code of ["`production`", "`500`", "`{{`"]) {
        expect({ language, code, kept: section.includes(code) }).toEqual({
          language,
          code,
          kept: true,
        });
      }
    }
  });

  test("in English, says first match wins, gives the limit the step has, and that Default ending the run is no error", () => {
    const section: string = switchSection(readPage("en", PAGE));

    expect(MAX_SWITCH_CASES).toBe(25);
    expect(section).toContain(
      `A block holds at most ${MAX_SWITCH_CASES} cases.`,
    );
    expect(section).toContain(
      "Only one path runs: a value that matches two cases takes the first of them.",
    );
    expect(section).toContain(
      "A case matches exactly when an [If / Else](#conditions)",
    );
    expect(section).toContain("ends there without an error");
    expect(section).toContain(
      "Saving removes the connection along with the case.",
    );
  });

  test("links to If / Else, whose comparisons it shares, in every language", () => {
    for (const language of LANGUAGES) {
      const section: string = switchSection(readPage(language, PAGE));

      expect({
        language,
        linked: section.includes("[If / Else](#conditions)"),
      }).toEqual({ language, linked: true });
    }
  });
});

describe("the rest of the Components guide points to Switch / Case", () => {
  test("from the table of which component to use, in every language", () => {
    for (const language of LANGUAGES) {
      const rows: Array<string> = linesWith(
        readPage(language, PAGE),
        LINK,
      ).filter((line: string): boolean => {
        return line.startsWith("|");
      });

      expect({ language, rows: rows.length }).toEqual({ language, rows: 1 });
    }
  });

  test("from the outputs every block has, naming Default, in every language", () => {
    for (const language of LANGUAGES) {
      const bullets: Array<string> = linesWith(
        readPage(language, PAGE),
        LINK,
      ).filter((line: string): boolean => {
        return line.startsWith("- ");
      });

      expect({
        language,
        bullets: bullets.length,
        yesNo: (bullets[0] || "").includes("**Yes**"),
        default: (bullets[0] || "").includes(
          `**${SWITCH_DEFAULT_PORT.title}**`,
        ),
      }).toEqual({ language, bullets: 1, yesNo: true, default: true });
    }
  });

  test("from If / Else, for more than two paths, in every language", () => {
    for (const language of LANGUAGES) {
      const page: string = readPage(language, PAGE);
      const conditions: string = page.substring(
        page.indexOf("\n## Conditions\n"),
        page.indexOf(`\n${HEADING}\n`),
      );
      const intro: Array<string> = linesWith(conditions, "**If / Else**");

      expect({
        language,
        linked: (intro[0] || "").includes(LINK),
      }).toEqual({ language, linked: true });
    }
  });
});
