import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Adding a note from an event's overview uses the same composer as its Notes
 * page: one step, with templates, AI and who it reaches."
 *
 * The incident, alert, scheduled maintenance and both episode feeds each drew
 * their own "Add Public Note" / "Add Private Note" ModelFormModal - eight of
 * them. Each turned on the form's summary, which made it a two-step wizard
 * (write, Next, then a Summary page repeating what was typed); the public
 * ones asked a required Posted At up front; none had the Notes page's
 * templates, Draft with AI, or who the note reaches; and the incident's was
 * named "create-incident-state-timeline" and described "this state change".
 *
 * Now a note is written in one place, EventNoteComposer: inline on the Notes
 * pages (EventNotes) and in a dialog from the feeds (EventNoteComposerDialog,
 * through useFeedNoteActions). What makes each kind of note what it is lives
 * once per event type, in Components/EventNotes/NoteKinds, and both places
 * read it. This keeps it that way for every page written later.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const NOTE_KINDS_DIR: string = "Components/EventNotes/NoteKinds";

interface NoteKindCase {
  // The note model.
  model: string;
  // The function in the event's NoteKinds module that builds it.
  kindFunction: string;
  kindFile: string;
  // The Notes page and the feed that write it.
  page: string;
  feed: string;
}

const NOTE_KINDS: Array<NoteKindCase> = [
  {
    model: "IncidentPublicNote",
    kindFunction: "getIncidentPublicNoteKind",
    kindFile: `${NOTE_KINDS_DIR}/IncidentNoteKinds.tsx`,
    page: "Pages/Incidents/View/PublicNote.tsx",
    feed: "Components/Incident/IncidentFeed.tsx",
  },
  {
    model: "IncidentInternalNote",
    kindFunction: "getIncidentPrivateNoteKind",
    kindFile: `${NOTE_KINDS_DIR}/IncidentNoteKinds.tsx`,
    page: "Pages/Incidents/View/InternalNote.tsx",
    feed: "Components/Incident/IncidentFeed.tsx",
  },
  {
    model: "AlertInternalNote",
    kindFunction: "getAlertPrivateNoteKind",
    kindFile: `${NOTE_KINDS_DIR}/AlertNoteKinds.ts`,
    page: "Pages/Alerts/View/InternalNote.tsx",
    feed: "Components/Alert/AlertFeed.tsx",
  },
  {
    model: "ScheduledMaintenancePublicNote",
    kindFunction: "getScheduledMaintenancePublicNoteKind",
    kindFile: `${NOTE_KINDS_DIR}/ScheduledMaintenanceNoteKinds.ts`,
    page: "Pages/ScheduledMaintenanceEvents/View/PublicNote.tsx",
    feed: "Components/ScheduledMaintenance/ScheduledMaintenanceFeed.tsx",
  },
  {
    model: "ScheduledMaintenanceInternalNote",
    kindFunction: "getScheduledMaintenancePrivateNoteKind",
    kindFile: `${NOTE_KINDS_DIR}/ScheduledMaintenanceNoteKinds.ts`,
    page: "Pages/ScheduledMaintenanceEvents/View/InternalNote.tsx",
    feed: "Components/ScheduledMaintenance/ScheduledMaintenanceFeed.tsx",
  },
  {
    model: "IncidentEpisodePublicNote",
    kindFunction: "getIncidentEpisodePublicNoteKind",
    kindFile: `${NOTE_KINDS_DIR}/IncidentEpisodeNoteKinds.ts`,
    page: "Pages/Incidents/EpisodeView/PublicNote.tsx",
    feed: "Components/IncidentEpisode/IncidentEpisodeFeed.tsx",
  },
  {
    model: "IncidentEpisodeInternalNote",
    kindFunction: "getIncidentEpisodePrivateNoteKind",
    kindFile: `${NOTE_KINDS_DIR}/IncidentEpisodeNoteKinds.ts`,
    page: "Pages/Incidents/EpisodeView/InternalNote.tsx",
    feed: "Components/IncidentEpisode/IncidentEpisodeFeed.tsx",
  },
  {
    model: "AlertEpisodeInternalNote",
    kindFunction: "getAlertEpisodePrivateNoteKind",
    kindFile: `${NOTE_KINDS_DIR}/AlertEpisodeNoteKinds.ts`,
    page: "Pages/Alerts/EpisodeView/InternalNote.tsx",
    feed: "Components/AlertEpisode/AlertEpisodeFeed.tsx",
  },
];

