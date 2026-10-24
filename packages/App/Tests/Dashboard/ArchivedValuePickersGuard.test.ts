import {
  ARCHIVABLE_VALUE_DEFINITIONS,
  ArchivableValueDefinition,
  ArchivableValueType,
} from "Common/Utils/ArchivableValues";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ARCHIVED VALUES ARE NEVER OFFERED FOR A NEW PICK (Common/Utils/
 * ArchivableValues), and every value can be archived from its settings page.
 *
 * Forms and entity dropdowns leave archived values out by themselves
 * (ArchivedValuePicker, through ModelForm and EntityDropdown). A Dashboard
 * file that lists one of the eight value models itself - ModelAPI.getList,
 * ModelListCache - has to say what it does about them: narrow to the live
 * ones, keep the archived ones a record already has, or read them for
 * something else entirely (a filter, a display, a count). This holds every
 * such file to one of those: it mentions the archive switch, or it is listed
 * below with why it may read every value. A new picker that lists values
 * without either fails here.
 *
 * And every kind of value has its settings page wired to the archive hook,
 * so a value added to the registry is archivable where it is managed.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MODELS: Array<string> = ARCHIVABLE_VALUE_DEFINITIONS.map(
  (definition: ArchivableValueDefinition): string => {
    return definition.tableName;
  },
);

// A list read of a value model: the read, then its model within the call.
const VALUE_READ: RegExp = new RegExp(
  `(ModelAPI|ModelListCache)\\.(getList|getListAll|getAll|get)\\b[\\s\\S]{0,200}?modelType:\\s*(${MODELS.join("|")})\\b`,
  "g",
);

// What a file that handles archived values mentions.
const HANDLES_ARCHIVED: Array<string> = [
  "isArchived",
  "ArchivedValuePicker",
  "getPickableIncidentRoleChoices",
  // A list's filter: every value, the archived ones last under "Archived".
  "getArchivableValueFacetOptions",
];

/*
 * Files that read every value, archived ones too, for something that is not
 * a new pick - and why.
 */
const READS_EVERY_VALUE: Record<string, string> = {
  "Components/AffectedResources/AffectedResourcesPicker.tsx":
    "picks monitors by the labels they have: a label still on a monitor finds it, archived or not",
  "Components/Dashboard/Toolbar/DashboardVariablesModal.tsx":
    "a dashboard variable filters what charts show: records keep archived labels, and stay findable by them",
  "Components/IncidentRole/FetchIncidentRoleAssignments.tsx":
    "reads the roles people hold on an incident, to show them",
  "Components/IncidentSeverity/FetchIncidentSeverity.tsx":
    "reads severities by id, to show the ones records have",
  "Components/Label/FetchLabels.tsx":
    "reads labels by id, to show the ones records have",
  "Components/Monitor/MonitorSteps/MonitorSteps.tsx":
    "shows a monitor's saved criteria, whatever they name",
  "Components/MonitorStatus/FetchMonitorStatuses.tsx":
    "reads statuses by id, to show the ones monitors are in",
  "Components/StatusPage/HistoryChartBarColorPreview.tsx":
    "previews the colour of every status a status page's history can show",
  "Components/Workspace/WorkspaceNotificationRulesTable.tsx":
    "a chat notification rule matches records, and records - an automation's among them - can still have an archived value",
  "Components/Workspace/WorkspaceSummaryTable.tsx":
    "a chat summary filters records, which keep archived values",
  "Pages/Alerts/EpisodeView/Alerts.tsx":
    "shows the states of an episode's alerts",
  "Pages/Alerts/EpisodeView/Index.tsx":
    "works out an episode's times from its state timeline",
  "Pages/Alerts/View/Incidents.tsx": "shows the states of an alert's incidents",
  "Pages/Alerts/View/Index.tsx":
    "works out an alert's times from its state timeline",
  "Pages/Incidents/EpisodeCreate.tsx":
    "an episode's role cards are drawn by the role picker, which leaves archived roles out (getPickableIncidentRoleChoices)",
  "Pages/Incidents/EpisodeView/Incidents.tsx":
    "shows the states of an episode's incidents",
  "Pages/Incidents/EpisodeView/Index.tsx":
    "works out an episode's times from its state timeline",
  "Pages/Incidents/View/Alerts.tsx": "shows the states of an incident's alerts",
  "Pages/Incidents/View/Index.tsx":
    "works out an incident's times from its state timeline",
  "Pages/MonitorGroup/View/Index.tsx":
    "works out a group's status from the statuses its monitors are in",
  "Pages/ScheduledMaintenanceEvents/View/Index.tsx":
    "works out an event's times from its state timeline",
  "Utils/AlertState.ts":
    "the project's states in order, for where a record is and has been",
  "Utils/IncidentState.ts":
    "the project's states in order, for where a record is and has been",
  "Utils/ScheduledMaintenanceState.ts":
    "the project's states in order, for where a record is and has been",
};

