import { CUSTOM_FIELDS_COLUMN } from "Common/Types/Workflow/CustomFieldsColumn";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * https://github.com/OneUptime/oneuptime/issues/4469 had two halves, and the
 * English workflow guides now describe both as the runner does them:
 *
 *   - the Update components merge the custom fields they write into what a
 *     record holds: the Working with records section of the components guide
 *     says so, with an example that can be pasted, and says how to clear one
 *     and how to clear them all;
 *   - a reference in a JSON field is filled in for where it stands - text
 *     inside quotes, the value itself on its own - which the variables guide
 *     spells out, with examples whose references name blocks the guide itself
 *     introduces.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en/workflows",
);

const COMPONENTS_GUIDE: string = fs.readFileSync(
  path.join(CONTENT_DIR, "components.md"),
  "utf8",
);

const VARIABLES_GUIDE: string = fs.readFileSync(
  path.join(CONTENT_DIR, "variables.md"),
  "utf8",
);

// The text of one "## " section, up to the next one.
function section(guide: string, heading: string): string {
  const start: number = guide.indexOf(`\n## ${heading}\n`);

  expect(start).toBeGreaterThan(-1);

  const end: number = guide.indexOf("\n## ", start + 1);

  return guide.slice(start, end === -1 ? undefined : end);
}

// The paragraph about custom fields in the Working with records section.
function customFieldsPassage(): string {
  const records: string = section(COMPONENTS_GUIDE, "Working with records");
  const start: number = records.indexOf("**Custom fields**");

  expect(start).toBeGreaterThan(-1);

  const end: number = records.indexOf("\n**Skip**", start);

  return records.slice(start, end === -1 ? undefined : end);
}

describe("the components guide on custom fields", () => {
  test("names the column the Update components merge into", () => {
    expect(customFieldsPassage()).toContain(`\`${CUSTOM_FIELDS_COLUMN}\``);
  });

  test("says only the custom fields named change", () => {
    const passage: string = customFieldsPassage();

    expect(passage).toContain("change only the custom fields you name");
    expect(passage).toContain("every other one keeps its value");
  });

  test("says how to clear one and how to clear them all", () => {
    const passage: string = customFieldsPassage();

    expect(passage).toContain("Set a custom field to `null` to clear it");
    expect(passage).toContain(
      `set \`${CUSTOM_FIELDS_COLUMN}\` itself to \`null\` to clear them all`,
    );
  });

  test("its example is a Data object that sets one custom field", () => {
    const fence: RegExpMatchArray | null = customFieldsPassage().match(
      /```json\n([\s\S]*?)\n```/,
    );

    expect(fence).not.toBeNull();

    const data: JSONObject = JSON.parse(fence![1]!) as JSONObject;

    expect(Object.keys(data)).toEqual([CUSTOM_FIELDS_COLUMN]);
    expect(Object.keys(data[CUSTOM_FIELDS_COLUMN] as JSONObject)).toHaveLength(
      1,
    );
  });

  test("says the API still writes the column whole", () => {
    expect(customFieldsPassage()).toContain(
      `the OneUptime API writes \`${CUSTOM_FIELDS_COLUMN}\` whole`,
    );
  });
});

describe("the variables guide on references in JSON fields", () => {
  const passage: string = section(VARIABLES_GUIDE, "Where variables work");

  test("says a reference inside quotes is text, escaped", () => {
    expect(passage).toContain("**Inside quotes, it's text.**");
    expect(passage).toContain(
      "Quotes, backslashes and line breaks in the value are escaped",
    );
  });

  test("says a reference on its own is the value itself", () => {
    expect(passage).toContain("**On its own, it's the value itself.**");
    expect(passage).toContain("drops in the whole object");
  });

  test("its examples read blocks the guide introduces", () => {
    const references: Array<string> = Array.from(
      passage.matchAll(/\{\{local\.components\.([a-z0-9-]+)\.returnValues\./g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(references.length).toBeGreaterThanOrEqual(2);

    for (const componentId of references) {
      // Introduced elsewhere in the guide, as a block with that ID.
      expect(
        VARIABLES_GUIDE.split(passage).join("").includes(`\`${componentId}\``),
      ).toBe(true);
    }
  });

  test("its examples are JSON once their references are filled in", () => {
    const examples: Array<string> = Array.from(
      passage.matchAll(/`(\{"[^`]+\})`/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(examples.length).toBeGreaterThanOrEqual(2);

    for (const example of examples) {
      const filledIn: string = example
        .replace(/"([^"]*)\{\{[^}]+\}\}([^"]*)"/g, '"$1x$2"')
        .replace(/\{\{[^}]+\}\}/g, "{}");

      expect(() => {
        return JSON.parse(filledIn);
      }).not.toThrow();
    }
  });
});
