import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  describePublicNotesTab,
  describeSharedPublicNoteWiring,
} from "./PublicNotesTabWiring";

/*
 * A scheduled maintenance event created without notifying status page
 * subscribers starts every new public note - from the feed's "Add Public
 * Note" and on the Public Notes tab - with "Notify status page subscribers"
 * unticked. Both write the note with the same composer, built from the
 * event's public note kind, which always sends the flag it shows. A state
 * change from the header starts from the state it moves the event to: ticked
 * for an event created with subscribers notified; for a quiet event, ticked
 * only when moving it to ongoing or ended while its "Event Ongoing" / "Event
 * Ended" setting is on, as the automatic change would have announced it.
 *
 * The state change is a form, where the flag has to be seeded as a form
 * value, not only as the checkbox's default: the form drops a false default
 * and the key is then left out of the request. A state change has no event
 * fallback on the server, so an unsent flag leaves the state change to its
 * column default (notify) and every subscriber is emailed about it anyway -
 * while its public note, which the server posts with Boolean(flag), goes out
 * quiet.
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

function extract(source: string, pattern: RegExp): string {
  return source.match(pattern)?.[0] || "";
}

/*
 * indexOf for ordering checks. A missing fragment fails the test instead of
 * returning -1, which would pass any "comes before" check on its own.
 */
function indexOfOrFail(source: string, fragment: string): number {
  const index: number = source.indexOf(fragment);

  if (index < 0) {
    throw new Error(`Expected source to contain: ${fragment}`);
  }

  return index;
}

const HELPER_IMPORT: string =
  'import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";';

const HELPER_WITH_STATE_CHANGE_SETTINGS_IMPORT: string =
  'import PublicNoteSubscriberNotificationDefault, { ScheduledMaintenanceStateChangeSubscriberNotificationSetting, } from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";';

const QUIET_DESCRIPTION_REFERENCE: string =
  "PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription";

describe("scheduled maintenance view page", () => {
  const source: string = readSource(
    "Pages",
    "ScheduledMaintenanceEvents",
    "View",
    "Index.tsx",
  );

  test("loads the event's created, ongoing and ended notify settings with the event", () => {
    const getScheduledMaintenance: string = extract(
      source,
      /ModelAPI\.getItem<ScheduledMaintenance>\(\{[\s\S]*?\}, \}, \}\)/,
    );

    expect(getScheduledMaintenance).not.toBe("");
    expect(getScheduledMaintenance).toContain("id: modelId,");
    expect(getScheduledMaintenance).toMatch(
      /select: \{[^}]*shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,/,
    );
    expect(getScheduledMaintenance).toMatch(
      /select: \{[^}]*shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,/,
    );
    expect(getScheduledMaintenance).toMatch(
      /select: \{[^}]*shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,/,
    );
  });

  test("derives the default from the shared helper", () => {
    expect(source).toContain(HELPER_IMPORT);
    expect(source).toContain(
      "const notifyStatusPageSubscribersByDefault: boolean = PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance( scheduledMaintenance, );",
    );
  });

  test("derives the default only once the current event has loaded", () => {
    const derivedAt: number = indexOfOrFail(
      source,
      "const notifyStatusPageSubscribersByDefault: boolean",
    );
    const eventAt: number = indexOfOrFail(
      source,
      "const scheduledMaintenance: ScheduledMaintenance | undefined = loadedEvent?.item;",
    );

    expect(indexOfOrFail(source, "if (!isCurrentEventLoaded) {")).toBeLessThan(
      eventAt,
    );
    expect(eventAt).toBeLessThan(derivedAt);
    expect(derivedAt).toBeLessThan(
      indexOfOrFail(source, "<ChangeScheduledMaintenanceState "),
    );
    expect(derivedAt).toBeLessThan(
      indexOfOrFail(source, "<ScheduledMaintenanceFeedElement "),
    );
  });

  test("hands the state change header the loaded event's settings, not the created-only default", () => {
    const changeState: string = extract(
      source,
      /<ChangeScheduledMaintenanceState [\s\S]*?\/>/,
    );

    expect(changeState).not.toBe("");
    expect(changeState).toContain("scheduledMaintenanceId={modelId}");
    expect(changeState).toContain(
      "subscriberNotificationSettings={scheduledMaintenance}",
    );
    expect(changeState).not.toContain("notifyStatusPageSubscribersByDefault");
  });

  test("passes the default to the scheduled maintenance feed", () => {
    const feed: string = extract(
      source,
      /<ScheduledMaintenanceFeedElement [\s\S]*?\/>/,
    );

    expect(feed).not.toBe("");
    expect(feed).toContain("scheduledMaintenanceId={modelId}");
    expect(feed).toMatch(
      /notifyStatusPageSubscribersByDefault=\{ ?notifyStatusPageSubscribersByDefault ?\}/,
    );
  });
});

