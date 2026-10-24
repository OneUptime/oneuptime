import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import express from "express";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import DatabaseModels from "../../../Models/DatabaseModels/Index";
import RetiredApiRoute, {
  RETIRED_AI_INVESTIGATION_RULE_API,
  RETIRED_API_RESOURCES,
  RETIRED_API_STATUS_CODE,
} from "../../../Server/API/RetiredApiRoute";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * AI RULES, OUTSIDE THE DASHBOARD.
 *
 * Investigation rules and auto remediation rules became one AI rule, in the
 * auto remediation rules' table (Types/AI/AiRule). For a team that keeps its
 * rules in Terraform or a script on the API:
 *
 *   - the auto remediation rule resource IS the AI rule: same route
 *     (/auto-remediation-rule), same ids, renamed "AI Rule" in the API
 *     reference; the Terraform provider registers oneuptime_ai_rule and
 *     keeps oneuptime_auto_remediation_rule as a deprecated alias (a moved
 *     block switches without replacing the rule). A create that names
 *     neither investigates nor fixes fixes and does not investigate, as
 *     every auto remediation rule did;
 *   - the investigation rule resource is gone: its route answers 410 Gone,
 *     with the resource to use instead (RetiredApiRoute), and the provider
 *     has no oneuptime_investigation_rule;
 *   - neither was ever an MCP tool (no @EnableMCP), so MCP has nothing to
 *     keep.
 *
 * The API reference and the Terraform provider are generated from the
 * models' metadata; these read the real spec and the real provider parser.
 */

let spec: JSONObject;
let providerResources: Array<TerraformResource>;
let providerDataSources: Array<TerraformDataSource>;

function schema(schemaName: string): JSONObject {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
  const found: JSONObject | undefined = schemas[schemaName] as
    | JSONObject
    | undefined;

  expect(found).toBeDefined();

  return found as JSONObject;
}

function properties(schemaName: string): JSONObject {
  return (schema(schemaName)["properties"] || {}) as JSONObject;
}

function methodsOf(routePath: string): Array<string> {
  const paths: JSONObject = spec["paths"] as JSONObject;

  return Object.keys((paths[routePath] || {}) as JSONObject).sort();
}

function resource(name: string): TerraformResource | undefined {
  return providerResources.find((candidate: TerraformResource): boolean => {
    return candidate.name === name;
  });
}

function dataSource(name: string): TerraformDataSource | undefined {
  return providerDataSources.find((candidate: TerraformDataSource): boolean => {
    return candidate.name === name;
  });
}

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(spec as never);
  providerResources = parser.getResources();
  providerDataSources = parser.getDataSources();
});

