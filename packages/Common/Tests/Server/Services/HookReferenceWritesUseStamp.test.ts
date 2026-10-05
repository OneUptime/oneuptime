import fs from "fs";
import path from "path";
import ts from "typescript";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RelationNames, {
  RelationName,
} from "../../../Server/Utils/Database/RelationNames";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * A hook that decides a reference itself - the person a record is created
 * by, the state it starts in, a default it fills in, the id it has just
 * checked - writes it with RelationIdUtil.stamp, never by assigning the ID
 * column. The relation and its ID column are one database column, and when
 * a write carries both TypeORM stores the relation's id
 * (RelationNamePrecedence.test.ts). So `createBy.data.monitorId = id` leaves
 * a `monitor` the caller sent beside it to be stored in its place, where
 * stamp writes the ID column and removes every other name of it.
 *
 * DatabaseService refuses a write whose two names disagree before any hook
 * runs (RelationNames), so a hook only ever sees one value. This holds the
 * other half: what a hook writes is what is stored. It scans every service
 * in Common/Server/Services for an assignment to, or a setColumnValue of,
 * one of its own model's reference ID columns on the payload a create or
 * update hook is handed. The tenant column is DatabaseService's own
 * (enforceTenantRelationMatchesScalar), and RelationNames leaves it out.
 */

const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);
const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);

// The expressions a hook reaches the payload of a create or update through.
const PAYLOAD_ROOTS: Array<string> = [
  "createBy.data",
  "updateBy.data",
  "data.data",
  "data.createBy.data",
  "data.updateBy.data",
  "onCreate.createBy.data",
  "onUpdate.updateBy.data",
];

export interface ReferenceWrite {
  file: string;
  line: number;
  text: string;
}

// Parentheses, `as` casts and non-null assertions do not change what is written.
function unwrap(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;

  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }

    return current;
  }
}

function textOf(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source).replace(/\s+/g, "");
}

/*
 * The places in `text` (one service's source) that write one of `idColumns`
 * on a create or update payload other than with stamp. Exported for the
 * self-test below.
 */
