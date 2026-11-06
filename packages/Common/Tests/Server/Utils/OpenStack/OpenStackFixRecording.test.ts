import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  OpenStackFix,
  OpenStackFixOutcome,
  buildOpenStackFixChangeEntries,
} from "../../../../Server/Utils/OpenStack/OpenStackFixChangeEntries";
import { ParsedChangeEventEntry } from "../../../../Server/Utils/Telemetry/ChangeEventRow";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  OpenStackChangeReach,
  OpenStackReachInstance,
  OpenStackReachProject,
  readOpenStackChangeReach,
} from "../../../../Utils/AiRemediation/Resource/OpenStackChangeReach";
import { readOpenStackChange } from "../../../../Utils/AiRemediation/Resource/OpenStackCommandPolicy";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { tokenizeResourceCommand } from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import {
  OPENSTACK_EVENT_HOST_ATTRIBUTE,
  OPENSTACK_EVENT_SERVICE_ATTRIBUTE,
} from "../../../../Utils/OpenStack/OpenStackNotifications";
import { ChangeEventAttribute } from "../../../../Utils/Telemetry/ChangeEventFields";

/*
 * WHAT A REAL CLOUD DID WITH REAL FIXES.
 *
 * Run 42008750607 of the rig (ai-agent-record.sh, ai-agent-fix.js) on a real DevStack, with
 * the agent's real policy and executor over real sockets, and a write credential made the way
 * the guide says. A real nova-compute was disabled, proposed for re-enabling and re-enabled,
 * and the admin's own client read it back. A real fake-driver hypervisor was stopped, and the
 * proposal to evacuate it listed its real instances and projects. Then what that credential
 * can't do was asked of the cloud directly. There is no OneUptime in it and no model:
 * "proposed" is the dry run a fix's card reads, and "approved" is the job an approval sends.
 *
 * Nothing here calls anything. It holds what was recorded, and holds today's code to it: the
 * policy still tiers these commands as it did, and what the agent printed still reads back as
 * what a person is shown and what a change event says.
 */

const RECORDING: string = path.resolve(
  __dirname,
  "../../../Fixtures/OpenStack/ai-agent/hibiscus-ovn/fixes",
);

const HOST: string = "compute-01";
const DEAD_HOST: string = "ou-fake-compute";

interface Proposal {
  command: string;
  tier: string;
  requiresHuman: boolean;
  reach: OpenStackChangeReach;
  output: string;
}

interface Result {
  command: string;
  result: {
    success: boolean;
    exitCode: number;
    output: string;
    errorMessage?: string | null;
  };
}

interface LadderRow {
  mode: string;
  verdict: string;
  requiresHuman: boolean;
}

function text(name: string): string {
  return fs.readFileSync(path.join(RECORDING, name), "utf8");
}

function recorded<T>(name: string): T {
  return JSON.parse(text(name)) as T;
}

const ENABLE: Proposal = recorded<Proposal>("enable-proposal.json");
const ENABLED: Result = recorded<Result>("enable-result.json");
const EVACUATE: Proposal = recorded<Proposal>("evacuate-proposal.json");
const EVACUATED: Result = recorded<Result>("evacuate-result.json");

// The same four the driver asks of the policy, each with what it was told.
function ladderToday(command: string): Array<LadderRow> {
  return [
    { mode: "Automatic", allowlisted: false, bypassApproval: false },
    {
      mode: "Automatic, allowlisted",
      allowlisted: true,
      bypassApproval: false,
    },
    { mode: "Bypass approval", allowlisted: false, bypassApproval: true },
    {
      mode: "Bypass approval, allowlisted",
      allowlisted: true,
      bypassApproval: true,
    },
  ].map(
    (row: {
      mode: string;
      allowlisted: boolean;
      bypassApproval: boolean;
    }): LadderRow => {
      const verdict: { verdict: string; requiresHuman?: boolean | undefined } =
        ResourceCommandPolicy.evaluateForAutoExecution({
          resourceType: AiResourceType.OpenStackCloud,
          command,
          allowlistPatterns: row.allowlisted ? [command] : [],
          bypassApproval: row.bypassApproval,
        });

      return {
        mode: row.mode,
        verdict: verdict.verdict,
        requiresHuman: verdict.requiresHuman === true,
      };
    },
  );
}

