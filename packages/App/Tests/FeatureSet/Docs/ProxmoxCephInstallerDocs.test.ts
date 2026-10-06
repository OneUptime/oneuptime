import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  PROXMOX_AGENT_INSTALL_DIR,
  getProxmoxAgentUpgradeCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  CEPH_AGENT_INSTALL_DIR,
  getCephAgentUpgradeCommand,
} from "../../../FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Re-running the Proxmox or Ceph install script keeps the answers: it reuses
 * the .env it finds (nothing is asked again) and is how the agent is
 * upgraded. The docs, in English and Persian, and the agents' READMEs say so
 * where they introduce the install script, link from there to the upgrade,
 * show the script again first in the upgrade, and promise only what
 * install.sh does. Markdown is not compiled, so this reads the files.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);

interface Agent {
  name: string;
  page: string;
  dir: string;
  installDir: string;
  upgrade: string;
}

const AGENTS: Array<Agent> = [
  {
    name: "Proxmox",
    page: "telemetry/proxmox.md",
    dir: "agents/ProxmoxAgent",
    installDir: PROXMOX_AGENT_INSTALL_DIR,
    upgrade: getProxmoxAgentUpgradeCommand(),
  },
  {
    name: "Ceph",
    page: "telemetry/ceph.md",
    dir: "agents/CephAgent",
    installDir: CEPH_AGENT_INSTALL_DIR,
    upgrade: getCephAgentUpgradeCommand(),
  },
];

const LANGUAGES: Array<string> = ["en", "fa"];

const QUICK_START: Record<string, string> = {
  en: "## Quick Start (Install Script)",
  fa: "## شروع سریع (اسکریپت نصب)",
};

const UPGRADE: Record<string, string> = {
  en: "## Upgrading the Agent",
  fa: "## ارتقای عامل",
};

// The sentence that says a re-run keeps the .env, in each language.
const REUSES_ENV: Record<string, string> = {
  en: "Running the script again reuses everything in that `.env` instead of prompting again",
  fa: "را از همان `.env` بازاستفاده",
};

function read(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

function readPage(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

// From a heading to the next heading of the same level.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`${heading}\n`);
  expect({ heading, found: start > -1 }).toEqual({ heading, found: true });
  const end: number = markdown.indexOf("\n## ", start + heading.length);
  return markdown.slice(start, end < 0 ? undefined : end);
}

function headingSlugs(markdown: string): Set<string> {
  return new Set<string>(
    Array.from(markdown.matchAll(/^#{1,6} (.+)$/gm)).map(
      (match: RegExpMatchArray): string => {
        return slugify(match[1]!.trim());
      },
    ),
  );
}

function inPageAnchors(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/\]\(#([^)]+)\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe.each(AGENTS)("the $name agent's docs", (agent: Agent) => {
  test.each(LANGUAGES)(
    "%s: the quick start says a re-run reuses the .env, and links to the upgrade",
    (language: string) => {
      const quickStart: string = section(
        readPage(language, agent.page),
        QUICK_START[language]!,
      );
      expect(quickStart).toContain(`\`${agent.installDir}\``);
      expect(quickStart).toContain("`0600`");
      expect(quickStart).toContain(REUSES_ENV[language]!);
      expect(quickStart).toContain(
        `](#${slugify(UPGRADE[language]!.replace(/^## /, ""))})`,
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: every in-page link resolves to a heading of the page",
    (language: string) => {
      const markdown: string = readPage(language, agent.page);
      const slugs: Set<string> = headingSlugs(markdown);
      const anchors: Array<string> = inPageAnchors(markdown);
      expect(anchors.length).toBeGreaterThan(0);
      for (const anchor of anchors) {
        expect({ anchor, resolves: slugs.has(anchor) }).toEqual({
          anchor,
          resolves: true,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the upgrade runs the install script again first, keeps edited files, and gives the Compose way after it",
    (language: string) => {
      const upgrade: string = section(
        readPage(language, agent.page),
        UPGRADE[language]!,
      );
      const script: number = upgrade.indexOf(
        "```bash\n" + agent.upgrade + "\n```",
      );
      expect(script).toBeGreaterThan(-1);
      expect(upgrade.indexOf("curl -fsSLO")).toBeGreaterThan(script);
      expect(upgrade).toContain("`<file>.bak.<timestamp>`");
      // The script finds its folder: no `cd` into it by hand any more.
      expect(upgrade).not.toContain(`cd ${agent.installDir}`);
      expect(upgrade).not.toContain("`cd`");
      if (agent.name === "Ceph") {
        expect(upgrade).toContain("`ceph/`");
      }
    },
  );

  test("the README says the same where it introduces the script and in Upgrading", () => {
    const readme: string = read(`${agent.dir}/README.md`);

    const quickStart: string = section(
      readme,
      "## Quick Start — Install Script",
    );
    expect(quickStart).toContain(
      "re-running the script reuses everything in an existing `.env` instead of prompting again",
    );
    expect(quickStart).toContain("](#upgrading)");
    expect(headingSlugs(readme).has("upgrading")).toBe(true);

    const upgrading: string = section(readme, "## Upgrading");
    expect(upgrading).toContain("```bash\n" + agent.upgrade + "\n```");
    expect(upgrading).toContain("reuses every value in your existing `.env`");
    expect(upgrading).toContain("`<file>.bak.<timestamp>`");
    expect(upgrading).not.toContain(`cd ${agent.installDir}`);
  });

  /*
   * The docs may promise only what install.sh does: it reuses the .env,
   * keeps an edited file as <file>.bak.<timestamp>, pulls the images and
   * recreates the containers.
   */
  test("install.sh does what the docs promise", () => {
    const script: string = read(`${agent.dir}/install.sh`);
    expect(script).toContain("reusing it.");
    expect(script).toContain(
      'printf -v "$name" \'%s\' "$(dotenv_get "$name" "$ENV_FILE")"',
    );
    expect(script).toContain('backup="$dest.bak.$(date +%Y%m%d%H%M%S)"');
    expect(script).toContain("if ! docker compose pull; then");
    expect(script).toMatch(/^docker compose up -d --force-recreate$/m);
    expect(script).toContain('chmod 600 "$ENV_FILE"');
  });
});
