import { DocsHeading, scanMarkdown } from "./DocsContentSupport";
import { FILTER_JSON_OPTIONS } from "Common/Utils/DeveloperDocs/TerraformMonitorSteps";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Terraform monitor-steps page, in English and Persian, against the
 * provider it documents.
 *
 * A Custom Code or Synthetic monitor's Result Value filter can compare one
 * field of the data the script returns (the dashboard's Field Path). The
 * provider takes it as custom_code_monitor_options, written with
 * jsonencode(). Markdown is not compiled, so these check the page names that
 * attribute (and every other raw-JSON filter option the provider has), that
 * its example only uses what the provider accepts, that the dashboard label
 * it points readers to is the one the dashboard shows in their language, and
 * that its link lands on the section explaining field paths.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);
const LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Locales",
);
const MONITOR_STEPS_GO: string = fs.readFileSync(
  path.join(REPO_ROOT, "Scripts/TerraformProvider/StaticFiles/monitorsteps.go"),
  "utf8",
);

const E2E_FIXTURE: string = path.join(
  REPO_ROOT,
  "packages/E2E/Terraform/e2e-tests/tests/57-custom-code-monitor-options/main.tf",
);

const PAGE: string = "terraform/monitor-steps";
const CUSTOM_CODE_PAGE: string = "monitor/custom-code-monitor";
// `fa` is the only translated docs corpus; every other language falls back to English.
const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

