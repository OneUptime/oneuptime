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
  // The On-Call guided setup's policy to page (#10314).
  "packages/App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetupApi.ts",
  // A record's Affected Resources: the Labels tab (#10314).
  "packages/App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker.tsx",
  /*
   * A Project Labels variable's allowed labels, while the dashboard's editor
   * picks them (#10314): what is saved keeps the name and id alone.
   */
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariablesModal.tsx",
  // The re-read of lists that come with names alone (#10314).
  "packages/Common/UI/Utils/SharedNameFactsReads.ts",
];

/*
 * Lists that come with their records' names alone - a schedule's shifts
 * name their on-call policies - and read what tells twins apart again, on
 * their own (SharedNameFactsReads, #10314).
 */
const NAMES_ALONE: Array<string> = [
  // Skip someone: the policies to add the skip on.
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/SkipLayerUserModal.tsx",
  // An upcoming shift's Get cover: a menu of its policies.
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftRow.tsx",
];

/*
 * Labels read through a record's relation, which takes no description: each
 * reads when it was made, which tells twins apart by the day (#10314).
 */
const THROUGH_A_RELATION: Array<string> = [
  // ModelForm's "select by labels" categories.
  "packages/Common/UI/Components/Forms/ModelForm.tsx",
  // The status page guided setup's label filter: its monitors' labels.
  "packages/App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupApi.ts",
];

/*
 * Teams the server names in a page's answer as OneUptime (root): it sends
 * when each was made, never a description the caller may not read
 * (#10314).
 */
const SERVER_NAMED_TEAMS: Array<string> = [
  // The Schedule Timeline's team filter.
  "packages/Common/Server/API/OnCallScheduleTimelineAPI.ts",
  // On-Call Readiness' team filter.
  "packages/Common/Server/Services/OnCallReadinessService.ts",
  // A tool import's invite team.
  "packages/Common/Server/Utils/ToolImport/ToolImportProjectStateReader.ts",
];

/*
 * Options the shared Dropdown draws - which marks the twins - built here
 * with each option's facts (#10314).
 */
const DROPDOWN_OPTIONS_WITH_FACTS: Array<string> = [
  "packages/App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallGuidedSetup.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupPicker.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineToolbar.tsx",
  "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportReview.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariablesModal.tsx",
];

/*
 * The chats' pickers (#10314): each read selects what tells twins apart,
 * and the options are labelled by the chats' half of the rule
 * (WorkspaceSharedNames).
 */
const CHAT_BUILDERS: Array<string> = [
  "packages/Common/Server/Utils/Workspace/WorkspacePage.ts",
  "packages/Common/Server/Utils/Workspace/Slack/Actions/Incident.ts",
  "packages/Common/Server/Utils/Workspace/Slack/Actions/Alert.ts",
  "packages/Common/Server/Utils/Workspace/Slack/Actions/AlertEpisode.ts",
  "packages/Common/Server/Utils/Workspace/Slack/Actions/IncidentEpisode.ts",
  "packages/Common/Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance.ts",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices.ts",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Alert.ts",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode.ts",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/Actions/IncidentEpisode.ts",
  "packages/Common/Server/Utils/Workspace/Mattermost/MattermostActions.ts",
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
  // A list's in-search label chips and their suggestions (#10314).
  "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
  // ModelForm's "select by labels" categories.
  "packages/Common/UI/Components/Forms/ModelForm.tsx",
  // Affected Resources' Labels tab.
  "packages/App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker.tsx",
  // Skip someone's policies, and Get cover's menu.
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/SkipLayerUserModal.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftRow.tsx",
];

/*
 * Left out on purpose, each with why (#10314):
 *
 *   - a form's public page (FormRecordOptions) offers labels to anonymous
 *     visitors, and only a record's name and color ever leave the server
 *     for it: two labels of one name there read alike, and the person who
 *     builds the form picks them in a picker that tells them apart;
 *   - a Project Labels variable's saved choices are the dashboard's own
 *     snapshot, shown in its toolbar and on its shared pages: they keep a
 *     label's name and id alone, never what its editor saw while choosing.
 */
const LEFT_OUT: Array<{ file: string; never: Array<string> }> = [
  {
    file: "packages/Common/Server/Utils/Form/FormRecordOptions.ts",
    never: ["getSharedNameSelect", "description: true", "createdAt: true"],
  },
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

  test.each(NAMES_ALONE)(
    "%s comes with names alone, and reads what tells twins apart again",
    (file: string) => {
      expect({
        file,
        reads: read(file).includes("useSharedNameFacts("),
      }).toEqual({ file, reads: true });
    },
  );

  test.each(THROUGH_A_RELATION)(
    "%s reads when each label of a relation was made, the most a relation's read takes",
    (file: string) => {
      // A label's own columns, and when it was made, read through the relation.
      expect(read(file)).toMatch(
        /\{[^{}]*_id: true,[^{}]*name: true,[^{}]*color: true,[^{}]*createdAt: true/,
      );
      expect(read(file)).toContain("getSharedNameFacts(");
    },
  );

  test.each(SERVER_NAMED_TEAMS)(
    "%s sends when each team it names was made, and no description",
    (file: string) => {
      const source: string = read(file);

      expect(source).toMatch(
        /select:\s*\{\s*_id: true,\s*name: true,\s*(?:\/\/[^\n]*\n\s*)?createdAt: true,?\s*\}/,
      );
      expect(source).not.toMatch(
        /select:\s*\{\s*_id: true,\s*name: true,[^}]*description: true/,
      );
    },
  );

  test.each(DROPDOWN_OPTIONS_WITH_FACTS)(
    "%s hands its options' facts to the Dropdown, which marks the twins",
    (file: string) => {
      expect({
        file,
        facts: /sharedName(?::| \?)/.test(read(file)),
      }).toEqual({ file, facts: true });
    },
  );

  test.each(CHAT_BUILDERS)(
    "%s reads what tells twins apart, and labels them by the chats' half of the rule",
    (file: string) => {
      const source: string = read(file);

      expect({ file, select: source.includes("getSharedNameSelect(") }).toEqual(
        { file, select: true },
      );
      expect({
        file,
        labels: /WorkspaceSharedNames\.|toNamedChoices\(/.test(source),
      }).toEqual({ file, labels: true });
    },
  );

  test.each(LEFT_OUT)(
    "$file is left out on purpose: it reads nothing that tells twins apart",
    (entry: { file: string; never: Array<string> }) => {
      const source: string = read(entry.file);

      for (const word of entry.never) {
        expect({ file: entry.file, word, read: source.includes(word) }).toEqual(
          { file: entry.file, word, read: false },
        );
      }
    },
  );

  test("a Project Labels variable saves its labels' names and ids alone", () => {
    const source: string = read(
      "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariablesModal.tsx",
    );

    // The choices saved are built of the name and the id, nothing more.
    expect(source).toContain(
      "choices.push({ label: label.name, value: label._id.toString() });",
    );
    // What tells twins apart is kept beside them, for the picker alone.
    expect(source).toContain("setFactsById(facts);");
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
