import { describe, expect, it } from "@jest/globals";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import {
  generateToolsForDatabaseModel,
  withKeptToolName,
} from "../Tools/ToolGenerator";
import { handleHelperTool } from "../Tools/HelperTools";
import { McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";

/*
 * A MODEL RENAMED ON SCREEN KEEPS ITS TOOLS' NAMES (#6817).
 *
 * On-Call Duty Policies are On-Call Policies on screen now. An agent, and
 * the list of tools a person allowed it, still call list_on_call_duty_policies:
 * a tool is named by the names the model keeps in the API
 * (Common/Utils/ModelApiName), while its title says what it is called now,
 * and the help tools name it the way it is called.
 */

function toolNamed(
  tools: Array<McpToolInfo>,
  operation: OneUptimeOperation,
): McpToolInfo {
  return tools.find((tool: McpToolInfo): boolean => {
    return tool.operation === operation;
  }) as McpToolInfo;
}

describe("the tools of a model #6817 renamed", () => {
  const tools: Array<McpToolInfo> = generateToolsForDatabaseModel(
    new OnCallDutyPolicy(),
    OnCallDutyPolicy,
  ).tools;

  it("keep the names agents call, by the model's kept names", () => {
    expect(
      tools.map((tool: McpToolInfo): string => {
        return tool.name;
      }),
    ).toEqual([
      "create_on_call_policy",
      "get_on_call_policy",
      "list_on_call_duty_policies",
      "update_on_call_policy",
      "delete_on_call_policy",
      "count_on_call_duty_policies",
    ]);
  });

  it("say the new name in their titles and descriptions", () => {
    const list: McpToolInfo = toolNamed(tools, OneUptimeOperation.List);

    expect(list.title).toBe("List On-Call Policies");
    expect(list.description).toContain("On-Call Policies");
    expect(list.description).not.toContain("Duty");
    expect(list.pluralName).toBe("On-Call Policies");
    expect(list.apiPluralName).toBe("On-Call Duty Policies");
  });

  it("are listed by the help tools under the names they are called by", () => {
    const answer: {
      resources: Array<{ name: string; tools: Record<string, string> }>;
    } = JSON.parse(handleHelperTool("oneuptime_list_resources", {}, tools));
    const resource: { name: string; tools: Record<string, string> } =
      answer.resources.find((candidate: { name: string }): boolean => {
        return candidate.name === "OnCallDutyPolicy";
      })!;

    expect(resource.tools["list"]).toBe("list_on_call_duty_policies");
    expect(resource.tools["get"]).toBe("get_on_call_policy");
  });
});

describe("the tools of a model never renamed", () => {
  it("are named and titled as they always were, with no kept names", () => {
    const tools: Array<McpToolInfo> = generateToolsForDatabaseModel(
      new Monitor(),
      Monitor,
    ).tools;
    const list: McpToolInfo = toolNamed(tools, OneUptimeOperation.List);

    expect(list.name).toBe("list_monitors");
    expect(list.title).toBe("List Monitors");
    expect(list.apiPluralName).toBeUndefined();
    expect(list.apiSingularName).toBeUndefined();
  });

  it("keep a name already right when renamed again by the kept names", () => {
    const tool: McpToolInfo = {
      name: "count_monitors",
      description: "",
      inputSchema: { type: "object" },
      modelName: "Monitor",
      operation: OneUptimeOperation.Count,
      modelType: ModelType.Database,
      singularName: "Monitor",
      pluralName: "Monitors",
      tableName: "Monitor",
    };

    expect(withKeptToolName(tool, new Monitor()).name).toBe("count_monitors");
  });
});
