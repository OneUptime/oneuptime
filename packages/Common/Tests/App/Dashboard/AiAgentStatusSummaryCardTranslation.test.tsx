import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import ResourceAiAgentStatusSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import KubernetesAiAgentStatusSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentStatusSummaryCard";
import { AI_AGENT_STATUS_SUMMARY_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummaryCard";
import { getResourceAiAgentDescriptor } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAiRemediationMode,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The Overview's "AI agent" card in the reader's language, from the
 * shipped locale files: its title, row titles, badges, the Connection
 * sentence with the agent's name in it, the unavailable sentence and the
 * link. Japanese, which translates all of them.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so
 * does this file. Each jest file has its own module registry, so it
 * reaches no other suite.
 */

const WAIT_TIMEOUT: number = 20000;
const RESOURCE_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const JA: Record<string, string> = readLocale("ja");
const FR: Record<string, string> = readLocale("fr");

let postSpy: ReturnType<typeof jest.spyOn>;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "ja",
    fallbackLng: "ja",
    resources: { ja: { translation: JA }, fr: { translation: FR } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/docker/${RESOURCE_ID.toString()}`);
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

async function findCard(): Promise<HTMLElement> {
  return await screen.findByTestId(
    `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection`,
    {},
    { timeout: WAIT_TIMEOUT },
  );
}

describe("the Overview's AI agent card in Japanese", () => {
  test("every word on a Docker host's card is the reader's", async () => {
    postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          resourceType: AiResourceType.DockerHost,
          resourceId: RESOURCE_ID.toString(),
          resourceName: "web",
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
          aiCommandAllowlist: [],
          agent: {
            agentId: "a",
            connectionStatus: "connected",
            isOnline: true,
          },
          gaps: [],
          isInvestigationReady: true,
          isRemediationReady: true,
        },
        {},
      );
    });

    render(
      <ResourceAiAgentStatusSummaryCard
        descriptor={getResourceAiAgentDescriptor(AiResourceType.DockerHost)}
        resourceId={RESOURCE_ID}
      />,
    );
    await findCard();

    const card: HTMLElement = screen.getByTestId(
      AI_AGENT_STATUS_SUMMARY_TEST_ID,
    );

    expect(
      within(card).getByRole("heading", { name: JA["AI agent"]! }),
    ).toBeInTheDocument();
    expect(
      within(card)
        .getAllByRole("heading", { level: 3 })
        .map((heading: HTMLElement): string => {
          return heading.textContent || "";
        }),
    ).toEqual([JA["Connection"], JA["Investigation"], JA["Fixes"]]);
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-badge`),
    ).toHaveTextContent(JA["Connected"]!);
    expect(
      screen.getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-investigation-badge`,
      ),
    ).toHaveTextContent(JA["On"]!);
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-fixes-badge`),
    ).toHaveTextContent(JA["Ask for approval"]!);
    // The sentence is translated whole, with the agent's own name in it.
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`),
    ).toHaveTextContent(
      JA["The {{agent}} is connected."]!.replace(
        "{{agent}}",
        JA["Docker AI agent"]!,
      ),
    );
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-fixes-value`),
    ).toHaveTextContent(
      JA["AI proposes fixes. A person approves each one before it runs."]!,
    );
    expect(
      within(card).getByRole("link", { name: JA["Open the AI agent page"]! }),
    ).toBeInTheDocument();
  });

  test("a cluster's card is in the reader's language too", async () => {
    postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          clusterId: RESOURCE_ID.toString(),
          clusterName: "prod",
          runner: null,
          accessMethod: "none",
          aiAgent: null,
          automaticInvestigation: { incidents: false, alerts: false },
          kubectlAllowlist: [],
          isInvestigationEnabled: false,
          isInvestigationReady: false,
          remediationMode: KubernetesAiRemediationMode.Disabled,
          isRemediationReady: false,
          gaps: [],
          evaluatedAt: new Date().toISOString(),
        },
        {},
      );
    });

    render(<KubernetesAiAgentStatusSummaryCard clusterId={RESOURCE_ID} />);
    await findCard();

    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-badge`),
    ).toHaveTextContent(JA["Not installed"]!);
    expect(
      screen.getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-investigation-badge`,
      ),
    ).toHaveTextContent(JA["Off"]!);
    expect(
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`),
    ).toHaveTextContent(
      JA["The {{agent}} is not installed yet."]!.replace(
        "{{agent}}",
        JA[KUBERNETES_AI_AGENT_DISPLAY_NAME] ||
          KUBERNETES_AI_AGENT_DISPLAY_NAME,
      ),
    );
    // The off sentence the AI agent pages share, now a translated template.
    expect(
      screen.getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-investigation-value`,
      ),
    ).toHaveTextContent(
      JA[
        "AI does not run commands on this {{noun}}. It still investigates with the data OneUptime already has."
      ]!.replace("{{noun}}", JA["cluster"]!),
    );
  });

  test("the unavailable sentence is the reader's", async () => {
    postSpy.mockImplementation(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(403, { error: "No." }, {});
    });

    render(
      <ResourceAiAgentStatusSummaryCard
        descriptor={getResourceAiAgentDescriptor(AiResourceType.CephCluster)}
        resourceId={RESOURCE_ID}
      />,
    );

    expect(
      await screen.findByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent(
      JA[
        "The AI agent's status could not be loaded. Open the AI agent page to see it."
      ]!,
    );
  });

  /*
   * The card's own labels — its title, row titles, badges, link and the
   * sentences it adds — in every language the dashboard ships, not only
   * Japanese. A few languages write the English word itself: German,
   * Danish, Italian, Dutch, Portuguese and Swedish say "offline", French
   * says "Investigation", Dutch says "Fixes".
   */
  test("every language the dashboard ships has its own words for the card's labels", () => {
    const SAME_AS_ENGLISH: Record<string, Array<string>> = {
      da: ["Offline"],
      de: ["Offline"],
      fr: ["Investigation"],
      it: ["Offline"],
      nl: ["Offline"],
      pt: ["Offline"],
      sv: ["Offline"],
    };
    const labels: Array<string> = [
      "AI agent",
      "Connection",
      "Investigation",
      "Fixes",
      "Connected",
      "Offline",
      "Not installed",
      "On",
      "Off",
      "Needs attention",
      "Open the AI agent page",
      "Ask for approval",
      "Automatic",
      "Bypass approval",
      "The {{agent}} is connected.",
      "The {{agent}} is offline.",
      "The {{agent}} is not installed yet.",
      "The AI agent's status could not be loaded. Open the AI agent page to see it.",
    ];
    const locales: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json") && file !== "en.json";
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      })
      .sort();

    expect(locales.length).toBeGreaterThanOrEqual(16);

    for (const locale of locales) {
      const translations: Record<string, string> = readLocale(locale);
      const english: Array<string> = labels.filter((label: string) => {
        return !translations[label] || translations[label] === label;
      });

      expect({ locale, english }).toEqual({
        locale,
        english: SAME_AS_ENGLISH[locale] || [],
      });
    }
  });

  test("every string the card shows has its own Japanese wording", () => {
    for (const key of [
      "AI agent",
      "Connection",
      "Investigation",
      "Fixes",
      "Connected",
      "Offline",
      "Not installed",
      "On",
      "Off",
      "Needs attention",
      "Open the AI agent page",
      "The {{agent}} is connected.",
      "The {{agent}} is offline.",
      "The {{agent}} is not installed yet.",
      "The {{agent}} is connected, but it could not reach this {{noun}} at its last check.",
      "The AI agent's status could not be loaded. Open the AI agent page to see it.",
    ]) {
      expect({ key, translated: JA[key] !== key && Boolean(JA[key]) }).toEqual({
        key,
        translated: true,
      });
    }
  });
});

