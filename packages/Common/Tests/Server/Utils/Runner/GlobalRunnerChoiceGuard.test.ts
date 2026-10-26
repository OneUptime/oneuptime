import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE RULE AND ONE PICKER FOR WHERE A STEP RUNS, HELD.
 *
 * A step that picks no Runner of its own runs on the global Runners - the
 * Runners OneUptime runs for every project - only when the one rule says so
 * (Types/Runner/RunnerChoice.decideRunnerChoice, read on the server by
 * Utils/Runner/GlobalRunnerChoice.decideForStep): a type global Runners run,
 * a project that uses them, a global Runner there to run it. And a person
 * picks a step's Runner with the one picker (Dashboard
 * Components/Runner/RunnerPicker, fed by RunnerChoicesLoader), which offers
 * the same choice in the same order and words wherever a Runner is picked.
 *
 * A second path to either would skip what the rule checks, or show people a
 * choice the server does not make. This reads the sources and fails on a
 * new one:
 *
 *   - only the files below name RunnerJob.runsOnGlobalRunner, and the one
 *     place that writes it on a job writes it where the rule decided
 *     "global";
 *   - only the files below load Runners in the Dashboard and the Admin
 *     Dashboard; a runbook's Steps page picks with the picker.
 *
 * A new place that sends work to a Runner decides with
 * GlobalRunnerChoice.decideForStep (or decideRunnerChoice) and enqueues as
 * StepExecutors does; a new place where people pick a Runner renders
 * RunnerPicker with RunnerChoicesLoader.load's choices. A place that must do
 * otherwise is added below, with the reason.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES, relativePath), "utf8");
}

// A TypeScript file, and a test of one.
const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

// A job written for the global Runners.
const GLOBAL_JOB_WRITE: RegExp = /\{\s*runsOnGlobalRunner:\s*true\s*\}/;

// StepExecutors' enqueue: a Runner the rule picked, or the global Runners.
const ENQUEUE_AS_DECIDED: RegExp =
  /decision\.kind === "custom"\s*\?\s*\{\s*targetAgentId: new ObjectID\(decision\.runnerId\)\s*\}\s*:\s*\{\s*runsOnGlobalRunner: true\s*\}/;

const SKIPPED_DIRECTORIES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "public",
]);

// The product's TypeScript under a folder: no tests, no build output.
function sourcesUnder(relativeDirectory: string): Array<string> {
  const found: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(path.join(PACKAGES, directory), {
      withFileTypes: true,
    })) {
      const child: string = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(child);
        }
        continue;
      }
      if (
        TYPESCRIPT_FILE.test(entry.name) &&
        !TEST_FILE.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        found.push(child);
      }
    }
  };
  walk(relativeDirectory);
  return found;
}

const SERVER_SOURCES: Array<string> = [
  ...sourcesUnder("Common/Server"),
  ...sourcesUnder("Common/Models"),
  ...sourcesUnder("Common/Types"),
  ...sourcesUnder("App/FeatureSet"),
  ...sourcesUnder("Runner"),
];

// Every file that names the column, and why it may.
const NAMES_RUNS_ON_GLOBAL_RUNNER: Record<string, string> = {
  "Common/Models/DatabaseModels/RunnerJob.ts": "the column",
  "Common/Server/Infrastructure/Postgres/SchemaMigrations/1803950000000-AddGlobalRunners.ts":
    "adds it",
  "Common/Server/Infrastructure/Postgres/SchemaMigrations/1804000000000-AddGlobalRunnerJobIndex.ts":
    "indexes it",
  "Common/Server/Services/RunnerJobService.ts":
    "enqueue's checks, claimNextGlobalJob and the reads that word a timeout",
  "App/FeatureSet/Runbook/Services/StepExecutors.ts":
    "sends a step to the global Runners where GlobalRunnerChoice decided so",
  "App/FeatureSet/Runbook/API/RunnerIngress.ts":
    "tells the global Runner the job it claimed is one",
};

const RUNNER_LOADS: RegExp =
  /ModelAPI\.getList<Runner>|modelType:\s*Runner\b|modelType=\{Runner\}|\btype:\s*Runner,/;

