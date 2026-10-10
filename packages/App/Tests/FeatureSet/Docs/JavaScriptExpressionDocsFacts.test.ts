import { describe, expect, it, jest } from "@jest/globals";

/*
 * VMUtil.replaceValueInPlace is the substitution the criteria evaluator runs
 * on an expression. Its module also loads the sandbox runner, the logger and
 * tracing, none of which substitution needs.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});

import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { readPage } from "./DocsContentSupport";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorType, {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import fs from "fs";
import path from "path";

/*
 * What the English JavaScript Expressions page says about the product, held
 * to the code that makes it true: which monitor types offer the filter, the
 * one condition it has, the variables each type fills in (the evaluator's
 * own storage maps), and the quoting rules - every example on the page is
 * run through the evaluator's substitution and judged the way the evaluator
 * judges it, with the sample check result the page shows, so an example
 * that would not match fails here.
 *
 * MonitorChecksDocsTranslations holds the translations to this page.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const EVALUATOR_FILE: string =
  "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts";
const VM_RUNNER_FILE: string = "Common/Server/Utils/VM/VMRunner.ts";
const CRITERIA_FILTER_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter.tsx";

const PAGE: string = "monitor/javascript-expression";

const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const BOLD_SPAN: RegExp = /\*\*([^*\n]+?)\*\*/g;
const STORAGE_KEY: RegExp = /^\s+(\w+):/gm;
const MONITOR_TYPE_NAME: RegExp = /MonitorType\.(\w+)/g;
const OFFERED_SENTENCE: RegExp =
  /JavaScript expressions are offered for (.+) monitors\./;
const NAME_SEPARATOR: RegExp = /, | and /;

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

const page: string = readPage("en", PAGE);
const evaluator: string = readRepoFile(EVALUATOR_FILE);

/*
 * The source between `start` and the first `end` after it - the body of a
 * function, from its name to the next declaration.
 */
function sourceBetween(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);

  expect({ start, found: from >= 0 }).toEqual({ start, found: true });

  const to: number = source.indexOf(end, from + start.length);

  return source.slice(from, to < 0 ? undefined : to);
}

// The body of one heading's section, up to the next heading.
function section(heading: string): string {
  const start: number = page.indexOf(`${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const rest: string = page.slice(start + heading.length + 1);
  const next: RegExpMatchArray | null = rest.match(new RegExp("^#{1,3} ", "m"));

  return next && next.index !== undefined ? rest.slice(0, next.index) : rest;
}

function codeItems(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function boldItems(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The body rows of the first table in a text, as arrays of trimmed cells.
function tableRows(text: string): Array<Array<string>> {
  const lines: Array<string> = text.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim().startsWith("|");
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith("|")) {
      break;
    }

    // A cell's inline code may hold a "|" of its own ("||").
    const cells: Array<string> = [];
    let cell: string = "";
    let inCode: boolean = false;

    for (const character of line.trim().slice(1, -1)) {
      if (character === "`") {
        inCode = !inCode;
      }

      if (character === "|" && !inCode) {
        cells.push(cell.trim());
        cell = "";
        continue;
      }

      cell += character;
    }

    cells.push(cell.trim());
    rows.push(cells);
  }

  return rows;
}

/*
 * The variables the evaluator fills in for each monitor type: the keys of
 * the storage map it builds before it substitutes an expression.
 */
function storageMaps(): Array<{
  monitorTypes: Array<string>;
  variables: Array<string>;
}> {
  const block: string = sourceBetween(
    evaluator,
    "if (input.criteriaFilter.checkOn === CheckOn.JavaScriptExpression) {",
    "let expression: string",
  );

  return block
    .split("if (\n        input.monitor.monitorType === ")
    .join("if (input.monitor.monitorType === ")
    .split("if (input.monitor.monitorType === ")
    .slice(1)
    .map((chunk: string): { monitorTypes: Array<string>; variables: Array<string> } => {
      const condition: string = chunk.slice(0, chunk.indexOf(") {"));
      const map: string = sourceBetween(chunk, "storageMap = {", "\n        };");

      return {
        monitorTypes: [
          (chunk.match(new RegExp("^MonitorType\\.(\\w+)")) as RegExpMatchArray)[1] as string,
          ...Array.from(condition.matchAll(MONITOR_TYPE_NAME))
            .map((match: RegExpMatchArray): string => {
              return match[1] as string;
            })
            .slice(1),
        ],
        variables: Array.from(map.matchAll(STORAGE_KEY))
          .map((match: RegExpMatchArray): string => {
            return match[1] as string;
          })
          .filter((key: string): boolean => {
            // Keys of a nested object literal (a mapped group's fields).
            return !["group", "reason", "message", "remediation"].includes(key);
          }),
      };
    });
}