/*
 * The Connection sentence holds the agent's name as written on its own.
 * French wrote the Kubernetes agent's as "Agent IA Kubernetes" and kept
 * the resource agents' English, so its sentence used to read "Le Agent IA
 * Kubernetes est connecté.": an article that suited "Docker AI agent" only.
 * French words the sentence without an article, for every name: the
 * resource agents' French names ("Agent IA Docker") start it too.
 */
describe("the Overview's AI agent card in French", () => {
  beforeEach(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("fr");
    });
  });

  afterEach(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ja");
    });
  });

  test("the cluster's agent: its French name, with the sentence agreeing", async () => {
    const lastAliveAt: string = new Date().toISOString();
    const posture: JSONObject = {
      clusterIdentifier: "prod",
      inCluster: true,
      allowWrites: false,
      writeNamespaces: [],
    };

    postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          clusterId: RESOURCE_ID.toString(),
          clusterName: "prod",
          runner: {
            id: "99999999-0000-4000-8000-000000000009",
            name: KUBERNETES_AI_AGENT_DISPLAY_NAME,
            kind: "ai_agent",
            isOnline: true,
            lastAliveAt,
            canRunAiCommands: true,
            posture,
          },
          accessMethod: "in_cluster",
          aiAgent: {
            id: "99999999-0000-4000-8000-000000000009",
            isOnline: true,
            connectionStatus: "connected",
            lastAliveAt,
            posture,
          },
          automaticInvestigation: { incidents: false, alerts: false },
          kubectlAllowlist: [],
          isInvestigationEnabled: true,
          isInvestigationReady: true,
          remediationMode: KubernetesAiRemediationMode.Disabled,
          isRemediationReady: false,
          gaps: [],
          evaluatedAt: lastAliveAt,
        },
        {},
      );
    });

    render(<KubernetesAiAgentStatusSummaryCard clusterId={RESOURCE_ID} />);
    await findCard();

    const sentence: string =
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`)
        .textContent || "";

    expect(FR[KUBERNETES_AI_AGENT_DISPLAY_NAME]).toBe("Agent IA Kubernetes");
    expect(sentence).toBe(
      FR["The {{agent}} is connected."]!.replace(
        "{{agent}}",
        FR[KUBERNETES_AI_AGENT_DISPLAY_NAME]!,
      ),
    );
    expect(sentence.startsWith("Agent IA Kubernetes ")).toBe(true);
    expect(sentence).not.toMatch(/\bLe Agent\b/);
  });

  /*
   * The resource agents' French names start with "Agent" too ("Agent IA
   * Docker"), and the sentence starts with the name, so no "Le" clashes.
   */
  test("a resource's agent: its French name, with the same sentence agreeing", async () => {
    postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          resourceType: AiResourceType.DockerHost,
          resourceId: RESOURCE_ID.toString(),
          resourceName: "web",
          isAiInvestigationEnabled: true,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
          aiCommandAllowlist: [],
          agent: null,
          gaps: [],
          isInvestigationReady: false,
          isRemediationReady: false,
        },
        {},
      );
    });

    render(
      <ResourceAiAgentStatusSummaryCard
        descriptor={getResourceAiAgentDescriptor(AiResourceType.DockerHost)}
        resourceId={RESOURCE_ID}
      />,
    );
    await findCard();

    const sentence: string =
      screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`)
        .textContent || "";

    expect(FR["Docker AI agent"]).toBe("Agent IA Docker");
    expect(sentence).toBe(
      FR["The {{agent}} is not installed yet."]!.replace(
        "{{agent}}",
        FR["Docker AI agent"]!,
      ),
    );
    expect(sentence.startsWith("Agent IA Docker ")).toBe(true);
    expect(sentence).not.toMatch(/\bLe Agent\b/);
  });

  // Every Connection sentence starts with the name, so no article can clash.
  test.each([
    "The {{agent}} is connected.",
    "The {{agent}} is offline.",
    "The {{agent}} is not installed yet.",
    "The {{agent}} is connected, but it could not reach this {{noun}} at its last check.",
  ])("%s starts with the agent's name in French", (key: string) => {
    expect(FR[key]!.startsWith("{{agent}} ")).toBe(true);
  });
});
