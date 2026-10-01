import { describe, expect, test } from "@jest/globals";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getMcpToolNames,
  hasMcpTools,
  McpToolNames,
} from "Common/Utils/DeveloperDocs/AiAssistantExamples";
import { generateToolsForDatabaseModel } from "../Tools/ToolGenerator";
import { McpToolInfo, ModelToolsResult } from "../Types/McpTypes";

/*
 * The dashboard's Developer > AI Assistants pages tell people which tools an
 * assistant will use on a resource (Common/Utils/DeveloperDocs/
 * AiAssistantExamples.ts works the names out in the browser). This holds
 * those names to the tools this server really generates, for every model:
 * rename a model, or turn MCP on for one, and the page must follow.
 */

describe("the Developer pages name the MCP server's real tools", () => {
  const cases: Array<[string, { new (): DatabaseBaseModel }]> =
    DatabaseModels.map(
      (
        modelType: { new (): DatabaseBaseModel },
      ): [string, { new (): DatabaseBaseModel }] => {
        return [modelType.name, modelType];
      },
    );

  test.each(cases)(
    "%s",
    (_name: string, modelType: { new (): DatabaseBaseModel }) => {
      const generated: ModelToolsResult = generateToolsForDatabaseModel(
        new modelType(),
        modelType,
      );
      const generatedNames: Array<string> = generated.tools
        .map((tool: McpToolInfo): string => {
          return tool.name;
        })
        .sort();

      const names: McpToolNames | null = getMcpToolNames(modelType);
      const pageNames: Array<string> = names ? Object.values(names).sort() : [];

      expect(pageNames).toEqual(generatedNames);
      expect(hasMcpTools(modelType)).toBe(generatedNames.length > 0);
    },
  );

  test("the sweep covers the models that have tools", () => {
    expect(
      DatabaseModels.filter((modelType: { new (): DatabaseBaseModel }) => {
        return hasMcpTools(modelType);
      }).length,
    ).toBeGreaterThanOrEqual(20);
  });
});
