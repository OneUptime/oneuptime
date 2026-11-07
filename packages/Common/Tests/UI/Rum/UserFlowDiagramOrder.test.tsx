import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../MockType";

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import RumApplicationUserFlows from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/UserFlows";

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/user-flows`;
const USER_KEY: string = "a".repeat(64);
const SESSION_ID: string = "c0000000000000000000000000000001";

function sampleResponse(scope: JSONObject | null): HTTPResponse<JSONObject> {
  return new HTTPResponse(
    200,
    {
      pages: ["https://shop.example.com/", "https://shop.example.com/checkout"],
      sessions: [
        {
          sessionId: SESSION_ID,
          startUnixMs: 1_800_000_000_000,
          durationMs: 60_000,
          deviceType: "desktop",
          browserName: "Chrome",
          countryCode: "DK",
          errorCount: 0,
          frustrationCount: 0,
          pages: [0, 1],
          pageSignals: [],
          hasRecording: true,
          isTruncated: false,
        },
      ],
      sessionsInWindow: 1,
      isSampled: false,
      maxSessions: 5000,
      startUnixMs: 0,
      endUnixMs: 1,
      scope: scope,
    } as unknown as JSONObject,
    {},
  );
}

function renderPage(search: string = ""): void {
  window.history.replaceState(null, "", `${PAGE_PATH}${search}`);

  render(
    <MemoryRouter>
      <RumApplicationUserFlows
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockImplementation(
    (request: { url?: unknown; data?: JSONObject }) => {
      const urlString: string = String(request?.url || "");
      if (urlString.includes("/user-flow/users")) {
        return Promise.resolve(
          new HTTPResponse(200, { users: [], nextCursor: null }, {}),
        );
      }

      const filters: JSONObject | undefined = request?.data?.["filters"] as
        | JSONObject
        | undefined;

      const scopeObj: JSONObject | null = filters?.["identifiedUserKey"]
        ? {
            kind: "user",
            identifiedUserKey: filters["identifiedUserKey"],
            visitorId: "",
            sessionId: "",
            identifiedUserLabel: "jane@example.com",
          }
        : null;

      return Promise.resolve(sampleResponse(scopeObj));
    },
  );
});

afterEach(() => {
  cleanup();
});

describe("User flow diagram ordering (#6192)", () => {
  it("renders the user flow diagram on top of journeys when filtered by user", async () => {
    renderPage(`?userKey=${USER_KEY}`);

    await waitFor(() => {
      expect(screen.getByTestId("user-flow-map")).toBeInTheDocument();
      expect(screen.getByTestId("user-flow-journeys")).toBeInTheDocument();
    });

    const mapElement: HTMLElement = screen.getByTestId("user-flow-map");
    const journeysElement: HTMLElement =
      screen.getByTestId("user-flow-journeys");

    // The user flow map diagram must appear before the journeys list in the DOM
    const isMapBeforeJourneys: boolean = Boolean(
      mapElement.compareDocumentPosition(journeysElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(isMapBeforeJourneys).toBe(true);
  });

  it("renders the user flow diagram below overview when showing all users (unfiltered)", async () => {
    renderPage("");

    await waitFor(() => {
      expect(screen.getByTestId("user-flow-map")).toBeInTheDocument();
      expect(
        screen.queryByTestId("user-flow-journeys"),
      ).not.toBeInTheDocument();
    });

    const mapElement: HTMLElement = screen.getByTestId("user-flow-map");
    const insightsElement: HTMLElement =
      screen.getByTestId("user-flow-insights");

    // When unfiltered, the overview/insights appears before the user flow map
    const isInsightsBeforeMap: boolean = Boolean(
      insightsElement.compareDocumentPosition(mapElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(isInsightsBeforeMap).toBe(true);
  });
});
