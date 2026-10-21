import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import ResourceAiAgentStatusSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import { AI_AGENT_STATUS_SUMMARY_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummaryCard";
import {
  ResourceAiAgentDescriptor,
  getResourceAiAgentDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { RESOURCE_AI_ACCESS_STATUS_PATH } from "../../../Types/AI/ResourceAiAccessApi";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The "AI agent" card at the bottom of the Overview of every resource a
 * resource AI agent serves, wired to the server: it reads the resource's
 * status from the route the AI agent page reads — POST
 * /resource-ai-access/status with { resourceType, resourceId }, which only
 * needs read access to the resource — once per resource and again on the
 * Overview's refresh, and draws what it says. A refused, failed or
 * unreadable answer never fails the Overview: the card says it could not
 * load the status and still links to the AI agent page; a failed refresh
 * keeps the last status it read.
 */

const WAIT_TIMEOUT: number = 20000;
const RESOURCE_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);
const OTHER_RESOURCE_ID: ObjectID = new ObjectID(
  "55555555-0000-4000-8000-000000000005",
);

function makeStatus(
  type: AiResourceType,
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: type,
    resourceId: RESOURCE_ID.toString(),
    resourceName: "prod-01",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: "99999999-0000-4000-8000-000000000009",
      connectionStatus: "connected",
      isOnline: true,
      agentVersion: "14.1.0",
      lastAliveAt: new Date().toISOString(),
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;

function serve(answer: () => Promise<unknown>): void {
  postSpy.mockImplementation(answer);
}

function serveStatus(status: ResourceAiAccessStatus | JSONObject): void {
  serve(async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      status as unknown as JSONObject,
      {},
    );
  });
}

