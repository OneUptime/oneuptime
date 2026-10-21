import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source-pinning tests for a Logs monitor's Group By in the dashboard. The
 * App suite runs in plain Node, so the forms cannot be rendered here (the
 * input itself is render-tested in Common's LogMonitorGroupBy.test.tsx);
 * these pin the wiring around it:
 *
 *   - the log monitor form saves the field the worker and the evaluator
 *     read (`groupByAttributes`), through the group-by input, offering the
 *     project's log attribute keys;
 *   - the criteria form hands the group keys to the template-variables
 *     list, so `{{con_name}}` is offered where titles are written.
 */

const COMPONENTS_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
);

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readComponent(...segments: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(COMPONENTS_ROOT, ...segments), "utf8"),
  );
}

const LOG_FORM_SOURCE: string = readComponent(
  "Form",
  "Monitor",
  "LogMonitor",
  "LogMonitorStepFrom.tsx",
);

const CRITERIA_FORM_SOURCE: string = readComponent(
  "Form",
  "Monitor",
  "MonitorCriteriaInstance.tsx",
);

describe("the log monitor form offers Group By", () => {
  test("it has a groupByAttributes field drawn by the group-by input", () => {
    const field: RegExpMatchArray | null = LOG_FORM_SOURCE.match(
      /field: \{\s*groupByAttributes: true,?\s*\}[\s\S]*?<LogGroupByAttributesInput[\s\S]*?\/>/,
    );

    expect(field).not.toBeNull();

    const fieldSource: string = (field as RegExpMatchArray)[0];

    expect(fieldSource).toMatch(
      /fieldType: FormFieldSchemaType\.CustomComponent/,
    );
    expect(fieldSource).toMatch(/title: "Group by Attributes"/);
    // Suggests the attribute keys the project's logs actually carry.
    expect(fieldSource).toMatch(/suggestions=\{props\.attributeKeys\}/);
    // And writes what it reports back into the form's value.
    expect(fieldSource).toMatch(
      /customElementProps\.onChange\?\.\(groupByAttributes\)/,
    );
  });

  test("it is not folded away with the filters", () => {
    const field: RegExpMatchArray | null = LOG_FORM_SOURCE.match(
      /field: \{\s*groupByAttributes: true,?\s*\}[\s\S]*?\n {10}\},/,
    );

    expect(field).not.toBeNull();
    expect((field as RegExpMatchArray)[0]).not.toMatch(/collapsibleSection/);
  });
});

describe("the criteria form offers the group values as template variables", () => {
  test("the series attribute keys include the log monitor's group keys", () => {
    expect(CRITERIA_FORM_SOURCE).toMatch(
      /const seriesAttributeKeys: Array<string> = Array\.from\([\s\S]*?MonitorStepLogMonitorUtil\.getGroupByAttributes\(\s*props\.monitorStep\?\.data\?\.logMonitor,?\s*\)/,
    );
  });
});
