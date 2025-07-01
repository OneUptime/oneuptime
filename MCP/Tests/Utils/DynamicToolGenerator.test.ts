import DynamicToolGenerator from "../../Utils/DynamicToolGenerator";
import { ModelSchema } from "Common/Utils/Schema/ModelSchema";
import Incident from "Common/Models/DatabaseModels/Incident";
import OneUptimeOperation from "../../Types/OneUptimeOperation";

describe("DynamicToolGenerator", () => {
  describe("zodToJsonSchema debugging", () => {
    test("should debug Zod schema structure and OpenAPI metadata", () => {
      // Generate the create schema for Incident
      const createSchema = ModelSchema.getCreateModelSchema({
        modelType: Incident,
      });

      console.log("=== Schema Structure Debug ===");
      console.log("Schema type:", typeof createSchema);
      console.log("Schema constructor:", createSchema.constructor.name);
      console.log("Schema _def:", JSON.stringify(createSchema._def, null, 2));

      // Check if shape exists and is a function
      const shape = (createSchema as any)._def?.shape;
      console.log("Shape exists:", Boolean(shape));
      console.log("Shape type:", typeof shape);

      if (shape && typeof shape === "function") {
        const shapeResult = shape();
        console.log("Shape result type:", typeof shapeResult);
        console.log("Shape result keys:", Object.keys(shapeResult));

        // Look at a few fields to understand the structure
        const fields = Object.entries(shapeResult).slice(0, 3);

        for (const [key, value] of fields) {
          console.log(`\n=== Field: ${key} ===`);
          console.log("Field type:", typeof value);
          console.log("Field constructor:", (value as any).constructor.name);
          console.log(
            "Field _def:",
            JSON.stringify((value as any)._def, null, 2),
          );

          // Check different possible locations for OpenAPI metadata
          console.log("_def.openapi:", (value as any)._def?.openapi);
          console.log("_def.description:", (value as any)._def?.description);
          console.log("_def.meta:", (value as any)._def?.meta);
          console.log("openapi property direct:", (value as any).openapi);

          // Check if it's a ZodOptional and look at the inner type
          if ((value as any)._def?.typeName === "ZodOptional") {
            console.log(
              "Inner type _def:",
              JSON.stringify((value as any)._def?.innerType?._def, null, 2),
            );
            console.log(
              "Inner type openapi:",
              (value as any)._def?.innerType?._def?.openapi,
            );
          }
        }
      }

      // Test the current zodToJsonSchema method to see what it produces
      console.log("\n=== Current zodToJsonSchema Output ===");
      const jsonSchema = (DynamicToolGenerator as any).zodToJsonSchema(
        createSchema,
      );
      console.log(
        "Generated JSON Schema:",
        JSON.stringify(jsonSchema, null, 2),
      );
    });

    test("should generate tools for Incident model", () => {
      const incident = new Incident();
      const tools = DynamicToolGenerator.generateToolsForDatabaseModel(
        incident,
        Incident,
      );

      console.log("\n=== Generated Tools ===");
      console.log("Number of tools:", tools.tools.length);

      // Check the create tool specifically
      const createTool = tools.tools.find((tool) => {
        return tool.operation === OneUptimeOperation.Create;
      });
      if (createTool) {
        console.log(
          "Create tool input schema properties:",
          Object.keys(createTool.inputSchema.properties),
        );
        console.log(
          "Sample properties:",
          JSON.stringify(
            Object.fromEntries(
              Object.entries(createTool.inputSchema.properties).slice(0, 3),
            ),
            null,
            2,
          ),
        );
      }
    });

    test("should extract proper OpenAPI metadata instead of fallback", () => {
      const createSchema = ModelSchema.getCreateModelSchema({
        modelType: Incident,
      });
      const jsonSchema = (DynamicToolGenerator as any).zodToJsonSchema(
        createSchema,
      );

      // Check that we're extracting proper types instead of fallback
      expect(jsonSchema.properties.title.type).toBe("string");
      expect(jsonSchema.properties.title.description).not.toBe("title field"); // Should not be fallback
      expect(jsonSchema.properties.title.description).toContain(
        "Title of this incident",
      ); // Should have real description
      expect(jsonSchema.properties.title.example).toBeTruthy(); // Should have example

      // Check boolean field
      expect(jsonSchema.properties.isVisibleOnStatusPage.type).toBe("boolean");
      expect(jsonSchema.properties.isVisibleOnStatusPage.default).toBe(true);

      // Check UUID format field
      expect(jsonSchema.properties.projectId.format).toBe("uuid");
      expect(jsonSchema.properties.projectId.type).toBe("string");

      // Check array field
      expect(jsonSchema.properties.monitors.type).toBe("array");

      // Check that required fields are properly identified
      expect(jsonSchema.required).toContain("title");
      expect(jsonSchema.required).toContain("incidentSeverityId");
      expect(jsonSchema.required).not.toContain("projectId"); // Optional field
    });
  });

  test("should properly sanitize tool names for complex model names", () => {
    // Test the sanitizeToolName function directly
    const testCases = [
      {
        input: "UsersOnCallDutyEscalationRule",
        expected: "users_on_call_duty_escalation_rule",
      },
      {
        input: "User's On-Call Duty Escalation Rule",
        expected: "user_s_on_call_duty_escalation_rule",
      },
      {
        input: "Users On-Call Duty Escalation Rule",
        expected: "users_on_call_duty_escalation_rule",
      },
      { input: "MonitorGroup", expected: "monitor_group" },
      { input: "StatusPageSubscriber", expected: "status_page_subscriber" },
    ];

    for (const testCase of testCases) {
      const result = (DynamicToolGenerator as any).sanitizeToolName(
        testCase.input,
      );
      console.log(`Input: "${testCase.input}" -> Output: "${result}"`);
      expect(result).toBe(testCase.expected);
    }
  });

  test("should generate proper tool names for OnCallDutyPolicyEscalationRule model", () => {
    // Test the actual model that was mentioned in the issue
    const onCallDutyModel =
      new (require("Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule").default)();
    const tools = DynamicToolGenerator.generateToolsForDatabaseModel(
      onCallDutyModel,
      require("Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule")
        .default,
    );

    console.log("OnCallDutyPolicyEscalationRule model info:");
    console.log("- tableName:", onCallDutyModel.tableName);
    console.log("- singularName:", onCallDutyModel.singularName);
    console.log("- pluralName:", onCallDutyModel.pluralName);

    console.log("\nGenerated tool names:");
    tools.tools.forEach((tool) => {
      console.log(`- ${tool.operation}: ${tool.name}`);
    });

    // Check that tool names are properly formatted
    const createTool = tools.tools.find((tool) => {
      return tool.operation === OneUptimeOperation.Create;
    });
    const listTool = tools.tools.find((tool) => {
      return tool.operation === OneUptimeOperation.List;
    });

    // Should be create_escalation_rule not create_escalation_rule_s or something weird
    expect(createTool?.name).toMatch(/^create_[a-z_]+$/);
    expect(listTool?.name).toMatch(/^list_[a-z_]+$/);

    // Should not contain invalid patterns like "_s_" or double underscores
    tools.tools.forEach((tool) => {
      expect(tool.name).not.toContain("_s_");
      expect(tool.name).not.toContain("__");
      expect(tool.name).toMatch(/^[a-z0-9_]+$/);
    });
  });

  test("should clean up descriptions by removing permission information", () => {
    // Test the cleanDescription method directly
    const testCases = [
      {
        input:
          "Should this incident be visible on the status page?. Permissions - Create: [Project Owner, Project Admin, Project Member, Create Incident], Read: [Project Owner, Project Admin, Project Member, Read Incident], Update: [Project Owner, Project Admin, Project Member, Edit Incident]",
        expected: "Should this incident be visible on the status page?",
      },
      {
        input:
          "Title of this incident. Permissions - Create: [Project Owner, Project Admin, Project Member, Create Incident], Read: [Project Owner, Project Admin, Project Member, Read Incident], Update: [Project Owner, Project Admin, Project Member, Edit Incident]",
        expected: "Title of this incident.",
      },
      {
        input: "Simple description without permissions",
        expected: "Simple description without permissions",
      },
      {
        input:
          "Description ending with period. Permissions - Create: [Some permissions here]",
        expected: "Description ending with period.",
      },
      {
        input: "Permissions - Create: [Only permissions, no description]",
        expected: "Permissions - Create: [Only permissions, no description]",
      },
    ];

    for (const testCase of testCases) {
      const result = (DynamicToolGenerator as any).cleanDescription(
        testCase.input,
      );
      console.log(`Input: "${testCase.input}"`);
      console.log(`Expected: "${testCase.expected}"`);
      console.log(`Result: "${result}"`);
      console.log("---");
      expect(result).toBe(testCase.expected);
    }
  });
});
