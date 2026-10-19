import { listProductFiles } from "../../Helpers/CodeScanning";
import { SourcePattern, patternsInSource } from "../../Helpers/SourcePatterns";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * PATTERNS OF ONE SHAPE READ OUTSIDE TEXT ONE WAY - IN TIME IN LINE WITH ITS
 * LENGTH.
 *
 * Each family below reads text somebody outside can make long - a
 * database's error message, a project's query, a workflow's arguments, a
 * line of markdown, a search list - and each had the same flaw wherever it
 * was written: tried from every place a match could start, each try read
 * on to the end of the run or the line, so the time grew with the square
 * of the text's length. Each family now has one way it is written, and
 * this guard holds every product file (read from its source, ee/ and the
 * agents' copies too, when checked out) to it:
 *
 *  - a database error's credentials are redacted by DatabaseErrorRedaction,
 *    never by a pattern of the old shape;
 *  - a query's trailing ";" come off with SqlStatementTerminators;
 *  - a "{{...}}" placeholder, found by "the fewest characters up to }}", is
 *    read through TemplatePlaceholders, whose patterns take a "{{" with no
 *    "}}" on its line with the rest of the line;
 *  - a "{{...}}" the grouping engines clear (no "}" inside it) is cleared
 *    with clearPlaceholders, which takes a "{{" that starts none up to the
 *    next "}";
 *  - a fence line's run of backticks or tildes, followed by the rest of the
 *    line to its end, is taken whole;
 *  - an " OR " between runs of white space (the telemetry list grammar, a
 *    SCIM members filter) is never a run of white space read again from
 *    each of its characters;
 *  - a run of white space that holds a line break is made one space with
 *    collapseLineBreakRuns;
 *  - a stack frame line (V8, Python, Ruby, C#, PHP) is read by
 *    StackFrameLines, never by a pattern whose lazy name or file can start
 *    inside the white space before it;
 *  - an error log's first line (a Go panic, a Java thread, a dotted type)
 *    is read by LogExceptionText, never with a run of white space before a
 *    "(.*)$" a line separator can stop;
 *  - a model's "Label: value" line is read by findLabelledValues, never by
 *    a pattern whose white space runs on around a "**" at every line start;
 *  - a run of capitals before a word is split by
 *    splitCapitalRunsBeforeWords;
 *  - what dig printed is read by DigOutput, never by a pattern tried from
 *    every "flags:" of a line;
 *  - a kubectl message with something between two phrases is looked for
 *    from the first time its first phrase is written on a line.
 *
 * And every pattern of these shapes, wherever it is, reads the texts that
 * were slow in well under two seconds.
 *
 * Further down: the files that read outside text take a run that ends it
 * off from its end, and find an image, a link, a bracketed part or a pair
 * of delimiters once.
 * ---------------------------------------------------------------------------
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx|js|mjs|cjs)$/;

interface Family {
  name: string;
  // Whether a product pattern belongs to the family.
  isMember: (pattern: SourcePattern) => boolean;
  // Why a member breaks the family's rule, or null when it keeps it.
  breaksRule: (pattern: SourcePattern) => string | null;
  // Files the finder must find members in (it would find none if it broke).
  mustFind: ReadonlyArray<string>;
  // The shapes the family was written in before, which the rule refuses.
  oldShapes: ReadonlyArray<string>;
  // Where an old shape would be written, for a family held to some files only.
  exampleFile?: string | undefined;
  slowTexts: ReadonlyArray<string>;
}

const LENGTH: number = 100000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);

const TEMPLATE_PLACEHOLDERS_FILE: string =
  "packages/Common/Utils/TemplatePlaceholders.ts";
const SQL_TERMINATORS_FILE: string =
  "packages/Common/Utils/DataSource/SqlStatementTerminators.ts";
const GROUPING_TEMPLATE_FILE: string =
  "packages/Common/Server/Utils/Rules/GroupingRuleEpisodeTemplate.ts";
