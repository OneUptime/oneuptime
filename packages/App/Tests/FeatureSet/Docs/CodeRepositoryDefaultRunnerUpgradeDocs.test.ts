import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import {
  CodeRepositoryRunnerChoiceKind,
  decideCodeRepositoryRunner,
} from "Common/Types/Runner/CodeRepositoryRunner";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says a code repository that picks no Runner follows
 * the project's default Runner, held to the code that makes it true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits after the
 * note on runbook step approvals (RunbookStepApprovalUpgradeDocs) and
 * before the note on requiring SSO for the whole server
 * (RequireSsoSignInUpgradeDocs), and every translation carries it in the
 * English note's place, with Global Runner named as its Dashboard draws it
 * and a link to the Code page's section on the repository's Runner in the
 * reader's language. What it claims is what the change does:
 *
 *   - a repository that picks none works on the project's default Runner,
 *     and on a global Runner in a project with none - the one rule every
 *     reader of a repository's Runner goes by (CodeRepositoryRunner);
 *   - the GitHub App's import no longer copies the default into a new
 *     repository, so nothing stops it following a later default;
 *   - the upgrade keeps each repository where it works: one that picks none
 *     in a project that already has a default picks Global Runner
 *     (KeepCodeRepositoriesOnGlobalRunners), and a pick stays;
 *   - the API's name for that pick is isGlobalRunnerPicked.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LEAD: string =
  "A code repository that picks no Runner follows the project's default Runner.";
const NOTE_LEAD: string = `**${LEAD}**`;
// The note before it (RunbookStepApprovalUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**A runbook step asks for approval before it runs.**";
// The note after it (RequireSsoSignInUpgradeDocs).
const NEXT_LEAD: string =
  "**While the whole server requires SSO, the sign-in pages offer only SSO, and its global providers have one page.**";

const CODE_PAGE: string = "ai/ai-agent";
const SECTION_HEADING: string = "### Pick the repository's Runner";
const GLOBAL_RUNNER: string = "Global Runner";
const API_NAME: string = "isGlobalRunnerPicked";

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
  const headingsOf: (language: string) => Array<string> = (
    of: string,
  ): Array<string> => {
    return fs
      .readFileSync(path.join(CONTENT_DIR, of, `${CODE_PAGE}.md`), "utf8")
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("#");
      });
  };
  const index: number = headingsOf("en").indexOf(SECTION_HEADING);

  expect(index).toBeGreaterThan(-1);

  const heading: string | undefined = headingsOf(language)[index];

  expect(heading).toBeDefined();

  return slugifyMarkdownHeading(heading!.replace(/^#+\s+/, ""));
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on code repositories following the default Runner", () => {
  it("is a note of the 14 changes, once, after the note on runbook step approvals and before the note on requiring SSO", () => {
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

  it("says what changed, what the upgrade keeps, and what the API calls the pick", () => {
    for (const claim of [
      "It used to work on a global Runner even in a project with a default Runner, and a repository the GitHub App imported started on a copy of the default, which a later default did not move.",
      "Now a repository that picks none works on the project's default Runner and moves with it, as a runbook step does; in a project with no default, it works on a global Runner as before.",
      `The upgrade keeps every repository where it works: one that picks none in a project that already has a default Runner picks **${GLOBAL_RUNNER}** instead, and a repository that picked a Runner keeps it.`,
      `In the API and Terraform, \`${API_NAME}\` says a repository picked **${GLOBAL_RUNNER}**.`,
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

describe("the note is true to the change", () => {
  const defaultRunnerId: string = "6c4a9f3e-2b1d-4e8a-9f7c-1d2e3f4a5b6c";

  it("follows the default, moving with it, and works on a global Runner with none", () => {
    for (const runnerId of [
      defaultRunnerId,
      "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    ]) {
      expect(
        decideCodeRepositoryRunner({
          repositoryRunnerId: null,
          projectDefaultRunnerId: runnerId,
          projectUsesGlobalRunners: true,
        }),
      ).toEqual({
        kind: CodeRepositoryRunnerChoiceKind.ProjectDefault,
        runnerId,
      });
    }

    expect(
      decideCodeRepositoryRunner({
        repositoryRunnerId: null,
        projectUsesGlobalRunners: true,
      }),
    ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.Global });
  });

  it("keeps a repository that picked Global Runner on it, and a pick on its Runner", () => {
    expect(
      decideCodeRepositoryRunner({
        repositoryRunnerId: null,
        picksGlobalRunner: true,
        projectDefaultRunnerId: defaultRunnerId,
        projectUsesGlobalRunners: true,
      }),
    ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.Global });

    const picked: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

    expect(
      decideCodeRepositoryRunner({
        repositoryRunnerId: picked,
        projectDefaultRunnerId: defaultRunnerId,
        projectUsesGlobalRunners: true,
      }),
    ).toEqual({
      kind: CodeRepositoryRunnerChoiceKind.Custom,
      runnerId: picked,
    });
  });

  it("copies no Runner into a repository the GitHub App imports", () => {
    expect(
      source("Common/Server/Services/CodeRepositoryService.ts"),
    ).not.toContain("findProjectDefaultRunnerId(");
  });

  it("writes Global Runner only for the repositories that pick none in a project that has a default, at the upgrade", () => {
    const migration: string = source(
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1807710000000-KeepCodeRepositoriesOnGlobalRunners.ts",
    );

    expect(migration).toContain(`SET "isGlobalRunnerPicked" = true`);
    expect(migration).toContain(`"codeRepository"."runnerId" IS NULL`);
    expect(migration).toContain(`"defaultRunner"."isProjectDefault" = true`);
    // Registered, so the upgrade runs it.
    expect(
      source("Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts"),
    ).toContain("KeepCodeRepositoriesOnGlobalRunners1807710000000,");
  });

  it("names the pick as the API does", () => {
    const repository: string = source(
      "Common/Models/DatabaseModels/CodeRepository.ts",
    );

    expect(repository).toContain(`public ${API_NAME}?: boolean = undefined;`);
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, naming Global Runner as its Dashboard draws it and linking its own Code page's section",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(language, LEAD),
      );

      expect(note).toContain(`\`${API_NAME}\``);
      expect(note).toContain(
        `**${drawnDashboardLabel(language, GLOBAL_RUNNER)}**`,
      );
      expect(note).toContain(`(/docs/${CODE_PAGE}#${sectionAnchor(language)})`);

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
    },
  );
});
