import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  EVENT_STATE_KINDS,
  EventStateKind,
  EventStateKindDefinition,
} from "../../FeatureSet/Dashboard/src/Components/EventView/EventStateKinds";
import { BulkStateChangeNoteType } from "../../FeatureSet/Dashboard/src/Utils/BulkStateChange";

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
  kind: EventStateKind;
  // The table's model, as it names the engine's type argument.
  model: string;
  noteType: BulkStateChangeNoteType;
  noteTitle: string;
  stateFieldKey: string;
  timelineModelType: string;
  notifiesStatusPageSubscribers: boolean;
  noteTemplateModelType: string;
  // The note the change posts, offered only to someone who may create it.
  noteModelType: string;
  /*
   * The table's events can be private, and a private one takes no public
   * notes (Common/Types/StatusPage/PrivateRecordPublicNotes): each change is
   * built per event (buildIncidentBulkStateChange), the note going as a
   * private note, notifying nobody, on a private one.
   */
  isPerEventPrivacy: boolean;
}

const BULK_TABLES: Array<BulkTableCase> = [
  {
    name: "Incidents",
    component: ["Components", "Incident", "IncidentsTable.tsx"],
    kind: EventStateKind.Incident,
    model: "Incident",
    noteType: BulkStateChangeNoteType.Public,
    noteTitle: "Public Note",
    stateFieldKey: "incidentStateId",
    timelineModelType: "IncidentStateTimeline",
    notifiesStatusPageSubscribers: true,
    noteTemplateModelType: "IncidentNoteTemplate",
    noteModelType: "IncidentPublicNote",
    isPerEventPrivacy: true,
  },
  {
    name: "Alerts",
    component: ["Components", "Alert", "AlertsTable.tsx"],
    kind: EventStateKind.Alert,
    model: "Alert",
    noteType: BulkStateChangeNoteType.Private,
    noteTitle: "Private Note",
    stateFieldKey: "alertStateId",
    timelineModelType: "AlertStateTimeline",
    notifiesStatusPageSubscribers: false,
    noteTemplateModelType: "AlertNoteTemplate",
    noteModelType: "AlertInternalNote",
    isPerEventPrivacy: false,
  },
  {
    name: "Scheduled Maintenance",
    component: [
      "Components",
      "ScheduledMaintenance",
      "ScheduledMaintenanceTable.tsx",
    ],
    kind: EventStateKind.ScheduledMaintenance,
    model: "ScheduledMaintenance",
    noteType: BulkStateChangeNoteType.Public,
    noteTitle: "Public Note",
    stateFieldKey: "scheduledMaintenanceStateId",
    timelineModelType: "ScheduledMaintenanceStateTimeline",
    notifiesStatusPageSubscribers: true,
    noteTemplateModelType: "ScheduledMaintenanceNoteTemplate",
    noteModelType: "ScheduledMaintenancePublicNote",
    isPerEventPrivacy: false,
  },
  {
    name: "Incident Episodes",
    component: ["Components", "IncidentEpisode", "IncidentEpisodesTable.tsx"],
    kind: EventStateKind.IncidentEpisode,
    model: "IncidentEpisode",
    noteType: BulkStateChangeNoteType.Private,
    noteTitle: "Private Note",
    stateFieldKey: "incidentStateId",
    timelineModelType: "IncidentEpisodeStateTimeline",
    notifiesStatusPageSubscribers: false,
    noteTemplateModelType: "IncidentNoteTemplate",
    noteModelType: "IncidentEpisodeInternalNote",
    isPerEventPrivacy: false,
  },
  {
    name: "Alert Episodes",
    component: ["Components", "AlertEpisode", "AlertEpisodesTable.tsx"],
    kind: EventStateKind.AlertEpisode,
    model: "AlertEpisode",
    noteType: BulkStateChangeNoteType.Private,
    noteTitle: "Private Note",
    stateFieldKey: "alertStateId",
    timelineModelType: "AlertEpisodeStateTimeline",
    notifiesStatusPageSubscribers: false,
    noteTemplateModelType: "AlertNoteTemplate",
    noteModelType: "AlertEpisodeInternalNote",
    isPerEventPrivacy: false,
  },
];

