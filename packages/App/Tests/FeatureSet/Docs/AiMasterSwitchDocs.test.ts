import {
  AI_SRE_PAGE,
  DOCS_CONTENT_DIR,
  KUBERNETES_AGENT_PAGE,
  UPGRADING_PAGE,
  getSection,
  read,
  readFlat,
} from "./KubernetesAiAgentDocsSupport";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Enable AI is the project's only AI switch, in the docs as in the product.
 *
 * "Enable auto-remediation" and "Enable AI command execution" used to sit
 * next to it on Project Settings → AI Features. Both were folded into it, so
 * auto-remediation and AI commands on Runners are on exactly when Enable AI
 * is. A page that still told people to turn either one on would send them
 * looking for a toggle that no longer exists. The upgrade notes, and the
 * Kubernetes agent page's upgrade section, keep their history: they say what
 * an older upgrade did while those switches still existed.
 */

const INFRASTRUCTURE_AI_AGENTS_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "ai/infrastructure-ai-agents.md",
);

// Copy that sends people to a retired switch, however it is spelled.
const RETIRED_SWITCH_PATTERNS: Array<RegExp> = [
  /AI command execution/i,
  /enable auto[- ]?remediation/i,
  /auto-remediation to be enabled/i,
  /auto-remediation can be turned off/i,
];

// Where history may still name them, and the part of the page that is history.
const HISTORY: Array<{ page: string; section: string | null }> = [
  // The whole page is upgrade notes, one release after another.
  { page: UPGRADING_PAGE, section: null },
  { page: KUBERNETES_AGENT_PAGE, section: "## Upgrading the Agent" },
];

// Every English docs page, as absolute paths.
function englishDocsPages(directory: string = DOCS_CONTENT_DIR): Array<string> {
  const pages: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      pages.push(...englishDocsPages(entryPath));
    } else if (entry.name.endsWith(".md")) {
      pages.push(entryPath);
    }
  }

  return pages;
}

// What a page says about today: its markdown with any history left out.
function currentCopy(page: string): string {
  const markdown: string = read(page);
  const history: { page: string; section: string | null } | undefined =
    HISTORY.find((entry: { page: string; section: string | null }) => {
      return entry.page === page;
    });

  if (!history) {
    return markdown;
  }

  if (history.section === null) {
    return "";
  }

  return markdown.replace(getSection(markdown, history.section), "");
}

function retiredSwitchesNamed(copy: string): Array<string> {
  return RETIRED_SWITCH_PATTERNS.filter((pattern: RegExp): boolean => {
    return pattern.test(copy);
  }).map((pattern: RegExp): string => {
    return String(pattern);
  });
}

describe("the docs name one project AI switch, Enable AI", () => {
  it("no page tells people to turn on a switch that was folded into Enable AI", () => {
    const pages: Array<string> = englishDocsPages();
    const offenders: Array<string> = [];

    // A walk that found nothing would pass vacuously.
    expect(pages).toContain(AI_SRE_PAGE);
    expect(pages).toContain(INFRASTRUCTURE_AI_AGENTS_PAGE);
    expect(pages.length).toBeGreaterThan(50);

    for (const page of pages) {
      for (const pattern of retiredSwitchesNamed(currentCopy(page))) {
        offenders.push(`${path.relative(DOCS_CONTENT_DIR, page)}: ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * Negative control: the history the scan leaves out really does name the
   * old switches, so the pattern list catches them where they appear and the
   * exclusions are not hiding anything else.
   */
  it("negative control: the upgrade history still names the old switches, and only there", () => {
    for (const history of HISTORY) {
      const markdown: string = read(history.page);
      const historyCopy: string =
        history.section === null
          ? markdown
          : getSection(markdown, history.section);

      expect({
        page: path.relative(DOCS_CONTENT_DIR, history.page),
        named: retiredSwitchesNamed(historyCopy).length > 0,
      }).toEqual({
        page: path.relative(DOCS_CONTENT_DIR, history.page),
        named: true,
      });
    }
  });
});

describe("the AI SRE page", () => {
  const page: string = readFlat(AI_SRE_PAGE);

  it("says where Enable AI lives, and that it is on by default", () => {
    expect(page).toContain(
      "**Make sure AI is enabled for the project** (it is by default) — Project Settings > AI > AI Features > Enable AI.",
    );
  });

  it("says fixes need no project switch but Enable AI", () => {
    expect(page).toContain(
      "The only project switch fixes need is **Enable AI** (Project Settings > AI > AI Features), which is on unless someone turned it off.",
    );
    expect(page).toContain(
      "Fixes through a Runner need no project switch beyond **Enable AI**.",
    );
  });

  it("says Enable AI off stops auto-remediation, runbook rules without AI included", () => {
    expect(page).toContain(
      "Auto-remediation does depend on **Enable AI** (Project Settings > AI > AI Features), the project's one AI switch: with it off, no auto-remediation rule runs — not even one that starts a runbook without AI — and no cluster or resource is fixed.",
    );
  });

  it("no longer sends anyone to Enable AI Command Execution", () => {
    expect(page).not.toContain("Enable AI Command Execution");
    expect(page).not.toContain("that switch is for commands a Runner runs");
    expect(retiredSwitchesNamed(page)).toEqual([]);
  });
});

describe("the Infrastructure AI Agents page", () => {
  const page: string = readFlat(INFRASTRUCTURE_AI_AGENTS_PAGE);

  it("says fixes also need Enable AI, where it lives, and that it is on by default", () => {
    expect(page).toContain(
      "Fixes also need AI to be enabled for the project (**Enable AI** under Project Settings → AI Features), which it is unless someone turned it off.",
    );
  });

  it("still says a resource AI agent is not a Runner, without a switch for Runners", () => {
    expect(page).toContain(
      "Like the Kubernetes AI agent, a resource AI agent is not a Runner. It never appears under Project Settings → Runners, and it is never used as a Bash or SSH host for runbooks.",
    );
    expect(page).not.toContain("that switch is for commands a Runner runs");
  });

  it("no longer asks for auto-remediation or AI command execution to be switched on", () => {
    expect(page).not.toContain("Enable AI Command Execution");
    expect(page).not.toContain(
      "Fixes also need auto-remediation to be enabled for the project",
    );
    expect(retiredSwitchesNamed(page)).toEqual([]);
  });
});
