import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY SIGN-IN CODE IS COUNTED FOR THE ACCOUNT BEFORE IT IS CHECKED.
 *
 * Wrong second-step codes are counted per account once the password is
 * right (Server/Utils/TwoFactorWrongCodes): after five in a row each next
 * code waits, wherever it comes from, and is not checked while it waits. A
 * code checked anywhere else - a new route, a second sign-in path, a branch
 * that checks before it counts - would hand back what the count holds, so
 * this guard reads the product code for every place a code is checked:
 *
 *  - every file that checks an authenticator code (TotpAuth.verifyToken) or
 *    spends a backup code (.consumeCode) is listed below, with why;
 *  - in the sign-in handler, the authenticator branch and the backup code
 *    branch each count with startCheck - for their own kind of code - and
 *    refuse unless it allows, before the code is looked at;
 *  - the count is moved only after the password was checked, and forgotten
 *    only once a second step has passed.
 *
 * Read from the code with its comments removed, across all product code
 * (ee/ too, when it is checked out). How the count behaves is
 * TwoFactorWrongCodes.test.ts, TwoFactorWrongCodesValkey.test.ts and, through
 * the routes, App's TwoFactorWrongCodesSignIn.test.ts.
 */

const SIGN_IN: string = "packages/App/FeatureSet/Identity/API/Authentication.ts";

// Every product file that checks an authenticator app's code, and why.
const CHECKS_AN_AUTHENTICATOR_CODE: Record<string, string> = {
  [SIGN_IN]:
    "signing in: the second step's code, counted for the account first; and the code of a first enrolment, read off the QR code this password holder was just shown",
  "packages/Common/Server/API/UserTotpAuthAPI.ts":
    "a signed-in user confirming an authenticator app they are adding, from the QR code they were just shown",
};

