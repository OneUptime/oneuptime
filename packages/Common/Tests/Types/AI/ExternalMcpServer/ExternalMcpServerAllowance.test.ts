import {
  EVERY_EXTERNAL_MCP_SERVER,
  ExternalMcpServerAllowance,
  MAX_EXTERNAL_MCP_SERVERS_PER_RULE,
  NO_EXTERNAL_MCP_SERVER,
  RULE_TOO_MANY_EXTERNAL_MCP_SERVERS_MESSAGE,
  allowsAnyExternalMcpServer,
  getExternalMcpServerAllowance,
  getRuleExternalMcpServersProblem,
  isExternalMcpServerAllowed,
  readExternalMcpServerIds,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import { MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerLimits";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Which of the project's external MCP servers OneUptime AI may use for one
 * signal. The maintainer: "If there are no MCP servers selected, by
 * default, you can say, 'Allow all MCP servers to be used.'"
 */

const AWS: string = "a1111111-1111-4111-8111-111111111111";
const AZURE: string = "a2222222-2222-4222-8222-222222222222";
const GITHUB: string = "a3333333-3333-4333-8333-333333333333";

describe("readExternalMcpServerIds", () => {
  test("reads ids written every way a rule holds them, each once, in lower case", () => {
    expect(
      readExternalMcpServerIds([
        AWS.toUpperCase(),
        { _id: AZURE },
        { id: GITHUB },
        new ObjectID(AWS),
        { value: AZURE, label: "Azure" },
        "",
        null,
        7,
      ]),
    ).toEqual([AWS, AZURE, GITHUB]);
  });

  test("a single id is a list of one, and nothing is an empty list", () => {
    expect(readExternalMcpServerIds(AWS)).toEqual([AWS]);
    expect(readExternalMcpServerIds(undefined)).toEqual([]);
    expect(readExternalMcpServerIds(null)).toEqual([]);
  });
});

describe("getExternalMcpServerAllowance", () => {
  test("with no rule set up, every server", () => {
    expect(
      getExternalMcpServerAllowance({ rulesSetUp: false, matchingRules: [] }),
    ).toEqual(EVERY_EXTERNAL_MCP_SERVER);
  });

  test("a matching rule that names none allows every server, whatever the others name", () => {
    expect(
      getExternalMcpServerAllowance({
        rulesSetUp: true,
        matchingRules: [
          { externalMcpServers: [{ _id: AWS }] },
          { externalMcpServers: [] },
        ],
      }),
    ).toEqual(EVERY_EXTERNAL_MCP_SERVER);
  });

  test("matching rules that name some allow the servers any of them names", () => {
    expect(
      getExternalMcpServerAllowance({
        rulesSetUp: true,
        matchingRules: [
          { externalMcpServers: [{ _id: AWS }, { _id: AZURE }] },
          { externalMcpServers: [{ _id: AZURE }, { _id: GITHUB }] },
        ],
      }),
    ).toEqual({ isEveryServer: false, serverIds: [AWS, AZURE, GITHUB] });
  });

  test("with rules set up and none matching, no server", () => {
    expect(
      getExternalMcpServerAllowance({ rulesSetUp: true, matchingRules: [] }),
    ).toEqual(NO_EXTERNAL_MCP_SERVER);
  });
});

describe("isExternalMcpServerAllowed", () => {
  test("every server, or only the ones named", () => {
    const some: ExternalMcpServerAllowance = {
      isEveryServer: false,
      serverIds: [AWS],
    };

    expect(isExternalMcpServerAllowed(EVERY_EXTERNAL_MCP_SERVER, GITHUB)).toBe(
      true,
    );
    expect(isExternalMcpServerAllowed(some, AWS.toUpperCase())).toBe(true);
    expect(isExternalMcpServerAllowed(some, new ObjectID(AWS))).toBe(true);
    expect(isExternalMcpServerAllowed(some, AZURE)).toBe(false);
    expect(isExternalMcpServerAllowed(some, undefined)).toBe(false);
    expect(isExternalMcpServerAllowed(NO_EXTERNAL_MCP_SERVER, AWS)).toBe(false);
  });

  test("whether any server may be used at all", () => {
    expect(allowsAnyExternalMcpServer(EVERY_EXTERNAL_MCP_SERVER)).toBe(true);
    expect(
      allowsAnyExternalMcpServer({ isEveryServer: false, serverIds: [AWS] }),
    ).toBe(true);
    expect(allowsAnyExternalMcpServer(NO_EXTERNAL_MCP_SERVER)).toBe(false);
  });
});

describe("getRuleExternalMcpServersProblem", () => {
  test("a rule names at most as many servers as a project may have", () => {
    expect(MAX_EXTERNAL_MCP_SERVERS_PER_RULE).toBe(
      MAX_EXTERNAL_MCP_SERVERS_PER_PROJECT,
    );

    const ids: Array<string> = [];

    for (
      let index: number = 0;
      index <= MAX_EXTERNAL_MCP_SERVERS_PER_RULE;
      index++
    ) {
      ids.push(`a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    }

    expect(
      getRuleExternalMcpServersProblem(
        ids.slice(0, MAX_EXTERNAL_MCP_SERVERS_PER_RULE),
      ),
    ).toBe(null);
    expect(getRuleExternalMcpServersProblem(ids)).toBe(
      RULE_TOO_MANY_EXTERNAL_MCP_SERVERS_MESSAGE,
    );
    expect(getRuleExternalMcpServersProblem(undefined)).toBe(null);
  });
});
