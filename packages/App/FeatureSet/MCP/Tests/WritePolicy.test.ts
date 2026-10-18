/*
 * WHAT MCP_READ_ONLY AND MCP_ALLOW_DESTRUCTIVE TAKE AWAY.
 *
 * A tool's hints are advice that a client may ignore, so an operator can take
 * tools off the server altogether: MCP_READ_ONLY=true leaves only the tools
 * that change nothing, and MCP_ALLOW_DESTRUCTIVE=false takes the delete tools
 * away and keeps the rest. Every write says it is destructive
 * (Tools/ToolAnnotations), so the second goes by what a tool does - it
 * deletes - and not by its hint, which would take every write away.
 */

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import {
  applyWritePolicy,
  generateAllTools,
  getWritePolicy,
  WritePolicy,
} from "../Tools/ToolGenerator";
import { McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";

function namesOf(tools: Array<McpToolInfo>): Array<string> {
  return tools.map((tool: McpToolInfo): string => {
    return tool.name;
  });
}

describe("the write policy", () => {
  const tools: Array<McpToolInfo> = generateAllTools();

  test("an operator who sets neither gets every tool (the checks below are not vacuous)", () => {
    const policy: WritePolicy = getWritePolicy({});

    expect(policy).toEqual({ readOnly: false, allowDestructive: true });
    expect(applyWritePolicy(tools, policy)).toBe(tools);
    expect(namesOf(tools)).toContain("delete_incident");
    expect(namesOf(tools)).toContain("update_incident");
  });

  test("MCP_ALLOW_DESTRUCTIVE=false takes the delete tools away, and keeps every other tool", () => {
    const policy: WritePolicy = getWritePolicy({
      MCP_ALLOW_DESTRUCTIVE: "false",
    });
    const kept: Array<string> = namesOf(applyWritePolicy(tools, policy));

    expect(policy).toEqual({ readOnly: false, allowDestructive: false });
    expect(kept).toEqual(
      namesOf(
        tools.filter((tool: McpToolInfo): boolean => {
          return tool.operation !== OneUptimeOperation.Delete;
        }),
      ),
    );

    // Destructive by their hints, and kept all the same.
    for (const name of [
      "create_incident",
      "update_incident",
      "acknowledge_incident",
      "resolve_incident",
      "add_incident_note",
    ]) {
      expect([name, kept.includes(name)]).toEqual([name, true]);
    }

    expect(
      kept.filter((name: string): boolean => {
        return name.startsWith("delete_");
      }),
    ).toEqual([]);
  });

  test("MCP_READ_ONLY=true leaves only the tools that change nothing", () => {
    const kept: Array<McpToolInfo> = applyWritePolicy(
      tools,
      getWritePolicy({ MCP_READ_ONLY: "true" }),
    );

    expect(namesOf(kept)).toEqual(
      namesOf(
        tools.filter((tool: McpToolInfo): boolean => {
          return tool.annotations?.readOnlyHint === true;
        }),
      ),
    );
    expect(namesOf(kept)).toContain("list_incidents");
    expect(namesOf(kept)).not.toContain("acknowledge_incident");
  });

  test.each([
    ["true", true],
    ["1", true],
    ["yes", true],
    [" TRUE ", true],
    ["false", false],
    ["0", false],
    ["no", false],
    ["", false],
  ])(
    "reads %p as %p, for either setting",
    (value: string, enabled: boolean) => {
      expect(getWritePolicy({ MCP_READ_ONLY: value }).readOnly).toBe(enabled);
      expect(
        getWritePolicy({ MCP_ALLOW_DESTRUCTIVE: value }).allowDestructive,
      ).toBe(enabled);
    },
  );
});
