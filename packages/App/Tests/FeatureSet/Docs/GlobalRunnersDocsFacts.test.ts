import { anchorsOf, readPage } from "./DocsContentSupport";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import Project from "Common/Models/DatabaseModels/Project";
import Permission from "Common/Types/Permission";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { MAX_STEP_EXECUTION_TIMEOUT_IN_MS } from "Common/Types/Runbook/RunbookStepTimeout";
import {
  GLOBAL_RUNNER_KEY_ENV,
  GLOBAL_RUNNER_REPLICAS_ENV,
} from "Common/Types/Runner/BundledGlobalRunner";
import {
  GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
  GLOBAL_RUNNER_STEP_TYPES,
  MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT,
} from "Common/Types/Runner/GlobalRunnerWork";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English docs say about global Runners - the Runners OneUptime runs
 * for every project - held to the code that makes it true. The section is
 * "Global Runners" on runbooks/agents (the Admin Dashboard's Global Runners
 * page links to it), with what the other runbook pages, the Docker Compose
 * guide and the upgrade guide say about them:
 *
 *   - what a global Runner runs (GlobalRunnerWork), for how long, how many
 *     of one project's steps at once, and what it is handed;
 *   - the Dashboard words the pages name (the Runners page, the step picker,
 *     the variables form, the project's switch) are the ones drawn;
 *   - where they come from: the bundled one (Docker Compose global-runner,
 *     Helm globalRunner, GLOBAL_RUNNER_KEY), how it is turned off
 *     (GLOBAL_RUNNER_REPLICAS=0, globalRunner.enabled), and the Admin
 *     Dashboard's page for more;
 *   - the server's words the pages quote.
 *
 * The translations are held to these English pages by
 * RunbookDocsTranslations (and the upgrade note by UpgradingDocsTranslations).
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const AGENTS: string = readPage("en", "runbooks/agents");
const INDEX: string = readPage("en", "runbooks/index");
const AUTHORING: string = readPage("en", "runbooks/authoring");
const RUNNING: string = readPage("en", "runbooks/running");
const VARIABLES: string = readPage("en", "runbooks/variables");
const CONFIGURATION: string = readPage("en", "runbooks/configuration");
const COMPOSE: string = readPage("en", "installation/docker-compose");

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const GLOBAL_RUNNERS_COPY: string = readSource(
  `${DASHBOARD}/Components/Runner/GlobalRunnersCopy.ts`,
);
const RUNNER_PICKER_MODEL: string = readSource(
  `${DASHBOARD}/Components/Runner/RunnerPickerModel.ts`,
);
// The variables form, which asks who may use a secret.
const VARIABLES_TABLE: string = readSource(
  `${DASHBOARD}/Components/Runbook/RunbookVariablesTable.tsx`,
);
const VARIABLE_COPY: string = readSource(
  `${DASHBOARD}/Components/Runbook/RunbookVariableCopy.ts`,
);
// The one rule for which variables a step's Runner is handed.
const VARIABLE_RESOLVER: string = readSource(
  "packages/Common/Server/Utils/Runbook/RunbookVariableResolver.ts",
);
const VARIABLE_PROBLEMS: string = readSource(
  "packages/Common/Types/Runbook/RunbookVariableProblems.ts",
);
const RUNNER_JOB_SERVICE: string = readSource(
  "packages/Common/Server/Services/RunnerJobService.ts",
);
const RUNNER_INGRESS: string = readSource(
  "packages/App/FeatureSet/Runbook/API/RunnerIngress.ts",
);
const ADMIN_PAGE: string = readSource(
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalRunners/Index.tsx",
);
const ADMIN_LOCALE: Record<string, unknown> = JSON.parse(
  readSource("packages/App/FeatureSet/AdminDashboard/src/Locales/en.json"),
);

// The text of the "## " section with this heading, up to the next "## ".
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n## ${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const rest: string = markdown.slice(start + heading.length + 5);
  const end: number = rest.indexOf("\n## ");

  return end === -1 ? rest : rest.slice(0, end);
}

const SECTION: string = section(AGENTS, "Global Runners");