const SCIM_BELOW_PLAN_FILE: string =
  "ee/Server/Identity/Utils/SCIMBelowPlan.ts";

// ee/ is removed before the Common Test job runs; its files are read when it is there.
const EE_IS_CHECKED_OUT: boolean = fs.existsSync(
  path.join(REPOSITORY_DIRECTORY, "ee"),
);

// "{{", a class of anything but "}" (in a group or not), "}}" - escaped or not.
const BRACED_PLACEHOLDER_SHAPE: RegExp =
  /\\\{\\\{\(?\[\^\}\]\+\)?\\\}\\\}|\{\{\(?\[\^\}\]\+\)?\}\}/;

/*
 * The last alternative that takes a "{{" that starts none up to the next
 * "}": "|\{\{[^}]*" (or unescaped).
 */
const UNCLOSED_BRACES_ALTERNATIVE: RegExp =
  /\|\\\{\\\{\[\^\}\]\*|\|\{\{\[\^\}\]\*/;

// White space, "or" in any case, white space: "\s+or\s+".
const OR_BETWEEN_RUNS_SHAPE: RegExp = /\\s\+or\\s\+/i;

// The same, tried only where a run of white space starts.
const OR_FROM_RUN_START_SHAPE: RegExp = /\(\?<!\\s\)\\s\+or\\s\+/i;

// A stack frame's grammar, read with a lazy name or file.
const isFrameLinePattern: (source: string) => boolean = (
  source: string,
): boolean => {
  return (
    (source.startsWith("^at\\s+") && source.includes("(.+?)")) ||
    source.startsWith('^File\\s+"(.+?)"') ||
    source.startsWith("^(.+?):(\\d+):in") ||
    source.startsWith("^#\\d+\\s+(.+?)")
  );
};

// White space, a "**" and white space, at a label line's start.
const SPACE_STARS_SPACE: string = "\\s*\\**\\s*";

// A run of capitals, then a capital and a lower-case letter.
const CAPITAL_RUN_BEFORE_WORD: string = "([A-Z]+)([A-Z][a-z])";

// What dig prints its flags after.
const DIG_FLAGS: RegExp = /flags:/i;

// The kubectl messages with something between two phrases.
const KUBECTL_PHRASES: RegExp =
  /The connection to the server|is forbidden: User/;

// Looked for from a line's first phrase: ^(?:(?!<phrase>).)*<phrase>.
const FROM_FIRST_PHRASE: string = "^(?:(?!";

const FAMILIES: ReadonlyArray<Family> = [
  {
    name: "a database error's connection address or password setting",
    isMember: (pattern: SourcePattern): boolean => {
      return (
        pattern.source.includes(":\\/\\/[^\\s]*@") ||
        pattern.source.includes(":\\/\\/\\S*@") ||
        pattern.source.includes("(password|pwd)\\s*[=:]")
      );
    },
    breaksRule: (): string => {
      return "redact it with DatabaseErrorRedaction (redactDsns, redactPasswordSettings)";
    },
    mustFind: [],
    oldShapes: [
      "[a-zA-Z]+:\\/\\/[^\\s]*@[^\\s]*",
      "(password|pwd)\\s*[=:]\\s*(\\{[^}]*\\}|\"[^\"]*\"|'[^']*'|[^;\\r\\n]+)",
    ],
    slowTexts: [repeat("A://", LENGTH), repeat("pwd={\n", LENGTH)],
  },
  {
    name: "a query's trailing statement terminators",
    isMember: (pattern: SourcePattern): boolean => {
      return pattern.source.includes(";+\\s*$");
    },
    breaksRule: (pattern: SourcePattern): string | null => {
      return pattern.file === SQL_TERMINATORS_FILE
        ? null
        : "take them off with withoutTrailingStatementTerminators";
    },
    mustFind: [SQL_TERMINATORS_FILE],
    oldShapes: [";+\\s*$"],
    slowTexts: [repeat(";", LENGTH) + "x;", repeat("; ", LENGTH) + "x"],
  },
  {
    name: "a {{...}} placeholder read as the fewest characters up to }}",
    isMember: (pattern: SourcePattern): boolean => {
      return (
        (pattern.source.includes("{{") || pattern.source.includes("\\{\\{")) &&
        pattern.source.includes(".*?")
      );
    },
    breaksRule: (pattern: SourcePattern): string | null => {
      return pattern.file === TEMPLATE_PLACEHOLDERS_FILE
        ? null
        : "read placeholders with TemplatePlaceholders";
    },
    mustFind: [TEMPLATE_PLACEHOLDERS_FILE],
    oldShapes: [
      "{{(.*?)}}",
      "\\{\\{(.*?)\\}\\}",
      "\\{\\{#each\\s+(.*?)\\}\\}",
      "\\{\\{((?!#each\\b|\\/each\\b|@index\\b).*?)\\}\\}",
    ],
    slowTexts: [
      repeat("{{", LENGTH),
      repeat("{{}", LENGTH) + "\n",
      repeat("{{#each a ", LENGTH),
      "{{#each" + repeat(" ", LENGTH) + "x",
    ],
  },
  {
    name: "a fence line's run, then the rest of the line",
    isMember: (pattern: SourcePattern): boolean => {
      return (
        (pattern.source.includes("`{3,}") ||
          pattern.source.includes("~{3,}")) &&
        pattern.source.includes(".*") &&
        pattern.source.endsWith("$")
      );
    },
    breaksRule: (pattern: SourcePattern): string | null => {
      const backticks: number = pattern.source.split("`{3,}").length - 1;
      const tildes: number = pattern.source.split("~{3,}").length - 1;
      const wholeBackticks: number =
        pattern.source.split("`{3,}(?!`)").length - 1;
      const wholeTildes: number = pattern.source.split("~{3,}(?!~)").length - 1;

      return backticks === wholeBackticks && tildes === wholeTildes
        ? null
        : 'take each run whole: "`{3,}(?!`)" and "~{3,}(?!~)"';
    },
    mustFind: [
      "packages/Common/Utils/AI/InvestigationReport.ts",
      "packages/Common/Utils/Markdown/FeedMarkdown.ts",
      "packages/Common/Utils/Markdown/UntrustedMarkdown.ts",
      "packages/Common/Server/Types/Markdown.ts",
    ],
    oldShapes: [
      "^[ \\t]*(`{3,}|~{3,})(.*)$",
      "^( {0,3})(`{3,}|~{3,})(.*)$",
      "^(?:(`{3,})[^`]*|(~{3,}).*)$",
    ],
    slowTexts: [
      "```" + repeat("`", LENGTH) + LINE_SEPARATOR,
      "~~~" + repeat("~", LENGTH) + LINE_SEPARATOR,
      "  ~~~" + repeat("~", LENGTH) + "\r",
    ],
  },
  {
    name: "an OR between runs of white space",
    isMember: (pattern: SourcePattern): boolean => {
      return OR_BETWEEN_RUNS_SHAPE.test(pattern.source);
    },
    breaksRule: (pattern: SourcePattern): string | null => {
      return OR_FROM_RUN_START_SHAPE.test(pattern.source)
        ? null
        : "split with splitOnListSeparators, look for \\sOR\\s, or try it only where a run of white space starts: (?<!\\s)\\s+or\\s+";
    },
    mustFind: EE_IS_CHECKED_OUT ? [SCIM_BELOW_PLAN_FILE] : [],
    oldShapes: ["\\s+OR\\s+|,", ",|\\s+OR\\s+", "\\s+or\\s+"],
    slowTexts: [
      repeat("\t", LENGTH) + "x",
      repeat(" ", LENGTH) + "ORx",
      repeat(" \t", LENGTH) + "order",
    ],
  },
  {
    name: "a {{...}} with no } inside it, cleared",
    isMember: (pattern: SourcePattern): boolean => {
      return BRACED_PLACEHOLDER_SHAPE.test(pattern.source);
    },
    breaksRule: (pattern: SourcePattern): string | null => {
      return UNCLOSED_BRACES_ALTERNATIVE.test(pattern.source)
        ? null
        : 'clear placeholders with clearPlaceholders (GroupingRuleEpisodeTemplate), or take a "{{" that starts none up to the next "}" in a last alternative: |\\{\\{[^}]*';
    },
    mustFind: [GROUPING_TEMPLATE_FILE, "Scripts/I18n/ValidateLocales.js"],
    oldShapes: ["\\{\\{[^}]+\\}\\}", "\\{\\{([^}]+)\\}\\}", "{{[^}]+}}"],
    slowTexts: [
      repeat("{", LENGTH),
      repeat("{{a", LENGTH),
      repeat("{{", LENGTH) + "}",
    ],
  },
  {
    name: "a run of white space that holds a line break, made one space",
    isMember: (pattern: SourcePattern): boolean => {
      return pattern.source.includes("\\s*[\\r\\n]+\\s*");
    },
    breaksRule: (): string => {
      return "make each run one space with collapseLineBreakRuns";
    },
    mustFind: [],
    oldShapes: ["\\s*[\\r\\n]+\\s*"],
    slowTexts: [repeat(" ", LENGTH) + "x\n", repeat("\t", LENGTH) + "\u0000\r"],
  },
  {
    name: "a stack frame line's name or file, read as the fewest characters up to what follows",
    isMember: (pattern: SourcePattern): boolean => {
      return isFrameLinePattern(pattern.source);
    },
    breaksRule: (): string => {
      return "read the frame line with StackFrameLines";
    },
    mustFind: [],
    oldShapes: [
      "^at\\s+eval\\s+\\(eval\\s+at\\s+(.+?)\\s+\\((.+?):(\\d+):(\\d+)\\)",
      "^at\\s+(.+?)\\s+\\((.+?):(\\d+):(\\d+)\\)$",
      "^at\\s+(.+?)\\s+\\((.+?):(\\d+)\\)$",
      "^at\\s+(.+?):(\\d+):(\\d+)$",
      '^File\\s+"(.+?)",\\s+line\\s+(\\d+)(?:,\\s+in\\s+(.+))?$',
      "^(.+?):(\\d+):in\\s+[`'](.+?)'$",
      "^at\\s+(.+?)\\s+in\\s+(.+?):line\\s+(\\d+)$",
      "^#\\d+\\s+(.+?)\\((\\d+)\\):\\s+(.+)$",
    ],
    slowTexts: [
      "at x" + repeat("\t(", LENGTH),
      "#0 x" + repeat("(0):\t", LENGTH) + "\rz",
    ],
  },
  {
    name: "an error log's first line, a run of white space before the rest of it",
    exampleFile: "packages/Common/Server/Utils/Telemetry/Example.ts",
    isMember: (pattern: SourcePattern): boolean => {
      return (
        pattern.file.includes("/Telemetry/") &&
        (pattern.source.endsWith("\\s*(.*)$") ||
          pattern.source.endsWith("\\s+(.*)$"))
      );
    },
    breaksRule: (): string => {
      return "read the line with LogExceptionText";
    },
    mustFind: [],
    oldShapes: [
      "^panic:\\s*(.*)$",
      '^Exception in thread\\s+"[^"]*"\\s+(.*)$',
      "^([A-Za-z_][\\w.$]*\\.[A-Za-z_][\\w.$]*):\\s*(.*)$",
    ],
    slowTexts: ["panic:" + repeat("\t", LENGTH / 10) + "y" + LINE_SEPARATOR + "x"],
  },
  {
    name: "a model's label line, white space around a ** at every line start",
    isMember: (pattern: SourcePattern): boolean => {
      return pattern.source.includes(SPACE_STARS_SPACE);
    },
    breaksRule: (): string => {
      return "read the label lines with findLabelledValues (LabelledAnswerLines)";
    },
    mustFind: [],
    oldShapes: [
      "^\\s*\\**\\s*selectedrunbook\\s*\\**\\s*[:=]\\s*\\**\\s*([a-z0-9-]{8,64}|none)\\b",
      "^\\s*\\**\\s*classification\\s*\\**\\s*[:=]\\s*\\**\\s*(code-fault|user-error|expected-denial|infrastructure|unknown)\\b",
    ],
    slowTexts: [repeat("\n", LENGTH / 100) + "*"],
  },
  {
    name: "a run of capitals before a word, split",
    isMember: (pattern: SourcePattern): boolean => {
      return pattern.source.includes(CAPITAL_RUN_BEFORE_WORD);
    },
    breaksRule: (): string => {
      return "split it with splitCapitalRunsBeforeWords (Utils/CapitalRuns)";
    },
    mustFind: [],
    oldShapes: ["([A-Z]+)([A-Z][a-z])"],
    slowTexts: [repeat("A", LENGTH) + "\u0000AAa"],
  },
  {
    name: "what dig printed, read from every flags:",
    exampleFile: "packages/Probe/Utils/Monitors/Example.ts",
    isMember: (pattern: SourcePattern): boolean => {
      return (
        pattern.file.startsWith("packages/Probe/") &&
        DIG_FLAGS.test(pattern.source) &&
        pattern.source !== "flags:"
      );
    },
    breaksRule: (): string => {
      return "read dig's output with DigOutput";
    },
    mustFind: [],
    oldShapes: ["flags:.*\\bad\\b", "flags:\\s*([^;]+);"],
    slowTexts: [repeat("flags:", LENGTH), "FLAGS:" + repeat("\t", LENGTH)],
  },
  {
    name: "a kubectl message with something between two phrases",
    isMember: (pattern: SourcePattern): boolean => {
      return (
        KUBECTL_PHRASES.test(pattern.source) &&
        (pattern.source.includes(".+") || pattern.source.includes(".*"))
      );
    },
    breaksRule: (pattern: SourcePattern): string | null => {
      return pattern.source.startsWith(FROM_FIRST_PHRASE) &&
        pattern.flags.includes("m")
        ? null
        : "look for it from the first phrase of each line: ^(?:(?!<phrase>).)*<phrase>, with the m flag";
    },
    mustFind: [
      "packages/Common/Server/Utils/AI/ClusterAccess/KubectlJobRunner.ts",
    ],
    oldShapes: [
      "The connection to the server .+ was refused",
      ' is forbidden: User ".*" cannot ',
    ],
    slowTexts: [
      repeat("The connection to the server d", LENGTH),
      repeat(' is forbidden: User "', LENGTH),
    ],
  },
];

const PRODUCT_PATTERNS: Array<SourcePattern> = listProductFiles()
  .filter((file: string): boolean => {
    return CODE_FILE.test(file);
  })
  .flatMap((file: string): Array<SourcePattern> => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, file),
      "utf8",
    );

    return patternsInSource(file, text);
  });