function changeEvents(result: Result): Array<ParsedChangeEventEntry> {
  const fix: OpenStackFix = {
    jobId: new ObjectID("5e7a1b30-0000-4000-8000-000000000002"),
    cloudId: new ObjectID("5e7a1b30-0000-4000-8000-000000000003"),
    cloudName: "rig",
    command: result.command,
    change: readOpenStackChange(
      tokenizeResourceCommand(result.command).argv,
    ) as OpenStackFix["change"],
    reach: readOpenStackChangeReach(result.result.output),
    outcome: OpenStackFixOutcome.Accepted,
    time: new Date("2026-11-05T10:30:00.000Z"),
    approval: {
      name: "Jane Doe",
      userId: new ObjectID("5e7a1b30-0000-4000-8000-000000000004"),
      from: "Dashboard",
    },
    isRollback: false,
  } as OpenStackFix;

  return buildOpenStackFixChangeEntries(fix);
}

describe("a real disabled nova-compute", () => {
  test("was read as disabled and still up, with why, before anything changed", () => {
    expect(ENABLE.command).toBe(
      `openstack compute service set --enable ${HOST} nova-compute`,
    );
    expect(ENABLE.output).toContain("Nothing was changed.");
    expect(ENABLE.reach.hosts).toEqual([
      {
        name: HOST,
        state: "up",
        status: "disabled",
        forcedDown: false,
        disabledReason: "ou rig: planned",
      },
    ]);
    expect(ENABLE.reach.kind).toBe("on-host");
    expect(ENABLE.reach.instanceCount).toBe(5);
    expect(ENABLE.reach.projectCount).toBe(2);
    expect(ENABLE.reach.isComplete).toBe(true);
    expect(ENABLE.reach.wouldBeRefused).toBeNull();
  });

  test("what the agent printed still reads as what the card shows", () => {
    expect(readOpenStackChangeReach(ENABLE.output)).toEqual(ENABLE.reach);
  });

  test("the policy still calls it what it did: safe, and not asking a person in every mode", () => {
    expect(ENABLE.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(ENABLE.requiresHuman).toBe(false);
    expect(
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.OpenStackCloud,
        command: ENABLE.command,
      }).tier,
    ).toBe(ResourceCommandTier.SafeWrite);
    expect(ladderToday(ENABLE.command)).toEqual(
      recorded<Array<LadderRow>>("enable-ladder.json"),
    );
  });

  test("on approval Nova took it, and the admin's own client read it back as enabled", () => {
    expect(ENABLED.command).toBe(ENABLE.command);
    expect(ENABLED.result.success).toBe(true);
    expect(ENABLED.result.exitCode).toBe(0);
    expect(ENABLED.result.output).toContain("This changes no instance.");
    expect(ENABLED.result.output).toContain(
      "/os-services/enable: Nova accepted it (HTTP 200).",
    );
    expect(text("enable-confirmed.txt").trim()).toBe(
      `nova-compute on ${HOST} reads enabled again, to the admin's own client.`,
    );
  });

  test("is one change event, on that service, with who approved it", () => {
    const events: Array<ParsedChangeEventEntry> = changeEvents(ENABLED);

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[OPENSTACK_EVENT_SERVICE_ATTRIBUTE]).toBe(
      "nova-compute",
    );
    expect(events[0]!.attributes[OPENSTACK_EVENT_HOST_ATTRIBUTE]).toBe(HOST);
    expect(events[0]!.attributes[ChangeEventAttribute.ApprovedBy]).toBe(
      "Jane Doe",
    );
  });
});

