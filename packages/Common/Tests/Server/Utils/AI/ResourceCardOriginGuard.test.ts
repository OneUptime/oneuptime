import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY CARD SAYS WHICH KIND OF TOOL LEFT IT, TRULY (issue #6968).
 *
 * The Dashboard draws a write's card as done - green, with a check - and a
 * read's plain: a monitor looked up while it is Offline was not done well.
 * Which it is comes from the builder: WidgetBuilder.resourceCard leaves a
 * read's card, WidgetBuilder.actionCard a write's. So:
 *
 *   - every resourceCard call is in a read tool (one that is not a
 *     mutation), or in a helper only read tools call;
 *   - every actionCard call is in a write tool (isMutation: true), or in a
 *     helper only write tools call.
 *
 * Read as real syntax, so a card built in a new tool - or a new helper -
 * is held to the same rule.
 */

const TOOLBOX_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../Server/Utils/AI/Toolbox",
);

interface ToolOfCall {
  name: string;
  isMutation: boolean;
}

interface CardCall {
  file: string;
  line: number;
  method: "resourceCard" | "actionCard";
  // The function it is built in, when that is not a tool's own code.
  helper: string | null;
  // The tools the card is left by: its own, or the callers of its helper.
  tools: Array<ToolOfCall>;
}

function toolboxFiles(): Array<string> {
  return fs
    .readdirSync(TOOLBOX_DIRECTORY)
    .filter((name: string): boolean => {
      return name.endsWith(".ts") && name !== "WidgetBuilder.ts";
    })
    .sort();
}

function propertyNamed(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return literal.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return Boolean(
        property.name &&
          ts.isIdentifier(property.name) &&
          property.name.text === name,
      );
    },
  );
}

// The tool definition a node is written in: { name: "...", execute, ... }.
function toolAround(node: ts.Node): ToolOfCall | null {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (!ts.isObjectLiteralExpression(current)) {
      continue;
    }

    const name: ts.ObjectLiteralElementLike | undefined = propertyNamed(
      current,
      "name",
    );

    if (
      !name ||
      !ts.isPropertyAssignment(name) ||
      !ts.isStringLiteral(name.initializer) ||
      !propertyNamed(current, "execute")
    ) {
      continue;
    }

    const isMutation: ts.ObjectLiteralElementLike | undefined = propertyNamed(
      current,
      "isMutation",
    );

    return {
      name: name.initializer.text,
      isMutation: Boolean(
        isMutation &&
          ts.isPropertyAssignment(isMutation) &&
          isMutation.initializer.kind === ts.SyntaxKind.TrueKeyword,
      ),
    };
  }

  return null;
}

// The function declaration a node is written in, by its name.
function functionAround(node: ts.Node): string | null {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }
  }

  return null;
}

// The tools that call a helper of the file, through other helpers too.
function toolsCalling(
  source: ts.SourceFile,
  helper: string,
  seen: Set<string> = new Set(),
): Array<ToolOfCall> {
  if (seen.has(helper)) {
    return [];
  }
  seen.add(helper);

  const tools: Array<ToolOfCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === helper
    ) {
      const tool: ToolOfCall | null = toolAround(node);

      if (tool) {
        tools.push(tool);
      } else {
        const caller: string | null = functionAround(node);
        if (caller) {
          tools.push(...toolsCalling(source, caller, seen));
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return tools;
}

function cardCalls(file: string): Array<CardCall> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(TOOLBOX_DIRECTORY, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const calls: Array<CardCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "WidgetBuilder" &&
      (node.expression.name.text === "resourceCard" ||
        node.expression.name.text === "actionCard")
    ) {
      const tool: ToolOfCall | null = toolAround(node);
      const helper: string | null = tool ? null : functionAround(node);

      calls.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        method: node.expression.name.text,
        helper,
        tools: tool ? [tool] : helper ? toolsCalling(source, helper) : [],
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
}

const CALLS: Array<CardCall> = toolboxFiles().flatMap(
  (file: string): Array<CardCall> => {
    return cardCalls(file);
  },
);

function callsOf(method: CardCall["method"]): Array<CardCall> {
  return CALLS.filter((call: CardCall): boolean => {
    return call.method === method;
  });
}

describe("which kind of tool leaves each card (#6968)", () => {
  test("there are cards of both kinds to read", () => {
    expect(callsOf("resourceCard").length).toBeGreaterThanOrEqual(9);
    expect(callsOf("actionCard").length).toBeGreaterThanOrEqual(15);
  });

  test("each card is left by a tool the guard can name: its own, or its helper's callers", () => {
    for (const call of CALLS) {
      expect({ ...call, found: call.tools.length > 0 }).toEqual({
        ...call,
        found: true,
      });
    }
  });

  test("a read's card (resourceCard) is left only by tools that read", () => {
    for (const call of callsOf("resourceCard")) {
      for (const tool of call.tools) {
        expect({ at: `${call.file}:${call.line}`, ...tool }).toEqual({
          at: `${call.file}:${call.line}`,
          name: tool.name,
          isMutation: false,
        });
      }
    }
  });

  test("a write's card (actionCard) is left only by tools that write", () => {
    for (const call of callsOf("actionCard")) {
      for (const tool of call.tools) {
        expect({ at: `${call.file}:${call.line}`, ...tool }).toEqual({
          at: `${call.file}:${call.line}`,
          name: tool.name,
          isMutation: true,
        });
      }
    }
  });

  test("the monitor a person asks about is a read's card: query_monitors", () => {
    expect(
      callsOf("resourceCard")
        .filter((call: CardCall): boolean => {
          return call.file === "MonitorTools.ts";
        })
        .flatMap((call: CardCall): Array<string> => {
          return call.tools.map((tool: ToolOfCall): string => {
            return tool.name;
          });
        }),
    ).toEqual(["query_monitors"]);
  });

  test("a card built in a helper is held by its callers: a security case read, an alert or incident moved on", () => {
    const viaHelpers: Array<[string, string, string, Array<string>]> =
      CALLS.filter((call: CardCall): boolean => {
        return call.helper !== null;
      }).map((call: CardCall): [string, string, string, Array<string>] => {
        return [
          call.file,
          call.helper!,
          call.method,
          call.tools
            .map((tool: ToolOfCall): string => {
              return tool.name;
            })
            .sort(),
        ];
      });

    expect(viaHelpers).toEqual(
      expect.arrayContaining([
        [
          "SecurityCaseTools.ts",
          "readOneCase",
          "resourceCard",
          ["query_security_cases"],
        ],
        [
          "AlertWriteTools.ts",
          "changeAlertStateTool",
          "actionCard",
          ["acknowledge_alert", "resolve_alert"],
        ],
        [
          "IncidentWriteTools.ts",
          "changeIncidentStateTool",
          "actionCard",
          ["acknowledge_incident", "resolve_incident"],
        ],
      ]),
    );
  });
});
