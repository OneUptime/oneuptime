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

let postSpy: ReturnType<typeof jest.spyOn>;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "ja",
    fallbackLng: "ja",
    resources: { ja: { translation: JA } },
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
      within(card).getByRole("heading", { name: JA["AI agent"] }),
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
      within(card).getByRole("link", { name: JA["Open the AI agent page"] }),
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
