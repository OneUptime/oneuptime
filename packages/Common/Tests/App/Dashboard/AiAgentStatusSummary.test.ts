import { describe, expect, test } from "@jest/globals";
import {
  AI_AGENT_CONNECTION_BADGES,
  AI_AGENT_CONNECTION_ROW_TITLE,
  AI_AGENT_STATUS_SUMMARY_ATTENTION_LABEL,
  AI_AGENT_STATUS_SUMMARY_OPEN_TEXT,
  AI_AGENT_STATUS_SUMMARY_TITLE,
  AI_AGENT_STATUS_UNAVAILABLE_TEXT,
  AiAgentConnectionState,
  getAiAgentConnectionBadge,
  getAiAgentConnectionSentence,
  getAiAgentUnreachableSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummary";
import {
  AiAccessBadge,
  getAiInvestigationOffSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import { getResourceAiAgentStatusPill } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatus";
import { RESOURCE_AI_AGENT_DESCRIPTORS } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import { AiAgentOverviewState } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatus";
import { KUBERNETES_AI_AGENT_DISPLAY_NAME } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import fs from "fs";
import path from "path";

/*
 * The words the Overview's "AI agent" card shares between a cluster and
 * every other resource: its title, row title, link and unavailable text,
 * the Connection badge for each state the agent can be in, and the
 * Connection row's sentences. The card's three badges read like the AI
 * agent page's own (Connected / Offline / Not installed, as its pill says
 * them), so the two never disagree.
 */

const STATES: Array<AiAgentConnectionState> = [
  "connected",
  "offline",
  "not_installed",
];

const EN_LOCALE: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

describe("the card's fixed words", () => {
  test("are the AI agent page's: its title, Connection, Needs attention and the link to it", () => {
    expect(AI_AGENT_STATUS_SUMMARY_TITLE).toBe("AI agent");
    expect(AI_AGENT_CONNECTION_ROW_TITLE).toBe("Connection");
    expect(AI_AGENT_STATUS_SUMMARY_ATTENTION_LABEL).toBe("Needs attention");
    expect(AI_AGENT_STATUS_SUMMARY_OPEN_TEXT).toBe("Open the AI agent page");
  });

  test("say the status could not be loaded without blaming anyone, and where to look", () => {
    expect(AI_AGENT_STATUS_UNAVAILABLE_TEXT).toBe(
      "The AI agent's status could not be loaded. Open the AI agent page to see it.",
    );
    expect(AI_AGENT_STATUS_UNAVAILABLE_TEXT.toLowerCase()).not.toMatch(
      /error|failed|permission|denied/,
    );
  });

  // Every one of them is looked up in the reader's language.
  test.each([
    AI_AGENT_STATUS_SUMMARY_TITLE,
    AI_AGENT_CONNECTION_ROW_TITLE,
    AI_AGENT_STATUS_SUMMARY_ATTENTION_LABEL,
    AI_AGENT_STATUS_SUMMARY_OPEN_TEXT,
    AI_AGENT_STATUS_UNAVAILABLE_TEXT,
    "Connected",
    "Offline",
    "Not installed",
    "The {{agent}} is connected.",
    "The {{agent}} is offline.",
    "The {{agent}} is not installed yet.",
    "The {{agent}} is connected, but it could not reach this {{noun}} at its last check.",
  ])("%p is a key of en.json", (key: string) => {
    expect(EN_LOCALE[key]).toBe(key);
  });
});

describe("the Connection badge", () => {
  test("names each state the way the AI agent page's pill does", () => {
    expect(
      STATES.map((state: AiAgentConnectionState): string => {
        return getAiAgentConnectionBadge(state).text;
      }),
    ).toEqual(["Connected", "Offline", "Not installed"]);
  });

  test("is green when connected, red when offline and grey when there is no agent", () => {
    expect(getAiAgentConnectionBadge("connected").tone).toBe("on");
    expect(getAiAgentConnectionBadge("offline").tone).toBe("danger");
    expect(getAiAgentConnectionBadge("not_installed").tone).toBe("off");
  });

  test("has one badge per state, and only those", () => {
    expect(Object.keys(AI_AGENT_CONNECTION_BADGES).sort()).toEqual(
      [...STATES].sort(),
    );
  });

  /*
   * The resource AI agent page's pill and the cluster Overview's summary
   * row say the same three words for the same states.
   */
  test("agrees with the resource AI agent page's pill, word for word", () => {
    const status: (
      agent: ResourceAiAccessStatus["agent"],
    ) => ResourceAiAccessStatus = (
      agent: ResourceAiAccessStatus["agent"],
    ): ResourceAiAccessStatus => {
      return {
        resourceType: AiResourceType.DockerHost,
        resourceId: "44444444-0000-4000-8000-000000000004",
        resourceName: "web",
        isAiInvestigationEnabled: true,
        aiRemediationMode: ResourceAiRemediationMode.Disabled,
        aiCommandAllowlist: [],
        agent,
        gaps: [],
        isInvestigationReady: true,
        isRemediationReady: false,
      };
    };

    expect(
      getResourceAiAgentStatusPill(
        status({
          agentId: "a",
          connectionStatus: "connected",
          isOnline: true,
        }),
      ).text,
    ).toBe(getAiAgentConnectionBadge("connected").text);
    expect(
      getResourceAiAgentStatusPill(
        status({
          agentId: "a",
          connectionStatus: "disconnected",
          isOnline: false,
        }),
      ).text,
    ).toBe(getAiAgentConnectionBadge("offline").text);
    expect(getResourceAiAgentStatusPill(status(null)).text).toBe(
      getAiAgentConnectionBadge("not_installed").text,
    );
  });

  // The cluster's summary row says the same three words (pinned per state in KubernetesAiAgentStatusSummary.test.ts).
  test("uses the words of the cluster Overview's summary row", () => {
    // Typed by the row's own state, so a word it stops using fails to compile.
    const rowWords: Array<AiAgentOverviewState["text"]> = [
      "Connected",
      "Offline",
      "Not installed",
    ];

    expect(
      STATES.map((state: AiAgentConnectionState): string => {
        return getAiAgentConnectionBadge(state).text;
      }),
    ).toEqual(rowWords);
  });

  test("hands out the shared badge, which no caller changes: the card translates a copy", () => {
    const badge: AiAccessBadge = getAiAgentConnectionBadge("connected");

    expect(badge).toBe(AI_AGENT_CONNECTION_BADGES.connected);
    expect(badge).toEqual({ text: "Connected", tone: "on" });
  });
});

describe("the Connection row's sentence", () => {
  test.each(ALL_AI_RESOURCE_TYPES)(
    "names the %s agent in each of its states",
    (type: AiResourceType) => {
      const agentName: string = RESOURCE_AI_AGENT_DESCRIPTORS[type].agentName;

      expect(
        getAiAgentConnectionSentence({ state: "connected", agentName }),
      ).toBe(`The ${agentName} is connected.`);
      expect(
        getAiAgentConnectionSentence({ state: "offline", agentName }),
      ).toBe(`The ${agentName} is offline.`);
      expect(
        getAiAgentConnectionSentence({ state: "not_installed", agentName }),
      ).toBe(`The ${agentName} is not installed yet.`);
    },
  );

  test("names the Kubernetes AI agent the way the rest of the product does", () => {
    expect(
      getAiAgentConnectionSentence({
        state: "connected",
        agentName: KUBERNETES_AI_AGENT_DISPLAY_NAME,
      }),
    ).toBe(`The ${KUBERNETES_AI_AGENT_DISPLAY_NAME} is connected.`);
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "says a connected %s agent that could not reach its resource could not, naming the resource mid-sentence",
    (type: AiResourceType) => {
      const descriptor: (typeof RESOURCE_AI_AGENT_DESCRIPTORS)[AiResourceType] =
        RESOURCE_AI_AGENT_DESCRIPTORS[type];
      const sentence: string = getAiAgentUnreachableSentence({
        agentName: descriptor.agentName,
        noun: descriptor.noun,
      });

      expect(sentence).toMatch(
        new RegExp(
          `^The ${descriptor.agentName} is connected, but it could not reach this `,
        ),
      );
      expect(sentence).toMatch(/ at its last check\.$/);
      // "this database server", "this Docker host": cased for mid-sentence.
      expect(sentence).toContain(`this ${descriptor.noun}`);
    },
  );
});

describe("the investigation-off sentence the AI agent pages share", () => {
  test("still says AI investigates with what OneUptime already has", () => {
    expect(getAiInvestigationOffSentence("cluster")).toBe(
      "AI does not run commands on this cluster. It still investigates with the data OneUptime already has.",
    );
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "reads the same for the %s's noun as before it was translatable",
    (type: AiResourceType) => {
      const noun: string = RESOURCE_AI_AGENT_DESCRIPTORS[type].noun;

      expect(getAiInvestigationOffSentence(noun)).toBe(
        `AI does not run commands on this ${noun}. It still investigates with the data OneUptime already has.`,
      );
    },
  );

  test("is a key of en.json, so every language can word it", () => {
    const key: string =
      "AI does not run commands on this {{noun}}. It still investigates with the data OneUptime already has.";
    expect(EN_LOCALE[key]).toBe(key);
  });
});
