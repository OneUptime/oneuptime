import fs from "fs";
import os from "os";
import path from "path";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";
import { OpenAPISpec, TerraformResource } from "../Core/Types";

/*
 * RESOURCE NAMES BY MODEL.
 *
 * A resource is named after its model's tag, or after the name clients give
 * the model where its own reads poorly as a resource's
 * (Common/Utils/DeveloperDocs/ClientResourceNames.ts) - found by the model's
 * table, which every schema and tag says, since two models can share a tag:
 *
 *   - User's On-Call Duty Escalation Rule is oneuptime_escalation_rule_user,
 *     with oneuptime_users_on_call_duty_escalation_rule kept as a deprecated
 *     alias;
 *   - the subscriber notification template and its link to a status page
 *     share the singular name "Subscriber Notification Template": the
 *     provider made ONE resource of the two, the link's endpoints winning.
 *     The link is oneuptime_status_page_subscriber_notification_template
 *     now, the template keeps its name, and a moved block brings a link's
 *     state over from the name it had - no alias can keep a name another
 *     resource has.
 *
 * Two models that would still make one resource stop the generation.
 */

function model(data: {
  table: string;
  tag: string;
  apiPath: string;
  properties: Record<string, any>;
  required?: Array<string>;
}): { paths: Record<string, any>; schemas: Record<string, any> } {
  const ref: (name: string) => any = (name: string): any => {
    return { $ref: `#/components/schemas/${name}` };
  };
  const answer: any = {
    "200": {
      description: "ok",
      content: {
        "application/json": {
          schema: { type: "object", properties: { data: ref(data.table) } },
        },
      },
    },
  };
  const id: any = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
  };
  return {
    schemas: {
      [`${data.table}CreateSchema`]: {
        type: "object",
        required: data.required || [],
        properties: data.properties,
      },
      [data.table]: {
        type: "object",
        properties: { _id: { type: "string" }, ...data.properties },
      },
    },
    paths: {
      [data.apiPath]: {
        post: {
          operationId: `create${data.table}`,
          tags: [data.tag],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: ref(`${data.table}CreateSchema`) },
                },
              },
            },
          },
          responses: answer,
        },
      },
      [`${data.apiPath}/get-list`]: {
        post: {
          operationId: `list${data.table}`,
          tags: [data.tag],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: ref(data.table) },
                    },
                  },
                },
              },
            },
          },
        },
      },
      [`${data.apiPath}/{id}/get-item`]: {
        post: {
          operationId: `get${data.table}`,
          tags: [data.tag],
          parameters: [id],
          responses: answer,
        },
      },
      // A delete names no schema: its path says whose it is.
      [`${data.apiPath}/{id}`]: {
        delete: {
          operationId: `delete${data.table}`,
          tags: [data.tag],
          parameters: [id],
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
}

function buildSpec(withClientNames: boolean = true): OpenAPISpec {
  const template: { paths: Record<string, any>; schemas: Record<string, any> } =
    model({
      table: withClientNames
        ? "StatusPageSubscriberNotificationTemplate"
        : "TemplateA",
      tag: "Subscriber Notification Template",
      apiPath: "/status-page-subscriber-notification-template",
      properties: {
        templateName: { type: "string", description: "Its name." },
      },
      required: ["templateName"],
    });
  const link: { paths: Record<string, any>; schemas: Record<string, any> } =
    model({
      table: withClientNames
        ? "StatusPageSubscriberNotificationTemplateStatusPage"
        : "TemplateB",
      tag: "Subscriber Notification Template",
      apiPath: "/status-page-subscriber-notification-template-status-page",
      properties: {
        statusPageSubscriberNotificationTemplateId: {
          type: "string",
          description: "The template.",
          "x-oneuptime-relation": {
            tag: "Subscriber Notification Template",
            tableName: "StatusPageSubscriberNotificationTemplate",
          },
        },
      },
      required: ["statusPageSubscriberNotificationTemplateId"],
    });
  const ruleUser: { paths: Record<string, any>; schemas: Record<string, any> } =
    model({
      table: "OnCallDutyPolicyEscalationRuleUser",
      tag: "User's On-Call Duty Escalation Rule",
      apiPath: "/on-call-duty-policy-escalation-rule-user",
      properties: {
        name: { type: "string", description: "A name." },
      },
      required: ["name"],
    });

  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [
      {
        name: "Subscriber Notification Template",
        description: "The template itself.",
        "x-oneuptime-table": withClientNames
          ? "StatusPageSubscriberNotificationTemplate"
          : "TemplateA",
      },
      {
        name: "Subscriber Notification Template",
        description: "A status page's template.",
        "x-oneuptime-table": withClientNames
          ? "StatusPageSubscriberNotificationTemplateStatusPage"
          : "TemplateB",
      },
      {
        name: "User's On-Call Duty Escalation Rule",
        description: "The people an escalation rule pages.",
        "x-oneuptime-table": "OnCallDutyPolicyEscalationRuleUser",
      },
    ],
    paths: { ...template.paths, ...link.paths, ...ruleUser.paths },
    components: {
      schemas: { ...template.schemas, ...link.schemas, ...ruleUser.schemas },
    },
  };
}

