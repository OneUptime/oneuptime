import { anchorsOf, readPage } from "./DocsContentSupport";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import {
  ProjectDefaultRunnerRefusal,
  getProjectDefaultRunnerRefusal,
} from "Common/Types/Runner/ProjectDefaultRunner";
import {
  RunnerChoiceRefusal,
  RunnerDefaultOrderResult,
  RunnerSource,
  decideRunnerByDefaultOrder,
} from "Common/Types/Runner/RunnerChoice";
import { canGlobalRunnersRunStepType } from "Common/Types/Runner/GlobalRunnerWork";
import {
  CodeRepositoryRunnerChoiceKind,
  decideCodeRepositoryRunner,
} from "Common/Types/Runner/CodeRepositoryRunner";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { ProjectDefaultRunnerCopy } from "../../../FeatureSet/Dashboard/src/Components/Runner/ProjectDefaultRunnerCopy";
import {
  GLOBAL_RUNNER_CHOICE_LABEL,
  GLOBAL_RUNNER_STEP_TYPE_UNAVAILABLE_TEXT,
  PROJECT_DEFAULT_TAG,
} from "../../../FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE PROJECT'S DEFAULT RUNNER, as the docs tell it - held to the code.
 *
 * The maintainer: "by default select the global runner unless I have custom
 * runner set to default runner for the project (if this doesnt exist, you
 * can build that as well - just like we set twilio credentials as default
 * for the project)". So runbooks/agents has a section on it, which the
 * other runbook pages link to wherever they say where a step that picked no
 * Runner runs. What it says is held here to what the product does:
 *
 *   - the order a step that picked no Runner follows, row by row, is the
 *     one rule's (RunnerChoice.decideRunnerByDefaultOrder);
 *   - the Runners that may be the default are the ones the server lets be
 *     it (ProjectDefaultRunner), and the one that is keeps Runs Runbooks on
 *     (RunnerService refuses turning it off);
 *   - the Dashboard words it names - the ⋯ menu's actions, the dialog's
 *     button, the Runner page's card and switch, the pill - are the ones
 *     drawn, in English and in every language's translation.
 *
 * The translations' shape (the same headings, tables and lists) is
 * RunbookDocsTranslations'.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

const AGENTS: string = readPage("en", "runbooks/agents");
const AUTHORING: string = readPage("en", "runbooks/authoring");
const RUNNING: string = readPage("en", "runbooks/running");
const CONFIGURATION: string = readPage("en", "runbooks/configuration");
const INDEX: string = readPage("en", "runbooks/index");

const RUNNER_SERVICE: string = readSource(
  "Common/Server/Services/RunnerService.ts",
);
const RUNNER_MODEL: string = readSource(
  "Common/Models/DatabaseModels/Runner.ts",
);

const HEADING: string = "The project's default Runner";
const ANCHOR: string = "the-projects-default-runner";
const LINK: string = `/docs/runbooks/agents#${ANCHOR}`;

// The text of the "## " section with this heading, up to the next "## ".
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n## ${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const rest: string = markdown.slice(start + heading.length + 5);
  const end: number = rest.indexOf("\n## ");

  return end === -1 ? rest : rest.slice(0, end);
}

const SECTION: string = section(AGENTS, HEADING);

