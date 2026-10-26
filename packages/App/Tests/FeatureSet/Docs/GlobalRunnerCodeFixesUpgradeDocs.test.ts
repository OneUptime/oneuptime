import { inlineCode } from "./DocsTranslationChecks";
import {
  flattened,
  otherChangesItems,
  sectionAtEnglishPlace,
} from "./UpgradingDocsNotes";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import RunnerIngressAPI from "../../../FeatureSet/Runbook/API/RunnerIngress";
import Runner from "Common/Models/DatabaseModels/Runner";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says global Runners took OneUptime AI's code fixes
 * and the shared Runner is gone, and the step of "What you need to do" that
 * goes with it, held to the code and the deployment files that make them
 * true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits right after
 * the note on the bundled Runner's own key, the Runner it retires, and
 * before the note that wrong probe and Runner keys are counted (both
 * SharedRunnerOwnKeyUpgradeDocs). What it claims is what the code does:
 *
 *   - a global Runner is granted code fixes and never AI commands, and a
 *     code-fix pair of one proves a Runner that serves every project;
 *   - on a global Runner a fix runs no repository command, the code agent
 *     has no command tool, and Git is reached by the global Runner's rule;
 *   - Docker Compose has no runner service, reads none of the shared
 *     Runner's settings from config.env, and npm run update removes the old
 *     container;
 *   - the Helm chart has no runner deployment, still accepts runner: values,
 *     and globalRunner.keda has the fields runner.keda had;
 *   - the global Runner is the only Runner Compose and the chart start, so
 *     turning it off stops the code fixes it took;
 *   - a Runner still started with ONEUPTIME_RUNNER_SHARED=true logs that the
 *     shared Runner is gone, and exits;
 *   - the Admin Dashboard has no Global AI Agents page, and Global Runners
 *     sits under its Settings;
 *   - an AI agent a project created before 12.0 still proves itself and
 *     still reports in.
 *
 * Every translation carries the note and the step in the English places,
 * under leads of its own, with the English code and with links to its own
 * language's headings.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const NOTE_LEAD: string =
  "**Global Runners take OneUptime AI's code fixes, and the shared Runner is gone.**";
// The note before it, on the Runner it retires (SharedRunnerOwnKeyUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**The bundled Runner registers with its own key, and holds no `ONEUPTIME_SECRET`.**";
// The note after it (SharedRunnerOwnKeyUpgradeDocs).
const NEXT_LEAD: string = "**Wrong probe and Runner keys are counted.**";

const STEPS_HEADING: string = "What you need to do";
const STEP_LEAD: string =
  "**If OneUptime AI fixes code in your repositories, keep the global Runner on.**";

const AI_AGENT_PAGE: string = "ai/ai-agent";
const RUNNER_AGENTS_PAGE: string = "runbooks/agents";

// The config.env settings only the shared Runner read.
const SHARED_RUNNER_SETTINGS: Array<string> = [
  "ONEUPTIME_RUNNER_KEY",
  "ONEUPTIME_RUNNER_PORT",
  "ONEUPTIME_RUNNER_ONEUPTIME_URL",
];

// The fields runner.keda had, which globalRunner.keda takes as they were.
const KEDA_FIELDS: Array<string> = [
  "enabled",
  "minReplicas",
  "maxReplicas",
  "queueSizeThreshold",
  "pollingInterval",
  "cooldownPeriod",
  "fallback",
];

const CHART_DIR: string = "HelmChart/Public/oneuptime";
const ADMIN_DIR: string = "packages/App/FeatureSet/AdminDashboard/src";

const LINK_TARGET: RegExp = /\]\(([^()[\]\s]+)\)/g;
const HEADING_LINE: RegExp = /^#{1,6}\s/;
const HEADING_MARKER: RegExp = /^#+\s+/;
const FENCE_LINE: RegExp = /^\s*```/;
const NUMBERED_STEP: RegExp = /^\d+\. /;
// A template reading the chart's runner: values.
const RUNNER_VALUES: RegExp = /\.Values\.runner\b/;

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function page(language: string, name: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${name}.md`),
    "utf8",
  );
}

// The headings of a page, in order, outside code blocks.
function headings(markdown: string): Array<string> {
  const found: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && HEADING_LINE.test(line)) {
      found.push(line.trim());
    }
  }

  return found;
}

