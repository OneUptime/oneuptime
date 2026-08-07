import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The monitor-create form is declared inline in a page component, while the
 * App test suite runs in a plain Node environment with no renderer. These
 * source invariants cover the load-bearing form wiring in the same style as
 * MonitorProbeSelectionPages.test.ts. Whitespace is squashed first so prettier
 * re-wrapping cannot turn a real regression check into a formatting failure.
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

const source: string = squash(
  fs.readFileSync(MONITOR_CREATE_SOURCE_PATH, "utf8"),
);

function sourceBetween(startMarker: string, endMarker: string): string {
  const start: number = source.indexOf(startMarker);
  const end: number = source.indexOf(endMarker, start + startMarker.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start + startMarker.length, end);
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

    expect(templateLoader).toContain(
      squash(`
        monitoringInterval: true,
        labels: true,
      `),
    );
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
