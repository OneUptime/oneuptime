import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY CARD A TOOL LEAVES IS WORDED IN THE READER'S LANGUAGE (#5623's
 * follow-up, and issue #7175).
 *
 * The card a tool leaves under the answer said what it made, or what it
 * read, in the server's English. A write tool's card is built with
 * WidgetBuilder.actionCard, and a read tool's with
 * WidgetBuilder.resourceCard, both from words of Types/AI/AIActionWords
 * that the Dashboard says in the reader's language - their English derived
 * from the same words. So:
 *
 *   - a read's card is built only where a read tool's is listed below, and
 *     those are counted, so a new card in one of them is decided too;
 *   - every read's card is handed its words from one of ReadCardWords'
 *     builders, and none of the English a card took before (resourceType,
 *     subheading, fields): a monitor, an SLO, a team, an on-call policy or
 *     schedule, a status page, a runbook, a workflow and a security case
 *     read in German say so in German;
 *   - every write tool file that leaves a card builds it with actionCard,
 *     and hands it words.
 */

const TOOLBOX_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../Server/Utils/AI/Toolbox",
);

// The read tools' cards, by file: each worded by ReadCardWords.
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
  // Ask AI's setup actions (#6829): a monitor, a policy, a status page.
  "SetupTools.ts",
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
  // The function its words property calls, when it calls one by name.
  wordsBuilder: string | null;
}

// The name of the function a property's value calls: getMonitorCardWords(...).
function calledFunction(
  property: ts.ObjectLiteralElementLike | undefined,
): string | null {
  if (
    !property ||
    !ts.isPropertyAssignment(property) ||
    !ts.isCallExpression(property.initializer) ||
    !ts.isIdentifier(property.initializer.expression)
  ) {
    return null;
  }

  return property.initializer.expression.text;
}

// The names a file imports from a module of its own folder.
function importedFrom(file: string, moduleName: string): Array<string> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(TOOLBOX_DIRECTORY, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names: Array<string> = [];

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        names.push(element.name.text);
      }
    }
  }

  return names;
}

// The builders a read's card takes its words from.
const READ_CARD_WORDS_BUILDER: RegExp = /^get[A-Z][A-Za-z]*CardWords$/;

// What a card took as free English before it had words.
const ENGLISH_CARD_PROPERTIES: Array<string> = [
  "resourceType",
  "subheading",
  "fields",
];

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

      const properties: Array<ts.ObjectLiteralElementLike> =
        argument && ts.isObjectLiteralExpression(argument)
          ? [...argument.properties]
          : [];

      calls.push({
        method: node.expression.name.text,
        properties: properties.map((property: ts.ObjectLiteralElementLike) => {
          return property.name && ts.isIdentifier(property.name)
            ? property.name.text
            : "";
        }),
        wordsBuilder: calledFunction(
          properties.find((property: ts.ObjectLiteralElementLike): boolean => {
            return Boolean(
              property.name &&
                ts.isIdentifier(property.name) &&
                property.name.text === "words",
            );
          }),
        ),
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
    "%s builds a read's card only where a read tool's is listed",
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

  /*
   * Issue #7175: a read's card said "MONITOR", "Type: Website", "Last
   * status", "Off - not checked" in English on a German page.
   */
  test.each(
    Object.keys(READ_TOOL_RESOURCE_CARDS).map((file: string): [string] => {
      return [file];
    }),
  )(
    "%s hands every read's card its words from ReadCardWords, and no English",
    (file: string) => {
      const resourceCards: Array<BuilderCall> = builderCalls(file).filter(
        (call: BuilderCall): boolean => {
          return call.method === "resourceCard";
        },
      );
      const builders: Array<string> = importedFrom(file, "./ReadCardWords");

      expect(resourceCards.length).toBe(READ_TOOL_RESOURCE_CARDS[file]);

      for (const call of resourceCards) {
        expect(call.properties).toEqual(
          expect.arrayContaining(["title", "heading", "words"]),
        );
        expect(
          call.properties.filter((name: string): boolean => {
            return ENGLISH_CARD_PROPERTIES.includes(name);
          }),
        ).toEqual([]);
        expect(call.wordsBuilder).toMatch(READ_CARD_WORDS_BUILDER);
        expect(builders).toContain(call.wordsBuilder);
      }
    },
  );

  test("WidgetBuilder.resourceCard takes words, and none of the English a card took before", () => {
    const source: string = fs.readFileSync(
      path.join(TOOLBOX_DIRECTORY, "WidgetBuilder.ts"),
      "utf8",
    );
    const signature: string = source.slice(
      source.indexOf("public static resourceCard("),
      source.indexOf(
        "}): AIChatWidget",
        source.indexOf("public static resourceCard("),
      ),
    );

    expect(signature).toContain("words: AIActionCardWords;");

    for (const name of ENGLISH_CARD_PROPERTIES) {
      expect(signature).not.toContain(`${name}:`);
      expect(signature).not.toContain(`${name}?:`);
    }
  });

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
