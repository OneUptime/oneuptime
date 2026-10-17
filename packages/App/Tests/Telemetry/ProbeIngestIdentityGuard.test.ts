import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * A probe ingest request is the authenticated probe's, everywhere.
 *
 * The probe-auth middleware (Middleware/ProbeAuthorization.ts) checks the
 * id and key a probe sends and sets req.probe. From there on:
 *
 *   1. no probe ingest route reads a probe id from the request body - the
 *      middleware is the only reader of the body's probeId, and a route
 *      knows its probe through Utils/ProbeRequest (req.probe);
 *   2. no route queues the request body whole (it carries the probe's key),
 *      and every queued probe result or trap carries the authenticated
 *      probe beside it;
 *   3. the queue worker reads the sender from what the route wrote down,
 *      holds the result to it, and tells MonitorResource the reporting
 *      probe.
 *
 * Read from the source, so a route added later - or an old one rewritten -
 * is held to the same rule without anybody remembering to add a test.
 */

const TELEMETRY_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
);

const PROBE_INGEST_DIR: string = path.join(TELEMETRY_DIR, "API", "ProbeIngest");

const MIDDLEWARE_FILE: string = path.join(
  TELEMETRY_DIR,
  "Middleware",
  "ProbeAuthorization.ts",
);

const WORKER_FILE: string = path.join(
  TELEMETRY_DIR,
  "Jobs",
  "ProbeIngest",
  "ProcessProbeIngest.ts",
);

const WHITESPACE: RegExp = /\s+/g;

// A route's own reader of the request body: readBody(req).
const BODY_READER_CALL: RegExp = /^read\w*Body\(req\)$/;

// The authenticated probe, as a queue call passes it.
const QUEUED_PROBE_ID: RegExp = /^probeId(\.toString\(\))?$/;

// How a route reads the probe the middleware authenticated: req.probe.id.
const AUTHENTICATED_PROBE_READ: RegExp = /\.probe(\?|!)?\.id\b/;

function readSource(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function probeIngestRouteFiles(): Array<string> {
  return fs
    .readdirSync(PROBE_INGEST_DIR)
    .filter((name: string) => {
      return name.endsWith(".ts");
    })
    .map((name: string) => {
      return path.join(PROBE_INGEST_DIR, name);
    });
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child: ts.Node) => {
    walk(child, visit);
  });
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function stripParentheses(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function isRequestBody(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const text: string = stripParentheses(expression)
    .getText(sourceFile)
    .replace(WHITESPACE, "");

  // req.body itself, or a route's own reader of it (readBody(req)).
  return text === "req.body" || BODY_READER_CALL.test(text);
}

function enclosingFunction(node: ts.Node): ts.Node | null {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isFunctionLike(current)) {
      return current;
    }

    current = current.parent;
  }

  return null;
}

function isWithin(node: ts.Node, ancestor: ts.Node | null): boolean {
  if (!ancestor) {
    return true;
  }

  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (current === ancestor) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

/*
 * Every read of `probeId` off the request body: req.body itself, or a
 * variable a function sets to it (const data = req.body), read in that
 * function. A variable of the same name elsewhere - a helper's parameter,
 * a row - is not the body.
 */
function bodyProbeIdReads(sourceFile: ts.SourceFile): Array<string> {
  const bodyVariables: Array<{ name: string; scope: ts.Node | null }> = [];

  walk(sourceFile, (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isRequestBody(sourceFile, node.initializer)
    ) {
      bodyVariables.push({
        name: node.name.text,
        scope: enclosingFunction(node),
      });
    }
  });

  const reads: Array<string> = [];

  walk(sourceFile, (node: ts.Node) => {
    let holder: ts.Expression | null = null;
    let name: string | null = null;

    if (ts.isPropertyAccessExpression(node)) {
      holder = node.expression;
      name = node.name.text;
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      holder = node.expression;
      name = node.argumentExpression.text;
    }

    if (!holder || name !== "probeId") {
      return;
    }

    const bare: ts.Expression = stripParentheses(holder);

    const readsBody: boolean =
      isRequestBody(sourceFile, bare) ||
      (ts.isIdentifier(bare) &&
        bodyVariables.some((variable: { name: string; scope: ts.Node | null }) => {
          return variable.name === bare.text && isWithin(node, variable.scope);
        }));

    if (readsBody) {
      reads.push(
        `${path.basename(sourceFile.fileName)}:${lineOf(sourceFile, node)} ${node.getText(sourceFile)}`,
      );
    }
  });

  return reads;
}

interface QueueCall {
  file: string;
  line: number;
  method: string;
  argument: ts.Expression | undefined;
  sourceFile: ts.SourceFile;
}

// Every TelemetryQueueService.add...Job(...) call in the probe ingest routes.
function queueCalls(): Array<QueueCall> {
  const calls: Array<QueueCall> = [];

  for (const file of probeIngestRouteFiles()) {
    const sourceFile: ts.SourceFile = readSource(file);

    walk(sourceFile, (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sourceFile) ===
          "TelemetryQueueService" &&
        node.expression.name.text.startsWith("add")
      ) {
        calls.push({
          file: path.basename(file),
          line: lineOf(sourceFile, node),
          method: node.expression.name.text,
          argument: node.arguments[0],
          sourceFile: sourceFile,
        });
      }
    });
  }

  return calls;
}

function objectProperties(
  argument: ts.Expression | undefined,
): Map<string, ts.Expression> {
  const properties: Map<string, ts.Expression> = new Map();

  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return properties;
  }

  for (const property of argument.properties) {
    if (ts.isPropertyAssignment(property)) {
      properties.set(property.name.getText(), property.initializer);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(property.name.getText(), property.name);
    }
  }

  return properties;
}