/*
 * The lists move their records through one engine
 * (EventView/useEventStateActions) - a row's Acknowledge, Resolve or Change
 * State, and the bulk ones - and what differs between the five kinds is its
 * catalogue (EventStateKinds). So the note each table's state change offers,
 * and forwards, is the engine's, read with that table's kind.
 */
const ENGINE: string = readSource(
  "Components",
  "EventView",
  "useEventStateActions.tsx",
);

describe("bulk change-state modal offers a note on every event table", () => {
  test.each(BULK_TABLES)(
    "$name moves its records through the shared engine, with its own kind and states",
    (bulkTable: BulkTableCase) => {
      const source: string = readSource(...bulkTable.component);

      expect(source).toContain(
        `= useEventStateActions<${bulkTable.model}>({ kind: EventStateKind.${bulkTable.kind},`,
      );
      // The engine draws the dialog; the table no longer does.
      expect(source).not.toContain("<BulkChangeStateModal");
      expect(source).not.toContain("ModelAPI.create<");
    },
  );

  test.each(BULK_TABLES)(
    "$name's kind posts a $noteType note, titled $noteTitle, on the $timelineModelType",
    (bulkTable: BulkTableCase) => {
      const kind: EventStateKindDefinition = EVENT_STATE_KINDS[bulkTable.kind];

      expect(kind.noteType).toBe(bulkTable.noteType);
      expect(kind.words.bulkNoteTitle).toBe(bulkTable.noteTitle);
      expect(kind.stateIdField).toBe(bulkTable.stateFieldKey);
      expect(kind.timelineModelType.name).toBe(bulkTable.timelineModelType);
      expect(kind.noteTemplateModelType.name).toBe(
        bulkTable.noteTemplateModelType,
      );
      expect(kind.notifiesSubscribers).toBe(
        bulkTable.notifiesStatusPageSubscribers,
      );
      expect(kind.hasPerEventPrivacy).toBe(bulkTable.isPerEventPrivacy);
    },
  );

  test.each(BULK_TABLES)(
    "$name offers the note only to someone who may create a $noteModelType",
    (bulkTable: BulkTableCase) => {
      expect(EVENT_STATE_KINDS[bulkTable.kind].noteModelType.name).toBe(
        bulkTable.noteModelType,
      );
    },
  );

  test("the engine loads the kind's note templates and offers them in the dialog", () => {
    expect(ENGINE).toContain(
      "const { noteTemplates } = useNoteTemplates({ modelType: definition.noteTemplateModelType as never, });",
    );
    expect(ENGINE).toContain("noteTemplates={noteTemplates}");
    expect(ENGINE).toContain(
      "noteType={noteType} noteTitle={ isRow ? STATE_CHANGE_NOTE_TITLES[noteType] : definition.words.bulkNoteTitle }",
    );
    expect(ENGINE).toContain("noteModel={new noteModelType()}");
  });

  test("the engine forwards the note to the timeline create", () => {
    expect(ENGINE).toContain(
      "await ModelAPI.create<BaseModel>({ model: timeline, modelType: definition.timelineModelType, miscDataProps: miscDataProps, });",
    );

    // A private incident's note goes as a private one, telling nobody.
    expect(ENGINE).toContain(
      "const change: IncidentBulkStateChange = buildIncidentBulkStateChange({ isPrivate: !PrivateRecordPublicNotes.takesPublicNotes(",
    );
    expect(ENGINE).toContain("note: data.submitted.note,");
    expect(ENGINE).toContain("miscDataProps = change.miscDataProps;");

    // Every other kind's note, of the kind's own type.
    expect(ENGINE).toContain(
      "miscDataProps = buildBulkStateChangeMiscDataProps({ noteType: definition.noteType, note: data.submitted.note, });",
    );
  });

  test("the engine asks about subscribers only for a kind that reaches them, and never for a private incident", () => {
    expect(ENGINE).toContain(
      "showNotifyStatusPageSubscribers={ definition.notifiesSubscribers && !isPrivate }",
    );
    expect(ENGINE).toContain(
      'if (definition.notifiesSubscribers) { row["shouldStatusPageSubscribersBeNotified"] = data.submitted.shouldStatusPageSubscribersBeNotified ?? true; }',
    );
    expect(ENGINE).toContain(
      'row["shouldStatusPageSubscribersBeNotified"] = change.shouldStatusPageSubscribersBeNotified;',
    );
  });

  test("the engine reads each record's state fresh, and leaves alone the ones the state timeline's rule would refuse", () => {
    expect(ENGINE).toContain(
      "const fetched: BaseModel | null = await ModelAPI.getItem<BaseModel>({",
    );
    expect(ENGINE).toContain("const refusal: string | null = getMoveRefusal({");
    expect(ENGINE).toContain("return bulkItemUnchanged(");
    expect(ENGINE).not.toContain("currentOrder >= targetOrder");
  });
});

