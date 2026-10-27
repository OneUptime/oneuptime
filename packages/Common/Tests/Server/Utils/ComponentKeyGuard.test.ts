import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A KEY THIS REPOSITORY SHIPS NEVER PROVES WHO A COMPONENT IS.
 *
 * A probe, a Runner and an AI agent each prove who they are with the key
 * stored on their row (Probe.key, Runner.key, AIAgent.key). A value this
 * repository ships (EnvironmentConfig.isShippedSecretValue: a blank key,
 * "secret", or a config.example.env placeholder) is public, so the rule
 * holds on both sides, everywhere:
 *
 *   - Every query that finds such a row by a key it was handed refuses a
 *     shipped key first, in the same function, before it reads the table
 *     (ProbeService.verifyProbeKey, RunnerService.findByIdAndKey,
 *     CodeFixAgentAuth, AIAgentAPI, a probe's registration). A new lookup
 *     fails this guard until it does too.
 *   - Every model with a key column is sorted: the key a component proves
 *     who it is with, whose service keeps shipped keys out on every create
 *     and update (ComponentKeyWrite), whoever writes them; or a key that
 *     names something and proves nothing. A new model with a key column
 *     fails this guard until it is sorted.
 *
 * Read from the code with TypeScript's own parser, across all product code
 * (ee/ too, when it is checked out).
 */

type ModelType = { new (): BaseModel };

// Each model whose key is how a component proves who it is, with its service.
const COMPONENT_KEY_SERVICES: Record<string, string> = {
  Probe: "packages/Common/Server/Services/ProbeService.ts",
  Runner: "packages/Common/Server/Services/RunnerService.ts",
  AIAgent: "packages/Common/Server/Services/AIAgentService.ts",
};

// Each model whose key names something and proves nothing, with what it names.
const NAMING_KEYS: Record<string, string> = {
  AlertMeasurement:
    "the measurement, in the metric name its points are written under",
  IncidentMeasurement:
    "the measurement, in the metric name its points are written under",
  ScheduledMaintenanceMeasurement:
    "the measurement, in the metric name its points are written under",
  NetworkDeviceRole:
    "the role, which SNMP classification and the topology map match on",
  GreenlockCertificate:
    "a certificate in the Let's Encrypt store that ACME certificates replaced",
  GreenlockChallenge:
    "an HTTP challenge in the Let's Encrypt store that ACME certificates replaced",
};

/*
 * The lookups this guard was written for: each file that finds a component's
 * row by a key it was handed, and how many such queries it makes. The guard
 * must keep finding them, or its reading of the code has stopped working.
 */
const KNOWN_LOOKUPS: Record<string, number> = {
  "packages/Common/Server/Services/ProbeService.ts": 1,
  "packages/Common/Server/Services/RunnerService.ts": 1,
  "packages/Common/Server/Utils/AI/CodeFix/CodeFixAgentAuth.ts": 2,
  // The heartbeat (/alive); the shared Runner's registration went with it.
  "packages/Common/Server/API/AIAgentAPI.ts": 1,
  "packages/App/FeatureSet/Telemetry/API/ProbeIngest/Register.ts": 1,
};

// The modules of the services whose rows a key finds, as code imports them.
const COMPONENT_SERVICE_MODULE: RegExp =
  /(?:^|\/)Services\/(?:ProbeService|RunnerService|AIAgentService)$/;
// A file that may hold such a lookup: a cheap first pass over raw text.
const MENTIONS_COMPONENT_SERVICE: RegExp =
  /\b(?:ProbeService|RunnerService|AIAgentService)\b/;
const CODE_FILE: RegExp = /\.tsx?$/;
const SHIPPED_CHECK: string = "isShippedSecretValue";

const hasEe: boolean = fs.existsSync(path.join(REPOSITORY_DIRECTORY, "ee"));

interface KeyLookup {
  file: string;
  line: number;
  call: string;
  // The key it matches by, as written.
  key: string;
  // Whether its function calls isShippedSecretValue on that key before it.
  refusesShippedKeyFirst: boolean;
}

function parse(relativePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function propertyNamed(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return literal.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        property.name !== undefined &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === name
      );
    },
  );
}

// The names a file binds the component services to (their default imports).
function componentServiceNames(sourceFile: ts.SourceFile): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      COMPONENT_SERVICE_MODULE.test(statement.moduleSpecifier.text) &&
      statement.importClause?.name
    ) {
      names.add(statement.importClause.name.text);
    }
  }

  return names;
}