// What the evaluator does to an expression: substitute it as text, then run it.
function judge(storageMap: JSONObject, expression: string): boolean {
  const substituted: string = VMUtil.replaceValueInPlace(
    storageMap,
    expression,
    false,
  );

  // The evaluator runs `return Boolean(${expression});` in its sandbox.
  return Boolean(new Function(`return Boolean(${substituted});`)());
}

// The sample check result the page's examples are written for.
const SAMPLE_RESPONSE_BODY: JSONObject = JSON.parse(
  (/```json\n([\s\S]*?)\n```/.exec(section("## Examples")) as RegExpExecArray)[1] as string,
) as JSONObject;

const WEBSITE_CHECK: JSONObject = {
  responseBody: SAMPLE_RESPONSE_BODY,
  responseHeaders: { "content-type": "application/json; charset=utf-8" },
  responseStatusCode: 200,
  responseTimeInMs: 120,
  isOnline: true,
};

describe("where the filter is offered", () => {
  it("offers it for exactly the monitor types the page names", () => {
    const offered: Array<string> = MonitorTypeHelper.getAllMonitorTypeProps()
      .filter((props: MonitorTypeProps): boolean => {
        return CriteriaFilterUtil.getCheckOnOptionsByMonitorType(
          props.monitorType,
        ).some((option: DropdownOption): boolean => {
          return option.value === CheckOn.JavaScriptExpression;
        });
      })
      .map((props: MonitorTypeProps): string => {
        return props.title;
      });
    const named: Array<string> = (
      (OFFERED_SENTENCE.exec(page) as RegExpExecArray)[1] as string
    ).split(NAME_SEPARATOR);

    expect(named.sort()).toEqual(offered.sort());
  });

  it("has one condition, Evaluates To True", () => {
    expect(
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(
        CheckOn.JavaScriptExpression,
      ).map((option: DropdownOption): string => {
        return option.value.toString();
      }),
    ).toEqual([FilterType.EvaluatesToTrue]);
    expect(page).toContain(
      `set its **Filter Type** to **${CheckOn.JavaScriptExpression}**. The **Filter Condition** is **${FilterType.EvaluatesToTrue}**.`,
    );
  });

  it("names the link under the filter as the form draws it, and the form links here", () => {
    const form: string = readRepoFile(CRITERIA_FILTER_FORM_FILE);
    const link: string =
      "Read documentation for using JavaScript expressions here.";

    expect(form).toContain('to={Route.fromString("/docs/monitor/javascript-expression")}');
    expect(form).toContain(`"${link}"`);
    expect(boldItems(page)).toContain(link);
  });

  it("opens the criteria where the monitor's page and the create form have them", () => {
    expect(page).toContain(
      "open **Configuration → Criteria** and click **Edit Monitoring Criteria**, or use the **Criteria** step of **Create Monitor**",
    );
    expect(
      readRepoFile("App/FeatureSet/Dashboard/src/Pages/Monitor/View/Criteria.tsx"),
    ).toContain('editButtonText="Edit Monitoring Criteria"');
  });
});

