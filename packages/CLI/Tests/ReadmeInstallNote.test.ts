import * as fs from "fs";
import * as path from "path";

/*
 * The CLI's README is the page npm shows for @oneuptime/cli. Every CLI npm
 * has from before 14.0.64 - 1.0.0, then 10.0.5 to 14.0.63 - stops as soon as
 * it starts, with "Cannot find module 'Common/...'": tsc left the CLI's
 * imports of Common as bare require() calls that no installed package could
 * answer (#4872). 14.0.64 is the first CLI npm publishes as one bundle
 * (#4900). The docs' CLI page warns about the old versions under "Install
 * the CLI"; the README now does too, where npm users read first, and says,
 * as the docs do, which version a self-hosted OneUptime takes.
 *
 * These hold the README's note to the CLI it describes, and to how npm draws
 * a README: no GitHub-only alert syntax, and links that are whole addresses.
 * App's CliDocsFacts holds it to the docs' note, word for word.
 */

const CLI_ROOT: string = path.join(__dirname, "..");
const README: string = fs.readFileSync(
  path.join(CLI_ROOT, "README.md"),
  "utf-8",
);
const DOCS_DIR: string = path.join(
  CLI_ROOT,
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);
const NAV: string = fs.readFileSync(
  path.join(CLI_ROOT, "..", "App", "FeatureSet", "Docs", "Utils", "Nav.ts"),
  "utf-8",
);

const FIRST_CLI_THAT_STARTS: string = "14.0.64";

const HEADING: RegExp = /^(#{1,6})\s/;
/*
 * Every link of a text: [words](target). The target runs to its ")" and
 * holds no "(" or "]", so a run of "](" is read once, not from each one.
 */
const LINK: RegExp = /\]\(([^()\s\]]+)\)/g;
// A link into OneUptime's docs: the page and, after #, the heading.
const DOCS_LINK: RegExp =
  /^https:\/\/oneuptime\.com\/docs\/([a-z0-9/-]+)(?:#([a-z0-9-]+))?$/;
const NOT_SLUG: RegExp = /[^a-z0-9 -]/g;
const SPACES: RegExp = / /g;

// A section of the README: its heading line and everything up to the next heading of its level or higher.
function section(heading: string): string {
  const lines: Array<string> = README.split("\n");
  const start: number = lines.indexOf(heading);

  if (start === -1) {
    throw new Error(`No heading "${heading}" in the README`);
  }

  const level: number = (heading.match(HEADING)?.[1] || "").length;
  const found: Array<string> = [heading];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(HEADING);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    found.push(line);
  }

  return found.join("\n");
}

// The anchor a docs page gives a plain heading (lower case, spaces to dashes).
function anchorOf(headingLine: string): string {
  const marker: RegExpMatchArray | null = headingLine.match(HEADING);
  // The heading's words: "## How to upgrade" -> "How to upgrade".
  const text: string = marker
    ? headingLine.slice((marker[0] as string).length).trim()
    : "";

  return text.toLowerCase().replace(NOT_SLUG, "").replace(SPACES, "-");
}