let resources: Map<string, TerraformResource>;
let outputDir: string;
let linkGo: string;
let ruleUserGo: string;
let resourcesGo: string;
let dataSourcesGo: string;
let linkPage: string;
let templatePage: string;
let indexPage: string;

beforeAll(async () => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildSpec());
  resources = new Map(
    parser.getResources().map((resource: TerraformResource) => {
      return [resource.name, resource];
    }),
  );

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-client-names-"));
  const config: any = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "14.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new ResourceGenerator(config, buildSpec()).generateResources();
  await new DataSourceGenerator(config, buildSpec()).generateDataSources();
  await new DocumentationGenerator(config, buildSpec()).generateDocumentation();

  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(path.join(outputDir, file), "utf-8");
  };
  linkGo = read(
    "internal/provider/resource_status_page_subscriber_notification_template.go",
  );
  ruleUserGo = read("internal/provider/resource_escalation_rule_user.go");
  resourcesGo = read("internal/provider/resources.go");
  dataSourcesGo = read("internal/provider/data_sources.go");
  linkPage = read(
    "docs/resources/status_page_subscriber_notification_template.md",
  );
  templatePage = read("docs/resources/subscriber_notification_template.md");
  indexPage = read("docs/index.md");
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("two models of one singular name", () => {
  test("make two resources, each with its own endpoints", () => {
    const template: TerraformResource = resources.get(
      "subscriber_notification_template",
    )!;
    const link: TerraformResource = resources.get(
      "status_page_subscriber_notification_template",
    )!;

    expect(template.operations.create?.path).toBe(
      "/status-page-subscriber-notification-template",
    );
    expect(template.operations.delete?.path).toBe(
      "/status-page-subscriber-notification-template/{id}",
    );
    expect(link.operations.create?.path).toBe(
      "/status-page-subscriber-notification-template-status-page",
    );
    // The delete, which names no schema, is found by its path.
    expect(link.operations.delete?.path).toBe(
      "/status-page-subscriber-notification-template-status-page/{id}",
    );
    expect(template.schema["template_name"]).toBeDefined();
    expect(link.schema["template_name"]).toBeUndefined();
  });

  test("each keeps its own description", () => {
    expect(resources.get("subscriber_notification_template")!.description).toBe(
      "The template itself.",
    );
    expect(
      resources.get("status_page_subscriber_notification_template")!
        .description,
    ).toBe("A status page's template.");
  });

  test("the link points at the template by the template's name", () => {
    expect(
      resources.get("status_page_subscriber_notification_template")!.schema[
        "status_page_subscriber_notification_template_id"
      ]?.relation?.name,
    ).toBe("subscriber_notification_template");
  });

  test("the link is moved from the name the template has, never aliased", () => {
    const link: TerraformResource = resources.get(
      "status_page_subscriber_notification_template",
    )!;
    expect(link.legacyName).toBeUndefined();
    expect(link.movedFrom).toBe("subscriber_notification_template");

    expect(linkGo).toContain(
      "var _ resource.ResourceWithMoveState = &StatusPageSubscriberNotificationTemplateResource{}",
    );
    expect(linkGo).toContain(
      'legacyNameStateMover("oneuptime_subscriber_notification_template", r.schemaDefinition())',
    );
    expect(linkGo).not.toContain("isLegacyAlias");
    expect(resourcesGo).not.toContain(
      'LegacyName: "subscriber_notification_template"',
    );
    expect(dataSourcesGo).not.toContain(
      'LegacyName: "subscriber_notification_template"',
    );

    // Its page says how to move a link's state across.
    expect(linkPage).toContain(
      "this resource was called `oneuptime_subscriber_notification_template` before, a name [another resource](./subscriber_notification_template) has now",
    );
    expect(linkPage).toContain(
      "from = oneuptime_subscriber_notification_template.example",
    );
    // And how to keep it where the engine cannot move it to another type.
    expect(linkPage).toContain(
      DocumentationGenerator.MOVE_TO_ANOTHER_TYPE_FALLBACK,
    );
    expect(DocumentationGenerator.MOVE_TO_ANOTHER_TYPE_FALLBACK).toContain(
      "`terraform state rm`",
    );
    expect(templatePage).not.toContain("~> **Renamed:**");
  });

  test("the provider's index says the old name is the template's now, where it lists the renames", () => {
    const renamed: string = indexPage.slice(
      indexPage.indexOf("## Renamed resources"),
    );

    expect(renamed).toContain(
      "One old name is another resource's now, so no alias can keep it.",
    );
    expect(renamed).toContain(
      "| [`oneuptime_subscriber_notification_template`](./resources/subscriber_notification_template) | [`oneuptime_status_page_subscriber_notification_template`](./resources/status_page_subscriber_notification_template) |",
    );
    expect(renamed).toContain(
      "  from = oneuptime_subscriber_notification_template.example\n  to   = oneuptime_status_page_subscriber_notification_template.example",
    );
    expect(renamed).toContain(
      DocumentationGenerator.MOVE_TO_ANOTHER_TYPE_FALLBACK,
    );
    // It is no alias: the table of names that still work leaves it out.
    expect(renamed).not.toContain(
      "| `oneuptime_subscriber_notification_template` |",
    );
    // The aliases still have their table.
    expect(renamed).toContain(
      "| `oneuptime_users_on_call_duty_escalation_rule` | [`oneuptime_escalation_rule_user`](./resources/escalation_rule_user) |",
    );
  });

  test("without a name of its own, the generation stops and says how to fix it", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(buildSpec(false));
    expect(() => {
      parser.getResources();
    }).toThrow(
      'Two models make the resource "subscriber_notification_template": TemplateA and TemplateB. Give one a name of its own in Common/Utils/DeveloperDocs/ClientResourceNames.ts.',
    );
  });
});