const NOTE_MODELS: Array<string> = NOTE_KINDS.map(
  (kind: NoteKindCase): string => {
    return kind.model;
  },
);

/*
 * Places that write a note without the composer, and why that is right.
 */
const NOTE_WRITERS_WITHOUT_THE_COMPOSER: Record<string, string> = {
  "Components/Telemetry/InvestigationDrawer.tsx":
    "Pins a telemetry investigation to an incident as a private note it builds itself (the investigation's query and link). Nobody types the note, so there is nothing to compose.",
};

const SOURCE_FILE: RegExp = /\.tsx?$/;

// The forms a note could be written through.
const FORM_HOSTS: Array<string> = [
  "ModelFormModal",
  "ModelForm",
  "BasicFormModal",
  "BasicForm",
  "ModelTable",
  "CardModelDetail",
];

function squash(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function read(relativePath: string): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8"),
  );
}

// Dashboard sources, as paths relative to src with "/" separators.
function listSources(directory: string = DASHBOARD_SRC): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "Locales" || entry.name === "node_modules") {
        continue;
      }

      files.push(...listSources(entryPath));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(
        path.relative(DASHBOARD_SRC, entryPath).split(path.sep).join("/"),
      );
    }
  }

  return files;
}

const SOURCES: Array<{ file: string; source: string }> = listSources().map(
  (file: string): { file: string; source: string } => {
    return { file, source: read(file) };
  },
);

// The feed components: everything drawn in a FeedCard.
const FEEDS: Array<{ file: string; source: string }> = SOURCES.filter(
  (entry: { file: string; source: string }): boolean => {
    return (
      entry.file.startsWith("Components/") &&
      entry.file.endsWith("Feed.tsx") &&
      entry.source.includes("<FeedCard")
    );
  },
);

describe("the scan", () => {
  test("reads the dashboard and finds every event feed", () => {
    expect(SOURCES.length).toBeGreaterThan(500);

    const feedFiles: Array<string> = FEEDS.map(
      (entry: { file: string }): string => {
        return entry.file;
      },
    );

    for (const kind of NOTE_KINDS) {
      expect(feedFiles).toContain(kind.feed);
    }
  });
});

describe("no note form outside the composer", () => {
  test.each(NOTE_MODELS)(
    "no form, table or detail card is built on %s",
    (model: string) => {
      const offenders: Array<string> = SOURCES.filter(
        (entry: { file: string; source: string }): boolean => {
          return FORM_HOSTS.some((host: string): boolean => {
            /*
             * `<Host` (with or without a type argument) whose own props
             * name the note model. Props end at the first "/>" or ">" after
             * the model, which is enough to tell this host's modelType from
             * another element's.
             */
            return new RegExp(
              `<${host}(<${model}>)?[\\s\\S]{0,400}?modelType=\\{${model}\\}`,
            ).test(entry.source);
          });
        },
      ).map((entry: { file: string }): string => {
        return entry.file;
      });

      expect(offenders).toEqual([]);
    },
  );

  test.each(NOTE_MODELS)(
    "%s is configured in its NoteKinds module and nowhere else",
    (model: string) => {
      const kind: NoteKindCase = NOTE_KINDS.find(
        (candidate: NoteKindCase): boolean => {
          return candidate.model === model;
        },
      )!;

      const configuring: Array<string> = SOURCES.filter(
        (entry: { file: string; source: string }): boolean => {
          return (
            entry.source.includes(`modelType: ${model},`) ||
            entry.source.includes(`modelType={${model}}`)
          );
        },
      )
        .map((entry: { file: string }): string => {
          return entry.file;
        })
        .filter((file: string): boolean => {
          return !NOTE_WRITERS_WITHOUT_THE_COMPOSER[file];
        });

      expect(configuring).toEqual([kind.kindFile]);
      expect(read(kind.kindFile).split(`modelType: ${model},`).length - 1).toBe(
        1,
      );
    },
  );

  test("each place that writes a note without the composer says why", () => {
    for (const [file, reason] of Object.entries(
      NOTE_WRITERS_WITHOUT_THE_COMPOSER,
    )) {
      const source: string = read(file);

      expect(
        NOTE_MODELS.some((model: string): boolean => {
          return source.includes(`modelType: ${model}`);
        }),
      ).toBe(true);
      expect(reason.length).toBeGreaterThan(40);
    }
  });
});

