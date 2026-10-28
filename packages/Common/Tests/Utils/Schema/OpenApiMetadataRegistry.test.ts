import { describe, expect, test } from "@jest/globals";
import {
  getOpenApiMetadata,
  zodToOpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import fs from "fs";
import path from "path";
import { z } from "zod";
import Zod from "../../../Utils/Schema/Zod";
import { holdOpenApiMetadataWeakly } from "../../../Utils/Schema/OpenApiMetadataRegistry";
import {
  lastJsonLine,
  runTranspileOnlyNode,
} from "../../Helpers/TranspileOnlyNode";

/*
 * zod-to-openapi keeps what .openapi() is given in zodToOpenAPIRegistry, a
 * copy of zod's $ZodRegistry built with a Map where zod's has a WeakMap: every
 * schema it ever saw stayed reachable. The App builds a schema of every model
 * at boot (the OpenAPI spec, MCP's tools), and an idle App held 560 MB of
 * them. Common's Zod module makes the registry a WeakMap
 * (Utils/Schema/OpenApiMetadataRegistry.ts).
 *
 * These hold it to that: the registry is weak once Zod.ts has loaded,
 * metadata still reads back through every modifier zod-to-openapi copies it
 * to, the library never walks the registry (a WeakMap cannot be walked), and
 * a schema nothing else holds is collected - with a control that puts the
 * library's Map back and sees the same schemas kept.
 */

const SCHEMA_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Utils",
  "Schema",
);
const ZOD_MODULE: string = path.join(SCHEMA_DIR, "Zod.ts");
const MODEL_SCHEMA_MODULE: string = path.join(SCHEMA_DIR, "ModelSchema.ts");
const MODELS_MODULE: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Models",
  "DatabaseModels",
  "Index.ts",
);
const LIBRARY_DIST: string = path.dirname(
  require.resolve("@asteasolutions/zod-to-openapi"),
);

type Registry = typeof zodToOpenAPIRegistry;

function libraryRegistrySource(file: string): string {
  // The class body of the library's own copy of $ZodRegistry.
  const text: string = fs.readFileSync(path.join(LIBRARY_DIST, file), "utf8");
  const start: number = text.indexOf("class $ZodRegistry {");
  expect(start).toBeGreaterThanOrEqual(0);
  const end: number = text.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end + 2);
}

