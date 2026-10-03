import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  describePublicNotesTab,
  describeSharedPublicNoteWiring,
} from "./PublicNotesTabWiring";

/*
 * An incident episode created without notifying status page subscribers
 * starts every new public note - from the episode feed's "Add Public Note"
 * and on the Public Notes tab - with "Notify status page subscribers"
 * unticked. Both write the note with the same composer, built from the
 * episode's public note kind, which always sends the flag it shows: an
 * unsent flag would leave the choice to the server. An episode state change
 * posts no public note and has no notify checkbox, so it is left as it is.
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

function indexOfOrFail(source: string, fragment: string): number {
  const index: number = source.indexOf(fragment);

  if (index < 0) {
    throw new Error(`Expected source to contain: ${fragment}`);
  }

  return index;
}

// Dashboard source files, as paths relative to src with "/" separators.
function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(
        path.relative(DASHBOARD_SRC, entryPath).split(path.sep).join("/"),
      );
    }
  }

  return files;
}

const HELPER_IMPORT: string =
  'import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";';

const QUIET_DESCRIPTION_REFERENCE: string =
  "PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription";

// The incident's own wording and helper, easy to copy over by mistake.
const INCIDENT_QUIET_DESCRIPTION_REFERENCE: string =
  "PublicNoteSubscriberNotificationDefault.quietIncidentDescription";

const INCIDENT_HELPER_CALL: string = "shouldNotifyForIncident(";

const FEED_FILE: Array<string> = [
  "Components",
  "IncidentEpisode",
  "IncidentEpisodeFeed.tsx",
];

const KIND_FILE: Array<string> = [
  "Components",
  "EventNotes",
  "NoteKinds",
  "IncidentEpisodeNoteKinds.ts",
];

const PUBLIC_NOTES_TAB_FILE: Array<string> = [
  "Pages",
  "Incidents",
  "EpisodeView",
  "PublicNote.tsx",
];

describe("incident episode view page", () => {
  const source: string = readSource(
    "Pages",
    "Incidents",
    "EpisodeView",
    "Index.tsx",
  );

  test("loads the episode's notify-on-create setting with the episode", () => {
    const getEpisode: string = extract(
      source,
      /ModelAPI\.getItem\(\{ modelType: IncidentEpisode,[\s\S]*?\}, \}\)/,
    );

    expect(getEpisode).not.toBe("");
    expect(getEpisode).toContain("id: modelId,");
    expect(getEpisode).toMatch(
      /select: \{[^}]*shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,/,
    );
    expect(source).toContain("setEpisode(loaded);");
  });

  test("derives the default from the shared helper", () => {
    expect(source).toContain(HELPER_IMPORT);
    expect(source).toContain(
      "const notifyStatusPageSubscribersByDefault: boolean = PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode( episode, );",
    );
    expect(source).not.toContain(INCIDENT_HELPER_CALL);
  });

  /*
   * Read from the loaded episode rather than kept in its own state, so the
   * feed never gets the previous episode's setting: the skeleton covers the
   * page until the episode in the URL has loaded, and a failed first load
   * shows an error instead of the feed.
   */
  test("reads the default from the episode on screen, after the loading and error guards", () => {
    const derived: number = indexOfOrFail(
      source,
      "const notifyStatusPageSubscribersByDefault: boolean =",
    );

    expect(
      indexOfOrFail(source, "if (loadedModelId !== modelIdString) {"),
    ).toBeLessThan(derived);
    expect(indexOfOrFail(source, "if (error) { return (")).toBeLessThan(
      derived,
    );
    expect(derived).toBeLessThan(
      indexOfOrFail(source, "<IncidentEpisodeFeedElement"),
    );
    expect(source).not.toContain("setNotifyStatusPageSubscribersByDefault");
  });

  test("passes the default to the episode feed", () => {
    const feed: string = extract(
      source,
      /<IncidentEpisodeFeedElement [\s\S]*?\/>/,
    );

    expect(feed).not.toBe("");
    expect(feed).toContain("incidentEpisodeId={modelId}");
    expect(feed).toContain("refreshToken={contentRefreshToken}");
    expect(feed).toMatch(
      /notifyStatusPageSubscribersByDefault=\{ ?notifyStatusPageSubscribersByDefault ?\}/,
    );
  });

  test("does not hand the default to the state change header, which posts no public note", () => {
    const changeState: string = extract(
      source,
      /<ChangeEpisodeState [\s\S]*?\/>/,
    );

    expect(changeState).not.toBe("");
    expect(changeState).toContain("episodeId={modelId}");
    expect(changeState).not.toContain("notifyStatusPageSubscribersByDefault");
  });
});