// Every Dashboard and Admin Dashboard file that loads Runners, and why.
const LOADS_RUNNERS: Record<string, string> = {
  "App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices.ts":
    "the one picker's choices: the project's own Runners, the global ones, the switch",
  "App/FeatureSet/Dashboard/src/Components/Runner/GlobalRunnersTable.tsx":
    "Runbooks -> Runners: the global Runners, read-only",
  "App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/Runners.tsx":
    "Runbooks -> Runners: the project's own",
  "App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView.tsx":
    "one Runner's own page",
  "App/FeatureSet/Dashboard/src/Components/Runbook/RunbookVariablesTable.tsx":
    "which of the project's own Runners may use a secret variable; the global Runners have their own switch",
  "App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalRunners/Index.tsx":
    "a master admin's global Runners",
};

describe("where a step runs is decided by one rule", () => {
  test("only these files name RunnerJob.runsOnGlobalRunner", () => {
    const naming: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return read(file).includes("runsOnGlobalRunner");
      },
    ).sort();

    expect(naming).toEqual(Object.keys(NAMES_RUNS_ON_GLOBAL_RUNNER).sort());
  });

  test("the one job written for the global Runners is written where the rule decided so", () => {
    const writers: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return GLOBAL_JOB_WRITE.test(read(file));
      },
    );

    expect(writers).toEqual([
      "App/FeatureSet/Runbook/Services/StepExecutors.ts",
    ]);

    const executors: string = read(
      "App/FeatureSet/Runbook/Services/StepExecutors.ts",
    );
    const decided: number = executors.indexOf(
      "GlobalRunnerChoice.decideForStep(",
    );
    const written: RegExpExecArray | null = ENQUEUE_AS_DECIDED.exec(executors);

    expect(decided).toBeGreaterThan(0);
    expect(written).not.toBeNull();
    expect(decided).toBeLessThan(written!.index);
  });
});

/*
 * The default order - the work's own Runner, its project's default Runner,
 * the Global Runner where the work allows it - is read in one place on the
 * server: GlobalRunnerChoice, which reads the project's default through
 * RunnerService.findProjectDefaultRunner (only a Runner that may be the
 * default: ProjectDefaultRunner). A second reading of it would send a step
 * that picked no Runner somewhere the step editor does not show, or to a
 * default the server passes over. Other work that picks a Runner (an auto
 * remediation or investigation rule) asks
 * GlobalRunnerChoice.decideByDefaultOrder, never the order itself.
 */
const CALLS_THE_DEFAULT_ORDER: RegExp = /\bdecideRunnerByDefaultOrder\(/;
const READS_THE_PROJECT_DEFAULT: RegExp = /\.findProjectDefaultRunner\(/;
const WRITES_THE_PROJECT_DEFAULT: RegExp =
  /defaultColumn:\s*"isProjectDefault"/;
// A query of the default Runner by its column.
const QUERIES_THE_PROJECT_DEFAULT: RegExp = /isProjectDefault\s*:/;

describe("where work that picked no Runner runs is decided by one default order", () => {
  test("only the rule and its server reader call the default order on the server", () => {
    const calling: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        // The Dashboard's picker reads it too: the last test here.
        return (
          !file.startsWith("App/FeatureSet/Dashboard/") &&
          CALLS_THE_DEFAULT_ORDER.test(read(file))
        );
      },
    ).sort();

    expect(calling).toEqual([
      "Common/Server/Utils/Runner/GlobalRunnerChoice.ts",
      "Common/Types/Runner/RunnerChoice.ts",
    ]);
  });

  test("only the server reader reads the project's default Runner", () => {
    const reading: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return READS_THE_PROJECT_DEFAULT.test(read(file));
      },
    ).sort();

    expect(reading).toEqual([
      "Common/Server/Utils/Runner/GlobalRunnerChoice.ts",
    ]);
  });

  test("RunnerService keeps one default per project, once the write succeeded, and reads it by the eligibility rule", () => {
    const service: string = read("Common/Server/Services/RunnerService.ts");

    // Twice: once from onCreateSuccess, once from onUpdateSuccess.
    expect(
      service.match(new RegExp(WRITES_THE_PROJECT_DEFAULT, "g")),
    ).toHaveLength(2);
    expect(service).toContain("ProjectDefaultRow.afterCreate({");
    expect(service).toContain("ProjectDefaultRow.afterUpdate({");

    const reader: string = service.slice(
      service.indexOf("public async findProjectDefaultRunner("),
    );

    expect(reader).toContain("canBeProjectDefaultRunner(runner)");
  });

  test("the step editor's picker follows the same order, from the Dashboard", () => {
    const model: string = read(
      "App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel.ts",
    );

    expect(CALLS_THE_DEFAULT_ORDER.test(model)).toBe(true);
  });

  /*
   * A repository the GitHub App imports, or a connection to another host
   * connects, picks no Runner of its own: it follows the project's default
   * Runner (Types/Runner/CodeRepositoryRunner), read where the work is
   * decided, never copied onto the repository. A copy written at import
   * would keep the repository on the old default once the project made
   * another Runner its default.
   */
  test("a repository the GitHub App imports or a connection connects picks no Runner: it follows the default, which is never copied onto it", () => {
    const service: string = read(
      "Common/Server/Services/CodeRepositoryService.ts",
    );
    const defaults: string = service.slice(
      service.indexOf("public static getNewRepositoryDefaults("),
    );
    const body: string = defaults.slice(0, defaults.indexOf("\n  }\n"));

    expect(body).toContain("isGitHubCommandsEnabled: true,");
    expect(body).not.toContain("runnerId");
    expect(service).not.toContain("findProjectDefaultRunnerId(");
    expect(READS_THE_PROJECT_DEFAULT.test(service)).toBe(false);
    // Never a query of its own for the default (a comment may name it).
    expect(QUERIES_THE_PROJECT_DEFAULT.test(service)).toBe(false);

    // Neither writes a Runner onto a repository it creates.
    const importer: string = service.slice(
      service.indexOf("public async importReposFromInstallation("),
    );
    expect(importer.slice(0, importer.indexOf("\n  }\n"))).not.toMatch(
      /codeRepository\.runnerId\s*=/,
    );

    const connector: string = read(
      "Common/Server/Utils/CodeRepository/CodeHost/CodeRepositoryConnector.ts",
    );
    expect(connector).not.toMatch(/row\.runnerId\s*=/);
    expect(connector).not.toContain("findProjectDefaultRunnerId(");
  });

  /*
   * For a repository, the default is read by CodeRepositoryRunnerChoice
   * alone, through GlobalRunnerChoice: the token, Code's gate, the queue
   * sweeper and the code-fix identity all ask it.
   */
  test("only GlobalRunnerChoice and the repository's server reader read the project's default Runner's id", () => {
    const reading: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return read(file).includes(".findProjectDefaultRunnerId(");
      },
    ).sort();

    expect(reading).toEqual([
      "Common/Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice.ts",
      "Common/Server/Utils/Runner/GlobalRunnerChoice.ts",
    ]);
  });
});

