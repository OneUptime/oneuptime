import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * A customer sees their project's data residency in Settings > Project, on
 * the Project Details card next to the project's name and id - but only when
 * OneUptime staff have set one, and only on a server that bills. A project
 * with no residency must show no row at all, not an empty one.
 *
 * The decision itself (billing on AND a non-blank value) is
 * DataResidencyUtil.shouldShowInProjectSettings, unit tested in Common. What
 * this pins is that the page actually defers to it, on the right card, and
 * does not let the customer edit a value only staff may set. App's jest
 * environment is "node" with no React render harness, so like the sibling
 * wiring suites it asserts against the source text.
 */

const DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const projectSettingsSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(DASHBOARD_SRC, "Pages/Settings/ProjectSettings.tsx"),
    "utf8",
  ),
);

/* The Project Details card: everything before the customer support card. */
const projectDetailsCard: string =
  projectSettingsSource
    .split('name="Project Details"')[1]
    ?.split('name="Enable Customer Support Access"')[0] || "";

const formFields: string =
  projectDetailsCard.split("formFields={[")[1]?.split("modelDetailProps")[0] ||
  "";

const detailFields: string =
  projectDetailsCard.split("modelDetailProps={{")[1] || "";

/* The data residency row, from its field descriptor to the end of the list. */
const dataResidencyRow: string =
  detailFields.split("dataResidency: true")[1]?.split("modelId:")[0] || "";

describe("Settings > Project > Project Details", () => {
  test("the card and its sections are where this test thinks they are", () => {
    // Guards the guard: a restructured page must fail loudly, not vacuously.
    expect(projectDetailsCard.trim()).not.toBe("");
    expect(formFields.trim()).not.toBe("");
    expect(detailFields.trim()).not.toBe("");
    expect(dataResidencyRow.trim()).not.toBe("");
  });

  test("shows the data residency on the same card as the project id and name", () => {
    expect(detailFields).toContain("_id: true");
    expect(detailFields).toContain("name: true");
    expect(detailFields).toContain("dataResidency: true");
  });

  test("lists it after the project id and name", () => {
    const idIndex: number = detailFields.indexOf("_id: true");
    const nameIndex: number = detailFields.indexOf("name: true");
    const residencyIndex: number = detailFields.indexOf("dataResidency: true");

    expect(idIndex).toBeLessThan(nameIndex);
    expect(nameIndex).toBeLessThan(residencyIndex);
  });

  test("labels the row 'Data Residency', matching the Admin Dashboard", () => {
    expect(dataResidencyRow).toContain('title: "Data Residency"');
  });

  test("renders it as text", () => {
    expect(dataResidencyRow).toContain("fieldType: FieldType.Text");
  });

  /*
   * The column's update access is empty, so a customer's save would 400 if
   * the field were in the form - and more to the point, the residency is not
   * the customer's to choose.
   */
  test("does not put it in the customer's edit form", () => {
    expect(formFields).toContain("name: true");
    expect(formFields).not.toContain("dataResidency");
  });

  test("still lets the customer rename the project", () => {
    expect(projectDetailsCard).toContain("isEditable={true}");
    expect(formFields).toContain('title: "Project Name"');
  });
});

describe("hiding the row when there is nothing to show", () => {
  test("the row is conditional", () => {
    expect(dataResidencyRow).toContain("showIf:");
  });

  test("the condition is the shared rule, not a hand-rolled check", () => {
    expect(dataResidencyRow).toContain(
      "DataResidencyUtil.shouldShowInProjectSettings(",
    );
    expect(projectSettingsSource).toContain(
      'import DataResidencyUtil from "Common/Utils/Project/DataResidency"',
    );
  });

  test("the rule is given the server's billing flag", () => {
    expect(dataResidencyRow).toContain("isBillingEnabled: BILLING_ENABLED");
    expect(projectSettingsSource).toContain(
      'import { BILLING_ENABLED } from "Common/UI/Config"',
    );
  });

  test("the rule is given the loaded project's residency", () => {
    expect(dataResidencyRow).toMatch(
      /showIf: \(project: Project\): boolean => \{[\s\S]*dataResidency: project\.dataResidency/,
    );
  });

  /*
   * A placeholder would render "-" (or whatever it says) for a project with
   * no residency - exactly the empty row this feature must not show.
   */
  test("there is no placeholder that would stand in for a missing value", () => {
    expect(dataResidencyRow).not.toContain("placeholder");
  });

  test("the whole card is not gated on billing, so self-hosted projects still see their name and id", () => {
    const beforeCard: string =
      projectSettingsSource.split('name="Project Details"')[0] || "";

    expect(beforeCard.slice(-200)).not.toContain("BILLING_ENABLED");
  });
});
