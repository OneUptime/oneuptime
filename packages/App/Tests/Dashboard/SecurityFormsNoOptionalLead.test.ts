import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * No text of Security Events opens with "Optional.".
 *
 * A form marks a field that may be left empty beside its title -
 * "Person (Optional)" - so a description or a placeholder that opened with
 * "Optional." said it twice, and pushed what the field is for to the
 * second word. The page pass of #5246 took it off a playbook's rules
 * filter; the playbook step dialog, the case form and the approval's
 * comment kept theirs until this guard. Say what the field is for; the
 * form says it is optional.
 */

const DASHBOARD: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// Every folder Security Events' pages and components live in.
const SECURITY_FOLDERS: Array<string> = [
  path.join(DASHBOARD, "Components", "SecurityCase"),
  path.join(DASHBOARD, "Components", "SecurityConnections"),
  path.join(DASHBOARD, "Components", "SecurityEvents"),
  path.join(DASHBOARD, "Components", "SecurityOverview"),
  path.join(DASHBOARD, "Components", "SecurityPlaybook"),
  path.join(DASHBOARD, "Pages", "SecurityEvents"),
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /^\s*\/\/.*$/gm;

function filesUnder(folder: string): Array<string> {
  if (!fs.existsSync(folder)) {
    return [];
  }

  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        return filesUnder(full);
      }

      return SOURCE_FILE.test(entry.name) ? [full] : [];
    });
}

// The code, its comments left out: they may quote the old copy.
function codeOf(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");
}

// What a string literal opening with "Optional" looks like, in any quote.
const OPTIONAL_LEADS: Array<string> = [
  '"Optional.',
  "'Optional.",
  "`Optional.",
];

describe("Security Events says what a field is for, not that it is optional", () => {
  const files: Array<string> = SECURITY_FOLDERS.flatMap(filesUnder);

  test("reads the Security Events sources", () => {
    // Sanity: the walk found the folders and the files the fix touched.
    expect(files.length).toBeGreaterThan(100);
    for (const name of [
      "SecurityPlaybookStepDialog.tsx",
      "SecurityCasesTable.tsx",
      "SecurityPlaybookRunCard.tsx",
    ]) {
      expect(
        files.some((file: string): boolean => {
          return path.basename(file) === name;
        }),
      ).toBe(true);
    }
  });

  test("no description, placeholder or lead opens with Optional.", () => {
    const offenders: Array<string> = files.filter((file: string): boolean => {
      const code: string = codeOf(file);

      return OPTIONAL_LEADS.some((lead: string): boolean => {
        return code.includes(lead);
      });
    });

    expect(
      offenders.map((file: string): string => {
        return path.relative(DASHBOARD, file);
      }),
    ).toEqual([]);
  });

  test("the fields that had one say what they are for", () => {
    const dialog: string = codeOf(
      path.join(
        DASHBOARD,
        "Components",
        "SecurityPlaybook",
        "SecurityPlaybookStepDialog.tsx",
      ),
    );
    const table: string = codeOf(
      path.join(
        DASHBOARD,
        "Components",
        "SecurityCase",
        "SecurityCasesTable.tsx",
      ),
    );
    const card: string = codeOf(
      path.join(
        DASHBOARD,
        "Components",
        "SecurityPlaybook",
        "SecurityPlaybookRunCard.tsx",
      ),
    );

    expect(dialog).toContain('description: "Who the case is assigned to."');
    expect(dialog).toContain(
      '"The team the case belongs to. Choose a person, a team, or both."',
    );
    expect(dialog).toContain(
      `"When an entity is a known indicator, the case's priority rises to at least this."`,
    );
    expect(dialog).toContain(
      '"Markdown; a summary of the case when empty. These fill in from the case:"',
    );
    expect(table).toContain('description: "The person working the case."');
    expect(table).toContain('description: "The team the case belongs to."');
    expect(card).toContain('placeholder: "Why you decided this way."');
  });

  /*
   * The step dialog's help above the placeholders was a prop of a component
   * of its own, which the locale extractor never read: English in every
   * language. Both leads are translation keys now.
   */
  test("the step dialog's placeholder help is a translation key", () => {
    const dialog: string = codeOf(
      path.join(
        DASHBOARD,
        "Components",
        "SecurityPlaybook",
        "SecurityPlaybookStepDialog.tsx",
      ),
    );

    expect(dialog).toContain(
      'translationKey(\n  "Markdown. These fill in from the case:",\n)',
    );
    expect(dialog).toContain(
      "<PlaceholderHelp lead={NOTE_PLACEHOLDER_LEAD} />",
    );
    expect(dialog).toContain(
      "<PlaceholderHelp lead={MESSAGE_PLACEHOLDER_LEAD} />",
    );
    expect(dialog).not.toContain('<PlaceholderHelp lead="');
  });

  /*
   * The retired leads are gone from every locale too: a key nothing draws
   * is still a sentence translators are asked to word. Three of them were
   * left over from the page pass of #5246, which reworded a playbook's
   * filters.
   */
  test("no locale keeps a retired Optional. lead", () => {
    const LOCALES: string = path.join(DASHBOARD, "Locales");
    const RETIRED: Array<string> = [
      "Optional. Who the case is assigned to.",
      "Optional. The team the case belongs to. Choose a person, a team, or both.",
      "Optional. When an entity is a known indicator, the case's priority rises to at least this.",
      "Optional. The person working the case.",
      "Optional. The team the case belongs to.",
      "Optional. Why you decided this way.",
      "Optional. Only cases of this priority or higher.",
      "Optional. Only when the detection behind the case came from this source.",
      "Optional. When set, the playbook runs only on cases whose detection came from one of these rules.",
    ];
    const files: Array<string> = fs
      .readdirSync(LOCALES)
      .filter((name: string): boolean => {
        return name.endsWith(".json");
      });

    expect(files.length).toBe(17);

    for (const file of files) {
      const values: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES, file), "utf8"),
      ) as Record<string, string>;

      for (const key of RETIRED) {
        expect({ file, key, isKept: key in values }).toEqual({
          file,
          key,
          isKept: false,
        });
      }
    }
  });
});
