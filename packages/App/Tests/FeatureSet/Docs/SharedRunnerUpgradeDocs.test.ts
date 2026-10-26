import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The bundled Runner and AI code fixes, as the docs tell it, held to the
 * code that decides it:
 *
 *   - the upgrade note (installation/upgrading, "Other changes in 14") sits
 *     after the note on PostgreSQL's port and password and before the note
 *     on wrong two-factor codes, says what the bundled Runner no longer runs
 *     and what it starts with, names the Compose service and the chart
 *     values it means, and links to "Run a Runner of your own" on the AI
 *     agent page;
 *   - the AI agent page (ai/ai-agent) says the shared Runners never run the
 *     verification commands, and links to the same section;
 *   - what both say is what the Runner does: a global Runner - which took the
 *     shared Runner's code fixes, as the later note on global Runners says -
 *     runs no repository command and offers no command tool, and its
 *     deployment gives it its own minimal environment;
 *   - every translation carries the note in the English note's place, with
 *     the English note's code, and both links at its own language's heading.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const NOTE_LEAD: string =
  "**The bundled Runner no longer runs a repository's commands, and holds only what it needs.**";
// The note before it (DatabasePortDocs).
const PREVIOUS_LEAD: string =
  "**PostgreSQL answers only on the server itself, and a new install starts with a database password of its own.**";
// The later note that retires the shared Runner this note is about.
const RETIRING_LEAD: string =
  "**Global Runners take OneUptime AI's code fixes, and the shared Runner is gone.**";
// The note after it (TwoFactorWrongCodesDocs).
const NEXT_LEAD: string =
  "**Wrong two-factor codes are counted for the account, wherever they come from.**";

const AI_AGENT_PAGE: string = "ai/ai-agent";
const OWN_RUNNER_HEADING: string = "### Run a Runner of your own";
const TRUST_PARAGRAPH_START: string =
  "The commands are repository settings your team writes";

