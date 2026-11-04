import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY CARD A WRITE LEAVES IS WORDED IN THE READER'S LANGUAGE (#5623's
 * follow-up).
 *
 * The card an action leaves under the answer said what it made in the
 * server's English. A write tool's card is built with
 * WidgetBuilder.actionCard now, from words of Types/AI/AIActionWords that
 * the Dashboard says in the reader's language - its English derived from
 * the same words. So:
 *
 *   - no file that defines a write tool builds a card with
 *     WidgetBuilder.resourceCard, which takes free English, except the read
 *     tools listed below - and those are counted, so a new card in one of
 *     them is decided too;
 *   - every write tool file that leaves a card builds it with actionCard,
 *     and hands it words.
 *
 * The read tools' cards (a monitor, an SLO, an on-call policy read) are
 * still the server's English: a follow-up, held here so their number only
 * shrinks.
 */

const TOOLBOX_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../Server/Utils/AI/Toolbox",
);

// The read tools' cards, by file: English still, and only ever fewer.
const READ_TOOL_RESOURCE_CARDS: Record<string, number> = {
  "MonitorTools.ts": 1,
  "OnCallTools.ts": 2,
  "RunbookTools.ts": 1,
  "SecurityCaseTools.ts": 1,
  "SloTools.ts": 1,
  "StatusPageTools.ts": 1,
  "TeamTools.ts": 1,
  "WorkflowProbeTools.ts": 1,
};

// The files that define write tools and leave a card.
const WRITE_TOOL_FILES: Array<string> = [
  "AIActionTools.ts",
  "AIMetaTools.ts",
  "AlertWriteTools.ts",
  "IncidentWriteTools.ts",
  "NoteWriteTools.ts",
  "SecurityCaseTools.ts",
];

function toolboxFiles(): Array<string> {
  return fs
    .readdirSync(TOOLBOX_DIRECTORY)
    .filter((name: string): boolean => {
      return name.endsWith(".ts") && name !== "WidgetBuilder.ts";
    })
    .sort();
}

interface BuilderCall {
  method: string;
  // The names of the object literal's properties the call is handed.
  properties: Array<string>;
}

// Every WidgetBuilder.<method>(...) call of a file, read as real syntax.
function builderCalls(file: string): Array<BuilderCall> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(TOOLBOX_DIRECTORY, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const calls: Array<BuilderCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "WidgetBuilder"
    ) {
      const argument: ts.Expression | undefined = node.arguments[0];

      calls.push({
        method: node.expression.name.text,
        properties:
          argument && ts.isObjectLiteralExpression(argument)
            ? argument.properties.map(
                (property: ts.ObjectLiteralElementLike) => {
                  return property.name && ts.isIdentifier(property.name)
                    ? property.name.text
                    : "";
                },
              )
            : [],
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
}

describe("the cards the toolbox builds", () => {
  test("there are files to read", () => {
    expect(toolboxFiles().length).toBeGreaterThan(20);

    for (const file of [
      ...WRITE_TOOL_FILES,
      ...Object.keys(READ_TOOL_RESOURCE_CARDS),
    ]) {
      expect(toolboxFiles()).toContain(file);
    }
  });

  test.each(
    toolboxFiles().map((file: string): [string] => {
      return [file];
    }),
  )(
    "%s builds a card of free English only where a read tool's is listed",
    (file: string) => {
      const resourceCards: number = builderCalls(file).filter(
        (call: BuilderCall): boolean => {
          return call.method === "resourceCard";
        },
      ).length;

      expect({ file, resourceCards }).toEqual({
        file,
        resourceCards: READ_TOOL_RESOURCE_CARDS[file] ?? 0,
      });
    },
  );

  test.each(
    WRITE_TOOL_FILES.map((file: string): [string] => {
      return [file];
    }),
  )(
    "%s leaves its cards as action cards, each with its words",
    (file: string) => {
      const actionCards: Array<BuilderCall> = builderCalls(file).filter(
        (call: BuilderCall): boolean => {
          return call.method === "actionCard";
        },
      );

      expect(actionCards.length).toBeGreaterThan(0);

      for (const call of actionCards) {
        expect(call.properties).toEqual(
          expect.arrayContaining(["title", "heading", "words"]),
        );
      }
    },
  );

  test("the write tools' files leave no card of free English", () => {
    for (const file of WRITE_TOOL_FILES) {
      const resourceCards: number = builderCalls(file).filter(
        (call: BuilderCall): boolean => {
          return call.method === "resourceCard";
        },
      ).length;

      // SecurityCaseTools.ts holds a read tool too: its one card is that read's.
      expect({ file, resourceCards }).toEqual({
        file,
        resourceCards: file === "SecurityCaseTools.ts" ? 1 : 0,
      });
    }
  });
});