async function findBadge(
  row: "connection" | "investigation" | "fixes",
): Promise<string> {
  return (
    (
      await screen.findByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-${row}-badge`,
        {},
        { timeout: WAIT_TIMEOUT },
      )
    ).textContent || ""
  );
}

async function findUnavailable(): Promise<HTMLElement> {
  return await screen.findByTestId(
    `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`,
    {},
    { timeout: WAIT_TIMEOUT },
  );
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/docker/${RESOURCE_ID.toString()}`);
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID,
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(ALL_AI_RESOURCE_TYPES)(
  "the %s Overview's AI agent card",
  (type: AiResourceType) => {
    const descriptor: ResourceAiAgentDescriptor =
      getResourceAiAgentDescriptor(type);

    function renderCard(props: { refreshToken?: number } = {}): RenderResult {
      return render(
        <ResourceAiAgentStatusSummaryCard
          descriptor={descriptor}
          resourceId={RESOURCE_ID}
          refreshToken={props.refreshToken}
        />,
      );
    }

    test("reads this resource's status, once, from the AI agent page's own route", async () => {
      serveStatus(makeStatus(type));
      renderCard();
      await findBadge("connection");

      expect(postSpy).toHaveBeenCalledTimes(1);
      const request: JSONObject = postSpy.mock.calls[0]![0] as JSONObject;
      expect(String(request["url"])).toMatch(
        new RegExp(`${RESOURCE_AI_ACCESS_STATUS_PATH}$`),
      );
      expect(request["data"]).toEqual({
        resourceType: type,
        resourceId: RESOURCE_ID.toString(),
      });
      // The project the caller is in, as every dashboard API call sends it.
      expect(request["headers"]).toEqual({ tenantid: PROJECT_ID });
    });

    test("shows the agent's connection, the investigation switch and the fixes mode", async () => {
      serveStatus(makeStatus(type));
      renderCard();

      expect(await findBadge("connection")).toBe("Connected");
      expect(await findBadge("investigation")).toBe("On");
      expect(await findBadge("fixes")).toBe("Ask for approval");
      expect(
        screen.getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`,
        ),
      ).toHaveTextContent(`The ${descriptor.agentName} is connected.`);
    });

    test("draws the agent's version with AgentVersion, after when it was last seen", async () => {
      serveStatus(makeStatus(type));
      renderCard();
      await findBadge("connection");

      const details: HTMLElement = screen.getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-details`,
      );
      expect(details.textContent).toMatch(/^last seen [^·]+ · agent 14\.1\.0/);
      expect(
        screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-agent-version`),
      ).toHaveTextContent("agent 14.1.0");
    });

    test("a version only the agent's posture reports is drawn too", async () => {
      serveStatus(
        makeStatus(type, {
          agent: {
            agentId: "99999999-0000-4000-8000-000000000009",
            connectionStatus: "connected",
            isOnline: true,
            lastAliveAt: new Date().toISOString(),
            posture: {
              resourceType: type,
              resourceIdentifier: "prod-01",
              agentVersion: "14.0.9",
              allowWrites: false,
              writeTargets: [],
              protectedTargets: [],
              reachable: true,
              details: {},
            },
          },
        }),
      );
      renderCard();
      await findBadge("connection");

      expect(
        screen.getByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-agent-version`),
      ).toHaveTextContent("agent 14.0.9");
    });

    test("is described as the AI agent page is, for this resource", async () => {
      serveStatus(makeStatus(type));
      renderCard();
      await findBadge("connection");

      expect(
        screen.getByText(
          `Whether OneUptime AI can reach this ${descriptor.noun}, and what it may do there.`,
        ),
      ).toBeInTheDocument();
    });

    test("links to this resource's AI agent page", async () => {
      serveStatus(makeStatus(type));
      renderCard();
      await findBadge("connection");

      const expected: string = RouteUtil.populateRouteParams(
        RouteMap[descriptor.agentPage] as Route,
        { modelId: RESOURCE_ID },
      ).toString();

      // Filled in: this project and this resource, no placeholder left.
      expect(expected).not.toMatch(/:(modelId|projectId)/);
      expect(expected).toContain(`/dashboard/${PROJECT_ID}/`);
      expect(expected).toMatch(
        new RegExp(`/${RESOURCE_ID.toString()}/ai/agent$`),
      );
      expect(
        screen.getByRole("link", { name: "Open the AI agent page" }),
      ).toHaveAttribute("href", expected);
    });

    test("an agent not installed yet: Not installed, investigation still on, and what needs attention", async () => {
      serveStatus(
        makeStatus(type, {
          agent: null,
          isInvestigationReady: false,
          aiRemediationMode: ResourceAiRemediationMode.Disabled,
          gaps: [
            {
              code: "ai_agent_not_connected",
              title: "No agent",
              nextStep: "Install it",
              blocksInvestigation: true,
              blocksRemediation: true,
            },
          ],
        }),
      );
      renderCard();

      expect(await findBadge("connection")).toBe("Not installed");
      expect(await findBadge("investigation")).toBe("On");
      expect(await findBadge("fixes")).toBe("Off");
      expect(
        screen.getByTestId(
          `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention-title`,
        ),
      ).toHaveTextContent(
        `OneUptime AI can't investigate this ${descriptor.noun}`,
      );
    });

    test.each<[string, () => Promise<unknown>]>([
      [
        "refused (no access to it any more)",
        async (): Promise<HTTPErrorResponse> => {
          return new HTTPErrorResponse(403, { error: "No." }, {});
        },
      ],
      [
        "failed on the server",
        async (): Promise<HTTPErrorResponse> => {
          return new HTTPErrorResponse(500, { error: "Boom." }, {});
        },
      ],
      [
        "unreachable",
        async (): Promise<never> => {
          throw new Error("Network Error");
        },
      ],
      [
        "not a status",
        async (): Promise<HTTPResponse<JSONObject>> => {
          return new HTTPResponse<JSONObject>(200, { nope: true }, {});
        },
      ],
    ])(
      "a status that is %s: the card says it could not load it, links on, and the page goes on",
      async (_label: string, answer: () => Promise<unknown>) => {
        serve(answer);
        renderCard();

        expect(await findUnavailable()).toHaveTextContent(
          "The AI agent's status could not be loaded.",
        );
        expect(
          screen.getByRole("link", { name: "Open the AI agent page" }),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection`),
        ).not.toBeInTheDocument();
      },
    );

    test("reads the status again when the Overview refreshes", async () => {
      serveStatus(makeStatus(type));
      const view: RenderResult = renderCard({ refreshToken: 1 });
      expect(await findBadge("fixes")).toBe("Ask for approval");

      serveStatus(
        makeStatus(type, {
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
      );
      view.rerender(
        <ResourceAiAgentStatusSummaryCard
          descriptor={descriptor}
          resourceId={RESOURCE_ID}
          refreshToken={2}
        />,
      );
      await settle();

      expect(postSpy).toHaveBeenCalledTimes(2);
      expect(await findBadge("fixes")).toBe("Bypass approval");
    });

    test("a refresh that fails keeps the status it last read", async () => {
      serveStatus(makeStatus(type));
      const view: RenderResult = renderCard({ refreshToken: 1 });
      expect(await findBadge("connection")).toBe("Connected");

      serve(async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(500, { error: "Boom." }, {});
      });
      view.rerender(
        <ResourceAiAgentStatusSummaryCard
          descriptor={descriptor}
          resourceId={RESOURCE_ID}
          refreshToken={2}
        />,
      );
      await settle();

      expect(postSpy).toHaveBeenCalledTimes(2);
      expect(await findBadge("connection")).toBe("Connected");
      expect(
        screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`),
      ).not.toBeInTheDocument();
    });

    test("another resource's card never shows the previous one's status", async () => {
      serveStatus(makeStatus(type));
      const view: RenderResult = renderCard();
      expect(await findBadge("connection")).toBe("Connected");

      // The next resource's status never arrives: the card waits for it.
      serve((): Promise<never> => {
        return new Promise<never>(() => {});
      });
      view.rerender(
        <ResourceAiAgentStatusSummaryCard
          descriptor={descriptor}
          resourceId={OTHER_RESOURCE_ID}
        />,
      );
      await settle();

      expect(
        screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection`),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("component-loader")).toBeInTheDocument();
      const request: JSONObject = postSpy.mock.calls[1]![0] as JSONObject;
      expect(request["data"]).toEqual({
        resourceType: type,
        resourceId: OTHER_RESOURCE_ID.toString(),
      });
    });

    test("shows a loader until the status arrives", async () => {
      serve((): Promise<never> => {
        return new Promise<never>(() => {});
      });
      renderCard();
      await settle();

      expect(screen.getByTestId("component-loader")).toBeInTheDocument();
      expect(
        screen.queryByTestId(`${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`),
      ).not.toBeInTheDocument();
    });
  },
);
