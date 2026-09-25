import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The OpenTelemetry Collector example on telemetry/open-telemetry, in all 17
 * docs languages, read as the YAML a reader pastes into a collector.
 *
 * Issue #3978 asked whether a pipeline already exporting to Datadog can be
 * pointed at OneUptime. The honest answer is "swap the exporter block", which
 * makes this example the thing people copy. It used to set `encoding: json`
 * and a `"Content-Type": "application/json"` header, with a comment claiming
 * the JSON encoder was required. It is not: ingest decodes the exporter's
 * default protobuf, and protobuf is the smaller, cheaper wire format. The two
 * lines also have to leave together. The collector applies configured headers
 * over the exporter's own, so a leftover JSON Content-Type next to the default
 * protobuf encoding labels protobuf bytes as JSON, and ingest picks its decoder
 * from that header (OtelPayloadDecoder.formatFromContentType).
 *
 * Markdown is not compiled, so nothing else notices when one of the 17 copies
 * drifts: a translation that keeps the old exporter, a key a translator
 * localised, an indentation slip that turns `headers` into a sibling of
 * `otlphttp`. So each block is parsed with a real YAML parser and checked as
 * configuration, not as text:
 *
 *   - every yaml block on every locale's page parses, to a mapping;
 *   - the collector example exports over otlphttp to an https `/otlp`
 *     endpoint, with the x-oneuptime-token header, in the default encoding
 *     and with no Content-Type override;
 *   - traces, metrics and logs all export through it, and every component a
 *     pipeline names is defined (a collector refuses to start otherwise);
 *   - every translation parses to exactly the English configuration.
 *     Translations may differ in comments, and in the placeholder values a
 *     reader replaces anyway (fr says JETON_ONEUPTIME where English says
 *     ONEUPTIME_TOKEN, it says mio-servizio for my-service). Those are
 *     masked after checking they are non-empty. Every key, endpoint, port,
 *     header name and pipeline must match exactly.
 *
 * Prose is deliberately not asserted anywhere. The only English text read
 * outside the YAML is the environment-variable table and the shell example,
 * whose contents are identifiers and values, not sentences.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Docs/Content",
);
const OTEL_INGEST_ROUTER_FILE: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Telemetry/API/OTelIngest.ts",
);
const TELEMETRY_INGEST_MIDDLEWARE_FILE: string = path.join(
  PACKAGES_DIR,
  "Common/Server/Middleware/TelemetryIngest.ts",
);
const NGINX_TEMPLATE_FILE: string = path.join(
  PACKAGES_DIR,
  "Nginx/default.conf.template",
);

const PAGE: string = "telemetry/open-telemetry";
const PAGE_URL: string = `/docs/${PAGE}`;

/*
 * Written out rather than derived from SUPPORTED_DOCS_LANGUAGE_CODES, so
 * that dropping a language from the supported list fails here instead of
 * quietly shrinking what this file checks.
 */
