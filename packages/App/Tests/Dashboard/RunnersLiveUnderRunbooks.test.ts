import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Runners are set up under Runbooks → Runners, not under Project Settings.
 *
 * The move itself — routes, redirects, side menus, breadcrumbs — is tested
 * with a DOM in Common/Tests/App/Dashboard (RunbookRunnerRoutes,
 * MovedRunnerSettingsRedirects, RunnerNavigation). What a renderer cannot
 * see is the prose: dozens of error messages, in the server, the dashboard
 * and the Runner binary itself, tell an operator where to go to fix a Runner.
 * Each one is a sentence in a string, so nothing ties it to the route table,
 * and a message that still says "Project Settings → Runners" sends someone to
 * a menu that no longer lists them.
 *
 * So this sweeps the source for that wording, and pins the messages people
 * are most likely to act on.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const PACKAGES: string = path.join(REPO_ROOT, "packages");
const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * "Settings → Runners", "Project Settings > Runner Credentials",
 * "**Settings** > **Runners**", "Settings › Runners" (and its &rsaquo; form).
 */
const SETTINGS_PATH_TO_RUNNERS: RegExp =
  /Settings\*{0,2}\s*(?:→|->|>|›|&rsaquo;|&gt;)\s*(?:<[^>]+>\s*)?\*{0,2}Runner/;

const OLD_SETTINGS_URL: RegExp = /settings\/runner(s|-credentials)\b/;

// .js too: the offline E2E fixtures that fake the server's messages are plain JS.
const SOURCE_EXTENSIONS: Array<string> = [".ts", ".tsx", ".js", ".ejs", ".md"];

const SKIPPED_DIRECTORIES: Set<string> = new Set([
  "node_modules",
  "build",
  "dist",
  ".git",
  // Playwright's local run artifacts.
  "test-results",
  "playwright-report",
  // The docs are swept by Tests/FeatureSet/Docs/RunnersUnderRunbooksDocs.
  "Content",
]);

type WalkFunction = (directory: string) => Array<string>;

const walk: WalkFunction = (directory: string): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...walk(entryPath));
      }
      continue;
    }

    if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
};

/*
 * Everything that ships a message an operator reads: the App's features, the
 * shared server and UI code, the Runner binary, and the two AI agents that
 * carry their own copies of the shared types. The Runner's and the agents'
 * tests are inside those roots and are swept with them — they quote the
 * messages, so they would otherwise keep the old wording alive. So are the
 * end-to-end specs and the offline fixtures that stand in for the server:
 * a fixture still answering "Settings > Runners" tests a message the server
 * no longer sends.
 */
const SWEPT_ROOTS: Array<string> = [
  path.join(PACKAGES, "App", "FeatureSet"),
  path.join(PACKAGES, "Common", "Server"),
  path.join(PACKAGES, "Common", "Types"),
  path.join(PACKAGES, "Common", "UI"),
  path.join(PACKAGES, "Common", "Utils"),
  path.join(PACKAGES, "Runner"),
  path.join(PACKAGES, "E2E"),
  path.join(REPO_ROOT, "agents"),
];

const SWEPT_FILES: Array<string> = SWEPT_ROOTS.flatMap(
  (root: string): Array<string> => {
    return walk(root);
  },
);

type RelativeFunction = (file: string) => string;

const relative: RelativeFunction = (file: string): string => {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
};

interface Offence {
  file: string;
  line: number;
  text: string;
}

type FindOffencesFunction = (pattern: RegExp) => Array<Offence>;

const findOffences: FindOffencesFunction = (
  pattern: RegExp,
): Array<Offence> => {
  const offences: Array<Offence> = [];

  for (const file of SWEPT_FILES) {
    const lines: Array<string> = fs.readFileSync(file, "utf8").split("\n");

    lines.forEach((text: string, index: number) => {
      if (pattern.test(text)) {
        offences.push({
          file: relative(file),
          line: index + 1,
          text: text.trim().slice(0, 160),
        });
      }
    });
  }

  return offences;
};

