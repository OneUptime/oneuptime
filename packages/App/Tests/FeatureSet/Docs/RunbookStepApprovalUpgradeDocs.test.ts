import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { REQUIRE_APPROVAL_TITLE } from "../../../FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookStepEditorModel";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import {
  APPROVAL_AFTER_LAST_STEP_TITLE,
  moveApprovalsBeforeTheirSteps,
} from "Common/Types/Runbook/RunbookStepApproval";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says a runbook step asks for approval before it
 * runs - the switch sits on the step it holds back - held to the code that
 * makes it true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits after the
 * note on auto remediation rules (AutoRemediationRunnerUpgradeDocs) and
 * before the endpoint pointer, and every translation carries it in the
 * English note's place, naming the switch the way the reader's Dashboard
 * draws it, keeping the title of the step the upgrade adds in English (a
 * step's title is shown as it was written), and linking the authoring
 * page's section on approvals in the reader's language. What it claims is
 * what the upgrade does:
 *
 *   - an approval after a step becomes one before the next step, the step a
 *     Manual step follows keeps its stop in that Manual step, and an
 *     approval after the last step becomes a Manual step at the end,
 *     "Approve the result" (moveApprovalsBeforeTheirSteps, which the data
 *     migration writes once and every run reads);
 *   - runs already started keep stopping after such a step (RunRunbook);
 *   - requireApproval still works and a save is stored as it was sent, so a
 *     Terraform configuration plans one update and then reads back as it
 *     wrote it.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LEAD: string = "A runbook step asks for approval before it runs.";
const NOTE_LEAD: string = `**${LEAD}**`;
// The note before it (AutoRemediationRunnerUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**OneUptime AI fixes with any runbook, or only the ones a rule allows, and a rule picks its Runner.**";
// The note after it (CodeRepositoryDefaultRunnerUpgradeDocs).
const NEXT_LEAD: string =
  "**A code repository that picks no Runner follows the project's default Runner.**";

const AUTHORING_PAGE: string = "runbooks/authoring";
const SECTION_HEADING: string = "## Failure handling and approvals";

// The API's names, in the order the note gives them.
const CODE: Array<string> = [
  "requireApprovalBeforeRunning",
  "requireApproval",
  "steps",
];

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// The anchor of the authoring page's section on approvals, per language.
function sectionAnchor(language: string): string {
  const headingsOf: (code: string) => Array<string> = (
    code: string,
  ): Array<string> => {
    return fs
      .readFileSync(
        path.join(CONTENT_DIR, code, `${AUTHORING_PAGE}.md`),
        "utf8",
      )
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

// The inline code of a note, in order.
function inlineCode(note: string): Array<string> {
  return Array.from(note.matchAll(/`([^`]+)`/g), (match: RegExpMatchArray) => {
    return match[1] as string;
  });
}

function step(
  id: string,
  type: RunbookStepType,
  extra: Partial<RunbookStep> = {},
): RunbookStep {
  return {
    id,
    order: Number(id.replace(/\D/g, "")),
    type,
    title: id,
    config: {},
    ...extra,
  } as RunbookStep;
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on runbook step approvals", () => {
  it("is a note of the 13 → 14 changes, once, after the note on auto remediation rules and before the note on code repositories following the default Runner", () => {
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

  it("says where the switch sits, what the upgrade moves, what runs already started do, and what the API and Terraform see", () => {
    for (const claim of [
      `The approval switch sits on the step it holds back, **${REQUIRE_APPROVAL_TITLE}**, not on the step before it.`,
      `The upgrade moves every runbook's approvals so each stops where it did: an approval after a step is an approval before the next step, an approval after a step that a Manual step follows is that Manual step's own stop, and one after the last step is a Manual step at the end, **${APPROVAL_AFTER_LAST_STEP_TITLE}**.`,
      "Runs already started finish as they started.",
      "In the API and Terraform the switch is `requireApprovalBeforeRunning`; `requireApproval` still works and means an approval after that step, so a Terraform configuration that turns it on plans one in-place update of `steps` after the upgrade, and applying it changes nothing about how the runbook runs.",
    ]) {
      expect({ claim, said: ENGLISH_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }

    expect(inlineCode(ENGLISH_NOTE)).toEqual(CODE);
    expect(ENGLISH_NOTE).toContain(
      `[Failure handling and approvals](/docs/${AUTHORING_PAGE}#${sectionAnchor("en")})`,
    );
  });
});

describe("the note is true to the upgrade", () => {
  it("moves an approval after a step to the next step, into a Manual step that follows, and after the last step into a Manual step at the end", () => {
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("s1", RunbookStepType.Bash, { requireApproval: true }),
      step("s2", RunbookStepType.HttpRequest, { requireApproval: true }),
      step("s3", RunbookStepType.Manual),
      step("s4", RunbookStepType.JavaScript, { requireApproval: true }),
    ]);

    expect(
      moved.map((each: RunbookStep) => {
        return [
          each.type,
          each.title,
          each.requireApprovalBeforeRunning === true,
          "requireApproval" in each,
        ];
      }),
    ).toEqual([
      [RunbookStepType.Bash, "s1", false, false],
      // An approval after step 1 is one before step 2.
      [RunbookStepType.HttpRequest, "s2", true, false],
      // The Manual step after step 2 is the stop already.
      [RunbookStepType.Manual, "s3", false, false],
      [RunbookStepType.JavaScript, "s4", false, false],
      // The approval after the last step: a Manual step at the end.
      [RunbookStepType.Manual, APPROVAL_AFTER_LAST_STEP_TITLE, false, false],
    ]);
  });

  it("writes every stored runbook once, and reads every run's steps the same way", () => {
    const migrations: string = source(
      "App/FeatureSet/Workers/DataMigrations/Index.ts",
    );
    const starter: string = source(
      "Common/Server/Utils/Runbook/RunbookStarter.ts",
    );

    expect(migrations).toContain("new MoveRunbookApprovalsBeforeTheirSteps(),");
    expect(starter).toContain("moveApprovalsBeforeTheirSteps(steps)");
  });

  it("lets a run that started before the upgrade stop after the step, as it started", () => {
    expect(source("App/FeatureSet/Runbook/Services/RunRunbook.ts")).toContain(
      "if (hasApprovalAfterStep(stepExec.step)) {",
    );
  });

  it("stores a save as it was sent, so Terraform reads back what it wrote", () => {
    expect(source("Common/Server/Services/RunbookService.ts")).not.toMatch(
      /requireApproval|moveApprovalsBeforeTheirSteps/,
    );
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, naming the switch as its Dashboard draws it, keeping the added step's title, and linking its own authoring section",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(language, LEAD),
      );

      expect(note).toContain(
        `**${drawnDashboardLabel(language, REQUIRE_APPROVAL_TITLE)}**`,
      );
      // A step's title, which every Dashboard shows as it was written.
      expect(note).toContain(`**${APPROVAL_AFTER_LAST_STEP_TITLE}**`);
      expect(inlineCode(note)).toEqual(CODE);

      // The section, in the reader's own language.
      expect(note).toContain(
        `(/docs/${AUTHORING_PAGE}#${sectionAnchor(language)})`,
      );

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
      expect(note).not.toContain(LEAD);
    },
  );
});
