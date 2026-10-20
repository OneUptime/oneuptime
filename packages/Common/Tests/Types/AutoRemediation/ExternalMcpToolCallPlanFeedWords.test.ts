import { describe, expect, test } from "@jest/globals";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";

/*
 * HOW THE FEED NAMES A FIX THROUGH MCP SERVERS.
 *
 * A fix's feed lines go to the incident's feed and, for the ones that ping,
 * to its Slack or Microsoft Teams channel, where on-call people read them
 * on a phone. They used to say "(1 change(s))" and "MCP server "AWS",
 * "GitHub"": the count and the servers are now said the way a person would.
 */

function call(sequence: number, serverName: string): ExternalMcpToolCall {
  return {
    sequence,
    serverId: `server-${serverName}`,
    serverNameSnapshot: serverName,
    toolName: "restart_service",
    arguments: {},
    status: ExternalMcpToolCallStatus.Proposed,
  };
}

function plan(...serverNames: Array<string>): ExternalMcpToolCallPlan {
  return {
    calls: serverNames.map((name: string, index: number) => {
      return call(index + 1, name);
    }),
  };
}

describe("a fix's changes, counted", () => {
  test.each([
    [1, "1 change"],
    [2, "2 changes"],
    [5, "5 changes"],
    [0, "0 changes"],
  ])("%i is %s", (count: number, words: string) => {
    expect(ExternalMcpToolCallPlanUtil.describeChangeCount(count)).toBe(words);
  });

  test("never the (s) of a count nobody worded", () => {
    for (let count: number = 0; count <= 5; count++) {
      expect(
        ExternalMcpToolCallPlanUtil.describeChangeCount(count),
      ).not.toContain("(s)");
    }
  });
});

describe("the servers a fix goes through, named", () => {
  test("one server is the MCP server, by its name", () => {
    expect(ExternalMcpToolCallPlanUtil.describeServers(plan("AWS"))).toBe(
      'MCP server "AWS"',
    );
  });

  test("a server with several changes is named once", () => {
    expect(
      ExternalMcpToolCallPlanUtil.describeServers(plan("AWS", "AWS", "AWS")),
    ).toBe('MCP server "AWS"');
  });

  test("two servers are joined with and", () => {
    expect(
      ExternalMcpToolCallPlanUtil.describeServers(plan("AWS", "GitHub")),
    ).toBe('MCP servers "AWS" and "GitHub"');
  });

  test("three or more: a list, its last joined with and, in the order of the changes", () => {
    expect(
      ExternalMcpToolCallPlanUtil.describeServers(
        plan("Azure", "AWS", "Azure", "GitHub"),
      ),
    ).toBe('MCP servers "Azure", "AWS" and "GitHub"');
  });

  test("a plan with no change names the servers in general", () => {
    expect(ExternalMcpToolCallPlanUtil.describeServers({ calls: [] })).toBe(
      "MCP servers",
    );
  });
});
