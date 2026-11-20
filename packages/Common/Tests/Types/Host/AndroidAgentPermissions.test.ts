import fs from "fs";
import path from "path";
import AndroidAgentPermissions, {
  ANDROID_AGENT_GRANT_COMMANDS,
  ANDROID_AGENT_PERMISSIONS_ATTRIBUTE,
  AndroidAgentPermission,
  AndroidAgentPermissionsStatus,
} from "../../../Types/Host/AndroidAgentPermissions";
import { describe, expect, test } from "@jest/globals";

/*
 * The grants the OneUptime Android agent still lacks on a device (#9967),
 * as its reports say them, read by Inventory's Agent Permissions filter and
 * column. Held to the agent's own words (agents/AndroidAgent,
 * agent/AgentPermissions.kt and agent/AgentEvents.kt).
 */

const AGENT: string = path.resolve(
  __dirname,
  "../../../../../agents/AndroidAgent/app/src/main/java/com/oneuptime/androidagent/agent",
);

function agentSource(file: string): string {
  return fs.readFileSync(path.join(AGENT, file), "utf8");
}

describe("what the agent says", () => {
  test("is the attribute and the names the agent sends", () => {
    const permissions: string = agentSource("AgentPermissions.kt");

    expect(permissions).toContain(
      `const val ATTRIBUTE: String = "${ANDROID_AGENT_PERMISSIONS_ATTRIBUTE}"`,
    );
    expect(permissions).toContain('const val NONE: String = "none"');
    for (const name of Object.values(AndroidAgentPermission)) {
      expect(permissions).toContain(`("${name}", `);
    }
  });

  test("each grant's command is the one the agent's screen shows", () => {
    const events: string = agentSource("AgentEvents.kt");

    for (const command of Object.values(ANDROID_AGENT_GRANT_COMMANDS)) {
      expect(events).toContain(`"${command}"`);
    }
  });
});

describe("reading it", () => {
  test("none missing is an empty list, and all granted", () => {
    expect(AndroidAgentPermissions.readMissing("none")).toEqual([]);
    expect(AndroidAgentPermissions.getStatus("none")).toBe(
      AndroidAgentPermissionsStatus.Granted,
    );
  });

  test("the grants still to give, in the agent's order, are missing", () => {
    expect(
      AndroidAgentPermissions.readMissing(
        "READ_LOGS READ_DROPBOX_DATA GET_USAGE_STATS",
      ),
    ).toEqual([
      AndroidAgentPermission.ReadLogs,
      AndroidAgentPermission.ReadDropBoxData,
      AndroidAgentPermission.UsageAccess,
    ]);
    expect(AndroidAgentPermissions.readMissing("GET_USAGE_STATS")).toEqual([
      AndroidAgentPermission.UsageAccess,
    ]);
    expect(AndroidAgentPermissions.getStatus("READ_LOGS")).toBe(
      AndroidAgentPermissionsStatus.Missing,
    );
  });

  test("what the agent does not send is no status: a host without the agent is in neither list", () => {
    for (const value of [
      undefined,
      null,
      "",
      "  ",
      "READ_CONTACTS",
      "READ_LOGS,GET_USAGE_STATS",
      "READ_LOGS  GET_USAGE_STATS",
      "read_logs",
      42,
    ]) {
      expect(AndroidAgentPermissions.getStatus(value)).toBeUndefined();
    }
  });
});

describe("its SQL", () => {
  test("reads the attribute off the item and agrees with the rule on the agent's words", () => {
    const sql: string = AndroidAgentPermissions.getStatusSql('"InventoryItem"');

    expect(sql).toContain(
      `btrim("InventoryItem"."descriptiveAttributes" ->> 'oneuptime.agent.permissions.missing')`,
    );
    expect(sql).toContain("= 'none' THEN 'granted'");
    expect(sql).toContain(
      "~ '^(READ_LOGS|READ_DROPBOX_DATA|GET_USAGE_STATS)( (READ_LOGS|READ_DROPBOX_DATA|GET_USAGE_STATS))*$' THEN 'missing'",
    );
    expect(sql).toContain("ELSE NULL");
  });
});
