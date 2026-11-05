/*
 * What the server answers about a cloud's OneUptime AI agent, for the Overview's card and the
 * AI pages. Made up, in the shape ResourceAiAccessService.buildStatus writes for a resource AI
 * only reads: whatever else is true, one gap says it has no fixes.
 *
 *   ?aiAgent=   none (default): no agent has connected, which is how every cloud starts
 *               connected: an agent is reporting, and can reach the cloud
 *               unreachable: an agent is reporting, and Keystone will not let it in
 *
 * AI > Insights and AI > Logs read as nothing done yet: ResourceAiLogs and
 * AiActivityInsightsPage have their own tests of what they draw.
 */

const AGENT_ID = "75000000-0000-4000-8000-000000000001";

function gap(code, title, nextStep, blocksInvestigation) {
  return {
    code,
    title,
    nextStep,
    blocksInvestigation,
    blocksRemediation: true,
  };
}

const ONLY_READS = gap(
  "remediation_disabled",
  "OneUptime AI only reads this OpenStack cloud",
  "It has no command that changes this OpenStack cloud, so fixes stay off. An investigation's report says what a person should change.",
  false,
);

function agent(data) {
  return {
    agentId: AGENT_ID,
    connectionStatus: "connected",
    isOnline: true,
    agentVersion: "14.1.0",
    lastAliveAt: data.now,
    lastRegisteredAt: data.now,
    posture: {
      resourceType: "OpenStackCloud",
      resourceIdentifier: data.cloudName,
      agentVersion: "14.1.0",
      allowWrites: false,
      writeTargets: [],
      protectedTargets: [],
      toolVersion: data.reachable ? "2.90" : null,
      reachable: data.reachable,
      ...(data.reachable
        ? {}
        : {
            reachError:
              "Keystone would not log in the credential in clouds.yaml, and would not give it a token.",
          }),
      details: {},
    },
  };
}

export function getAiAccessStatus(data) {
  const base = {
    resourceType: "OpenStackCloud",
    resourceId: data.cloudId,
    resourceName: data.cloudName,
    isAiInvestigationEnabled: true,
    aiRemediationMode: "Disabled",
    aiCommandAllowlist: [],
    isRemediationReady: false,
  };

  if (data.aiAgent === "connected") {
    return {
      ...base,
      agent: agent({ ...data, reachable: true }),
      gaps: [ONLY_READS],
      isInvestigationReady: true,
    };
  }

  if (data.aiAgent === "unreachable") {
    return {
      ...base,
      agent: agent({ ...data, reachable: false }),
      gaps: [
        gap(
          "ai_agent_unreachable_resource",
          "The AI agent cannot reach this OpenStack cloud",
          "Check its credential in clouds.yaml.",
          true,
        ),
        ONLY_READS,
      ],
      isInvestigationReady: false,
    };
  }

  return {
    ...base,
    agent: null,
    gaps: [
      gap(
        "ai_agent_not_connected",
        "No AI agent is connected",
        "Install the OpenStack AI agent.",
        true,
      ),
      ONLY_READS,
    ],
    isInvestigationReady: false,
  };
}

export function withAiAccessColumns(clouds) {
  return clouds.map((cloud) => {
    return {
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      ...cloud,
    };
  });
}

export function getAiLogs() {
  return { investigations: [], fixes: [] };
}

export function getAiInsights() {
  return { totals: {}, fixOutcomes: {} };
}
