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
    "Project Settings → AI Features",
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
    ).toEqual([
      "RunnerCredentials.tsx",
      "RunnerFormFields.tsx",
      "RunnerView.tsx",
      "Runners.tsx",
    ]);
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

  test("the Runbooks route group routes all three, and Settings routes none", () => {
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

    for (const page of ["Runners", "RunnerView", "RunnerCredentials"]) {
      expect(runbookRoutes).toContain(`"../Pages/Runbook/Runners/${page}"`);
      expect(settingsRoutes).not.toContain(`/${page}"`);
    }
    for (const key of [
      "PageMap.RUNBOOKS_RUNNERS",
      "PageMap.RUNBOOKS_RUNNER_VIEW",
      "PageMap.RUNBOOKS_RUNNER_CREDENTIALS",
    ]) {
      expect(runbookRoutes).toContain(`RunbookRoutePath[${key}]`);
      expect(runbookRoutes).toContain(`RouteMap[${key}] as Route`);
    }
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
    expect(settingsRoutes).toContain(
      "<MovedRunnerPageRedirect pageMap={PageMap.RUNBOOKS_RUNNER_CREDENTIALS} />",
    );
    expect(settingsRoutes.match(/<MovedRunnerPageRedirect/g)).toHaveLength(3);
  });

  test("the credentials table is named for where it is", () => {
    const page: string = read(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "Runbook",
      "Runners",
      "RunnerCredentials.tsx",
    );

    expect(page).toContain('name="Runbooks > Runner Credentials"');
  });
});

describe("the messages people act on name Runbooks", () => {
  test("a runbook step with no Runner or credential says where to pick one", () => {
    const executors: string = read(
      "App",
      "FeatureSet",
      "Runbook",
      "Services",
      "StepExecutors.ts",
    );

    for (const message of [
      "SSH step is missing a credential. Pick one under Runbooks → Runner Credentials.",
      "SSH step is missing a Runner. Pick one under Runbooks → Runners.",
      "Kubernetes step is missing a credential. Pick one under Runbooks → Runner Credentials.",
      "Kubernetes step is missing a Runner. Pick one under Runbooks → Runners.",
    ]) {
      expect(executors).toContain(message);
    }
  });

  test("the step editor's empty Runner picker points at Runbooks › Runners", () => {
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

    expect(steps).toContain(
      'No Runners in this project yet. Create one under{" "} <strong>Runbooks &rsaquo; Runners</strong>',
    );
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

  test("a code fix with no Runner says where to add one", () => {
    expect(
      read("Common", "Server", "Utils", "AI", "CodeFix", "CodeFixReadiness.ts"),
    ).toContain("enable Runs AI Code Fixes on it (Runbooks > Runners)");
    expect(
      read("Common", "Server", "Utils", "AI", "CodeFix", "CodeFixRunQueue.ts"),
    ).toContain("is running (Runbooks > Runners)");
  });

  test("the Kubernetes AI page's credential hints name Runbooks", () => {
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

    expect(settings).toContain(
      "Assign one under Runbooks → Runner Credentials.",
    );
    expect(settings).toContain(
      "choose a Runner created under Runbooks → Runners.",
    );
    expect(settings).toContain(
      "Assign it under Runbooks → Runner Credentials,",
    );
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
    "%s has the Runbooks menu's Runners section and both its entries",
    (file: string) => {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, unknown>;

      for (const key of ["Runners", "Credentials", "Runbooks"]) {
        expect(typeof locale[key]).toBe("string");
        expect((locale[key] as string).trim().length).toBeGreaterThan(0);
      }
    },
  );
});
