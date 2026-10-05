import { describe, expect, test } from "@jest/globals";
import { getResourceAiAgentStatusSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummary";
import {
  ResourceAiAttention,
  getResourceAiAgentMetaParts,
  getResourceAiAgentStatusPill,
  getResourceAiAttention,
  parseResourceAiAccessStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatus";
import {
  RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
  RESOURCE_REMEDIATION_MODE_SUMMARIES,
  getResourceInvestigationOnSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAccessSettingsUtil";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import {
  AI_FIXES_MODE_TONES,
  getAiInvestigationOffSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import { AiAgentStatusSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummary";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
  ResourceAiAgentSummary,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The Overview's "AI agent" card for every resource a resource AI agent
 * serves, from the status its AI agent page reads. Each answer is checked
 * against the AI agent page's own utils for the same status — the card
 * reuses them, so for every resource type, every agent state, the
 * investigation switch and every fixes mode, the card and the page say the
 * same thing.
 */

const RESOURCE_ID: string = "44444444-0000-4000-8000-000000000004";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function makePosture(
  type: AiResourceType,
  overrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAgentPosture {
  return {
    resourceType: type,
    resourceIdentifier: "prod-01",
    agentVersion: "14.1.0",
    allowWrites: false,
    writeTargets: [],
    protectedTargets: [],
    toolVersion: "8.2.4",
    reachable: true,
    details: {},
    ...overrides,
  };
}

function makeAgent(
  type: AiResourceType,
  overrides: Partial<ResourceAiAgentSummary> = {},
): ResourceAiAgentSummary {
  return {
    agentId: "99999999-0000-4000-8000-000000000009",
    connectionStatus: "connected",
    isOnline: true,
    agentVersion: "14.1.0",
    lastAliveAt: minutesAgo(0.5),
    lastRegisteredAt: minutesAgo(60),
    posture: makePosture(type),
    ...overrides,
  };
}

function gap(
  code: ResourceAiAccessGapCode,
  overrides: Partial<ResourceAiAccessGap> = {},
): ResourceAiAccessGap {
  return {
    code,
    title: `Title of ${code}`,
    nextStep: `Next step for ${code}`,
    blocksInvestigation: true,
    blocksRemediation: true,
    ...overrides,
  };
}

function makeStatus(
  type: AiResourceType,
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: type,
    resourceId: RESOURCE_ID,
    resourceName: "prod-01",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    agent: makeAgent(type),
    gaps: [
      gap("remediation_disabled", {
        blocksInvestigation: false,
        blocksRemediation: true,
      }),
    ],
    isInvestigationReady: true,
    isRemediationReady: false,
    ...overrides,
  };
}

describe.each(ALL_AI_RESOURCE_TYPES)(
  "the %s Overview's AI agent card",
  (type: AiResourceType) => {
    const descriptor: ResourceAiAgentDescriptor =
      getResourceAiAgentDescriptor(type);

    describe("a connected agent, investigation on, fixes off (the default install)", () => {
      const status: ResourceAiAccessStatus = makeStatus(type);
      const summary: AiAgentStatusSummary = getResourceAiAgentStatusSummary(
        status,
        descriptor,
      );

      test("says the agent is connected, in a green badge", () => {
        expect(summary.connection).toEqual({ text: "Connected", tone: "on" });
        expect(summary.connection.text).toBe(
          getResourceAiAgentStatusPill(status).text,
        );
      });

      test("names the agent in the Connection sentence", () => {
        expect(summary.connectionSentence).toBe(
          `The ${descriptor.agentName} is connected.`,
        );
      });

      test("shows the AI agent page's meta line under it, part by part", () => {
        expect(summary.connectionDetails).toEqual(
          getResourceAiAgentMetaParts(status, descriptor),
        );
        expect(summary.connectionDetails.length).toBeGreaterThan(0);
        expect(summary.connectionDetails[0]).toMatch(/^last seen /);
        expect(summary.connectionDetails).toContain("agent v14.1.0");
        expect(summary.connectionDetails).toContain("Read-only");
      });

      test("says investigation is on, with what AI may run on this resource", () => {
        expect(summary.investigation).toEqual({ text: "On", tone: "on" });
        expect(summary.investigationSentence).toBe(
          getResourceInvestigationOnSentence(descriptor),
        );
        expect(summary.investigationSentence).toContain(
          descriptor.readExamples,
        );
      });

      test("says fixes are off", () => {
        expect(summary.fixes).toEqual({ text: "Off", tone: "off" });
        expect(summary.fixesSentence).toBe(
          RESOURCE_REMEDIATION_MODE_SUMMARIES[
            ResourceAiRemediationMode.Disabled
          ],
        );
      });

      // Fixes being off is a choice, not something that needs attention.
      test("needs no attention", () => {
        expect(summary.attention).toBeNull();
      });
    });

    test.each(Object.values(ResourceAiRemediationMode))(
      "shows the %s fixes mode by the AI agent page's short name, tone and summary",
      (mode: ResourceAiRemediationMode) => {
        const summary: AiAgentStatusSummary = getResourceAiAgentStatusSummary(
          makeStatus(type, { aiRemediationMode: mode, gaps: [] }),
          descriptor,
        );

        expect(summary.fixes).toEqual({
          text: RESOURCE_REMEDIATION_MODE_SHORT_NAMES[mode],
          tone: AI_FIXES_MODE_TONES[mode],
        });
        expect(summary.fixesSentence).toBe(
          RESOURCE_REMEDIATION_MODE_SUMMARIES[mode],
        );
      },
    );

    test("names the four modes Off, Ask for approval, Automatic and Bypass approval", () => {
      expect(
        [
          ResourceAiRemediationMode.Disabled,
          ResourceAiRemediationMode.RequireApproval,
          ResourceAiRemediationMode.Automatic,
          ResourceAiRemediationMode.BypassApproval,
        ].map((mode: ResourceAiRemediationMode): string => {
          return getResourceAiAgentStatusSummary(
            makeStatus(type, { aiRemediationMode: mode }),
            descriptor,
          ).fixes.text;
        }),
      ).toEqual(["Off", "Ask for approval", "Automatic", "Bypass approval"]);
    });

    test("reads a mode this build does not know as Off, as the server does", () => {
      const summary: AiAgentStatusSummary = getResourceAiAgentStatusSummary(
        parseResourceAiAccessStatus({
          ...makeStatus(type),
          aiRemediationMode: "SomethingNew",
        })!,
        descriptor,
      );

      expect(summary.fixes.text).toBe("Off");
    });

    test("says investigation is off when someone turned it off, and that AI still investigates", () => {
      const summary: AiAgentStatusSummary = getResourceAiAgentStatusSummary(
        makeStatus(type, {
          isAiInvestigationEnabled: false,
          isInvestigationReady: false,
          gaps: [
            gap("investigation_disabled", {
              blocksInvestigation: true,
              blocksRemediation: false,
            }),
          ],
        }),
        descriptor,
      );

      expect(summary.investigation).toEqual({ text: "Off", tone: "off" });
      expect(summary.investigationSentence).toBe(
        getAiInvestigationOffSentence(descriptor.noun),
      );
      expect(summary.investigationSentence).toContain(
        "It still investigates with the data OneUptime already has.",
      );
    });

    test("reads a status that does not say whether investigation is on as Off", () => {
      const raw: Record<string, unknown> = { ...makeStatus(type) };
      delete raw["isAiInvestigationEnabled"];

      expect(
        getResourceAiAgentStatusSummary(
          parseResourceAiAccessStatus(raw)!,
          descriptor,
        ).investigation.text,
      ).toBe("Off");
    });

    test("an agent that went offline: a red Offline badge and when it was last seen", () => {
      const status: ResourceAiAccessStatus = makeStatus(type, {
        agent: makeAgent(type, {
          connectionStatus: "disconnected",
          isOnline: false,
          lastAliveAt: minutesAgo(180),
        }),
        isInvestigationReady: false,
        gaps: [gap("ai_agent_offline")],
      });
      const summary: AiAgentStatusSummary = getResourceAiAgentStatusSummary(
        status,
        descriptor,
      );

      expect(summary.connection).toEqual({ text: "Offline", tone: "danger" });
      expect(summary.connection.text).toBe(
        getResourceAiAgentStatusPill(status).text,
      );
      expect(summary.connectionSentence).toBe(
        `The ${descriptor.agentName} is offline.`,
      );
      expect(summary.connectionDetails[0]).toBe("last seen 3 hours ago");
    });

    test("no agent yet: Not installed, nothing to show under it, and what needs attention", () => {
      const status: ResourceAiAccessStatus = makeStatus(type, {
        agent: null,
        isInvestigationReady: false,
        gaps: [
          gap("ai_agent_not_connected", {
            blocksInvestigation: true,
            blocksRemediation: true,
          }),
          gap("remediation_disabled", {
            blocksInvestigation: false,
            blocksRemediation: true,
          }),
        ],
      });
      const summary: AiAgentStatusSummary = getResourceAiAgentStatusSummary(
        status,
        descriptor,
      );

      expect(summary.connection).toEqual({
        text: "Not installed",
        tone: "off",
      });
      expect(summary.connectionSentence).toBe(
        `The ${descriptor.agentName} is not installed yet.`,
      );
      expect(summary.connectionDetails).toEqual([]);
      // Investigation is on by default: the switch says so even before an agent.
      expect(summary.investigation.text).toBe("On");
      expect(summary.attention).toBe(
        `OneUptime AI can't investigate this ${descriptor.noun}`,
      );
    });

    test("an agent that cannot reach its resource says so, still as Connected", () => {
      const summary: AiAgentStatusSummary = getResourceAiAgentStatusSummary(
        makeStatus(type, {
          agent: makeAgent(type, {
            posture: makePosture(type, {
              reachable: false,
              reachError: "connection refused",
            }),
          }),
        }),
        descriptor,
      );

      expect(summary.connection.text).toBe("Connected");
      expect(summary.connectionSentence).toBe(
        `The ${descriptor.agentName} is connected, but it could not reach this ${descriptor.noun} at its last check.`,
      );
    });

    test.each<[string, Array<ResourceAiAccessGap>]>([
      [
        "investigation",
        [
          gap("ai_disabled_for_project", {
            blocksInvestigation: true,
            blocksRemediation: true,
          }),
        ],
      ],
      [
        "fixes only",
        [
          gap("remediation_write_access_missing", {
            blocksInvestigation: false,
            blocksRemediation: true,
          }),
        ],
      ],
      [
        "an unknown gap",
        [
          gap("something_new" as ResourceAiAccessGapCode, {
            blocksInvestigation: false,
            blocksRemediation: false,
          }),
        ],
      ],
    ])(
      "a gap that blocks %s: the AI agent page's Needs attention headline",
      (_label: string, gaps: Array<ResourceAiAccessGap>) => {
        const status: ResourceAiAccessStatus = makeStatus(type, {
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          gaps,
        });
        const attention: ResourceAiAttention | null = getResourceAiAttention(
          status,
          descriptor,
        );

        expect(attention).not.toBeNull();
        expect(
          getResourceAiAgentStatusSummary(status, descriptor).attention,
        ).toBe(attention!.title);
      },
    );
  },
);

describe("every resource type's card", () => {
  test("says the same for the same status, apart from the resource's own words", () => {
    const shapes: Array<string> = ALL_AI_RESOURCE_TYPES.map(
      (type: AiResourceType): string => {
        const summary: AiAgentStatusSummary = getResourceAiAgentStatusSummary(
          makeStatus(type),
          getResourceAiAgentDescriptor(type),
        );

        return JSON.stringify([
          summary.connection,
          summary.investigation,
          summary.fixes,
          summary.attention,
        ]);
      },
    );

    expect(new Set(shapes).size).toBe(1);
  });

  test("names each resource's own agent", () => {
    const sentences: Set<string> = new Set(
      ALL_AI_RESOURCE_TYPES.map((type: AiResourceType): string => {
        return getResourceAiAgentStatusSummary(
          makeStatus(type),
          getResourceAiAgentDescriptor(type),
        ).connectionSentence;
      }),
    );

    expect(sentences.size).toBe(ALL_AI_RESOURCE_TYPES.length);
  });
});