describe.each(FAMILIES)("$name", (family: Family) => {
  const members: Array<SourcePattern> = PRODUCT_PATTERNS.filter(
    (pattern: SourcePattern): boolean => {
      return family.isMember(pattern);
    },
  );

  test("the guard finds the patterns it holds to the rule", () => {
    for (const file of family.mustFind) {
      expect({
        file,
        found: members.some((pattern: SourcePattern): boolean => {
          return pattern.file === file;
        }),
      }).toEqual({ file, found: true });
    }
  });

  test("the guard recognises the shapes the family was written in before", () => {
    for (const source of family.oldShapes) {
      const old: SourcePattern = {
        file: family.exampleFile || "packages/Common/Utils/Example.ts",
        line: 1,
        name: null,
        source: source,
        flags: "g",
      };

      expect({ source, member: family.isMember(old) }).toEqual({
        source,
        member: true,
      });
      expect(family.breaksRule(old)).not.toBeNull();
    }
  });

  test("every one is written the one way", () => {
    const offending: Array<string> = members
      .map((pattern: SourcePattern): string | null => {
        const reason: string | null = family.breaksRule(pattern);

        return reason
          ? `${pattern.file}:${pattern.line} /${pattern.source}/${pattern.flags} - ${reason}`
          : null;
      })
      .filter((line: string | null): line is string => {
        return line !== null;
      });

    expect(offending).toEqual([]);
  });

  test("every one reads the texts that were slow in well under two seconds", () => {
    const slow: Array<string> = [];

    for (const pattern of members) {
      for (const text of family.slowTexts) {
        const startedAt: number = Date.now();

        text.replace(new RegExp(pattern.source, pattern.flags), "x");

        const elapsed: number = Date.now() - startedAt;

        if (elapsed >= 2000) {
          slow.push(
            `${pattern.file}:${pattern.line} took ${elapsed} ms on ${JSON.stringify(text.slice(0, 20))}...`,
          );
        }
      }
    }

    expect(slow).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * In the files that read text somebody outside wrote - a URL a project
 * saved, a host name an application reported, a model's answer, a probe's
 * failure line - a run that ends the text comes off with withoutTrailingRun
 * (TrailingRuns), never with a pattern such as /\/+$/ tried from every
 * character of every run; and an image, a link, a bracketed part or a pair
 * of delimiters is found once, never looked for again from every opener.
 * ---------------------------------------------------------------------------
 */
const TRAILING_RUN_READERS: ReadonlyArray<[string, string]> = [
  [
    "packages/Common/Server/Utils/DataSource/Connectors/ElasticsearchConnector.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Common/Server/Utils/DataSource/Connectors/LokiConnector.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Common/Server/Utils/DataSource/Connectors/PrometheusConnector.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Common/Server/Utils/DataSource/Connectors/RestApiConnector.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Common/Server/Utils/SecurityEvent/Connectors/ElasticSecurity/ElasticSecurityClient.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Common/Server/Utils/SecurityEvent/Connectors/Okta/OktaClient.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Common/Server/Utils/SecurityEvent/Connectors/Splunk/SplunkClient.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Common/Utils/SecurityEvent/Connectors/MicrosoftSentinelNormalizer.ts",
    "withoutTrailingSlashes(",
  ],
  ["packages/Common/Server/Utils/LLM/LLMService.ts", "withoutTrailingSlashes("],
  ["packages/Common/Utils/LLM/LlmProviderEndpoint.ts", "withoutTrailingSlashes("],
  [
    "packages/Common/Server/Utils/Monitor/Criteria/ServerMonitorCriteria.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Common/Server/Utils/CodeRepository/CodeRepository.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Common/Utils/VMware/VMwareVCenterAddress.ts",
    "withoutTrailingSlashes(",
  ],
  [
    "packages/Probe/Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor.ts",
    "withoutTrailingSlashes(",
  ],
  ["packages/Common/Utils/Telemetry/NetworkHost.ts", "withoutTrailingDots("],
  ["packages/Common/Utils/ProbeNetworkFailureUtil.ts", "withoutTrailingDots("],
  [
    "packages/Common/Utils/Monitor/MonitoringIntervalUtil.ts",
    "withoutTrailingDots(",
  ],
  ["packages/Probe/Utils/Domain/DomainName.ts", "withoutTrailingDots("],
  ["packages/Probe/Jobs/Discovery/FetchScans.ts", "withoutTrailingRun("],
  [
    "packages/Common/Server/Utils/AI/Chat/ChatAgentRunner.ts",
    "withoutTrailingRun(",
  ],
  [
    "packages/Common/Server/Utils/AI/SRE/InvestigationTldr.ts",
    "withoutTrailingRun(",
  ],
  [
    "packages/App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReportData.ts",
    "withoutTrailingRun(",
  ],
];

// One atom - an escape, a bracket class or a plain character.
const SINGLE_ATOM: RegExp = /^(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\\[\]()|*+?{}^$])$/;

// One atom repeated to the end of the text: "\/+$", "[.\s]+$", "^-+|-+$".
const isTrailingRunPattern: (source: string) => boolean = (
  source: string,
): boolean => {
  const trailing: string = source.slice(source.lastIndexOf("|") + 1);

  if (!trailing.endsWith("+$")) {
    return false;
  }

  const atom: string = trailing.slice(0, -2);

  return (
    SINGLE_ATOM.test(atom) &&
    (source === trailing || source === `^${atom}+|${trailing}`)
  );
};

// A pair or a bracket looked for again from every opener.
const FROM_EVERY_OPENER: ReadonlyArray<string> = [
  "(?=\\S)([\\s\\S]*?\\S)",
  "\\[([^\\]]*)\\]\\(",
  "\\[([^\\]]+)\\]\\(",
  "\\[[^\\]]*\\]",
];

const OPENER_READERS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReportData.ts",
  "packages/Common/Server/Utils/Monitor/IncomingRequestIncidentGrouping.ts",
];

describe("the files that read outside text take a run that ends it off from its end", () => {
  test("the guard knows a run that ends a text when it sees one", () => {
    for (const source of [
      "\\/+$",
      "\\.+$",
      "[.\\s]+$",
      "[\\s.,;:]+$",
      "^-+|-+$",
      "_+$",
    ]) {
      expect({ source, run: isTrailingRunPattern(source) }).toEqual({
        source,
        run: true,
      });
    }

    for (const source of [":\\d+$", "\\/chat\\/completions$", "a\\.+$"]) {
      expect({ source, run: isTrailingRunPattern(source) }).toEqual({
        source,
        run: false,
      });
    }
  });

  test.each(TRAILING_RUN_READERS)(
    "%s",
    (file: string, reader: string) => {
      if (file.startsWith("ee/") && !EE_IS_CHECKED_OUT) {
        return;
      }

      const text: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, file),
        "utf8",
      );
      const runs: Array<string> = patternsInSource(file, text)
        .filter((pattern: SourcePattern): boolean => {
          return isTrailingRunPattern(pattern.source);
        })
        .map((pattern: SourcePattern): string => {
          return `${pattern.line}: /${pattern.source}/`;
        });

      expect({ file, runs }).toEqual({ file, runs: [] });
      expect({ file, reader, used: text.includes(reader) }).toEqual({
        file,
        reader,
        used: true,
      });
    },
  );

  test.each(OPENER_READERS)(
    "%s finds each opener's match once",
    (file: string) => {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, file),
        "utf8",
      );
      const fromEveryOpener: Array<string> = patternsInSource(file, text)
        .filter((pattern: SourcePattern): boolean => {
          return FROM_EVERY_OPENER.some((shape: string): boolean => {
            return pattern.source.includes(shape);
          });
        })
        .map((pattern: SourcePattern): string => {
          return `${pattern.line}: /${pattern.source}/`;
        });

      expect({ file, fromEveryOpener }).toEqual({ file, fromEveryOpener: [] });
    },
  );
});