describe("the Global Runners section of runbooks/agents", () => {
  it("is where the Admin Dashboard's Global Runners page sends a master admin", () => {
    expect(ADMIN_PAGE).toContain('"/docs/runbooks/agents#global-runners"');
    expect(anchorsOf("en", "runbooks/agents").has("global-runners")).toBe(true);
    expect(AGENTS).toContain(
      "- [Global Runners](#global-runners): The Runners OneUptime runs for every project, and what they run.",
    );
  });

  it("says global Runners run JavaScript steps only, as GlobalRunnerWork has it", () => {
    expect([...GLOBAL_RUNNER_STEP_TYPES]).toEqual([RunbookStepType.JavaScript]);
    expect(SECTION).toContain("| Steps it runs | JavaScript |");
    expect(SECTION).toContain(
      "A JavaScript step that picks no Runner of its own runs on one",
    );
  });

  /*
   * An AI rule that picks no Runner shows the Global Runner ("If there are
   * no runners, it should use the global runner by default" - the
   * maintainer), and a shell never runs on a host every project shares: so
   * OneUptime AI's Bash commands run on a Runner of the project's own that
   * an AI rule picks, never on a global one. The table says so in a row of
   * its own, as GlobalRunnerWork has it.
   */
  it("says a global Runner never runs OneUptime AI's Bash commands, and a Runner of your own runs those of the AI rules that pick it", () => {
    expect(GLOBAL_RUNNER_STEP_TYPES).not.toContain(RunbookStepType.Bash);
    expect(SECTION).toContain(
      "| OneUptime AI's Bash commands | Never | For the AI rules that pick it |",
    );
  });

  it("gives the longest a step runs on each as the code holds it", () => {
    expect(GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS).toBe(5 * 60 * 1000);
    expect(MAX_STEP_EXECUTION_TIMEOUT_IN_MS).toBe(60 * 60 * 1000);
    expect(SECTION).toContain("| Longest a step runs | 5 minutes | 1 hour |");
    expect(AUTHORING).toContain(
      "A global Runner runs it for 5 minutes at most.",
    );
    expect(CONFIGURATION).toContain("for 5 minutes at most,");
  });

  it("gives how many of one project's steps run at once", () => {
    expect(MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT).toBe(3);
    expect(SECTION).toContain(
      "A project runs at most three steps on global Runners at once",
    );
    expect(CONFIGURATION).toContain(
      "at most three of one project's steps at once",
    );
  });

  it("names what keeps one project's step apart from another's", () => {
    for (const sentence of [
      "Each step runs in an `isolated-vm` sandbox of its own, made for that step and thrown away after it",
      "Its HTTP requests reach public internet addresses only, never a private, loopback or link-local address or a cloud metadata endpoint, so a global Runner never reaches your network.",
      "It gets a secret variable only when the variable's **Global Runners can use it** switch is on, and only for a step of the variable's own project.",
    ]) {
      expect(SECTION).toContain(sentence);
    }

    // Runbook credentials are gone: no Runner is handed one, global or not.
    expect(SECTION).not.toContain("credential");

    // The secrets a global Runner is handed: its step's own project's, switched on.
    expect(VARIABLE_RESOLVER).toContain(
      'if (data.access.kind === "global-runner") {',
    );
    expect(VARIABLE_RESOLVER).toContain(
      "return toStoredBoolean(data.row.isAvailableToGlobalRunners) === true",
    );
    // A job that still names a runbook credential is failed, not handed over.
    expect(RUNNER_INGRESS).toContain(
      "errorMessage: RunnerIngressAPI.getRemovedCredentialRefusal(job),",
    );
    expect(RUNNER_INGRESS).not.toContain("GLOBAL_RUNNER_CREDENTIAL_REFUSAL");
  });

  it("names the Dashboard's words as the Dashboard draws them", () => {
    expect(GLOBAL_RUNNERS_COPY).toContain(
      'globalCardTitle: translationKey("Global Runners")',
    );
    expect(GLOBAL_RUNNERS_COPY).toContain(
      'switchTitle: translationKey("Use global Runners")',
    );
    expect(RUNNER_PICKER_MODEL).toContain('translationKey("Global Runner")');
    expect(VARIABLE_COPY.replace(/\s+/g, " ")).toContain(
      'GLOBAL_RUNNERS_CAN_USE_TITLE: string = translationKey( "Global Runners can use it", );',
    );
    expect(VARIABLES_TABLE).toContain("title: GLOBAL_RUNNERS_CAN_USE_TITLE,");

    expect(SECTION).toContain("lists them under **Global Runners**");
    expect(SECTION).toContain("offers **Global Runner** first");
    expect(SECTION).toContain(
      "turn **Use global Runners** off at the bottom of **Runbooks → Runners**",
    );
  });

  it("says who may turn global Runners off for a project", () => {
    const columnAccess: { update: Array<Permission> } =
      new Project().getColumnAccessControlFor(
        "useGlobalRunners",
      )! as unknown as {
        update: Array<Permission>;
      };

    expect(columnAccess.update).toContain(Permission.EditProject);
    expect(AGENTS).toContain(
      "turning **Use global Runners** off takes the permission to edit the project.",
    );
  });

  it("says where the bundled one comes from, and how it is turned off", () => {
    expect(GLOBAL_RUNNER_KEY_ENV).toBe("GLOBAL_RUNNER_KEY");
    expect(GLOBAL_RUNNER_REPLICAS_ENV).toBe("GLOBAL_RUNNER_REPLICAS");

    expect(readSource("docker-compose.yml")).toContain("  global-runner:\n");
    expect(readSource("docker-compose.base.yml")).toContain(
      "replicas: ${GLOBAL_RUNNER_REPLICAS:-1}",
    );
    expect(readSource("HelmChart/Public/oneuptime/values.yaml")).toContain(
      "globalRunner:\n  enabled: true\n",
    );

    expect(inlineCode(SECTION)).toEqual(
      expect.arrayContaining([
        "global-runner",
        "globalRunner",
        "GLOBAL_RUNNER_KEY",
        "GLOBAL_RUNNER_REPLICAS=0",
        "config.env",
        "globalRunner.enabled",
        "false",
      ]),
    );
  });

  it("walks a master admin to the Admin Dashboard's page for more", () => {
    const sideMenu: Record<string, string> = ADMIN_LOCALE["sideMenu"] as Record<
      string,
      string
    >;
    const page: Record<string, string> = (
      (ADMIN_LOCALE["pages"] as Record<string, unknown>)["settings"] as Record<
        string,
        Record<string, string>
      >
    )["globalRunners"] as Record<string, string>;

    expect(sideMenu["settingsGlobalRunners"]).toBe("Global Runners");
    expect(page["showIdKey"]).toBe("Show ID and Key");
    expect(SECTION).toContain(
      "in the Admin Dashboard, open **Settings**, then **Global Runners**, create one, and run the command its **Show ID and Key** gives",
    );
  });
});