// Each way the library's code uses `_map`, with what follows it.
const MAP_USE: RegExp = /this\._map(\s*=\s*new \w+\(\)|\.\w+\()/gu;

describe("zod-to-openapi's registry", () => {
  test("is a WeakMap once Common's Zod has loaded", () => {
    expect(Zod.string).toBe(z.string);
    expect(zodToOpenAPIRegistry._map).toBeInstanceOf(WeakMap);
    expect((zodToOpenAPIRegistry._map as unknown) instanceof Map).toBe(false);
  });

  test("is the registry .openapi() writes to: a documented schema is in it", () => {
    const documented: z.ZodType = Zod.string().openapi({
      description: "A name.",
    });

    expect(zodToOpenAPIRegistry._map.has(documented)).toBe(true);
    expect(zodToOpenAPIRegistry.get(documented)).toEqual({
      description: "A name.",
    });
  });

  test("keeps the metadata of every modifier zod-to-openapi copies it to", () => {
    const base: z.ZodString = Zod.string().openapi({
      description: "A label.",
      example: "Production",
    });
    const expected: { description: string; example: string } = {
      description: "A label.",
      example: "Production",
    };

    expect(getOpenApiMetadata(base)).toEqual(expected);
    expect(getOpenApiMetadata(base.optional())).toEqual(expected);
    expect(getOpenApiMetadata(base.nullable())).toEqual(expected);
    expect(getOpenApiMetadata(base.default("Production"))).toMatchObject(
      expected,
    );
    expect(getOpenApiMetadata(base.min(1))).toEqual(expected);
    expect(getOpenApiMetadata(base.max(10))).toEqual(expected);

    const object: z.ZodObject<{ name: z.ZodString }> = Zod.object({
      name: Zod.string(),
    }).openapi("PerfMemoryLabel", { description: "A labelled thing." });
    const extended: z.ZodType = object.extend({ color: Zod.string() });

    expect(getOpenApiMetadata(object)).toEqual({
      description: "A labelled thing.",
    });
    expect(getOpenApiMetadata(extended)).toEqual({
      description: "A labelled thing.",
    });
  });

  test("a registry made with a Map keeps every entry it had, and clear() keeps it weak", () => {
    const LibraryRegistry: new () => Registry =
      zodToOpenAPIRegistry.constructor as unknown as new () => Registry;
    const registry: Registry = new LibraryRegistry();

    // The library's own copy is built with a Map: what this file fixes.
    expect((registry._map as unknown) instanceof Map).toBe(true);

    const first: z.ZodString = z.string();
    const second: z.ZodNumber = z.number();
    registry.add(first, { description: "first" });
    registry.add(second, { description: "second" });

    holdOpenApiMetadataWeakly(registry);

    expect(registry._map).toBeInstanceOf(WeakMap);
    expect(registry.get(first)).toEqual({ description: "first" });
    expect(registry.get(second)).toEqual({ description: "second" });
    expect(registry.has(first)).toBe(true);

    registry.remove(first);
    expect(registry.has(first)).toBe(false);
    expect(registry.has(second)).toBe(true);

    expect(registry.clear()).toBe(registry);
    expect(registry._map).toBeInstanceOf(WeakMap);
    expect(registry._idmap).toBeInstanceOf(Map);
    expect(registry.has(second)).toBe(false);

    // Run twice, it changes nothing.
    registry.add(first, { description: "again" });
    holdOpenApiMetadataWeakly(registry);
    expect(registry._map).toBeInstanceOf(WeakMap);
    expect(registry.get(first)).toEqual({ description: "again" });
  });

  test.each(["index.cjs", "index.mjs"])(
    "the library's %s only gets, sets, checks and deletes entries by schema - what a WeakMap does",
    (file: string) => {
      /*
       * A WeakMap cannot be walked or counted. If a zod-to-openapi release
       * iterates its registry (forEach, keys, size ...), this fails before
       * the release does, and OpenApiMetadataRegistry.ts must be read again.
       * Both builds: the server loads the CommonJS one, the frontends'
       * bundler the ES module.
       */
      const source: string = libraryRegistrySource(file);
      const uses: Array<string> = [];

      for (const match of source.matchAll(MAP_USE)) {
        uses.push((match[1] || "").replace(/\s+/gu, " ").trim());
      }

      expect([...new Set(uses)].sort()).toEqual([
        ".delete(",
        ".get(",
        ".has(",
        ".set(",
        "= new Map()",
      ]);
      // Every mention of _map is one of those.
      expect(source.split("_map").length - 1).toBe(uses.length);

      // Nothing outside the class touches it.
      const whole: string = fs.readFileSync(
        path.join(LIBRARY_DIST, file),
        "utf8",
      );
      expect(whole.split("_map").length - 1).toBe(uses.length);
    },
  );
});

describe("a schema nothing else holds", () => {
  /*
   * In a fresh Node, as the server loads Common: schemas with .openapi()
   * (and the modifiers zod-to-openapi copies metadata to) are made and
   * dropped, then collected. The control puts zod-to-openapi's Map back.
   */
  const script: (control: boolean) => string = (control: boolean): string => {
    return [
      `const Zod = require(${JSON.stringify(ZOD_MODULE)}).default;`,
      'const { zodToOpenAPIRegistry } = require("@asteasolutions/zod-to-openapi");',
      control ? "zodToOpenAPIRegistry._map = new Map();" : "",
      "const refs = [];",
      // In a function, so nothing of the last round stays on the stack.
      "function make() {",
      "  for (let i = 0; i < 500; i++) {",
      "    const documented = Zod.object({",
      "      name: Zod.string().openapi({ description: 'A name ' + i }),",
      "      count: Zod.number().optional().openapi({ example: i }),",
      "    }).openapi({ description: 'Thing ' + i });",
      "    // .optional() of a documented schema is registered too.",
      "    refs.push(new WeakRef(documented), new WeakRef(documented.optional()));",
      "  }",
      "}",
      "make();",
      "(async () => {",
      "  for (let round = 0; round < 3; round++) {",
      "    await new Promise((resolve) => setImmediate(resolve));",
      "    global.gc();",
      "  }",
      "  const alive = [];",
      "  refs.forEach((ref, index) => {",
      "    if (ref.deref() !== undefined) alive.push(index);",
      "  });",
      "  console.log(JSON.stringify({ made: refs.length, alive: alive }));",
      "})();",
    ].join("\n");
  };

  test("is collected, metadata and all", () => {
    const report: { made: number; alive: Array<number> } = lastJsonLine<{
      made: number;
      alive: Array<number>;
    }>(
      runTranspileOnlyNode(script(false), {
        cwd: SCHEMA_DIR,
        nodeArgs: ["--expose-gc"],
      }),
    );

    expect(report.made).toBe(1000);
    /*
     * zod itself keeps the first object schema a process makes (plain zod,
     * without zod-to-openapi, does the same): at most that one survives.
     */
    expect(
      report.alive.filter((index: number): boolean => {
        return index > 0;
      }),
    ).toEqual([]);
  });

  test("control: with the library's Map every one of them is kept", () => {
    const report: { made: number; alive: Array<number> } = lastJsonLine<{
      made: number;
      alive: Array<number>;
    }>(
      runTranspileOnlyNode(script(true), {
        cwd: SCHEMA_DIR,
        nodeArgs: ["--expose-gc"],
      }),
    );

    expect(report.made).toBe(1000);
    expect(report.alive).toHaveLength(1000);
  });
});

describe("the model schemas the App builds at boot", () => {
  /*
   * The leak as the App had it: the OpenAPI spec and MCP's tools build every
   * model's schemas. Built again and again here (60 models, five rounds),
   * the heap after a full collection comes back to where the first round
   * left it; with the library's Map it grows by every round.
   */
  const script: (control: boolean) => string = (control: boolean): string => {
    return [
      `const { ModelSchema } = require(${JSON.stringify(MODEL_SCHEMA_MODULE)});`,
      `const Models = require(${JSON.stringify(MODELS_MODULE)}).default;`,
      'const { zodToOpenAPIRegistry } = require("@asteasolutions/zod-to-openapi");',
      control ? "zodToOpenAPIRegistry._map = new Map();" : "",
      "const models = Models.slice(0, 60);",
      "function build() {",
      "  for (const modelType of models) {",
      "    ModelSchema.getModelSchema({ modelType });",
      "    ModelSchema.getQueryModelSchema({ modelType });",
      "    ModelSchema.getSelectModelSchema({ modelType });",
      "    ModelSchema.getSortModelSchema({ modelType });",
      "    ModelSchema.getCreateModelSchema({ modelType });",
      "  }",
      "}",
      "(async () => {",
      "  const heap = [];",
      "  for (let round = 0; round < 5; round++) {",
      "    build();",
      "    for (let i = 0; i < 3; i++) {",
      "      await new Promise((resolve) => setImmediate(resolve));",
      "      global.gc();",
      "    }",
      "    heap.push(process.memoryUsage().heapUsed);",
      "  }",
      "  console.log(JSON.stringify({ heap: heap }));",
      "})();",
    ].join("\n");
  };

  function growthInMb(control: boolean): number {
    const report: { heap: Array<number> } = lastJsonLine<{
      heap: Array<number>;
    }>(
      runTranspileOnlyNode(script(control), {
        cwd: SCHEMA_DIR,
        nodeArgs: ["--expose-gc"],
        timeoutMs: 240000,
      }),
    );

    expect(report.heap).toHaveLength(5);
    // From the first round to the last: what four more rounds kept.
    return (
      ((report.heap[4] as number) - (report.heap[0] as number)) / 1048576
    );
  }

  test("are not kept: the heap comes back after each round", () => {
    expect(growthInMb(false)).toBeLessThan(5);
  }, 300000);

  test("control: with the library's Map every round is kept", () => {
    expect(growthInMb(true)).toBeGreaterThan(40);
  }, 300000);
});
