import { beforeAll, describe, expect, it } from "@jest/globals";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";

/*
 * The published OpenAPI specification, as a contract.
 *
 * The spec is what every generated client is built from: the Terraform
 * provider under Scripts/TerraformProvider parses it, and anybody pointing a
 * generator at OneUptime consumes it. So a defect here is not a cosmetic one
 * -- it breaks code generation for everybody downstream.
 *
 * The CI job that produces this file (.github/workflows/openapi-spec-generation.yml)
 * asserts three things: the file exists, `jq` can parse it, and it has
 * `openapi`, `info` and `paths` keys. Everything below is what that check
 * cannot see. A spec with a `$ref` pointing at a schema that was never
 * registered, with two operations sharing an operationId, or with an operation
 * carrying no success response at all is valid JSON with all three keys
 * present -- and useless to a generator.
 *
 * The whole spec is generated once for the suite, because generating it walks
 * every database and analytics model in the product.
 */

interface Operation {
  operationId?: string;
  tags?: Array<string>;
  responses?: JSONObject;
  security?: unknown;
}

/*
 * Extracted to a named const so the callsite reads `RE_X.test(...)` rather
 * than `!/.../.test(...)`, which eslint's wrap-regex rule rejects here.
 */
const RE_HTTP_STATUS: RegExp = /^[1-5]\d{2}$/;

const HTTP_METHODS: Array<string> = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

