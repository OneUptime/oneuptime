import {
  DOCS_LANGUAGES,
  DocsFence,
  listPages,
  scanPage,
} from "./DocsContentSupport";
import { beforeAll, describe, expect, it } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import path from "path";

/*
 * Every Mermaid diagram in every language parses.
 *
 * A diagram that does not parse is drawn as its source under "This diagram
 * could not be drawn" - the page still loads, so nothing else notices, and
 * translated labels are where it happens: an unquoted parenthesis or colon in
 * a German or Japanese label is a syntax error the English never had.
 *
 * mermaid is an ES module that wants a DOM, so the diagrams are parsed by
 * mermaid itself in a child process, under jsdom, with the copies Common
 * installs - the ones the docs serve (see Common/Scripts/
 * build-mermaid-browser.js).
 */

const COMMON_DIR: string = path.resolve(__dirname, "../../../../Common");

interface Diagram {
  where: string;
  code: string;
}

interface ParseResult {
  where: string;
  ok: boolean;
  type?: string;
  error?: string;
}

const PARSER: string = `
import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire(${JSON.stringify(path.join(COMMON_DIR, "package.json"))});
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
try {
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
} catch (e) {
  /* Node's own navigator is fine where it cannot be replaced. */
}

const mermaid = (await import(pathToFileURL(require.resolve("mermaid")).href)).default;
mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true });

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const results = [];
for (const diagram of JSON.parse(input)) {
  try {
    const parsed = await mermaid.parse(diagram.code);
    results.push({ where: diagram.where, ok: true, type: parsed.diagramType });
  } catch (error) {
    results.push({ where: diagram.where, ok: false, error: String((error && error.message) || error).split("\\n").slice(0, 4).join(" | ") });
  }
}
process.stdout.write(JSON.stringify(results));
`;

const diagrams: Array<Diagram> = DOCS_LANGUAGES.flatMap(
  (lang: string): Array<Diagram> => {
    return listPages(lang).flatMap((page: string): Array<Diagram> => {
      return scanPage(lang, page)
        .fences.filter((fence: DocsFence): boolean => {
          return fence.lang === "mermaid";
        })
        .map((fence: DocsFence): Diagram => {
          return { where: `${lang}/${page}:${fence.line}`, code: fence.code };
        });
    });
  },
);

/*
 * Controls, parsed with the pages': one that parses and one that does not,
 * so a parser that passed (or failed) everything would be caught.
 */
const CONTROLS: Array<Diagram> = [
  {
    where: "control/good",
    code: "flowchart LR\n  A[Probe] --> B{Criteria met?}",
  },
  { where: "control/bad", code: "flowchart LR\n  A[Probe --> " },
];

let results: Array<ParseResult> = [];

beforeAll(() => {
  const run: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", PARSER],
    {
      cwd: COMMON_DIR,
      input: JSON.stringify([...CONTROLS, ...diagrams]),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 240000,
    },
  );

  if (run.status !== 0) {
    throw new Error(
      `The diagram parser did not run: ${run.stderr || run.error?.message}`,
    );
  }

  const all: Array<ParseResult> = JSON.parse(run.stdout) as Array<ParseResult>;
  controls = all.slice(0, CONTROLS.length);
  results = all.slice(CONTROLS.length);
}, 300000);

let controls: Array<ParseResult> = [];

describe("docs diagrams", () => {
  it("control: the parser accepts a good diagram and rejects a broken one", () => {
    expect(
      controls.map((result: ParseResult): [string, boolean] => {
        return [result.where, result.ok];
      }),
    ).toEqual([
      ["control/good", true],
      ["control/bad", false],
    ]);
  });

  it("are all parsed, one result per diagram", () => {
    expect(results).toHaveLength(diagrams.length);
  });

  it("all parse, in every language", () => {
    const failures: Array<string> = results
      .filter((result: ParseResult): boolean => {
        return !result.ok;
      })
      .map((result: ParseResult): string => {
        return `${result.where}: ${result.error}`;
      });

    expect(failures).toEqual([]);
  });

  it("are the same kind of diagram in every language as in English", () => {
    const typeOf: Map<string, string> = new Map(
      results.map((result: ParseResult): [string, string] => {
        return [result.where, result.type || ""];
      }),
    );
    const mismatches: Array<string> = [];

    for (const lang of DOCS_LANGUAGES) {
      if (lang === "en") {
        continue;
      }
      for (const page of listPages(lang)) {
        const ours: Array<DocsFence> = scanPage(lang, page).fences.filter(
          (fence: DocsFence): boolean => {
            return fence.lang === "mermaid";
          },
        );
        const english: Array<DocsFence> = listPages("en").includes(page)
          ? scanPage("en", page).fences.filter((fence: DocsFence): boolean => {
              return fence.lang === "mermaid";
            })
          : [];

        ours.forEach((fence: DocsFence, index: number): void => {
          const counterpart: DocsFence | undefined = english[index];
          if (!counterpart) {
            return;
          }
          const theirs: string | undefined = typeOf.get(
            `en/${page}:${counterpart.line}`,
          );
          const mine: string | undefined = typeOf.get(
            `${lang}/${page}:${fence.line}`,
          );
          if (theirs && mine && theirs !== mine) {
            mismatches.push(
              `${lang}/${page}:${fence.line} is ${mine}, English is ${theirs}`,
            );
          }
        });
      }
    }

    expect(mismatches).toEqual([]);
  });
});
