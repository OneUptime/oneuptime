import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import Path from "path";
import ts from "typescript";

/*
 * THE NOTIFICATION SERVICE CARRIES STATUS PAGE LOGOS FROM THE START.
 *
 * MailService reads a status page's logo, to carry it inside an email in
 * place of its address, through a reader it is handed when the
 * notification service starts (MailService.carryStatusPageLogosWith): the
 * read needs the database, which MailService itself never imports, so the
 * tests that send through it stay free of one. Without that one call, every
 * status page email would quietly keep loading its logo from the address -
 * as every MailService test that registers no reader does on purpose. So
 * the call is held here, where the service starts: in
 * NotificationFeatureSet's init, handing StatusPageCarriedLogo.readAddress
 * the address.
 */

const NOTIFICATION_INDEX: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Index.ts",
);

const source: ts.SourceFile = ts.createSourceFile(
  NOTIFICATION_INDEX,
  fs.readFileSync(NOTIFICATION_INDEX, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

// Every call of `callee` (as written) inside `node`.
const callsOf: (node: ts.Node, callee: string) => Array<ts.CallExpression> = (
  node: ts.Node,
  callee: string,
): Array<ts.CallExpression> => {
  const calls: Array<ts.CallExpression> = [];

  const visit: (child: ts.Node) => void = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      child.expression.getText(source) === callee
    ) {
      calls.push(child);
    }

    ts.forEachChild(child, visit);
  };

  visit(node);

  return calls;
};

// The function NotificationFeatureSet's init property holds.
const findInit: () => ts.Node | null = (): ts.Node | null => {
  let init: ts.Node | null = null;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "init" &&
      ts.isVariableDeclaration(node.parent.parent) &&
      node.parent.parent.name.getText(source) === "NotificationFeatureSet"
    ) {
      init = node.initializer;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return init;
};

describe("the notification service, when it starts", () => {
  test("hands MailService the status page logo reader, once", () => {
    const init: ts.Node | null = findInit();

    expect(init).not.toBeNull();

    const registrations: Array<ts.CallExpression> = callsOf(
      init!,
      "MailService.carryStatusPageLogosWith",
    );

    expect(registrations).toHaveLength(1);

    // The reader it hands over reads the address it is given.
    const reader: ts.Expression | undefined = registrations[0]!.arguments[0];

    expect(reader && ts.isArrowFunction(reader)).toBe(true);

    const reads: Array<ts.CallExpression> = callsOf(
      reader!,
      "StatusPageCarriedLogo.readAddress",
    );

    expect(reads).toHaveLength(1);
    expect(
      reads[0]!.arguments.map((argument: ts.Expression): string => {
        return argument.getText(source);
      }),
    ).toEqual([(reader as ts.ArrowFunction).parameters[0]!.name.getText(source)]);
  });

  test("before any route is mounted, so no email goes out without it", () => {
    const init: ts.Node = findInit()!;
    const registration: ts.CallExpression = callsOf(
      init,
      "MailService.carryStatusPageLogosWith",
    )[0]!;
    const firstMount: ts.CallExpression | undefined = callsOf(
      init,
      "app.use",
    )[0];

    expect(firstMount).toBeDefined();
    expect(registration.getStart(source)).toBeLessThan(
      firstMount!.getStart(source),
    );
  });
});
