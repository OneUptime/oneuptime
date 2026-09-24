import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  describePublicNotesTab,
  describeSharedPublicNoteWiring,
} from "./PublicNotesTabWiring";

/*
 * An incident declared without notifying status page subscribers starts every
 * new public note - on the feed, on the Public Notes tab, and on a state
 * change - with "Notify Status Page Subscribers" unticked. The flag has to be
 * seeded as a form value, not only as the checkbox's default: the form drops
 * a false default and the key is then left out of the request. A state
 * change has no incident fallback on the server, so its column default
 * (notify) would email every subscriber anyway.
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

const HELPER_IMPORT: string =
  'import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";';

const QUIET_DESCRIPTION_REFERENCE: string =
  "PublicNoteSubscriberNotificationDefault.quietIncidentDescription";

describe("incident view page", () => {
  const source: string = readSource("Pages", "Incidents", "View", "Index.tsx");

  test("loads the incident's notify-on-declare setting with the incident", () => {
    const getIncident: string = extract(
      source,
      /ModelAPI\.getItem<Incident>\(\{[\s\S]*?\}, \}\)/,
    );

    expect(getIncident).not.toBe("");
    expect(getIncident).toMatch(
      /select: \{[^}]*shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,/,
    );
  });

  test("derives the default from the shared helper, starting at notify", () => {
    expect(source).toContain(HELPER_IMPORT);
    expect(source).toMatch(
      /const \[ notifyStatusPageSubscribersByDefault, setNotifyStatusPageSubscribersByDefault, \] = useState<boolean>\(true\);/,
    );
    expect(source).toContain(
      "setNotifyStatusPageSubscribersByDefault( PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident( incident, ), );",
    );
  });

  test("passes the default to the state change header", () => {
    const changeState: string = extract(
      source,
      /<ChangeIncidentState [\s\S]*?\/>/,
    );

    expect(changeState).not.toBe("");
    expect(changeState).toMatch(
      /notifyStatusPageSubscribersByDefault=\{ ?notifyStatusPageSubscribersByDefault ?\}/,
    );
  });

  test("passes the default to the incident feed", () => {
    const feed: string = extract(source, /<IncidentFeedElement [\s\S]*?\/>/);

    expect(feed).not.toBe("");
    expect(feed).toContain("incidentId={modelId}");
    expect(feed).toMatch(
      /notifyStatusPageSubscribersByDefault=\{ ?notifyStatusPageSubscribersByDefault ?\}/,
    );
  });
});

interface ModalFormCase {
  name: string;
  file: Array<string>;
  modal: RegExp;
  flagKey: string;
  notifyingDescription: string;
}

const MODAL_FORMS: Array<ModalFormCase> = [
  {
    name: "Incident feed public note",
    file: ["Components", "Incident", "IncidentFeed.tsx"],
    modal:
      /\{showPublicNoteModal && \( <ModelFormModal modelType=\{IncidentPublicNote\}[\s\S]*?formType: FormType\.Create,/,
    flagKey: "shouldStatusPageSubscribersBeNotifiedOnNoteCreated",
    notifyingDescription:
      "Should status page subscribers be notified when this note is posted?",
  },
  {
    name: "Incident change state",
    file: ["Components", "Incident", "ChangeState.tsx"],
    modal:
      /\{showModal && \( <ModelFormModal [^>]*?modelType=\{IncidentStateTimeline\}[\s\S]*?formType: FormType\.Create,/,
    flagKey: "shouldStatusPageSubscribersBeNotified",
    notifyingDescription: "Notify subscribers of this state change.",
  },
];

describe.each(MODAL_FORMS)("$name", (form: ModalFormCase) => {
  const source: string = readSource(...form.file);
  const modal: string = extract(source, form.modal);
  const checkbox: string = extract(
    modal,
    new RegExp(
      `\\{ field: \\{ ${form.flagKey}: true, \\}, fieldType: FormFieldSchemaType\\.Checkbox,[\\s\\S]*?\\}`,
    ),
  );

  test("finds the modal form and its notify checkbox", () => {
    expect(modal).not.toBe("");
    expect(checkbox).not.toBe("");
    expect(checkbox).toContain('title: "Notify Status Page Subscribers"');
  });

  test("accepts the default as an optional prop that falls back to notifying", () => {
    expect(source).toContain(
      "notifyStatusPageSubscribersByDefault?: boolean | undefined;",
    );
    expect(source).toContain(
      "const notifySubscribersByDefault: boolean = props.notifyStatusPageSubscribersByDefault ?? true;",
    );
  });

  test("seeds the flag as an initial form value, not only as the checkbox default", () => {
    expect(modal).toMatch(
      new RegExp(
        `initialValues=\\{\\{ ${form.flagKey}: notifySubscribersByDefault,? \\}\\}`,
      ),
    );
  });

  test("starts the checkbox from the incident's default instead of hard-coding true", () => {
    expect(checkbox).toContain("defaultValue: notifySubscribersByDefault,");
    expect(checkbox).not.toContain("defaultValue: true");
  });

  test("explains an unticked default with the shared description", () => {
    expect(source).toContain(HELPER_IMPORT);
    expect(checkbox).toContain(
      `description: notifySubscribersByDefault ? "${form.notifyingDescription}" : ${QUIET_DESCRIPTION_REFERENCE},`,
    );
  });
});

describePublicNotesTab({
  eventName: "incident",
  file: ["Pages", "Incidents", "View", "PublicNote.tsx"],
  parentModel: "Incident",
  noteModel: "IncidentPublicNote",
  parentIdField: "incidentId",
  parentFlag: "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
  resolveArgument: "incident",
  helperCall: "shouldNotifyForIncident",
  quietDescriptionReference: QUIET_DESCRIPTION_REFERENCE,
});

describeSharedPublicNoteWiring();

/*
 * Dashboard strings are translated by looking the English text up in each
 * locale file, so every string these forms use must be in all of them.
 */
describe("the notify checkbox descriptions are translated", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const QUIET_DESCRIPTION: string =
    PublicNoteSubscriberNotificationDefault.quietIncidentDescription;

  const FORM_STRINGS: Array<string> = [
    "Notify Status Page Subscribers",
    "Should status page subscribers be notified?",
    "Should status page subscribers be notified when this note is posted?",
    "Notify subscribers of this state change.",
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
    const translated: unknown = readLocale(file)[QUIET_DESCRIPTION];

    expect(typeof translated).toBe("string");
    expect((translated as string).trim().length).toBeGreaterThan(0);
    expect(translated).not.toBe(QUIET_DESCRIPTION);
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
