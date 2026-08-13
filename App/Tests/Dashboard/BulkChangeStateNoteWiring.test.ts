import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every table with a bulk "Change State" action must offer the same optional
 * note the single-event change-state modal on the overview page offers, and
 * must actually forward that note to the API. A table that renders the modal
 * but drops `miscDataProps` would show a textbox that quietly does nothing,
 * which is the exact bug these assertions exist to prevent.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSource(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

interface BulkTableCase {
  name: string;
  component: Array<string>;
  noteType: "Public" | "Private";
  noteTitle: string;
  stateFieldKey: string;
  timelineModelType: string;
  notifiesStatusPageSubscribers: boolean;
  noteTemplateModelType: string;
}

const BULK_TABLES: Array<BulkTableCase> = [
  {
    name: "Incidents",
    component: ["Components", "Incident", "IncidentsTable.tsx"],
    noteType: "Public",
    noteTitle: "Public Note",
    stateFieldKey: "incidentStateId",
    timelineModelType: "IncidentStateTimeline",
    notifiesStatusPageSubscribers: true,
    noteTemplateModelType: "IncidentNoteTemplate",
  },
  {
    name: "Alerts",
    component: ["Components", "Alert", "AlertsTable.tsx"],
    noteType: "Private",
    noteTitle: "Private Note",
    stateFieldKey: "alertStateId",
    timelineModelType: "AlertStateTimeline",
    notifiesStatusPageSubscribers: false,
    noteTemplateModelType: "AlertNoteTemplate",
  },
  {
    name: "Scheduled Maintenance",
    component: [
      "Components",
      "ScheduledMaintenance",
      "ScheduledMaintenanceTable.tsx",
    ],
    noteType: "Public",
    noteTitle: "Public Note",
    stateFieldKey: "scheduledMaintenanceStateId",
    timelineModelType: "ScheduledMaintenanceStateTimeline",
    notifiesStatusPageSubscribers: true,
    noteTemplateModelType: "ScheduledMaintenanceNoteTemplate",
  },
  {
    name: "Incident Episodes",
    component: ["Components", "IncidentEpisode", "IncidentEpisodesTable.tsx"],
    noteType: "Private",
    noteTitle: "Private Note",
    stateFieldKey: "incidentStateId",
    timelineModelType: "IncidentEpisodeStateTimeline",
    notifiesStatusPageSubscribers: false,
    noteTemplateModelType: "IncidentNoteTemplate",
  },
  {
    name: "Alert Episodes",
    component: ["Components", "AlertEpisode", "AlertEpisodesTable.tsx"],
    noteType: "Private",
    noteTitle: "Private Note",
    stateFieldKey: "alertStateId",
    timelineModelType: "AlertEpisodeStateTimeline",
    notifiesStatusPageSubscribers: false,
    noteTemplateModelType: "AlertNoteTemplate",
  },
];

describe("bulk change-state modal offers a note on every event table", () => {
  test.each(BULK_TABLES)(
    "$name renders the shared bulk change-state modal with a note",
    (bulkTable: BulkTableCase) => {
      const source: string = readSource(...bulkTable.component);

      expect(source).toContain("<BulkChangeStateModal");
      expect(source).toContain(`stateFieldKey="${bulkTable.stateFieldKey}"`);
      expect(source).toContain(
        `noteType={BulkStateChangeNoteType.${bulkTable.noteType}}`,
      );
      expect(source).toContain(`noteTitle="${bulkTable.noteTitle}"`);
      expect(source).toContain("noteTemplates={noteTemplates}");
    },
  );

  test.each(BULK_TABLES)(
    "$name loads note templates from $noteTemplateModelType",
    (bulkTable: BulkTableCase) => {
      const source: string = readSource(...bulkTable.component);

      expect(source).toContain(
        `useNoteTemplates<${bulkTable.noteTemplateModelType}>(`,
      );
      expect(source).toContain(
        `modelType: ${bulkTable.noteTemplateModelType},`,
      );
    },
  );

  test.each(BULK_TABLES)(
    "$name forwards the note to the $timelineModelType create",
    (bulkTable: BulkTableCase) => {
      const source: string = readSource(...bulkTable.component);

      expect(source).toContain("buildBulkStateChangeMiscDataProps({");
      expect(source).toContain(
        `noteType: BulkStateChangeNoteType.${bulkTable.noteType},`,
      );
      expect(source).toContain("note: data.note,");
      expect(source).toContain(
        `ModelAPI.create<${bulkTable.timelineModelType}>(`,
      );
      expect(source).toContain("miscDataProps: miscDataProps,");
    },
  );

  test.each(BULK_TABLES)(
    "$name only offers the subscriber toggle when the event reaches a status page",
    (bulkTable: BulkTableCase) => {
      const source: string = readSource(...bulkTable.component);

      if (bulkTable.notifiesStatusPageSubscribers) {
        expect(source).toContain("showNotifyStatusPageSubscribers={true}");
        expect(source).toContain(
          "stateTimeline.shouldStatusPageSubscribersBeNotified = data.shouldStatusPageSubscribersBeNotified ?? true;",
        );
      } else {
        expect(source).not.toContain("showNotifyStatusPageSubscribers");
        expect(source).not.toContain("shouldStatusPageSubscribersBeNotified");
      }
    },
  );

  test.each(BULK_TABLES)(
    "$name reuses the shared skip rule instead of inlining it",
    (bulkTable: BulkTableCase) => {
      const source: string = readSource(...bulkTable.component);

      expect(source).toContain("getBulkStateChangeSkipDecision({");
      expect(source).toContain("if (skipDecision.shouldSkip) {");
      expect(source).not.toContain("if (currentOrder >= targetOrder)");
    },
  );
});

describe("shared bulk change-state modal", () => {
  const source: string = readSource(
    "Components",
    "EventView",
    "BulkChangeStateModal.tsx",
  );

  test("renders the note as an optional markdown textbox", () => {
    expect(source).toContain("fieldType: FormFieldSchemaType.Markdown");
    expect(source).toContain("title: props.noteTitle,");
    expect(source).toContain("description: props.noteDescription,");
  });

  test("keeps the state picker required", () => {
    expect(source).toContain('title: "Select State",');
    expect(source).toContain("required: true,");
  });

  test("shows the note template picker only when templates exist", () => {
    expect(source).toContain("if (props.noteTemplates.length > 0) {");
  });

  test("adds the subscriber toggle only for events that have one", () => {
    expect(source).toContain("if (props.showNotifyStatusPageSubscribers) {");
  });

  test("submits the picked state as an ObjectID", () => {
    expect(source).toContain("stateId: new ObjectID(selectedStateId),");
  });
});