/*
 * The key a call's query matches the row by, as written (`data.agentKey`,
 * or `key` for a shorthand), or null when its query names no key.
 */
function keyMatchedBy(call: ts.CallExpression): string | null {
  const argument: ts.Expression | undefined = call.arguments[0];

  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return null;
  }

  const query: ts.ObjectLiteralElementLike | undefined = propertyNamed(
    argument,
    "query",
  );

  if (
    !query ||
    !ts.isPropertyAssignment(query) ||
    !ts.isObjectLiteralExpression(query.initializer)
  ) {
    return null;
  }

  const key: ts.ObjectLiteralElementLike | undefined = propertyNamed(
    query.initializer,
    "key",
  );

  if (key && ts.isPropertyAssignment(key)) {
    return key.initializer.getText();
  }

  if (key && ts.isShorthandPropertyAssignment(key)) {
    return key.name.text;
  }

  return key ? key.getText() : null;
}

/*
 * Whether `scope` calls isShippedSecretValue on `key` (the same expression,
 * as written) before `position`. A check on another value - the
 * registration key, say - refuses nothing about this one.
 */
function callsShippedCheckBefore(
  scope: ts.Node,
  position: number,
  key: string,
): boolean {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === SHIPPED_CHECK &&
      node.arguments[0]?.getText() === key &&
      node.getStart() < position
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(scope);

  return found;
}

/*
 * Every query in `source` that finds a probe's, a Runner's or an AI agent's
 * row by a key: a call on one of their services (or on `this`, in the
 * service itself) whose query names a key.
 */
function findKeyLookups(
  relativePath: string,
  source: string,
): Array<KeyLookup> {
  const sourceFile: ts.SourceFile = parse(relativePath, source);
  const receivers: Set<string> = componentServiceNames(sourceFile);
  const isComponentService: boolean = Object.values(
    COMPONENT_KEY_SERVICES,
  ).includes(relativePath);
  const lookups: Array<KeyLookup> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const key: string | null = ts.isCallExpression(node)
      ? keyMatchedBy(node)
      : null;

    if (
      key !== null &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const receiver: ts.Expression = node.expression.expression;
      const onComponent: boolean =
        (ts.isIdentifier(receiver) && receivers.has(receiver.text)) ||
        (receiver.kind === ts.SyntaxKind.ThisKeyword && isComponentService);

      if (onComponent) {
        let scope: ts.Node = node.parent;

        while (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) {
          scope = scope.parent;
        }

        lookups.push({
          file: relativePath,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          call: node.expression.getText(),
          key: key,
          refusesShippedKeyFirst: callsShippedCheckBefore(
            scope,
            node.getStart(),
            key,
          ),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return lookups;
}

function allKeyLookups(): Array<KeyLookup> {
  return listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"])
    .filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    })
    .flatMap((relativePath: string): Array<KeyLookup> => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, relativePath),
        "utf8",
      );

      // A service's own file need not name itself: it queries through this.
      return MENTIONS_COMPONENT_SERVICE.test(source) ||
        Object.values(COMPONENT_KEY_SERVICES).includes(relativePath)
        ? findKeyLookups(relativePath, source)
        : [];
    });
}

// The method `name` of the service's class, or undefined.
function hookOf(
  sourceFile: ts.SourceFile,
  name: string,
): ts.MethodDeclaration | undefined {
  let hook: ts.MethodDeclaration | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      hook = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return hook;
}

// Whether `statement` returns from its function (not from one nested in it).
function returns(statement: ts.Node): boolean {
  if (ts.isReturnStatement(statement)) {
    return true;
  }

  if (ts.isFunctionLike(statement)) {
    return false;
  }

  return Boolean(ts.forEachChild(statement, returns));
}

/*
 * Whether the hook calls `check` with `firstArgument` as a statement of its
 * own body, with no return before it: so every write the hook sees, root's
 * included, is held to it.
 */
function holdsEveryWriteTo(
  hook: ts.MethodDeclaration,
  check: string,
  firstArgument: string,
): boolean {
  const statements: ReadonlyArray<ts.Statement> = hook.body?.statements || [];

  for (const statement of statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression) &&
      statement.expression.expression.getText() === check &&
      statement.expression.arguments[0]?.getText() === firstArgument
    ) {
      return true;
    }

    if (returns(statement)) {
      return false;
    }
  }

  return false;
}

