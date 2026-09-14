import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The monitor-create form is declared inline in a page component, while the
 * App test suite runs in a plain Node environment with no renderer. These
 * source invariants cover the load-bearing form wiring in the same style as
 * MonitorProbeSelectionPages.test.ts.
 *
 * Labels must be a real Monitor relation rather than misc form data, and the
 * dedicated step must remain last for every monitor type. The latter matters
 * especially for Manual monitors, which skip both conditional middle steps.
 */

const MONITOR_CREATE_SOURCE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Monitor",
  "Create.tsx",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/*
 * Prose is removed before anything below is matched against the page, the way
 * the siblings that read this same file already do it (stripComments in
 * MonitorCreateNetworkDeviceDeepLink.test.ts, readCode in
 * MonitorTemplateCustomFieldDefaults.test.ts). This page explains itself at
 * length, and once whitespace is squashed a comment is indistinguishable from
 * the code around it: with comments left in, deleting `labels: true` from the
 * template read and writing the words "labels: true" in a comment above the
 * call kept every assertion in this file green, so the file went on passing
 * while the behaviour it exists to guard was gone. The `[^:]` guard keeps a
 * `https://` inside a string literal from being read as the start of a line
 * comment. Whitespace is squashed afterwards so prettier re-wrapping the page
 * cannot turn a real regression check into a formatting failure.
 */
function readMonitorCreateSource(): string {
  return squash(
    fs
      .readFileSync(MONITOR_CREATE_SOURCE_PATH, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1"),
  );
}

const source: string = readMonitorCreateSource();

function sourceBetween(startMarker: string, endMarker: string): string {
  const start: number = source.indexOf(startMarker);
  const end: number = source.indexOf(endMarker, start + startMarker.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start + startMarker.length, end);
}

/*
 * The balanced `{ ... }` text that starts at `openIndex`, so an assertion can
 * be scoped to ONE object rather than to a whole file that contains many
 * lookalikes. Brace matched rather than regex matched because these literals
 * nest: a `select` can carry a nested select for a related model.
 */
function balancedBlockAt(text: string, openIndex: number): string | null {
  let depth: number = 0;

  for (let index: number = openIndex; index < text.length; index++) {
    const character: string = text.charAt(index);

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return text.slice(openIndex, index + 1);
      }
    }
  }

  return null;
}

/*
 * The argument object of every ModelAPI.getItem call in `code`, in the shape
 * MonitorTemplateCustomFieldDefaults.test.ts reads the same page with, so that
 * a read is picked out by what it asks for rather than by being the first one
 * in the function. Fetching something else ahead of the template — the project
 * that owns it, say — is a benign refactor, and "the object after the first
 * ModelAPI.getItem" would report that refactor as a missing template read.
 */