describe("the AI rule resource", () => {
  test("is the auto remediation rules' route, renamed AI Rule, with what it was called before", () => {
    const rule: AutoRemediationRule = new AutoRemediationRule();

    expect(rule.getCrudApiPath()?.toString()).toBe("/auto-remediation-rule");
    expect(rule.singularName).toBe("AI Rule");
    expect(rule.pluralName).toBe("AI Rules");
    expect(rule.formerSingularName).toBe("Auto Remediation Rule");

    expect(methodsOf("/auto-remediation-rule")).toEqual(["post"]);
    expect(methodsOf("/auto-remediation-rule/get-list")).toEqual(["post"]);
    expect(methodsOf("/auto-remediation-rule/{id}/get-item")).toEqual(["post"]);
    expect(methodsOf("/auto-remediation-rule/{id}")).toEqual(
      expect.arrayContaining(["put", "delete"]),
    );

    const tags: Array<JSONObject> = spec["tags"] as Array<JSONObject>;
    const tag: JSONObject | undefined = tags.find((candidate: JSONObject) => {
      return candidate["name"] === "AI Rule";
    });

    expect(tag).toBeDefined();
    expect(tag!["x-former-names"]).toEqual(["Auto Remediation Rule"]);
    expect(String(tag!["description"])).toContain("investigates and fixes");
  });

  test("a create may say whether the rule investigates, its wait and whether it fixes - and need not", () => {
    const create: JSONObject = properties("AutoRemediationRuleCreateSchema");

    for (const column of ["investigates", "onlyIfOpenAfterMinutes", "fixes"]) {
      expect(Object.keys(create)).toContain(column);
    }

    const required: Array<string> = (schema("AutoRemediationRuleCreateSchema")[
      "required"
    ] || []) as Array<string>;

    expect(required).not.toContain("investigates");
    expect(required).not.toContain("fixes");
    expect(required).not.toContain("onlyIfOpenAfterMinutes");

    // Left out, a rule fixes and does not investigate: an older client's rule.
    expect((create["investigates"] as JSONObject)["default"]).toBe(false);
    expect((create["fixes"] as JSONObject)["default"]).toBe(true);
  });

  test("an update may change what the rule does", () => {
    const update: JSONObject = properties("AutoRemediationRuleUpdateSchema");

    for (const column of ["investigates", "onlyIfOpenAfterMinutes", "fixes"]) {
      expect(Object.keys(update)).toContain(column);
    }
  });

  test("Terraform: oneuptime_ai_rule, with oneuptime_auto_remediation_rule kept as a deprecated alias", () => {
    const aiRule: TerraformResource | undefined = resource("ai_rule");

    expect(aiRule).toBeDefined();
    expect(aiRule!.legacyName).toBe("auto_remediation_rule");
    expect(dataSource("ai_rule")?.legacyName).toBe("auto_remediation_rule");

    // The old name is the alias, never a resource of its own.
    expect(resource("auto_remediation_rule")).toBeUndefined();
  });

  test("Terraform: what a rule does is three optional attributes, with the API's defaults", () => {
    const aiRule: TerraformResource = resource("ai_rule")!;

    const investigates: TerraformAttribute | undefined =
      aiRule.schema["investigates"];
    const fixes: TerraformAttribute | undefined = aiRule.schema["fixes"];
    const wait: TerraformAttribute | undefined =
      aiRule.schema["only_if_open_after_minutes"];

    expect(investigates?.type).toBe("bool");
    expect(investigates?.required).toBe(false);
    expect(investigates?.default).toBe(false);
    expect(fixes?.type).toBe("bool");
    expect(fixes?.required).toBe(false);
    expect(fixes?.default).toBe(true);
    expect(wait?.type).toBe("number");
    expect(wait?.required).toBe(false);

    // Everything an auto remediation rule configuration set is still there.
    for (const attribute of [
      "name",
      "trigger_entity_type",
      "execution_mode",
      "remediation_action",
      "runbooks",
      "runner_id",
      "external_mcp_servers",
      "code_repositories",
      "llm_provider_id",
      "open_code_fix_pull_requests",
      "open_telemetry_pull_requests",
    ]) {
      expect({ attribute, isThere: Boolean(aiRule.schema[attribute]) }).toEqual(
        { attribute, isThere: true },
      );
    }
  });
});

describe("the investigation rule resource is retired", () => {
  test("no model, no route in the API reference, no tag", () => {
    expect(
      DatabaseModels.some((modelType: { name: string }) => {
        return modelType.name === "AIInvestigationRule";
      }),
    ).toBe(false);

    const paths: JSONObject = spec["paths"] as JSONObject;

    expect(
      Object.keys(paths).filter((routePath: string) => {
        return routePath.startsWith("/ai-investigation-rule");
      }),
    ).toEqual([]);

    const tagNames: Array<string> = (spec["tags"] as Array<JSONObject>).map(
      (tag: JSONObject): string => {
        return String(tag["name"]);
      },
    );

    expect(tagNames).not.toContain("Investigation Rule");
  });

  test("Terraform has no oneuptime_investigation_rule, as a resource or a data source", () => {
    expect(resource("investigation_rule")).toBeUndefined();
    expect(dataSource("investigation_rule")).toBeUndefined();

    for (const candidate of providerResources) {
      expect(candidate.legacyName).not.toBe("investigation_rule");
    }
  });

  test("neither rule was ever an MCP tool", () => {
    expect(new AutoRemediationRule().enableMCP).toBeFalsy();
  });

  test("the API registers the retired route where the resource was served", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "BaseAPI",
        "Index.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      "app.use(`/${APP_NAME.toLocaleLowerCase()}`, RetiredApiRoute.getRouter());",
    );
    expect(source).not.toContain("AIInvestigationRuleService");
  });
});