describe("the variables of each monitor type", () => {
  const SECTIONS: Array<{ heading: string; monitorTypes: Array<string> }> = [
    { heading: "### Website and API monitors", monitorTypes: ["API", "Website"] },
    {
      heading: "### Incoming Request monitors",
      monitorTypes: ["IncomingRequest"],
    },
    { heading: "### SQL Query monitors", monitorTypes: ["SQLQuery"] },
    { heading: "### Database Health monitors", monitorTypes: ["Database"] },
  ];

  it("documents a section for every storage map the evaluator builds", () => {
    expect(
      storageMaps()
        .map((map: { monitorTypes: Array<string> }): string => {
          return [...map.monitorTypes].sort().join(", ");
        })
        .sort(),
    ).toEqual(
      SECTIONS.map((entry: { monitorTypes: Array<string> }): string => {
        return [...entry.monitorTypes].sort().join(", ");
      }).sort(),
    );
  });

  it.each(SECTIONS)(
    "$heading lists exactly the variables the evaluator fills in",
    (entry: { heading: string; monitorTypes: Array<string> }) => {
      const map: { monitorTypes: Array<string>; variables: Array<string> } =
        storageMaps().find(
          (candidate: { monitorTypes: Array<string> }): boolean => {
            return (
              [...candidate.monitorTypes].sort().join() ===
              [...entry.monitorTypes].sort().join()
            );
          },
        ) as { monitorTypes: Array<string>; variables: Array<string> };
      const text: string = section(entry.heading);
      const documented: Array<string> = text.includes("|")
        ? tableRows(text).map((row: Array<string>): string => {
            return codeItems(row[0] as string)[0] as string;
          })
        : codeItems(text.slice(0, text.indexOf(". See ")));

      expect(documented.sort()).toEqual([...map.variables].sort());
    },
  );

  it("binds no email fields for Incoming Email monitors", () => {
    const offered: Array<DropdownOption> =
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.IncomingEmail);

    expect(
      offered.some((option: DropdownOption): boolean => {
        return option.value === CheckOn.JavaScriptExpression;
      }),
    ).toBe(true);
    expect(
      storageMaps().some((map: { monitorTypes: Array<string> }): boolean => {
        return map.monitorTypes.includes("IncomingEmail");
      }),
    ).toBe(false);
    expect(section("### Incoming Email monitors")).toContain(
      "The filter is offered, but no email fields are bound to it",
    );
  });

  it("parses a JSON response body, and keeps any other body as a string", () => {
    expect(evaluator).toContain("responseBody = JSON.parse(");
    expect(evaluator).toContain(
      "responseBody = (input.dataToProcess as ProbeMonitorResponse)\n            .responseBody as JSONObject;",
    );
    expect(page).toContain(
      "If the response body is JSON, it is parsed; otherwise, such as for HTML or XML, it is a string.",
    );
  });
});

