/*
 * The tool definitions the model reads with every call (issue #6441): every
 * tool the agent runs is defined, every argument a tool requires is one it
 * describes, and the names a server-side tool may never take are exactly
 * the Runner's own.
 */

import {
  buildRunCommandToolDefinition,
  buildWorkspaceToolDefinitions,
  RUNNER_TOOL_NAMES,
} from "../../../CodeAgents/Tools/CodeAgentToolDefinitions";
import { LLMToolDefinition } from "Common/Server/Utils/LLM/LLMService";
import { JSONObject } from "Common/Types/JSON";

function toolNames(tools: Array<LLMToolDefinition>): Array<string> {
  return tools.map((tool: LLMToolDefinition) => {
    return tool.name;
  });
}

describe("the workspace tool definitions", () => {
  const tools: Array<LLMToolDefinition> = buildWorkspaceToolDefinitions();

  test("are the tools the agent runs on every Runner, in a fixed order", () => {
    expect(toolNames(tools)).toEqual([
      "read_file",
      "edit_file",
      "write_file",
      "delete_file",
      "move_file",
      "list_directory",
      "find_files",
      "search_files",
      "git",
      "read_tool_output",
      "update_plan",
    ]);
  });

  test("never offer run_command: only a Runner that runs commands adds it", () => {
    expect(toolNames(tools)).not.toContain("run_command");
    expect(buildRunCommandToolDefinition().name).toBe("run_command");
  });

  test("the Runner's own tool names are these and run_command, each once", () => {
    expect([...RUNNER_TOOL_NAMES].sort()).toEqual(
      [...toolNames(tools), "run_command"].sort(),
    );
    expect(new Set(RUNNER_TOOL_NAMES).size).toBe(RUNNER_TOOL_NAMES.length);
  });

  test.each(
    [...buildWorkspaceToolDefinitions(), buildRunCommandToolDefinition()].map(
      (tool: LLMToolDefinition) => {
        return [tool.name, tool] as [string, LLMToolDefinition];
      },
    ),
  )(
    "%s: an object schema whose required arguments are all described",
    (_name: string, tool: LLMToolDefinition) => {
      const schema: JSONObject = tool.inputSchema as JSONObject;
      const properties: JSONObject = (schema["properties"] as JSONObject) || {};

      expect(schema["type"]).toBe("object");
      expect(tool.description.length).toBeGreaterThan(20);

      for (const required of (schema["required"] as Array<string>) || []) {
        expect(Object.keys(properties)).toContain(required);
      }

      for (const property of Object.values(properties)) {
        expect((property as JSONObject)["type"]).toBeDefined();
      }
    },
  );

  test("read_file says how much it shows at once and how to read on", () => {
    const readFile: LLMToolDefinition = tools.find(
      (tool: LLMToolDefinition) => {
        return tool.name === "read_file";
      },
    )!;

    expect(readFile.description).toContain("Reads up to 2,000 lines at a time");
    expect(readFile.description).toContain("start_line and end_line");
  });

  test("the git tool offers only read-only actions", () => {
    const gitTool: LLMToolDefinition = tools.find((tool: LLMToolDefinition) => {
      return tool.name === "git";
    })!;
    const action: JSONObject = (
      (gitTool.inputSchema as JSONObject)["properties"] as JSONObject
    )["action"] as JSONObject;

    expect(action["enum"]).toEqual(["status", "diff", "log", "show", "blame"]);
  });
});
