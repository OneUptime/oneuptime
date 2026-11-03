import { Command } from "commander";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  DBT_ARTIFACTS_INGEST_PATH,
  buildDbtUpload,
  describeDbtUpload,
  readDbtArtifact,
  resolveDbtArtifactPaths,
} from "../Commands/DbtCommands";
import { buildProgram } from "../Program";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * oneuptime dbt upload sends a dbt project's artifacts after a build: it
 * reads target/manifest.json and target/run_results.json, sends only what
 * Data Observability reads of them, and posts them with a telemetry
 * ingestion key.
 */

const CONFIG_FILE: string = path.join(
  os.homedir(),
  ".oneuptime",
  "config.json",
);
const URL_ENV: string = "ONEUPTIME_URL";
const KEY_ENV: string = "ONEUPTIME_TELEMETRY_INGESTION_KEY";

const MANIFEST: JSONObject = {
  metadata: {
    project_name: "jaffle_shop",
    adapter_type: "postgres",
    dbt_version: "1.8.0",
    env: { SECRET: "never sent" },
  },
  nodes: {
    "model.jaffle_shop.orders": {
      unique_id: "model.jaffle_shop.orders",
      resource_type: "model",
      name: "orders",
      database: "jaffle",
      schema: "public",
      alias: "orders",
      config: { materialized: "table", post_hook: [] },
      depends_on: { nodes: ["model.jaffle_shop.stg_orders"], macros: ["m"] },
      compiled_code: "select * from stg_orders",
      raw_code: "select * from {{ ref('stg_orders') }}",
    },
    "test.jaffle_shop.not_null_orders_order_id.cf6c17daed": {
      unique_id: "test.jaffle_shop.not_null_orders_order_id.cf6c17daed",
      resource_type: "test",
      name: "not_null_orders_order_id",
      test_metadata: {
        name: "not_null",
        kwargs: { column_name: "order_id", model: "{{ ref('orders') }}" },
      },
      attached_node: "model.jaffle_shop.orders",
      compiled_code: "select order_id from orders where order_id is null",
    },
    "operation.jaffle_shop.on-run-end": {
      unique_id: "operation.jaffle_shop.on-run-end",
      resource_type: "operation",
    },
  },
  sources: {
    "source.jaffle_shop.raw.orders": {
      unique_id: "source.jaffle_shop.raw.orders",
      resource_type: "source",
      name: "orders",
      identifier: "raw_orders",
      schema: "raw",
      database: "jaffle",
    },
  },
  macros: { "macro.dbt.big": { macro_sql: "..." } },
};

const RUN_RESULTS: JSONObject = {
  metadata: {
    generated_at: "2026-11-03T11:00:00Z",
    invocation_id: "01890a5d-ac96-774b-b8e4-2b2c3b3f4c5d",
    env: { SECRET: "never sent" },
  },
  elapsed_time: 12.5,
  args: { which: "build", vars: { secret: "never sent" } },
  results: [
    {
      unique_id: "model.jaffle_shop.orders",
      status: "success",
      execution_time: 1.2,
      timing: [],
      message: "SELECT 99",
      failures: null,
      adapter_response: { rows_affected: 99 },
      compiled_code: "select ...",
    },
  ],
};

describe("what is sent of the artifacts", () => {
  test("only what Data Observability reads, never the rest", () => {
    const upload: JSONObject = buildDbtUpload({
      manifest: MANIFEST,
      runResults: RUN_RESULTS,
      project: " jaffle_shop ",
    });
    const manifest: JSONObject = upload["manifest"] as JSONObject;
    const nodes: JSONObject = manifest["nodes"] as JSONObject;

    expect(manifest["metadata"]).toEqual({
      project_name: "jaffle_shop",
      adapter_type: "postgres",
      dbt_version: "1.8.0",
    });
    // Tables and tests; no operation, no macro.
    expect(Object.keys(nodes).sort()).toEqual([
      "model.jaffle_shop.orders",
      "test.jaffle_shop.not_null_orders_order_id.cf6c17daed",
    ]);
    expect(manifest["macros"]).toBe(undefined);
    expect(nodes["model.jaffle_shop.orders"]).toEqual({
      unique_id: "model.jaffle_shop.orders",
      resource_type: "model",
      name: "orders",
      database: "jaffle",
      schema: "public",
      alias: "orders",
      config: { materialized: "table" },
      depends_on: { nodes: ["model.jaffle_shop.stg_orders"] },
    });
    // A test keeps its SQL, to show what it reads.
    expect(
      (
        nodes[
          "test.jaffle_shop.not_null_orders_order_id.cf6c17daed"
        ] as JSONObject
      )["compiled_code"],
    ).toBe("select order_id from orders where order_id is null");
    expect(Object.keys(manifest["sources"] as JSONObject)).toEqual([
      "source.jaffle_shop.raw.orders",
    ]);

    expect(upload["run_results"]).toEqual({
      metadata: {
        generated_at: "2026-11-03T11:00:00Z",
        invocation_id: "01890a5d-ac96-774b-b8e4-2b2c3b3f4c5d",
      },
      elapsed_time: 12.5,
      args: { which: "build" },
      results: [
        {
          unique_id: "model.jaffle_shop.orders",
          status: "success",
          execution_time: 1.2,
          timing: [],
          message: "SELECT 99",
          failures: null,
        },
      ],
    });
    expect(upload["project"]).toBe("jaffle_shop");
    expect(JSON.stringify(upload)).not.toContain("never sent");
  });

  test("either artifact alone", () => {
    expect(
      Object.keys(buildDbtUpload({ manifest: null, runResults: RUN_RESULTS })),
    ).toEqual(["run_results"]);
  });
});