describe("the examples, run the way the evaluator runs them", () => {
  it("substitutes as text and runs Boolean(expression)", () => {
    expect(evaluator).toContain(
      "expression = VMUtil.replaceValueInPlace(storageMap, expression, false);",
    );
    expect(evaluator).toContain("const code: string = `return Boolean(${expression});`;");
  });

  it("matches every expression in the table against the sample response", () => {
    const rows: Array<Array<string>> = tableRows(section("## Examples"));

    expect(rows.length).toBeGreaterThan(4);

    for (const row of rows) {
      const expression: string = codeItems(row[0] as string)[0] as string;

      expect({ expression, matches: judge(WEBSITE_CHECK, expression) }).toEqual({
        expression,
        matches: true,
      });
    }
  });

  it("matches the combined, incoming request, SQL and database examples", () => {
    const blocks: Array<string> = Array.from(
      section("## Examples").matchAll(/```javascript\n([\s\S]*?)\n```/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(blocks).toHaveLength(4);

    // ({{responseStatusCode}} === 200 || ... 204) && {{responseTimeInMs}} < 1000
    expect(judge(WEBSITE_CHECK, blocks[0] as string)).toBe(true);
    expect(
      judge({ ...WEBSITE_CHECK, responseTimeInMs: 1500 }, blocks[0] as string),
    ).toBe(false);

    // The incoming request the page describes.
    expect(
      judge(
        { requestBody: { status: "degraded", region: "eu" }, requestHeaders: {} },
        blocks[1] as string,
      ),
    ).toBe(true);
    expect(page).toContain('receives `{"status": "degraded", "region": "eu"}`');

    // A high count, or a slow query.
    expect(judge({ scalarValue: 75, executionTimeInMs: 300 }, blocks[2] as string)).toBe(
      true,
    );
    expect(judge({ scalarValue: 10, executionTimeInMs: 300 }, blocks[2] as string)).toBe(
      false,
    );

    // One metric, read by indexing the whole metrics object.
    const metric: string = "oneuptime.monitor.database.connections.used.percent";

    expect(judge({ metrics: { [metric]: 95 } }, blocks[3] as string)).toBe(true);
    expect(judge({ metrics: { [metric]: 40 } }, blocks[3] as string)).toBe(false);
  });

  it("cannot put a dotted series name inside the braces", () => {
    const metric: string = "oneuptime.monitor.database.connections.used.percent";
    const substituted: string = VMUtil.replaceValueInPlace(
      { metrics: { [metric]: 95 } },
      `{{metrics.${metric}}} > 90`,
      false,
    );

    // The path is split at every dot, finds nothing, and is left as written.
    expect(substituted).toBe(`{{metrics.${metric}}} > 90`);
  });
});

describe("the quoting rules", () => {
  it("a string goes in quotes, a number, a boolean and an object bare", () => {
    for (const row of tableRows(section("## Quoting rules"))) {
      const expression: string = codeItems(row[2] as string)[0] as string;
      const check: JSONObject = {
        ...WEBSITE_CHECK,
        responseBody: { status: "ok" },
      };

      expect({ expression, valid: true }).toEqual({
        expression,
        valid: ((): boolean => {
          try {
            new Function(
              `return Boolean(${VMUtil.replaceValueInPlace(check, expression, false)});`,
            );
            return true;
          } catch {
            return false;
          }
        })(),
      });
    }
  });

  it("a quoted placeholder on its own is always true", () => {
    const check: JSONObject = { responseBody: { healthy: false } };

    expect(judge(check, '"{{responseBody.healthy}}"')).toBe(true);
    expect(judge(check, '"{{responseBody.healthy}}" === "true"')).toBe(false);
    expect(judge(check, "{{responseBody.healthy}} === true")).toBe(false);
    expect(page).toContain(
      '`"{{responseBody.healthy}}"` is the non-empty string `"false"` when the field is `false`.',
    );
  });

  it("values are not escaped, so a double quote ends the string early", () => {
    expect(() => {
      return judge(
        { responseBody: { item: 'say "hi"' } },
        '"{{responseBody.item}}" === "hello"',
      );
    }).toThrow(SyntaxError);
  });

  it("a missing path stays as written, which does not run", () => {
    const substituted: string = VMUtil.replaceValueInPlace(
      WEBSITE_CHECK,
      "{{responseBody.missing}} === 1",
      false,
    );

    expect(substituted).toBe("{{responseBody.missing}} === 1");
    expect(() => {
      return judge(WEBSITE_CHECK, "{{responseBody.missing}} === 1");
    }).toThrow(SyntaxError);
  });

  it("an object is written as JSON, ready to be indexed", () => {
    expect(judge(WEBSITE_CHECK, "{{responseHeaders}}['content-type'] !== undefined")).toBe(
      true,
    );
  });
});

describe("the limits", () => {
  it("gives an expression five seconds, and logs an error that does not match", () => {
    const run: string = sourceBetween(
      evaluator,
      "result = await VMUtil.runCodeInSandbox({",
      "});",
    );

    // The evaluator sets no timeout of its own: the runner's default holds.
    expect(run).not.toContain("timeout");
    expect(readRepoFile(VM_RUNNER_FILE)).toContain(
      "const timeout: number = options.timeout || 5000;",
    );
    expect(evaluator).toContain("if (result.scriptError) {\n        logger.error(result.scriptError,");
    expect(section("## Limits")).toContain(
      "An expression has 5 seconds to run. One that takes longer, or throws an error, does not match, and the error is written to the OneUptime server log.",
    );
  });
});