const EXPECTED_LANGUAGES: ReadonlyArray<string> = [
  "da",
  "de",
  "en",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

const TRANSLATED_LANGUAGES: ReadonlyArray<string> = EXPECTED_LANGUAGES.filter(
  (lang: string): boolean => {
    return lang !== DEFAULT_DOCS_LANGUAGE;
  },
);

const EXPORTER: string = "otlphttp";
const TOKEN_HEADER: string = "x-oneuptime-token";
const REQUIRED_SIGNALS: ReadonlyArray<string> = ["traces", "metrics", "logs"];

/*
 * Values that are placeholders for the reader's own input, which a
 * translation may localise. The token is masked by header name, since its
 * value sits inside the collector YAML and OTEL_EXPORTER_OTLP_HEADERS.
 */
const LOCALISABLE_ENV_VALUES: ReadonlyArray<string> = ["OTEL_SERVICE_NAME"];
const HEADERS_ENV_VAR: string = "OTEL_EXPORTER_OTLP_HEADERS";
const MASKED: string = "<placeholder>";

const YAML_INFO_STRINGS: ReadonlyArray<string> = ["yaml", "yml"];
const SHELL_INFO_STRINGS: ReadonlyArray<string> = ["bash", "sh", "shell"];

const OPENING_FENCE: RegExp = /^(\s*)(`{3,}|~{3,})\s*([^\s`{]*)/;
const TABLE_ROW: RegExp = /^\s*\|(.*)\|\s*$/;
const TABLE_SEPARATOR_CELL: RegExp = /^:?-+:?$/;
const ENV_VAR_NAME: RegExp = /^OTEL_[A-Z0-9_]+$/;
const EXPORT_LINE: RegExp = /^\s*export\s+([A-Z_][A-Z0-9_]*)=(.*)$/;

/*
 * The raw-text twins of the parsed checks. A commented-out `# encoding: json`
 * parses to nothing, so the parsed checks cannot see it, but a reader still
 * copies it and uncomments it.
 */
const JSON_ENCODING_TEXT: RegExp = /encoding\s*:\s*["']?json/i;
const CONTENT_TYPE_KEY_TEXT: RegExp = /["']?content-type["']?\s*:/i;
const APPLICATION_JSON_TEXT: RegExp = /application\/json/i;

/*
 * js-yaml is loaded from Common/node_modules deliberately, the way
 * SpaFallbackBehaviour.test.ts loads express. Common declares js-yaml 4 as a
 * dependency and CI installs Common's modules for the App suite. App declares
 * no YAML parser, and the js-yaml 3 that happens to sit in App/node_modules
 * is a transitive dev dependency of the test runner, not something to lean
 * on. js-yaml 4's `load` uses the safe default schema and rejects duplicated
 * mapping keys, as the collector's own YAML reader does.
 */
interface YamlLoadOptions {
  filename?: string;
}

interface JsYamlModule {
  load: (text: string, options?: YamlLoadOptions) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(PACKAGES_DIR, "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

type YamlMap = { [key: string]: unknown };

interface FencedBlock {
  // Lower-cased language tag: "yaml", "bash", or "" when there is none.
  info: string;
  // The content between the fences, with the fence's own indentation removed.
  body: string;
  // 1-based line of the opening fence, for failure messages.
  startLine: number;
}

interface OpenFence {
  indent: number;
  marker: string;
  info: string;
  startLine: number;
  body: Array<string>;
}

function pagePath(lang: string): string {
  return path.join(CONTENT_DIR, lang, `${PAGE}.md`);
}

const pageCache: Map<string, string> = new Map<string, string>();

function readPage(lang: string): string {
  const cached: string | undefined = pageCache.get(lang);

  if (cached !== undefined) {
    return cached;
  }

  const markdown: string = fs.readFileSync(pagePath(lang), "utf8");
  pageCache.set(lang, markdown);
  return markdown;
}

function removeIndent(line: string, indent: number): string {
  let removed: number = 0;

  while (removed < indent && line[removed] === " ") {
    removed++;
  }

  return line.slice(removed);
}

/*
 * Fenced code blocks, in page order. A closing fence is the same character
 * as the opening one, at least as long, with nothing else on the line, so a
 * ``` inside a ```` block stays content. An unterminated fence throws rather
 * than returning what it has: silently dropping the last block would let the
 * checks below pass on a page that no longer shows the example at all.
 */
function fencedBlocksOf(markdown: string, where: string): Array<FencedBlock> {
  const lines: Array<string> = markdown.split(/\r?\n/);
  const blocks: Array<FencedBlock> = [];
  let open: OpenFence | null = null;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index]!;

    if (open === null) {
      const match: RegExpMatchArray | null = line.match(OPENING_FENCE);

      if (match) {
        open = {
          indent: match[1]!.length,
          marker: match[2]!,
          info: match[3]!.toLowerCase(),
          startLine: index + 1,
          body: [],
        };
      }
      continue;
    }

    const trimmed: string = line.trim();
    const closes: boolean =
      trimmed.length >= open.marker.length &&
      trimmed === open.marker[0]!.repeat(trimmed.length);

    if (closes) {
      blocks.push({
        info: open.info,
        body: open.body.join("\n"),
        startLine: open.startLine,
      });
      open = null;
      continue;
    }

    open.body.push(removeIndent(line, open.indent));
  }

  if (open !== null) {
    throw new Error(
      `${where}: unterminated code fence opened on line ${open.startLine}`,
    );
  }

  return blocks;
}

function blocksWithInfo(
  lang: string,
  infos: ReadonlyArray<string>,
): Array<FencedBlock> {
  return fencedBlocksOf(readPage(lang), `${lang}/${PAGE}.md`).filter(
    (block: FencedBlock): boolean => {
      return infos.includes(block.info);
    },
  );
}

function yamlBlocksOf(lang: string): Array<FencedBlock> {
  return blocksWithInfo(lang, YAML_INFO_STRINGS);
}

function kindOf(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "sequence";
  }

  if (typeof value === "object") {
    return "mapping";
  }

  return typeof value;
}

function isMapping(value: unknown): value is YamlMap {
  return kindOf(value) === "mapping";
}

/*
 * Each helper that asserts puts the location into the compared value, so a
 * failure names the language and the key path rather than showing a bare
 * "expected mapping".
 */
function expectMapping(value: unknown, what: string): YamlMap {
  expect({ what, kind: kindOf(value) }).toEqual({ what, kind: "mapping" });
  return value as YamlMap;
}

function mappingAt(
  root: YamlMap,
  keys: ReadonlyArray<string>,
  where: string,
): YamlMap {
  let current: YamlMap = root;

  keys.forEach((key: string, index: number): void => {
    current = expectMapping(
      current[key],
      `${where} ${keys.slice(0, index + 1).join(".")}`,
    );
  });

  return current;
}

function stringsAt(map: YamlMap, key: string, what: string): Array<string> {
  const value: unknown = map[key];

  expect({ what, kind: kindOf(value) }).toEqual({ what, kind: "sequence" });

  const items: Array<unknown> = value as Array<unknown>;

  expect({
    what,
    kinds: items.map((item: unknown): string => {
      return kindOf(item);
    }),
  }).toEqual({
    what,
    kinds: items.map((): string => {
      return "string";
    }),
  });

  return items as Array<string>;
}

function parseYamlBlock(block: FencedBlock, where: string): unknown {
  return jsYaml.load(block.body, {
    filename: `${where}:${block.startLine}`,
  });
}

function parsedYamlBlocksOf(lang: string): Array<unknown> {
  return yamlBlocksOf(lang).map((block: FencedBlock): unknown => {
    return parseYamlBlock(block, `${lang}/${PAGE}.md`);
  });
}

function hasCollectorExporter(parsed: unknown): boolean {
  if (!isMapping(parsed)) {
    return false;
  }

  const exporters: unknown = parsed["exporters"];

  return isMapping(exporters) && exporters[EXPORTER] !== undefined;
}

interface CollectorExample {
  block: FencedBlock;
  config: YamlMap;
}

/*
 * The collector example is the yaml block that configures the otlphttp
 * exporter, found by what it configures rather than by position, so a new
 * yaml block elsewhere on the page does not shift which one is checked.
 */
function collectorExampleOf(lang: string): CollectorExample {
  const where: string = `${lang}/${PAGE}.md`;

  const examples: Array<CollectorExample> = yamlBlocksOf(lang)
    .map((block: FencedBlock): { block: FencedBlock; parsed: unknown } => {
      return { block, parsed: parseYamlBlock(block, where) };
    })
    .filter((candidate: { block: FencedBlock; parsed: unknown }): boolean => {
      return hasCollectorExporter(candidate.parsed);
    })
    .map(
      (candidate: {
        block: FencedBlock;
        parsed: unknown;
      }): CollectorExample => {
        return { block: candidate.block, config: candidate.parsed as YamlMap };
      },
    );

  expect({ where, collectorExamples: examples.length }).toEqual({
    where,
    collectorExamples: 1,
  });

  return examples[0]!;
}

function exporterOf(lang: string): YamlMap {
  return mappingAt(
    collectorExampleOf(lang).config,
    ["exporters", EXPORTER],
    `${lang}:`,
  );
}

function headerKeysNamed(headers: YamlMap, name: string): Array<string> {
  return Object.keys(headers).filter((key: string): boolean => {
    // HTTP header names are case-insensitive; Node lower-cases them on arrival.
    return key.toLowerCase() === name;
  });
}

/*
 * Pipeline ids are `<signal>` or `<signal>/<name>`, and a collector runs
 * each pipeline's receivers and exporters by the ids they name.
 */
function pipelinesOf(config: YamlMap, where: string): YamlMap {
  return mappingAt(config, ["service", "pipelines"], where);
}

function signalOf(pipelineId: string): string {
  return pipelineId.split("/")[0]!;
}

function tableCellsOutsideFences(markdown: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  let inFence: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const fence: RegExpMatchArray | null = line.match(OPENING_FENCE);

    if (inFence === null && fence) {
      inFence = fence[2]!;
      continue;
    }

    if (inFence !== null) {
      const trimmed: string = line.trim();
      if (
        trimmed.length >= inFence.length &&
        trimmed === inFence[0]!.repeat(trimmed.length)
      ) {
        inFence = null;
      }
      continue;
    }

    const row: RegExpMatchArray | null = line.match(TABLE_ROW);

    if (!row) {
      continue;
    }

    const cells: Array<string> = row[1]!
      .split("|")
      .map((cell: string): string => {
        return cell.trim().replace(/^`(.*)`$/, "$1");
      });

    const isSeparator: boolean = cells.every((cell: string): boolean => {
      return TABLE_SEPARATOR_CELL.test(cell);
    });

    if (!isSeparator) {
      rows.push(cells);
    }
  }

  return rows;
}

/*
 * The environment-variable table, as name -> value. Only rows whose first
 * cell is an OTEL_* identifier count, which skips the header row in every
 * language ("Environment Variable", "环境变量", "متغیر محیطی", ...).
 */
function envTableOf(lang: string): { [name: string]: string } {
  const table: { [name: string]: string } = {};

  for (const cells of tableCellsOutsideFences(readPage(lang))) {
    const name: string = cells[0]!;

    if (ENV_VAR_NAME.test(name)) {
      expect({ lang, name, duplicate: table[name] !== undefined }).toEqual({
        lang,
        name,
        duplicate: false,
      });
      table[name] = cells[1] ?? "";
    }
  }

  return table;
}

function unquote(value: string): string {
  const trimmed: string = value.trim();
  const quoted: RegExpMatchArray | null = trimmed.match(/^(["'])(.*)\1$/);
  return quoted ? quoted[2]! : trimmed;
}

// The `export NAME=value` lines of the page's shell examples.
function shellExportsOf(lang: string): { [name: string]: string } {
  const exported: { [name: string]: string } = {};

  for (const block of blocksWithInfo(lang, SHELL_INFO_STRINGS)) {
    for (const line of block.body.split("\n")) {
      const match: RegExpMatchArray | null = line.match(EXPORT_LINE);

      if (match) {
        exported[match[1]!] = unquote(match[2]!);
      }
    }
  }

  return exported;
}

/*
 * OTEL_EXPORTER_OTLP_HEADERS is a comma-separated list of key=value pairs.
 * Returns the header names, lower-cased.
 */
function headerNamesInEnvValue(value: string): Array<string> {
  return value
    .split(",")
    .map((pair: string): string => {
      return pair.split("=")[0]!.trim().toLowerCase();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });
}

function headerValueInEnvValue(value: string, name: string): string | null {
  for (const pair of value.split(",")) {
    const separator: number = pair.indexOf("=");
    if (
      separator > 0 &&
      pair.slice(0, separator).trim().toLowerCase() === name
    ) {
      return pair.slice(separator + 1).trim();
    }
  }

  return null;
}

/*
 * A non-empty placeholder becomes MASKED and an empty one stays empty, so a
 * translation that blanks a placeholder still differs from English.
 */
function maskValue(value: unknown): unknown {
  return typeof value === "string" && value.trim().length > 0 ? MASKED : value;
}

// A parsed yaml block with the ingestion-key header's value masked.
function withTokenMasked(parsed: unknown): unknown {
  if (!hasCollectorExporter(parsed)) {
    return parsed;
  }

  const clone: YamlMap = JSON.parse(JSON.stringify(parsed)) as YamlMap;
  const exporter: unknown = (clone["exporters"] as YamlMap)[EXPORTER];

  if (!isMapping(exporter) || !isMapping(exporter["headers"])) {
    return clone;
  }

  const headers: YamlMap = exporter["headers"];

  for (const key of headerKeysNamed(headers, TOKEN_HEADER)) {
    headers[key] = maskValue(headers[key]);
  }

  return clone;
}

/*
 * An environment map (the table, or the shell exports) with placeholder
 * values masked: the service name, and each header's value in
 * OTEL_EXPORTER_OTLP_HEADERS. Header names and every other value stay as
 * they are.
 */
function withEnvPlaceholdersMasked(env: { [name: string]: string }): {
  [name: string]: string;
} {
  const masked: { [name: string]: string } = {};

  for (const name of Object.keys(env)) {
    const value: string = env[name]!;

    if (name === HEADERS_ENV_VAR) {
      masked[name] = value
        .split(",")
        .map((pair: string): string => {
          const separator: number = pair.indexOf("=");
          if (separator < 0) {
            return pair.trim();
          }
          return `${pair.slice(0, separator).trim()}=${String(
            maskValue(pair.slice(separator + 1)),
          )}`;
        })
        .join(",");
    } else if (LOCALISABLE_ENV_VALUES.includes(name)) {
      masked[name] = String(maskValue(value));
    } else {
      masked[name] = value;
    }
  }

  return masked;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("OpenTelemetry docs: the collector example (issue #3978)", () => {
  describe("language coverage", () => {
    it("supports exactly the 17 docs languages", () => {
      expect([...SUPPORTED_DOCS_LANGUAGE_CODES].sort()).toEqual([
        ...EXPECTED_LANGUAGES,
      ]);
      expect(EXPECTED_LANGUAGES).toHaveLength(17);
      expect(TRANSLATED_LANGUAGES).toHaveLength(16);
      expect(DEFAULT_DOCS_LANGUAGE).toBe("en");
    });

    it("has one content directory per supported language and no others", () => {
      const directories: Array<string> = fs
        .readdirSync(CONTENT_DIR, { withFileTypes: true })
        .filter((entry: fs.Dirent): boolean => {
          return entry.isDirectory();
        })
        .map((entry: fs.Dirent): string => {
          return entry.name;
        })
        .sort();

      expect(directories).toEqual([...EXPECTED_LANGUAGES]);
    });

    it.each(EXPECTED_LANGUAGES)(
      "%s ships the page, with a yaml example on it",
      (lang: string): void => {
        expect({ lang, exists: fs.existsSync(pagePath(lang)) }).toEqual({
          lang,
          exists: true,
        });
        expect(readPage(lang).trim().length).toBeGreaterThan(0);
        expect({ lang, yamlBlocks: yamlBlocksOf(lang).length }).not.toEqual({
          lang,
          yamlBlocks: 0,
        });
      },
    );

    it("is linked from the docs navigation", () => {
      const urls: Array<string> = DocsNav.flatMap(
        (group: NavGroup): Array<string> => {
          return group.links.map((link: NavLink): string => {
            return link.url;
          });
        },
      );

      expect(urls).toContain(PAGE_URL);
    });
  });

  describe("the readers and parser this file relies on", () => {
    it("returns each block's language, body and opening line", () => {
      const markdown: string = [
        "Intro",
        "```yaml",
        "a: 1",
        "b: two",
        "```",
        "",
        "```bash",
        "echo hi",
        "```",
        "```",
        "untagged",
        "```",
      ].join("\n");

      expect(fencedBlocksOf(markdown, "fixture")).toEqual([
        { info: "yaml", body: "a: 1\nb: two", startLine: 2 },
        { info: "bash", body: "echo hi", startLine: 7 },
        { info: "", body: "untagged", startLine: 10 },
      ]);
    });

    it("lower-cases the tag and ignores attributes after it", () => {
      const markdown: string = ['```YAML title="collector.yaml"', "a: 1", "```"]
        .concat(["~~~yml", "b: 2", "~~~"])
        .join("\n");

      expect(
        fencedBlocksOf(markdown, "fixture").map(
          (block: FencedBlock): string => {
            return block.info;
          },
        ),
      ).toEqual(["yaml", "yml"]);
    });

    it("keeps a shorter fence inside a longer one as content", () => {
      const markdown: string = [
        "````markdown",
        "```yaml",
        "a: 1",
        "```",
        "````",
      ].join("\n");

      expect(fencedBlocksOf(markdown, "fixture")).toEqual([
        { info: "markdown", body: "```yaml\na: 1\n```", startLine: 1 },
      ]);
    });

    it("does not close a backtick fence with tildes", () => {
      const markdown: string = ["```yaml", "a: 1", "~~~", "b: 2", "```"].join(
        "\n",
      );

      expect(fencedBlocksOf(markdown, "fixture")).toEqual([
        { info: "yaml", body: "a: 1\n~~~\nb: 2", startLine: 1 },
      ]);
    });

    it("strips the fence's own indentation, as inside a list item", () => {
      const markdown: string = [
        "- step",
        "  ```yaml",
        "  exporters:",
        "    otlphttp: {}",
        "  ```",
      ].join("\n");

      const blocks: Array<FencedBlock> = fencedBlocksOf(markdown, "fixture");

      expect(blocks).toEqual([
        {
          info: "yaml",
          body: "exporters:\n  otlphttp: {}",
          startLine: 2,
        },
      ]);
      expect(jsYaml.load(blocks[0]!.body)).toEqual({
        exporters: { otlphttp: {} },
      });
    });

    it("reads CRLF pages the same as LF ones", () => {
      const lf: string = ["```yaml", "a: 1", "```"].join("\n");

      expect(fencedBlocksOf(lf.replace(/\n/g, "\r\n"), "fixture")).toEqual(
        fencedBlocksOf(lf, "fixture"),
      );
    });

    it("fails loudly on an unterminated fence instead of dropping it", () => {
      const markdown: string = [
        "```yaml",
        "a: 1",
        "```",
        "```yaml",
        "b: 2",
      ].join("\n");

      expect(() => {
        return fencedBlocksOf(markdown, "fixture.md");
      }).toThrow("fixture.md: unterminated code fence opened on line 4");
    });

    it("ignores pipe characters inside fences when reading tables", () => {
      const markdown: string = [
        "| Environment Variable | Value |",
        "| -------------------- | ----- |",
        "| OTEL_A               | `one` |",
        "```bash",
        "| OTEL_B | two |",
        "```",
      ].join("\n");

      expect(tableCellsOutsideFences(markdown)).toEqual([
        ["Environment Variable", "Value"],
        ["OTEL_A", "one"],
      ]);
    });

    it("parses with a YAML parser that rejects duplicated keys", () => {
      /*
       * A collector refuses a config with a key given twice. A parser that
       * kept the last value would let a doubled `headers:` pass here.
       */
      expect(() => {
        return jsYaml.load("headers:\n  a: 1\nheaders:\n  b: 2\n");
      }).toThrow(/duplicated mapping key/);
    });

    it("parses away comments, which is what translations may change", () => {
      expect(
        jsYaml.load("a: 1 # Your OneUptime token\n# note\nb: [x]"),
      ).toEqual(jsYaml.load("a: 1 # 您的 OneUptime 令牌\nb: [x]"));
    });

    it("tells the header-list forms of OTEL_EXPORTER_OTLP_HEADERS apart", () => {
      expect(headerNamesInEnvValue("x-oneuptime-token=abc")).toEqual([
        TOKEN_HEADER,
      ]);
      expect(headerNamesInEnvValue("X-OneUptime-Token=abc, other=1,")).toEqual([
        TOKEN_HEADER,
        "other",
      ]);
      expect(
        headerValueInEnvValue("a=1,x-oneuptime-token=k=v", TOKEN_HEADER),
      ).toBe("k=v");
      expect(headerValueInEnvValue("a=1", TOKEN_HEADER)).toBeNull();
    });

    it("reads the shell example's exports, quoted or not", () => {
      expect(
        [
          "export OTEL_A=one",
          '  export OTEL_B="two words"',
          "export OTEL_C='three'",
          "OTEL_D=not-exported",
          "# export OTEL_E=commented",
        ]
          .map((line: string): string | null => {
            const match: RegExpMatchArray | null = line.match(EXPORT_LINE);
            return match ? `${match[1]!}=${unquote(match[2]!)}` : null;
          })
          .filter((entry: string | null): boolean => {
            return entry !== null;
          }),
      ).toEqual(["OTEL_A=one", "OTEL_B=two words", "OTEL_C=three"]);
    });

    it("masks only the environment placeholders a translation may localise", () => {
      expect(
        withEnvPlaceholdersMasked({
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://oneuptime.com/otlp",
          OTEL_EXPORTER_OTLP_HEADERS: "x-oneuptime-token=VOTRE_JETON,other=",
          OTEL_SERVICE_NAME: "mon-service",
          OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=prod",
        }),
      ).toEqual({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://oneuptime.com/otlp",
        OTEL_EXPORTER_OTLP_HEADERS: `x-oneuptime-token=${MASKED},other=`,
        OTEL_SERVICE_NAME: MASKED,
        OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=prod",
      });

      // A blanked placeholder stays blank, so it still differs from English.
      expect(
        withEnvPlaceholdersMasked({
          OTEL_EXPORTER_OTLP_HEADERS: "x-oneuptime-token=",
          OTEL_SERVICE_NAME: " ",
        }),
      ).toEqual({
        OTEL_EXPORTER_OTLP_HEADERS: "x-oneuptime-token=",
        OTEL_SERVICE_NAME: " ",
      });
    });

    it("masks the collector's token value and nothing else", () => {
      const source: string = [
        "exporters:",
        "  otlphttp:",
        '    endpoint: "https://oneuptime.com/otlp"',
        "    headers:",
        '      "X-OneUptime-Token": "JETON_ONEUPTIME"',
        '      "other": "kept"',
      ].join("\n");
      const config: unknown = jsYaml.load(source);

      expect(withTokenMasked(config)).toEqual({
        exporters: {
          otlphttp: {
            endpoint: "https://oneuptime.com/otlp",
            headers: { "X-OneUptime-Token": MASKED, other: "kept" },
          },
        },
      });

      // A copy: the English config is compared after it, so it must not move.
      expect(config).toEqual(jsYaml.load(source));

      expect(
        withTokenMasked(
          jsYaml.load(
            'exporters:\n  otlphttp:\n    headers:\n      x-oneuptime-token: ""',
          ),
        ),
      ).toEqual({
        exporters: { otlphttp: { headers: { "x-oneuptime-token": "" } } },
      });
      expect(withTokenMasked({ receivers: { otlp: {} } })).toEqual({
        receivers: { otlp: {} },
      });
    });
  });

  describe.each(EXPECTED_LANGUAGES)("%s page", (lang: string): void => {
    const where: string = `${lang}/${PAGE}.md`;

    it("parses every yaml block, each to a mapping", () => {
      const results: Array<{ line: number; kind: string; error: string }> =
        yamlBlocksOf(lang).map(
          (
            block: FencedBlock,
          ): { line: number; kind: string; error: string } => {
            try {
              return {
                line: block.startLine,
                kind: kindOf(parseYamlBlock(block, where)),
                error: "",
              };
            } catch (err: unknown) {
              return {
                line: block.startLine,
                kind: "unparsed",
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
        );

      expect(results.length).toBeGreaterThan(0);
      expect({ where, results }).toEqual({
        where,
        results: results.map(
          (result: {
            line: number;
            kind: string;
            error: string;
          }): { line: number; kind: string; error: string } => {
            return { line: result.line, kind: "mapping", error: "" };
          },
        ),
      });
    });

    it("has exactly one collector example, configuring otlphttp", () => {
      const example: CollectorExample = collectorExampleOf(lang);

      expect(example.block.info).toMatch(/^ya?ml$/);
      expect(Object.keys(example.config)).toEqual(
        expect.arrayContaining(["receivers", "exporters", "service"]),
      );
    });

    it("exports to an https endpoint whose path is /otlp", () => {
      const endpoint: unknown = exporterOf(lang)["endpoint"];

      expect({ where, kind: kindOf(endpoint) }).toEqual({
        where,
        kind: "string",
      });

      const text: string = endpoint as string;
      const url: URL = new URL(text);

      /*
       * The exporter appends /v1/traces, /v1/metrics and /v1/logs to this
       * value, so it must end at /otlp exactly. A trailing slash would post
       * to //v1/traces.
       */
      expect(text.endsWith("/otlp")).toBe(true);
      expect(url.protocol).toBe("https:");
      expect(url.pathname).toBe("/otlp");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
    });

    it("authenticates with the x-oneuptime-token header", () => {
      const headers: YamlMap = mappingAt(
        exporterOf(lang),
        ["headers"],
        `${lang}: exporters.${EXPORTER}`,
      );
      const tokenKeys: Array<string> = headerKeysNamed(headers, TOKEN_HEADER);

      expect({ where, tokenKeys }).toEqual({
        where,
        tokenKeys: [TOKEN_HEADER],
      });

      const token: unknown = headers[TOKEN_HEADER];

      expect({ where, kind: kindOf(token) }).toEqual({ where, kind: "string" });
      expect((token as string).trim().length).toBeGreaterThan(0);
    });

    it("keeps the exporter's default protobuf encoding", () => {
      const exporter: YamlMap = exporterOf(lang);

      /*
       * Absent is the recommendation; an explicit `proto` says the same
       * thing. `json` works too, but the page must not present it as the
       * requirement it once claimed to be.
       */
      expect({ where, encoding: exporter["encoding"] }).not.toEqual({
        where,
        encoding: "json",
      });
      expect([undefined, "proto"]).toContain(exporter["encoding"]);
    });

    it("sets no Content-Type header over the exporter's own", () => {
      const headers: YamlMap = mappingAt(
        exporterOf(lang),
        ["headers"],
        `${lang}: exporters.${EXPORTER}`,
      );

      expect({
        where,
        contentType: headerKeysNamed(headers, "content-type"),
      }).toEqual({ where, contentType: [] });
      expect({
        where,
        jsonValues: Object.values(headers).filter((value: unknown): boolean => {
          return String(value).toLowerCase().includes("application/json");
        }),
      }).toEqual({ where, jsonValues: [] });
    });

    it("does not keep the JSON setup around as commented-out lines", () => {
      const body: string = collectorExampleOf(lang).block.body;

      expect({ where, jsonEncoding: JSON_ENCODING_TEXT.test(body) }).toEqual({
        where,
        jsonEncoding: false,
      });
      expect({ where, contentType: CONTENT_TYPE_KEY_TEXT.test(body) }).toEqual({
        where,
        contentType: false,
      });
      expect({
        where,
        applicationJson: APPLICATION_JSON_TEXT.test(body),
      }).toEqual({ where, applicationJson: false });
    });

    it("sends traces, metrics and logs through otlphttp", () => {
      const pipelines: YamlMap = pipelinesOf(
        collectorExampleOf(lang).config,
        `${lang}:`,
      );

      const signalsExportingToOneUptime: Array<string> = Object.keys(pipelines)
        .filter((pipelineId: string): boolean => {
          const pipeline: YamlMap = expectMapping(
            pipelines[pipelineId],
            `${lang}: service.pipelines.${pipelineId}`,
          );
          return stringsAt(
            pipeline,
            "exporters",
            `${lang}: service.pipelines.${pipelineId}.exporters`,
          ).includes(EXPORTER);
        })
        .map((pipelineId: string): string => {
          return signalOf(pipelineId);
        });

      for (const signal of REQUIRED_SIGNALS) {
        expect({
          where,
          signal,
          exported: signalsExportingToOneUptime,
        }).toEqual({
          where,
          signal,
          exported: expect.arrayContaining([signal]),
        });
      }
    });

    it("defines every receiver and exporter a pipeline names", () => {
      const config: YamlMap = collectorExampleOf(lang).config;
      const receivers: YamlMap = mappingAt(config, ["receivers"], `${lang}:`);
      const exporters: YamlMap = mappingAt(config, ["exporters"], `${lang}:`);
      const pipelines: YamlMap = pipelinesOf(config, `${lang}:`);

      const dangling: Array<string> = [];

      for (const pipelineId of Object.keys(pipelines)) {
        const pipeline: YamlMap = expectMapping(
          pipelines[pipelineId],
          `${lang}: service.pipelines.${pipelineId}`,
        );

        const named: Array<string> = stringsAt(
          pipeline,
          "receivers",
          `${lang}: service.pipelines.${pipelineId}.receivers`,
        );

        expect(named.length).toBeGreaterThan(0);

        for (const receiver of named) {
          if (!Object.keys(receivers).includes(receiver)) {
            dangling.push(`${pipelineId} receiver ${receiver}`);
          }
        }

        for (const exporter of stringsAt(
          pipeline,
          "exporters",
          `${lang}: service.pipelines.${pipelineId}.exporters`,
        )) {
          if (!Object.keys(exporters).includes(exporter)) {
            dangling.push(`${pipelineId} exporter ${exporter}`);
          }
        }
      }

      expect({ where, dangling }).toEqual({ where, dangling: [] });
    });
  });

  describe("translations", () => {
    it.each(TRANSLATED_LANGUAGES)(
      "%s parses to the English collector config",
      (lang: string): void => {
        expect({
          lang,
          config: withTokenMasked(collectorExampleOf(lang).config),
        }).toStrictEqual({
          lang,
          config: withTokenMasked(
            collectorExampleOf(DEFAULT_DOCS_LANGUAGE).config,
          ),
        });
      },
    );

    it.each(TRANSLATED_LANGUAGES)(
      "%s has the same yaml blocks as English, in order",
      (lang: string): void => {
        expect({
          lang,
          blocks: parsedYamlBlocksOf(lang).map(withTokenMasked),
        }).toStrictEqual({
          lang,
          blocks: parsedYamlBlocksOf(DEFAULT_DOCS_LANGUAGE).map(
            withTokenMasked,
          ),
        });
      },
    );

    it.each(TRANSLATED_LANGUAGES)(
      "%s documents the same environment variables and values",
      (lang: string): void => {
        expect({
          lang,
          table: withEnvPlaceholdersMasked(envTableOf(lang)),
        }).toEqual({
          lang,
          table: withEnvPlaceholdersMasked(envTableOf(DEFAULT_DOCS_LANGUAGE)),
        });
      },
    );

    it.each(TRANSLATED_LANGUAGES)(
      "%s exports the same variables in its shell example",
      (lang: string): void => {
        expect({
          lang,
          exports: withEnvPlaceholdersMasked(shellExportsOf(lang)),
        }).toEqual({
          lang,
          exports: withEnvPlaceholdersMasked(
            shellExportsOf(DEFAULT_DOCS_LANGUAGE),
          ),
        });
      },
    );
  });

  describe("the English direct-export instructions", () => {
    it("lists OTEL_EXPORTER_OTLP_ENDPOINT and the x-oneuptime-token header", () => {
      const table: { [name: string]: string } = envTableOf(
        DEFAULT_DOCS_LANGUAGE,
      );

      expect(Object.keys(table)).toEqual(
        expect.arrayContaining([
          "OTEL_EXPORTER_OTLP_ENDPOINT",
          "OTEL_EXPORTER_OTLP_HEADERS",
        ]),
      );

      const endpoint: URL = new URL(table["OTEL_EXPORTER_OTLP_ENDPOINT"]!);

      expect(endpoint.protocol).toBe("https:");
      expect(endpoint.pathname).toBe("/otlp");
      expect(table["OTEL_EXPORTER_OTLP_ENDPOINT"]!.endsWith("/otlp")).toBe(
        true,
      );

      const headers: string = table["OTEL_EXPORTER_OTLP_HEADERS"]!;

      expect(headerNamesInEnvValue(headers)).toEqual([TOKEN_HEADER]);
      expect(headerValueInEnvValue(headers, TOKEN_HEADER)).toMatch(/\S/);
    });

    it("points the SDKs and the collector at the same endpoint", () => {
      expect(exporterOf(DEFAULT_DOCS_LANGUAGE)["endpoint"]).toBe(
        envTableOf(DEFAULT_DOCS_LANGUAGE)["OTEL_EXPORTER_OTLP_ENDPOINT"],
      );
    });

    it("exports exactly the table's variables in the shell example", () => {
      const table: { [name: string]: string } = envTableOf(
        DEFAULT_DOCS_LANGUAGE,
      );
      const exported: { [name: string]: string } = shellExportsOf(
        DEFAULT_DOCS_LANGUAGE,
      );

      expect(Object.keys(exported).sort()).toEqual(Object.keys(table).sort());
      expect(exported["OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe(
        table["OTEL_EXPORTER_OTLP_ENDPOINT"],
      );
      expect(
        headerNamesInEnvValue(exported["OTEL_EXPORTER_OTLP_HEADERS"] ?? ""),
      ).toEqual([TOKEN_HEADER]);
      expect(
        headerValueInEnvValue(
          exported["OTEL_EXPORTER_OTLP_HEADERS"] ?? "",
          TOKEN_HEADER,
        ),
      ).toMatch(/\S/);
    });

    it("has the collector listen on the standard OTLP ports", () => {
      const protocols: YamlMap = mappingAt(
        collectorExampleOf(DEFAULT_DOCS_LANGUAGE).config,
        ["receivers", "otlp", "protocols"],
        "en:",
      );

      // What an SDK left on its defaults sends to: 4317 gRPC, 4318 HTTP.
      expect(mappingAt(protocols, ["grpc"], "en:")["endpoint"]).toBe(
        "0.0.0.0:4317",
      );
      expect(mappingAt(protocols, ["http"], "en:")["endpoint"]).toBe(
        "0.0.0.0:4318",
      );
    });
  });

  describe("the product the example points at", () => {
    it("registers the route the exporter posts each pipeline's signal to", () => {
      const router: string = fs.readFileSync(OTEL_INGEST_ROUTER_FILE, "utf8");
      const config: YamlMap = collectorExampleOf(DEFAULT_DOCS_LANGUAGE).config;
      const basePath: string = new URL(
        exporterOf(DEFAULT_DOCS_LANGUAGE)["endpoint"] as string,
      ).pathname;

      const signals: Array<string> = [
        ...new Set(
          Object.keys(pipelinesOf(config, "en:")).map(
            (pipelineId: string): string => {
              return signalOf(pipelineId);
            },
          ),
        ),
      ];

      expect(signals).toEqual(expect.arrayContaining([...REQUIRED_SIGNALS]));

      for (const signal of signals) {
        // OTLP/HTTP (the exporter and every SDK) posts to <endpoint>/v1/<signal>.
        const route: string = `${basePath}/v1/${signal}`;
        const registered: boolean = new RegExp(
          `router\\.post\\(\\s*"${escapeRegExp(route)}"`,
        ).test(router);

        expect({ route, registered }).toEqual({ route, registered: true });
      }
    });

    it("routes the endpoint's path through nginx", () => {
      const template: string = fs.readFileSync(NGINX_TEMPLATE_FILE, "utf8");
      const basePath: string = new URL(
        exporterOf(DEFAULT_DOCS_LANGUAGE)["endpoint"] as string,
      ).pathname;

      expect(template).toMatch(
        new RegExp(`^\\s*location\\s+${escapeRegExp(basePath)}\\s*\\{`, "m"),
      );
    });

    it("reads the ingestion key from the header the example sets", () => {
      const middleware: string = fs.readFileSync(
        TELEMETRY_INGEST_MIDDLEWARE_FILE,
        "utf8",
      );

      expect(middleware).toMatch(
        new RegExp(
          `req\\.headers\\[\\s*"${escapeRegExp(TOKEN_HEADER)}"\\s*\\]`,
        ),
      );
    });
  });
});