function getItemArguments(code: string): Array<string> {
  const marker: RegExp =
    /(?<![A-Za-z0-9_$])ModelAPI\.getItem(?:<[^>]*>)?\(\s*\{/g;
  const calls: Array<string> = [];

  let match: RegExpExecArray | null = marker.exec(code);

  while (match !== null) {
    const openIndex: number = code.indexOf("{", match.index);
    const call: string | null = balancedBlockAt(code, openIndex);

    if (call === null) {
      break;
    }

    calls.push(call);
    marker.lastIndex = openIndex + call.length;
    match = marker.exec(code);
  }

  return calls;
}

/*
 * Matched on the whole model name, so a future MonitorTemplateSomething read
 * cannot answer for the template read this test is about.
 */
const MONITOR_TEMPLATE_READ: RegExp =
  /(?<![A-Za-z0-9_$])modelType:\s*MonitorTemplate(?![A-Za-z0-9_$])/;

function monitorTemplateReads(code: string): Array<string> {
  return getItemArguments(code).filter((call: string): boolean => {
    return MONITOR_TEMPLATE_READ.test(call);
  });
}

/*
 * The `select` literal inside one read's arguments, keyed on the whole word so
 * a longer key that happens to end in "select" cannot be taken for it.
 */
function selectOf(call: string): string | null {
  const match: RegExpMatchArray | null = call.match(
    /(?<![A-Za-z0-9_$])select\s*:\s*\{/,
  );

  if (match === null || match.index === undefined) {
    return null;
  }

  return balancedBlockAt(call, call.indexOf("{", match.index));
}

/*
 * Whether `select` asks the API for `column`. Both spellings of a selected
 * relation count: `column: true`, and the nested `column: { ... }` form that
 * RelationSelectColumnsWiring.test.ts describes as the ordinary way a relation
 * is selected. Which of the two this page uses is the page's business, so
 * rewriting `labels: true` as `labels: { _id: true }` is a refactor that must
 * stay green — dropping the key, or turning it off with `false`, is the
 * regression. The leading boundary is what stops a neighbouring
 * `notLabels: true` from standing in for the key that was removed.
 */
function selectsColumn(select: string, column: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_$])${column}\\s*:\\s*(?:true|\\{)`).test(
    select,
  );
}

describe("Monitor create labels", () => {
  test("submits labels as the real Monitor.labels relation", () => {
    expect(source).toContain(squash("field: { labels: true, },"));

    /*
     * An override field is removed from the Monitor payload and sent through
     * miscDataProps instead. That is correct for probes, but would silently
     * prevent ModelForm from persisting the MonitorLabel join rows.
     */
    expect(source).not.toContain(squash("overrideField: { labels: true, },"));
    expect(source).not.toContain('overrideFieldKey: "labels"');
  });

  test("renders an optional Label-backed multi-select", () => {
    expect(source).toContain(
      squash(`
        field: {
          labels: true,
        },
        title: "Labels",
        stepId: "labels",
        description:
          "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: Label,
          labelField: "name",
          valueField: "_id",
        },
        required: false,
        placeholder: "Labels",
      `),
    );
  });

  test("keeps Labels as a dedicated unconditional final step", () => {
    const steps: string = sourceBetween("steps={[", "]} onBeforeCreate=");
    const intervalStepStart: number = steps.indexOf(
      squash(`
        title: "Probes & Interval",
        id: "monitoring-interval",
      `),
    );
    const labelsStep: string = squash(`
      {
        title: "Labels",
        id: "labels",
      },
    `);
    const labelsStepStart: number = steps.indexOf(labelsStep);

    expect(intervalStepStart).toBeGreaterThanOrEqual(0);
    expect(steps).toContain(
      squash(`
        showIf: (values: FormValues<Monitor>) => {
          return MonitorTypeHelper.doesMonitorTypeHaveInterval(
            values.monitorType as MonitorType,
          );
        },
      `),
    );
    expect(labelsStepStart).toBeGreaterThan(intervalStepStart);

    /*
     * An exact, showIf-free block at the end keeps Labels visible to Manual,
     * criteria-only, and probeable monitor types alike.
     */
    expect(steps.trim().endsWith(labelsStep)).toBe(true);
  });

  test("loads template labels and maps them into initial form values", () => {
    const templateLoader: string = sourceBetween(
      "const fetchMonitorTemplate:",
      "return (",
    );

    /*
     * Scoped to the arguments of the template read itself — the page issues
     * several other reads, each with a select of its own — and then asserted
     * one column at a time. What is load bearing is that this read ASKS the
     * API for these two columns; where they sit in the literal is not.
     * Pinning them as adjacent lines instead made every unrelated key added
     * to the read a failure, which is precisely what happened when
     * `customFields` joined it for the monitor template custom field defaults
     * (issue #3548).
     */
    const templateReads: Array<string> = monitorTemplateReads(templateLoader);

    expect(templateReads).toHaveLength(1);

    const templateSelect: string | null = selectOf(templateReads[0]!);

    expect(templateSelect).not.toBeNull();

    const readColumns: Array<string> = ["monitoringInterval", "labels"];

    for (const column of readColumns) {
      expect({
        column: column,
        isSelected: selectsColumn(templateSelect!, column),
      }).toEqual({ column: column, isSelected: true });
    }

    expect(templateLoader).toContain(
      squash(`
        labels: template.labels?.map((label: Label) => {
          return label.id!.toString();
        }),
      `),
    );
    expect(templateLoader).toContain("setInitialValues(values);");
  });

  test("explains the labels' access-control effect and optional nature", () => {
    expect(source).toContain(
      "Team members with access to these labels will only be able to access this resource.",
    );
    expect(source).toContain("This is optional and an advanced feature.");
  });
});