describe("every model with a key column is sorted", () => {
  const modelsWithAKey: Array<string> = AllModelTypes.map(
    (modelType: ModelType): BaseModel => {
      return new modelType();
    },
  )
    .filter((model: BaseModel): boolean => {
      return model.getTableColumns().columns.includes("key");
    })
    .map((model: BaseModel): string => {
      return model.tableName as string;
    })
    .sort();

  test("each is a component's key, or a key that names something", () => {
    /*
     * A model here has a key column this guard has not been told about. If
     * something presents that key to prove who it is, its service keeps
     * shipped keys out (ComponentKeyWrite) and every lookup by it refuses
     * one: list it in COMPONENT_KEY_SERVICES. If the key only names
     * something, list it in NAMING_KEYS with what it names.
     */
    expect(modelsWithAKey).toEqual(
      [
        ...Object.keys(COMPONENT_KEY_SERVICES),
        ...Object.keys(NAMING_KEYS),
      ].sort(),
    );
  });

  test.each(Object.entries(COMPONENT_KEY_SERVICES))(
    "%s's service refuses a shipped key on every create, after it makes one for a create without it",
    (_model: string, servicePath: string) => {
      const sourceFile: ts.SourceFile = parse(
        servicePath,
        fs.readFileSync(path.join(REPOSITORY_DIRECTORY, servicePath), "utf8"),
      );
      const onBeforeCreate: ts.MethodDeclaration | undefined = hookOf(
        sourceFile,
        "onBeforeCreate",
      );

      expect(onBeforeCreate).toBeDefined();
      expect(
        holdsEveryWriteTo(
          onBeforeCreate!,
          "ComponentKeyWrite.assertCreatedKey",
          "createBy.data.key",
        ),
      ).toBe(true);
    },
  );

  test.each(Object.entries(COMPONENT_KEY_SERVICES))(
    "%s's service refuses a shipped key on every update that writes one, root's included",
    (_model: string, servicePath: string) => {
      const sourceFile: ts.SourceFile = parse(
        servicePath,
        fs.readFileSync(path.join(REPOSITORY_DIRECTORY, servicePath), "utf8"),
      );
      const onBeforeUpdate: ts.MethodDeclaration | undefined = hookOf(
        sourceFile,
        "onBeforeUpdate",
      );

      expect(onBeforeUpdate).toBeDefined();
      expect(
        holdsEveryWriteTo(
          onBeforeUpdate!,
          "ComponentKeyWrite.assertUpdatedKey",
          "updateBy.data",
        ),
      ).toBe(true);
    },
  );
});

describe("every lookup by a component's key refuses a shipped key first", () => {
  const lookups: Array<KeyLookup> = allKeyLookups();

  test("the guard finds the lookups it was written for", () => {
    const found: Record<string, number> = {};

    for (const lookup of lookups) {
      found[lookup.file] = (found[lookup.file] || 0) + 1;
    }

    // At least these: a new lookup is held to the rule below, not pinned here.
    for (const [file, count] of Object.entries(KNOWN_LOOKUPS)) {
      expect({ file, foundThemAll: (found[file] || 0) >= count }).toEqual({
        file,
        foundThemAll: true,
      });
    }
  });

  test("each one calls isShippedSecretValue before it reads the table, in the same function", () => {
    /*
     * A lookup here finds a probe, a Runner or an AI agent by a key it was
     * handed without refusing a shipped key first. Return nothing for
     * isShippedSecretValue(key) before the query, as
     * RunnerService.findByIdAndKey does: a row may still hold such a key
     * from before the write rule, and it must authenticate nothing.
     */
    expect(
      lookups
        .filter((lookup: KeyLookup): boolean => {
          return !lookup.refusesShippedKeyFirst;
        })
        .map((lookup: KeyLookup): string => {
          return `${lookup.file}:${lookup.line} ${lookup.call}`;
        }),
    ).toEqual([]);
  });

  test("the guard reads ee/ too when it is checked out", () => {
    const eeFiles: Array<string> = listProductFiles(REPOSITORY_DIRECTORY, [
      "ee",
    ]);

    expect(eeFiles.length > 0).toBe(hasEe);
  });
});

