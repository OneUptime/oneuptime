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
 *  - a fence line's run of backticks or tildes, followed by the rest of the
 *    line to its end, is taken whole;
 *  - the telemetry list grammar's " OR " is never a run of white space read
 *    again from each of its characters.
 *
 * And every pattern of these shapes, wherever it is, reads the texts that
 * were slow in well under two seconds.
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

const FAMILIES: ReadonlyArray<Family> = [
  {
    name: "a database error's connection address or password setting",
    isMember: (pattern: SourcePattern): boolean => {
      return (
        pattern.source.includes(":\\/\\/[^\\s]*@") ||
        pattern.source.includes(":\\/\\/\\S*@") ||
        /\(password\|pwd\)\\s\*\[=:\]/i.test(pattern.source)
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
    name: "the telemetry list grammar's OR between runs of white space",
    isMember: (pattern: SourcePattern): boolean => {
      return pattern.source.includes("\\s+OR\\s+");
    },
    breaksRule: (): string => {
      return "split with splitOnListSeparators, or look for \\sOR\\s";
    },
    mustFind: [],
    oldShapes: ["\\s+OR\\s+|,", ",|\\s+OR\\s+"],
    slowTexts: [repeat("\t", LENGTH) + "x", repeat(" ", LENGTH) + "ORx"],
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
        file: "packages/Common/Utils/Example.ts",
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