/*
 * Where a code repository's AI work runs is decided by its own one rule
 * (Types/Runner/CodeRepositoryRunner), read on the server by
 * CodeRepositoryRunnerChoice, and - for the claim and the queue depth - as
 * one SQL condition (CodeFixClaimQuery). A second reading would hand a
 * repository's work, or a token for it, to a Runner it did not pick.
 */
// A call of the repository's rule.
const CALLS_THE_REPOSITORY_RULE: RegExp =
  /\b(decideCodeRepositoryRunner|mayWorkInCodeRepository)\(/;

describe("where a repository's AI work runs is decided by one rule", () => {
  test("only the rule and its server reader call the rule", () => {
    const calling: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return CALLS_THE_REPOSITORY_RULE.test(read(file));
      },
    ).sort();

    expect(calling).toEqual([
      "Common/Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice.ts",
      "Common/Types/Runner/CodeRepositoryRunner.ts",
    ]);
  });

  test("only the claim's condition, and the migration that carried the choice over, read a run's repository's Runner in SQL", () => {
    const reading: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return read(file).includes('"repository"."runnerId"');
      },
    ).sort();

    expect(reading).toEqual([
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1804300000000-AddCodeRepositoryRunner.ts",
      "Common/Server/Utils/AI/CodeFix/CodeFixClaimQuery.ts",
    ]);
  });

  /*
   * The claim reads the project's default Runner in SQL, as the rule of
   * Types/Runner/ProjectDefaultRunner reads it - and so does the migration
   * that kept repositories already on a global Runner there. Nothing else
   * reads the default by its column in SQL.
   */
  test("only the claim's condition, and the migration that kept repositories on global Runners, read the project's default Runner in SQL", () => {
    const reading: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return read(file).includes('"defaultRunner"."isProjectDefault"');
      },
    ).sort();

    expect(reading).toEqual([
      "Common/Server/Infrastructure/Postgres/SchemaMigrations/1807710000000-KeepCodeRepositoriesOnGlobalRunners.ts",
      "Common/Server/Utils/AI/CodeFix/CodeFixClaimQuery.ts",
    ]);

    // Both by the same rule a default must meet.
    for (const file of reading) {
      const source: string = read(file);

      for (const part of [
        '"defaultRunner"."isProjectDefault" = true',
        '"defaultRunner"."deletedAt" IS NULL',
        '"defaultRunner"."isGlobalRunner" IS NOT TRUE',
        '"defaultRunner"."canRunRunbooks" IS NOT FALSE',
        `COALESCE(lower(btrim("defaultRunner"."name")), '') NOT LIKE`,
      ]) {
        expect({ file, part, found: source.includes(part) }).toEqual({
          file,
          part,
          found: true,
        });
      }
    }
  });

  /*
   * A repository that picked the Global Runner never follows the default -
   * so every place that asks the repository's rule hands it over. A read
   * that left isGlobalRunnerPicked out would send such a repository's work,
   * and its token, to the project's default Runner.
   */
  test("every server file that asks the repository's rule reads whether it picked the Global Runner", () => {
    const ASKS_THE_RULE: RegExp =
      /CodeRepositoryRunnerChoice\.(getStatusForRepository|mayWorkInRepository|decideForRepository)\(/;

    const asking: Array<string> = SERVER_SOURCES.filter(
      (file: string): boolean => {
        return (
          file !==
            "Common/Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice.ts" &&
          ASKS_THE_RULE.test(read(file))
        );
      },
    ).sort();

    expect(asking).toEqual([
      "Common/Server/API/AIAgentDataAPI.ts",
      "Common/Server/Utils/AI/CodeFix/CodeFixReadiness.ts",
      "Common/Server/Utils/AI/CodeFix/CodeFixRunQueue.ts",
      "Common/Server/Utils/AI/CodeTask/CodeTaskGate.ts",
    ]);

    for (const file of asking) {
      expect({
        file,
        reads: read(file).includes("isGlobalRunnerPicked"),
      }).toEqual({ file, reads: true });
    }

    // The exception page's readiness hands the repository's facts on.
    expect(
      read("Common/Server/Services/TelemetryExceptionService.ts"),
    ).toContain(
      "isGlobalRunnerPicked: resolvedRepository.isGlobalRunnerPicked",
    );
  });
});