const LINK_TARGET: RegExp = /\]\(([^()[\]\s]+)\)/g;
const HEADING_LINE: RegExp = /^#{1,6}\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const HEADING_MARKER: RegExp = /^#+\s+/;

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function page(language: string, name: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${name}.md`),
    "utf8",
  );
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
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

// The anchor of a language's "Run a Runner of your own" section.
function ownRunnerAnchor(language: string): string {
  const index: number = headings(page("en", AI_AGENT_PAGE)).indexOf(
    OWN_RUNNER_HEADING,
  );

  expect(index).toBeGreaterThan(-1);

  const heading: string | undefined = headings(page(language, AI_AGENT_PAGE))[
    index
  ];

  expect({ language, heading: Boolean(heading) }).toEqual({
    language,
    heading: true,
  });

  return slugifyMarkdownHeading(
    (heading as string).replace(HEADING_MARKER, ""),
  );
}

function linkTargets(text: string): Array<string> {
  return Array.from(text.matchAll(LINK_TARGET)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The AI agent page's trust paragraph, found by the English one's line.
function trustParagraph(language: string): string {
  const englishLines: Array<string> = page("en", AI_AGENT_PAGE).split("\n");
  const index: number = englishLines.findIndex((line: string): boolean => {
    return line.startsWith(TRUST_PARAGRAPH_START);
  });

  expect(index).toBeGreaterThan(-1);

  return page(language, AI_AGENT_PAGE).split("\n")[index] || "";
}

// The service names Docker Compose starts.
function composeServices(): Array<string> {
  const services: Array<string> = [];
  let inServices: boolean = false;

  for (const line of source("docker-compose.yml").split("\n")) {
    if (line === "services:") {
      inServices = true;
      continue;
    }

    if (inServices && line.length > 0 && !line.startsWith(" ")) {
      inServices = false;
    }

    const name: string = line.trim().replace(":", "");

    if (
      inServices &&
      line.startsWith("  ") &&
      !line.startsWith("   ") &&
      line.trim().endsWith(":")
    ) {
      services.push(name);
    }
  }

  return services;
}

// The top-level keys of the chart's `runner:` values block.
function runnerValueKeys(): Array<string> {
  const keys: Array<string> = [];
  let inRunner: boolean = false;

  for (const line of source("HelmChart/Public/oneuptime/values.yaml").split(
    "\n",
  )) {
    if (line === "runner:") {
      inRunner = true;
      continue;
    }

    if (inRunner && line.length > 0 && !line.startsWith(" ")) {
      break;
    }

    if (inRunner && line.startsWith("  ") && !line.startsWith("   ")) {
      const key: string = line.trim().split(":")[0] as string;

      if (key && !key.startsWith("#")) {
        keys.push(key);
      }
    }
  }

  return keys;
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on the bundled Runner", () => {
  it("is a note of the 13 → 14 changes, once, after the note on PostgreSQL's port and password and before the note on wrong two-factor codes", () => {
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

  it("names the Compose service and the chart values it meant, which the note on global Runners retires", () => {
    expect(inlineCode(ENGLISH_NOTE)).toEqual([
      "runner",
      "runner.enabled",
      "runner.extraEnv",
    ]);

    // That Runner is gone: neither Compose nor the chart runs it any more.
    expect(composeServices()).not.toContain("runner");
    expect(composeServices()).toContain("global-runner");
    expect(runnerValueKeys()).toEqual([]);
    expect(
      ENGLISH_ITEMS.some((item: string): boolean => {
        return flattened(item).startsWith(`- ${RETIRING_LEAD}`);
      }),
    ).toBe(true);
  });

  it("says the bundled Runner runs no repository command and offers no command tool, as the Runner decides", () => {
    expect(ENGLISH_NOTE).toContain(
      "It no longer runs a code repository's setup, build and test commands, and its code agent has no command tool",
    );
    expect(ENGLISH_NOTE).toContain(
      "the pull request opens with its verification shown as skipped",
    );

    // The global Runner that took its work runs none either: being global decides.
    expect(source("packages/Runner/Config.ts")).toContain(
      "export function runsProjectAuthoredCommands(): boolean {\n  return !GlobalRunnerMode.isActive();\n}",
    );

    const verification: string = source(
      "packages/Runner/Utils/BuildVerification.ts",
    );
    expect(verification).toContain("if (!runsProjectAuthoredCommands()) {");
    expect(verification).toContain("status: FixVerificationStatus.Skipped,");

    const agent: string = source(
      "packages/Runner/CodeAgents/InHouseCodeAgent.ts",
    );
    expect(agent).toContain(
      "...(runsProjectAuthoredCommands() ? [runCommandTool] : []),",
    );
  });

  it("says what the bundled Runner started with, which the global Runner that does its work keeps to", () => {
    expect(ENGLISH_NOTE).toContain(
      "It also starts with only its OneUptime URL, its key and its telemetry settings instead of the app's whole environment",
    );

    // Its own key, and neither the app's environment nor the cluster key.
    const chart: string = source(
      "HelmChart/Public/oneuptime/templates/global-runner.yaml",
    );
    expect(chart).toContain('include "oneuptime.globalRunnerKeyValue"');
    expect(chart).not.toContain('include "oneuptime.env.oneuptimeSecret"');
    expect(chart).not.toContain('include "oneuptime.env.runtime"');

    const compose: string = source("docker-compose.base.yml");
    const globalRunnerService: string = compose.slice(
      compose.indexOf("\n  global-runner:\n"),
      compose.indexOf("\n  fluentd:\n"),
    );
    expect(globalRunnerService).toContain(
      "ONEUPTIME_RUNNER_KEY: ${GLOBAL_RUNNER_KEY}",
    );
    expect(globalRunnerService).not.toContain("*common-runtime-variables");
    expect(globalRunnerService).not.toContain("ONEUPTIME_SECRET:");
  });

  it("links to Run a Runner of your own, and says Runners installed by the operator see no change", () => {
    expect(linkTargets(ENGLISH_NOTE)).toEqual([
      `/docs/${AI_AGENT_PAGE}#${ownRunnerAnchor("en")}`,
    ]);
    expect(ENGLISH_NOTE).toContain(
      "Runners you installed yourself see no change.",
    );
  });
});

describe("the English AI agent page on the shared Runners", () => {
  /*
   * The shared Runner is the global Runner a code repository that picks no
   * Runner works on (its Runner setting in Code), so the page names it so.
   */
  it("says a global Runner never runs the verification commands, and links to Run a Runner of your own", () => {
    const paragraph: string = trustParagraph("en");

    expect(paragraph).toContain(
      "A global Runner, which OneUptime runs for every project, never runs them: on a global Runner the fix is written and opened for review, verification is reported as skipped, and your repository's own CI checks the change.",
    );
    expect(linkTargets(paragraph)).toEqual([`#${ownRunnerAnchor("en")}`]);
  });
});

describe.each(TRANSLATIONS)(
  "the %s docs on the bundled Runner",
  (language: string) => {
    const note: string = flattened(
      otherChangesItems(language)[NOTE_INDEX] || "",
    );

    it("has the upgrade note in the English note's place, under a lead of its own", () => {
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
      expect(otherChangesItems(language)).toHaveLength(ENGLISH_ITEMS.length);
    });

    it("carries the English note's code", () => {
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));
    });

    it("links the note and the AI agent page to its own language's Run a Runner of your own", () => {
      const anchor: string = ownRunnerAnchor(language);

      expect(linkTargets(note)).toEqual([`/docs/${AI_AGENT_PAGE}#${anchor}`]);
      expect(linkTargets(trustParagraph(language))).toEqual([`#${anchor}`]);
    });
  },
);