describe("the retired route answers every call with what to use instead", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(express.json());
    app.use("/api", RetiredApiRoute.getRouter());
    // A live route beside it is not shadowed.
    app.get(
      "/api/ai-investigation-rules-report",
      (_req: express.Request, res: express.Response) => {
        res.status(200).send({ ok: true });
      },
    );

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  function call(
    method: string,
    routePath: string,
  ): Promise<{ status: number; body: JSONObject }> {
    return new Promise(
      (
        resolve: (value: { status: number; body: JSONObject }) => void,
        reject: (error: Error) => void,
      ) => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port,
            method,
            path: routePath,
            headers: { "content-type": "application/json" },
          },
          (response: http.IncomingMessage) => {
            let text: string = "";
            response.on("data", (chunk: Buffer) => {
              text += chunk.toString();
            });
            response.on("end", () => {
              resolve({
                status: response.statusCode || 0,
                body: text ? (JSON.parse(text) as JSONObject) : {},
              });
            });
          },
        );
        request.on("error", reject);
        if (method !== "GET" && method !== "DELETE") {
          request.write(JSON.stringify({ data: { name: "x" } }));
        }
        request.end();
      },
    );
  }

  test.each([
    ["POST", "/api/ai-investigation-rule"],
    ["POST", "/api/ai-investigation-rule/get-list"],
    ["GET", "/api/ai-investigation-rule/get-list"],
    ["POST", "/api/ai-investigation-rule/count"],
    [
      "POST",
      "/api/ai-investigation-rule/5c7f3d1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f/get-item",
    ],
    ["PUT", "/api/ai-investigation-rule/5c7f3d1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f"],
    [
      "DELETE",
      "/api/ai-investigation-rule/5c7f3d1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
    ],
  ])(
    "%s %s: 410 Gone, and the AI Rule resource to use",
    async (method: string, routePath: string) => {
      const answer: { status: number; body: JSONObject } = await call(
        method,
        routePath,
      );

      expect(answer.status).toBe(RETIRED_API_STATUS_CODE);
      expect(answer.status).toBe(410);
      expect(answer.body["message"]).toBe(
        RETIRED_AI_INVESTIGATION_RULE_API.message,
      );
    },
  );

  test("the message names the route, the Terraform resource and the shape of an investigation rule", () => {
    const message: string = RETIRED_AI_INVESTIGATION_RULE_API.message;

    expect(message).toContain("/api/auto-remediation-rule");
    expect(message).toContain("oneuptime_ai_rule");
    expect(message).toContain(
      "investigates set to true and fixes set to false",
    );
    expect(message).toContain("/docs/installation/upgrading");
  });

  test("a route that only begins with the same letters is not answered", async () => {
    const answer: { status: number; body: JSONObject } = await call(
      "GET",
      "/api/ai-investigation-rules-report",
    );

    expect(answer.status).toBe(200);
  });

  test("every retired resource names a route that no model serves any more", () => {
    const servedRoutes: Array<string> = DatabaseModels.map(
      (modelType: { new (): unknown }) => {
        const model: { getCrudApiPath?: () => { toString(): string } | null } =
          new modelType() as {
            getCrudApiPath?: () => { toString(): string } | null;
          };

        return model.getCrudApiPath?.()?.toString() || "";
      },
    );

    for (const retired of RETIRED_API_RESOURCES) {
      expect(servedRoutes).not.toContain(retired.path);
    }
  });
});
