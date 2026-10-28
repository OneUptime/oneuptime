import {
  OPEN_TELEMETRY_GUIDES,
  OpenTelemetryGuideEntry,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import {
  GuideCodeSection,
  GuideQuestion,
  GuideSnippet,
  GuideStep,
  GuideTab,
  GuideTabs,
  GuideVerificationRun,
  InlineText,
  OpenTelemetryGuide,
  SnippetLanguage,
  VerificationCommand,
  VerificationFile,
} from "../Utils/Integrations/OpenTelemetry/GuideTypes";
import { OPEN_TELEMETRY_GUIDE_PAGES } from "../Utils/Integrations/OpenTelemetry/OpenTelemetryGuides";
import {
  INDENTED_CODE_COLUMNS,
  PlacedSnippet,
  SECTION_CODE_COLUMNS,
  guideSnippets,
  linesPastColumns,
  placedGuideSnippets,
} from "../Utils/Integrations/OpenTelemetry/GuideSnippets";
import { dockerfileCommand } from "../Utils/Integrations/OpenTelemetry/PythonShared";
import {
  GuideVerificationRecord,
  getVerificationRecord,
  guideSnippetDigest,
} from "../Utils/Integrations/OpenTelemetry/GuideVerifications";
import {
  InstalledPackage,
  bracketProblems,
  buildFileDependencies,
  iniProblems,
  installedPackages,
  isBuildFileSnippet,
  isPackageSpecifier,
  isScriptSnippet,
  moduleSpecifiers,
  packageNameOf,
  propertiesProblems,
} from "../Utils/Integrations/OpenTelemetry/GuideCodeChecks";
import {
  syntaxProblems,
  tomlProblems,
} from "../Utils/Integrations/OpenTelemetry/GuideSyntaxChecks";
import {
  inlineTextLinks,
  inlineTextProblems,
} from "../Utils/Integrations/OpenTelemetry/GuideText";
import {
  PINNED_PACKAGE_VERSIONS,
  isExactVersion,
} from "../Utils/Integrations/OpenTelemetry/PinnedVersions";
import { SHARED_GUIDE_TEXTS } from "../Utils/Integrations/OpenTelemetry/SharedTexts";
import { describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import { JSDOM } from "jsdom";
import ts from "typescript";

/*
 * Every OpenTelemetry guide, held to what a guide is: every section filled
 * in, its words its own, its search result its own, every snippet checked -
 * run end to end, contained in what ran, or at least parsed - its installs
 * pinned to the versions that ran, and its imports to names those versions
 * export. A guide whose snippets changed since its end-to-end check fails
 * here until the check (npm run verify:otel-guides) is run again, so a new
 * framework cannot ship without one.
 */

const GUIDES: Array<OpenTelemetryGuide> = [...OPEN_TELEMETRY_GUIDE_PAGES];
const SLUGS: Array<string> = GUIDES.map((guide: OpenTelemetryGuide): string => {
  return guide.slug;
});
const BY_SLUG: Array<[string, OpenTelemetryGuide]> = GUIDES.map(
  (guide: OpenTelemetryGuide): [string, OpenTelemetryGuide] => {
    return [guide.slug, guide];
  },
);

const SEO_TITLE_SUFFIX: string = " | OneUptime";
const MAX_TITLE_LENGTH: number = 60;
const MIN_DESCRIPTION_LENGTH: number = 110;
const MAX_DESCRIPTION_LENGTH: number = 160;
// A sentence long enough that two guides writing it is one copying the other.
const SHARED_TEXT_LENGTH: number = 60;

const GUIDE_LINK: RegExp =
  /^\/integrations\/opentelemetry\/([a-z0-9-]+)(?:#.*)?$/;
const DOCS_LINK: RegExp = /^\/docs\//;

const DOCKERFILE_INSTRUCTION: RegExp =
  /^(FROM|WORKDIR|COPY|ADD|RUN|ENV|EXPOSE|CMD|USER|ARG|ENTRYPOINT|LABEL) /;
/*
 * A line of YAML: a key (a Symfony service's may hold a PHP class's
 * backslashes, or an argument's $), a list item, a quoted or plain scalar,
 * a comment, or nothing.
 */
const YAML_LINE: RegExp =
  /^(( {2})*(- )?([A-Za-z0-9_.$\\-]+:( .+)?|"[^"]*"|[A-Za-z0-9_.:/@-]+)|( {2})*#.*|)$/;
const DOCUMENT_SEPARATOR: string = "---";
const IMPORT_NAMES: RegExp =
  /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g;
const TYPE_PREFIX: RegExp = /^type\s+/;
const ALIAS: RegExp = /\s+as\s+\w+$/;
const NODE_BUILTIN: RegExp = /^node:/;
// The XML declaration a pom.xml or a .csproj may start with.
const XML_DECLARATION_END: string = "?>";
// Code the tests cannot run, so its check must have run or compiled it.
const COMPILED_OR_RUN_LANGUAGES: ReadonlyArray<SnippetLanguage> = [
  "python",
  "java",
  "kotlin",
  "csharp",
  "go",
  "ruby",
  "php",
  "rust",
  "elixir",
];

// Every inline text a guide writes itself, with where it is written.
function guideTexts(guide: OpenTelemetryGuide): Array<[string, InlineText]> {
  const texts: Array<[string, InlineText]> = [];
  const add: (where: string, text: InlineText | undefined) => void = (
    where: string,
    text: InlineText | undefined,
  ): void => {
    if (text) {
      texts.push([where, text]);
    }
  };
  const addSection: (where: string, section: GuideCodeSection) => void = (
    where: string,
    section: GuideCodeSection,
  ): void => {
    add(`${where}.intro`, section.intro);
    section.notes.forEach((note: InlineText, index: number) => {
      add(`${where}.notes[${index}]`, note);
    });
  };
  const addSteps: (where: string, steps: Array<GuideStep>) => void = (
    where: string,
    steps: Array<GuideStep>,
  ): void => {
    steps.forEach((step: GuideStep, index: number) => {
      add(`${where}[${index}].body`, step.body);
      (step.notes || []).forEach((note: InlineText, noteIndex: number) => {
        add(`${where}[${index}].notes[${noteIndex}]`, note);
      });
    });
  };
  const addQuestions: (
    where: string,
    questions: Array<GuideQuestion>,
  ) => void = (where: string, questions: Array<GuideQuestion>): void => {
    questions.forEach((question: GuideQuestion, index: number) => {
      add(`${where}[${index}].answer`, question.answer);
    });
  };

  add("lead", guide.lead);
  add("cardDescription", guide.cardDescription);
  add("whatYouGet.intro", guide.whatYouGet.intro);
  add("whatYouGet.traces", guide.whatYouGet.traces);
  add("whatYouGet.metrics", guide.whatYouGet.metrics);
  add("whatYouGet.logs", guide.whatYouGet.logs);
  add("whatYouGet.exceptions", guide.whatYouGet.exceptions);
  guide.prerequisites.forEach((item: InlineText, index: number) => {
    add(`prerequisites[${index}]`, item);
  });
  addSection("install", guide.install);
  add("configure.intro", guide.configure.intro);
  guide.configure.notes.forEach((note: InlineText, index: number) => {
    add(`configure.notes[${index}]`, note);
  });
  add("setup.intro", guide.setup.intro);
  addSteps("setup.steps", guide.setup.steps);
  add("autoInstrumentation.intro", guide.autoInstrumentation.intro);
  guide.autoInstrumentation.rows.forEach(
    (row: { library: InlineText; covers: InlineText }, index: number) => {
      add(`autoInstrumentation.rows[${index}]`, row.covers);
    },
  );
  guide.autoInstrumentation.notes.forEach((note: InlineText, index: number) => {
    add(`autoInstrumentation.notes[${index}]`, note);
  });
  addSection("manualSpans", guide.manualSpans);
  addSection("logs", guide.logs);
  add("metrics.intro", guide.metrics.intro);
  guide.metrics.notes.forEach((note: InlineText, index: number) => {
    add(`metrics.notes[${index}]`, note);
  });
  addSection("sampling", guide.sampling);
  addSection("deploy", guide.deploy);
  add("verify.intro", guide.verify.intro);
  addSteps("verify.steps", guide.verify.steps);
  addQuestions("troubleshooting", guide.troubleshooting);
  addQuestions("faq", guide.faq);

  return texts;
}

// Every text a guide shows, its tabs' notes and question titles included.
function everyText(guide: OpenTelemetryGuide): Array<[string, InlineText]> {
  const texts: Array<[string, InlineText]> = guideTexts(guide);

  for (const [where, tabs] of [
    ["install", guide.install.tabs],
    ["configure", guide.configure.tabs],
  ] as Array<[string, GuideTabs | undefined]>) {
    (tabs?.tabs || []).forEach((tab: GuideTab) => {
      if (tab.body) {
        texts.push([`${where}.tabs.${tab.label}.body`, tab.body]);
      }
      (tab.notes || []).forEach((note: InlineText, index: number) => {
        texts.push([`${where}.tabs.${tab.label}.notes[${index}]`, note]);
      });
    });
  }

  return texts;
}

// The guide's runs: the check's main run, then each variant's.
function runsOf(guide: OpenTelemetryGuide): Array<GuideVerificationRun> {
  return [guide.verification, ...(guide.verification.variants || [])];
}

function verificationFileTexts(guide: OpenTelemetryGuide): Array<string> {
  return runsOf(guide).flatMap((run: GuideVerificationRun): Array<string> => {
    return run.files.map((file: VerificationFile): string => {
      if (file.snippet) {
        const snippet: GuideSnippet | undefined = guideSnippets(guide).find(
          (candidate: GuideSnippet): boolean => {
            return candidate.id === file.snippet;
          },
        );
        return snippet ? snippet.code : "";
      }
      return file.content || "";
    });
  });
}

function commandsText(guide: OpenTelemetryGuide): string {
  return runsOf(guide)
    .flatMap((run: GuideVerificationRun): Array<string> => {
      return run.commands.map((command: VerificationCommand): string => {
        if (command.snippet) {
          return (
            guideSnippets(guide).find((snippet: GuideSnippet): boolean => {
              return snippet.id === command.snippet;
            })?.code || ""
          );
        }
        return command.command || "";
      });
    })
    .join("\n");
}

/*
 * The version a run recorded for a package: the main run's, or the
 * variant's that installed it.
 */
function recordedVersion(
  record: GuideVerificationRecord | undefined,
  name: string,
): string | undefined {
  if (!record) {
    return undefined;
  }

  return (
    record.packages[name] ||
    Object.values(record.variants || {})
      .map((variant: { packages: Record<string, string> }) => {
        return variant.packages[name];
      })
      .find((version: string | undefined): boolean => {
        return Boolean(version);
      })
  );
}

// What a snippet installs: its install commands, an agent download, or a build file's declarations.
function snippetInstalls(snippet: GuideSnippet): Array<InstalledPackage> {
  if (isBuildFileSnippet(snippet)) {
    return buildFileDependencies(snippet);
  }

  return snippet.language === "bash" || snippet.language === "dockerfile"
    ? installedPackages(snippet.code)
    : [];
}

// Python's parser, run by the python3 on PATH: a module, or a fragment of one.
function pythonProblems(code: string): Array<string> {
  const result: SpawnSyncReturns<string> = spawnSync(
    "python3",
    [
      "-c",
      [
        "import ast, sys, textwrap",
        "source = sys.stdin.read()",
        "try:",
        "    ast.parse(source)",
        "except SyntaxError:",
        "    ast.parse(textwrap.dedent(source))",
      ].join("\n"),
    ],
    { input: code, encoding: "utf8" },
  );

  if (result.error) {
    return [`python3 could not be run: ${result.error.message}`];
  }

  return result.status === 0 ? [] : [result.stderr.trim()];
}

// A pom.xml, a .csproj or a fragment of one, read as XML.
function xmlProblems(code: string): Array<string> {
  const declarationEnd: number = code.startsWith("<?xml")
    ? code.indexOf(XML_DECLARATION_END)
    : -1;
  const body: string =
    declarationEnd === -1
      ? code
      : code.slice(declarationEnd + XML_DECLARATION_END.length);
  const window: JSDOM["window"] = new JSDOM("").window;
  const document: Document = new window.DOMParser().parseFromString(
    `<snippet>${body}</snippet>`,
    "application/xml",
  );
  const error: Element | null = document.querySelector("parsererror");

  return error ? [`not well-formed XML: ${error.textContent || ""}`] : [];
}

/*
 * The places a page shows a Maven and a Gradle build side by side: the
 * tabs of a build-tool tab set, one tool each, and any tab or step that
 * shows a pom.xml beside a build.gradle.kts. Each list is one build's
 * snippets; the lists of a place must declare the same dependencies.
 */
function buildTwins(
  guide: OpenTelemetryGuide,
): Array<{ where: string; builds: Array<Array<GuideSnippet>> }> {
  const twins: Array<{ where: string; builds: Array<Array<GuideSnippet>> }> =
    [];
  const byTool: (
    snippets: Array<GuideSnippet>,
  ) => Array<Array<GuideSnippet>> = (
    snippets: Array<GuideSnippet>,
  ): Array<Array<GuideSnippet>> => {
    const maven: Array<GuideSnippet> = snippets.filter(
      (snippet: GuideSnippet): boolean => {
        return isBuildFileSnippet(snippet) && snippet.language === "xml";
      },
    );
    const gradle: Array<GuideSnippet> = snippets.filter(
      (snippet: GuideSnippet): boolean => {
        return isBuildFileSnippet(snippet) && snippet.language === "kotlin";
      },
    );

    return maven.length > 0 && gradle.length > 0 ? [maven, gradle] : [];
  };
  const visitTabs: (where: string, tabs: GuideTabs | undefined) => void = (
    where: string,
    tabs: GuideTabs | undefined,
  ): void => {
    if (!tabs) {
      return;
    }
    if (tabs.group === "buildTool") {
      twins.push({
        where: `${where} (build tool tabs)`,
        builds: tabs.tabs.map((tab: GuideTab): Array<GuideSnippet> => {
          return tab.snippets.filter(isBuildFileSnippet);
        }),
      });
      return;
    }
    for (const tab of tabs.tabs) {
      const builds: Array<Array<GuideSnippet>> = byTool(tab.snippets);
      if (builds.length > 0) {
        twins.push({ where: `${where}, tab ${tab.label}`, builds: builds });
      }
    }
  };

  visitTabs("install", guide.install.tabs);
  visitTabs("configure", guide.configure.tabs);
  for (const step of [...guide.setup.steps, ...guide.verify.steps]) {
    visitTabs(step.title, step.tabs);
    const builds: Array<Array<GuideSnippet>> = byTool(step.snippets || []);
    if (builds.length > 0) {
      twins.push({ where: step.title, builds: builds });
    }
  }

  return twins;
}

function scriptKindOf(language: SnippetLanguage): ts.ScriptKind {
  switch (language) {
    case "tsx":
      return ts.ScriptKind.TSX;
    case "typescript":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.JS;
  }
}

// The syntax errors of a script, as TypeScript's parser reads it.
function syntaxErrors(code: string, language: SnippetLanguage): Array<string> {
  const output: ts.TranspileOutput = ts.transpileModule(code, {
    reportDiagnostics: true,
    fileName: language === "tsx" ? "snippet.tsx" : "snippet.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      experimentalDecorators: true,
      allowJs: true,
    },
  });

  return (output.diagnostics || []).map((diagnostic: ts.Diagnostic): string => {
    return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  });
}

/*
 * A script snippet parses as a whole file, or as the fragment it shows: the
 * options inside an object ("@opentelemetry/instrumentation-express": {...})
 * or a method of a class (async place(...) {...}).
 */
function scriptProblems(snippet: GuideSnippet): Array<string> {
  const asFile: Array<string> = syntaxErrors(snippet.code, snippet.language);

  if (asFile.length === 0) {
    return [];
  }

  for (const wrapped of [
    `({\n${snippet.code}\n});`,
    `class Fragment {\n${snippet.code}\n}`,
  ]) {
    if (syntaxErrors(wrapped, snippet.language).length === 0) {
      return [];
    }
  }

  // Parsed for its kind as well, so a TSX snippet is read as TSX.
  ts.createSourceFile(
    "snippet",
    snippet.code,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(snippet.language),
  );

  return asFile;
}

/*
 * A Dockerfile's instructions, one a line: a line that ends in a backslash
 * goes on, as Docker reads it, into the next.
 */
function dockerfileInstructions(code: string): Array<string> {
  const instructions: Array<string> = [];
  let pending: string = "";

  for (const line of code.split("\n")) {
    if (line.endsWith("\\")) {
      pending += `${line.slice(0, -1)} `;
      continue;
    }
    instructions.push(`${pending}${line}`);
    pending = "";
  }
  if (pending.length > 0) {
    // Nothing follows the last backslash: no instruction Docker would read.
    instructions.push(`\\ with nothing after it: ${pending}`);
  }

  return instructions;
}

// What keeps a snippet from parsing as its language, or nothing.
function parseProblems(snippet: GuideSnippet): Array<string> {
  switch (snippet.language) {
    case "javascript":
    case "typescript":
    case "tsx":
      return scriptProblems(snippet);
    case "json":
      try {
        JSON.parse(snippet.code);
        return [];
      } catch (error) {
        return [String(error)];
      }
    case "bash": {
      const result: SpawnSyncReturns<string> = spawnSync("bash", ["-n"], {
        input: snippet.code,
        encoding: "utf8",
      });
      return result.status === 0 ? [] : [result.stderr];
    }
    case "dockerfile":
      return dockerfileInstructions(snippet.code)
        .filter((line: string): boolean => {
          // A comment is a line of its own that starts with #.
          return (
            line.trim().length > 0 &&
            !line.startsWith("# ") &&
            !DOCKERFILE_INSTRUCTION.test(line)
          );
        })
        .map((line: string): string => {
          return `not a Dockerfile instruction: ${line}`;
        })
        .concat(
          dockerfileInstructions(snippet.code)
            .filter((line: string): boolean => {
              return line.startsWith("CMD [");
            })
            .flatMap((line: string): Array<string> => {
              try {
                JSON.parse(line.slice("CMD ".length));
                return [];
              } catch {
                return [`CMD is not a JSON array: ${line}`];
              }
            }),
        );
    case "yaml":
      return snippet.code
        .split("\n")
        .filter((line: string): boolean => {
          return line !== DOCUMENT_SEPARATOR && !YAML_LINE.test(line);
        })
        .map((line: string): string => {
          return `not a YAML mapping, sequence or scalar line: "${line}"`;
        });
    case "python":
      return pythonProblems(snippet.code);
    case "java":
    case "kotlin":
    case "csharp":
      return bracketProblems(snippet.code, snippet.language);
    case "xml":
      return xmlProblems(snippet.code);
    case "properties":
      return propertiesProblems(snippet.code);
    case "ini":
      return iniProblems(snippet.code);
    case "go":
    case "rust":
    case "php":
    case "ruby":
    case "elixir":
      return syntaxProblems(snippet.code, snippet.language);
    // A .proto file's comments, strings and braces are Go's.
    case "protobuf":
      return syntaxProblems(snippet.code, "go");
    case "toml":
      return tomlProblems(snippet.code);
    default:
      return [];
  }
}

// The names an import statement takes from each package, value imports only.
function importedNames(code: string): Array<[string, string]> {
  const names: Array<[string, string]> = [];

  for (const match of code.matchAll(IMPORT_NAMES)) {
    if (match[1]) {
      continue;
    }

    for (const raw of match[2]!.split(",")) {
      const name: string = raw.trim();

      if (!name || TYPE_PREFIX.test(name)) {
        continue;
      }

      names.push([match[3]!, name.replace(ALIAS, "")]);
    }
  }

  return names;
}

describe("the OpenTelemetry guide catalog", () => {
  test("has a page for every entry, in the catalog's order, and an entry for every page", () => {
    expect(SLUGS).toEqual(
      OPEN_TELEMETRY_GUIDES.map((entry: OpenTelemetryGuideEntry): string => {
        return entry.slug;
      }),
    );
  });

  test("covers the frameworks the site publishes, language by language", () => {
    expect(SLUGS).toEqual([
      // JavaScript and TypeScript.
      "nodejs",
      "express",
      "nestjs",
      "nextjs",
      "fastify",
      "koa",
      "hapi",
      "bun",
      "deno",
      "browser",
      "react",
      "angular",
      // Python.
      "python",
      "django",
      "flask",
      "fastapi",
      "celery",
      // Java.
      "java",
      "spring-boot",
      "quarkus",
      "micronaut",
      // Kotlin.
      "ktor",
      // .NET.
      "dotnet",
      "aspnet-core",
      "dotnet-worker-service",
      // Go.
      "go",
      "gin",
      "echo",
      "fiber",
      "grpc",
      // Ruby.
      "ruby",
      "rails",
      "sinatra",
      "sidekiq",
      // PHP.
      "php",
      "laravel",
      "symfony",
      "slim",
      // Rust.
      "rust",
      "axum",
      "actix-web",
      // Elixir.
      "elixir",
      "phoenix",
    ]);
  });

  test("gives every guide a unique slug that is a clean address", () => {
    expect(new Set(SLUGS).size).toBe(SLUGS.length);
    for (const slug of SLUGS) {
      expect(getOpenTelemetryGuidePath(slug)).toMatch(GUIDE_LINK);
    }
  });
});

describe.each(BY_SLUG)(
  "the %s guide",
  (_slug: string, guide: OpenTelemetryGuide) => {
    test("fills in every section", () => {
      expect(guide.h1.length).toBeGreaterThan(10);
      expect(guide.lead.length).toBeGreaterThan(120);
      expect(guide.cardDescription.length).toBeGreaterThan(40);
      expect(guide.highlights.length).toBeGreaterThanOrEqual(2);
      expect(guide.searchTerms.length).toBeGreaterThanOrEqual(3);
      for (const signal of [
        guide.whatYouGet.intro,
        guide.whatYouGet.traces,
        guide.whatYouGet.metrics,
        guide.whatYouGet.logs,
        guide.whatYouGet.exceptions,
      ]) {
        expect(signal.length).toBeGreaterThan(40);
      }
      expect(guide.exampleTrace.spans.length).toBeGreaterThanOrEqual(3);
      expect(guide.prerequisites.length).toBeGreaterThanOrEqual(2);
      expect(
        guide.install.snippets.length + (guide.install.tabs?.tabs.length || 0),
      ).toBeGreaterThanOrEqual(1);
      expect(
        guide.configure.tabs.tabs.map((tab: { label: string }): string => {
          return tab.label;
        }),
      ).toEqual(["OneUptime Cloud", "Self-hosted"]);
      expect(guide.setup.steps.length).toBeGreaterThanOrEqual(2);
      expect(guide.autoInstrumentation.rows.length).toBeGreaterThanOrEqual(3);
      expect(guide.manualSpans.snippets.length).toBeGreaterThanOrEqual(1);
      expect(guide.logs.intro.length).toBeGreaterThan(40);
      expect(
        guide.logs.snippets.length + guide.logs.notes.length,
      ).toBeGreaterThanOrEqual(2);
      /*
       * The metrics the instrumentations send, or, where they send none
       * (Ruby's record spans only), the code that makes one.
       */
      expect(
        guide.metrics.builtIn.length > 0 || guide.metrics.snippets.length > 0,
      ).toBe(true);
      expect(guide.sampling.snippets.length).toBeGreaterThanOrEqual(1);
      expect(guide.deploy.snippets.length).toBeGreaterThanOrEqual(1);
      expect(guide.verify.steps.length).toBeGreaterThanOrEqual(3);
      expect(guide.troubleshooting.length).toBeGreaterThanOrEqual(4);
      expect(guide.faq.length).toBeGreaterThanOrEqual(3);
      expect(guide.related.length).toBeGreaterThanOrEqual(3);
      expect(guide.docs.length).toBeGreaterThanOrEqual(3);
    });

    test("draws an example trace whose root spans the whole request", () => {
      const [root, ...children] = guide.exampleTrace.spans;

      expect(root).toMatchObject({ depth: 0, start: 0, duration: 100 });
      for (const span of children) {
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.duration).toBeGreaterThan(0);
        expect(span.start + span.duration).toBeLessThanOrEqual(100);
      }
    });

    test("writes a search result of its own size", () => {
      expect(guide.seo.title.endsWith(SEO_TITLE_SUFFIX)).toBe(true);
      expect(guide.seo.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(guide.seo.title.split("OneUptime").length - 1).toBe(1);
      expect(guide.seo.description.length).toBeGreaterThanOrEqual(
        MIN_DESCRIPTION_LENGTH,
      );
      expect(guide.seo.description.length).toBeLessThanOrEqual(
        MAX_DESCRIPTION_LENGTH,
      );
    });

    test("writes every mark it opens, and links only where the site writes links", () => {
      const problems: Array<string> = everyText(guide).flatMap(
        ([where, text]: [string, InlineText]): Array<string> => {
          return inlineTextProblems(text).map((problem: string): string => {
            return `${where}: ${problem}`;
          });
        },
      );

      expect(problems).toEqual([]);
    });

    test("links only to guides the site publishes", () => {
      const links: Array<string> = everyText(guide).flatMap(
        ([, text]: [string, InlineText]): Array<string> => {
          return inlineTextLinks(text);
        },
      );

      for (const link of links) {
        const guideLink: RegExpMatchArray | null = link.match(GUIDE_LINK);

        if (guideLink) {
          expect(SLUGS).toContain(guideLink[1]);
        } else {
          expect([link, DOCS_LINK.test(link) || link.startsWith("/")]).toEqual([
            link,
            true,
          ]);
        }
      }
    });

    test("relates guides the site publishes, never itself", () => {
      for (const slug of guide.related) {
        expect(SLUGS).toContain(slug);
      }
      expect(guide.related).not.toContain(guide.slug);
      expect(new Set(guide.related).size).toBe(guide.related.length);
      for (const doc of guide.docs) {
        expect(doc.href).toMatch(DOCS_LINK);
      }
    });

    test("names each snippet once, with a check", () => {
      const ids: Array<string> = guideSnippets(guide).map(
        (snippet: GuideSnippet): string => {
          return snippet.id;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
      for (const snippet of guideSnippets(guide)) {
        expect(snippet.code.trim().length).toBeGreaterThan(0);
        expect(["run", "contained", "parse", "illustrative"]).toContain(
          snippet.check,
        );
      }
    });

    test("runs every snippet it says it runs, end to end", () => {
      const run: Array<string> = [
        ...runsOf(guide).flatMap(
          (verificationRun: GuideVerificationRun): Array<string> => {
            return [
              ...verificationRun.files.map((file: VerificationFile): string => {
                return file.snippet || "";
              }),
              ...verificationRun.commands.map(
                (command: VerificationCommand): string => {
                  return command.snippet || "";
                },
              ),
              ...(verificationRun.environmentSnippets || []),
            ];
          },
        ),
        // The Cloud tab's variables are the environment the check runs with.
        "env-cloud",
      ];

      for (const snippet of guideSnippets(guide)) {
        if (snippet.check === "run") {
          expect([snippet.id, run.includes(snippet.id)]).toEqual([
            snippet.id,
            true,
          ]);
        }
      }
    });

    test("shows only fragments of files the check ran, word for word", () => {
      const files: Array<string> = verificationFileTexts(guide);

      for (const snippet of guideSnippets(guide)) {
        if (snippet.check === "contained") {
          expect([
            snippet.id,
            files.some((file: string): boolean => {
              return file.includes(snippet.code);
            }),
          ]).toEqual([snippet.id, true]);
        }
      }
    });

    test("parses every snippet as its language", () => {
      const problems: Array<string> = guideSnippets(guide).flatMap(
        (snippet: GuideSnippet): Array<string> => {
          return parseProblems(snippet).map((problem: string): string => {
            return `${snippet.id}: ${problem}`;
          });
        },
      );

      expect(problems).toEqual([]);
    });

    test("fits its code to the width its page shows, so no line scrolls on a laptop", () => {
      const lines: Array<string> = placedGuideSnippets(guide).flatMap(
        (placed: PlacedSnippet): Array<string> => {
          return linesPastColumns(placed.snippet.code, placed.columns).map(
            (line: string): string => {
              return `${placed.snippet.id} (${line.length} of ${placed.columns}): ${line}`;
            },
          );
        },
      );

      expect([guide.slug, lines]).toEqual([guide.slug, []]);
    });

    test("pins every OpenTelemetry package it installs, at the version that ran", () => {
      const record: GuideVerificationRecord | undefined = getVerificationRecord(
        guide.slug,
      );
      const declared: Array<InstalledPackage> =
        guideSnippets(guide).flatMap(snippetInstalls);
      const installs: Array<InstalledPackage> = declared.filter(
        (install: InstalledPackage): boolean => {
          // A dependency a BOM or a parent manages names no version of its own.
          return install.version !== undefined;
        },
      );

      /*
       * Every guide installs something. One whose build leaves every
       * version to the framework's BOM (Quarkus, Micronaut) pins none.
       */
      expect(declared.length).toBeGreaterThan(0);
      for (const install of installs) {
        expect([install.name, install.version]).toEqual([
          install.name,
          PINNED_PACKAGE_VERSIONS[install.ecosystem][install.name],
        ]);
        expect([install.name, install.version]).toEqual([
          install.name,
          recordedVersion(record, install.name),
        ]);
      }
    });

    test("names, in a language the tests cannot run, only code the check ran or compiled", () => {
      for (const snippet of guideSnippets(guide)) {
        if (
          COMPILED_OR_RUN_LANGUAGES.includes(snippet.language) &&
          !isBuildFileSnippet(snippet)
        ) {
          expect([snippet.id, snippet.check]).toEqual([
            snippet.id,
            expect.stringMatching(/^(run|contained)$/),
          ]);
        }
      }
    });

    test("declares the same dependencies in its Maven and Gradle builds", () => {
      for (const twin of buildTwins(guide)) {
        const declared: Array<Array<string>> = twin.builds.map(
          (snippets: Array<GuideSnippet>): Array<string> => {
            return snippets
              .flatMap(buildFileDependencies)
              .map((dependency: InstalledPackage): string => {
                return `${dependency.name}:${dependency.version || "managed"}`;
              })
              .sort();
          },
        );

        expect([twin.where, declared.length > 1]).toEqual([twin.where, true]);
        for (const each of declared) {
          expect([twin.where, each.length > 0]).toEqual([twin.where, true]);
          expect([twin.where, each]).toEqual([twin.where, declared[0]]);
        }
      }
    });

    test("imports only packages it installs, and names they export at the versions that ran", () => {
      const record: GuideVerificationRecord | undefined = getVerificationRecord(
        guide.slug,
      );
      const installed: Array<string> = installedPackages(
        commandsText(guide),
      ).map((item: InstalledPackage): string => {
        return item.name;
      });
      const problems: Array<string> = [];

      for (const snippet of guideSnippets(guide).filter(isScriptSnippet)) {
        for (const specifier of moduleSpecifiers(snippet.code)) {
          if (!isPackageSpecifier(specifier) || NODE_BUILTIN.test(specifier)) {
            continue;
          }
          if (!installed.includes(packageNameOf(specifier))) {
            problems.push(
              `${snippet.id}: imports ${specifier}, which the guide does not install`,
            );
          }
        }

        for (const [specifier, name] of importedNames(snippet.code)) {
          if (!isPackageSpecifier(specifier) || NODE_BUILTIN.test(specifier)) {
            continue;
          }
          const exported: Array<string> | undefined =
            record?.packageExports[specifier];
          if (!exported || !exported.includes(name)) {
            problems.push(
              `${snippet.id}: ${name} is not exported by ${specifier}`,
            );
          }
        }
      }

      expect(problems).toEqual([]);
    });

    test("installs its other packages at exact versions, so the check can be run again", () => {
      for (const install of installedPackages(commandsText(guide))) {
        expect([
          install.name,
          isExactVersion(install.ecosystem, install.version),
        ]).toEqual([install.name, true]);
      }
    });

    test("was checked end to end with the snippets it shows now", () => {
      const record: GuideVerificationRecord | undefined = getVerificationRecord(
        guide.slug,
      );

      expect(record).toBeDefined();
      expect(record!.snippetDigest).toBe(guideSnippetDigest(guide));
      expect(record!.observed.spans.length).toBeGreaterThan(0);
      expect(record!.observed.logs.length).toBeGreaterThan(0);
      expect(record!.observed.metrics.length).toBeGreaterThan(0);
      // Everything the guide expects arrived in that run.
      for (const span of guide.verification.expect.spans) {
        expect(record!.observed.spans).toContain(span.name);
      }
      for (const metric of guide.verification.expect.metrics) {
        expect(record!.observed.metrics).toContain(metric);
      }
      // ...and in each variant's.
      for (const variant of guide.verification.variants || []) {
        const observed: GuideVerificationRecord["observed"] | undefined =
          record!.variants?.[variant.name]?.observed;

        expect([variant.name, Boolean(observed)]).toEqual([variant.name, true]);
        for (const span of variant.expect.spans) {
          expect(observed!.spans).toContain(span.name);
        }
        for (const metric of variant.expect.metrics) {
          expect(observed!.metrics).toContain(metric);
        }
      }
    });
  },
);

describe("the width a guide's code is shown at", () => {
  test("is a section's for a block in a section, and narrower inside a step or an answer", () => {
    const python: OpenTelemetryGuide = OPEN_TELEMETRY_GUIDE_PAGES.find(
      (guide: OpenTelemetryGuide): boolean => {
        return guide.slug === "python";
      },
    )!;
    const columnsOf: Map<string, number> = new Map<string, number>(
      placedGuideSnippets(python).map(
        (placed: PlacedSnippet): [string, number] => {
          return [placed.snippet.id, placed.columns];
        },
      ),
    );

    expect([SECTION_CODE_COLUMNS, INDENTED_CODE_COLUMNS]).toEqual([94, 87]);
    // The install command, in its section.
    expect(columnsOf.get("install")).toBe(SECTION_CODE_COLUMNS);
    // The worker, in the first step, and the in-code setup, in a step's tab.
    expect(columnsOf.get("worker")).toBe(INDENTED_CODE_COLUMNS);
    expect(columnsOf.get("in-code")).toBe(INDENTED_CODE_COLUMNS);
    // The same snippets, in the page's order, as guideSnippets lists them.
    expect(
      placedGuideSnippets(python).map((placed: PlacedSnippet): string => {
        return placed.snippet.id;
      }),
    ).toEqual(
      guideSnippets(python).map((snippet: GuideSnippet): string => {
        return snippet.id;
      }),
    );
  });

  test("lets only a word too long for any line run past it: an address or a package's coordinates", () => {
    const columns: number = 40;

    expect(linesPastColumns("short\n" + "x".repeat(40), columns)).toEqual([]);
    expect(
      linesPastColumns(
        "call(one, two, three, four, five, six, seven)",
        columns,
      ),
    ).toEqual(["call(one, two, three, four, five, six, seven)"]);
    // One word longer than the column, with the line's indentation: kept.
    const address: string = `  curl https://example.com/${"a".repeat(30)}/file.jar`;
    expect(linesPastColumns(address, columns)).toEqual([]);
    const coordinates: string = `    implementation("io.example:${"b".repeat(30)}:1.0")`;
    expect(linesPastColumns(coordinates, columns)).toEqual([]);
    // A long word on a line that could break before it is not.
    expect(
      linesPastColumns(`x = f(${"c".repeat(20)}, ${"d".repeat(20)})`, columns),
    ).toHaveLength(1);
  });

  test("breaks a Dockerfile's CMD before its options when it is too wide, and keeps it whole otherwise", () => {
    expect(dockerfileCommand(["python", "app.py"])).toBe(
      'CMD ["python", "app.py"]',
    );
    const wrapped: string = dockerfileCommand([
      "opentelemetry-instrument",
      "gunicorn",
      "shop.wsgi",
      "--bind",
      "0.0.0.0:8000",
      "--workers",
      "4",
    ]);

    expect(wrapped.split("\n")).toEqual([
      'CMD ["opentelemetry-instrument", "gunicorn", "shop.wsgi", \\',
      '     "--bind", "0.0.0.0:8000", "--workers", "4"]',
    ]);
    // Docker reads the two lines as one exec form: a JSON array.
    expect(
      JSON.parse(wrapped.replace(" \\\n", " ").slice("CMD ".length)),
    ).toEqual([
      "opentelemetry-instrument",
      "gunicorn",
      "shop.wsgi",
      "--bind",
      "0.0.0.0:8000",
      "--workers",
      "4",
    ]);
    for (const line of wrapped.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(SECTION_CODE_COLUMNS);
    }
  });
});

describe("what the guides write", () => {
  test("gives every guide its own title, description, h1 and card", () => {
    for (const field of [
      (guide: OpenTelemetryGuide): string => {
        return guide.seo.title;
      },
      (guide: OpenTelemetryGuide): string => {
        return guide.seo.description;
      },
      (guide: OpenTelemetryGuide): string => {
        return guide.h1;
      },
      (guide: OpenTelemetryGuide): string => {
        return guide.cardDescription;
      },
      (guide: OpenTelemetryGuide): string => {
        return guide.lead;
      },
    ]) {
      const values: Array<string> = GUIDES.map(field);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  test("writes no sentence two guides share, beyond the facts kept in one place", () => {
    const writers: Map<string, Array<string>> = new Map();

    for (const guide of GUIDES) {
      for (const [where, text] of guideTexts(guide)) {
        if (
          text.length < SHARED_TEXT_LENGTH ||
          SHARED_GUIDE_TEXTS.includes(text)
        ) {
          continue;
        }
        writers.set(text, [
          ...(writers.get(text) || []),
          `${guide.slug}.${where}`,
        ]);
      }
    }

    const shared: Array<string> = [...writers.entries()]
      .filter(([, where]: [string, Array<string>]): boolean => {
        return (
          new Set(
            where.map((place: string): string => {
              return place.split(".")[0]!;
            }),
          ).size > 1
        );
      })
      .map(([text, where]: [string, Array<string>]): string => {
        return `${where.join(", ")}: ${text}`;
      });

    expect(shared).toEqual([]);
  });
});