describe("a Runner is picked with one picker", () => {
  const UI_SOURCES: Array<string> = [
    ...sourcesUnder("App/FeatureSet/Dashboard/src"),
    ...sourcesUnder("App/FeatureSet/AdminDashboard/src"),
  ];

  test("only these Dashboard and Admin Dashboard files load Runners", () => {
    const loading: Array<string> = UI_SOURCES.filter(
      (file: string): boolean => {
        return RUNNER_LOADS.test(read(file));
      },
    ).sort();

    expect(loading).toEqual(Object.keys(LOADS_RUNNERS).sort());
  });

  /*
   * A code repository's Runner is picked in its settings in Code with the
   * same picker, fed by the same loader's choices for a repository
   * (RunnerChoicesLoader.loadForCodeRepository): Global Runner first, then
   * the project's own Runners.
   */
  test("a code repository's settings pick its Runner with the picker", () => {
    const field: string = read(
      "App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunner.tsx",
    );
    const settings: string = read(
      "App/FeatureSet/Dashboard/src/Pages/Code/Repository/Settings.tsx",
    );

    expect(field).toContain(
      'import RunnerPicker from "../Runner/RunnerPicker";',
    );
    expect(field).toContain("RunnerChoicesLoader.loadForCodeRepository(");
    expect(field).toMatch(
      /<RunnerPicker\s+work=\{RunnerPickerWork\.CodeRepository\}/,
    );
    expect(settings).toMatch(/<CodeRepositoryRunnerPicker\b/);

    for (const source of [field, settings]) {
      expect(RUNNER_LOADS.test(source)).toBe(false);
    }
  });

  test("a runbook's Steps page picks each step's Runner with the picker", () => {
    const steps: string = read(
      "App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx",
    );

    expect(steps).toContain(
      'import RunnerPicker from "../../../Components/Runner/RunnerPicker";',
    );
    expect(steps).toContain("RunnerChoicesLoader.load(");
    expect(steps).toMatch(/<RunnerPicker\b/);
    expect(RUNNER_LOADS.test(steps)).toBe(false);
  });

  /*
   * An AI rule picks the Runner OneUptime AI runs its commands on with the
   * same picker, fed by the loader's choices for a rule
   * (RunnerChoicesLoader.loadForRemediation): the project's own Runners -
   * never the Kubernetes agent's in-cluster ones - and, as for a step, the
   * global Runners that run runbook steps and the project's switch, so a
   * rule that picks none shows the Global Runner: "If there are no runners,
   * it should use the global runner by default" - the maintainer. Picking
   * it picks no Runner of the project's own: none of the rule's commands
   * runs on it (the next block). The choices are read again when the tab
   * comes back into focus.
   */
  test("an AI rule picks its Runner with the picker", () => {
    const fields: string = read(
      "App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleFields.tsx",
    );
    const table: string = read(
      "App/FeatureSet/Dashboard/src/Components/AISettings/AiRulesTable.tsx",
    );
    const loader: string = read(
      "App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices.ts",
    );

    expect(fields).toContain(
      'import RunnerPicker from "../Runner/RunnerPicker";',
    );
    expect(fields).toContain("RunnerChoicesLoader.loadForRemediation(");
    expect(fields).toContain("useRefreshRunnerChoicesOnFocus(");
    expect(fields).toMatch(
      /<RunnerPicker\s+work=\{RunnerPickerWork\.AutoRemediation\}/,
    );
    expect(table).toMatch(/<AutoRemediationRunnerPicker\b/);

    /*
     * The rule's choices hold the global Runners a step's do - the ones
     * that run runbook steps, read from their own route - and the switch.
     */
    const remediationChoices: string = loader.slice(
      loader.indexOf("public static async loadForRemediation("),
      loader.indexOf("public static async loadProjectRunners("),
    );
    expect(remediationChoices.length).toBeGreaterThan(0);
    expect(remediationChoices).toContain(
      "RunnerChoicesLoader.loadGlobalRunners()",
    );
    expect(remediationChoices).toContain(
      "RunnerChoicesLoader.loadProjectUsesGlobalRunners(projectId)",
    );
    expect(remediationChoices).toContain("return runner.runsRunbooks;");
    // Never the in-cluster Runners: they run kubectl for their cluster only.
    expect(remediationChoices).toContain("forCodeRepository: true");

    for (const source of [fields, table]) {
      expect(RUNNER_LOADS.test(source)).toBe(false);
    }
  });

  /*
   * A Kubernetes cluster's AI settings bound a Runner through the same
   * loader (RunnerChoicesLoader.loadForKubernetesCluster), with a runbook
   * credential beside it. Runbook credentials were removed, and the
   * cluster's Runner picker with them: the cluster's Kubernetes AI agent
   * reaches it, and no Runner is picked there.
   */
  test("a Kubernetes cluster's AI settings load no Runner at all", () => {
    const page: string = read(
      "App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Agent.tsx",
    );
    const loader: string = read(
      "App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices.ts",
    );

    expect(page).not.toContain("RunnerChoicesLoader");
    expect(page).not.toContain("RunnerPicker");
    expect(RUNNER_LOADS.test(page)).toBe(false);
    expect(loader).not.toContain("loadForKubernetesCluster");
  });
});

