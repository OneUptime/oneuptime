import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import TelemetryAiReadinessCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiReadinessCard";
import {
  TELEMETRY_AI_READINESS_COPY,
  TELEMETRY_AI_RUNNER_HINT,
  TELEMETRY_AI_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import { TelemetryAiLane } from "../../../Types/AI/TelemetryAi";
import {
  TELEMETRY_AI_READINESS_PATH,
  TelemetryAiReadinessJSON,
} from "../../../Types/AI/TelemetryAiActivity";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { announceModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { PROJECT_ID } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * Under the Profiler's AI switch: whether OneUptime AI can open pull
 * requests for the slow code it finds, and the one thing to do first when
 * it cannot - read again whenever Enable AI or the lane's switch is saved.
 */

const WAIT_TIMEOUT: number = 10000;

const READY: TelemetryAiReadinessJSON = {
  lane: TelemetryAiLane.Profile,
  isAiEnabled: true,
  isLaneOn: true,
  connectedRepositoryCount: 2,
  blocker: null,
  automaticFixesToday: 1,
  maxAutomaticFixesPerDay: 5,
};

let answers: Array<unknown>;
let postSpy: ReturnType<typeof jest.spyOn>;

function readinessRequests(): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(TELEMETRY_AI_READINESS_PATH);
    })
    .map((request: JSONObject): JSONObject => {
      return (request["data"] || {}) as JSONObject;
    });
}

beforeEach(() => {
  answers = [READY];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);

      if (!url.endsWith(TELEMETRY_AI_READINESS_PATH)) {
        throw new Error(`Unexpected request to ${url}`);
      }

      const answer: unknown = answers.length > 1 ? answers.shift() : answers[0];

      if (answer instanceof HTTPErrorResponse) {
        return answer;
      }

      return new HTTPResponse<JSONObject>(200, answer as JSONObject, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderCard(): void {
  render(
    <MemoryRouter>
      <TelemetryAiReadinessCard lane={TelemetryAiLane.Profile} />
    </MemoryRouter>,
  );
}

describe("the Profiler's pull request readiness", () => {
  test("asks for the lane's readiness", async () => {
    renderCard();

    await screen.findByTestId(
      TELEMETRY_AI_TEST_IDS.readinessReady,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(readinessRequests()).toEqual([{ lane: TelemetryAiLane.Profile }]);
  });

  test("ready: where the pull requests go, how many a day, and the Runner that makes them", async () => {
    renderCard();

    const ready: HTMLElement = await screen.findByTestId(
      TELEMETRY_AI_TEST_IDS.readinessReady,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(ready).toHaveTextContent(
      "OneUptime AI can open pull requests in 2 connected repositories.",
    );
    expect(ready).toHaveTextContent(
      "It opens at most 5 on its own each day (UTC): 1 so far today.",
    );
    expect(ready).toHaveTextContent(TELEMETRY_AI_RUNNER_HINT);
  });

  test("one repository reads as one", async () => {
    answers = [{ ...READY, connectedRepositoryCount: 1 }];
    renderCard();

    expect(
      await screen.findByText(
        "OneUptime AI can open pull requests in 1 connected repository.",
        { exact: false },
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
  });

  test("no repository: the step to connect one, linked to Code", async () => {
    answers = [{ ...READY, connectedRepositoryCount: 0 }];
    renderCard();

    const connect: HTMLElement = await screen.findByTestId(
      TELEMETRY_AI_TEST_IDS.readinessConnect,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(connect).toHaveTextContent(
      TELEMETRY_AI_READINESS_COPY.connectRepository,
    );

    const link: HTMLAnchorElement | null = screen
      .getByText(TELEMETRY_AI_READINESS_COPY.connectRepositoryLink)
      .closest("a");

    expect(link?.getAttribute("href")).toBe(`/dashboard/${PROJECT_ID}/code`);
    expect(
      screen.queryByTestId(TELEMETRY_AI_TEST_IDS.readinessReady),
    ).not.toBeInTheDocument();
  });

  test("what Code's gate says, in Code's own words", async () => {
    answers = [
      {
        ...READY,
        blocker: {
          type: CodeTaskBlockerType.NoAiCredits,
          message: "This project has no AI credits left.",
        },
      },
    ];
    renderCard();

    const notice: HTMLElement = await screen.findByTestId(
      "code-blocker",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    // Code's notice, which words each blocker itself.
    expect(notice).toHaveTextContent("This project's AI credits are used up.");
    expect(
      screen.queryByTestId(TELEMETRY_AI_TEST_IDS.readinessReady),
    ).not.toBeInTheDocument();
  });

  test("nothing while Enable AI is off: the notice above says it", async () => {
    answers = [{ ...READY, isAiEnabled: false }];
    renderCard();

    await act(async () => {
      await Promise.resolve();
    });

    expect(readinessRequests()).toHaveLength(1);
    expect(
      screen.queryByTestId(TELEMETRY_AI_TEST_IDS.readiness),
    ).not.toBeInTheDocument();
  });

  test("a readiness that cannot be read says so quietly", async () => {
    answers = [new HTTPErrorResponse(500, { message: "Down" }, {})];
    renderCard();

    expect(
      await screen.findByText(
        TELEMETRY_AI_READINESS_COPY.couldNotRead,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
  });

  test("reads again once the lane's switch, or Enable AI, is saved anywhere on the screen", async () => {
    answers = [
      { ...READY, isAiEnabled: false },
      READY,
      { ...READY, connectedRepositoryCount: 0 },
    ];
    renderCard();

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(PROJECT_ID),
        column: "enableAi",
        value: true,
      });
    });

    await screen.findByTestId(
      TELEMETRY_AI_TEST_IDS.readinessReady,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    await act(async () => {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(PROJECT_ID),
        column: "enableAutomaticProfileRemediation",
        value: true,
      });
    });

    await screen.findByTestId(
      TELEMETRY_AI_TEST_IDS.readinessConnect,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(readinessRequests()).toHaveLength(3);
  });
});
