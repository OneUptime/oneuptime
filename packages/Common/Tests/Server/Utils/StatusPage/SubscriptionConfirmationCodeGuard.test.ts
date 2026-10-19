import { listProductFiles } from "../../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A CODE THAT CONFIRMS A SUBSCRIPTION IS MINTED IN ONE PLACE AND COMPARED IN
 * ONE PLACE.
 *
 * Opening a status page subscription's confirmation link is the whole of
 * what proves the contact asked for it: the link's code is its only secret,
 * since the subscriber id is no secret. What keeps the code safe lives in
 * two places, and only holds while nothing goes around them:
 *
 *   - StatusPageSubscriberConfirmationCode.generate mints every code, 32
 *     random hex characters (onBeforeCreate);
 *   - StatusPageSubscriberService.confirmSubscription compares a link's code
 *     with the subscription's, through StatusPageSubscriberConfirmationCode
 *     .matches, and it is there that a link more than a day old is refused
 *     and that a six-digit code from before is given up once a wrong code
 *     is tried for its subscription.
 *
 * A lookup of a subscription by its code (a query or a where naming the
 * column) would confirm by a link that has expired, or take a short code
 * more than once. So these hold the product's code to that: every product
 * file whose code names the column is listed with what it does with it, no
 * product code looks a subscription up by its code, and the code is
 * compared, and minted, where it is. Read with TypeScript's parser, so a
 * word in a comment is never taken for code.
 */

const COLUMN: string = "subscriptionConfirmationToken";

const SERVICE: string =
  "packages/Common/Server/Services/StatusPageSubscriberService.ts";

// A TypeScript or JavaScript source file.
const CODE_FILE: RegExp = /\.(?:ts|tsx|js)$/;

/*
 * Every product file whose code names the column, and what it does with it.
 */
const COLUMN_NAMERS: Record<string, string> = {
  "packages/Common/Models/DatabaseModels/StatusPageSubscriber.ts":
    "declares the column: nobody may read it or change it (read: [], update: [])",
  [SERVICE]:
    "mints the code with the subscription (StatusPageSubscriberConfirmationCode.generate), reads it to send the link, takes it off what a create hands back, compares it in confirmSubscription and clears a six-digit one a wrong code was tried for",
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1734435866602-MigrationName.ts":
    "the migration that added the column",
  "packages/App/FeatureSet/Workers/DataMigrations/AddIsSubscriptionConfirmedToSubscribers.ts":
    "a data migration that ran once, when the column came, and marked every subscriber of then confirmed: a confirmed subscription's code confirms nothing, and every link it could carry is long past its day",
};

interface ColumnUse {
  // The node naming the column.
  node: ts.Node;
  // Names of the properties the node sits under, nearest first.
  enclosingProperties: Array<string>;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function propertyNameOf(node: ts.Node): string | null {
  if (
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }

  return null;
}

// Where the code of `file` names the column: as a name, or in a string.
function columnUsesIn(file: string): Array<ColumnUse> {
  const uses: Array<ColumnUse> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const names: boolean =
      (ts.isIdentifier(node) && node.text === COLUMN) ||
      ((ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
        node.text.includes(COLUMN));

    if (names) {
      const enclosingProperties: Array<string> = [];
      let parent: ts.Node | undefined = node.parent;

      while (parent) {
        const name: string | null = propertyNameOf(parent);

        if (name !== null) {
          enclosingProperties.push(name);
        }

        parent = parent.parent;
      }

      uses.push({ node: node, enclosingProperties: enclosingProperties });
    }

    ts.forEachChild(node, visit);
  };

  visit(parse(file));

  return uses;
}

const namers: Array<string> = listProductFiles().filter(
  (file: string): boolean => {
    return (
      CODE_FILE.test(file) &&
      fs
        .readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8")
        .includes(COLUMN) &&
      columnUsesIn(file).length > 0
    );
  },
);

describe("the code that confirms a subscription", () => {
  test("the scan reads the files it is about", () => {
    expect(namers).toEqual(
      expect.arrayContaining([
        SERVICE,
        "packages/Common/Models/DatabaseModels/StatusPageSubscriber.ts",
      ]),
    );
  });

  test("only the listed files name its column in their code, each with what it does", () => {
    expect(namers.sort()).toEqual(Object.keys(COLUMN_NAMERS).sort());
  });

  test("no product code looks a subscription up by its code: no query or where names the column", () => {
    const lookups: Array<string> = [];

    for (const file of namers) {
      for (const use of columnUsesIn(file)) {
        // The property whose value holds the column's name, nearest first.
        const holder: string | undefined = use.enclosingProperties.find(
          (name: string): boolean => {
            return name !== COLUMN;
          },
        );

        if (holder === "query" || holder === "where") {
          lookups.push(
            `${file}:${
              use.node
                .getSourceFile()
                .getLineAndCharacterOfPosition(use.node.getStart()).line + 1
            }`,
          );
        }
      }
    }

    expect(lookups).toEqual([]);
  });

  test("the guard sees a lookup by the code when there is one", () => {
    const sample: ts.SourceFile = ts.createSourceFile(
      "sample.ts",
      "service.findOneBy({ query: { _id: id, subscriptionConfirmationToken: code }, select: { subscriptionConfirmationToken: true } });",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const holders: Array<string> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === COLUMN) {
        let parent: ts.Node | undefined = node.parent;

        while (parent) {
          const name: string | null = propertyNameOf(parent);

          if (name !== null && name !== COLUMN) {
            holders.push(name);
            break;
          }

          parent = parent.parent;
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sample);

    expect(holders).toEqual(["query", "select"]);
  });

  test("a link's code is compared in one place, confirmSubscription, by StatusPageSubscriberConfirmationCode.matches", () => {
    const service: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, SERVICE),
      "utf8",
    );

    expect(
      service.split("StatusPageSubscriberConfirmationCode.matches(").length - 1,
    ).toBe(1);

    const confirm: string =
      service.split("public async confirmSubscription(")[1] || "";
    const method: string = confirm.slice(0, confirm.indexOf("\n  }\n"));

    expect(method).toContain("StatusPageSubscriberConfirmationCode.matches({");
    // A link more than a day old confirms nothing.
    expect(method).toContain(
      "StatusPageSubscriberConfirmationCode.hasExpired(subscriber.createdAt)",
    );
    // A wrong code for a six-digit code gives it up.
    expect(method).toContain("this.retireShortConfirmationCode(subscriber)");
  });

  test("the only route that confirms a subscription asks confirmSubscription", () => {
    const callers: Array<string> = listProductFiles().filter(
      (file: string): boolean => {
        return (
          CODE_FILE.test(file) &&
          fs
            .readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8")
            .includes(".confirmSubscription(")
        );
      },
    );

    expect(callers).toEqual(["packages/Common/Server/API/StatusPageAPI.ts"]);
  });

  test("every code is minted by StatusPageSubscriberConfirmationCode.generate, as a subscription is created", () => {
    const service: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, SERVICE),
      "utf8",
    );

    const writes: Array<string> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === COLUMN
      ) {
        writes.push(node.right.getText());
      }

      ts.forEachChild(node, visit);
    };

    visit(parse(SERVICE));

    expect(service).toContain(COLUMN);
    expect(writes).toEqual(["StatusPageSubscriberConfirmationCode.generate()"]);
  });
});