const HCL_BLOCK: RegExp = /```hcl\n([\s\S]*?)\n```/g;
// `check_on = "Result Value"` - an attribute assignment on one line.
const HCL_ASSIGNMENT: RegExp = /^\s*([a-z_]+)\s+= (.+)$/;
// `"Result Value",` - an entry of a Go string list.
const GO_STRING_ITEM: RegExp = /^\s*"([^"]+)",$/;
const GO_ATTR_TYPE: RegExp = /"([a-z_]+)":\s+types\.[A-Za-z0-9]+/g;
const LINK: RegExp = /\]\((\/docs\/[^)#\s]+)(?:#([^)\s]+))?\)/g;
const TRAILING_PARENTHETICAL: RegExp = /\s*\([^)]*\)\s*$/;
// The padding terraform fmt puts before `=` to line a block's attributes up.
const ASSIGNMENT_PADDING: RegExp = /\s+=\s+/;

// One line of HCL without its indentation or the padding before its `=`.
function normalizeHclLine(line: string): string {
  return line.trim().replace(ASSIGNMENT_PADDING, " = ");
}

function readPage(relative: string, language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${relative}.md`),
    "utf8",
  );
}

function hclBlocks(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(HCL_BLOCK)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The page's worked example of custom_code_monitor_options.
function customCodeExample(language: string): string {
  const examples: Array<string> = hclBlocks(readPage(PAGE, language)).filter(
    (block: string): boolean => {
      return block.includes("custom_code_monitor_options");
    },
  );

  expect({ language, examples: examples.length }).toEqual({
    language,
    examples: 1,
  });

  return examples[0] as string;
}

// The entries of a Go `var name = []string{ ... }` list in monitorsteps.go.
function goStringList(name: string): Array<string> {
  const start: number = MONITOR_STEPS_GO.indexOf(`var ${name} = []string{`);

  expect({ name, found: start >= 0 }).toEqual({ name, found: true });

  const end: number = MONITOR_STEPS_GO.indexOf("\n}\n", start);

  return MONITOR_STEPS_GO.slice(start, end)
    .split("\n")
    .map((line: string): string | null => {
      const match: RegExpMatchArray | null = line.match(GO_STRING_ITEM);
      return match ? (match[1] as string) : null;
    })
    .filter((value: string | null): value is string => {
      return value !== null;
    });
}

// The attributes of the provider's filter (monitorStepsFilterAttrTypes).
function providerFilterAttributes(): Array<string> {
  const start: number = MONITOR_STEPS_GO.indexOf(
    "func monitorStepsFilterAttrTypes()",
  );
  const end: number = MONITOR_STEPS_GO.indexOf("\n}\n", start);

  return Array.from(
    MONITOR_STEPS_GO.slice(start, end).matchAll(GO_ATTR_TYPE),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

// The lines of the example's `filters = [ ... ]` list.
function filterLines(example: string): Array<string> {
  const lines: Array<string> = example.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === "filters = [";
  });

  expect(start).toBeGreaterThan(-1);

  const indent: string = (lines[start] as string).replace("filters = [", "");
  const end: number = lines.findIndex(
    (line: string, index: number): boolean => {
      return index > start && line === `${indent}]`;
    },
  );

  return lines.slice(start + 1, end);
}

// A page's headings, in order, as the docs renderer anchors them.
function headings(relative: string, language: string): Array<DocsHeading> {
  return scanMarkdown(readPage(relative, language)).headings;
}

function dashboardLabel(language: string, key: string): string {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
  const label: string | undefined = locale[key];

  expect({ language, key, translated: Boolean(label) }).toEqual({
    language,
    key,
    translated: true,
  });

  return (label as string).replace(TRAILING_PARENTHETICAL, "");
}

describe("the Terraform monitor-steps page", () => {
  it("names every raw-JSON filter option the provider has, in every language", () => {
    expect(
      FILTER_JSON_OPTIONS.map(
        (option: { attributeName: string; apiKey: string }): string => {
          return option.attributeName;
        },
      ),
    ).toContain("custom_code_monitor_options");

    for (const language of LANGUAGES) {
      const markdown: string = readPage(PAGE, language);

      for (const option of FILTER_JSON_OPTIONS) {
        expect({
          language,
          option: option.attributeName,
          named: markdown.includes(`\`${option.attributeName}\``),
        }).toEqual({ language, option: option.attributeName, named: true });
      }
    }
  });

  it("says in the check_on table which monitors take custom_code_monitor_options", () => {
    for (const language of LANGUAGES) {
      const row: string | undefined = readPage(PAGE, language)
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("| Custom Code / Synthetic |");
        });

      expect({ language, row: Boolean(row) }).toEqual({ language, row: true });
      expect(row).toContain("`Result Value`");
      expect(row).toContain("`custom_code_monitor_options`");
      expect(row).toContain('`jsonencode({ resultValuePath = "status" })`');
    }
  });

  it("gives the same worked example in every language", () => {
    const english: string = customCodeExample("en");

    for (const language of LANGUAGES) {
      expect(customCodeExample(language)).toBe(english);
    }
  });

  it("shows a Custom Code monitor's step: its script and Result Value filters with field paths", () => {
    const example: string = customCodeExample("en");

    expect(example).toContain("custom_code = <<-EOT");
    expect(example).toContain("return { data: response.data };");
    expect(example).toContain(
      'custom_code_monitor_options = jsonencode({ resultValuePath = "status" })',
    );
    // A path into an array, too.
    expect(example).toContain(
      'custom_code_monitor_options = jsonencode({ resultValuePath = "checks[0].latency" })',
    );
    // A heredoc script must not start a Terraform template.
    expect(example).not.toContain("${");
    expect(example).not.toContain("%{");
  });

  it("only uses filter attributes and values the provider accepts", () => {
    const attributes: Array<string> = providerFilterAttributes();
    const checkOnValues: Array<string> = goStringList(
      "monitorStepsCheckOnValues",
    );
    const filterTypeValues: Array<string> = goStringList(
      "monitorStepsFilterTypeValues",
    );

    expect(attributes).toContain("custom_code_monitor_options");
    expect(checkOnValues).toContain("Result Value");

    const assignments: Array<[string, string]> = filterLines(
      customCodeExample("en"),
    )
      .map((line: string): [string, string] | null => {
        const match: RegExpMatchArray | null = line.match(HCL_ASSIGNMENT);
        return match ? [match[1] as string, match[2] as string] : null;
      })
      .filter((entry: [string, string] | null): entry is [string, string] => {
        return entry !== null;
      });

    expect(assignments.length).toBe(8);

    for (const [name, value] of assignments) {
      expect({ name, known: attributes.includes(name) }).toEqual({
        name,
        known: true,
      });

      if (name === "check_on") {
        expect(checkOnValues).toContain(JSON.parse(value));
      }

      if (name === "filter_type") {
        expect(filterTypeValues).toContain(JSON.parse(value));
      }

      if (name === "value") {
        // Filter values are strings, even numbers.
        expect(typeof JSON.parse(value)).toBe("string");
      }

      if (name === "custom_code_monitor_options") {
        expect(value.startsWith("jsonencode({ resultValuePath = ")).toBe(true);
      }
    }
  });

  /*
   * The Terraform E2E suite applies these exact filters to a real
   * OneUptime (tests/57-custom-code-monitor-options), checks the server kept
   * each path, and requires a clean plan and import afterwards - so the
   * example is known to work, not only to look right.
   */
  it("shows filters the Terraform E2E suite applies", () => {
    const fixtureLines: Array<string> = fs
      .readFileSync(E2E_FIXTURE, "utf8")
      .split("\n")
      .map(normalizeHclLine);
    const exampleLines: Array<string> = filterLines(customCodeExample("en"))
      .map(normalizeHclLine)
      .filter((line: string): boolean => {
        return HCL_ASSIGNMENT.test(line);
      });

    expect(exampleLines.length).toBe(8);

    // Each filter of the example (four attributes) is in the fixture, in order.
    for (let start: number = 0; start < exampleLines.length; start += 4) {
      const filter: Array<string> = exampleLines.slice(start, start + 4);
      const found: boolean = fixtureLines.some(
        (_line: string, index: number): boolean => {
          return filter.every((expected: string, offset: number): boolean => {
            return fixtureLines[index + offset] === expected;
          });
        },
      );

      expect({ filter, inFixture: found }).toEqual({ filter, inFixture: true });
    }
  });

  it("calls the field path what the dashboard calls it, in the reader's language", () => {
    for (const language of LANGUAGES) {
      const label: string = dashboardLabel(language, "Field Path (Optional)");

      expect({
        language,
        label,
        named: readPage(PAGE, language).includes(`**${label}**`),
      }).toEqual({ language, label, named: true });
    }
  });

  /*
   * The Custom Code page of the reader's language has the English page's
   * headings in the English order, so the section is the heading in the
   * English section's place, anchored as that language words it.
   */
  it("links to the section that explains field paths and conditions", () => {
    const english: Array<DocsHeading> = headings(CUSTOM_CODE_PAGE, "en");
    const place: number = english.findIndex(
      (heading: DocsHeading): boolean => {
        return heading.text === "Alerting on the returned data";
      },
    );

    expect(place).toBeGreaterThan(-1);

    for (const language of LANGUAGES) {
      const translated: Array<DocsHeading> = headings(
        CUSTOM_CODE_PAGE,
        language,
      );
      const links: Array<string> = Array.from(
        readPage(PAGE, language).matchAll(LINK),
      )
        .filter((match: RegExpMatchArray): boolean => {
          return match[1] === `/docs/${CUSTOM_CODE_PAGE}`;
        })
        .map((match: RegExpMatchArray): string => {
          return match[2] || "";
        });

      expect({ language, headings: translated.length }).toEqual({
        language,
        headings: english.length,
      });
      expect({ language, links }).toEqual({
        language,
        links: [(translated[place] as DocsHeading).slug],
      });
    }
  });

  it("is linked from the Custom Code page's field path list, at its own section", () => {
    const english: Array<DocsHeading> = headings(PAGE, "en");
    const place: number = english.findIndex(
      (heading: DocsHeading): boolean => {
        return heading.text === "Comparing one field of a script's result";
      },
    );

    expect(place).toBeGreaterThan(-1);

    for (const language of LANGUAGES) {
      const section: DocsHeading = headings(PAGE, language)[
        place
      ] as DocsHeading;
      const links: Array<string> = Array.from(
        readPage(CUSTOM_CODE_PAGE, language).matchAll(LINK),
      )
        .filter((match: RegExpMatchArray): boolean => {
          return match[1] === `/docs/${PAGE}`;
        })
        .map((match: RegExpMatchArray): string => {
          return match[2] || "";
        });

      expect({ language, links }).toEqual({
        language,
        links: [section.slug],
      });
    }
  });
});