// The table's row for a project, as the section writes it.
function tableRow(project: string): Array<string> {
  const row: string | undefined = SECTION.split("\n").find(
    (line: string): boolean => {
      return line.startsWith(`| ${project} |`);
    },
  );

  expect({ project, found: Boolean(row) }).toEqual({ project, found: true });

  return row!
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

// What a step of this type that picked no Runner runs on, in the table's words.
function wordsFor(
  result: RunnerDefaultOrderResult,
  stepType: RunbookStepType,
): string {
  switch (result.source) {
    case RunnerSource.ProjectDefault:
      return "The default Runner";
    case RunnerSource.Global:
      return "A global Runner";
    case RunnerSource.None:
      return result.refusal === RunnerChoiceRefusal.NeedsOwnRunner
        ? "Nowhere: the step fails, saying it has no Runner"
        : "Nowhere: the step fails, saying so";
    case RunnerSource.Picked:
      throw new Error(`A ${stepType} step that picked no Runner picked one`);
    default:
      throw new Error("Unknown source");
  }
}

describe("the project's default Runner on runbooks/agents", () => {
  it("has a section of its own, on the page's cards, that the other runbook pages link to", () => {
    expect(anchorsOf("en", "runbooks/agents").has(ANCHOR)).toBe(true);
    expect(AGENTS).toContain(
      `- [${HEADING}](#${ANCHOR}): The Runner a step or a code repository works on when it picks none.`,
    );

    for (const [page, markdown] of [
      ["authoring", AUTHORING],
      ["running", RUNNING],
      ["configuration", CONFIGURATION],
      ["index", INDEX],
    ] as Array<[string, string]>) {
      expect({ page, links: markdown.includes(`](${LINK})`) }).toEqual({
        page,
        links: true,
      });
    }
  });

  it("gives the order a step that picked no Runner follows, row by row, as the one rule decides it", () => {
    const rows: Array<{
      project: string;
      projectDefaultRunnerId: string;
      projectUsesGlobalRunners: boolean;
    }> = [
      {
        project: "Has a default Runner",
        projectDefaultRunnerId: "8d1c5f3e-2a41-4f7b-9c55-0d6e1b2a3c4d",
        projectUsesGlobalRunners: true,
      },
      {
        project: "Has none, and uses global Runners",
        projectDefaultRunnerId: "",
        projectUsesGlobalRunners: true,
      },
      {
        project: "Has none, and does not use global Runners",
        projectDefaultRunnerId: "",
        projectUsesGlobalRunners: false,
      },
    ];

    expect(SECTION).toContain(
      "| The project | A JavaScript step | A Bash, SSH or kubectl step |",
    );

    for (const row of rows) {
      const cells: Array<string> = tableRow(row.project);

      [RunbookStepType.JavaScript, RunbookStepType.Bash].forEach(
        (stepType: RunbookStepType, index: number): void => {
          const result: RunnerDefaultOrderResult = decideRunnerByDefaultOrder({
            chosenRunnerId: "",
            projectDefaultRunnerId: row.projectDefaultRunnerId,
            canGlobalRunnersRunWork: canGlobalRunnersRunStepType(stepType),
            projectUsesGlobalRunners: row.projectUsesGlobalRunners,
            hasGlobalRunner: true,
          });

          expect({
            project: row.project,
            stepType,
            cell: cells[index + 1],
          }).toEqual({
            project: row.project,
            stepType,
            cell: wordsFor(result, stepType),
          });
        },
      );
    }

    // SSH and kubectl steps are Bash's column: global Runners never run them.
    for (const stepType of [RunbookStepType.SSH, RunbookStepType.Kubernetes]) {
      expect(canGlobalRunnersRunStepType(stepType)).toBe(false);
    }
  });

  it("says a step that picked a Runner keeps it, and that a JavaScript step can still pick the Global Runner", () => {
    const picked: RunnerDefaultOrderResult = decideRunnerByDefaultOrder({
      chosenRunnerId: "3f0c2b7a-1d9e-4c6b-8a25-7e4d9c1b0a5f",
      projectDefaultRunnerId: "8d1c5f3e-2a41-4f7b-9c55-0d6e1b2a3c4d",
      canGlobalRunnersRunWork: false,
      projectUsesGlobalRunners: true,
      hasGlobalRunner: true,
    });

    expect(picked).toEqual({
      source: RunnerSource.Picked,
      runnerId: "3f0c2b7a-1d9e-4c6b-8a25-7e4d9c1b0a5f",
    });

    const pickedGlobal: RunnerDefaultOrderResult = decideRunnerByDefaultOrder({
      chosenRunnerId: "global",
      projectDefaultRunnerId: "8d1c5f3e-2a41-4f7b-9c55-0d6e1b2a3c4d",
      canGlobalRunnersRunWork: true,
      projectUsesGlobalRunners: true,
      hasGlobalRunner: true,
    });

    expect(pickedGlobal).toEqual({ source: RunnerSource.Global });
    expect(SECTION).toContain(
      `A step that picked a Runner keeps it, whatever the default is, and a JavaScript step can still pick **${GLOBAL_RUNNER_CHOICE_LABEL}** itself. Setting a default changes no saved step.`,
    );
  });

  it("names the Runners that may be the default as the server allows them, and keeps Runs Runbooks on for the one that is", () => {
    expect(getProjectDefaultRunnerRefusal({ isGlobalRunner: true })).toBe(
      ProjectDefaultRunnerRefusal.GlobalRunner,
    );
    expect(getProjectDefaultRunnerRefusal({ canRunRunbooks: false })).toBe(
      ProjectDefaultRunnerRefusal.DoesNotRunRunbooks,
    );
    expect(
      getProjectDefaultRunnerRefusal({
        name: "prod-runner",
        canRunRunbooks: true,
      }),
    ).toBeNull();
    expect(Object.values(ProjectDefaultRunnerRefusal).sort()).toEqual(
      [
        ProjectDefaultRunnerRefusal.DoesNotRunRunbooks,
        ProjectDefaultRunnerRefusal.GlobalRunner,
        ProjectDefaultRunnerRefusal.KubernetesAgentRunner,
      ].sort(),
    );

    expect(SECTION).toContain(
      "The default is one of the project's own Runners that runs runbook steps: not a global Runner, not the in-cluster Runner the Kubernetes agent installed, and not one with **Runs Runbooks** off. While a Runner is the default, its **Runs Runbooks** stays on.",
    );
    expect(RUNNER_SERVICE).toContain(
      "describeDefaultRunnerStopsRunningRunbooks(",
    );
    expect(RUNNER_MODEL).toContain('title: "Runs Runbooks"');
  });

  /*
   * A code repository that picks no Runner follows the default, as a step
   * does (Common/Types/Runner/CodeRepositoryRunner), and moves with it: its
   * Runner is read from the project each time, never copied in. An AI rule
   * keeps the Runner it was created on.
   */
  it("says runbook steps and code repositories that pick no Runner use the default and move with it, and an AI rule picks its own", () => {
    const defaultRunnerId: string = "6c4a9f3e-2b1d-4e8a-9f7c-1d2e3f4a5b6c";
    const nextDefaultRunnerId: string = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

    for (const projectDefaultRunnerId of [
      defaultRunnerId,
      nextDefaultRunnerId,
    ]) {
      expect(
        decideCodeRepositoryRunner({
          repositoryRunnerId: null,
          projectDefaultRunnerId: projectDefaultRunnerId,
          projectUsesGlobalRunners: true,
        }),
      ).toEqual({
        kind: CodeRepositoryRunnerChoiceKind.ProjectDefault,
        runnerId: projectDefaultRunnerId,
      });
    }

    expect(SECTION).toContain(
      "Every runbook step that picks no Runner then runs on it: Bash, SSH and kubectl steps, and JavaScript steps, which would otherwise run on a global Runner. So does AI in every code repository that picks no Runner in its settings in Code.",
    );
    expect(SECTION).toContain(
      "Runbook steps and code repositories that pick no Runner use the default, and move with it when another Runner becomes the default. An AI rule picks its own Runner, and a new rule starts on the default.",
    );
    expect(SECTION).not.toContain("Only runbook steps use the default.");
  });
});

describe("the Dashboard words the section names", () => {
  const words: Array<string> = [
    ProjectDefaultRunnerCopy.setDefaultTitle,
    ProjectDefaultRunnerCopy.makeDefaultConfirmButton,
    ProjectDefaultRunnerCopy.stopDefaultTitle,
    ProjectDefaultRunnerCopy.switchCardTitle,
    ProjectDefaultRunnerCopy.switchTitle,
    PROJECT_DEFAULT_TAG,
    GLOBAL_RUNNER_STEP_TYPE_UNAVAILABLE_TEXT,
  ];

  it("are the ones the Runners pages and the step's picker draw", () => {
    expect(words).toEqual([
      "Set as Project Default",
      "Make Project Default",
      "Stop Using as Project Default",
      "Project Default",
      "Use as the project default",
      "Project default",
      "Runs JavaScript steps only.",
    ]);
    expect(ProjectDefaultRunnerCopy.pillText).toBe(PROJECT_DEFAULT_TAG);

    for (const word of words) {
      expect({ word, named: AGENTS.includes(`**${word}**`) }).toEqual({
        word,
        named: true,
      });
    }
  });

  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )("are drawn in %s's own Dashboard words there", (language: string) => {
    const translated: string = readPage(language, "runbooks/agents");

    for (const word of words) {
      const drawn: string = drawnDashboardLabel(language, word);

      expect({
        word,
        drawn,
        named: translated.includes(`**${drawn}**`),
      }).toEqual({ word, drawn, named: true });
    }
  });
});