describe("shared bulk change-state modal", () => {
  const source: string = readSource(
    "Components",
    "EventView",
    "BulkChangeStateModal.tsx",
  );

  // The body every state change dialog shares: notify, then the folded note.
  const stateChangeFields: string = readSource(
    "Components",
    "EventView",
    "StateChangeFormFields.ts",
  );

  test("renders the note as an optional markdown textbox, through the shared state change fields", () => {
    expect(source).toContain("...getStateChangeFormFields<JSONObject>({");
    expect(source).toContain("noteType: data.noteType,");
    expect(source).toContain("noteTitle: data.noteTitle,");
    expect(source).toContain("noteDescription: data.noteDescription,");
    expect(source).toContain("noteTemplates: data.noteTemplates,");

    expect(stateChangeFields).toContain(
      "fieldType: FormFieldSchemaType.Markdown,",
    );
    expect(stateChangeFields).toContain(
      "title: options.noteTitle || STATE_CHANGE_NOTE_TITLES[options.noteType],",
    );
    expect(stateChangeFields).toContain(
      "description: options.noteDescription,",
    );
  });

  test("keeps the state picker required", () => {
    expect(source).toContain('title: "Select State",');
    expect(source).toContain("required: true,");
  });

  test("shows the note template picker only when templates exist, and the note may be posted", () => {
    expect(stateChangeFields).toContain(
      "showIf: (): boolean => { return isNoteOffered && noteTemplates.length > 0; },",
    );
  });

  test("shows the note itself only when it may be posted", () => {
    expect(stateChangeFields).toContain(
      "const isNoteOffered: boolean = !options.noteModel || canPostStateChangeNote(options.noteModel);",
    );
    expect(stateChangeFields).toContain(
      "showIf: (): boolean => { return isNoteOffered; },",
    );
  });

  test("passes the note it posts on to the shared fields", () => {
    expect(source).toContain("noteModel: data.noteModel,");
    expect(source).toContain("noteModel: props.noteModel,");
  });

  test("adds the subscriber toggle only for events that have one", () => {
    expect(source).toContain(
      "notifySubscribers: data.showNotifyStatusPageSubscribers ? { byDefault: true } : undefined,",
    );
  });

  test("is one page: the folded note no longer needs a step of its own", () => {
    expect(source).not.toContain("steps:");
    expect(source).not.toContain("FormStep");
    expect(source).not.toContain("stepId");
  });

  test("submits the picked state as an ObjectID", () => {
    expect(source).toContain("stateId: new ObjectID(selectedStateId),");
  });

  /*
   * A row's Acknowledge or Resolve, or a bulk one, is about one state: the
   * dialog does not ask for it, and the change goes there.
   */
  test("a dialog about one state does not ask for it, and moves there", () => {
    expect(source).toContain(
      "showIf: (): boolean => { return !data.fixedStateId; },",
    );
    expect(source).toContain(
      'const selectedStateId: string = props.fixedStateId || String(formData[props.stateFieldKey] || "");',
    );
  });

  // One row on a line of its own (a ⋯ action), a selection as a list.
  test("names the records it is about above the fields", () => {
    expect(source).toContain(
      'props.itemNames && props.itemNames.length === 1 ? ( <p data-testid="state-change-item-name"',
    );
    expect(source).toContain("{props.itemNames[0]}");
    expect(source).toContain(
      ") : props.itemNames && props.itemNames.length > 1 ? ( <DeleteItemNames names={props.itemNames} totalCount={props.itemNames.length} /> ) : undefined }",
    );
  });
});