describe("incident episode feed public note", () => {
  const source: string = readSource(...FEED_FILE);
  const kinds: string = readSource(...KIND_FILE);

  test("accepts the default as an optional prop that falls back to notifying", () => {
    expect(source).toContain(
      "notifyStatusPageSubscribersByDefault?: boolean | undefined;",
    );
    expect(source).toContain(
      "const notifySubscribersByDefault: boolean = props.notifyStatusPageSubscribersByDefault ?? true;",
    );
  });

  test("builds the dialog's public note from the episode's kind, with that default", () => {
    expect(source).toContain(
      'const noteActions: FeedNoteActions = useFeedNoteActions({ keyPrefix: "incident-episode", publicNoteKind: getIncidentEpisodePublicNoteKind({ incidentEpisodeId: props.incidentEpisodeId, isNotifyingByDefault: notifySubscribersByDefault, }), privateNoteKind: getIncidentEpisodePrivateNoteKind({ incidentEpisodeId: props.incidentEpisodeId, }),',
    );
  });

  test("explains an unticked default with the shared episode description, never the incident's", () => {
    expect(kinds).toContain(HELPER_IMPORT);
    expect(kinds).toContain(
      `subscriberNotifications: { isNotifyingByDefault: data.isNotifyingByDefault, quietDescription: ${QUIET_DESCRIPTION_REFERENCE}, },`,
    );
    expect(kinds).not.toContain(INCIDENT_QUIET_DESCRIPTION_REFERENCE);
    expect(source).not.toContain(INCIDENT_QUIET_DESCRIPTION_REFERENCE);
  });

  test("the private note has no notify setting at all", () => {
    const privateKind: string = kinds.slice(
      kinds.indexOf("export function getIncidentEpisodePrivateNoteKind("),
    );

    expect(privateKind).toContain("modelType: IncidentEpisodeInternalNote,");
    expect(privateKind).not.toContain("subscriberNotifications");
    expect(privateKind).not.toContain("isNotifyingByDefault");
  });

  test("no longer builds its own note form", () => {
    expect(source).not.toContain(
      '"Common/Models/DatabaseModels/IncidentEpisodePublicNote"',
    );
    expect(source).not.toContain(
      '"Common/Models/DatabaseModels/IncidentEpisodeInternalNote"',
    );
    expect(source).not.toContain("initialValues=");
  });
});

describePublicNotesTab({
  eventName: "incident episode",
  file: PUBLIC_NOTES_TAB_FILE,
  parentModel: "IncidentEpisode",
  noteModel: "IncidentEpisodePublicNote",
  parentIdField: "incidentEpisodeId",
  kindFile: KIND_FILE,
  kindFunction: "getIncidentEpisodePublicNoteKind",
  parentFlag: "shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated",
  resolveArgument: "episode",
  helperCall: "shouldNotifyForIncidentEpisode",
  quietDescriptionReference: QUIET_DESCRIPTION_REFERENCE,
  foreignReferences: [
    INCIDENT_HELPER_CALL,
    INCIDENT_QUIET_DESCRIPTION_REFERENCE,
  ],
});

describeSharedPublicNoteWiring();

/*
 * The episode state change only records a private note. If it ever gains a
 * public note or a notify checkbox, it needs the same seeding as the forms
 * above, so this fails to say so.
 */
describe("incident episode state change", () => {
  const source: string = readSource(
    "Components",
    "IncidentEpisode",
    "ChangeState.tsx",
  );

  // Its body is the shared state change fields, with a private note.
  test("still has only a private note", () => {
    expect(source).toContain("modelType={IncidentEpisodeStateTimeline}");
    expect(source).toContain(
      "fields: getStateChangeFormFields<IncidentEpisodeStateTimeline>({",
    );
    expect(source).toContain("noteType: BulkStateChangeNoteType.Private,");
    expect(source).not.toContain("BulkStateChangeNoteType.Public");
    expect(source).not.toContain("publicNote");
    expect(source).not.toContain("PublicNote");
  });

  test("still has no notify checkbox", () => {
    expect(source).not.toContain("notifySubscribers:");
    expect(source).not.toContain("Notify Status Page Subscribers");
    expect(source).not.toContain("shouldStatusPageSubscribersBeNotified");
    expect(source).not.toContain("notifyStatusPageSubscribersByDefault");
  });
});

/*
 * A new place to post an episode public note would start ticked unless it
 * gets the same wiring, so the covered places are listed here: the episode's
 * note kinds, which both the feed's dialog and the Public Notes tab read, and
 * the tab, which names the model only as its feed's type.
 */
describe("every dashboard form for an episode public note is covered", () => {
  const sourceFiles: Array<string> = listSourceFiles(DASHBOARD_SRC);

  test("only the episode's note kinds and the Public Notes tab name episode public notes", () => {
    const postingFiles: Array<string> = sourceFiles.filter(
      (file: string): boolean => {
        return fs
          .readFileSync(path.join(DASHBOARD_SRC, file), "utf8")
          .includes('"Common/Models/DatabaseModels/IncidentEpisodePublicNote"');
      },
    );

    expect(postingFiles.sort()).toEqual(
      [KIND_FILE.join("/"), PUBLIC_NOTES_TAB_FILE.join("/")].sort(),
    );
  });

  test("every page that shows the episode feed passes the default", () => {
    const feedPages: Array<string> = sourceFiles.filter(
      (file: string): boolean => {
        return (
          file !== FEED_FILE.join("/") &&
          readSource(file).includes("<IncidentEpisodeFeedElement")
        );
      },
    );

    expect(feedPages).toEqual(["Pages/Incidents/EpisodeView/Index.tsx"]);

    for (const file of feedPages) {
      const feed: string = extract(
        readSource(file),
        /<IncidentEpisodeFeedElement [\s\S]*?\/>/,
      );

      expect(feed).toContain("notifyStatusPageSubscribersByDefault=");
    }
  });
});

/*
 * Dashboard strings are translated by looking the English text up in each
 * locale file, so every string these forms use must be in all of them.
 */
describe("the episode notify checkbox descriptions are translated", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const QUIET_DESCRIPTION: string =
    PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription;

  const FORM_STRINGS: Array<string> = [
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

  test("the episode description is its own text, not the incident's", () => {
    expect(QUIET_DESCRIPTION).not.toBe(
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
    );
    expect(QUIET_DESCRIPTION).toContain("episode");
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
    // Not the incident sentence copied over.
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
