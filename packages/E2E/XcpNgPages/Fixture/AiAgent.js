/*
 * What the server answers about a pool's XCP-ng AI agent, for the Overview's
 * card and the AI pages. Made up, in the shape
 * ResourceAiAccessService.buildStatus writes, with the posture details the
 * agent's XcpNgExecutor reports.
 *
 *   ?aiAgent=   none (default): no agent has connected, which is how every
 *               pool starts
 *               connected: an agent is reporting, reads the pool with a
 *               read-only token, and may not write
 *               writes: it may write too, with a token for changes that
 *               works, and fixes wait for a person's approval
 *               broken-token: it may write, and Xen Orchestra refuses its
 *               token for changes
 *               unreachable: an agent is reporting, and Xen Orchestra
 *               presents the certificate it made for itself
 *
 * AI > Insights and AI > Logs read as nothing done yet: ResourceAiLogs and
 * AiActivityInsightsPage have their own tests of what they draw.
 */

const AGENT_ID = "75000000-0000-4000-8000-000000000002";

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
  "AI fixes are turned off for this XCP-ng pool",
  'Set "Fixes" to "Ask for approval", "Automatic" or "Bypass approval" on this page.',
  false,
);

const READ_DETAILS = {
  xenOrchestra: "https://xo.acme.example",
  tlsTrust: "/etc/oneuptime/xo-ca.pem",
  tlsVerified: true,
  poolsVisible: 1,
  readTokenUser: "oneuptime-ai-read",
  readTokenReadOnly: true,
  poolName: "Production",
  haEnabled: true,
  poolMaster: "xcp-prod-01",
};

function agent(data) {
  return {
    agentId: AGENT_ID,
    connectionStatus: "connected",
    isOnline: true,
    agentVersion: "14.1.0",
    lastAliveAt: data.now,
    lastRegisteredAt: data.now,
    posture: {
      resourceType: "XcpNgPool",
      resourceIdentifier: data.poolIdentifier,
      agentVersion: "14.1.0",
      allowWrites: data.allowWrites === true,
      allowWritesSetting: data.allowWrites === true ? "true" : "false",
      writeTargets: [],
      protectedTargets: [],
      toolVersion: data.reachable ? "XCP-ng 8.3.0" : null,
      reachable: data.reachable,
      ...(data.reachable
        ? {}
        : {
            reachError:
              "The TLS handshake with Xen Orchestra at https://xo.acme.example failed: the certificate names no address (it has no subjectAltName). That is the certificate Xen Orchestra makes for itself when it has none, and no TLS client can check it, pinned or not.",
          }),
      details: {
        ...READ_DETAILS,
        poolId: data.poolIdentifier,
        writeTokenConfigured: data.allowWrites === true,
        ...(data.details || {}),
      },
    },
  };
}

export function getAiAccessStatus(data) {
  const base = {
    resourceType: "XcpNgPool",
    resourceId: data.poolId,
    resourceName: data.poolName,
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
        details: {
          writeTokenUser: "oneuptime-ai-fixes",
          writeTokenRole:
            "may vm:start, vm:shutdown, vm:reboot, vm:pause, vm:suspend, vm:resume and 9 more",
          writeCredentialWorks: true,
        },
      }),
      gaps: [],
      isInvestigationReady: true,
      isRemediationReady: true,
    };
  }

  if (data.aiAgent === "broken-token") {
    const problem =
      "Xen Orchestra at https://xo.acme.example did not accept ONEUPTIME_AI_XO_WRITE_TOKEN, which is wrong or has expired (Xen Orchestra forgets a token once it expires). Create a new token for the same user and set ONEUPTIME_AI_XO_WRITE_TOKEN to it.";

    return {
      ...base,
      aiRemediationMode: "RequireApproval",
      agent: agent({
        ...data,
        reachable: true,
        allowWrites: true,
        details: {
          writeTokenRole: problem.slice(0, 200),
          writeCredentialWorks: false,
          writeCredentialProblem: problem,
        },
      }),
      gaps: [
        gap(
          "remediation_write_access_missing",
          "The XCP-ng AI agent's token for changes does not work",
          problem,
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
          "The XCP-ng AI agent cannot reach this XCP-ng pool",
          "Its last check failed: the certificate names no address. Check Xen Orchestra's address (XO_ADDRESS), the xo-ca.pem the agent trusts for it, and the agent's read-only Xen Orchestra token (ONEUPTIME_AI_XO_READ_TOKEN), then use \"Test connection\" on the XCP-ng pool's AI agent page (AI → AI agent).",
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
        "Install the XCP-ng AI agent next to this XCP-ng pool's telemetry collector.",
        true,
      ),
      FIXES_OFF,
    ],
    isInvestigationReady: false,
  };
}

export function getAiLogs() {
  return { investigations: [], fixes: [] };
}

export function getAiInsights() {
  return { totals: {}, fixOutcomes: {} };
}