describe("feeds write notes with the Notes page composer", () => {
  test.each(FEEDS)(
    "$file draws no form summary step",
    (entry: { file: string; source: string }) => {
      expect(entry.source).not.toMatch(/summary: \{ ?enabled: true/);
      expect(entry.source).not.toContain("summary:");
    },
  );

  test.each(FEEDS)(
    "$file never spells out a note action of its own",
    (entry: { file: string; source: string }) => {
      // The note actions and their dialog come from useFeedNoteActions.
      expect(entry.source).not.toContain('"Add Public Note"');
      expect(entry.source).not.toContain('"Add Private Note"');
      expect(entry.source).not.toContain('title: "Posted At"');
      expect(entry.source).not.toContain("showPublicNoteModal");
      expect(entry.source).not.toContain("showPrivateNoteModal");
    },
  );

  test.each(NOTE_KINDS)(
    "$feed offers $model through the composer dialog",
    (kind: NoteKindCase) => {
      const source: string = read(kind.feed);

      expect(source).toContain(
        "const noteActions: FeedNoteActions = useFeedNoteActions({",
      );
      expect(source).toContain(`${kind.kindFunction}({`);
      expect(source).toContain("...noteActions.menuItems,");
      expect(source).toContain("{noteActions.dialog}");
      expect(source).toContain(
        'import useFeedNoteActions, { FeedNoteActions, } from "../EventNotes/useFeedNoteActions";',
      );
    },
  );

  test("every feed with note actions refreshes itself after a note is posted", () => {
    for (const feed of new Set(
      NOTE_KINDS.map((kind: NoteKindCase): string => {
        return kind.feed;
      }),
    )) {
      expect(read(feed)).toContain(
        "onPosted: () => { refresh().catch((err: unknown) => { setError(API.getFriendlyMessage(err as Exception)); }); },",
      );
    }
  });
});

describe("the Notes pages read the same kinds", () => {
  test.each(NOTE_KINDS)(
    "$page renders its notes from $kindFunction",
    (kind: NoteKindCase) => {
      const source: string = read(kind.page);

      expect(source).toContain(
        `<EventNotes<${kind.model}> key={modelId.toString()} {...${kind.kindFunction}({`,
      );
      expect(source).toContain("currentProject={props.currentProject}");
      expect(read(kind.kindFile)).toContain(
        `export function ${kind.kindFunction}(`,
      );
    },
  );

  test("the kinds live in one module per event type, and nothing else lives there", () => {
    const files: Array<string> = fs
      .readdirSync(path.join(DASHBOARD_SRC, NOTE_KINDS_DIR))
      .map((name: string): string => {
        return `${NOTE_KINDS_DIR}/${name}`;
      })
      .sort();

    expect(files).toEqual(
      Array.from(
        new Set(
          NOTE_KINDS.map((kind: NoteKindCase): string => {
            return kind.kindFile;
          }),
        ),
      ).sort(),
    );
  });
});

describe("the dialog is the composer, in one step", () => {
  const dialog: string = read(
    "Components/EventNotes/EventNoteComposerDialog.tsx",
  );
  const composer: string = read("Components/EventNotes/EventNoteComposer.tsx");
  const hook: string = read("Components/EventNotes/useFeedNoteActions.tsx");

  test("the dialog renders the Notes page's composer, in its dialog presentation", () => {
    expect(dialog).toContain("<EventNoteComposer<TNote> kind={props.kind}");
    expect(dialog).toContain('presentation={{ type: "dialog",');
    expect(dialog).toContain("projectId={ProjectUtil.getCurrentProjectId()}");
  });

  test("the composer's dialog is a plain wide dialog, not a stepped form", () => {
    expect(composer).toContain(
      "<Modal title={title} modalWidth={ModalWidth.Large}",
    );
    expect(composer).not.toContain("ModelFormModal");
    expect(composer).not.toContain("BasicForm");
    expect(composer).not.toContain("summary");
  });

  test("the posting time stays behind the composer's own control, closed until asked", () => {
    const noteComposer: string = read("Components/EventNotes/NoteComposer.tsx");

    expect(noteComposer).toContain(
      "const [isPostedAtOpen, setIsPostedAtOpen] = useState<boolean>(false);",
    );
    expect(composer).toContain(
      'record["postedAt"] = draft.postedAt || OneUptimeDate.getCurrentDate();',
    );
  });

  test("the feed's note actions are gated like the Notes page's composer", () => {
    expect(hook).toContain(
      "const gate: NoteCreateGate = getNoteCreateGate(entry.kind.modelType);",
    );
    expect(hook).toContain("isDisabled={gate.isDisabled}");
    expect(hook).toContain("tooltip={gate.tooltip}");
  });
});
