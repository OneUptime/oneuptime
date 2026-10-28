import { zodToOpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

/*
 * zod-to-openapi keeps what .openapi() is given in a registry of its own,
 * keyed by schema: a copy of zod's $ZodRegistry (zodToOpenAPIRegistry). zod's
 * registry holds its schemas in a WeakMap, and zod-to-openapi's copy is typed
 * as one - but it is built with a Map. So every schema that .openapi() was
 * ever called on, and every .optional(), .nullable(), .default() ... of one
 * (zod-to-openapi copies the metadata to each), stayed reachable for as long
 * as the process ran, and with it every schema it is made of.
 *
 * The App builds a schema of every model when it boots, to write its OpenAPI
 * spec and MCP's tools: 149,000 schemas, and 560 MB of an idle App's 1.4 GB
 * heap, kept after both were written. The frontends build fewer, the same way.
 *
 * Held in a WeakMap, as zod holds its own, a schema's metadata lives exactly
 * as long as the schema: zod-to-openapi only ever gets, sets, checks and
 * deletes entries by schema, which a WeakMap does the same (it never walks
 * them). Tests/Utils/Schema/OpenApiMetadataRegistry holds the library's
 * registry to that, and a schema nothing else holds to being collected.
 */

type Registry = typeof zodToOpenAPIRegistry;

export function holdOpenApiMetadataWeakly(registry: Registry): void {
  const current: unknown = registry._map;

  if (current instanceof Map) {
    // Whatever was registered before this ran keeps its metadata.
    const weak: Registry["_map"] = new WeakMap();

    for (const [schema, metadata] of current) {
      weak.set(schema, metadata);
    }

    registry._map = weak;
  }

  // clear() makes a new Map in zod-to-openapi's copy.
  registry.clear = function clear(this: Registry): Registry {
    this._map = new WeakMap();
    this._idmap = new Map();
    return this;
  };
}
