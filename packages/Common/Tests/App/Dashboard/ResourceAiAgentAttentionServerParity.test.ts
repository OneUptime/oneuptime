import { describe, expect, test } from "@jest/globals";
import {
  ResourceAiAttention,
  ResourceAiAttentionStep,
  getResourceAiAttention,
  parseResourceAiAccessStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatus";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import ResourceAiAccessService, {
  ResourceAiAccessProjectGates,
  ResourceAiAccessRow,
  getResourceAiAgentPage,
} from "../../../Server/Services/ResourceAiAccessService";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The "Needs attention" item against the server that computes the gaps —
 * ResourceAiAccessService.buildStatus, run for real (it is pure). For the
 * statuses the server really sends:
 *
 * - the gaps become ONE item: a headline, then one step per gap in the
 *   server's order, with the fixes-off choice left out;
 * - the headline agrees with the server's own verdicts (isInvestigationReady,
 *   isRemediationReady);
 * - every gap the server can send has this page's own words, and none of
 *   them sends the reader to the page they are on — which the server's
 *   next steps do, because they are written for every surface.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const AGENT_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");

const READY_GATES: ResourceAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

const CLOSED_GATES: ResourceAiAccessProjectGates = {
  isAiEnabled: false,
  hasLlmProvider: false,
  aiBalanceBlocker: "The project is out of AI credits.",
};

function row(
  type: AiResourceType,
  overrides: Partial<ResourceAiAccessRow> = {},
): ResourceAiAccessRow {
  return {
    resourceType: type,
    id: RESOURCE_ID,
    projectId: PROJECT_ID,
    name: "orders-db",
    identifier: "orders-db",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    isArchived: false,
    ...overrides,
  };
}

function agentRow(
  type: AiResourceType,
  overrides: Record<string, unknown> = {},
  postureOverrides: Record<string, unknown> = {},
): ResourceAiAgent {
  return {
    id: AGENT_ID,
    _id: AGENT_ID.toString(),
    projectId: PROJECT_ID,
    resourceType: type,
    resourceId: RESOURCE_ID,
    resourceIdentifier: "orders-db",
    agentVersion: "1.2.3",
    connectionStatus: "connected",
    lastAliveAt: OneUptimeDate.getCurrentDate(),
    posture: {
      resourceType: type,
      resourceIdentifier: "orders-db",
      allowWrites: true,
      writeTargets: [],
      protectedTargets: [],
      reachable: true,
      ...postureOverrides,
    },
    ...overrides,
  } as unknown as ResourceAiAgent;
}

/*
 * The status as the page receives it: built by the server, sent as JSON,
 * read back with the page's own parser.
 */
function serverStatus(
  resource: ResourceAiAccessRow,
  agent: ResourceAiAgent | null,
  gates: ResourceAiAccessProjectGates = READY_GATES,
): ResourceAiAccessStatus {
  const built: ResourceAiAccessStatus = ResourceAiAccessService.buildStatus({
    resource,
    agentRow: agent,
    gates,
  });
  const parsed: ResourceAiAccessStatus | null = parseResourceAiAccessStatus(
    JSON.parse(JSON.stringify(built)),
  );

  if (!parsed) {
    throw new Error("The page could not read the server's status.");
  }

  return parsed;
}

function codesOf(
  attention: ResourceAiAttention | null,
): Array<ResourceAiAccessGapCode> {
  return (attention?.steps || []).map(
    (step: ResourceAiAttentionStep): ResourceAiAccessGapCode => {
      return step.gap.code;
    },
  );
}

function textsOf(attention: ResourceAiAttention | null): Array<string> {
  return (attention?.steps || []).map(
    (step: ResourceAiAttentionStep): string => {
      return step.text;
    },
  );
}

// Every status shape the server can send, for one resource type.
function everyServerStatus(
  type: AiResourceType,
): Array<{ name: string; status: ResourceAiAccessStatus }> {
  const hourAgo: Date = OneUptimeDate.addRemoveMinutes(
    OneUptimeDate.getCurrentDate(),
    -60,
  );
  const otherType: AiResourceType =
    type === AiResourceType.Host
      ? AiResourceType.DockerHost
      : AiResourceType.Host;
  const fixesOn: Partial<ResourceAiAccessRow> = {
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
  };

  return [
    { name: "ready", status: serverStatus(row(type, fixesOn), agentRow(type)) },
    { name: "fixes off", status: serverStatus(row(type), agentRow(type)) },
    { name: "not installed", status: serverStatus(row(type), null) },
    {
      name: "not installed, investigation off, fixes on",
      status: serverStatus(
        row(type, { ...fixesOn, isAiInvestigationEnabled: false }),
        null,
      ),
    },
    {
      name: "silent",
      status: serverStatus(row(type), agentRow(type, { lastAliveAt: hourAgo })),
    },
    {
      name: "signed off",
      status: serverStatus(
        row(type, fixesOn),
        agentRow(type, {
          connectionStatus: "disconnected",
          lastAliveAt: hourAgo,
        }),
      ),
    },
    {
      name: "cannot reach the resource",
      status: serverStatus(
        row(type),
        agentRow(type, {}, { reachable: false, reachError: "refused" }),
      ),
    },
    {
      name: "reported for another type",
      status: serverStatus(
        row(type),
        agentRow(type, {}, { resourceType: otherType }),
      ),
    },
    {
      name: "read-only while fixes are on",
      status: serverStatus(
        row(type, fixesOn),
        agentRow(type, {}, { allowWrites: false }),
      ),
    },
    {
      name: "investigation off",
      status: serverStatus(
        row(type, { isAiInvestigationEnabled: false }),
        agentRow(type),
      ),
    },
    {
      name: "investigation off, fixes on and working",
      status: serverStatus(
        row(type, { ...fixesOn, isAiInvestigationEnabled: false }),
        agentRow(type),
      ),
    },
    {
      name: "every project gate closed",
      status: serverStatus(row(type, fixesOn), agentRow(type), CLOSED_GATES),
    },
    {
      name: "everything wrong at once",
      status: serverStatus(
        row(type, { ...fixesOn, isAiInvestigationEnabled: false }),
        null,
        CLOSED_GATES,
      ),
    },
  ];
}

