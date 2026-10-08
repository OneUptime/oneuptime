import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * `npm run docs:localize-anchors` (Scripts/Docs/LocalizeAnchors.ts), run
 * for real on a content directory of the test's own (DOCS_CONTENT_DIR):
 *
 *   - an English #anchor in a translated page is pointed at the heading in
 *     the same place in the translation - in the page itself or in another
 *     page - when the two copies have the same shape;
 *   - a translation with as many headings as the English page, but not the
 *     same ones (a stale one: a section added, dropped or moved), is never
 *     mapped by position: the link is reported and left alone. Mapping it
 *     sent links to the wrong section;
 *   - links into a page with no translation, anchors the translation has,
 *     and anchors that are not valid percent-encoding are left alone;
 *   - nothing is written without --apply, and --lang / --page limit it.
 */

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");
const SCRIPT: string = path.join(REPOSITORY, "Scripts/Docs/LocalizeAnchors.ts");
const TS_NODE: string = require.resolve("ts-node/dist/bin.js");

let contentDir: string = "";

const write: (file: string, lines: Array<string>) => void = (
  file: string,
  lines: Array<string>,
): void => {
  const full: string = path.join(contentDir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, lines.join("\n"));
};

const read: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(contentDir, file), "utf8");
};

const run: (args: Array<string>) => SpawnSyncReturns<string> = (
  args: Array<string>,
): SpawnSyncReturns<string> => {
  return spawnSync(
    process.execPath,
    [TS_NODE, "--transpile-only", SCRIPT, ...args],
    {
      cwd: path.join(REPOSITORY, "Scripts"),
      env: { ...process.env, DOCS_CONTENT_DIR: contentDir },
      encoding: "utf8",
      timeout: 120000,
    },
  );
};

const FENCE: string = "```";

beforeEach(() => {
  contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-localize-"));

  write("en/guide/setup.md", [
    "# Setup",
    "",
    "## Install the agent",
    "",
    `${FENCE}bash`,
    "## not a heading, a comment in a sample",
    "npm install",
    FENCE,
    "",
    "## Check it",
    "",
    "Go back to [install](#install-the-agent).",
    "",
    "### `oneuptime <resource> list`",
    "",
    "Lists resources.",
  ]);
  write("de/guide/setup.md", [
    "# Einrichtung",
    "",
    "## Agent installieren",
    "",
    `${FENCE}bash`,
    "## kein Titel",
    "npm install",
    FENCE,
    "",
    "## Prüfen",
    "",
    "Zurück zur [Installation](#install-the-agent).",
    "",
    "### `oneuptime <resource> list`",
    "",
    "Listet Ressourcen auf.",
  ]);
  write("fr/guide/setup.md", [
    "# Installation",
    "",
    "## Installer l'agent",
    "",
    `${FENCE}bash`,
    "npm install",
    FENCE,
    "",
    "## Vérifier",
    "",
    "Voir [installer](#install-the-agent).",
    "",
    "### `oneuptime <resource> list`",
    "",
    "Liste.",
  ]);

  /*
   * English: Intro, Webhook, Data components. The German copy is stale: it
   * has as many headings, but Email where English has Webhook.
   */
  write("en/guide/components.md", [
    "# Components",
    "",
    "## Intro",
    "",
    "## Webhook",
    "",
    `${FENCE}json`,
    "{}",
    FENCE,
    "",
    "## Data components",
  ]);
  write("de/guide/components.md", [
    "# Komponenten",
    "",
    "## Einführung",
    "",
    "## E-Mail",
    "",
    "## Datenkomponenten",
    "",
    `${FENCE}json`,
    "{}",
    FENCE,
  ]);

  write("en/guide/only-english.md", ["# Only English", "", "## Details"]);

  write("de/guide/links.md", [
    "# Links",
    "",
    "- [Prüfen](/docs/guide/setup#check-it)",
    "- [Liste](/docs/guide/setup#oneuptime-resource-list)",
    "- [Daten](/docs/guide/components#data-components)",
    "- [Englisch](/docs/guide/only-english#details)",
    "- [Schon richtig](/docs/guide/setup#prüfen)",
    "- [Kaputt](/docs/guide/setup#%E0%A4%A)",
    "",
    FENCE + "markdown",
    "[in a sample](/docs/guide/setup#check-it)",
    FENCE,
  ]);
  write("en/guide/links.md", ["# Links", "", "Nothing to localize."]);
});