function anchorOf(heading: string): string {
  return slugifyMarkdownHeading(heading.replace(HEADING_MARKER, ""));
}

/*
 * The anchor of a language's heading in the place of the English heading
 * with this anchor, on the same page.
 */
function anchorAtEnglishPlace(
  language: string,
  name: string,
  englishAnchor: string,
): string {
  const index: number = headings(page("en", name)).findIndex(
    (heading: string): boolean => {
      return anchorOf(heading) === englishAnchor;
    },
  );

  expect({ name, englishAnchor, found: index > -1 }).toEqual({
    name,
    englishAnchor,
    found: true,
  });

  const heading: string | undefined = headings(page(language, name))[index];

  expect({ language, name, heading: Boolean(heading) }).toEqual({
    language,
    name,
    heading: true,
  });

  return anchorOf(heading as string);
}

function linkTargets(text: string): Array<string> {
  return Array.from(text.matchAll(LINK_TARGET)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The numbered steps of a language's "What you need to do", each on one line.
function steps(language: string): Array<string> {
  const found: Array<string> = [];

  for (const line of sectionAtEnglishPlace(language, STEPS_HEADING).split(
    "\n",
  )) {
    if (NUMBERED_STEP.test(line)) {
      found.push(line);
      continue;
    }

    if (found.length > 0 && line.startsWith("   ")) {
      found[found.length - 1] = `${found[found.length - 1]} ${line.trim()}`;
    }
  }

  return found.map(flattened);
}

// The service names a Compose file starts.
function composeServices(relativePath: string): Array<string> {
  const services: Array<string> = [];
  let inServices: boolean = false;

  for (const line of source(relativePath).split("\n")) {
    if (line === "services:") {
      inServices = true;
      continue;
    }

    if (inServices && line.length > 0 && !line.startsWith(" ")) {
      inServices = false;
    }

    if (
      inServices &&
      line.startsWith("  ") &&
      !line.startsWith("   ") &&
      line.trim().endsWith(":")
    ) {
      services.push(line.trim().replace(":", ""));
    }
  }

  return services;
}

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

// The chart's templates, by file name.
function chartTemplates(): Map<string, string> {
  const templates: Map<string, string> = new Map<string, string>();

  for (const name of fs.readdirSync(
    path.join(REPO_ROOT, CHART_DIR, "templates"),
  )) {
    if (
      name.endsWith(".yaml") ||
      name.endsWith(".tpl") ||
      name === "NOTES.txt"
    ) {
      templates.set(name, source(`${CHART_DIR}/templates/${name}`));
    }
  }

  return templates;
}

/*
 * The keys of a block of the chart's values, one level in: the block
 * globalRunner.keda is ["globalRunner", "keda"].
 */
function valueKeys(blockPath: Array<string>): Array<string> {
  const lines: Array<string> = source(`${CHART_DIR}/values.yaml`).split("\n");
  let start: number = 0;
  let indent: string = "";

  for (const key of blockPath) {
    const header: string = `${indent}${key}:`;

    while (start < lines.length && lines[start] !== header) {
      start += 1;
    }

    expect({ key, found: start < lines.length }).toEqual({ key, found: true });

    indent = `${indent}  `;
    start += 1;
  }

  const keys: Array<string> = [];

  for (const line of lines.slice(start)) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }

    if (!line.startsWith(indent)) {
      break;
    }

    if (!line.startsWith(`${indent} `)) {
      keys.push(line.trim().split(":")[0] as string);
    }
  }

  return keys;
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

const ENGLISH_STEPS: Array<string> = steps("en");
const STEP_INDEX: number = ENGLISH_STEPS.findIndex((step: string): boolean => {
  return step.replace(NUMBERED_STEP, "").startsWith(STEP_LEAD);
});
const ENGLISH_STEP: string = ENGLISH_STEPS[STEP_INDEX] || "";

function says(text: string, claims: Array<string>): void {
  for (const claim of claims) {
    expect({ claim, said: text.includes(claim) }).toEqual({
      claim,
      said: true,
    });
  }
}

describe("the English upgrade note", () => {
  it("is a note of the 13 → 14 changes, once, right after the note on the bundled Runner's own key and before the note that wrong keys are counted", () => {
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

  it("names the services, settings, values and commands it is about, and nothing else", () => {
    expect(inlineCode(ENGLISH_NOTE)).toEqual(
      [
        "runner",
        "ONEUPTIME_RUNNER_KEY",
        "ONEUPTIME_RUNNER_PORT",
        "ONEUPTIME_RUNNER_ONEUPTIME_URL",
        "npm run update",
        "docker compose up -d --remove-orphans",
        "config.env",
        "runner",
        "runner.*",
        "runner:",
        "runner.keda",
        "globalRunner.keda",
        "ONEUPTIME_RUNNER_SHARED",
        "true",
        "GLOBAL_RUNNER_REPLICAS=0",
        "globalRunner.enabled: false",
      ].sort(),
    );
  });

  it("says which repositories global Runners now fix code in, and which see no change", () => {
    says(ENGLISH_NOTE, [
      "The bundled global Runner, and every global Runner a master admin adds, now works in every code repository on **Global Runner**: one that picks it in its Runner setting in Code, or that picks no Runner in a project with no default Runner, while the project uses global Runners.",
      "Projects that turn global Runners off, and repositories that pick their own Runner, see no change.",
    ]);
  });

  it("says what a fix on a global Runner never runs, and what it still never runs", () => {
    says(ENGLISH_NOTE, [
      "On a global Runner, a fix never runs the repository's own setup, build and test commands, and the code agent has no command tool: the fix is written and opened for review with its verification shown as skipped, as on the shared Runner before.",
      "A global Runner reaches Git servers on the internet only, over HTTPS, except on a self-hosted OneUptime, where it may reach the private Git servers the server itself may reach.",
      "It still never runs Bash, SSH or kubectl steps, OneUptime AI's commands, or a step that needs a credential.",
    ]);
  });

  it("says what is gone from Docker Compose and the Helm chart, and what to do about it", () => {
    says(ENGLISH_NOTE, [
      "The separate shared Runner, which the notes above call the bundled Runner, is gone.",
      "Docker Compose no longer has the `runner` service and no longer uses `ONEUPTIME_RUNNER_KEY`, `ONEUPTIME_RUNNER_PORT` or `ONEUPTIME_RUNNER_ONEUPTIME_URL`: `npm run update` removes the old container (`docker compose up -d --remove-orphans` does, if you run Compose by hand), and you may delete those three lines from `config.env`.",
      "The Helm chart no longer has the `runner` deployment and ignores `runner.*` values, which its schema still accepts so old values files keep working: remove `runner:` from your values, and move `runner.keda` to `globalRunner.keda`, which has the same fields.",
      "If you set `GLOBAL_RUNNER_REPLICAS=0` or `globalRunner.enabled: false`, that now also stops AI code fixes in the repositories on **Global Runner**: turn the global Runner back on, or pick a Runner of your own for those repositories in Code.",
    ]);
  });

  it("says a Runner still started as the shared Runner stops, and what to do with it", () => {
    says(ENGLISH_NOTE, [
      "A Runner still started as the shared Runner, with `ONEUPTIME_RUNNER_SHARED` set to `true`, now logs that the shared Runner is gone and stops: remove it from your deployment.",
    ]);
  });

  it("says where the Admin Dashboard's page went, and that a project's older agents keep working", () => {
    says(ENGLISH_NOTE, [
      "The Admin Dashboard's Global AI Agents page, under **Settings → AI**, is removed: for global Runners, open **Settings**, then **Global Runners**.",
      "AI agents a project created before 12.0 keep working as before.",
    ]);
  });

  it("links to Run a Runner of your own and to Global Runners, both headings that exist", () => {
    expect(linkTargets(ENGLISH_NOTE)).toEqual([
      `/docs/${AI_AGENT_PAGE}#${anchorAtEnglishPlace("en", AI_AGENT_PAGE, "run-a-runner-of-your-own")}`,
      `/docs/${RUNNER_AGENTS_PAGE}#${anchorAtEnglishPlace("en", RUNNER_AGENTS_PAGE, "global-runners")}`,
    ]);
  });
});

describe("the English step of What you need to do", () => {
  it("is a step, once, the last of the list", () => {
    expect(STEP_INDEX).toBeGreaterThan(-1);
    expect(
      ENGLISH_STEPS.filter((step: string): boolean => {
        return step.includes(STEP_LEAD);
      }),
    ).toHaveLength(1);
    expect(STEP_INDEX).toBe(ENGLISH_STEPS.length - 1);
    expect(ENGLISH_STEP.startsWith(`${ENGLISH_STEPS.length}. `)).toBe(true);
  });

  it("says what the global Runner now does, how to keep it, and what to change on Helm", () => {
    says(ENGLISH_STEP, [
      "It now takes the AI code fixes the shared Runner did, and Docker Compose's `runner` service and the chart's `runner` deployment are gone.",
      "If you set `GLOBAL_RUNNER_REPLICAS=0` or `globalRunner.enabled: false`, turn it back on, or [pick a Runner of your own](/docs/ai/ai-agent#pick-the-repositorys-runner) for those repositories in Code.",
      "On Helm, remove `runner:` from your values and move `runner.keda` to `globalRunner.keda`.",
    ]);
    expect(inlineCode(ENGLISH_STEP)).toEqual(
      [
        "runner",
        "runner",
        "GLOBAL_RUNNER_REPLICAS=0",
        "globalRunner.enabled: false",
        "runner:",
        "runner.keda",
        "globalRunner.keda",
      ].sort(),
    );
  });

  it("links to the heading on picking a repository's Runner, which exists", () => {
    expect(linkTargets(ENGLISH_STEP)).toEqual([
      `/docs/${AI_AGENT_PAGE}#${anchorAtEnglishPlace("en", AI_AGENT_PAGE, "pick-the-repositorys-runner")}`,
    ]);
  });
});

describe("a global Runner takes code fixes, and runs no repository command", () => {
  it("its heartbeat grants it code fixes whether or not a repository names it, and never AI commands, whatever its row says", () => {
    const runner: Runner = new Runner();
    runner.isGlobalRunner = true;
    runner.canRunAiCommands = true;

    for (const isPickedByACodeRepository of [false, true]) {
      const answer: JSONObject = RunnerIngressAPI.getHeartbeatAnswer(runner, {
        isPickedByACodeRepository,
      });

      expect(answer["isGlobalRunner"]).toBe(true);
      expect(answer["capabilities"]).toEqual({
        canRunRunbooks: true,
        canRunCodeFixTasks: true,
        canRunAiCommands: false,
      });
    }
  });

  it("its code-fix pair proves a Runner that serves every project", () => {
    const auth: string = source(
      "packages/Common/Server/Utils/AI/CodeFix/CodeFixAgentAuth.ts",
    );

    expect(auth).toContain(
      "if (runner.isGlobalRunner === true && !runner.projectId) {",
    );
  });

  it("it runs no repository command, offers the code agent no command tool, and reaches Git by the global Runner's rule", () => {
    expect(source("packages/Runner/Config.ts")).toContain(
      "export function runsProjectAuthoredCommands(): boolean {\n  return !GlobalRunnerMode.isActive();\n}",
    );
    expect(source("packages/Runner/Utils/BuildVerification.ts")).toContain(
      "if (!runsProjectAuthoredCommands()) {",
    );
    expect(source("packages/Runner/CodeAgents/InHouseCodeAgent.ts")).toContain(
      "...(runsProjectAuthoredCommands() ? [runCommandTool] : []),",
    );

    expect(source("packages/Runner/Utils/GitHostGuard.ts")).toContain(
      "!GlobalRunnerMode.isActive() || codeHost?.isPrivateNetworkAllowed === true",
    );
    // The clone and the pull request both go through it.
    expect(source("packages/Runner/Utils/RepositoryManager.ts")).toContain(
      "GitHostGuard.getGitOptions(",
    );
    expect(source("packages/Runner/Utils/PullRequestOpener.ts")).toContain(
      "GitHostGuard.getTransport(",
    );
  });
});

describe("the shared Runner is gone from Docker Compose", () => {
  it("no Compose file starts a runner service, and the global Runner is the one Runner each starts", () => {
    for (const file of [
      "docker-compose.yml",
      "docker-compose.base.yml",
      "Scripts/Dev/docker-compose.dev.yml",
      "packages/E2E/docker-compose.billing.yml",
    ]) {
      expect({ file, services: composeServices(file) }).toEqual({
        file,
        services: expect.not.arrayContaining(["runner"]),
      });
    }

    expect(composeServices("docker-compose.yml")).toContain("global-runner");
    expect(
      countOf(source("docker-compose.yml"), "image: oneuptime/runner:"),
    ).toBe(1);
    expect(
      countOf(
        source("Scripts/Dev/docker-compose.dev.yml"),
        "dockerfile: ./packages/Runner/Dockerfile",
      ),
    ).toBe(1);
  });

  it("reads none of the shared Runner's settings from config.env, which no longer lists them", () => {
    for (const setting of SHARED_RUNNER_SETTINGS) {
      for (const file of [
        "docker-compose.yml",
        "docker-compose.base.yml",
        "Scripts/Dev/docker-compose.dev.yml",
      ]) {
        expect({ file, reads: source(file).includes(`\${${setting}`) }).toEqual(
          { file, reads: false },
        );
      }

      expect(source("config.example.env").split("\n")).not.toEqual(
        expect.arrayContaining([expect.stringMatching(`^#? ?${setting}=`)]),
      );
    }
  });

  it("npm run update starts Compose with --remove-orphans, which removes the old container", () => {
    const scripts: JSONObject = JSON.parse(source("package.json"))[
      "scripts"
    ] as JSONObject;

    expect(String(scripts["update"])).toMatch(/&& npm run start$/);
    expect(String(scripts["start"])).toContain(
      "docker compose up --remove-orphans -d",
    );
  });
});

describe("the shared Runner is gone from the Helm chart", () => {
  it("no template deploys it, and only NOTES.txt reads its values, to say they are ignored", () => {
    const templates: Map<string, string> = chartTemplates();

    expect(templates.has("runner.yaml")).toBe(false);

    const readers: Array<string> = Array.from(templates.entries())
      .filter(([, text]: [string, string]): boolean => {
        return RUNNER_VALUES.test(text);
      })
      .map(([name]: [string, string]): string => {
        return name;
      });

    expect(readers).toEqual(["NOTES.txt"]);
    expect(templates.get("NOTES.txt")).toContain("{{- if .Values.runner }}");
    expect(templates.get("NOTES.txt")).toContain("IGNORED VALUES: runner");
  });

  it("the global Runner is the one Runner the chart deploys", () => {
    const users: Array<string> = Array.from(chartTemplates().entries())
      .filter(([, text]: [string, string]): boolean => {
        return text.includes('"ImageName" "runner"');
      })
      .map(([name]: [string, string]): string => {
        return name;
      });

    expect(users).toEqual(["global-runner.yaml"]);
  });

  it("its schema still accepts runner:, whatever it holds", () => {
    const schema: JSONObject = JSON.parse(
      source(`${CHART_DIR}/values.schema.json`),
    ) as JSONObject;
    const runner: JSONObject = (schema["properties"] as JSONObject)[
      "runner"
    ] as JSONObject;

    expect(schema["additionalProperties"]).toBe(false);
    expect(runner["type"]).toEqual(["object", "null"]);
    expect(runner["additionalProperties"]).toBe(true);
    expect(runner["properties"]).toBeUndefined();
  });

  it("globalRunner.keda has the fields runner.keda had, and the global Runner's ScaledObject reads them", () => {
    expect(valueKeys(["globalRunner", "keda"])).toEqual(KEDA_FIELDS);

    const schema: JSONObject = JSON.parse(
      source(`${CHART_DIR}/values.schema.json`),
    ) as JSONObject;
    const keda: JSONObject = (
      ((schema["properties"] as JSONObject)["globalRunner"] as JSONObject)[
        "properties"
      ] as JSONObject
    )["keda"] as JSONObject;

    expect(Object.keys(keda["properties"] as JSONObject)).toEqual(KEDA_FIELDS);

    const scaledObjects: string = source(
      `${CHART_DIR}/templates/keda-scaledobjects.yaml`,
    );

    for (const field of KEDA_FIELDS.filter((name: string): boolean => {
      return name !== "enabled";
    })) {
      expect({
        field,
        read: scaledObjects.includes(`.Values.globalRunner.keda.${field}`),
      }).toEqual({ field, read: true });
    }
  });
});

describe("a Runner still started as the shared Runner", () => {
  it("logs that the shared Runner is gone, and what to do, then exits before anything else runs", () => {
    const config: string = source("packages/Runner/Config.ts");

    expect(config).toContain(
      'if (isSharedRunnerSwitchOn(process.env["ONEUPTIME_RUNNER_SHARED"])) {\n  logger.error(SHARED_RUNNER_REMOVED_MESSAGE);\n  process.exit(1);\n}',
    );
    expect(config).toContain("OneUptime no longer runs a shared Runner");
    expect(config).toContain("Remove this Runner from your deployment");
    expect(config).toContain(
      'return (value || "").trim().toLowerCase() === "true";',
    );
  });
});

describe("the Admin Dashboard", () => {
  it("has no Global AI Agents page", () => {
    expect(exists(`${ADMIN_DIR}/Pages/Settings/AIAgents/Index.tsx`)).toBe(
      false,
    );
    expect(source(`${ADMIN_DIR}/Utils/PageMap.ts`)).not.toContain(
      "SETTINGS_AI_AGENTS",
    );
    expect(source(`${ADMIN_DIR}/Utils/RouteMap.ts`)).not.toContain(
      "/admin/settings/ai-agents",
    );
    expect(source(`${ADMIN_DIR}/Locales/en.json`)).not.toContain(
      "Global AI Agents",
    );
  });

  it("lists Global Runners in its Settings", () => {
    expect(source(`${ADMIN_DIR}/Pages/Settings/SideMenu.tsx`)).toContain(
      'title: t("sideMenu.settingsGlobalRunners"),',
    );

    const english: JSONObject = JSON.parse(
      source(`${ADMIN_DIR}/Locales/en.json`),
    ) as JSONObject;

    expect((english["sideMenu"] as JSONObject)["settingsGlobalRunners"]).toBe(
      "Global Runners",
    );
  });
});

describe("an AI agent a project created before 12.0", () => {
  it("still proves its project's own identity, while one with no project proves nothing", () => {
    const auth: string = source(
      "packages/Common/Server/Utils/AI/CodeFix/CodeFixAgentAuth.ts",
    );

    expect(auth).toContain("if (!aiAgent.projectId) {");
    expect(auth).toContain("source: CodeFixAgentSource.AIAgent,");
  });

  it("still reports in, and nothing registers one any more", () => {
    const api: string = source("packages/Common/Server/API/AIAgentAPI.ts");

    expect(api).toContain("/alive`");
    expect(api).not.toContain("/register`");
    expect(api).not.toContain("global-ai-agents");
  });
});

describe.each(TRANSLATIONS)("the %s upgrade guide", (language: string) => {
  const note: string = flattened(otherChangesItems(language)[NOTE_INDEX] || "");
  const step: string = steps(language)[STEP_INDEX] || "";

  it("has the note in the English note's place, under a lead of its own", () => {
    expect(otherChangesItems(language)).toHaveLength(ENGLISH_ITEMS.length);
    expect(note.startsWith("- **")).toBe(true);
    expect(note).not.toContain(NOTE_LEAD);
  });

  it("carries the English note's code, the shared Runner switch included", () => {
    expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));
  });

  it("links the note to its own language's Run a Runner of your own and Global Runners", () => {
    expect(linkTargets(note)).toEqual([
      `/docs/${AI_AGENT_PAGE}#${anchorAtEnglishPlace(language, AI_AGENT_PAGE, "run-a-runner-of-your-own")}`,
      `/docs/${RUNNER_AGENTS_PAGE}#${anchorAtEnglishPlace(language, RUNNER_AGENTS_PAGE, "global-runners")}`,
    ]);
  });

  it("has the step in the English step's place, the last, under a lead of its own, with the English code", () => {
    expect(steps(language)).toHaveLength(ENGLISH_STEPS.length);
    expect(step.startsWith(`${STEP_INDEX + 1}. **`)).toBe(true);
    expect(step).not.toContain(STEP_LEAD);
    expect(inlineCode(step)).toEqual(inlineCode(ENGLISH_STEP));
  });

  it("links the step to its own language's heading on picking a repository's Runner", () => {
    expect(linkTargets(step)).toEqual([
      `/docs/${AI_AGENT_PAGE}#${anchorAtEnglishPlace(language, AI_AGENT_PAGE, "pick-the-repositorys-runner")}`,
    ]);
  });
});