describe("Needs attention, from the server's own statuses", () => {
  test("the database server in the screenshot: one item, two steps, no self-reference", () => {
    const type: AiResourceType = AiResourceType.DatabaseServer;
    const descriptor: ResourceAiAgentDescriptor =
      getResourceAiAgentDescriptor(type);
    const status: ResourceAiAccessStatus = serverStatus(
      row(type, { isAiInvestigationEnabled: false }),
      null,
    );

    // What the server sends: three gaps, each written for any surface.
    expect(
      status.gaps.map((gap: ResourceAiAccessGap): string => {
        return gap.code;
      }),
    ).toEqual([
      "ai_agent_not_connected",
      "investigation_disabled",
      "remediation_disabled",
    ]);
    expect(status.gaps[0]!.nextStep).toContain(getResourceAiAgentPage(type));

    // What the page shows: one item.
    expect(getResourceAiAttention(status, descriptor)).toEqual({
      title: "OneUptime AI can't investigate this database server",
      steps: [
        {
          gap: status.gaps[0],
          text: "Install the Database AI agent with the instructions above.",
          action: null,
        },
        {
          gap: status.gaps[1],
          text: "Turn on AI investigation.",
          action: "turn_on_investigation",
        },
      ],
    });
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: nothing to show when AI is ready, or only fixes are off by choice",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      const ready: ResourceAiAccessStatus = serverStatus(
        row(type, {
          aiRemediationMode: ResourceAiRemediationMode.Automatic,
        }),
        agentRow(type),
      );
      const fixesOff: ResourceAiAccessStatus = serverStatus(
        row(type),
        agentRow(type),
      );

      expect(ready.gaps).toEqual([]);
      expect(getResourceAiAttention(ready, descriptor)).toBeNull();
      expect(fixesOff.isInvestigationReady).toBe(true);
      expect(getResourceAiAttention(fixesOff, descriptor)).toBeNull();
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: every status is one item whose steps follow the server's gaps",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);

      for (const { name, status } of everyServerStatus(type)) {
        const attention: ResourceAiAttention | null = getResourceAiAttention(
          status,
          descriptor,
        );
        const expectedCodes: Array<ResourceAiAccessGapCode> = status.gaps
          .map((gap: ResourceAiAccessGap): ResourceAiAccessGapCode => {
            return gap.code;
          })
          .filter((code: ResourceAiAccessGapCode): boolean => {
            return code !== "remediation_disabled";
          });

        expect({ name, codes: codesOf(attention) }).toEqual({
          name,
          codes: expectedCodes,
        });

        if (!attention) {
          continue;
        }

        // The headline says what the server's verdicts say.
        if (!status.isInvestigationReady) {
          expect({ name, title: attention.title }).toEqual({
            name,
            title: expect.stringMatching(
              new RegExp(
                `^OneUptime AI can't investigate this ${descriptor.noun}( or run fixes on it)?$`,
              ),
            ),
          });
        } else {
          expect({ name, title: attention.title }).toEqual({
            name,
            title: `OneUptime AI can't run fixes on this ${descriptor.noun}`,
          });
        }

        const fixesOn: boolean =
          status.aiRemediationMode !== ResourceAiRemediationMode.Disabled;
        expect({
          name,
          namesFixes: attention.title.includes("fixes"),
        }).toEqual({
          name,
          namesFixes: fixesOn
            ? !status.isRemediationReady
            : status.isInvestigationReady,
        });
      }
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: every gap the server sends has this page's own words",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      const page: string = getResourceAiAgentPage(type);
      const seen: Set<ResourceAiAccessGapCode> =
        new Set<ResourceAiAccessGapCode>();

      for (const { name, status } of everyServerStatus(type)) {
        for (const step of getResourceAiAttention(status, descriptor)?.steps ||
          []) {
          seen.add(step.gap.code);

          expect({ name, text: step.text }).not.toEqual({
            name,
            text: step.gap.nextStep,
          });
          expect(step.text).not.toContain(page);
          expect(step.text).not.toContain("AI → AI agent");
          expect(step.text).not.toContain(RESOURCE_ID.toString());
          expect(step.text).toMatch(/^[A-Z].*\.$/);
        }
      }

      /*
       * Every gap but the fixes-off choice was seen, so none fell through.
       * auto_remediation_disabled_for_project is retired - Enable AI covers
       * it - so the server never sends it.
       */
      expect(Array.from(seen).sort()).toEqual(
        [
          "ai_agent_not_connected",
          "ai_agent_offline",
          "ai_agent_unreachable_resource",
          "investigation_disabled",
          "remediation_write_access_missing",
          "ai_disabled_for_project",
          "llm_provider_missing",
          "ai_balance_insufficient",
        ].sort(),
      );
    },
  );

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: the agent's steps name this type's agent and noun",
    (type: AiResourceType) => {
      const descriptor: ResourceAiAgentDescriptor =
        getResourceAiAgentDescriptor(type);
      const agentName: string = AI_RESOURCE_TYPE_INFO[type].agentDisplayName;

      expect(
        textsOf(
          getResourceAiAttention(serverStatus(row(type), null), descriptor),
        ),
      ).toEqual([`Install the ${agentName} with the instructions above.`]);

      expect(
        textsOf(
          getResourceAiAttention(
            serverStatus(
              row(type),
              agentRow(type, {}, { reachable: false, reachError: "refused" }),
            ),
            descriptor,
          ),
        ),
      ).toEqual([
        `Let the ${agentName} reach this ${descriptor.noun} (its error and the logs command are above), then test the connection.`,
      ]);
    },
  );

  test("an agent that has not said it can reach the resource: wait, then test", () => {
    const type: AiResourceType = AiResourceType.DockerHost;
    const attention: ResourceAiAttention | null = getResourceAiAttention(
      serverStatus(
        row(type),
        agentRow(type, {}, { resourceType: AiResourceType.Host }),
      ),
      getResourceAiAgentDescriptor(type),
    );

    expect(attention?.title).toBe(
      "OneUptime AI can't investigate this Docker host",
    );
    expect(attention?.steps).toHaveLength(1);
    expect(attention?.steps[0]!.text).toBe(
      "Wait a minute for the Docker AI agent to report that it can reach this Docker host, then test the connection.",
    );
    expect(attention?.steps[0]!.action).toBe("test_connection");
  });

  test("an offline agent: bring it back", () => {
    const type: AiResourceType = AiResourceType.PodmanHost;
    const attention: ResourceAiAttention | null = getResourceAiAttention(
      serverStatus(
        row(type, {
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        }),
        agentRow(type, {
          lastAliveAt: OneUptimeDate.addRemoveMinutes(
            OneUptimeDate.getCurrentDate(),
            -60,
          ),
        }),
      ),
      getResourceAiAgentDescriptor(type),
    );

    expect(attention?.title).toBe(
      "OneUptime AI can't investigate this Podman host or run fixes on it",
    );
    expect(textsOf(attention)).toEqual([
      "Bring the Podman AI agent back online. Its logs say why it is offline (the command is above).",
    ]);
    expect(attention?.steps[0]!.action).toBeNull();
  });

  test("the project's gates: one step each, in the server's order, each with its settings page", () => {
    const type: AiResourceType = AiResourceType.Host;
    const attention: ResourceAiAttention | null = getResourceAiAttention(
      serverStatus(
        row(type, {
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        }),
        agentRow(type),
        CLOSED_GATES,
      ),
      getResourceAiAgentDescriptor(type),
    );

    expect(attention?.title).toBe(
      "OneUptime AI can't investigate this host or run fixes on it",
    );
    expect(
      (attention?.steps || []).map(
        (step: ResourceAiAttentionStep): [string, string, string | null] => {
          return [step.gap.code, step.text, step.action];
        },
      ),
    ).toEqual([
      [
        "ai_disabled_for_project",
        "Turn on AI for this project.",
        "open_ai_features",
      ],
      [
        "llm_provider_missing",
        "Add an AI provider for this project, or use OneUptime AI credits.",
        "open_llm_providers",
      ],
      [
        "ai_balance_insufficient",
        "Add AI credits to this project, or turn on auto-recharge.",
        "open_ai_credits",
      ],
    ]);
  });

  test("a read-only agent while fixes are on: investigation works, fixes do not", () => {
    const type: AiResourceType = AiResourceType.CephCluster;
    const status: ResourceAiAccessStatus = serverStatus(
      row(type, { aiRemediationMode: ResourceAiRemediationMode.Automatic }),
      agentRow(type, {}, { allowWrites: false }),
    );
    const attention: ResourceAiAttention | null = getResourceAiAttention(
      status,
      getResourceAiAgentDescriptor(type),
    );

    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
    expect(attention?.title).toBe(
      "OneUptime AI can't run fixes on this Ceph cluster",
    );
    expect(textsOf(attention)).toEqual([
      "Give the Ceph AI agent write access with the steps below.",
    ]);
  });
});
