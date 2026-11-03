import fs from "fs";
import os from "os";
import path from "path";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../Core/Types";
import { crudPaths } from "./Fixtures";

/*
 * SECRETS ARE SENSITIVE.
 *
 * The spec marks every secret x-oneuptime-secret, whatever its type (an API
 * key's value is a uuid, a probe's key plain text, an SNMP discovery scan's
 * credential sets JSON), and an encrypted string format: password as well
 * (Common/Utils/Schema/ModelSchema.isSecretColumn). Each becomes a Sensitive
 * attribute, of a resource and of a data source, so a plan, a log or an
 * output prints (sensitive value) - and a data source never looks anything
 * up by one. Before, only format: password did: oneuptime_api_key's api_key,
 * a probe's key and 27 more were printed in every plan.
 */

function buildSecretSpec(): OpenAPISpec {
  const schema: any = {
    type: "object",
    required: ["name"],
    properties: {
      _id: { type: "string", format: "uuid" },
      name: { type: "string", description: "Name of the key." },
      apiKey: {
        type: "string",
        format: "uuid",
        "x-oneuptime-secret": true,
        description: "Secret API Key.",
      },
      agentKey: {
        type: "string",
        "x-oneuptime-secret": true,
        description: "Key the agent presents.",
      },
      smtpPassword: {
        type: "string",
        format: "password",
        description: "An encrypted password.",
      },
      snmpConfigs: {
        type: "object",
        "x-oneuptime-secret": true,
        description: "Credential sets.",
      },
      region: { type: "string", description: "Where it runs." },
    },
  };

  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [{ name: "Agent Key", description: "Keys of agents." }],
    paths: crudPaths({
      path: "/agent-key",
      table: "AgentKey",
      tag: "Agent Key",
      schema: "AgentKey",
    }),
    components: { schemas: { AgentKey: schema } },
  };
}

let parser: OpenAPIParser;
let resource: TerraformResource;
let dataSource: TerraformDataSource;
let outputDir: string;
let resourceGo: string;
let dataSourceGo: string;

beforeAll(async () => {
  parser = new OpenAPIParser();
  parser.setSpec(buildSecretSpec());
  resource = parser.getResources()[0]!;
  dataSource = parser.getDataSources()[0]!;

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-sensitive-"));
  const config: any = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "14.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new ResourceGenerator(config, buildSecretSpec()).generateResources();
  await new DataSourceGenerator(
    config,
    buildSecretSpec(),
  ).generateDataSources();
  resourceGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/resource_agent_key.go"),
    "utf-8",
  );
  dataSourceGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/data_source_agent_key.go"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

function block(source: string, attribute: string): string {
  const start: number = source.indexOf(`"${attribute}": schema.`);
  if (start === -1) {
    throw new Error(`no attribute ${attribute}`);
  }
  return source.substring(start, source.indexOf("\n            },\n", start));
}

describe("a secret in the spec", () => {
  test("is a sensitive attribute, whatever its type", () => {
    for (const name of [
      "api_key",
      "agent_key",
      "smtp_password",
      "snmp_configs",
    ]) {
      const attribute: TerraformAttribute | undefined = resource.schema[name];
      expect(attribute?.sensitive).toBe(true);
      expect(block(resourceGo, name)).toContain("Sensitive: true");
    }
  });

  test("keeps its own type and format", () => {
    // A uuid secret is still a plain string; a JSON one still JSON.
    expect(resource.schema["api_key"]?.type).toBe("string");
    expect(resource.schema["api_key"]?.format).toBe("uuid");
    expect(resource.schema["snmp_configs"]?.isComplexObject).toBe(true);
    expect(block(resourceGo, "snmp_configs")).toContain(
      "CustomType: JSONSubsetType{}",
    );
  });

  test("is sensitive in the data source too, and never a lookup argument", () => {
    for (const name of ["api_key", "agent_key", "smtp_password"]) {
      const attribute: TerraformAttribute | undefined = dataSource.schema[name];
      expect(attribute?.sensitive).toBe(true);
      expect(attribute?.isLookupFilter).toBeFalsy();
      expect(block(dataSourceGo, name)).toContain("Sensitive: true");
    }
    // What is no secret is still one to look up by.
    expect(dataSource.schema["region"]?.isLookupFilter).toBe(true);
  });

  test("what is no secret is not sensitive", () => {
    for (const name of ["name", "region"]) {
      expect(resource.schema[name]?.sensitive).toBeFalsy();
      expect(block(resourceGo, name)).not.toContain("Sensitive: true");
    }
  });
});
