import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Issue #2825: how the App starts.
 *
 * - StartServer mounts StartupGate right after the status routes and the
 *   vendor assets, so every route the App mounts later answers 503 with
 *   Retry-After instead of a 404 while it is still being mounted.
 * - The App asks for the gate, and readiness fails while it is closed.
 * - The gate opens only once every route is mounted (after
 *   App.addDefaultRoutes), and only then does the process start recording
 *   that OneUptime is receiving (InstanceReceivingHeartbeat.start): the time
 *   before that record is time OneUptime was not receiving.
 *
 * Read from the source with comments removed, so prose cannot satisfy it.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const INDEX_PATH: string = path.join(APP_ROOT, "Index.ts");
const START_SERVER_PATH: string = path.join(
  APP_ROOT,
  "../Common/Server/Utils/StartServer.ts",
);

function code(filePath: string): string {
  const source: string = fs.readFileSync(filePath, "utf8");
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    path.basename(filePath),
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return ts.createPrinter({ removeComments: true }).printFile(sourceFile);
}

function indexOfOnly(haystack: string, needle: string): number {
  const first: number = haystack.indexOf(needle);
  expect({ needle, found: first >= 0 }).toEqual({ needle, found: true });
  expect({ needle, unique: haystack.indexOf(needle, first + 1) === -1 }).toEqual(
    { needle, unique: true },
  );
  return first;
}

describe("StartServer mounts the startup gate", () => {
  const source: string = code(START_SERVER_PATH);

  test("only for a service that asks for it", () => {
    expect(source).toMatch(
      /if \(data\.useStartupGate\) \{\s*app\.use\(StartupGate\.middleware\);\s*\}/,
    );
  });

  test("after the status routes and vendor assets, before anything else the service mounts", () => {
    const status: number = indexOfOnly(source, "CommonAPI({");
    const vendor: number = indexOfOnly(source, "mountVendorAssets(app);");
    const gate: number = indexOfOnly(source, "app.use(StartupGate.middleware);");
    const frontend: number = indexOfOnly(source, "if (isFrontendApp) {");

    expect(status).toBeLessThan(gate);
    expect(vendor).toBeLessThan(gate);
    expect(gate).toBeLessThan(frontend);
  });
});

describe("App/Index.ts starts behind the gate", () => {
  const source: string = code(INDEX_PATH);

  test("asks StartServer for the gate", () => {
    const init: string = source.slice(indexOfOnly(source, "await App.init({"));
    expect(init.slice(0, init.indexOf("});"))).toContain(
      "useStartupGate: true",
    );
  });

  test("is not ready until the gate is open, whatever the datastores say", () => {
    const readyCheck: string = source.slice(
      indexOfOnly(source, "const readyCheck: PromiseVoidFunction"),
    );
    const body: string = readyCheck.slice(0, readyCheck.indexOf("};"));
    const assert: number = body.indexOf("StartupGate.assertOpen();");
    const datastores: number = body.indexOf(
      "InfrastructureStatus.checkStatusWithRetry(",
    );

    expect(assert).toBeGreaterThan(-1);
    expect(datastores).toBeGreaterThan(-1);
    expect(assert).toBeLessThan(datastores);
  });

  test("opens the gate once, after every route is mounted", () => {
    const open: number = indexOfOnly(source, "StartupGate.open();");
    const defaults: number = indexOfOnly(source, "await App.addDefaultRoutes();");

    expect(defaults).toBeLessThan(open);

    for (const routes of [
      "await IdentityRoutes.init();",
      "await BaseAPIRoutes.init();",
      "await WorkersRoutes.init();",
      "await TelemetryRoutes.init();",
      "await RunbookRoutes.init();",
    ]) {
      expect({ routes, before: indexOfOnly(source, routes) < open }).toEqual({
        routes,
        before: true,
      });
    }
  });

  test("records that OneUptime is receiving only after the gate is open", () => {
    const open: number = indexOfOnly(source, "StartupGate.open();");
    const heartbeat: number = indexOfOnly(
      source,
      "InstanceReceivingHeartbeat.start();",
    );

    expect(open).toBeLessThan(heartbeat);
  });
});
