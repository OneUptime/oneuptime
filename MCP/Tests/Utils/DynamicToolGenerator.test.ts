import DynamicToolGenerator from "../../Utils/DynamicToolGenerator";
import { ModelSchema } from "Common/Utils/Schema/ModelSchema";
import Incident from "Common/Models/DatabaseModels/Incident";
import OneUptimeOperation from "../../Types/OneUptimeOperation";
import { z } from "zod";

describe("DynamicToolGenerator", () => {
  describe("zodToJsonSchema debugging", () => {
    test("should debug Zod schema structure and OpenAPI metadata", () => {
      // Generate the create schema for Incident
      const createSchema: z.ZodSchema = ModelSchema.getCreateModelSchema({
        modelType: Incident,
      });

      // Check if shape exists and is a function
      const shape: any = (createSchema as any)._def?.shape;

      if (shape && typeof shape === "function") {
        const shapeResult: any = shape();

        // Look at a few fields to understand the structure
        const fields: [string, any][] = Object.entries(shapeResult).slice(0, 3);

        for (const [, value] of fields) {
          // Check different possible locations for OpenAPI metadata
          const fieldDef: any = (value as any)._def;

          // Check if it's a ZodOptional and look at the inner type
          if (fieldDef?.typeName === "ZodOptional") {
            // Test inner type structure
            expect(fieldDef.innerType).toBeDefined();
          }
        }
      }

      // Test the current zodToJsonSchema method to see what it produces
      const jsonSchema: any = (DynamicToolGenerator as any).zodToJsonSchema(
        createSchema,
      );

      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.properties).toBeDefined();
    });

    test("should generate tools for Incident model", () => {
      const incident: Incident = new Incident();
      const tools: any = DynamicToolGenerator.generateToolsForDatabaseModel(
        incident,
        Incident,
      );

      expect(tools.tools.length).toBeGreaterThan(0);

      // Check the create tool specifically
      const createTool: any = tools.tools.find((tool: any) => {
        return tool.operation === OneUptimeOperation.Create;
      });

      if (createTool) {
        expect(createTool.inputSchema.properties).toBeDefined();
        expect(
          Object.keys(createTool.inputSchema.properties).length,
        ).toBeGreaterThan(0);
      }
    });

    test("should extract proper OpenAPI metadata instead of fallback", () => {
      const createSchema: z.ZodSchema = ModelSchema.getCreateModelSchema({
        modelType: Incident,
      });
      const jsonSchema: any = (DynamicToolGenerator as any).zodToJsonSchema(
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
    const testCases: Array<{ input: string; expected: string }> = [
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
      const result: string = (DynamicToolGenerator as any).sanitizeToolName(
        testCase.input,
      );
      expect(result).toBe(testCase.expected);
    }
  });

  test("should generate proper tool names for OnCallDutyPolicyEscalationRule model", () => {
    // Test the actual model that was mentioned in the issue
    // eslint-disable-next-line @typescript-eslint/no-require-imports

    const OnCallDutyPolicyEscalationRule: any =
      new OnCallDutyPolicyEscalationRule();
    const tools: any = DynamicToolGenerator.generateToolsForDatabaseModel(
      OnCallDutyPolicyEscalationRule,
      OnCallDutyPolicyEscalationRule,
    );

    expect(tools.tools.length).toBeGreaterThan(0);

    // Check that tool names are properly formatted
    const createTool: any = tools.tools.find((tool: any) => {
      return tool.operation === OneUptimeOperation.Create;
    });
    const listTool: any = tools.tools.find((tool: any) => {
      return tool.operation === OneUptimeOperation.List;
    });

    // Should be create_escalation_rule not create_escalation_rule_s or something weird
    expect(createTool?.name).toMatch(/^create_[a-z_]+$/);
    expect(listTool?.name).toMatch(/^list_[a-z_]+$/);

    // Should not contain invalid patterns like "_s_" or double underscores
    tools.tools.forEach((tool: any) => {
      expect(tool.name).not.toContain("_s_");
      expect(tool.name).not.toContain("__");
      expect(tool.name).toMatch(/^[a-z0-9_]+$/);
    });
  });

  test("should clean up descriptions by removing permission information", () => {
    // Test the cleanDescription method directly
    const testCases: Array<{ input: string; expected: string }> = [
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
      const result: string = (DynamicToolGenerator as any).cleanDescription(
        testCase.input,
      );
      expect(result).toBe(testCase.expected);
    }
  });
});