/*
 * The state change dialog builds its body with the shared state change
 * fields (EventView/StateChangeFormFields): the notify checkbox open, the
 * public note folded under it. The checkbox is the builder's; what the
 * event decides is what it hands the builder.
 */
describe("Scheduled maintenance change state", () => {
  const source: string = readSource(
    "Components",
    "ScheduledMaintenance",
    "ChangeState.tsx",
  );
  const modal: string = extract(
    source,
    /\{showModal && \( <ModelFormModal [^>]*?modelType=\{ScheduledMaintenanceStateTimeline\}[\s\S]*?formType: FormType\.Create,/,
  );
  const builder: string = readSource(
    "Components",
    "EventView",
    "StateChangeFormFields.ts",
  );
  const checkbox: string = extract(
    builder,
    /\{ field: \{ shouldStatusPageSubscribersBeNotified: true, \} as SelectFormFields<TEntity>, fieldType: FormFieldSchemaType\.Checkbox,[\s\S]*?\}/,
  );

  test("finds the modal form and builds it with the shared state change fields", () => {
    expect(modal).not.toBe("");
    expect(modal).toContain(
      "fields: getStateChangeFormFields<ScheduledMaintenanceStateTimeline>( {",
    );
    expect(modal).toContain("noteType: BulkStateChangeNoteType.Public,");
    expect(checkbox).not.toBe("");
    expect(checkbox).toContain('title: "Notify Status Page Subscribers"');
  });

  test("takes the default from an optional prop, through the shared rule", () => {
    expect(source).toContain(
      "subscriberNotificationSettings?: | ScheduledMaintenanceStateChangeSubscriberNotificationSetting | undefined;",
    );
    expect(source).toContain(
      "const notifySubscribersByDefault: boolean = PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenanceStateChange( props.subscriberNotificationSettings, selectedScheduledMaintenanceState, );",
    );
  });

  test("seeds the flag as an initial form value, not only as the checkbox default", () => {
    expect(modal).toMatch(
      /initialValues=\{\{ shouldStatusPageSubscribersBeNotified: notifySubscribersByDefault,? \}\}/,
    );
  });

  test("starts the checkbox from the event's default and explains a quiet one", () => {
    expect(source).toContain(HELPER_WITH_STATE_CHANGE_SETTINGS_IMPORT);
    expect(modal).toContain(
      `notifySubscribers: { byDefault: notifySubscribersByDefault, quietDescription: ${QUIET_DESCRIPTION_REFERENCE}, },`,
    );
  });

  test("the shared checkbox starts where it is told, never hard-coded on", () => {
    expect(checkbox).toContain(
      "defaultValue: options.notifySubscribers.byDefault,",
    );
    expect(checkbox).not.toContain("defaultValue: true");
  });
});

/*
 * The header's state change also tells subscribers about the change itself,
 * and the event has its own "Event Ongoing" / "Event Ended" settings for
 * that, which the automatic workers honour. Starting the form from Event
 * Created alone would silently skip an announcement the event is set to
 * make.
 */
describe("scheduled maintenance change state: the default follows the target state", () => {
  const source: string = readSource(
    "Components",
    "ScheduledMaintenance",
    "ChangeState.tsx",
  );

  test("does not fall back to the created-only rule or a boolean prop", () => {
    expect(source).not.toContain("shouldNotifyForScheduledMaintenance(");
    expect(source).not.toContain("notifyStatusPageSubscribersByDefault");
  });

  test("works the default out after the target state is known", () => {
    const derivedAt: number = indexOfOrFail(
      source,
      "const notifySubscribersByDefault: boolean =",
    );

    expect(
      indexOfOrFail(
        source,
        "const [ selectedScheduledMaintenanceState, setSelectedScheduledMaintenanceState, ] = useState<ScheduledMaintenanceState | undefined>(undefined);",
      ),
    ).toBeLessThan(derivedAt);
    expect(derivedAt).toBeLessThan(
      indexOfOrFail(source, "{showModal && ( <ModelFormModal"),
    );
  });

  test("opens the form in the same handler that sets the target state, so its first render sees it", () => {
    const openModalForState: string = extract(
      source,
      /const openModalForState: \(stateId: string\) => void = \([\s\S]*?\};/,
    );

    expect(openModalForState).not.toBe("");

    const selectAt: number = indexOfOrFail(
      openModalForState,
      "setSelectedScheduledMaintenanceState(scheduledMaintenanceState);",
    );

    expect(selectAt).toBeLessThan(
      indexOfOrFail(openModalForState, "setShowModal(true);"),
    );
  });
});

/*
 * The state change modal has no checkbox of its own for its public note: the
 * server posts the note with Boolean(the state change's flag), so the one
 * seeded checkbox decides both.
 */
describe("scheduled maintenance change state public note", () => {
  const source: string = readSource(
    "Components",
    "ScheduledMaintenance",
    "ChangeState.tsx",
  );
  const modal: string = extract(
    source,
    /\{showModal && \( <ModelFormModal [^>]*?modelType=\{ScheduledMaintenanceStateTimeline\}[\s\S]*?formType: FormType\.Create,/,
  );

  test("offers a public note under the one notify checkbox", () => {
    const builder: string = readSource(
      "Components",
      "EventView",
      "StateChangeFormFields.ts",
    );

    // A public note, and the notify checkbox the builder draws once.
    expect(modal).toContain("noteType: BulkStateChangeNoteType.Public,");
    expect(modal.match(/notifySubscribers: \{/g)).toEqual([
      "notifySubscribers: {",
    ]);
    expect(modal).not.toContain("FormFieldSchemaType.Checkbox");
    expect(builder.match(/fieldType: FormFieldSchemaType\.Checkbox,/g)).toEqual(
      ["fieldType: FormFieldSchemaType.Checkbox,"],
    );
    expect(modal).not.toContain(
      "shouldStatusPageSubscribersBeNotifiedOnNoteCreated",
    );
    expect(builder).not.toContain(
      "shouldStatusPageSubscribersBeNotifiedOnNoteCreated",
    );
  });
});

/*
 * The feed's "Add Public Note" is the Public Notes tab's composer in a
 * dialog, given the event's public note kind built from the default the
 * overview page loaded.
 */
describe("scheduled maintenance feed public note", () => {
  const source: string = readSource(
    "Components",
    "ScheduledMaintenance",
    "ScheduledMaintenanceFeed.tsx",
  );
  const kinds: string = readSource(
    "Components",
    "EventNotes",
    "NoteKinds",
    "ScheduledMaintenanceNoteKinds.ts",
  );

  test("takes the default from an optional prop that falls back to notifying", () => {
    expect(source).toContain(
      "notifyStatusPageSubscribersByDefault?: boolean | undefined;",
    );
    expect(source).toContain(
      "const notifySubscribersByDefault: boolean = props.notifyStatusPageSubscribersByDefault ?? true;",
    );
  });

  test("builds the dialog's public note from the event's kind, with that default", () => {
    expect(source).toContain(
      'const noteActions: FeedNoteActions = useFeedNoteActions({ keyPrefix: "scheduled-maintenance", publicNoteKind: getScheduledMaintenancePublicNoteKind({ scheduledMaintenanceId: props.scheduledMaintenanceId, isNotifyingByDefault: notifySubscribersByDefault, }), privateNoteKind: getScheduledMaintenancePrivateNoteKind({ scheduledMaintenanceId: props.scheduledMaintenanceId, }),',
    );
  });

  test("explains an unticked default with the event's own description", () => {
    expect(kinds).toContain(HELPER_IMPORT);
    expect(kinds).toContain(
      `subscriberNotifications: { isNotifyingByDefault: data.isNotifyingByDefault, quietDescription: ${QUIET_DESCRIPTION_REFERENCE}, },`,
    );
  });

  test("no longer builds its own note form", () => {
    expect(source).not.toContain(
      '"Common/Models/DatabaseModels/ScheduledMaintenancePublicNote"',
    );
    expect(source).not.toContain(
      '"Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote"',
    );
    expect(source).not.toContain("<ModelFormModal");
    expect(source).not.toContain("initialValues=");
    expect(source).not.toContain(QUIET_DESCRIPTION_REFERENCE);
  });
});

describePublicNotesTab({
  eventName: "scheduled maintenance",
  file: ["Pages", "ScheduledMaintenanceEvents", "View", "PublicNote.tsx"],
  parentModel: "ScheduledMaintenance",
  noteModel: "ScheduledMaintenancePublicNote",
  parentIdField: "scheduledMaintenanceId",
  kindFile: [
    "Components",
    "EventNotes",
    "NoteKinds",
    "ScheduledMaintenanceNoteKinds.ts",
  ],
  kindFunction: "getScheduledMaintenancePublicNoteKind",
  parentFlag: "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
  resolveArgument: "scheduledMaintenance",
  helperCall: "shouldNotifyForScheduledMaintenance",
  quietDescriptionReference: QUIET_DESCRIPTION_REFERENCE,
});

describeSharedPublicNoteWiring();

/*
 * The manual form on the State Timeline page records a state entry by hand,
 * often back-dated, and keeps its long-standing notify default, as the
 * incident State Timeline page does. The docs say so; this keeps the two in
 * step.
 */
describe("scheduled maintenance State Timeline page", () => {
  const source: string = readSource(
    "Pages",
    "ScheduledMaintenanceEvents",
    "View",
    "StateTimeline.tsx",
  );
  const checkbox: string = extract(
    source,
    /\{ field: \{ shouldStatusPageSubscribersBeNotified: true, \}, title: "Notify Status Page Subscribers",[\s\S]*?\}/,
  );

  test("keeps its notify checkbox on by default", () => {
    expect(checkbox).not.toBe("");
    expect(checkbox).toContain("fieldType: FormFieldSchemaType.Checkbox,");
    expect(checkbox).toContain("defaultValue: true,");
    expect(checkbox).toContain(
      'description: "Should status page subscribers be notified?",',
    );
  });

  test("does not follow the event's notify-on-create setting", () => {
    expect(source).not.toContain("PublicNoteSubscriberNotificationDefault");
    expect(source).not.toContain("notifySubscribersByDefault");
    expect(source).not.toContain(
      "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
    );
  });
});

/*
 * Dashboard strings are translated by looking the English text up in each
 * locale file, so every string these forms use must be in all of them.
 */
describe("the notify checkbox descriptions are translated", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const QUIET_DESCRIPTION: string =
    PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription;

  const FORM_STRINGS: Array<string> = [
    "Notify Status Page Subscribers",
    "Should status page subscribers be notified?",
    "Notify subscribers of this state change.",
    // The composer's, on the Public Notes tab and in the feed's dialog.
    "Notify status page subscribers",
    "Subscribers will be notified about this update as soon as you post it.",
    "The update will appear on your status page without notifying subscribers.",
  ];

  const localeFiles: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json");
    });

  function readLocale(file: string): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Record<string, unknown>;
  }

  test("covers every dashboard locale", () => {
    expect(localeFiles).toContain("en.json");
    expect(localeFiles.length).toBe(17);
  });

  test("English maps the quiet description to itself", () => {
    expect(readLocale("en.json")[QUIET_DESCRIPTION]).toBe(QUIET_DESCRIPTION);
  });

  test("English has every description the notify checkboxes use", () => {
    const en: Record<string, unknown> = readLocale("en.json");

    for (const text of FORM_STRINGS) {
      expect(en[text]).toBe(text);
    }
  });

  test.each(
    localeFiles.filter((file: string): boolean => {
      return file !== "en.json";
    }),
  )("%s translates the quiet description", (file: string) => {
    const locale: Record<string, unknown> = readLocale(file);
    const translated: unknown = locale[QUIET_DESCRIPTION];

    expect(typeof translated).toBe("string");
    expect((translated as string).trim().length).toBeGreaterThan(0);
    expect(translated).not.toBe(QUIET_DESCRIPTION);
    // Its own sentence, not the incident one copied over.
    expect(translated).not.toBe(
      locale[PublicNoteSubscriberNotificationDefault.quietIncidentDescription],
    );
  });

  test.each(localeFiles)(
    "%s has every notify checkbox description",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      for (const text of [...FORM_STRINGS, QUIET_DESCRIPTION]) {
        expect(typeof locale[text]).toBe("string");
        expect((locale[text] as string).trim().length).toBeGreaterThan(0);
      }
    },
  );
});