describe("where the artifacts are read from", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbt-target-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("dbt's target folder, unless a file is named", () => {
    expect(resolveDbtArtifactPaths({})).toEqual({
      manifestPath: path.join("target", "manifest.json"),
      runResultsPath: path.join("target", "run_results.json"),
      isManifestNamed: false,
      isRunResultsNamed: false,
    });
    expect(
      resolveDbtArtifactPaths({
        targetPath: "build/target",
        runResults: "results.json",
      }),
    ).toMatchObject({
      manifestPath: path.join("build/target", "manifest.json"),
      runResultsPath: "results.json",
      isRunResultsNamed: true,
    });
  });

  test("a default file that is missing is none; a named one is an error", () => {
    const missing: string = path.join(directory, "manifest.json");

    expect(readDbtArtifact(missing, false)).toBe(null);
    expect(() => {
      return readDbtArtifact(missing, true);
    }).toThrow(`There is no file at ${missing}.`);
  });

  test("a file that is not dbt's JSON is an error", () => {
    const broken: string = path.join(directory, "manifest.json");
    fs.writeFileSync(broken, "{not json");

    expect(() => {
      return readDbtArtifact(broken, false);
    }).toThrow("is not a JSON file dbt wrote.");
  });
});

describe("describeDbtUpload", () => {
  test("says what OneUptime matched and recorded", () => {
    expect(
      describeDbtUpload({
        projectName: "jaffle_shop",
        tables: 15,
        matchedTables: 12,
        tests: 34,
        matchedTests: 30,
        testResults: 30,
        run: "FAIL",
      }),
    ).toBe(
      "Uploaded dbt project jaffle_shop: 12 of 15 models, seeds, snapshots and sources matched watched tables, 30 of 34 tests are on them, 30 test results recorded, the build is recorded as failed.",
    );
    expect(describeDbtUpload({ projectName: "jaffle_shop", tables: 0 })).toBe(
      "Uploaded dbt project jaffle_shop.",
    );
  });
});

describe("oneuptime dbt upload", () => {
  let directory: string;
  let post: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }

    delete process.env[URL_ENV];
    delete process.env[KEY_ENV];
    process.env["NO_COLOR"] = "1";
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbt-target-"));
    post = jest.spyOn(API, "post").mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          projectName: "jaffle_shop",
          tables: 2,
          matchedTables: 1,
          tests: 1,
          matchedTests: 1,
          testResults: 0,
          run: "COMPLETE",
        },
        {},
      ),
    );
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env[URL_ENV];
    delete process.env[KEY_ENV];
    delete process.env["NO_COLOR"];
  });

  async function upload(args: Array<string>): Promise<void> {
    const program: Command = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "oneuptime", "dbt", "upload", ...args]);
  }

  test("sends both artifacts of the target folder with the ingestion key", async () => {
    fs.writeFileSync(
      path.join(directory, "manifest.json"),
      JSON.stringify(MANIFEST),
    );
    fs.writeFileSync(
      path.join(directory, "run_results.json"),
      JSON.stringify(RUN_RESULTS),
    );

    await upload([
      "--target-path",
      directory,
      "--url",
      "https://oneuptime.example.com",
      "--ingestion-key",
      "key-1",
    ]);

    const request: JSONObject = post.mock.calls[0][0] as JSONObject;

    expect(String(request["url"])).toBe(
      `https://oneuptime.example.com${DBT_ARTIFACTS_INGEST_PATH}`,
    );
    expect((request["headers"] as JSONObject)["x-oneuptime-token"]).toBe(
      "key-1",
    );
    expect(Object.keys(request["data"] as JSONObject).sort()).toEqual([
      "manifest",
      "run_results",
    ]);
    expect(request["options"]).toEqual({ sameServerRedirectsOnly: true });
    expect(logSpy).toHaveBeenCalledWith(
      "Uploaded dbt project jaffle_shop: 1 of 2 models, seeds, snapshots and sources matched watched tables, 1 of 1 tests are on them, the build is recorded.",
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("with no artifacts, says to build first and sends nothing", async () => {
    await upload([
      "--target-path",
      directory,
      "--url",
      "https://oneuptime.example.com",
      "--ingestion-key",
      "key-1",
    ]);

    expect(post).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(" ")).toContain(
      "run dbt build first",
    );
    expect(exitSpy).toHaveBeenCalled();
  });
});