// a < b: negative; a = b: 0; a > b: positive. Versions as VERSION writes them.
function compareVersions(a: string, b: string): number {
  const left: Array<number> = a.split(".").map(Number);
  const right: Array<number> = b.split(".").map(Number);

  for (let index: number = 0; index < 3; index++) {
    const difference: number = (left[index] || 0) - (right[index] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

const INSTALLATION: string = section("## Installation");

const VERSION_ADVICE: string =
  "The CLI is released with OneUptime and has the same version number. On a self-hosted OneUptime, install the CLI of your OneUptime's version, so its commands match the records your server has:";
const WARNING: string = `> **Warning:** CLI versions before ${FIRST_CLI_THAT_STARTS} stop as soon as they start, with an error such as \`Cannot find module 'Common/Models/DatabaseModels/Index'\`. Install ${FIRST_CLI_THAT_STARTS} or later with \`npm install -g @oneuptime/cli@latest\`. On a self-hosted OneUptime older than ${FIRST_CLI_THAT_STARTS}, [upgrade OneUptime](https://oneuptime.com/docs/installation/upgrading#how-to-upgrade) first, then install the CLI of the version you upgraded to.`;

describe("the CLI README's install section", () => {
  it("says which CLI a self-hosted OneUptime takes, with the command", () => {
    expect(INSTALLATION).toContain(VERSION_ADVICE);
    expect(INSTALLATION).toContain(
      "```bash\nnpm install -g @oneuptime/cli@<your-oneuptime-version>\n```",
    );
  });

  it("warns that the CLI versions before the bundled one stop at start, with the error they print, and says how to get past it", () => {
    expect(INSTALLATION.split("\n")).toContain(WARNING);
  });

  it("warns right after that advice, and the warning ends the section: running the CLI from the repository is under Development", () => {
    const advice: number = INSTALLATION.indexOf(VERSION_ADVICE);
    const warning: number = INSTALLATION.indexOf(WARNING);

    expect(advice).toBeGreaterThan(-1);
    expect(warning).toBeGreaterThan(advice);
    /*
     * npm's page is read by people installing the CLI: what follows the
     * warning is Quick Start, not a contributor's way of running it, which
     * the Development section has.
     */
    expect(INSTALLATION.slice(warning + WARNING.length).trim()).toBe("");
    expect(INSTALLATION).not.toContain("cd packages/CLI");

    const development: string = section("## Development");

    expect(development).toContain("cd packages/CLI\nnpm install\n");
    expect(development).toContain("npm start -- --help");
  });

  it("reads on npm: a bold label, not GitHub's alert syntax, which npm shows as text", () => {
    expect(README).not.toContain("[!WARNING]");
    expect(README).not.toContain("[!NOTE]");
    expect(WARNING.startsWith("> **Warning:** ")).toBe(true);
  });

  it("links with whole addresses, which npm's page can follow, to a docs page and heading that are there", () => {
    const links: Array<string> = [...INSTALLATION.matchAll(LINK)].map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    expect(links).toEqual([
      "https://oneuptime.com/docs/installation/upgrading#how-to-upgrade",
    ]);

    for (const link of links) {
      const docs: RegExpMatchArray | null = link.match(DOCS_LINK);

      expect({ link, docs: docs !== null }).toEqual({ link, docs: true });

      const page: string = (docs as RegExpMatchArray)[1] as string;
      const anchor: string | undefined = (docs as RegExpMatchArray)[2];
      const file: string = path.join(DOCS_DIR, `${page}.md`);

      expect(NAV).toContain(`url: "/docs/${page}"`);
      expect(fs.existsSync(file)).toBe(true);

      if (anchor) {
        const anchors: Array<string> = fs
          .readFileSync(file, "utf-8")
          .split("\n")
          .filter((line: string): boolean => {
            return HEADING.test(line);
          })
          .map(anchorOf);

        expect(anchors).toContain(anchor);
      }
    }
  });
});

describe("what makes the note true", () => {
  const manifest: {
    version: string;
    dependencies?: Record<string, string>;
    files: Array<string>;
  } = JSON.parse(
    fs.readFileSync(path.join(CLI_ROOT, "package.json"), "utf-8"),
  ) as {
    version: string;
    dependencies?: Record<string, string>;
    files: Array<string>;
  };

  it("npm gets one bundle that needs nothing beside it, so nothing is left for it to require", () => {
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.files).toEqual([
      "build/dist/Index.js",
      "build/dist/THIRD-PARTY-LICENSES.txt",
    ]);
  });

  it("the module the old versions cannot find is the one the CLI's resource commands import", () => {
    expect(
      fs.readFileSync(
        path.join(CLI_ROOT, "Commands", "ResourceCommands.ts"),
        "utf-8",
      ),
    ).toContain(
      'import DatabaseModels from "Common/Models/DatabaseModels/Index";',
    );
  });

  it("the CLI is at that version or past it, so @latest is a CLI that starts", () => {
    expect(
      compareVersions(manifest.version, FIRST_CLI_THAT_STARTS),
    ).toBeGreaterThanOrEqual(0);
  });

  it("reads versions in order", () => {
    expect(compareVersions("14.0.63", "14.0.64")).toBeLessThan(0);
    expect(compareVersions("14.0.64", "14.0.64")).toBe(0);
    expect(compareVersions("14.1.0", "14.0.64")).toBeGreaterThan(0);
    expect(compareVersions("10.0.5", "9.9.9")).toBeGreaterThan(0);
  });
});
