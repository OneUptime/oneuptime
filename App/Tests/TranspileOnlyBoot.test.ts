import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

/*
 * Behavioural proof that TS_NODE_TRANSPILE_ONLY does what the Dockerfiles now
 * rely on.
 *
 * The static assertions in
 * Common/Tests/Server/Infrastructure/ContainerBootConfiguration.test.ts check
 * that the flag is SET in every image that boots through ts-node. This file
 * checks that the flag actually SKIPS the type-check in this repository's
 * ts-node/tsconfig setup -- otherwise the images would still pay the multi-minute
 * boot cost while looking correctly configured.
 *
 * The fixture lives inside App/ so ts-node resolves App/tsconfig.json exactly as
 * it does at container boot.
 */

const APP_ROOT: string = path.resolve(__dirname, "..");
const FIXTURE_DIR: string = path.join(APP_ROOT, ".transpile-only-fixture");

/*
 * Assigning a number to a string is a compile error, but it is harmless at
 * runtime -- so the process exits 0 if and only if the type-check was skipped.
 */
const TYPE_ERROR_SOURCE: string = [
  "const value: string = 42 as unknown as string;",
  "const broken: number = value;",
  "console.log('EXECUTED', typeof broken);",
  "",
].join("\n");

/*
 * Same file shape, but type-correct: proves the harness reports success when it
 * should, so a green transpile-only result is not just a broken fixture.
 */
const VALID_SOURCE: string = [
  "const value: number = 42;",
  "console.log('EXECUTED', typeof value);",
  "",
].join("\n");

interface RunResult {
  status: number | null;
  output: string;
}

const runWithTsNode: (fileName: string, transpileOnly: boolean) => RunResult = (
  fileName: string,
  transpileOnly: boolean,
): RunResult => {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (transpileOnly) {
    env["TS_NODE_TRANSPILE_ONLY"] = "1";
  } else {
    delete env["TS_NODE_TRANSPILE_ONLY"];
  }

  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["--require", "ts-node/register", path.join(FIXTURE_DIR, fileName)],
    {
      cwd: APP_ROOT,
      env,
      encoding: "utf8",
      timeout: 120000,
    },
  );

  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

describe("TS_NODE_TRANSPILE_ONLY boot behaviour", () => {
  beforeAll(() => {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(FIXTURE_DIR, "TypeError.ts"), TYPE_ERROR_SOURCE);
    fs.writeFileSync(path.join(FIXTURE_DIR, "Valid.ts"), VALID_SOURCE);
  });

  afterAll(() => {
    fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  test("without the flag, ts-node type-checks at boot and refuses to start", () => {
    /*
     * This is the cost the production images were paying on every pod start:
     * a full type-check of the reachable import graph before anything listens.
     */
    const result: RunResult = runWithTsNode("TypeError.ts", false);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("TS2322");
  }, 180000);

  test("with the flag, ts-node skips the type-check and boots", () => {
    const result: RunResult = runWithTsNode("TypeError.ts", true);

    expect(result.status).toBe(0);
    expect(result.output).toContain("EXECUTED");
  }, 180000);

  test("transpile-only still executes correct code normally", () => {
    const result: RunResult = runWithTsNode("Valid.ts", true);

    expect(result.status).toBe(0);
    expect(result.output).toContain("EXECUTED");
  }, 180000);

  test("transpile-only still surfaces genuine runtime errors", () => {
    /*
     * Skipping type-checking must not be confused with swallowing failures:
     * a real throw at runtime still has to fail the process.
     */
    fs.writeFileSync(
      path.join(FIXTURE_DIR, "Throws.ts"),
      "throw new Error('BOOM');\n",
    );

    const result: RunResult = runWithTsNode("Throws.ts", true);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("BOOM");
  }, 180000);
});