type ReadFunction = (...segments: Array<string>) => string;

const read: ReadFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(PACKAGES, ...segments), "utf8")
    .replace(/\s+/g, " ");
};

describe("the sweep reads the code it claims to", () => {
  test("it covers the dashboard, the server, the Runner and the agents", () => {
    const swept: Array<string> = SWEPT_FILES.map(relative);

    expect(swept.length).toBeGreaterThan(3000);
    expect(swept).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/Runners.tsx",
        "packages/App/FeatureSet/Runbook/Services/StepExecutors.ts",
        "packages/Common/Server/Services/RunnerService.ts",
        "packages/Runner/Services/RegisterRunner.ts",
        "packages/Runner/README.md",
        "packages/E2E/ExceptionDetail/Fixture/Fixture.js",
        "packages/E2E/Tests/Dashboard/RunnersUnderRunbooks.spec.ts",
      ]),
    );
  });

  test.each([
    "Create one under Project Settings → Runners.",
    "Check Settings > Runners.",
    "Assign it under Project Settings → Runner Credentials.",
    "under **Settings** > **Runners** and",
    "<strong>Settings &rsaquo; Runners</strong>",
    "Settings -> Runners",
  ])("its pattern catches %s", (sentence: string) => {
    expect(SETTINGS_PATH_TO_RUNNERS.test(sentence)).toBe(true);
  });

  test.each([
    "Create one under Runbooks → Runners.",
    "Assign it under Runbooks → Runner Credentials.",
    "Project Settings → AI → AI Features",
    "getRunnerScopeSettings(runner)",
    "const settings: RunnerWriteScopeSettings = load();",
  ])("and leaves %s alone", (sentence: string) => {
    expect(SETTINGS_PATH_TO_RUNNERS.test(sentence)).toBe(false);
  });
});

describe("no message sends an operator to Project Settings for a Runner", () => {
  test("nothing in the shipped source says Settings → Runners", () => {
    expect(findOffences(SETTINGS_PATH_TO_RUNNERS)).toEqual([]);
  });

  test("only the redirect names the old Settings URLs", () => {
    const files: Array<string> = Array.from(
      new Set(
        findOffences(OLD_SETTINGS_URL).map((offence: Offence): string => {
          return offence.file;
        }),
      ),
    );

    // Its comment explains what the old URLs were; nothing else may link there.
    expect(files).toEqual([
      "packages/App/FeatureSet/Dashboard/src/Components/Runner/MovedRunnerPageRedirect.tsx",
    ]);
  });
});

