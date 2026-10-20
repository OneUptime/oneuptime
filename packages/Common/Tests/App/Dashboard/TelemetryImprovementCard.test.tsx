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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Mock } from "jest-mock";
import * as React from "react";
import { BrowserRouter } from "react-router-dom";
import TelemetryImprovementCard, {
  TELEMETRY_IMPROVEMENT_SUGGESTION_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/TelemetryImprovementCard";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * "Improve logging / tracing with AI" under a service's logs and traces: the
 * card asks the server what to offer and draws exactly that - the card,
 * a link to the improvement already on its way, or nothing at all - and
 * with the project's AI switched off it does not even ask.
 */

type PostArgs = { url: { toString: () => string }; data: JSONObject };

const postMock: Mock<(args: PostArgs) => Promise<unknown>> =
  jest.fn<(args: PostArgs) => Promise<unknown>>();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (args: PostArgs) => {
        return postMock(args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (error instanceof HTTPErrorResponse) {
          return String((error.data as JSONObject)?.["message"]);
        }
        return (error as Error)?.message || "Failed";
      },
    },
  };
});

let mockCurrentProject: { enableAi?: boolean } | null = null;

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: { default: typeof ObjectID } = jest.requireActual(
          "../../../Types/ObjectID",
        );
        return new ObjectIDClass.default(
          "10000000-0000-4000-8000-000000000001",
        );
      },
      getCurrentProject: (): { enableAi?: boolean } | null => {
        return mockCurrentProject;
      },
    },
  };
});

const SERVICE_ID: ObjectID = new ObjectID(
  "60000000-0000-4000-8000-000000000002",
);
const RUN_ID: string = "70000000-0000-4000-8000-000000000009";
const CREATE_PATH: string =
  "/ai-investigation/create-telemetry-improvement-task";

function answer(
  suggestion: JSONObject | Error,
  onCreate?: () => Promise<unknown>,
): void {
  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();
    if (url.includes(TELEMETRY_IMPROVEMENT_SUGGESTION_PATH)) {
      if (suggestion instanceof Error) {
        throw suggestion;
      }
      return new HTTPResponse(200, suggestion, {});
    }
    if (url.includes(CREATE_PATH)) {
      return onCreate
        ? onCreate()
        : new HTTPResponse(200, { aiRunId: RUN_ID }, {});
    }
    return new HTTPResponse(200, {}, {});
  });
}

function posts(path: string): Array<PostArgs> {
  return postMock.mock.calls
    .map((call: [PostArgs]) => {
      return call[0];
    })
    .filter((args: PostArgs) => {
      return args.url.toString().includes(path);
    });
}

function renderCard(
  taskType: "ImproveLogging" | "ImproveTracing" = "ImproveLogging",
): void {
  render(
    <BrowserRouter>
      <div data-testid="page">
        <TelemetryImprovementCard
          telemetryServiceId={SERVICE_ID}
          taskType={taskType}
        />
      </div>
    </BrowserRouter>,
  );
}

beforeEach(() => {
  postMock.mockReset();
  mockCurrentProject = null;
});

afterEach(() => {
  cleanup();
});

describe("Improve logging / tracing with AI", () => {
  test("asks the server what to offer for this service and recipe", async () => {
    answer({ offer: "None", aiRunId: null });
    renderCard("ImproveTracing");

    await waitFor(() => {
      expect(posts(TELEMETRY_IMPROVEMENT_SUGGESTION_PATH)).toHaveLength(1);
    });
    expect(posts(TELEMETRY_IMPROVEMENT_SUGGESTION_PATH)[0]!.data).toEqual({
      telemetryServiceId: SERVICE_ID.toString(),
      taskType: "ImproveTracing",
    });
  });

  test("nothing to offer: nothing at all, not even spacing", async () => {
    answer({ offer: "None", aiRunId: null });
    renderCard();

    await waitFor(() => {
      expect(posts(TELEMETRY_IMPROVEMENT_SUGGESTION_PATH)).toHaveLength(1);
    });
    expect(screen.getByTestId("page")).toBeEmptyDOMElement();
  });

  test("AI switched off: the server is not asked, and nothing is drawn", async () => {
    mockCurrentProject = { enableAi: false };
    answer({ offer: "Act", aiRunId: null });
    renderCard();

    // Give a request the chance it must not take.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });
    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("page")).toBeEmptyDOMElement();
  });

  test("a failed or garbled answer draws nothing", async () => {
    answer(new Error("network down"));
    renderCard();
    await waitFor(() => {
      expect(posts(TELEMETRY_IMPROVEMENT_SUGGESTION_PATH)).toHaveLength(1);
    });
    expect(screen.getByTestId("page")).toBeEmptyDOMElement();
    cleanup();

    postMock.mockReset();
    answer({ offer: "SetUp" });
    renderCard();
    await waitFor(() => {
      expect(posts(TELEMETRY_IMPROVEMENT_SUGGESTION_PATH)).toHaveLength(1);
    });
    expect(screen.getByTestId("page")).toBeEmptyDOMElement();
  });

  test("offered: the card, and confirming it starts the improvement and links to it", async () => {
    answer({ offer: "Act", aiRunId: null });
    renderCard();

    const card: HTMLElement = await screen.findByTestId(
      "telemetry-improvement-card",
    );
    expect(card).toHaveTextContent("Improve logging with AI");

    fireEvent.click(
      within(card).getByRole("button", { name: /Improve Logging/ }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Improve Logging",
      }),
    );

    const progress: HTMLElement = await screen.findByTestId(
      "telemetry-improvement-progress",
    );
    expect(progress).toHaveTextContent("Logging improvement task created");
    expect(posts(CREATE_PATH)[0]!.data).toEqual({
      telemetryServiceId: SERVICE_ID.toString(),
      taskType: "ImproveLogging",
    });
    expect(
      within(progress)
        .getByText("View task progress")
        .closest("a")!
        .getAttribute("href"),
    ).toContain(RUN_ID);
    expect(screen.queryByTestId("telemetry-improvement-card")).toBeNull();
  });

  test("a refused start says why, and the card stays to try again", async () => {
    answer({ offer: "Act", aiRunId: null }, async () => {
      throw new HTTPErrorResponse(
        400,
        {
          message:
            "An improve-tracing task is already queued or running for this service. Track its progress in Code.",
        },
        {},
      );
    });
    renderCard("ImproveTracing");

    const card: HTMLElement = await screen.findByTestId(
      "telemetry-improvement-card",
    );
    fireEvent.click(
      within(card).getByRole("button", { name: /Improve Tracing/ }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Improve Tracing",
      }),
    );

    expect(
      await screen.findByText("Could not create the tracing improvement task"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("telemetry-improvement-card"),
    ).toBeInTheDocument();
  });

  test("an improvement already on its way: a link to it instead of the card", async () => {
    answer({ offer: "InProgress", aiRunId: RUN_ID });
    renderCard("ImproveTracing");

    const progress: HTMLElement = await screen.findByTestId(
      "telemetry-improvement-progress",
    );
    expect(progress).toHaveTextContent("Tracing improvement in progress");
    expect(
      within(progress)
        .getByText("View task progress")
        .closest("a")!
        .getAttribute("href"),
    ).toContain(RUN_ID);
    expect(screen.queryByTestId("telemetry-improvement-card")).toBeNull();
  });
});
