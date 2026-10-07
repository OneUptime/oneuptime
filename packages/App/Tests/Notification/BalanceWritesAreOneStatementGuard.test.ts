import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * A PROJECT'S PREPAID BALANCES ARE ONLY EVER CHANGED BY ONE STATEMENT THAT
 * ADDS TO WHATEVER THEY ARE NOW.
 *
 * The balance SMS, calls, WhatsApp and Telegram are paid from, and the AI
 * credits, are written by many servers at once: every message sent, every
 * AI call billed, every recharge. A write of a value worked out from an
 * earlier read - "the balance I read, less this cost", "the balance I read,
 * plus this credit" - loses whatever another writer did in between. That is
 * how a recharge used to write over the cost of the messages sent while the
 * card was charged, how the messages of a paging storm all but one went
 * unpaid, and how a card charged twice was credited once.
 *
 * So, in the server code (App's feature sets, Common/Server, and ee/Server
 * when it is there), a balance column may appear in an object literal only
 * to be read (`smsOrCallCurrentBalanceInUSDCents: true`, a select) or as an
 * `add:` of an atomic add (DatabaseService.atomicAddToColumnsByIdWithoutHooks
 * / atomicAddToColumnsByIdAndGetValuesWithoutHooks, behind
 * ProjectService.creditSmsOrCallBalanceInUSDCents,
 * deductSmsOrCallBalanceInUSDCents and AIBillingService's credit). A master
 * admin's "Set" (ProjectService.adjustBalance) names its column through a
 * computed key and is the one absolute write, on purpose.
 */

const REPO: string = path.resolve(__dirname, "../../../..");

const BALANCE_COLUMNS: Array<string> = [
  "smsOrCallCurrentBalanceInUSDCents",
  "aiCurrentBalanceInUSDCents",
];

const SCANNED: Array<string> = [
  path.join(REPO, "packages/App/FeatureSet"),
  path.join(REPO, "packages/Common/Server"),
  // Core CI runs without ee/; the Enterprise Edition workflow scans it too.
  path.join(REPO, "ee/Server"),
];

const SKIPPED_DIRECTORIES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "SchemaMigrations",
]);

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.(ts|tsx)$/;

function listSourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(full);
    }
  }

  return found;
}

interface BalanceWrite {
  file: string;
  line: number;
  column: string;
  text: string;
}

function propertyNameOf(node: ts.PropertyAssignment): string | null {
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
    return node.name.text;
  }

  return null;
}

// Whether an object literal is the value of an `add:` property.
function isAtomicAdd(objectLiteral: ts.Node): boolean {
  const parent: ts.Node | undefined = objectLiteral.parent;

  return Boolean(
    parent &&
      ts.isPropertyAssignment(parent) &&
      propertyNameOf(parent) === "add",
  );
}

function findBalanceWrites(file: string): Array<BalanceWrite> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const writes: Array<BalanceWrite> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const name: string | null = propertyNameOf(node);

      if (
        name &&
        BALANCE_COLUMNS.includes(name) &&
        node.initializer.kind !== ts.SyntaxKind.TrueKeyword &&
        !isAtomicAdd(node.parent)
      ) {
        writes.push({
          file: path.relative(REPO, file),
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          column: name,
          text: node.getText(source),
        });
      }
    }

    if (ts.isShorthandPropertyAssignment(node)) {
      const name: string = node.name.text;

      if (BALANCE_COLUMNS.includes(name) && !isAtomicAdd(node.parent)) {
        writes.push({
          file: path.relative(REPO, file),
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          column: name,
          text: node.getText(source),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return writes;
}

describe("prepaid balances are changed only by one statement that adds", () => {
  const files: Array<string> = SCANNED.flatMap((directory: string) => {
    return listSourceFiles(directory);
  });

  test("the scan reads the senders, the recharges and the project service", () => {
    const names: Array<string> = files.map((file: string) => {
      return path.basename(file);
    });

    for (const expected of [
      "SmsService.ts",
      "CallService.ts",
      "WhatsAppService.ts",
      "TelegramService.ts",
      "NotificationService.ts",
      "AIBillingService.ts",
      "ProjectService.ts",
      "MessagingBalance.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("no server code writes a balance it worked out itself", () => {
    const writes: Array<BalanceWrite> = files.flatMap((file: string) => {
      return findBalanceWrites(file);
    });

    expect(
      writes.map((write: BalanceWrite) => {
        return `${write.file}:${write.line} ${write.text}`;
      }),
    ).toEqual([]);
  });

  test("the reader catches the old shapes: a balance written back in an update's data, or set outright", () => {
    const sample: string = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "balance-guard-")),
      "Sample.ts",
    );

    fs.writeFileSync(
      sample,
      `
      async function oldSmsSend(project: any): Promise<void> {
        project.smsOrCallCurrentBalanceInUSDCents = project.smsOrCallCurrentBalanceInUSDCents - 7;
        await ProjectService.updateOneById({
          id: project.id,
          data: {
            smsOrCallCurrentBalanceInUSDCents: project.smsOrCallCurrentBalanceInUSDCents,
          },
        });
      }
      async function oldRecharge(updatedAmount: number): Promise<void> {
        await ProjectService.atomicAddToColumnsByIdWithoutHooks({
          id: x,
          add: {},
          set: { aiCurrentBalanceInUSDCents: updatedAmount },
        });
      }
      async function shorthand(smsOrCallCurrentBalanceInUSDCents: number): Promise<void> {
        await ProjectService.updateOneById({ id: x, data: { smsOrCallCurrentBalanceInUSDCents } });
      }
      async function allowed(): Promise<void> {
        await ProjectService.findOneById({ id: x, select: { smsOrCallCurrentBalanceInUSDCents: true } });
        await ProjectService.atomicAddToColumnsByIdWithoutHooks({ id: x, add: { aiCurrentBalanceInUSDCents: 2000 } });
      }
      `,
    );

    expect(
      findBalanceWrites(sample).map((write: BalanceWrite) => {
        return write.column;
      }),
    ).toEqual([
      "smsOrCallCurrentBalanceInUSDCents",
      "aiCurrentBalanceInUSDCents",
      "smsOrCallCurrentBalanceInUSDCents",
    ]);
  });
});
