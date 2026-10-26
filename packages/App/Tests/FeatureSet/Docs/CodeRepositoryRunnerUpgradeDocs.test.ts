import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says a code repository picks its Runner, and that
 * Runners lose their "Runs AI Code Fixes" switch, held to the code that
 * makes it true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits after the
 * note that visitors keep their own address (VisitorAddressesUpgradeDocs)
 * and before the endpoint pointer, and every translation carries it in the
 * English note's place, with the switch named as it was and a link to the
 * Code page's section on the repository's Runner in the reader's language.
 * What it claims is what the upgrade does:
 *
 *   - a repository's settings in Code hold its Runner
 *     (CodeRepository.runnerId), and one that picks none works on a global
 *     Runner while its project uses them;
 *   - the migration gives each project's repositories the Runner it had the
 *     switch on for - the one heard from most recently - and drops the
 *     switch;
 *   - a Runner takes code work only for the repositories that pick it, and
 *     only it is handed a token for them.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LEAD: string =
  "A code repository picks its Runner, and Runners lose their AI code fix switch.";
const NOTE_LEAD: string = `**${LEAD}**`;
// The note before it (VisitorAddressesUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**Visitors keep their own address in more setups.**";
// The note after it (AutoRemediationRunnerUpgradeDocs).
const NEXT_LEAD: string =
  "**OneUptime AI fixes with any runbook, or only the ones a rule allows, and a rule picks its Runner.**";

const CODE_PAGE: string = "ai/ai-agent";
const SECTION_HEADING: string = "### Pick the repository's Runner";

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// The anchor of the Code page's section on the repository's Runner, per language.
function sectionAnchor(language: string): string {
  const englishHeadings: Array<string> = fs
    .readFileSync(path.join(CONTENT_DIR, "en", `${CODE_PAGE}.md`), "utf8")
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("#");
    });
  const index: number = englishHeadings.indexOf(SECTION_HEADING);

  expect(index).toBeGreaterThan(-1);

  const heading: string | undefined = fs
    .readFileSync(path.join(CONTENT_DIR, language, `${CODE_PAGE}.md`), "utf8")
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("#");
    })[index];

  expect(heading).toBeDefined();

  return slugifyMarkdownHeading(heading!.replace(/^#+\s+/, ""));
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on a code repository's Runner", () => {
  it("is a note of the 13 → 14 changes, once, after the note on visitor addresses and before the note on auto remediation rules' Runners", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("says where a repository picks its Runner, what the upgrade carries over, and what a Runner now takes", () => {
    for (const claim of [
      "A repository's settings in Code pick the Runner AI works in it on, and one that picks none works on a global Runner while its project uses them.",
      "The upgrade carries each project's choice over: its repositories pick the Runner it had **Runs AI Code Fixes** on for (the one heard from most recently), and the switch is removed.",
      "A Runner now takes code work only for the repositories that pick it, and only it is given a token for them; one no repository picks takes none.",
    ]) {
      expect({ claim, said: ENGLISH_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }

    expect(ENGLISH_NOTE).toContain(
      `[Pick the repository's Runner](/docs/${CODE_PAGE}#${sectionAnchor("en")})`,
    );
  });
});

describe("the note is true to the upgrade", () => {
  const migration: string = source(
    "Common/Server/Infrastructure/Postgres/SchemaMigrations/1804300000000-AddCodeRepositoryRunner.ts",
  );

  it("gives each project's repositories the Runner it had the switch on for, the one heard from most recently, and drops the switch", () => {
    expect(migration).toContain(`runner."canRunCodeFixTasks" = true`);
    expect(migration).toContain(
      `ORDER BY runner."projectId", runner."lastAlive" DESC`,
    );
    expect(migration).toContain(`"repository"."runnerId" IS NULL`);
    expect(migration).toContain(
      'ALTER TABLE "Runner" DROP COLUMN "canRunCodeFixTasks"',
    );
    expect(source("Common/Models/DatabaseModels/Runner.ts")).not.toContain(
      "canRunCodeFixTasks",
    );
  });

  /*
   * Empty still means a global Runner in a project with no default Runner;
   * one with a default has its repositories follow it since a later change
   * (CodeRepositoryDefaultRunnerUpgradeDocs), which kept every repository
   * this note's upgrade left on a global Runner there.
   */
  it("holds a repository's Runner on the repository, empty for a global Runner where the project has no default", () => {
    const repository: string = source(
      "Common/Models/DatabaseModels/CodeRepository.ts",
    );

    expect(repository).toContain("public runnerId?: ObjectID = undefined;");
    expect(repository).toContain(
      "Empty means the project's default Runner when it has one, and otherwise a global Runner, one OneUptime runs for every project.",
    );
  });

  it("hands a repository's token only to the worker the repository picks", () => {
    expect(source("Common/Server/API/AIAgentDataAPI.ts")).toContain(
      "new BadDataException(CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL)",
    );
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, naming the switch as it was and linking its own Code page's section",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(language, LEAD),
      );

      // The switch no longer exists: named as it was, in English.
      expect(note).toContain("**Runs AI Code Fixes**");

      // The section, in the reader's own language.
      expect(note).toContain(`(/docs/${CODE_PAGE}#${sectionAnchor(language)})`);

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
    },
  );
});
