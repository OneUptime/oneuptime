import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Scripts/Docs/FixAnchors.ts, run for real on a content directory of the
 * test's own (DOCS_CONTENT_DIR). It repoints an in-page #anchor that names a
 * heading by its anchor under the old ASCII-only rule, or by the English
 * page's anchor in a translated copy, at the anchor the page renders now.
 *
 * It reads headings as the renderer does now (slugifyMarkdownHeading), as
 * docs:check-anchors and docs:localize-anchors do, and the old rule's anchor
 * is read from that too. Before, it slugified the heading as written - a
 * `<word>` in inline code was taken for a tag, a link's address became part
 * of the anchor - and kept its own copy of the old rule with a single pass
 * of a tag pattern. So it reported working links as unresolved, and could
 * have moved them onto anchors no page has.
 */

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");
const SCRIPT: string = path.join(REPOSITORY, "Scripts/Docs/FixAnchors.ts");
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

// The counts the script reports, by name.
const countsOf: (output: string) => Record<string, number> = (
  output: string,
): Record<string, number> => {
  const counts: Record<string, number> = {};

  for (const [, name, count] of output.matchAll(
    /^\s+(\w[\w ]*?)\s+:\s+(\d+)/gm,
  )) {
    counts[name!.trim()] = Number(count);
  }

  return counts;
};

const FENCE: string = "```";

beforeEach(() => {
  contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-fix-anchors-"));

  // English: links to its own headings, written as the page renders them.
  write("en/cli/reference.md", [
    "# CLI reference",
    "",
    "See [list](#oneuptime-resource-list) and [the guide](#see-the-setup-guide).",
    "",
    "### `oneuptime <resource> list`",
    "",
    "Lists resources.",
    "",
    "## See the [setup guide](/docs/installation/setup)",
    "",
    `${FENCE}bash`,
    "## not a heading",
    "[not a link](#nowhere)",
    FENCE,
    "",
    "## Check it",
  ]);

  /*
   * German, a line-for-line copy of the English page: one link still names
   * a heading by the English anchor, one by its anchor under the old ASCII
   * rule, which dropped every letter outside a-z.
   */
  write("de/cli/reference.md", [
    "# CLI-Referenz",
    "",
    "Siehe [Liste](#oneuptime-resource-list) und [Prüfen](#check-it).",
    "",
    "### `oneuptime <resource> list`",
    "",
    "Listet Ressourcen auf.",
    "",
    "## Größen prüfen",
    "",
    `${FENCE}bash`,
    "## kein Titel",
    "[kein Link](#nirgends)",
    FENCE,
    "",
    "## Prüfen",
  ]);
  write("de/cli/old-anchors.md", [
    "# Alte Anker",
    "",
    "Zurück zu [Größen](#gren-prfen) und [Unbekannt](#gibt-es-nicht).",
    "",
    "## Größen prüfen",
  ]);
});

afterEach(() => {
  fs.rmSync(contentDir, { recursive: true, force: true });
});

describe("FixAnchors", () => {
  it("reads a heading with a <word> in inline code, or a link, as the page does", () => {
    const result: SpawnSyncReturns<string> = run([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DRY RUN");
    /*
     * English: #oneuptime-resource-list and #see-the-setup-guide are the
     * page's own anchors; read as written, the first lost "resource" and
     * the second took the link's address, and both were unresolved.
     */
    expect(result.stdout).not.toContain("en/cli/reference.md");
  });

  it("reports what it would repoint, and changes nothing without --apply", () => {
    const before: string = read("de/cli/reference.md");
    const result: SpawnSyncReturns<string> = run([]);
    const counts: Record<string, number> = countsOf(result.stdout);

    expect(counts["already correct"]).toBe(3);
    expect(counts["repointed"]).toBe(2);
    expect(counts["unresolved"]).toBe(1);
    expect(result.stdout).toContain(
      "de/cli/old-anchors.md:3 -> #gibt-es-nicht",
    );
    expect(read("de/cli/reference.md")).toBe(before);
  });

  it("repoints the English and the old-rule anchors at the page's own with --apply", () => {
    const result: SpawnSyncReturns<string> = run(["--apply"]);

    expect(result.stdout).toContain("APPLIED");

    const reference: string = read("de/cli/reference.md");
    // The English anchor of the heading in the same place: Prüfen.
    expect(reference).toContain("[Prüfen](#prüfen)");
    // A heading the translation shares with English keeps its anchor.
    expect(reference).toContain("[Liste](#oneuptime-resource-list)");
    // Code samples are left as they are.
    expect(reference).toContain("[kein Link](#nirgends)");

    const oldAnchors: string = read("de/cli/old-anchors.md");
    // The old rule dropped ö and ü: #gren-prfen is the heading Größen prüfen.
    expect(oldAnchors).toContain("[Größen](#größen-prüfen)");
    // What names no heading at all is left as it is.
    expect(oldAnchors).toContain("[Unbekannt](#gibt-es-nicht)");

    // English is already right, and is not touched.
    expect(read("en/cli/reference.md")).toContain(
      "See [list](#oneuptime-resource-list) and [the guide](#see-the-setup-guide).",
    );
  });

  it("finds nothing more to do once it has run", () => {
    run(["--apply"]);
    const counts: Record<string, number> = countsOf(run([]).stdout);

    expect(counts["repointed"]).toBe(0);
    expect(counts["unresolved"]).toBe(1);
  });
});