describe("a model whose own name reads poorly as a resource's", () => {
  test("is named as clients name it, with its old name as a deprecated alias", () => {
    const ruleUser: TerraformResource = resources.get("escalation_rule_user")!;
    expect(ruleUser).toBeDefined();
    expect(ruleUser.legacyName).toBe("users_on_call_duty_escalation_rule");
    expect(ruleUser.movedFrom).toBeUndefined();
    expect(resources.has("users_on_call_duty_escalation_rule")).toBe(false);

    expect(ruleUserGo).toContain(
      'resp.TypeName = req.ProviderTypeName + "_escalation_rule_user"',
    );
    expect(ruleUserGo).toContain(
      'resp.TypeName = req.ProviderTypeName + "_users_on_call_duty_escalation_rule"',
    );
    expect(resourcesGo).toContain(
      '{Name: "escalation_rule_user", LegacyName: "users_on_call_duty_escalation_rule"',
    );
    expect(dataSourcesGo).toContain(
      '{Name: "escalation_rule_user", LegacyName: "users_on_call_duty_escalation_rule"',
    );

    // The provider's index lists it with the other renamed resources.
    expect(indexPage).toContain(
      "| `oneuptime_users_on_call_duty_escalation_rule` | [`oneuptime_escalation_rule_user`](./resources/escalation_rule_user) |",
    );
  });

  test("getBasePath: a model's endpoints are all under one path", () => {
    for (const apiPath of [
      "/monitor",
      "/monitor/get-list",
      "/monitor/count",
      "/monitor/{id}",
      "/monitor/{id}/get-item",
    ]) {
      expect(OpenAPIParser.getBasePath(apiPath)).toBe("/monitor");
    }
    expect(OpenAPIParser.getBasePath("/monitor-group/{id}")).toBe(
      "/monitor-group",
    );
  });
});