describe("the server's words the pages quote", () => {
  it("a step no global Runner picked up", () => {
    const message: string =
      "No global Runner picked up this step before the wait window expired.";

    expect(RUNNER_JOB_SERVICE).toContain(message);
    expect(AGENTS).toContain(`"${message}"`);
    expect(RUNNING).toContain(`"${message}"`);
  });

  it("a step that names a secret its Runner may not use", () => {
    expect(VARIABLE_PROBLEMS).toContain(
      "This step names variables it cannot use, so it was not run: ${text}.",
    );
    expect(VARIABLE_PROBLEMS).toContain(
      'turn on "Global Runners can use it" for',
    );
    expect(AGENTS).toContain(
      ":::details A step fails because its Runner may not use a secret variable",
    );
    expect(AGENTS).toContain("The error names the secret and what to change.");
    expect(VARIABLES).toContain(
      "A step that names a secret its Runner may not use fails, naming the secret and what to change, and nothing is handed over.",
    );
  });
});

describe("the other runbook pages", () => {
  it("no longer say every script runs in your own infrastructure", () => {
    expect(INDEX).not.toContain(
      "so your scripts never run on OneUptime's servers",
    );
    expect(INDEX).toContain(
      "on a [global Runner](/docs/runbooks/agents#global-runners), in a sandbox that reaches the internet only.",
    );
    expect(AUTHORING).not.toContain(
      "**A Runner, for JavaScript, Bash, SSH and kubectl steps.**",
    );
    expect(AUTHORING).toContain(
      "**A Runner, for Bash, SSH and kubectl steps.**",
    );
  });

  it("say a JavaScript step's Runner, under More fields, starts on the project's default Runner, else on Global Runner", () => {
    expect(AUTHORING).toContain(
      "| **Runner** | Under **More fields**. The Runner that runs the step: **Global Runner**, or one of yours.",
    );
    expect(AUTHORING).toContain(
      "| The project's [default Runner](/docs/runbooks/agents#the-projects-default-runner), if you set one; otherwise **Global Runner**, when there is one |",
    );
  });

  it("say a Bash, SSH or kubectl step's dropdown shows the Global Runner, greyed out, with why", () => {
    expect(RUNNER_PICKER_MODEL).toContain(
      'translationKey(\n  "Runs JavaScript steps only.",\n)',
    );
    expect(SECTION).toContain(
      "A Bash, SSH or kubectl step's dropdown shows it last, greyed out, saying **Runs JavaScript steps only.** Those steps run on a Runner of your own, inside your network, never on one every project shares.",
    );
  });

  it("say the variables form asks about global Runners on a server that has them", () => {
    expect(VARIABLES_TABLE).toContain("...(hasGlobalRunners");
    expect(VARIABLES).toContain(
      "On a server with [global Runners](/docs/runbooks/agents#global-runners), **Global Runners can use it** also lets this project's steps that run on a global Runner use the secret: it starts on while the project uses global Runners.",
    );
  });
});

describe("the install and upgrade guides", () => {
  it("the Docker Compose guide names the global Runner's key among the secrets it fills in", () => {
    expect(COMPOSE).toContain(
      "| `GLOBAL_RUNNER_KEY` | The bundled global Runner, which runs every project's JavaScript steps and AI code fixes. |",
    );
  });

  it("the upgrade guide has a note on the bundled global Runner, with the settings it names", () => {
    const note: string | undefined = otherChangesItems("en").find(
      (item: string): boolean => {
        return flattened(item).startsWith(
          "- **Every install runs a global Runner of its own.**",
        );
      },
    );

    expect(note).toBeDefined();
    expect(inlineCode(flattened(note!))).toEqual(
      [
        "GLOBAL_RUNNER_KEY",
        "GLOBAL_RUNNER_REPLICAS=0",
        "config.env",
        "false",
        "global-runner",
        "globalRunner",
        "globalRunner.enabled",
        "npm run update",
        "npm start",
      ].sort(),
    );
    expect(flattened(note!)).toContain(
      "[Global Runners](/docs/runbooks/agents#global-runners)",
    );
  });
});
