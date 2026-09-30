import ResourceAccessContext, {
  describeResource,
  describeResourceAgent,
} from "../../../../../Server/Utils/AI/ResourceAccess/ResourceAccessContext";
import ResourceAiAccessService from "../../../../../Server/Services/ResourceAiAccessService";
import ObjectID from "../../../../../Types/ObjectID";
import AiResourceType from "../../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — ResourceAccessContext, the prompt-side view of
 * infrastructure access (the sibling of ClusterAccessContext):
 *
 * - the persona addendum names the resources the model may inspect and the
 *   rules (read-only, one argv per call, a failed command is not evidence,
 *   an unresponsive agent ends that resource's inspection, redaction), the
 *   resources it CANNOT inspect and why — naming the agent to install when
 *   none is connected — and always asks for an **Infrastructure access**
 *   report section;
 * - the context section lists each resource with its resourceId, and for a
 *   ready one its programs and remediation mode, for another the blocking
 *   reasons and, with no agent, the install step;
 * - all of it is deterministic text from the statuses.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DOCKER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const HOST_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

// Real statuses, built the way the access service builds them.
function readyDocker(
  mode: ResourceAiRemediationMode = ResourceAiRemediationMode.Disabled,
): ResourceAiAccessStatus {
  return ResourceAiAccessService.buildStatus({
    resource: {
      resourceType: AiResourceType.DockerHost,
      id: DOCKER_ID,
      projectId: PROJECT_ID,
      name: "web-1",
      identifier: "web-1",
      isAiInvestigationEnabled: true,
      aiRemediationMode: mode,
      aiCommandAllowlist: [],
      isArchived: false,
    },
    agentRow: {
      id: ObjectID.generate(),
      connectionStatus: "connected",
      lastAliveAt: new Date(),
      posture: {
        resourceType: AiResourceType.DockerHost,
        resourceIdentifier: "web-1",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
      },
    } as never,
    gates: {
      isAiEnabled: true,
      isAutoRemediationEnabled: true,
      isAiCommandExecutionEnabled: false,
      hasLlmProvider: true,
    },
  });
}

function hostWithoutAgent(): ResourceAiAccessStatus {
  return ResourceAiAccessService.buildStatus({
    resource: {
      resourceType: AiResourceType.Host,
      id: HOST_ID,
      projectId: PROJECT_ID,
      name: "db-host",
      identifier: "db-host",
      isAiInvestigationEnabled: false,
      aiRemediationMode: ResourceAiRemediationMode.Disabled,
      aiCommandAllowlist: [],
      isArchived: false,
    },
    agentRow: null,
    gates: {
      isAiEnabled: true,
      isAutoRemediationEnabled: true,
      isAiCommandExecutionEnabled: false,
      hasLlmProvider: true,
    },
  });
}

describe("ResourceAccessContext.buildPersonaAddendum", () => {
  it("names the resources the model may inspect and the rules", () => {
    const addendum: string = ResourceAccessContext.buildPersonaAddendum([
      readyDocker(),
    ]);

    expect(addendum).toContain(
      'infrastructure resource(s) OneUptime AI can inspect directly through their AI agents: Docker host "web-1".',
    );
    expect(addendum).toContain("Use run_infrastructure_command for READ-ONLY");
    expect(addendum).toContain("no shell, no pipes or redirects, no sudo");
    expect(addendum).toContain("is not evidence");
    expect(addendum).toContain("did not pick up a command");
    expect(addendum).toContain("redacted");
    expect(addendum).not.toContain("CANNOT");
  });

  it("names the resources it cannot inspect, why, and what to install", () => {
    const addendum: string = ResourceAccessContext.buildPersonaAddendum([
      hostWithoutAgent(),
    ]);

    expect(addendum).toContain(
      'infrastructure resource(s) OneUptime AI CANNOT inspect directly: Host "db-host" (no Host AI agent is connected — the operator should install the Host AI agent (see the host\'s AI agent page (AI → AI agent)))',
    );
    expect(addendum).toContain("Do NOT invent command output.");
    expect(addendum).not.toContain("Use run_infrastructure_command");
  });

  it("covers both kinds in one addendum", () => {
    const addendum: string = ResourceAccessContext.buildPersonaAddendum([
      readyDocker(),
      hostWithoutAgent(),
    ]);

    expect(addendum).toContain("can inspect directly");
    expect(addendum).toContain("CANNOT inspect directly");
  });

  it("always asks for the Infrastructure access report section, last", () => {
    for (const statuses of [[readyDocker()], [hostWithoutAgent()]]) {
      const lines: Array<string> =
        ResourceAccessContext.buildPersonaAddendum(statuses).split("\n");

      expect(lines[lines.length - 1]).toContain(
        "Add a section **Infrastructure access** before Suggested next steps",
      );
    }

    expect(ResourceAccessContext.REPORT_SECTION_HEADING).toBe(
      "Infrastructure access",
    );
  });

  it("is deterministic", () => {
    expect(
      ResourceAccessContext.buildPersonaAddendum([
        readyDocker(),
        hostWithoutAgent(),
      ]),
    ).toBe(
      ResourceAccessContext.buildPersonaAddendum([
        readyDocker(),
        hostWithoutAgent(),
      ]),
    );
  });
});

describe("ResourceAccessContext.buildContextSection", () => {
  it("is empty without resources", () => {
    expect(ResourceAccessContext.buildContextSection([])).toBe("");
  });

  it("lists a ready resource with its id, agent, programs and remediation", () => {
    const section: string = ResourceAccessContext.buildContextSection([
      readyDocker(),
    ]);

    expect(section.startsWith("\n# Infrastructure access\n")).toBe(true);
    expect(section).toContain(
      `- Docker host "web-1" (resourceId: ${DOCKER_ID.toString()}): READ access via run_infrastructure_command through its Docker AI agent (programs: docker). Remediation: disabled — AI may only inspect.`,
    );
  });

  it.each<[ResourceAiRemediationMode, string]>([
    [
      ResourceAiRemediationMode.RequireApproval,
      "Remediation: a human approves any fix before it runs.",
    ],
    [
      ResourceAiRemediationMode.Automatic,
      "Remediation: Automatic (safe fixes run without a human",
    ],
    [
      ResourceAiRemediationMode.BypassApproval,
      "Remediation: Bypass approval (AI does not ask",
    ],
  ])(
    "words remediation mode %s",
    (mode: ResourceAiRemediationMode, expected: string) => {
      expect(
        ResourceAccessContext.buildContextSection([readyDocker(mode)]),
      ).toContain(expected);
    },
  );

  it("says a mode that is on but not ready is not ready", () => {
    const status: ResourceAiAccessStatus = {
      ...readyDocker(ResourceAiRemediationMode.Automatic),
      isRemediationReady: false,
    };

    expect(ResourceAccessContext.buildContextSection([status])).toContain(
      "Remediation: Automatic, but not ready.",
    );
  });

  it("lists a resource without access with its blocking reasons and the install step", () => {
    const section: string = ResourceAccessContext.buildContextSection([
      hostWithoutAgent(),
    ]);

    expect(section).toContain(
      `- Host "db-host" (resourceId: ${HOST_ID.toString()}): NO direct access — No Host AI agent is connected; AI investigation is turned off for this host.`,
    );
    expect(section).toContain("HOST_NAME=db-host");
    expect(section).toContain("ONEUPTIME_AI_AGENT_RESOURCE_TYPE=host");
    expect(section).toContain("Investigate with OneUptime telemetry only.");
  });

  it("says not configured when nothing blocking is recorded", () => {
    const status: ResourceAiAccessStatus = {
      ...readyDocker(),
      isInvestigationReady: false,
      gaps: [],
    };

    expect(ResourceAccessContext.buildContextSection([status])).toContain(
      "NO direct access — not configured.",
    );
  });
});

describe("ResourceAccessContext.describeMissingAccessForHumans", () => {
  it("says access works for a ready resource", () => {
    expect(
      ResourceAccessContext.describeMissingAccessForHumans(readyDocker()),
    ).toBe(
      'OneUptime AI can run read-only commands on Docker host "web-1" through the Docker AI agent.',
    );
  });

  it("gives the first blocking reason and its next step", () => {
    const text: string =
      ResourceAccessContext.describeMissingAccessForHumans(hostWithoutAgent());

    expect(text).toContain(
      'OneUptime AI could not run commands on Host "db-host": no Host AI agent is connected.',
    );
    expect(text).toContain("Install the Host AI agent");
  });

  it("names resources and agents", () => {
    expect(describeResource(readyDocker())).toBe('Docker host "web-1"');
    expect(describeResourceAgent(hostWithoutAgent())).toBe("the Host AI agent");
  });
});