/*
 * A SHELL NEVER RUNS WHERE PROJECTS CANNOT BE KEPT APART.
 *
 * An AI rule that picks no Runner shows the Global Runner, the project's
 * default where it has none of its own. That changes what the rule shows,
 * never where its commands run: a global Runner runs JavaScript steps in a
 * sandbox every project shares, and a shell - a Bash command OneUptime AI
 * composes - cannot be kept apart from the other projects there. Each layer
 * between a rule and a shell holds that on its own, and this reads every
 * one, so none can be dropped by a change that only looked at the picker:
 *
 *   - the picker: global Runners never run a rule's work, and the Global
 *     Runner a rule picks is stored as none - never "global", never an id;
 *   - the engine: OneUptime AI composes commands for a rule only when it
 *     picks a Runner;
 *   - the toolkit: a command's Runner is one of the rule's project's own
 *     that runs AI commands - a global Runner belongs to no project;
 *   - the pick: picking lets a project's own Runner run AI commands, never
 *     a global one;
 *   - the claim: a global Runner is told it runs no AI commands, and is
 *     served runbook jobs only;
 *   - the Runner: a global Runner refuses a command OneUptime AI composed.
 */
describe("OneUptime AI's commands never run on a global Runner, whatever a rule shows", () => {
  function between(source: string, start: string, end: string): string {
    const from: number = source.indexOf(start);
    expect(from).toBeGreaterThanOrEqual(0);
    const to: number = source.indexOf(end, from + start.length);
    expect(to).toBeGreaterThan(from);
    return source.slice(from, to);
  }

  test("the picker: global Runners never run a rule's work, and its Global Runner is stored as none", () => {
    const model: string = read(
      "App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel.ts",
    );
    const fields: string = read(
      "App/FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleFields.tsx",
    );

    const canRun: string = between(
      model,
      "export function canGlobalRunnersRunWork(",
      "\n}\n",
    );
    expect(canRun).toContain(
      "if (facts.work === RunnerPickerWork.AutoRemediation) {\n    return false;\n  }",
    );

    const ruleModel: string = between(
      model,
      "function buildRuleModel(",
      "\n}\n",
    );
    // The Global Runner a rule shows stands for none.
    expect(ruleModel).toContain("value: GLOBAL_RUNNER_CHOICE_VALUE,");
    expect(ruleModel).not.toContain("GLOBAL_RUNNER_PICK_VALUE");
    expect(ruleModel).not.toContain("GLOBAL_RUNNER_CHOICE_ID");
    expect(model).toContain(
      'export const GLOBAL_RUNNER_CHOICE_VALUE: string = "";',
    );
    // A rule that picked none runs no command: NoRunner, on no Runner.
    expect(ruleModel).toContain("outcome: RunnerPickerOutcome.NoRunner,");

    // The form saves that choice as none.
    expect(fields).toContain(
      "runnerId === GLOBAL_RUNNER_CHOICE_VALUE ? null : runnerId,",
    );
  });

  test("the engine: OneUptime AI composes commands for a rule only when it picks a Runner", () => {
    const engine: string = read(
      "Common/Server/Services/AutoRemediationRuleEngineService.ts",
    );

    const skip: number = engine.indexOf(
      "if (!getRuleRunnerId(rule)) {\n          continue;\n        }",
    );
    const compose: number = engine.indexOf(
      "const isRunnerRunStarted: boolean = await this.startAiCommandRun({",
    );

    expect(skip).toBeGreaterThan(0);
    expect(compose).toBeGreaterThan(skip);
  });

  test("the toolkit: a command runs on one of the rule's project's own Runners that runs AI commands", () => {
    const tools: string = read(
      "Common/Server/Utils/AI/Remediation/RemediationCommandTools.ts",
    );

    const lookup: string = between(
      tools,
      "const runner: Runner | null = await RunnerService.findOneBy({\n      query: {\n        _id: runnerId.toString(),",
      "Runner not found in this project, or it does not accept AI commands.",
    );

    expect(lookup).toContain("projectId: this.options.projectId,");
    expect(lookup).toContain("canRunAiCommands: true,");
  });

  test("the pick: only a project's own Runner is let run AI commands, never a global one", () => {
    const pick: string = read(
      "Common/Server/Utils/Runner/RunnerAiCommandsPick.ts",
    );

    const query: string = between(
      pick,
      "await RunnerService.findBy({",
      "props: { isRoot: true },",
    );

    expect(query).toContain("projectId: projectId,");
    expect(query).toContain("isGlobalRunner: false,");
  });

  test("the claim: a global Runner is told it runs no AI commands, and is served runbook jobs only", () => {
    const ingress: string = read("App/FeatureSet/Runbook/API/RunnerIngress.ts");
    const jobs: string = read("Common/Server/Services/RunnerJobService.ts");

    const heartbeat: string = between(
      ingress,
      'if (agent.isGlobalRunner) {\n      return {\n        status: "ok",',
      "};\n    }",
    );
    expect(heartbeat).toContain("canRunAiCommands: false,");

    const globalClaim: string = between(
      jobs,
      "public async claimNextGlobalJob(",
      "RETURNING",
    );
    expect(globalClaim).toContain('AND j."origin" = $2');

    // The parameters of that statement, in the same method.
    const globalClaimParameters: string = between(
      jobs.slice(jobs.indexOf("public async claimNextGlobalJob(")),
      "await manager.query(sql, [",
      "]);",
    );
    expect(globalClaimParameters).toContain("RunnerJobOrigin.Runbook,");
    expect(globalClaimParameters).not.toContain("AiRemediation");
  });

  test("the Runner: a global Runner refuses a command OneUptime AI composed", () => {
    const mode: string = read("Runner/Utils/GlobalRunnerMode.ts");

    expect(mode).toContain(
      "if ((job.origin || RunnerJobOrigin.Runbook) !== RunnerJobOrigin.Runbook) {",
    );
    expect(mode).toContain("never commands composed by OneUptime AI.");
  });
});