// The body of the function a node sits in, as text.
function enclosingFunctionText(
  sourceFile: ts.SourceFile,
  functionName: string,
): string {
  let text: string = "";

  walk(sourceFile, (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === functionName &&
      node.body
    ) {
      text = node.body.getText(sourceFile);
    }
  });

  return text;
}

describe("probe ingest: the request is the authenticated probe's", () => {
  test("the routes are where this guard looks", () => {
    const files: Array<string> = probeIngestRouteFiles().map(
      (file: string) => {
        return path.basename(file);
      },
    );

    // The routes a probe posts results, traps, logs and flows to.
    for (const expected of [
      "Probe.ts",
      "Monitor.ts",
      "Syslog.ts",
      "NetworkFlow.ts",
      "NetworkDevicePoll.ts",
      "DiscoveryScan.ts",
      "PacketCapture.ts",
      "VMwareCollection.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  test("no probe ingest route reads a probe id from the request body", () => {
    const reads: Array<string> = [];

    for (const file of probeIngestRouteFiles()) {
      reads.push(...bodyProbeIdReads(readSource(file)));
    }

    expect(reads).toEqual([]);
  });

  test("the probe-auth middleware is the one reader of the body's probe id", () => {
    expect(bodyProbeIdReads(readSource(MIDDLEWARE_FILE)).length).toBe(2);
  });

  test("the scan sees a body read when there is one", () => {
    const sample: ts.SourceFile = ts.createSourceFile(
      "Sample.ts",
      [
        'const a = req.body["probeId"];',
        "const b = req.body.probeId;",
        'const c = (req.body as JSONObject)["probeId"];',
        "function handler(req) {",
        "  const data: JSONObject = req.body;",
        '  const d = data["probeId"];',
        "  const fromReader = readBody(req);",
        "  const e = fromReader.probeId;",
        "}",
        // Not the body: a row, the request's probe, a route parameter.
        "const f = device.probeId;",
        "const g = req.probe!.id;",
        'const h = req.params["probeId"];',
        // A helper's own parameter named like a body holder.
        "function helper(data: { probeId: ObjectID }) {",
        "  return data.probeId;",
        "}",
      ].join("\n"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    expect(
      bodyProbeIdReads(sample).map((read: string) => {
        return read.split(" ").slice(1).join(" ");
      }),
    ).toEqual([
      'req.body["probeId"]',
      "req.body.probeId",
      '(req.body as JSONObject)["probeId"]',
      'data["probeId"]',
      "fromReader.probeId",
    ]);
  });

  test("no probe ingest route queues the request body whole", () => {
    const wholeBody: Array<string> = [];

    for (const call of queueCalls()) {
      for (const [name, value] of objectProperties(call.argument)) {
        if (
          ["req.body", "body", "data"].includes(
            stripParentheses(value).getText(call.sourceFile),
          )
        ) {
          wholeBody.push(`${call.file}:${call.line} ${call.method} ${name}`);
        }
      }
    }

    expect(wholeBody).toEqual([]);
  });

  test("every queued probe result and trap carries the authenticated probe", () => {
    const calls: Array<QueueCall> = queueCalls().filter((call: QueueCall) => {
      return [
        "addProbeIngestJob",
        "addSnmpTrapIngestJob",
        "addNetworkDeviceWalkJob",
      ].includes(call.method);
    });

    // Two results (check and monitor test), a trap, a device poll.
    expect(calls.length).toBeGreaterThanOrEqual(4);

    for (const call of calls) {
      const properties: Map<string, ts.Expression> = objectProperties(
        call.argument,
      );

      // A device poll keeps its body as walkRequestBody, probeId inside it.
      const holder: Map<string, ts.Expression> = properties.has(
        "walkRequestBody",
      )
        ? objectProperties(properties.get("walkRequestBody"))
        : properties;

      const probeId: ts.Expression | undefined = holder.get("probeId");

      expect({
        call: `${call.file}:${call.line} ${call.method}`,
        probeId: probeId ? probeId.getText(call.sourceFile) : null,
      }).toEqual({
        call: `${call.file}:${call.line} ${call.method}`,
        probeId: expect.stringMatching(QUEUED_PROBE_ID),
      });
    }
  });

  test("a route that names its probe reads it from the authenticated request", () => {
    for (const file of probeIngestRouteFiles()) {
      const source: string = fs.readFileSync(file, "utf8");

      if (!source.includes("ProbeAuthorization.isAuthorizedServiceMiddleware")) {
        continue;
      }

      const readsProbe: boolean =
        source.includes("ProbeRequest.getProbeId(req)") ||
        AUTHENTICATED_PROBE_READ.test(source);

      expect({ file: path.basename(file), readsProbe }).toEqual({
        file: path.basename(file),
        readsProbe: true,
      });
    }
  });
});

describe("probe ingest worker: a job is the sender's", () => {
  const worker: ts.SourceFile = readSource(WORKER_FILE);

  test("a check result is held to its sender and judged as the sender's", () => {
    const body: string = enclosingFunctionText(worker, "processProbeFromQueue");

    expect(body).toContain("ProbeReportIdentity.readSender(");
    expect(body).toContain("ProbeReportIdentity.bindResultToSender(");
    expect(body.replace(WHITESPACE, "")).toContain(
      "MonitorResourceUtil.monitorResource(probeResponse,{reportingProbeId:reportingProbeId,})",
    );
    expect(body.replace(WHITESPACE, "")).toContain(
      "probeId:reportingProbeId,",
    );
  });

  test("a trap is matched as the probe's that received it", () => {
    const body: string = enclosingFunctionText(
      worker,
      "processSnmpTrapFromQueue",
    );

    expect(body).toContain("ProbeReportIdentity.readSender(");
  });
});