afterEach(() => {
  fs.rmSync(contentDir, { recursive: true, force: true });
});

describe("docs:localize-anchors", () => {
  it("reports, without --apply, what it would change, and changes nothing", () => {
    const before: string = read("de/guide/setup.md");
    const result: SpawnSyncReturns<string> = run(["--lang", "de"]);

    expect(result.stdout).toContain(
      "de/guide/setup.md:12  #install-the-agent  ->  #agent-installieren",
    );
    expect(result.stdout).toContain(
      "de/guide/links.md:3  /docs/guide/setup#check-it  ->  /docs/guide/setup#prüfen",
    );
    expect(read("de/guide/setup.md")).toBe(before);
  });

  it("points English anchors at the translated headings with --apply", () => {
    run(["--apply", "--lang", "de"]);

    expect(read("de/guide/setup.md")).toContain(
      "Zurück zur [Installation](#agent-installieren).",
    );
    const links: string = read("de/guide/links.md");
    expect(links).toContain("- [Prüfen](/docs/guide/setup#prüfen)");
  });

  it("names a heading with a <word> in inline code as the page does", () => {
    /*
     * The page renders `oneuptime <resource> list` with entities, so its id
     * keeps "resource": the anchor already lands, and is left alone.
     */
    const result: SpawnSyncReturns<string> = run(["--lang", "de"]);

    expect(result.stdout).not.toContain("oneuptime-resource-list  ->");
    expect(result.stderr).not.toContain("oneuptime-resource-list");
  });

  it("never maps a stale translation by position, even with as many headings", () => {
    const result: SpawnSyncReturns<string> = run(["--apply", "--lang", "de"]);

    /*
     * By position, #data-components would have become #datenkomponenten by
     * luck here - and #webhook the German Email section. Neither is trusted.
     */
    expect(read("de/guide/links.md")).toContain(
      "- [Daten](/docs/guide/components#data-components)",
    );
    expect(result.stderr).toContain(
      "de/guide/links.md:5 -> /docs/guide/components#data-components (the de copy of guide/components does not have the English page's headings and code samples: translate it again first)",
    );
    expect(result.status).toBe(1);
  });

  it("leaves links into an untranslated page, valid anchors and code samples alone", () => {
    const before: string = read("de/guide/links.md");
    run(["--apply", "--lang", "de"]);
    const after: string = read("de/guide/links.md");

    expect(after).toContain("- [Englisch](/docs/guide/only-english#details)");
    expect(after).toContain("- [Schon richtig](/docs/guide/setup#prüfen)");
    expect(after).toContain("[in a sample](/docs/guide/setup#check-it)");
    // Only the one link it could map changed.
    expect(
      after.split("\n").filter((line: string, index: number): boolean => {
        return line !== before.split("\n")[index];
      }),
    ).toEqual(["- [Prüfen](/docs/guide/setup#prüfen)"]);
  });

  it("does not stop at an anchor that is not valid percent-encoding", () => {
    const result: SpawnSyncReturns<string> = run(["--lang", "de"]);

    expect(result.stderr).toContain(
      "de/guide/links.md:8 -> /docs/guide/setup#%E0%A4%A (no heading of the English guide/setup has this anchor)",
    );
    expect(result.stdout).toContain("anchor(s) to localize");
  });

  it("works on the languages and pages it is given, and only those", () => {
    run(["--apply", "--lang", "fr"]);

    expect(read("fr/guide/setup.md")).toContain(
      "Voir [installer](#installer-lagent).",
    );
    expect(read("de/guide/setup.md")).toContain(
      "Zurück zur [Installation](#install-the-agent).",
    );

    run(["--apply", "--lang", "de", "--page", "guide/setup.md"]);

    expect(read("de/guide/setup.md")).toContain(
      "Zurück zur [Installation](#agent-installieren).",
    );
    expect(read("de/guide/links.md")).toContain(
      "- [Prüfen](/docs/guide/setup#check-it)",
    );
  });

  it("exits 0 when every anchor it looked at lands", () => {
    const result: SpawnSyncReturns<string> = run([
      "--apply",
      "--lang",
      "de",
      "--page",
      "guide/setup",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 anchor(s) localized.");
  });
});