// Each kind of value's settings page.
const SETTINGS_PAGES: Record<ArchivableValueType, string> = {
  [ArchivableValueType.IncidentState]:
    "Pages/Incidents/Settings/IncidentState.tsx",
  [ArchivableValueType.IncidentSeverity]:
    "Pages/Incidents/Settings/IncidentSeverity.tsx",
  [ArchivableValueType.AlertState]: "Pages/Alerts/Settings/AlertState.tsx",
  [ArchivableValueType.AlertSeverity]:
    "Pages/Alerts/Settings/AlertSeverity.tsx",
  [ArchivableValueType.MonitorStatus]:
    "Pages/Monitor/Settings/MonitorStatus.tsx",
  [ArchivableValueType.ScheduledMaintenanceState]:
    "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceState.tsx",
  [ArchivableValueType.Label]: "Pages/Settings/Labels.tsx",
  [ArchivableValueType.IncidentRole]:
    "Pages/Incidents/Settings/IncidentRoles.tsx",
  [ArchivableValueType.IncidentPostmortemStatus]:
    "Pages/Incidents/Settings/IncidentPostmortemStatuses.tsx",
  [ArchivableValueType.SecurityCaseStatus]:
    "Pages/SecurityEvents/Settings/CaseStatuses.tsx",
  [ArchivableValueType.SecurityCasePriority]:
    "Pages/SecurityEvents/Settings/CasePriorities.tsx",
};

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

const listSources: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSources(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

const SOURCES: Array<{ file: string; text: string }> = listSources(
  DASHBOARD_SRC,
).map((full: string): { file: string; text: string } => {
  return {
    file: path.relative(DASHBOARD_SRC, full).split(path.sep).join("/"),
    text: fs.readFileSync(full, "utf8"),
  };
});

const dense: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, "");
};

describe("the Dashboard's own lists of values", () => {
  const reading: Array<{ file: string; text: string }> = SOURCES.filter(
    (source: { file: string; text: string }): boolean => {
      VALUE_READ.lastIndex = 0;
      return VALUE_READ.test(source.text);
    },
  );

  test("the sweep finds them", () => {
    expect(reading.length).toBeGreaterThan(40);
  });

  test("each handles archived values, or is listed with why it reads every value", () => {
    const unhandled: Array<string> = reading
      .filter((source: { file: string; text: string }): boolean => {
        return !HANDLES_ARCHIVED.some((word: string): boolean => {
          return source.text.includes(word);
        });
      })
      .map((source: { file: string; text: string }): string => {
        return source.file;
      })
      .filter((file: string): boolean => {
        return !READS_EVERY_VALUE[file];
      });

    expect(unhandled).toEqual([]);
  });

  test("the list names only files that still read every value, each with a reason", () => {
    const stale: Array<string> = Object.keys(READS_EVERY_VALUE).filter(
      (file: string): boolean => {
        const source: { file: string; text: string } | undefined = reading.find(
          (candidate: { file: string; text: string }) => {
            return candidate.file === file;
          },
        );

        return (
          !source ||
          HANDLES_ARCHIVED.some((word: string): boolean => {
            return source.text.includes(word);
          })
        );
      },
    );

    expect(stale).toEqual([]);

    for (const reason of Object.values(READS_EVERY_VALUE)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});

describe("every value is archived where it is managed", () => {
  test.each(Object.values(ArchivableValueType))(
    "%s's settings page draws the archive hook, and hands its table what the hook gives",
    (type: ArchivableValueType) => {
      const file: string = SETTINGS_PAGES[type];
      const code: string = dense(
        fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8"),
      );

      expect(code).toContain(`type:ArchivableValueType.${type},`);
      expect(code).toContain("useArchivableValues<");

      // The live values only: the hook's query, alone or with the page's own.
      expect({
        file,
        query:
          code.includes("query={archive.query}") ||
          code.includes("...archive.query,"),
      }).toEqual({ file, query: true });

      for (const prop of [
        "actionButtons={archive.actionButtons}",
        "getDeleteConfirmation={archive.getDeleteConfirmation}",
        "refreshToggle={archive.refreshToggle}",
        "{archive.element}",
      ]) {
        expect({ file, prop, wired: code.includes(prop) }).toEqual({
          file,
          prop,
          wired: true,
        });
      }
    },
  );

  test("the pages are the registry's, one each", () => {
    expect(Object.keys(SETTINGS_PAGES).sort()).toEqual(
      Object.values(ArchivableValueType).sort(),
    );
    expect(new Set(Object.values(SETTINGS_PAGES)).size).toBe(
      Object.values(ArchivableValueType).length,
    );
  });
});