// Every product file that spends a backup code, and why.
const SPENDS_A_BACKUP_CODE: Record<string, string> = {
  [SIGN_IN]:
    "signing in with a backup code, counted for the account first on a count of its own",
};

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;
const VERIFIES_A_TOTP_CODE: RegExp = /\bTotpAuth\.verifyToken\s*\(/;
const SPENDS_A_BACKUP_CODE_CALL: RegExp = /\.consumeCode\s*\(/;
const MOVES_THE_COUNT: RegExp = /\bTwoFactorWrongCodes\.startCheck\s*\(/;

// What follows the refusal test: its block, which answers and returns at once.
const REFUSES_AT_ONCE: RegExp = /^[^{]*\{\s*return sendCodeNotChecked\(/;

function sourceOf(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8");
}

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    sourceOf(relativePath),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

const printer: ts.Printer = ts.createPrinter({ removeComments: true });

// A node's code, its comments removed by TypeScript's own printer.
function codeOfNode(node: ts.Node, sourceFile: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
}

function codeOf(relativePath: string): string {
  return printer.printFile(parse(relativePath));
}

// Product files whose raw text matches (a cheap first pass), then whose code does.
function productFilesWhoseCodeMatches(pattern: RegExp): Array<string> {
  return listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"])
    .filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    })
    .filter((relativePath: string): boolean => {
      return pattern.test(sourceOf(relativePath));
    })
    .filter((relativePath: string): boolean => {
      return pattern.test(codeOf(relativePath));
    });
}

// Every node of a file, depth first.
function nodesOf(sourceFile: ts.SourceFile): Array<ts.Node> {
  const nodes: Array<ts.Node> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return nodes;
}

// The `if (<name>) { ... }` statements of a file, by the name they test.
function ifStatementsTesting(
  sourceFile: ts.SourceFile,
  name: string,
): Array<ts.IfStatement> {
  return nodesOf(sourceFile).filter((node: ts.Node): node is ts.IfStatement => {
    return (
      ts.isIfStatement(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    );
  });
}

// The code of the one block that runs when `name` is true.
function branchTesting(sourceFile: ts.SourceFile, name: string): string {
  const branches: Array<ts.IfStatement> = ifStatementsTesting(
    sourceFile,
    name,
  );

  expect([name, branches.length]).toEqual([name, 1]);

  return codeOfNode(branches[0]!.thenStatement, sourceFile);
}

// Where `text` first appears in `code`; -1 when it does not.
function at(code: string, text: string): number {
  return code.indexOf(text);
}

describe("every place a sign-in code is checked is known", () => {
  test("authenticator codes are checked only where listed", () => {
    expect(productFilesWhoseCodeMatches(VERIFIES_A_TOTP_CODE)).toEqual(
      Object.keys(CHECKS_AN_AUTHENTICATOR_CODE).sort(),
    );
  });

  test("backup codes are spent only where listed", () => {
    expect(productFilesWhoseCodeMatches(SPENDS_A_BACKUP_CODE_CALL)).toEqual(
      Object.keys(SPENDS_A_BACKUP_CODE).sort(),
    );
  });

  test("the sign-in handler checks an authenticator code in two places: the second step, and a first enrolment", () => {
    const code: string = codeOf(SIGN_IN);

    expect(code.split("TotpAuth.verifyToken(").length - 1).toBe(2);
    expect(code.split(".consumeCode(").length - 1).toBe(1);
  });

  test("only the sign-in handler moves the count", () => {
    expect(productFilesWhoseCodeMatches(MOVES_THE_COUNT)).toEqual([SIGN_IN]);
  });
});

describe("in the sign-in handler, a code is counted before it is checked", () => {
  const sourceFile: ts.SourceFile = parse(SIGN_IN);

  test("the authenticator branch counts an authenticator code, and refuses unless allowed, before it looks the app up or checks the code", () => {
    const branch: string = branchTesting(sourceFile, "verifyTotpAuth");

    const count: number = at(branch, "TwoFactorWrongCodes.startCheck(");
    const refuse: number = at(
      branch,
      "outcome !== TwoFactorCodeCheckOutcome.Allowed",
    );

    expect(count).toBeGreaterThan(-1);
    expect(branch.slice(count, refuse)).toContain(
      "kind: TwoFactorCodeKind.AuthenticatorCode",
    );
    expect(refuse).toBeGreaterThan(count);
    expect(branch.slice(refuse)).toMatch(REFUSES_AT_ONCE);
    expect(at(branch, "UserTotpAuthService.findOneBy(")).toBeGreaterThan(
      refuse,
    );
    expect(at(branch, "TotpAuth.verifyToken(")).toBeGreaterThan(refuse);
  });

  test("the backup code branch counts a backup code, and refuses unless allowed, before it spends one", () => {
    const branch: string = branchTesting(sourceFile, "verifyBackupCode");

    const count: number = at(branch, "TwoFactorWrongCodes.startCheck(");
    const refuse: number = at(
      branch,
      "outcome !== TwoFactorCodeCheckOutcome.Allowed",
    );

    expect(count).toBeGreaterThan(-1);
    expect(branch.slice(count, refuse)).toContain(
      "kind: TwoFactorCodeKind.BackupCode",
    );
    expect(refuse).toBeGreaterThan(count);
    expect(branch.slice(refuse)).toMatch(REFUSES_AT_ONCE);
    expect(at(branch, ".consumeCode(")).toBeGreaterThan(refuse);
  });

  test("a wrong code is reported to the owner's count in both branches", () => {
    for (const name of ["verifyTotpAuth", "verifyBackupCode"]) {
      expect([
        name,
        branchTesting(sourceFile, name).includes("tellOwnerAboutWrongCode("),
      ]).toEqual([name, true]);
    }
  });

  test("the count is moved only after the password was checked", () => {
    const code: string = codeOf(SIGN_IN);

    const passwordChecked: number = at(code, "if (!isPasswordValid)");
    const firstCount: number = at(code, "TwoFactorWrongCodes.startCheck(");

    expect(passwordChecked).toBeGreaterThan(-1);
    expect(firstCount).toBeGreaterThan(passwordChecked);
    expect(at(code, "UserService.verifyHashedColumnValue(")).toBeLessThan(
      passwordChecked,
    );
  });

  test("the wrong codes are forgotten once, as the last step of a second step that passed", () => {
    const code: string = codeOf(SIGN_IN);

    expect(code.split("TwoFactorWrongCodes.forget(").length - 1).toBe(1);

    const secondSteps: Array<ts.IfStatement> = ifStatementsTesting(
      sourceFile,
      "isSecondStep",
    ).filter((statement: ts.IfStatement): boolean => {
      return codeOfNode(statement.thenStatement, sourceFile).includes(
        "TwoFactorWrongCodes.forget(",
      );
    });

    expect(secondSteps).toHaveLength(1);

    const block: ts.Statement = secondSteps[0]!.thenStatement;

    expect(ts.isBlock(block)).toBe(true);

    const statements: ts.NodeArray<ts.Statement> = (block as ts.Block)
      .statements;

    expect(codeOfNode(statements[statements.length - 1]!, sourceFile)).toBe(
      "await TwoFactorWrongCodes.forget(alreadySavedUser.id!);",
    );
    expect(
      codeOfNode(statements[0]!, sourceFile).startsWith("if (verifyTotpAuth)"),
    ).toBe(true);
  });

  test("a security key and a first enrolment are neither counted nor held", () => {
    for (const name of ["verifyWebAuthn", "verifyTotpEnrolment"]) {
      expect([
        name,
        branchTesting(sourceFile, name).includes("TwoFactorWrongCodes."),
      ]).toEqual([name, false]);
    }
  });
});

describe("the guard's own reading", () => {
  test("sees a code checked however the call is spaced, and not in a comment", () => {
    expect(VERIFIES_A_TOTP_CODE.test("TotpAuth.verifyToken ({")).toBe(true);
    expect(SPENDS_A_BACKUP_CODE_CALL.test("service.consumeCode({")).toBe(true);
    expect(MOVES_THE_COUNT.test("TwoFactorWrongCodes.startCheck ({")).toBe(
      true,
    );
    expect(
      VERIFIES_A_TOTP_CODE.test(
        printer.printFile(
          ts.createSourceFile(
            "x.ts",
            "// TotpAuth.verifyToken(x)\nconst a: number = 1;",
            ts.ScriptTarget.Latest,
            true,
          ),
        ),
      ),
    ).toBe(false);
    expect(
      REFUSES_AT_ONCE.test(
        ") {\n    return sendCodeNotChecked({ req, res, kind, check });",
      ),
    ).toBe(true);
    expect(
      REFUSES_AT_ONCE.test(") {\n    logger.info(x);\n    return sendCodeNotChecked({",),
    ).toBe(false);
  });

  test("finds the branch an if statement runs, and only that one", () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "x.ts",
      "if (a) { one(); } else if (b) { two(); } else { three(); }",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(branchTesting(sourceFile, "a")).toContain("one()");
    expect(branchTesting(sourceFile, "a")).not.toContain("two()");
    expect(branchTesting(sourceFile, "b")).toContain("two()");
    expect(branchTesting(sourceFile, "b")).not.toContain("three()");
  });
});