export function findReferenceWrites(
  fileName: string,
  text: string,
  idColumns: Set<string>,
): Array<ReferenceWrite> {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const roots: Set<string> = new Set(PAYLOAD_ROOTS);

  // `const data = createBy.data as ...` is the payload too, and so on down.
  const aliasesOf: (node: ts.Node) => Array<string> = (
    node: ts.Node,
  ): Array<string> => {
    const aliases: Array<string> = [];

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !roots.has(node.name.text) &&
      roots.has(textOf(unwrap(node.initializer), source))
    ) {
      aliases.push(node.name.text);
    }

    ts.forEachChild(node, (child: ts.Node): void => {
      aliases.push(...aliasesOf(child));
    });

    return aliases;
  };

  for (
    let aliases: Array<string> = aliasesOf(source);
    aliases.length > 0;
    aliases = aliasesOf(source)
  ) {
    for (const alias of aliases) {
      roots.add(alias);
    }
  }

  const isPayload: (node: ts.Expression) => boolean = (
    node: ts.Expression,
  ): boolean => {
    return roots.has(textOf(unwrap(node), source));
  };

  // The column `target` writes on a payload, or null for anything else.
  const writtenColumn: (target: ts.Expression) => string | null = (
    target: ts.Expression,
  ): string | null => {
    const expression: ts.Expression = unwrap(target);

    if (
      ts.isPropertyAccessExpression(expression) &&
      isPayload(expression.expression)
    ) {
      return expression.name.text;
    }

    if (
      ts.isElementAccessExpression(expression) &&
      ts.isStringLiteralLike(expression.argumentExpression) &&
      isPayload(expression.expression)
    ) {
      return expression.argumentExpression.text;
    }

    return null;
  };

  const found: Array<ReferenceWrite> = [];

  const report: (node: ts.Node) => void = (node: ts.Node): void => {
    found.push({
      file: fileName,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      text: node.getText(source).replace(/\s+/g, " ").slice(0, 160),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // createBy.data.monitorId = id
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const column: string | null = writtenColumn(node.left);

      if (column && idColumns.has(column)) {
        report(node);
      }
    }

    // createBy.data.setColumnValue("monitorId", id)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setColumnValue" &&
      isPayload(node.expression.expression) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      idColumns.has(node.arguments[0].text)
    ) {
      report(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

/*
 * The model a service file serves: the one it imports from DatabaseModels and
 * extends a service of (`extends DatabaseService<Model>`).
 */
function modelFileOf(source: string): string | null {
  const imports: Map<string, string> = new Map();

  for (const match of source.matchAll(
    /import (\w+)(?:,\s*\{[^}]*\})? from "\.\.\/\.\.\/Models\/DatabaseModels\/([\w/]+)";/g,
  )) {
    imports.set(match[1]!, match[2]!);
  }

  const extended: RegExpMatchArray | null = source.match(
    /class \w+ extends \w+<(\w+)>/,
  );

  if (!extended) {
    return null;
  }

  return imports.get(extended[1]!) || null;
}

// The ID columns of the model's references, the tenant's left out.
function idColumnsOf(modelFile: string): Set<string> {
  const exported: unknown = (
    jest.requireActual(path.join(MODELS_DIRECTORY, modelFile)) as {
      default?: unknown;
    }
  ).default;

  if (typeof exported !== "function") {
    return new Set();
  }

  let model: unknown;

  try {
    model = new (exported as new () => unknown)();
  } catch {
    return new Set();
  }

  if (!(model instanceof DatabaseBaseModel)) {
    return new Set();
  }

  return new Set(
    RelationNames.getSingleRelations(model).map(
      (relation: RelationName): string => {
        return relation.idColumn;
      },
    ),
  );
}

interface ScannedService {
  file: string;
  idColumns: Set<string>;
}

function scanServices(): {
  services: Array<ScannedService>;
  writes: Array<ReferenceWrite>;
} {
  const services: Array<ScannedService> = [];
  const writes: Array<ReferenceWrite> = [];

  for (const file of fs.readdirSync(SERVICES_DIRECTORY).sort()) {
    if (!file.endsWith(".ts")) {
      continue;
    }

    const text: string = fs.readFileSync(
      path.join(SERVICES_DIRECTORY, file),
      "utf8",
    );
    const modelFile: string | null = modelFileOf(text);

    if (!modelFile) {
      continue;
    }

    const idColumns: Set<string> = idColumnsOf(modelFile);

    if (idColumns.size === 0) {
      continue;
    }

    services.push({ file: file, idColumns: idColumns });
    writes.push(...findReferenceWrites(file, text, idColumns));
  }

  return { services: services, writes: writes };
}

describe("a hook writes a reference it decides with RelationIdUtil.stamp", () => {
  const scan: {
    services: Array<ScannedService>;
    writes: Array<ReferenceWrite>;
  } = scanServices();

  test("no service assigns one of its model's reference ID columns on a write's payload", () => {
    expect(scan.writes).toEqual([]);
  });

  test("the scan reads the services that write references", () => {
    const scanned: Map<string, Set<string>> = new Map(
      scan.services.map((service: ScannedService): [string, Set<string>] => {
        return [service.file, service.idColumns];
      }),
    );

    expect(scan.services.length).toBeGreaterThan(100);
    expect(
      scanned.get("IncidentService.ts")?.has("currentIncidentStateId"),
    ).toBe(true);
    expect(scanned.get("AlertService.ts")?.has("currentAlertStateId")).toBe(
      true,
    );
    expect(scanned.get("ProjectService.ts")?.has("createdByUserId")).toBe(true);
    expect(scanned.get("UserTotpAuthService.ts")?.has("userId")).toBe(true);
    // The tenant column is DatabaseService's own.
    expect(scanned.get("IncidentService.ts")?.has("projectId")).toBe(false);
  });
});

describe("findReferenceWrites", () => {
  const ID_COLUMNS: Set<string> = new Set(["monitorId", "createdByUserId"]);

  const WRITES: Array<[string, string]> = [
    ["an assignment on a create's payload", "createBy.data.monitorId = id;"],
    ["a clear on an update's payload", "updateBy.data.monitorId = null;"],
    ["an element assignment", 'createBy.data["monitorId"] = id;'],
    ["a cast payload", "(createBy.data as any).monitorId = id;"],
    [
      "an alias of the payload",
      "const data: Record<string, unknown> = createBy.data as unknown as Record<string, unknown>;\ndata.monitorId = id;",
    ],
    [
      "an alias of an alias",
      "const payload = createBy.data;\nconst data = payload;\ndata.monitorId = id;",
    ],
    [
      "setColumnValue on the payload",
      'createBy.data.setColumnValue("monitorId", id);',
    ],
    [
      "a hook whose argument is named data",
      "data.data.createdByUserId = data.props.userId;",
    ],
  ];

  const NOT_WRITES: Array<[string, string]> = [
    [
      "stamp",
      'RelationIdUtil.stamp(createBy.data, ["monitorId", "monitor"], id);',
    ],
    ["another column", 'createBy.data.name = "Core Switch";'],
    ["a column of another object", "query.monitorId = id;"],
    ["a new record", "const row: Model = new Model();\nrow.monitorId = id;"],
    ["a read", "const id: ObjectID = createBy.data.monitorId;"],
    ["a comparison", "if (createBy.data.monitorId === id) {\n}"],
    ["a column the scan was not given", "createBy.data.projectId = id;"],
    ["a delete", "delete createBy.data.monitorId;"],
  ];

  test.each(WRITES)("found: %s", (_shape: string, code: string) => {
    expect(findReferenceWrites("x.ts", code, ID_COLUMNS)).toHaveLength(1);
  });

  test.each(NOT_WRITES)("not found: %s", (_shape: string, code: string) => {
    expect(findReferenceWrites("x.ts", code, ID_COLUMNS)).toEqual([]);
  });
});
