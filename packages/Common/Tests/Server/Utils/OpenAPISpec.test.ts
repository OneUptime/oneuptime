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
  TerraformAttribute,
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

  /*
   * A PROJECT'S OWN TWILIO ACCOUNT AND MAIL SERVER (#7737).
   *
   * Settings > Notification Channels: the Twilio account that sends a
   * project's SMS and makes its calls, and the mail server that sends its
   * email, in place of OneUptime's own. Both had a CRUD API that the API
   * reference and this spec left out, and so did the Terraform provider
   * generated from it: a customer who sets OneUptime up from Terraform
   * could not set these up there. They are documented now. Every credential
   * of theirs is a secret as the spec says it (ModelSchema.isSecretColumn),
   * and the provider marks it Sensitive, so a plan, a log or an output
   * never prints it.
   */
  describe("a project's own Twilio account and mail server", () => {
    interface Channel {
      tableName: string;
      tag: string;
      crudApiPath: string;
      resource: string;
      secrets: Array<string>;
      // The secrets the spec also writes as format: password.
      passwords: Array<string>;
    }

    const TWILIO: Channel = {
      tableName: "ProjectCallSMSConfig",
      tag: "Call and SMS Config",
      crudApiPath: "/call-sms-config",
      resource: "call_and_sms_config",
      secrets: ["twilioAuthToken"],
      passwords: ["twilioAuthToken"],
    };

    const MAIL: Channel = {
      tableName: "ProjectSMTPConfig",
      tag: "SMTP Config",
      crudApiPath: "/smtp-config",
      resource: "smtp_config",
      secrets: [
        "amazonSesSecretAccessKey",
        "clientSecret",
        "mailgunApiKey",
        "password",
        "postmarkServerToken",
        "resendApiKey",
        "sendgridApiKey",
      ],
      /*
       * The encrypted keys, and the password, a Password column. The OAuth
       * client secret is marked `secret` and keeps its text format.
       */
      passwords: [
        "amazonSesSecretAccessKey",
        "mailgunApiKey",
        "password",
        "postmarkServerToken",
        "resendApiKey",
        "sendgridApiKey",
      ],
    };

    const CHANNELS: Array<Channel> = [TWILIO, MAIL];

    const SCHEMA_KINDS: Array<string> = [
      "",
      "CreateSchema",
      "ReadSchema",
      "UpdateSchema",
    ];

    let parser: OpenAPIParser;

    beforeAll(() => {
      parser = new OpenAPIParser();
      parser.setSpec(spec as never);
    });

    function getProperties(name: string): JSONObject {
      return ((schemas[name] as JSONObject | undefined)?.["properties"] ||
        {}) as JSONObject;
    }

    function getResource(channel: Channel): TerraformResource {
      const resource: TerraformResource | undefined = parser
        .getResources()
        .find((candidate: TerraformResource): boolean => {
          return candidate.name === channel.resource;
        });

      if (!resource) {
        throw new Error(`no resource ${channel.resource}`);
      }

      return resource;
    }

    function getDataSource(channel: Channel): TerraformDataSource {
      const dataSource: TerraformDataSource | undefined = parser
        .getDataSources()
        .find((candidate: TerraformDataSource): boolean => {
          return candidate.name === channel.resource;
        });

      if (!dataSource) {
        throw new Error(`no data source ${channel.resource}`);
      }

      return dataSource;
    }

    function getSnakeNames(names: Array<string>): Array<string> {
      return names
        .map((name: string): string => {
          return StringUtils.toLegacySnakeCase(name);
        })
        .sort();
    }

    it.each(CHANNELS)(
      "documents every endpoint of $tableName, under its own tag",
      (channel: Channel) => {
        const tagged: Array<string> = operations
          .filter(
            (entry: {
              path: string;
              method: string;
              operation: Operation;
            }): boolean => {
              return Boolean(entry.operation.tags?.includes(channel.tag));
            },
          )
          .map(
            (entry: {
              path: string;
              method: string;
              operation: Operation;
            }): string => {
              return `${entry.method} ${entry.path}`;
            },
          )
          .sort();

        expect(tagged).toEqual(
          [
            `post ${channel.crudApiPath}/get-list`,
            `post ${channel.crudApiPath}/count`,
            `post ${channel.crudApiPath}`,
            `post ${channel.crudApiPath}/{id}/get-item`,
            `put ${channel.crudApiPath}/{id}`,
            `delete ${channel.crudApiPath}/{id}`,
          ].sort(),
        );

        const tag: JSONObject | undefined = (
          spec["tags"] as Array<JSONObject>
        ).find((candidate: JSONObject): boolean => {
          return candidate["name"] === channel.tag;
        });

        expect(tag?.["x-oneuptime-table"]).toBe(channel.tableName);
      },
    );

    /*
     * The tag's description is what the API reference and the provider's
     * docs say the endpoints are for. The Twilio account's said "Manage
     * Custom SMTP Servers for your project", copied from the mail server's.
     */
    it("describes the Twilio account as one, not as a mail server", () => {
      const tag: JSONObject | undefined = (
        spec["tags"] as Array<JSONObject>
      ).find((candidate: JSONObject): boolean => {
        return candidate["name"] === TWILIO.tag;
      });
      const description: string = String(tag?.["description"] || "");

      expect(description).toContain("Twilio account");
      expect(description).not.toContain("SMTP");
    });

    it.each(CHANNELS)(
      "marks each credential of $tableName secret, and nothing else",
      (channel: Channel) => {
        for (const kind of SCHEMA_KINDS) {
          const properties: JSONObject = getProperties(
            `${channel.tableName}${kind}`,
          );
          const secrets: Array<string> = Object.keys(properties)
            .filter((name: string): boolean => {
              return (
                (properties[name] as JSONObject)["x-oneuptime-secret"] === true
              );
            })
            .sort();
          const passwords: Array<string> = Object.keys(properties)
            .filter((name: string): boolean => {
              return (properties[name] as JSONObject)["format"] === "password";
            })
            .sort();

          expect([kind, secrets]).toEqual([kind, channel.secrets]);
          expect([kind, passwords]).toEqual([kind, channel.passwords]);
        }
      },
    );

    it.each(CHANNELS)(
      "makes $resource a resource and a data source of the provider",
      (channel: Channel) => {
        const resource: TerraformResource = getResource(channel);

        expect(resource.tableName).toBe(channel.tableName);
        expect(getDataSource(channel).name).toBe(channel.resource);
        expect(
          parser.warnings.filter((warning: string): boolean => {
            return warning.includes(`"${channel.resource}"`);
          }),
        ).toEqual([]);
      },
    );

    it.each(CHANNELS)(
      "makes each credential of $resource Sensitive, and nothing else",
      (channel: Channel) => {
        const resource: TerraformResource = getResource(channel);
        const sensitive: Array<string> = Object.keys(resource.schema)
          .filter((name: string): boolean => {
            return Boolean(resource.schema[name]?.sensitive);
          })
          .sort();

        expect(sensitive).toEqual(getSnakeNames(channel.secrets));

        const dataSource: TerraformDataSource = getDataSource(channel);

        for (const name of getSnakeNames(channel.secrets)) {
          expect([name, dataSource.schema[name]?.sensitive]).toEqual([
            name,
            true,
          ]);
          // Nobody looks a record up by its password.
          expect([name, dataSource.schema[name]?.isLookupFilter]).toEqual([
            name,
            undefined,
          ]);
        }
      },
    );

    /*
     * A credential is written on create and on every update that changes it,
     * and read back, so a token changed in the configuration is sent and a
     * refresh compares what the server holds.
     */
    it.each(CHANNELS)(
      "writes each credential of $resource on create and update, and reads it back",
      (channel: Channel) => {
        const resource: TerraformResource = getResource(channel);

        for (const name of getSnakeNames(channel.secrets)) {
          expect([
            name,
            Boolean(resource.operationSchemas?.create?.[name]),
            Boolean(resource.operationSchemas?.update?.[name]),
            Boolean(resource.operationSchemas?.read?.[name]),
          ]).toEqual([name, true, true, true]);
        }
      },
    );

    /*
     * Which account is the project's default for SMS and which for calls is
     * written by the server alone, from is_project_default and what each
     * account is used for (#6574): Terraform reads them and never plans one.
     */
    it("reads the Twilio account's defaults for SMS and calls, and never writes them", () => {
      const resource: TerraformResource = getResource(TWILIO);

      for (const field of [
        "isProjectDefaultForSms",
        "isProjectDefaultForCalls",
      ]) {
        const name: string = StringUtils.toLegacySnakeCase(field);

        expect([
          name,
          resource.schema[name]?.computed,
          Boolean(resource.schema[name]?.required),
          Boolean(resource.operationSchemas?.create?.[name]),
          Boolean(resource.operationSchemas?.update?.[name]),
          Boolean(resource.operationSchemas?.read?.[name]),
        ]).toEqual([name, true, false, false, false, true]);
      }

      expect(
        Boolean(resource.operationSchemas?.create?.["is_project_default"]),
      ).toBe(true);
    });

    /*
     * A status page names the Twilio account and the mail server that reach
     * its subscribers, and an incoming call policy the account that takes
     * its calls. Their IDs now say which resource they are the IDs of.
     */
    it.each([
      ["status_page", "callSmsConfigId", TWILIO.resource],
      ["status_page", "smtpConfigId", MAIL.resource],
      ["incoming_call_policy", "projectCallSMSConfigId", TWILIO.resource],
    ])(
      "points %s's %s at %s",
      (resourceName: string, apiFieldName: string, target: string) => {
        const resource: TerraformResource | undefined = parser
          .getResources()
          .find((candidate: TerraformResource): boolean => {
            return candidate.name === resourceName;
          });
        const attribute: TerraformAttribute | undefined = Object.values(
          resource?.schema || {},
        ).find((candidate: TerraformAttribute): boolean => {
          return candidate.apiFieldName === apiFieldName;
        });

        expect(attribute?.relation).toEqual({ name: target, isList: false });
        expect(attribute?.description).toContain(
          `The ID of a \`oneuptime_${target}\`.`,
        );
      },
    );
  });

  /*
   * OneUptime keeps a phone number as written when it reads as three digits,
   * three and four, and any other as its digits (Types/Phone.ts). The
   * Terraform provider writes a phone column as a plain string and compares
   * it as OneUptime keeps it (Scripts/TerraformProvider/StaticFiles/phone.go,
   * #7777), so that "+1 415 555 0100" applies cleanly. The generator knows a
   * phone column by the wrapper's marker.
   */
  describe("phone numbers", () => {
    let parser: OpenAPIParser;

    beforeAll(() => {
      parser = new OpenAPIParser();
      parser.setSpec(spec as never);
    });

    // The columns of a schema the spec writes as the Phone wrapper.
    function getPhoneColumns(schemaName: string): Array<string> {
      const properties: JSONObject = ((
        schemas[schemaName] as JSONObject | undefined
      )?.["properties"] || {}) as JSONObject;

      return Object.keys(properties)
        .filter((name: string): boolean => {
          const example: unknown = (properties[name] as JSONObject)["example"];

          return (
            typeof example === "object" &&
            example !== null &&
            (example as JSONObject)["_type"] === "Phone"
          );
        })
        .sort();
    }

    it("marks every phone column of every schema as one", () => {
      let columns: number = 0;

      for (const schemaName of Object.keys(schemas)) {
        const properties: JSONObject = ((schemas[schemaName] as JSONObject)[
          "properties"
        ] || {}) as JSONObject;

        for (const name of getPhoneColumns(schemaName)) {
          columns++;
          expect([
            schemaName,
            name,
            (properties[name] as JSONObject)["x-oneuptime-type"],
          ]).toEqual([schemaName, name, "Phone"]);
        }
      }

      // The Twilio account's number and a subscriber's, at the least.
      expect(columns).toBeGreaterThanOrEqual(8);
    });

    it("makes every phone column of a resource a phone number, written as a plain string", () => {
      const writable: Array<string> = [];

      for (const resource of parser.getResources()) {
        const phoneColumns: Array<string> = getPhoneColumns(
          resource.tableName || "",
        );
        const phones: Array<[string, TerraformAttribute]> = Object.entries(
          resource.schema,
        ).filter(([, attribute]: [string, TerraformAttribute]): boolean => {
          return Boolean(attribute.isPhone);
        });

        expect([
          resource.name,
          phones
            .map(([, attribute]: [string, TerraformAttribute]): string => {
              return attribute.apiFieldName || "";
            })
            .sort(),
        ]).toEqual([
          resource.name,
          phoneColumns.filter((column: string): boolean => {
            return Object.values(resource.schema).some(
              (attribute: TerraformAttribute): boolean => {
                return attribute.apiFieldName === column;
              },
            );
          }),
        ]);

        for (const [name, attribute] of phones) {
          expect([
            `${resource.name}.${name}`,
            attribute.type,
            Boolean(attribute.isComplexObject),
          ]).toEqual([`${resource.name}.${name}`, "string", false]);

          if (!attribute.computed || attribute.optional) {
            writable.push(`${resource.name}.${name}`);
          }
        }
      }

      expect(writable).toEqual(
        expect.arrayContaining([
          "call_and_sms_config.twilio_primary_phone_number",
          "incoming_call_log_item.user_phone_number",
          "status_page_subscriber.subscriber_phone",
        ]),
      );
    });

    it("reads phone numbers in data sources, and looks nothing up by one", () => {
      const phones: Array<string> = [];

      for (const dataSource of parser.getDataSources()) {
        for (const [name, attribute] of Object.entries(dataSource.schema)) {
          if (!attribute.isPhone) {
            continue;
          }

          phones.push(`${dataSource.name}.${name}`);
          expect([
            `${dataSource.name}.${name}`,
            attribute.isLookupFilter,
          ]).toEqual([`${dataSource.name}.${name}`, undefined]);
        }
      }

      expect(phones).toEqual(
        expect.arrayContaining([
          "call_and_sms_config.twilio_primary_phone_number",
          "call_log.from_number",
          "status_page_subscriber.subscriber_phone",
        ]),
      );
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