describe("the Runner pages are Runbooks pages", () => {
  test("their files sit under Pages/Runbook/Runners", () => {
    expect(
      fs
        .readdirSync(path.join(DASHBOARD_SRC, "Pages", "Runbook", "Runners"))
        .sort(),
    ).toEqual(["RunnerFormFields.tsx", "RunnerView.tsx", "Runners.tsx"]);
  });

  test("Pages/Settings holds no Runner page", () => {
    expect(
      fs
        .readdirSync(path.join(DASHBOARD_SRC, "Pages", "Settings"))
        .filter((name: string): boolean => {
          return name.toLowerCase().includes("runner");
        }),
    ).toEqual([]);
  });

  test("the Runbooks route group routes both, forwards AI Access's address to the Runners, and Settings routes none", () => {
    const runbookRoutes: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Routes",
      "RunbookRoutes.tsx",
    );
    const settingsRoutes: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Routes",
      "SettingsRoutes.tsx",
    );

    for (const page of ["Runners", "RunnerView"]) {
      expect(runbookRoutes).toContain(`"../Pages/Runbook/Runners/${page}"`);
      expect(settingsRoutes).not.toContain(`/${page}"`);
    }
    for (const key of [
      "PageMap.RUNBOOKS_RUNNERS",
      "PageMap.RUNBOOKS_RUNNER_VIEW",
    ]) {
      expect(runbookRoutes).toContain(`RunbookRoutePath[${key}]`);
      expect(runbookRoutes).toContain(`RouteMap[${key}] as Route`);
    }

    /*
     * AI Access (the runbook credentials OneUptime AI's commands used) is
     * gone: its page is routed nowhere, and its address opens the Runners.
     */
    expect(runbookRoutes).not.toContain("RunnerCredentials");
    expect(runbookRoutes).not.toContain("RUNBOOKS_RUNNER_CREDENTIALS");
    expect(runbookRoutes).toContain(
      "path={MOVED_RUNNER_CREDENTIALS_PATH} element={<MovedPageRedirect pageMap={PageMap.RUNBOOKS_RUNNERS} />}",
    );
  });

  test("Settings keeps the old URLs only as redirects to those pages", () => {
    const settingsRoutes: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Routes",
      "SettingsRoutes.tsx",
    );

    expect(settingsRoutes).toContain(
      "<MovedRunnerPageRedirect pageMap={PageMap.RUNBOOKS_RUNNERS} />",
    );
    expect(settingsRoutes).toContain(
      "<MovedRunnerPageRedirect pageMap={PageMap.RUNBOOKS_RUNNER_VIEW} />",
    );
    // Runner Credentials, later AI Access, is gone: its address opens the Runners too.
    expect(
      settingsRoutes.match(
        /<MovedRunnerPageRedirect pageMap=\{PageMap\.RUNBOOKS_RUNNERS\} \/>/g,
      ),
    ).toHaveLength(2);
    expect(settingsRoutes).not.toContain("RUNBOOKS_RUNNER_CREDENTIALS");
    expect(settingsRoutes.match(/<MovedRunnerPageRedirect/g)).toHaveLength(3);
  });

  test("the AI Access page is gone, with its PageMap entry", () => {
    expect(
      fs.existsSync(
        path.join(
          DASHBOARD_SRC,
          "Pages",
          "Runbook",
          "Runners",
          "RunnerCredentials.tsx",
        ),
      ),
    ).toBe(false);
    expect(
      read("App", "FeatureSet", "Dashboard", "src", "Utils", "PageMap.ts"),
    ).not.toContain("RUNBOOKS_RUNNER_CREDENTIALS");
  });
});

