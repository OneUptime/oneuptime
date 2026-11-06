/*
 * What the server answers about a cloud's OneUptime AI agent, for the Overview's card and the
 * AI pages. Made up, in the shape ResourceAiAccessService.buildStatus writes.
 *
 *   ?aiAgent=   none (default): no agent has connected, which is how every cloud starts
 *               connected: an agent is reporting, can reach the cloud, and may not write
 *               writes: it may write too, and fixes wait for a person's approval
 *               broken-credential: it may write, and its credential for changes will not log in
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

const FIXES_OFF = gap(
  "remediation_disabled",
  "AI fixes are turned off for this OpenStack cloud",
  'Set "Fixes" to "Ask for approval", "Automatic" or "Bypass approval" on this page.',
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
      allowWrites: data.allowWrites === true,
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
      details: data.details || {},
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
      gaps: [FIXES_OFF],
      isInvestigationReady: true,
    };
  }

  if (data.aiAgent === "writes") {
    return {
      ...base,
      aiRemediationMode: "RequireApproval",
      agent: agent({
        ...data,
        reachable: true,
        allowWrites: true,
        details: { writeCredentialWorks: true },
      }),
      gaps: [],
      isInvestigationReady: true,
      isRemediationReady: true,
    };
  }

  if (data.aiAgent === "broken-credential") {
    return {
      ...base,
      aiRemediationMode: "RequireApproval",
      agent: agent({
        ...data,
        reachable: true,
        allowWrites: true,
        details: {
          writeCredentialWorks: false,
          writeCredentialProblem:
            "Keystone would not log in the credential for changes: it answered 401.",
        },
      }),
      gaps: [
        gap(
          "remediation_write_access_missing",
          "The OpenStack AI agent's credential for changes does not work",
          "Keystone would not log in the credential for changes: it answered 401.",
          false,
        ),
      ],
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
        FIXES_OFF,
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
      FIXES_OFF,
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