/*
 * The guard's own reading, on code written for it: what it counts as a
 * lookup by a component's key, and when it counts a shipped key as refused.
 */
describe("how the guard reads a lookup", () => {
  const SERVICE_IMPORT: string =
    'import RunnerService from "Common/Server/Services/RunnerService";\n';

  function readOne(source: string, file?: string): Array<KeyLookup> {
    return findKeyLookups(
      file || "packages/App/FeatureSet/Example.ts",
      `${SERVICE_IMPORT}${source}`,
    );
  }

  test("a query by key with no shipped check is a lookup that refuses nothing", () => {
    expect(
      readOne(
        "async function find(id: string, key: string) {\n" +
          "  return RunnerService.findOneBy({ query: { _id: id, key: key }, props: { isRoot: true } });\n" +
          "}\n",
      ),
    ).toEqual([
      {
        file: "packages/App/FeatureSet/Example.ts",
        line: 3,
        call: "RunnerService.findOneBy",
        key: "key",
        refusesShippedKeyFirst: false,
      },
    ]);
  });

  test("a shipped check before the query refuses one; one after it does not", () => {
    const before: Array<KeyLookup> = readOne(
      "async function find(key: string) {\n" +
        "  if (isShippedSecretValue(key)) { return null; }\n" +
        "  return RunnerService.findOneBy({ query: { key } });\n" +
        "}\n",
    );
    const after: Array<KeyLookup> = readOne(
      "async function find(key: string) {\n" +
        "  const row = await RunnerService.findOneBy({ query: { key } });\n" +
        "  return isShippedSecretValue(key) ? null : row;\n" +
        "}\n",
    );

    expect(
      before.map((lookup: KeyLookup): boolean => {
        return lookup.refusesShippedKeyFirst;
      }),
    ).toEqual([true]);
    expect(
      after.map((lookup: KeyLookup): boolean => {
        return lookup.refusesShippedKeyFirst;
      }),
    ).toEqual([false]);
  });

  test("a check on another value refuses nothing about this key", () => {
    expect(
      readOne(
        "async function find(data: { registerKey: string; agentKey: string }) {\n" +
          "  if (isShippedSecretValue(data.registerKey)) { return null; }\n" +
          "  return RunnerService.findOneBy({ query: { key: data.agentKey } });\n" +
          "}\n",
      ).map((lookup: KeyLookup): [string, boolean] => {
        return [lookup.key, lookup.refusesShippedKeyFirst];
      }),
    ).toEqual([["data.agentKey", false]]);
  });

  test("a check in another function does not count for this one", () => {
    expect(
      readOne(
        "function refuse(key: string) { return isShippedSecretValue(key); }\n" +
          "async function find(key: string) {\n" +
          "  return RunnerService.findOneBy({ query: { key: key } });\n" +
          "}\n",
      ).map((lookup: KeyLookup): boolean => {
        return lookup.refusesShippedKeyFirst;
      }),
    ).toEqual([false]);
  });

  test("the service's own queries count, through this", () => {
    expect(
      findKeyLookups(
        "packages/Common/Server/Services/RunnerService.ts",
        "class Service { public async find(key: string) {\n" +
          "  return this.findOneBy({ query: { key: key } });\n" +
          "} }\n",
      ).map((lookup: KeyLookup): string => {
        return lookup.call;
      }),
    ).toEqual(["this.findOneBy"]);
  });

  test("a service imported under another name is still read", () => {
    expect(
      findKeyLookups(
        "packages/App/FeatureSet/Example.ts",
        'import Probes from "../../Server/Services/ProbeService";\n' +
          "Probes.findBy({ query: { key: presented } });\n",
      ).map((lookup: KeyLookup): string => {
        return lookup.call;
      }),
    ).toEqual(["Probes.findBy"]);
  });

  test("a query by key on any other service, or by anything but a key, is not one", () => {
    expect(
      findKeyLookups(
        "packages/App/FeatureSet/Example.ts",
        `${SERVICE_IMPORT}` +
          'import MonitorService from "Common/Server/Services/MonitorService";\n' +
          "MonitorService.findOneBy({ query: { key: presented } });\n" +
          "RunnerService.findOneBy({ query: { _id: id, name: name } });\n" +
          "RunnerService.updateOneById({ id: id, data: { key: generated } });\n",
      ),
    ).toEqual([]);
  });
});
