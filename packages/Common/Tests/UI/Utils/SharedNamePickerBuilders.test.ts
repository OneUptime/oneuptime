import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY PICKER AND FILTER OF TEAMS, LABELS, ON-CALL POLICIES AND SCHEDULES
 * BUILDS ITS OPTIONS BY THE ONE RULE (#10064).
 *
 * Records named alike before names were held to one record each are told
 * apart where they are picked by Common/UI/Utils/SharedNameOptions: a read
 * selects what tells them apart (getSharedNameSelect), each option carries
 * its record's facts (getSharedNameFacts), and the component that draws the
 * options marks the twins (getSharedNameMarks). The options were built in
 * many places, each from its own read, so the rule is held here to every
 * one of them: a builder that stops reading the facts, or a drawer that
 * stops marking, fails, rather than quietly drawing twins alike again.
 */

const REPO: string = path.resolve(__dirname, "../../../../..");

const read: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(REPO, file), "utf8");
};

// The builders: each reads the facts and hands them to its options.
const BUILDERS: Array<string> = [
  // Every form's record field: its prefetch, and its own searches.
  "packages/Common/UI/Components/Forms/ModelForm.tsx",
  "packages/Common/UI/Components/EntityDropdown/EntityDropdown.tsx",
  // A list's filters.
  "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
  // Teams, schedules and policies picked as people are.
  "packages/Common/UI/Components/PeoplePicker/PeoplePickerKinds.ts",
  // Add Labels and Remove Labels.
  "packages/Common/UI/Components/BulkUpdate/BulkLabelActions.tsx",
  // The facet chips: Labels, and the Owner chip's teams.
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners.tsx",
  // A monitor's criteria: its on-call policies and labels.
  "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps.tsx",
  // Telemetry ingestion budgets by team or label.
  "packages/App/FeatureSet/Dashboard/src/Components/TelemetryIngestionBudget/TeamLabelBudgetsTable.tsx",
  // A recommended monitor's policies and labels.
  "packages/App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationProjectSetup.ts",
  // Setup Health's quick fix: the policy a new rule pages.
  "packages/App/FeatureSet/Dashboard/src/Components/SetupHealth/SetupHealthQuickFix.ts",
  // A dashboard's label filter.
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/EntityFilterDropdown.tsx",
];

// Builders whose options come from DropdownUtil, which reads the facts itself.
const SELECTS_ONLY: Array<string> = [
  "packages/App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceNotificationRulesTable.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTable.tsx",
];

// The components that draw the options: each marks the twins.
const DRAWERS: Array<string> = [
  "packages/Common/UI/Components/Dropdown/Dropdown.tsx",
  "packages/Common/UI/Components/EntityDropdown/EntityDropdown.tsx",
  "packages/Common/UI/Components/PeoplePicker/PeopleSearchPopup.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown.tsx",
];

describe("the builders of the four kinds' options", () => {
  test.each(BUILDERS)(
    "%s reads what tells twins apart and hands it to each option",
    (file: string) => {
      const source: string = read(file);

      expect({ file, select: source.includes("getSharedNameSelect(") }).toEqual(
        { file, select: true },
      );
      expect({ file, facts: source.includes("getSharedNameFacts(") }).toEqual({
        file,
        facts: true,
      });
    },
  );

  test.each(SELECTS_ONLY)(
    "%s reads what tells twins apart, which DropdownUtil hands to each option",
    (file: string) => {
      expect(read(file)).toContain("getSharedNameSelect(");
    },
  );

  test("DropdownUtil hands a record listed by its name its facts", () => {
    expect(read("packages/Common/UI/Utils/Dropdown.ts")).toMatch(
      /data\.labelField === "name"[\s\S]{0,200}getSharedNameFacts\(item\)/,
    );
  });
});

describe("the components that draw them", () => {
  test.each(DRAWERS)("%s marks the twins by the rule", (file: string) => {
    const source: string = read(file);

    expect({ file, marks: source.includes("getSharedNameMarks(") }).toEqual({
      file,
      marks: true,
    });
    // With the one look: the pill, and the line that sets each apart.
    expect({ file, pill: source.includes("<SharedNamePill") }).toEqual({
      file,
      pill: true,
    });
  });
});
