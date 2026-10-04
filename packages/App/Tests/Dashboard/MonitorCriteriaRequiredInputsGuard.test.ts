import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Holds the monitor criteria form to "ask only for what cannot be derived".
 *
 * Every criteria card used to open on two required inputs - "Criteria Name"
 * and "Criteria Description" - and every criteria list ended in a required
 * "Default Monitor Status" dropdown that was already filled in. Now the name
 * is made from the filters (and follows them), the description is optional
 * and folded under the criteria's Settings, and the default status sits in a
 * folded "Advanced" section that names the current choice on its header.
 *
 * The component tests (Common/Tests/App/Dashboard/MonitorCriteriaNameAndDescription
 * and MonitorStepsDefaultStatusAdvanced) prove the behaviour. This scan keeps
 * the shape: a later edit that puts a required description back above the
 * filters, adds criteria without a name, or lifts the default status out of
 * Advanced fails here with the reason, before anyone has to notice it in the
 * product.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");

const FORM_DIRECTORY: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Form",
  "Monitor",
);

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

const criteriaCard: string = read(
  path.join(FORM_DIRECTORY, "MonitorCriteriaInstance.tsx"),
);
const criteriaList: string = read(
  path.join(FORM_DIRECTORY, "MonitorCriteria.tsx"),
);
const criteriaSteps: string = read(
  path.join(FORM_DIRECTORY, "MonitorSteps.tsx"),
);
const criteriaType: string = read(
  path.join(
    PACKAGES,
    "Common",
    "Types",
    "Monitor",
    "MonitorCriteriaInstance.ts",
  ),
);

// The JSX element that starts at `start`, up to its closing "/>" or ">".
function elementAt(source: string, start: number): string {
  const selfClosing: number = source.indexOf("/>", start);
  return source.slice(start, selfClosing + 2);
}

// Every `<FieldLabelElement ... />` whose title is `title`.
function fieldLabels(source: string, title: string): Array<string> {
  const labels: Array<string> = [];
  let index: number = source.indexOf("<FieldLabelElement");

  while (index !== -1) {
    const element: string = elementAt(source, index);

    if (
      element.includes(`title={"${title}"}`) ||
      element.includes(`title="${title}"`)
    ) {
      labels.push(element);
    }

    index = source.indexOf("<FieldLabelElement", index + 1);
  }

  return labels;
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe("a criteria card asks for no prose up front", () => {
  test("there is no 'Criteria Description' field any more", () => {
    expect(criteriaCard).not.toContain("Criteria Description");
  });

  test("the description is one optional field, inside the Settings section", () => {
    const labels: Array<string> = fieldLabels(criteriaCard, "Description");

    expect(labels).toHaveLength(1);
    expect(labels[0]).not.toContain("required={true}");

    const settingsAt: number = criteriaCard.indexOf('title="Settings"');
    const descriptionAt: number = criteriaCard.indexOf(labels[0]!);

    expect(settingsAt).toBeGreaterThan(-1);
    expect(descriptionAt).toBeGreaterThan(settingsAt);
  });

  test("the name field never shows a 'Name is required' error of its own", () => {
    /*
     * A name left empty goes back to the one the filters give it, so the
     * card has nothing to complain about: no error state, and no error on
     * the name input.
     */
    expect(criteriaCard).not.toContain("setErrors(");

    const nameInputAt: number = criteriaCard.indexOf(
      'dataTestId="monitor-criteria-name-input"',
    );
    expect(nameInputAt).toBeGreaterThan(-1);

    const nameInput: string = elementAt(
      criteriaCard,
      criteriaCard.lastIndexOf("<Input", nameInputAt),
    );
    expect(nameInput).not.toContain("error=");
  });

  test("every change to the filters goes through the one place that keeps a generated name in step", () => {
    expect(countOf(criteriaCard, ".setFilters(")).toBe(1);
    expect(countOf(criteriaCard, ".setFilterCondition(")).toBe(1);

    const changeFiltersAt: number = criteriaCard.indexOf("const changeFilters");
    expect(changeFiltersAt).toBeGreaterThan(-1);
    expect(criteriaCard.indexOf(".setFilters(")).toBeGreaterThan(
      changeFiltersAt,
    );
    expect(criteriaCard).toContain(
      "CriteriaNameUtil.getNameAfterFiltersChange(",
    );
  });
});

describe("a criteria is added with a name", () => {
  test("Add Criteria names the new criteria after its filter", () => {
    const addCriteriaAt: number = criteriaList.indexOf('title="Add Criteria"');
    const nextButtonAt: number = criteriaList.indexOf(
      'title="Add Recommended Alerts"',
    );

    expect(addCriteriaAt).toBeGreaterThan(-1);
    expect(nextButtonAt).toBeGreaterThan(addCriteriaAt);

    expect(criteriaList.slice(addCriteriaAt, nextButtonAt)).toContain(
      "CriteriaNameUtil.getNameForCriteria(",
    );
  });

  test("the header still falls back to 'Unnamed Criteria'", () => {
    expect(criteriaList).toContain('"Unnamed Criteria"');
  });
});

describe("the default monitor status is folded under More fields", () => {
  test("its field is inside the More fields section", () => {
    const labels: Array<string> = fieldLabels(
      criteriaSteps,
      "Default Monitor Status",
    );

    expect(labels).toHaveLength(1);

    const advancedAt: number = criteriaSteps.indexOf(
      "title={MORE_FIELDS_SECTION_TITLE}",
    );
    const sectionOpenAt: number = criteriaSteps.lastIndexOf(
      "<FoldedSection",
      advancedAt,
    );
    const sectionCloseAt: number = criteriaSteps.indexOf(
      "</FoldedSection>",
      advancedAt,
    );
    const labelAt: number = criteriaSteps.indexOf(labels[0]!);

    expect(sectionOpenAt).toBeGreaterThan(-1);
    expect(labelAt).toBeGreaterThan(sectionOpenAt);
    expect(labelAt).toBeLessThan(sectionCloseAt);
  });

  test("the folded header says which status the monitor falls back to", () => {
    expect(criteriaSteps).toContain('"When no criteria match: {{status}}"');
    expect(criteriaSteps).toContain("summary={defaultMonitorStatusSummary}");
  });

  test("the divider that set the open field apart is gone", () => {
    expect(criteriaSteps).not.toContain("HorizontalRule");
  });
});

describe("the criteria type validates what a criteria cannot do without", () => {
  test("the description is never required", () => {
    expect(criteriaType).not.toContain("Description is required");
  });

  test("the name still is", () => {
    expect(criteriaType).toContain("Name is required for every criteria.");
  });
});
