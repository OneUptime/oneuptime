import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  countFieldRows,
  scanFormFiles,
  toRepositoryPath,
} from "../../../Helpers/FormStepsScan";

/*
 * "Please also find similar issues across the project and fix them as well.
 * The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * Acknowledge, Resolve and every other state change on an incident, alert,
 * episode or scheduled maintenance event opened a wide form led by an open
 * Markdown editor - a responder confirming "I'm on it" at 3 a.m. was asked
 * to write a status page note first. Five copies of that dialog, and a bulk
 * one that walked two steps.
 *
 * They are confirms now, built from one shared piece
 * (Dashboard Components/EventView/StateChangeFormFields): what decides the
 * change open - "Notify Status Page Subscribers", where the event reaches a
 * status page - and the note with its template picker folded under "Add a
 * public note" / "Add a private note". This guard keeps it that way:
 *
 *   - every dialog that creates a state timeline row is one of the known
 *     state change dialogs, so a new one has to come through here;
 *   - each builds its fields with getStateChangeFormFields, and declares no
 *     note, Markdown editor or "Select Note Template" picker of its own;
 *   - read the way the form guards read every form (FormStepsScan): each
 *     Markdown editor and template picker is folded, in the builder's one
 *     section, and what is left open is only the notify checkbox (and the
 *     bulk dialog's state picker);
 *   - no dialog asks for a width: it is short while the note is folded and
 *     grows wide when the note is opened (FormModalWidth), which a fixed
 *     width would undo;
 *   - the bulk dialog is one page, with no steps.
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const SHARED_PIECE: string = `${DASHBOARD}/Components/EventView/StateChangeFormFields.ts`;

const BULK_DIALOG: string = `${DASHBOARD}/Components/EventView/BulkChangeStateModal.tsx`;

// The single-event dialogs, each in its event's header.
const STATE_CHANGE_DIALOGS: Array<string> = [
  `${DASHBOARD}/Components/Alert/ChangeState.tsx`,
  `${DASHBOARD}/Components/AlertEpisode/ChangeState.tsx`,
  `${DASHBOARD}/Components/Incident/ChangeState.tsx`,
  `${DASHBOARD}/Components/IncidentEpisode/ChangeState.tsx`,
  `${DASHBOARD}/Components/ScheduledMaintenance/ChangeState.tsx`,
];

// How the shared piece writes its one folded section on both fields.
const NOTE_SECTION: string = "noteSection";

const NOTIFY_TITLE: string = "Notify Status Page Subscribers";

function read(repositoryPath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, repositoryPath), "utf8");
}

// Comments out, whitespace squeezed: what the code says, not what it explains.
function code(repositoryPath: string): string {
  return read(repositoryPath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const dashboardFiles: Array<string> = listScanRoots(REPOSITORY_ROOT)
  .flatMap((root: string): Array<string> => {
    return listSourceFiles(root);
  })
  .filter((file: string): boolean => {
    return toRepositoryPath(REPOSITORY_ROOT, file).startsWith(`${DASHBOARD}/`);
  });

// A ModelFormModal that creates a state timeline row moves an event's state.
const STATE_TIMELINE_DIALOG: RegExp =
  /<ModelFormModal\b[^>]*?modelType=\{\s*\w+StateTimeline\s*\}/;

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: [...STATE_CHANGE_DIALOGS, BULK_DIALOG].map((file: string): string => {
    return path.join(REPOSITORY_ROOT, file);
  }),
});

function formsIn(file: string): Array<FormFacts> {
  return forms.filter((form: FormFacts): boolean => {
    return form.file === file;
  });
}

function describeField(field: FormFieldFacts): string {
  return `${field.title} (${field.fieldType || "no type"})`;
}

describe("state change dialogs", () => {
  test("are the known ones: every dialog that moves an event's state is listed here", () => {
    const found: Array<string> = dashboardFiles
      .filter((file: string): boolean => {
        return STATE_TIMELINE_DIALOG.test(fs.readFileSync(file, "utf8"));
      })
      .map((file: string): string => {
        return toRepositoryPath(REPOSITORY_ROOT, file);
      })
      .sort();

    expect(found).toEqual([...STATE_CHANGE_DIALOGS].sort());
  });

  test("every event table's bulk Change State is the shared bulk dialog", () => {
    const tables: Array<string> = dashboardFiles
      .map((file: string): string => {
        return toRepositoryPath(REPOSITORY_ROOT, file);
      })
      .filter((file: string): boolean => {
        return (
          file !== BULK_DIALOG && read(file).includes("<BulkChangeStateModal")
        );
      });

    // Incidents, alerts, both episode kinds and scheduled maintenance.
    expect(tables.length).toBeGreaterThanOrEqual(5);
  });

  test.each(STATE_CHANGE_DIALOGS)(
    "%s builds its fields with the shared piece and declares no note of its own",
    (file: string) => {
      const source: string = code(file);

      expect(source).toContain(
        'import { getStateChangeFormFields } from "../EventView/StateChangeFormFields";',
      );
      expect(source).toMatch(/fields: getStateChangeFormFields<\w+>\(/);
      expect(source.match(/getStateChangeFormFields</g)).toHaveLength(1);

      // The note, its editor and its template picker are the shared piece's.
      expect(source).not.toContain("Select Note Template");
      expect(source).not.toContain("FormFieldSchemaType.Markdown");
      expect(source).not.toContain("NoteTemplate: true");
      expect(source).not.toContain("Note: true");
      expect(source).not.toContain("FormFieldSchemaType.Checkbox");
    },
  );

  test("the bulk dialog builds its note with the shared piece, too", () => {
    const source: string = code(BULK_DIALOG);

    expect(source).toContain("...getStateChangeFormFields<JSONObject>({");
    expect(source).not.toContain("Select Note Template");
    expect(source).not.toContain("FormFieldSchemaType.Markdown");
    expect(source).not.toContain("FormFieldSchemaType.Checkbox");
  });

  test("only the incident and scheduled maintenance dialogs ask about status page subscribers", () => {
    const asking: Array<string> = STATE_CHANGE_DIALOGS.filter(
      (file: string): boolean => {
        return code(file).includes("notifySubscribers: {");
      },
    );

    expect(asking).toEqual([
      `${DASHBOARD}/Components/Incident/ChangeState.tsx`,
      `${DASHBOARD}/Components/ScheduledMaintenance/ChangeState.tsx`,
    ]);

    // Public notes go where subscribers are asked about; private ones elsewhere.
    for (const file of STATE_CHANGE_DIALOGS) {
      expect(code(file)).toContain(
        asking.includes(file)
          ? "noteType: BulkStateChangeNoteType.Public,"
          : "noteType: BulkStateChangeNoteType.Private,",
      );
    }
  });

  test("no dialog asks for a width: short while the note is folded, wide once it is open", () => {
    for (const file of [...STATE_CHANGE_DIALOGS, BULK_DIALOG]) {
      const source: string = code(file);

      expect({ file, asksForAWidth: source.includes("modalWidth=") }).toEqual({
        file,
        asksForAWidth: false,
      });
    }
  });
});

describe("read the way the form guards read every form", () => {
  test("each dialog's form is found and followed into the shared piece", () => {
    for (const file of [...STATE_CHANGE_DIALOGS, BULK_DIALOG]) {
      const found: Array<FormFacts> = formsIn(file);

      expect({ file, forms: found.length }).toEqual({ file, forms: 1 });
      expect(found[0]!.uncountableReasons).toEqual([]);
      expect(found[0]!.hasSteps).toBe(false);
    }
  });

  test("every Markdown editor and template picker is folded in the shared piece's one section", () => {
    for (const form of forms) {
      const noteFields: Array<FormFieldFacts> = form.fields.filter(
        (field: FormFieldFacts): boolean => {
          return (
            field.fieldType === "FormFieldSchemaType.Markdown" ||
            field.title === "Select Note Template"
          );
        },
      );

      expect({ form: form.file, notes: noteFields.length }).toEqual({
        form: form.file,
        notes: 2,
      });

      for (const field of noteFields) {
        expect({
          form: form.file,
          field: describeField(field),
          section: field.collapsibleSection,
        }).toEqual({
          form: form.file,
          field: describeField(field),
          section: NOTE_SECTION,
        });
      }
    }
  });

  test("what is left open is only what decides the change", () => {
    for (const form of forms) {
      const open: Array<string> = form.fields
        .filter((field: FormFieldFacts): boolean => {
          return !field.collapsibleSection;
        })
        .map(describeField);

      const decides: Array<string> =
        form.file === BULK_DIALOG
          ? [
              "Select State (FormFieldSchemaType.Dropdown)",
              `${NOTIFY_TITLE} (FormFieldSchemaType.Checkbox)`,
            ]
          : [`${NOTIFY_TITLE} (FormFieldSchemaType.Checkbox)`];

      expect({ form: form.file, open }).toEqual({
        form: form.file,
        open: decides,
      });
    }
  });

  test("a single-event dialog is two rows at most, the bulk one three", () => {
    for (const form of forms) {
      expect({
        form: form.file,
        rows: countFieldRows(
          form.fields.filter((field: FormFieldFacts): boolean => {
            return !field.isNeverShown;
          }),
        ),
      }).toEqual({ form: form.file, rows: form.file === BULK_DIALOG ? 3 : 2 });
    }
  });
});

describe("the shared piece", () => {
  const source: string = code(SHARED_PIECE);

  test("folds the note, even with something in it, under a line worded for who reads it", () => {
    expect(source).toContain(
      '[BulkStateChangeNoteType.Public]: translationKey("Add a public note"),',
    );
    expect(source).toContain(
      '[BulkStateChangeNoteType.Private]: translationKey("Add a private note"),',
    );
    expect(source).toMatch(
      /id: STATE_CHANGE_NOTE_SECTION_ID, title: STATE_CHANGE_NOTE_SECTION_TITLES\[noteType\], openWhenConfigured: false,/,
    );
  });

  test("builds its one section once and gives it to both note fields", () => {
    expect(
      source.match(/getStateChangeNoteSection<TEntity>\(options\.noteType\)/g),
    ).toHaveLength(1);
    expect(source.match(/collapsibleSection: noteSection,/g)).toHaveLength(2);
  });

  test("is the only place a state change dialog's template picker is written", () => {
    const writers: Array<string> = [
      ...STATE_CHANGE_DIALOGS,
      BULK_DIALOG,
      SHARED_PIECE,
    ].filter((file: string): boolean => {
      return code(file).includes('"Select Note Template"');
    });

    expect(writers).toEqual([SHARED_PIECE]);
  });
});
