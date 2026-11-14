import { beforeAll, describe, expect, it } from "@jest/globals";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../Models/DatabaseModels/Index";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import { StringUtils } from "../../../../../Scripts/TerraformProvider/Core/StringUtils";
import {
  TerraformDataSource,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

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

  describe("relations", () => {
    /*
     * A relation's id column and a relation list name the model they point
     * at (x-oneuptime-relation) by the tag of that model's endpoints, and a
     * client finds the model by it: the Terraform provider says which of its
     * resources an id belongs to, holds the id to one and refers to that
     * resource in its examples, and the Crossplane provider resolves a
     * reference to it. A tag no endpoint has names nothing.
     *
     * #6817 tagged a renamed model's endpoints by the name the API keeps
     * (On-Call Policy Schedule) while its relations went on naming it by its
     * new screen name (On-Call Schedule): the provider lost every relation to
     * the model, and its docs example of an on-call user group gave the
     * schedules as objects instead of ids, which Terraform refused.
     */
    it("names the model of every relation by the tag of that model's endpoints", () => {
      const tagOfTable: Map<string, string> = new Map<string, string>();

      for (const tag of (spec["tags"] || []) as Array<JSONObject>) {
        tagOfTable.set(
          tag["x-oneuptime-table"] as string,
          tag["name"] as string,
        );
      }

      const problems: Array<string> = [];
      const checked: Set<string> = new Set<string>();

      for (const schemaName of Object.keys(schemas)) {
        const properties: JSONObject = ((schemas[schemaName] as JSONObject)[
          "properties"
        ] || {}) as JSONObject;

        for (const propertyName of Object.keys(properties)) {
          const relation: JSONObject | undefined = (
            properties[propertyName] as JSONObject
          )["x-oneuptime-relation"] as JSONObject | undefined;
          const endpointsTag: string | undefined = relation
            ? tagOfTable.get(relation["tableName"] as string)
            : undefined;

          // A model with no endpoints of its own has no tag to be found by.
          if (!relation || endpointsTag === undefined) {
            continue;
          }

          checked.add(relation["tableName"] as string);

          if (relation["tag"] !== endpointsTag) {
            problems.push(
              `${schemaName}.${propertyName}: "${relation["tag"]}", its endpoints' tag is "${endpointsTag}"`,
            );
          }
        }
      }

      expect(problems).toEqual([]);

      // The models #6817 renamed are among those checked.
      expect(Array.from(checked)).toEqual(
        expect.arrayContaining([
          "OnCallDutyPolicySchedule",
          "ScheduledMaintenance",
        ]),
      );
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

    /*
     * A request that names one record by its id - read it, change it or
     * delete it - answers 404 when that record does not exist, belongs to
     * another project or is one the caller may not read. Generated clients
     * (the Terraform provider drops a resource from its state on a 404)
     * read the answer from the spec, so every such operation documents it.
     */
    it("documents the 404 of every operation that names one record by its id", () => {
      const byId: Array<{
        path: string;
        method: string;
        operation: Operation;
      }> = operations.filter((entry: { path: string; method: string }) => {
        return (
          (entry.method === "post" && entry.path.endsWith("/{id}/get-item")) ||
          ((entry.method === "put" || entry.method === "delete") &&
            entry.path.endsWith("/{id}"))
        );
      });

      // Every model's get, update and delete by id, not a handful.
      expect(byId.length).toBeGreaterThan(300);

      const missing: Array<string> = byId
        .filter((entry: { operation: Operation }) => {
          const notFound: JSONObject | undefined = entry.operation.responses?.[
            "404"
          ] as JSONObject | undefined;

          return !String(notFound?.["description"] || "").includes(
            "may not read",
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

  describe("telemetry queries", () => {
    /*
     * zod-to-openapi took the `type` the analytics schemas gave .openapi() for
     * the whole schema, so every telemetry query and sort was documented as an
     * object that allowed no field at all. They list their fields, the time
     * column every telemetry query is bounded and sorted by among them
     * (Tests/Utils/Schema/AnalyticsModelSchema holds the operators).
     */
    it("lists the fields of every telemetry table's query and sort, its time column among them", () => {
      const problems: Array<string> = [];

      for (const modelType of AnalyticsModels) {
        const model: AnalyticsBaseModel = new modelType();

        if (!model.crudApiPath) {
          continue;
        }

        for (const kind of ["QuerySchema", "SortSchema"]) {
          const properties: JSONObject = ((
            schemas[`${model.tableName}${kind}`] as JSONObject | undefined
          )?.["properties"] || {}) as JSONObject;

          if (!(model.defaultSortColumn in properties)) {
            problems.push(
              `${model.tableName}${kind}: ${Object.keys(properties).length} fields, none of them ${model.defaultSortColumn}`,
            );
          }
        }
      }

      expect(problems).toEqual([]);
    });

    it("lists the fields of every telemetry table's select and group by", () => {
      const problems: Array<string> = [];

      for (const modelType of AnalyticsModels) {
        const model: AnalyticsBaseModel = new modelType();

        if (!model.crudApiPath) {
          continue;
        }

        for (const kind of ["SelectSchema", "GroupBySchema"]) {
          const properties: JSONObject = ((
            schemas[`${model.tableName}${kind}`] as JSONObject | undefined
          )?.["properties"] || {}) as JSONObject;

          if (Object.keys(properties).length === 0) {
            problems.push(`${model.tableName}${kind}: no fields`);
          }
        }
      }

      expect(problems).toEqual([]);
    });
  });

  describe("telemetry creates and updates", () => {
    /*
     * The same `type` in AnalyticsModelSchema.getCreateModelSchema left every
     * telemetry create with no field, and every update with it: an update
     * was a copy of the create. A create lists its fields now, and an update
     * those somebody may update - on a telemetry table, none
     * (Tests/Utils/Schema/AnalyticsModelSchema holds both to what the API
     * takes).
     */
    it("lists the fields of every telemetry table's create, and none of its update", () => {
      const problems: Array<string> = [];
      let creates: number = 0;
      let updates: number = 0;

      for (const modelType of AnalyticsModels) {
        const model: AnalyticsBaseModel = new modelType();

        if (!model.crudApiPath) {
          continue;
        }

        const create: JSONObject | undefined = schemas[
          `${model.tableName}CreateSchema`
        ] as JSONObject | undefined;
        const update: JSONObject | undefined = schemas[
          `${model.tableName}UpdateSchema`
        ] as JSONObject | undefined;

        if (create) {
          creates++;

          if (!Object.keys((create["properties"] || {}) as JSONObject).length) {
            problems.push(`${model.tableName}CreateSchema: no fields`);
          }
        }

        if (update) {
          updates++;

          if (Object.keys((update["properties"] || {}) as JSONObject).length) {
            problems.push(`${model.tableName}UpdateSchema: has fields`);
          }
        }
      }

      expect(problems).toEqual([]);
      expect(creates).toBeGreaterThan(5);
      expect(updates).toBeGreaterThan(5);
    });

    /*
     * A log line or a span is a record the product keeps for a while, not
     * something to manage. Its table's tag says so, and the Terraform
     * provider reads the table and makes no resource of it - which, with a
     * create that lists its fields, it otherwise would.
     */
    it("marks every telemetry table's tag, so the Terraform provider reads the table and manages none of it", () => {
      const telemetryTags: Array<string> = AnalyticsModels.map(
        (modelType: { new (): AnalyticsBaseModel }): AnalyticsBaseModel => {
          return new modelType();
        },
      )
        .filter((model: AnalyticsBaseModel): boolean => {
          return Boolean(model.crudApiPath);
        })
        .map((model: AnalyticsBaseModel): string => {
          return model.singularName || (model.tableName as string);
        });

      expect(
        (spec["tags"] as Array<JSONObject>)
          .filter((tag: JSONObject): boolean => {
            return tag["x-oneuptime-telemetry"] === true;
          })
          .map((tag: JSONObject): string => {
            return tag["name"] as string;
          })
          .sort(),
      ).toEqual([...telemetryTags].sort());

      const parser: OpenAPIParser = new OpenAPIParser();
      parser.setSpec(spec as never);

      const resources: Array<string> = parser
        .getResources()
        .map((resource: TerraformResource): string => {
          return resource.name;
        });
      const dataSources: Array<string> = parser
        .getDataSources()
        .map((dataSource: TerraformDataSource): string => {
          return dataSource.name;
        });

      for (const tag of telemetryTags) {
        const name: string = StringUtils.toSnakeCase(tag);

        expect([
          name,
          resources.includes(name),
          dataSources.includes(name),
          parser.warnings.filter((warning: string): boolean => {
            return warning.includes(`"${name}"`);
          }),
        ]).toEqual([name, false, true, []]);
      }
    });
  });

  describe("database queries", () => {
    /*
     * The same `type` in BaseSchema left every database model's query, sort
     * and select with no field. Each lists its fields now, a query field
     * referring to its type's filter (Tests/Utils/Schema/ModelSchemaQuery
     * holds them to what the API takes). Records of a database table are not
     * grouped - findBy refuses a groupBy - so their group by lists none, and
     * no path refers to it.
     */
    it("lists the fields of every model's query, sort and select, its creation time among them", () => {
      const problems: Array<string> = [];

      for (const modelType of Models) {
        const model: DatabaseBaseModel = new modelType();

        if (
          !model.tableName ||
          !model.enableDocumentation ||
          !model.crudApiPath
        ) {
          continue;
        }

        for (const kind of ["QuerySchema", "SortSchema", "SelectSchema"]) {
          const properties: JSONObject = ((
            schemas[`${model.tableName}${kind}`] as JSONObject | undefined
          )?.["properties"] || {}) as JSONObject;

          if (!("createdAt" in properties)) {
            problems.push(
              `${model.tableName}${kind}: ${Object.keys(properties).length} fields, none of them createdAt`,
            );
          }
        }

        const groupBy: JSONObject = schemas[
          `${model.tableName}GroupBySchema`
        ] as JSONObject;

        if (Object.keys((groupBy["properties"] || {}) as JSONObject).length) {
          problems.push(`${model.tableName}GroupBySchema: has fields`);
        }
      }

      expect(problems).toEqual([]);
    });

    it("writes each operator once, in a filter every query field of its type refers to", () => {
      const queries: Array<JSONObject> = Object.keys(schemas)
        .filter((name: string): boolean => {
          return name.endsWith("QuerySchema");
        })
        .map((name: string): JSONObject => {
          return schemas[name] as JSONObject;
        });

      const refs: Set<string> = new Set();

      for (const query of queries) {
        for (const property of Object.values(
          (query["properties"] || {}) as JSONObject,
        )) {
          const ref: unknown = (property as JSONObject)["$ref"];

          if (typeof ref === "string") {
            refs.add(ref.replace("#/components/schemas/", ""));
          }
        }
      }

      expect(refs.size).toBeGreaterThan(25);

      for (const name of refs) {
        expect([name, (schemas[name] as JSONObject)["anyOf"]]).toEqual([
          name,
          expect.any(Array),
        ]);
      }
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