describe("a real dead hypervisor's evacuation", () => {
  test("the proposal listed its real instances and projects, and read the host as down", () => {
    expect(EVACUATE.output).toContain("Nothing was changed.");
    expect(EVACUATE.reach.hosts).toEqual([
      {
        name: DEAD_HOST,
        state: "down",
        status: "enabled",
        forcedDown: false,
        disabledReason: null,
      },
    ]);
    expect(
      EVACUATE.reach.instances
        .map((instance: OpenStackReachInstance): string => {
          return `${instance.name} in ${instance.projectName} on ${instance.host}`;
        })
        .sort(),
    ).toEqual([
      `ou-evacuate-payments in ou-payments on ${DEAD_HOST}`,
      `ou-evacuate-research in ou-research on ${DEAD_HOST}`,
    ]);
    expect(
      EVACUATE.reach.projects
        .map((project: OpenStackReachProject): string => {
          return `${project.name} ${project.instanceCount}`;
        })
        .sort(),
    ).toEqual(["ou-payments 1", "ou-research 1"]);
    expect(EVACUATE.reach.instanceCount).toBe(2);
    expect(EVACUATE.reach.projectCount).toBe(2);
    expect(EVACUATE.reach.isComplete).toBe(true);
    expect(EVACUATE.reach.problems).toEqual([]);
    expect(EVACUATE.reach.wouldBeRefused).toBeNull();
  });

  test("what the agent printed still reads as what the card shows", () => {
    expect(readOpenStackChangeReach(EVACUATE.output)).toEqual(EVACUATE.reach);
  });

  test("asks a person in every mode, allowlisted or not, then and now", () => {
    expect(EVACUATE.tier).toBe(ResourceCommandTier.RiskyWrite);
    expect(EVACUATE.requiresHuman).toBe(true);

    const ladder: Array<LadderRow> = recorded<Array<LadderRow>>(
      "evacuate-ladder.json",
    );

    expect(ladder).toHaveLength(4);

    for (const row of ladder) {
      expect(row.verdict).toBe("RequiresApproval");
      expect(row.requiresHuman).toBe(true);
    }

    expect(ladderToday(EVACUATE.command)).toEqual(ladder);
  });

  test("on approval each instance was its own call, and Nova began rebuilding them", () => {
    expect(EVACUATED.command).toBe(EVACUATE.command);
    expect(EVACUATED.result.success).toBe(true);
    expect(EVACUATED.result.output).toContain(
      "This changes 2 instances in 2 projects.",
    );

    const after: Array<{ ID: string; Status: string; "Task State": string }> =
      recorded("evacuate-after.json");

    expect(after).toHaveLength(2);

    for (const instance of after) {
      expect(EVACUATED.result.output).toContain(
        `/servers/${instance.ID}/action: Nova accepted it (HTTP 200).`,
      );
      expect(instance.Status).toBe("REBUILD");
      expect(instance["Task State"]).toBe("rebuild_spawning");
    }
  });

  test("is a change event for each instance it moved", () => {
    const events: Array<ParsedChangeEventEntry> = changeEvents(EVACUATED);
    const ids: Array<string> = EVACUATE.reach.instances.map(
      (instance: OpenStackReachInstance): string => {
        return instance.id;
      },
    );

    expect(
      events
        .map((event: ParsedChangeEventEntry): string => {
          return event.attributes[
            ChangeEventAttribute.CloudResourceId
          ] as string;
        })
        .sort(),
    ).toEqual(ids.slice().sort());
  });
});

describe("the other changes a real cloud took", () => {
  test.each([
    ["server-start-result.json", "openstack server start "],
    ["server-reboot---soft-result.json", "openstack server reboot --soft "],
  ])("%s", (name: string, words: string) => {
    const result: Result = recorded<Result>(name);

    expect(result.command.startsWith(words)).toBe(true);
    expect(result.result.success).toBe(true);
    expect(result.result.output).toContain("Nova accepted it (HTTP 202).");
    expect(result.result.output).toContain(
      "This changes 1 instance in 1 project.",
    );
  });
});

describe("with writes off, on a real agent", () => {
  test("a change is refused as a fix and as an investigation", () => {
    const off: { allowWrites: boolean; answers: Array<string> } =
      recorded("writes-off.json");

    expect(off.allowWrites).toBe(false);
    expect(off.answers).toHaveLength(2);
    expect(off.answers[0]).toContain("this agent is read-only");
    expect(off.answers[1]).toContain(
      "an investigation may only run read-only commands",
    );
  });
});

describe("what the guide's credential can do on a real cloud", () => {
  const answers: Array<{ what: string; status: number }> = recorded(
    "least-privilege.json",
  );

  test("anything its access rules don't name, it never got past Keystone's check", () => {
    expect(
      answers
        .filter((answer: { what: string; status: number }): boolean => {
          return answer.status === 401;
        })
        .map((answer: { what: string; status: number }): string => {
          return answer.what;
        }),
    ).toEqual([
      "DELETE /servers/{id}",
      "GET /servers/{id}",
      "PUT /os-services/force-down",
      "GET Keystone users",
      "GET Neutron's networks",
      "DELETE a Neutron agent",
      "GET Cinder's volumes",
    ]);
  });

  test("what shares a path with a start, the policy file refused", () => {
    expect(
      answers
        .filter((answer: { what: string; status: number }): boolean => {
          return answer.status === 403;
        })
        .map((answer: { what: string; status: number }): string => {
          return answer.what;
        }),
    ).toEqual([
      "POST /servers/{id}/action forceDelete",
      "POST /servers/{id}/action os-resetState",
      "POST /servers/{id}/action createImage",
      "POST /servers/{id}/action changePassword",
      "POST /servers/{id}/action os-stop",
      "POST /servers/{id}/action rebuild",
      "POST /servers/{id}/action lock",
      "POST /servers/{id}/action shelve",
    ]);
    expect(answers).toHaveLength(15);
  });
});

describe("the recording", () => {
  test.each(fs.readdirSync(RECORDING))(
    "%s holds no credential",
    (name: string) => {
      const content: string = text(name);

      expect(content).not.toMatch(/gAAAA|X-Subject-Token|X-Auth-Token/i);
      expect(content).not.toMatch(/application_credential_secret|adminPass/);
      expect(content).not.toContain("ou-ai-agent-rig-");
      expect(content).not.toContain("runnervm");
    },
  );
});