describe("the messages people act on name Runbooks", () => {
  test("a runbook step with no Runner, machine or secret says what to fill in", () => {
    const executors: string = read(
      "App",
      "FeatureSet",
      "Runbook",
      "Services",
      "StepExecutors.ts",
    );

    for (const message of [
      "This SSH step has no machine to sign in to. Open the step and fill in SSH to, as user@host.",
      "Open the step and pick the secret variable that holds it.",
    ]) {
      expect(executors).toContain(message);
    }

    // A variable a step names that is not there says where variables live.
    expect(
      read("Common", "Types", "Runbook", "RunbookVariableProblems.ts"),
    ).toContain("(Runbooks → Settings → Global Variables)");

    /*
     * Where a step with no Runner of its own runs - the global Runners, or
     * nowhere - is the one rule in Common (RunnerChoice); its refusals send
     * people to the same page.
     */
    const choice: string = read("Common", "Types", "Runner", "RunnerChoice.ts");

    for (const message of [
      "Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners.",
      "Pick one of your Runners for the step, or turn global Runners on under Runbooks → Runners.",
    ]) {
      expect(choice).toContain(message);
    }
  });

  test("the step editor's Runner picker, with nothing to pick, points at Runbooks › Runners", () => {
    const picker: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "Runner",
      "RunnerPicker.tsx",
    );

    for (const template of [
      'template="This project does not use global Runners. Add a Runner of your own under {{location}}, or turn global Runners on there."',
      'template="Add a Runner under {{location}} to run this step, then pick it here."',
    ]) {
      expect(picker).toContain(template);
    }

    /*
     * A Bash, SSH or kubectl step global Runners never run: its sentences
     * live with the picker's other words (RunnerPickerModel), and both send
     * people to Runbooks › Runners - to add a Runner, or to make one the
     * project default.
     */
    const model: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "Runner",
      "RunnerPickerModel.ts",
    ).replace(/\s+/g, " ");

    for (const sentence of [
      '"{{stepType}} steps run on a Runner of your own, inside your network: the Global Runner runs JavaScript steps only. Add one under {{location}}, then pick it here."',
      '"{{stepType}} steps run on a Runner of your own, inside your network: the Global Runner runs JavaScript steps only. Pick one, or make one the project default under {{location}}."',
    ]) {
      expect(model).toContain(sentence);
    }

    expect(picker).toContain("template={NEEDS_OWN_RUNNER_ADD_TEMPLATE}");
    expect(picker).toContain("template={NEEDS_OWN_RUNNER_TEMPLATE}");

    /*
     * Named "Runbooks › Runners", as a link to that page: in a new tab, so
     * the steps being edited stay as they are.
     */
    const flat: string = picker.replace(/\s+/g, " ");

    expect(flat).toContain(
      '{translator.translateText("Runbooks › Runners")} </Link>',
    );
    expect(flat).toContain("RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route,");
    expect(flat).toContain("openInNewTab={true}");
  });

  test("the step editor's empty variable picker points at Runbooks › Settings › Global Variables", () => {
    const steps: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "Runbook",
      "View",
      "Steps.tsx",
    ).replace(/\s+/g, " ");

    const picker: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "Runbook",
      "Steps",
      "RunbookVariablePicker.tsx",
    ).replace(/\s+/g, " ");

    /*
     * SSH and kubectl steps sign in with a secret variable; the picker sends
     * people to where variables are made, not to the credentials OneUptime
     * AI uses.
     */
    expect(picker).toContain(
      'translator.translateText("Runbooks › Settings › Global Variables")',
    );
    /*
     * Its sentence lives in the variables' copy, in two forms: to add one,
     * for whoever may, and to ask a project owner or admin, for whoever may
     * not (a Runbook Admin reads variables but does not create them).
     */
    const copy: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "Runbook",
      "RunbookVariableCopy.ts",
    ).replace(/\s+/g, " ");

    expect(picker).toContain("template={noSecretsTemplate}");
    expect(picker).toContain(
      "? NO_SECRET_VARIABLES_ADD_ONE_TEMPLATE : NO_SECRET_VARIABLES_ASK_TEMPLATE;",
    );
    expect(copy).toContain(
      '"No secret variables yet. Add one under {{location}}, then pick it here."',
    );
    expect(copy).toContain(
      '"No secret variables yet. Ask a project owner or admin to add one under {{location}}, then pick it here."',
    );
    expect(steps).not.toContain("Settings › Credentials");
    expect(steps).not.toContain("Runbooks › Runners › Credentials");
  });

  test("the step editor calls a Runner a Runner, never an agent", () => {
    const steps: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "Runbook",
      "View",
      "Steps.tsx",
    );

    // The Runner picker every step shares (RunnerPicker) says it the same way.
    const picker: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "Runner",
      "RunnerPicker.tsx",
    );

    /*
     * A step's picker asks for a Runner; a rule's, which may pick none,
     * reads "No Runner" while nothing is picked - never an agent: the AI
     * agent on a cluster or host is not a Runner, so it is no choice there.
     */
    expect(picker).toContain(': "Select a Runner"');
    expect(picker).toContain("? REMEDIATION_NO_RUNNER_PLACEHOLDER");
    expect(picker).toContain('"Unknown Runner ({{id}})"');

    const model: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "Runner",
      "RunnerPickerModel.ts",
    );

    expect(model).toContain(
      'export const REMEDIATION_NO_RUNNER_PLACEHOLDER: string = translationKey("No Runner");',
    );
    expect(model).not.toContain(
      'translationKey("AI agent on the cluster or host")',
    );
    expect(steps).toContain(
      'description: "Run a shell command on one of your Runners.",',
    );
    /*
     * A JavaScript step runs on a global Runner unless it picks one of the
     * project's own, so it no longer says "on one of your Runners".
     */
    expect(steps).toContain(
      'description: "Run JavaScript in a sandbox and use what it returns.",',
    );

    for (const retired of [
      "Select an agent",
      "Unknown agent",
      "on the agent.",
      "sandboxed JS snippet",
    ]) {
      expect({ retired, found: steps.includes(retired) }).toEqual({
        retired,
        found: false,
      });
      expect({ retired, found: picker.includes(retired) }).toEqual({
        retired,
        found: false,
      });
    }
  });

  test("a Runner started without credentials is told where to create them", () => {
    const config: string = read("Runner", "Config.ts");

    expect(config).toContain(
      "ONEUPTIME_RUNNER_ID is not set. Create a Runner in your OneUptime dashboard (Runbooks > Runners)",
    );
    expect(config).toContain(
      "ONEUPTIME_RUNNER_KEY is not set. Create a Runner in your OneUptime dashboard (Runbooks > Runners)",
    );
  });

  test("a Runner whose credentials are rejected is told where to check them", () => {
    expect(read("Runner", "Services", "RegisterRunner.ts")).toContain(
      "check ONEUPTIME_RUNNER_ID and ONEUPTIME_RUNNER_KEY against Runbooks > Runners.",
    );
  });

  test("the Runner README's quick start begins in Runbooks", () => {
    expect(read("Runner", "README.md")).toContain(
      "(**Runbooks → Runners → Create**)",
    );
  });

  /*
   * A repository picks its Runner in its settings in Code; whether a project
   * uses global Runners is set on Runbooks → Runners. The words for a code
   * fix with no Runner name both places, and the queue sweeper says the same
   * words (describeRepositoryRunnerStatus).
   */
  test("a code fix with no Runner says where to pick one", () => {
    const readiness: string = read(
      "Common",
      "Server",
      "Utils",
      "AI",
      "CodeFix",
      "CodeFixReadiness.ts",
    );
    const queue: string = read(
      "Common",
      "Server",
      "Utils",
      "AI",
      "CodeFix",
      "CodeFixRunQueue.ts",
    );

    expect(readiness).toContain(
      "pick another Runner in the repository's settings in Code.",
    );
    expect(readiness).toContain(
      "turn global Runners on under Runbooks → Runners.",
    );
    expect(queue).toContain("describeRepositoryRunnerStatus(");
    expect(queue).toContain("NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL");

    for (const source of [readiness, queue]) {
      expect(source).not.toContain("Runs AI Code Fixes on it");
    }
  });

  /*
   * A cluster's AI agent page offered a Runner and a Kubernetes credential
   * for a cluster bound to a Runner outside it, with hints that sent people
   * to Runbooks → AI Access. Runbook credentials are gone, and the pickers
   * and their hints with them.
   */
  test("the Kubernetes AI page sends nobody to AI Access", () => {
    const settings: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "Kubernetes",
      "Utils",
      "KubernetesAiAccessSettings.ts",
    );

    for (const gone of [
      "AI Access.",
      "AI Access,",
      "choose a Runner created under Runbooks → Runners.",
    ]) {
      expect({ gone, found: settings.includes(gone) }).toEqual({
        gone,
        found: false,
      });
    }
  });
});

describe("the side menu labels are translated in every locale", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const LOCALE_FILES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json");
    })
    .sort();

  test("there are 17 locales", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test.each(LOCALE_FILES)(
    "%s has the Runbooks menu's Runners entry and the variables pages, and no AI Access",
    (file: string) => {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, unknown>;

      for (const key of [
        "Runners",
        "Runbooks",
        "Global Variables",
        "Variables",
      ]) {
        expect(typeof locale[key]).toBe("string");
        expect((locale[key] as string).trim().length).toBeGreaterThan(0);
      }

      // The menu's AI Access entry went with the page.
      expect(locale["AI Access"]).toBeUndefined();
    },
  );
});