describe("the readers each family is held to are the ones the product uses", () => {
  test.each([
    [
      "packages/Common/Server/Utils/DataSource/SqlResultShaper.ts",
      ["redactDsns(", "redactPasswordSettings("],
    ],
    [
      "packages/Probe/Utils/Monitors/MonitorTypes/SqlMonitor.ts",
      [
        "redactDsns(",
        "redactPasswordSettings(",
        "withoutTrailingStatementTerminators(",
      ],
    ],
    [
      "packages/Common/Server/Utils/DataSource/Connectors/PostgresConnector.ts",
      ["withoutTrailingStatementTerminators("],
    ],
    [
      "packages/Common/Server/Utils/VM/VMAPI.ts",
      [
        "findTemplatePlaceholders(",
        "replaceTemplatePlaceholders(",
        "replaceLoopVariablePlaceholders(",
        "findEachOpening(",
      ],
    ],
    [
      "packages/Common/Types/Workflow/TemplateSyntax.ts",
      ["findTemplatePlaceholders(", "replaceTemplatePlaceholders("],
    ],
    [
      "packages/Common/Types/Telemetry/TelemetrySearchQuery.ts",
      ["splitOnListSeparators("],
    ],
    [
      "packages/Common/Utils/Markdown/MarkdownEscape.ts",
      ["collapseLineBreakRuns("],
    ],
    [
      "packages/Common/Server/Utils/Monitor/MonitorCriteriaObservationBuilder.ts",
      ["collapseLineBreakRuns("],
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      ["collapseLineBreakRuns("],
    ],
    [GROUPING_TEMPLATE_FILE, ["clearPlaceholders("]],
    [
      "packages/Common/Server/Services/AlertGroupingEngineService.ts",
      ["clearPlaceholders(", "clearPlaceholdersExcept("],
    ],
    [
      "packages/Common/Server/Services/IncidentGroupingEngineService.ts",
      ["clearPlaceholders(", "clearPlaceholdersExcept("],
    ],
    [
      "packages/Common/Server/Services/AlertEpisodeService.ts",
      ["clearPlaceholders("],
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      ["clearPlaceholders("],
    ],
    [
      "packages/Common/Server/Utils/Telemetry/StackTraceParser.ts",
      [
        "readV8EvalFrame(",
        "readV8FrameWithParens(",
        "readV8FrameWithParensNoColumn(",
        "readV8FrameWithoutParens(",
        "readPythonFrame(",
        "readRubyFrame(",
        "readCSharpFrameWithFile(",
        "readPhpFrame(",
      ],
    ],
    [
      "packages/Common/Server/Utils/Telemetry/LogExceptionExtractor.ts",
      [
        "looksLikeStackTrace(",
        "readAfterJavaThreadPrefix(",
        "readAfterGoPanic(",
        "readQualifiedTypeLine(",
      ],
    ],
    [
      "packages/Common/Server/Utils/CodeRepository/StackTraceRepoResolver.ts",
      ["findPathsWithLineNumber("],
    ],
    [
      "packages/Probe/Utils/Monitors/MonitorTypes/DnsMonitor.ts",
      ["digOutputHasAuthenticatedData("],
    ],
    [
      "packages/Probe/Utils/Monitors/MonitorTypes/DnssecMonitor.ts",
      ["readDigFlagsField("],
    ],
    [
      "packages/Common/Server/Utils/AI/Remediation/RemediationPlanRunner.ts",
      ["findLabelledValues("],
    ],
    [
      "packages/Common/Server/Utils/AI/SRE/Insights/InsightTriageRunner.ts",
      ["findLabelledValues("],
    ],
    [
      "packages/Common/Server/Utils/AI/SRE/InvestigationTldr.ts",
      ["stripBlockMarkers(", "afterLeadingMatches("],
    ],
    [
      "packages/App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReportData.ts",
      ["withoutDelimiterPairs(", "IMAGE_OR_UNCLOSED", "LINK_OR_UNCLOSED"],
    ],
    [
      "packages/Common/Server/Utils/Monitor/IncomingRequestIncidentGrouping.ts",
      ["BRACKETED_PART"],
    ],
    ["packages/Common/Types/Text.ts", ["splitCapitalRunsBeforeWords("]],
    [
      "packages/Common/Types/Workflow/StepSamples.ts",
      ["splitCapitalRunsBeforeWords("],
    ],
    [
      "packages/Common/Server/Utils/Database/PostgresErrorTranslator.ts",
      ["splitCapitalRunsBeforeWords("],
    ],
  ])("%s", (file: string, calls: Array<string>) => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, file),
      "utf8",
    );

    for (const call of calls) {
      expect({ file, call, used: text.includes(call) }).toEqual({
        file,
        call,
        used: true,
      });
    }
  });
});