describe("OpenAPI specification", () => {
  let spec: JSONObject;
  let paths: JSONObject;
  let schemas: JSONObject;

  /* Every (path, method, operation) triple in the document, flattened. */
  let operations: Array<{
    path: string;
    method: string;
    operation: Operation;
  }>;

  beforeAll(() => {
    spec = OpenAPIUtil.generateOpenAPISpec();
    paths = (spec["paths"] || {}) as JSONObject;
    schemas = ((spec["components"] as JSONObject | undefined)?.["schemas"] ||
      {}) as JSONObject;

    operations = [];

    for (const path of Object.keys(paths)) {
      const pathItem: JSONObject = paths[path] as JSONObject;

      for (const method of HTTP_METHODS) {
        const operation: Operation | undefined = pathItem[method] as
          | Operation
          | undefined;

        if (operation) {
          operations.push({ path, method, operation });
        }
      }
    }
    /*
     * Generating the spec walks every database and analytics model in the
     * product and took ~55s cold on a developer machine, against the 60s
     * suite-wide testTimeout in jest.config.json. A CI runner is slower and
     * colder than that, so this hook gets its own generous bound rather than
     * sitting one bad minute away from failing the build.
     */
  }, 300000);

  describe("document shape", () => {
    it("declares an OpenAPI 3 version", () => {
      expect(String(spec["openapi"])).toMatch(/^3\./);
    });

    it("carries a title and a version", () => {
      const info: JSONObject = spec["info"] as JSONObject;

      expect(info["title"]).toBeTruthy();
      expect(info["version"]).toBeTruthy();
    });

    it("declares at least one server", () => {
      expect(Array.isArray(spec["servers"])).toBe(true);
      expect((spec["servers"] as Array<unknown>).length).toBeGreaterThan(0);
    });

    it("documents a non-trivial number of paths", () => {
      expect(Object.keys(paths).length).toBeGreaterThan(0);
    });

    it("has at least one operation on every path it lists", () => {
      const empty: Array<string> = Object.keys(paths).filter((path: string) => {
        const pathItem: JSONObject = paths[path] as JSONObject;

        return !HTTP_METHODS.some((method: string) => {
          return Boolean(pathItem[method]);
        });
      });

      expect(empty).toEqual([]);
    });

    it("starts every path with a slash, as the spec requires", () => {
      const malformed: Array<string> = Object.keys(paths).filter(
        (path: string) => {
          return !path.startsWith("/");
        },
      );

      expect(malformed).toEqual([]);
    });
  });

  describe("authentication", () => {
    /*
     * Every documented endpoint needs an API key. A spec that omits the scheme
     * generates clients with no way to authenticate at all.
     */
    it("declares the ApiKey security scheme", () => {
      const schemes: JSONObject = (spec["components"] as JSONObject)[
        "securitySchemes"
      ] as JSONObject;

      expect(schemes["ApiKey"]).toBeDefined();

      const apiKey: JSONObject = schemes["ApiKey"] as JSONObject;

      expect(apiKey["type"]).toBe("apiKey");
      expect(apiKey["in"]).toBe("header");
      expect(apiKey["name"]).toBeTruthy();
    });

    it("applies that scheme globally", () => {
      const security: Array<JSONObject> = spec["security"] as Array<JSONObject>;

      expect(Array.isArray(security)).toBe(true);
      expect(security.length).toBeGreaterThan(0);
      expect(security[0]).toHaveProperty("ApiKey");
    });

    /*
     * A global requirement only covers an operation that does not override it.
     * An operation declaring `security: []` opts out entirely, which on this
     * API would document an authenticated endpoint as anonymous.
     */
    it("has no operation that opts out of security", () => {
      const anonymous: Array<string> = operations
        .filter((entry: { operation: Operation }) => {
          return (
            Array.isArray(entry.operation.security) &&
            (entry.operation.security as Array<unknown>).length === 0
          );
        })
        .map((entry: { path: string; method: string }) => {
          return `${entry.method.toUpperCase()} ${entry.path}`;
        });

      expect(anonymous).toEqual([]);
    });
  });

  describe("operations", () => {
    it("gives every operation an operationId", () => {
      const missing: Array<string> = operations
        .filter((entry: { operation: Operation }) => {
          return !entry.operation.operationId;
        })
        .map((entry: { path: string; method: string }) => {
          return `${entry.method.toUpperCase()} ${entry.path}`;
        });

      expect(missing).toEqual([]);
    });

    /*
     * Generators name the client method after the operationId. Two operations
     * sharing one produce a client where the second silently overwrites the
     * first, and the endpoint it belonged to becomes unreachable.
     */
    it("gives every operation a unique operationId", () => {
      const seen: Map<string, string> = new Map();
      const duplicates: Array<string> = [];

      for (const entry of operations) {
        const id: string = entry.operation.operationId as string;

        if (!id) {
          continue;
        }

        const where: string = `${entry.method.toUpperCase()} ${entry.path}`;
        const previous: string | undefined = seen.get(id);

        if (previous) {
          duplicates.push(`${id}: ${previous} and ${where}`);
        } else {
          seen.set(id, where);
        }
      }

      expect(duplicates).toEqual([]);
    });

    it("tags every operation", () => {
      const untagged: Array<string> = operations
        .filter((entry: { operation: Operation }) => {
          return (
            !Array.isArray(entry.operation.tags) ||
            entry.operation.tags.length === 0
          );
        })
        .map((entry: { path: string; method: string }) => {
          return `${entry.method.toUpperCase()} ${entry.path}`;
        });

      expect(untagged).toEqual([]);
    });

    /*
     * A tag that is not declared at the top level gets no description in the
     * rendered documentation, and generators that group by tag put the
     * endpoint in a section with no name.
     */
    it("declares every tag an operation uses", () => {
      const declared: Set<string> = new Set(
        ((spec["tags"] || []) as Array<{ name: string }>).map(
          (tag: { name: string }) => {
            return tag.name;
          },
        ),
      );

      const undeclared: Set<string> = new Set<string>();

      for (const entry of operations) {
        for (const tag of entry.operation.tags || []) {
          if (!declared.has(tag)) {
            undeclared.add(tag);
          }
        }
      }

      expect(Array.from(undeclared)).toEqual([]);
    });

    it("gives every declared tag a description", () => {
      const withoutDescription: Array<string> = (
        (spec["tags"] || []) as Array<{ name: string; description?: string }>
      )
        .filter((tag: { description?: string }) => {
          return !tag.description;
        })
        .map((tag: { name: string }) => {
          return tag.name;
        });

      expect(withoutDescription).toEqual([]);
    });

    it("sorts the declared tags", () => {
      const names: Array<string> = (
        (spec["tags"] || []) as Array<{ name: string }>
      ).map((tag: { name: string }) => {
        return tag.name;
      });

      const sorted: Array<string> = [...names].sort(
        (a: string, b: string): number => {
          return a.localeCompare(b);
        },
      );

      expect(names).toEqual(sorted);
    });
  });

  describe("responses", () => {
    it("documents responses for every operation", () => {
      const missing: Array<string> = operations
        .filter((entry: { operation: Operation }) => {
          return (
            !entry.operation.responses ||
            Object.keys(entry.operation.responses).length === 0
          );
        })
        .map((entry: { path: string; method: string }) => {
          return `${entry.method.toUpperCase()} ${entry.path}`;
        });

      expect(missing).toEqual([]);
    });

    /*
     * A generated client types its return value from the success response. An
     * operation documenting only failures generates a method that can only
     * return an error.
     */
    it("documents a success response for every operation", () => {
      const missing: Array<string> = operations
        .filter((entry: { operation: Operation }) => {
          return !Object.keys(entry.operation.responses || {}).some(
            (status: string) => {
              return status.startsWith("2") || status === "default";
            },
          );
        })
        .map((entry: { path: string; method: string }) => {
          return `${entry.method.toUpperCase()} ${entry.path}`;
        });

      expect(missing).toEqual([]);
    });

    it("uses only numeric statuses or 'default' as response keys", () => {
      const malformed: Array<string> = [];

      for (const entry of operations) {
        for (const status of Object.keys(entry.operation.responses || {})) {
          if (status !== "default" && !RE_HTTP_STATUS.test(status)) {
            malformed.push(
              `${entry.method.toUpperCase()} ${entry.path}: ${status}`,
            );
          }
        }
      }

      expect(malformed).toEqual([]);
    });
  });

  describe("schema references", () => {
    /*
     * The check the CI job cannot make. A `$ref` naming a schema that was
     * never registered parses as valid JSON and has every required top-level
     * key, and then every generator pointed at the document fails on it.
     */
    it("resolves every component reference to a registered schema", () => {
      const referenced: Set<string> = new Set<string>();

      const walk: (node: unknown) => void = (node: unknown): void => {
        if (!node || typeof node !== "object") {
          return;
        }

        if (Array.isArray(node)) {
          for (const item of node) {
            walk(item);
          }

          return;
        }

        const record: Record<string, unknown> = node as Record<string, unknown>;

        for (const key of Object.keys(record)) {
          const value: unknown = record[key];

          if (key === "$ref" && typeof value === "string") {
            referenced.add(value);
            continue;
          }

          walk(value);
        }
      };

      walk(spec);

      const components: JSONObject =
        (spec["components"] as JSONObject | undefined) || {};

      const dangling: Array<string> = Array.from(referenced).filter(
        (ref: string) => {
          const match: RegExpMatchArray | null = ref.match(
            /^#\/components\/([^/]+)\/(.+)$/,
          );

          if (!match) {
            /* Anything that is not a local component ref is out of scope. */
            return false;
          }

          const section: JSONObject | undefined = components[
            match[1] as string
          ] as JSONObject | undefined;

          return !section || !((match[2] as string) in section);
        },
      );

      expect(dangling).toEqual([]);
    });

    it("registers at least one component schema", () => {
      expect(Object.keys(schemas).length).toBeGreaterThan(0);
    });

    it("gives every registered schema a type or a composition keyword", () => {
      const shapeless: Array<string> = Object.keys(schemas).filter(
        (name: string) => {
          const schema: JSONObject = schemas[name] as JSONObject;

          return (
            schema["type"] === undefined &&
            schema["allOf"] === undefined &&
            schema["oneOf"] === undefined &&
            schema["anyOf"] === undefined &&
            schema["$ref"] === undefined &&
            schema["properties"] === undefined
          );
        },
      );

      expect(shapeless).toEqual([]);
    });
  });

  describe("path parameters", () => {
    /*
     * A `{placeholder}` in a path with no matching parameter definition is a
     * generated client method that cannot fill in the URL it is meant to call.
     */
    it("declares every placeholder its path template uses", () => {
      const missing: Array<string> = [];

      for (const path of Object.keys(paths)) {
        const placeholders: Array<string> = Array.from(
          path.matchAll(/\{([^}]+)\}/g),
        ).map((match: RegExpMatchArray) => {
          return match[1] as string;
        });

        if (placeholders.length === 0) {
          continue;
        }

        const pathItem: JSONObject = paths[path] as JSONObject;

        const pathLevel: Array<JSONObject> = (pathItem["parameters"] ||
          []) as Array<JSONObject>;

        for (const method of HTTP_METHODS) {
          const operation: JSONObject | undefined = pathItem[method] as
            | JSONObject
            | undefined;

          if (!operation) {
            continue;
          }

          const declared: Set<string> = new Set<string>();

          for (const parameter of [
            ...pathLevel,
            ...((operation["parameters"] || []) as Array<JSONObject>),
          ]) {
            if (parameter["in"] === "path") {
              declared.add(String(parameter["name"]));
            }
          }

          for (const placeholder of placeholders) {
            if (!declared.has(placeholder)) {
              missing.push(`${method.toUpperCase()} ${path}: {${placeholder}}`);
            }
          }
        }
      }

      expect(missing).toEqual([]);
    });

    it("marks every path parameter required, as the spec demands", () => {
      const optional: Array<string> = [];

      for (const path of Object.keys(paths)) {
        const pathItem: JSONObject = paths[path] as JSONObject;

        for (const method of [...HTTP_METHODS, "parameters"]) {
          const holder: JSONObject | undefined = pathItem[method] as
            | JSONObject
            | undefined;

          if (!holder) {
            continue;
          }

          const parameters: Array<JSONObject> =
            method === "parameters"
              ? (pathItem["parameters"] as Array<JSONObject>)
              : ((holder["parameters"] || []) as Array<JSONObject>);

          for (const parameter of parameters || []) {
            if (parameter["in"] === "path" && parameter["required"] !== true) {
              optional.push(`${path}: ${String(parameter["name"])}`);
            }
          }
        }
      }

      expect(optional).toEqual([]);
    });
  });

  describe("caching", () => {
    /*
     * The spec is expensive to build -- it walks every model in the product --
     * so it is cached. The cached value must be the same document, not a
     * rebuild that could drift from the one already handed out.
     */
    it("returns the identical document on a second call", () => {
      expect(OpenAPIUtil.generateOpenAPISpec()).toBe(spec);
    });
  });
});
