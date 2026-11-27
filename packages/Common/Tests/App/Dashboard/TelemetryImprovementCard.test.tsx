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
import { CodeRepositoriesQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import { TELEMETRY_AI_FIX_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import {
  FakeCodeRepository,
  answerRepositoriesById,
  answerRepositoriesQuery,
} from "./CodeRepositoriesServer";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
  PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
  PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
} from "../../../Utils/Suggestions/CodeFixRepositoryPick";
import { PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE } from "../../../Utils/Suggestions/TelemetryImprovementSuggestion";

/*
 * The connected repositories the person may read, as Code's routes answer
 * the confirmation's repository search (#11209).
 */
const codeRepositories: {
  items: Array<FakeCodeRepository>;
  reads: Array<CodeRepositoriesQuery>;
} = { items: [], reads: [] };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      default: {
        getRepositories: async (query: CodeRepositoriesQuery) => {
          codeRepositories.reads.push(query);

          return answerRepositoriesQuery({
            repositories: codeRepositories.items,
            query,
          });
        },
        getRepositoriesById: async (ids: Array<string>) => {
          return answerRepositoriesById({
            repositories: codeRepositories.items,
            ids,
          });
        },
      },
    };
  },
);

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
        ) as { default: typeof ObjectID };
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
  // What the suggestion route answers once a start was refused.
  afterRefusal?: JSONObject,
): void {
  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();
    if (url.includes(TELEMETRY_IMPROVEMENT_SUGGESTION_PATH)) {
      if (suggestion instanceof Error) {
        throw suggestion;
      }
      const isAfterRefusal: boolean = posts(CREATE_PATH).length > 0;
      return new HTTPResponse(
        200,
        isAfterRefusal && afterRefusal ? afterRefusal : suggestion,
        {},
      );
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
          message: "This project used today's AI fix runs.",
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
      screen.getByText("This project used today's AI fix runs."),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("telemetry-improvement-card"),
    ).toBeInTheDocument();
    // The refusal asked again what the server offers: still the card.
    expect(posts(TELEMETRY_IMPROVEMENT_SUGGESTION_PATH)).toHaveLength(2);
  });

  test("refused because the same improvement started meanwhile: a link to it, not an error", async () => {
    answer(
      { offer: "Act", aiRunId: null },
      async () => {
        throw new HTTPErrorResponse(
          400,
          {
            message:
              "An improve-tracing task is already queued or running for this service. Track its progress in Code.",
          },
          {},
        );
      },
      { offer: "InProgress", aiRunId: RUN_ID },
    );
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
    expect(
      screen.queryByText("Could not create the tracing improvement task"),
    ).toBeNull();
    expect(screen.queryByTestId("telemetry-improvement-card")).toBeNull();
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

/*
 * A REPOSITORY TO PICK BEFORE THE IMPROVEMENT STARTS (#11209).
 *
 * The improvement is a code task on the person's behalf, made only in a
 * repository they may use in Code. When several of theirs are connected
 * and none is named like the service, the server says so (the suggestion's
 * `repositories`), and the confirmation asks which holds the service's
 * code - from a search of those on the server - before it starts.
 */
describe("a repository to pick before the improvement starts", () => {
  const REPOSITORIES: Array<{ id: string; name: string }> = [
    { id: "51000000-0000-4000-8000-000000000002", name: "billing" },
    { id: "51000000-0000-4000-8000-000000000001", name: "checkout-api" },
  ];

  beforeEach(() => {
    codeRepositories.reads = [];
    codeRepositories.items = [
      ...REPOSITORIES,
      // Not connected: no pick may name it.
      { id: "51000000-0000-4000-8000-000000000009", name: "archive-site" },
      // Connected, but not one the person may ask OneUptime AI in.
      { id: "51000000-0000-4000-8000-000000000008", name: "vault" },
    ].map((repository: { id: string; name: string }): FakeCodeRepository => {
      return {
        id: repository.id,
        name: repository.name,
        organizationName: "acme",
        repositoryName: repository.name,
        isConnected: repository.name !== "archive-site",
        canAsk: repository.name !== "vault",
        provider: "GitHub",
        stats: {
          working: 0,
          waitingForYou: 0,
          openPullRequests: 0,
          taskCount: 0,
        },
      };
    });
  });

  const WITH_REPOSITORIES: JSONObject = {
    offer: "Act",
    aiRunId: null,
    repositories: REPOSITORIES,
  };

  function dialog(): HTMLElement {
    return screen.getByRole("dialog");
  }

  async function confirmIt(
    taskType: "ImproveLogging" | "ImproveTracing" = "ImproveLogging",
  ): Promise<void> {
    const card: HTMLElement = await screen.findByTestId(
      "telemetry-improvement-card",
    );

    fireEvent.click(
      within(card).getByRole("button", {
        name: taskType === "ImproveLogging" ? /Improve Logging/ : /Improve Tracing/,
      }),
    );
  }

  function picker(): HTMLElement {
    return within(dialog()).getByTestId("telemetry-improvement-repository");
  }

  function confirmButton(name: string = "Improve Logging"): HTMLElement {
    return within(dialog()).getByRole("button", { name });
  }

  async function pick(name: string): Promise<void> {
    await act(async () => {
      fireEvent.focus(within(picker()).getByRole("combobox"));
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: new RegExp(name),
    });

    await act(async () => {
      fireEvent.click(option);
    });
  }

  test("the confirmation asks which repository holds the service's code, in a trace fix's words", async () => {
    answer(WITH_REPOSITORIES);
    renderCard();

    await confirmIt();

    expect(picker()).toHaveTextContent(TELEMETRY_AI_FIX_COPY.pickRepository);
    expect(within(picker()).getByRole("combobox")).toHaveAccessibleName(
      TELEMETRY_AI_FIX_COPY.pickRepository,
    );
    expect(within(picker()).getByRole("combobox")).toHaveAttribute(
      "placeholder",
      TELEMETRY_AI_FIX_COPY.pickRepositoryPlaceholder,
    );
    // Asked under the confirmation's own question.
    expect(dialog()).toHaveTextContent(
      "Are you sure you want to improve logging?",
    );
  });

  test("its button waits for the pick, and nothing starts", async () => {
    answer(WITH_REPOSITORIES);
    renderCard();

    await confirmIt();

    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());

    // Give a request the chance it must not take.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });
    expect(posts(CREATE_PATH)).toHaveLength(0);
  });

  test("picked, the improvement starts in the pick", async () => {
    answer(WITH_REPOSITORIES);
    renderCard();

    await confirmIt();
    await pick("checkout-api");

    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());

    await screen.findByTestId("telemetry-improvement-progress");
    expect(posts(CREATE_PATH)[0]!.data).toEqual({
      telemetryServiceId: SERVICE_ID.toString(),
      taskType: "ImproveLogging",
      repositoryId: "51000000-0000-4000-8000-000000000001",
    });
  });

  test("tracing's too", async () => {
    answer({ ...WITH_REPOSITORIES });
    renderCard("ImproveTracing");

    await confirmIt("ImproveTracing");
    await pick("billing");
    fireEvent.click(confirmButton("Improve Tracing"));

    await screen.findByTestId("telemetry-improvement-progress");
    expect(posts(CREATE_PATH)[0]!.data).toEqual({
      telemetryServiceId: SERVICE_ID.toString(),
      taskType: "ImproveTracing",
      repositoryId: "51000000-0000-4000-8000-000000000002",
    });
  });

  test("its search offers the connected repositories the person may ask OneUptime AI to work in - the ones the improvement takes", async () => {
    answer(WITH_REPOSITORIES);
    renderCard();

    await confirmIt();
    await act(async () => {
      fireEvent.focus(within(picker()).getByRole("combobox"));
    });
    await screen.findByRole("option", { name: /billing/ });

    expect(
      screen.getAllByRole("option").map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([
      expect.stringContaining("billing"),
      expect.stringContaining("checkout-api"),
    ]);
    expect(codeRepositories.reads[codeRepositories.reads.length - 1]).toEqual(
      expect.objectContaining({ group: "connected", askableOnly: true }),
    );
  });

  test("no repositories to pick from: the confirmation asks nothing more, and names none", async () => {
    answer({ offer: "Act", aiRunId: null, repositories: [] });
    renderCard();

    await confirmIt();

    expect(
      within(dialog()).queryByTestId("telemetry-improvement-repository"),
    ).toBeNull();
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());

    await screen.findByTestId("telemetry-improvement-progress");
    expect(posts(CREATE_PATH)[0]!.data).not.toHaveProperty("repositoryId");
  });

  test("one repository is no choice: nothing more asked", async () => {
    answer({ offer: "Act", aiRunId: null, repositories: [REPOSITORIES[0]!] });
    renderCard();

    await confirmIt();

    expect(
      within(dialog()).queryByTestId("telemetry-improvement-repository"),
    ).toBeNull();
  });

  test.each([
    ["no longer one the person may read", PICKED_REPOSITORY_NOT_FOUND_MESSAGE],
    [
      "no longer one the person may ask OneUptime AI to work in",
      PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
    ],
    ["no longer connected", PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE],
  ])(
    "a pick the server refused as %s is dropped, said, and the next confirmation waits for another",
    async (_name: string, refusal: string) => {
      answer(WITH_REPOSITORIES, async () => {
        throw new HTTPErrorResponse(422, { message: refusal }, {});
      });
      renderCard();

      await confirmIt();
      await pick("checkout-api");
      fireEvent.click(confirmButton());

      expect(await screen.findByText(refusal)).toBeInTheDocument();

      await confirmIt();
      expect(confirmButton()).toBeDisabled();
      expect(within(picker()).queryByText("checkout-api")).toBeNull();
    },
  );

  test("any other refusal keeps the pick, to try again", async () => {
    const credits: string = "This project's AI credits are used up.";
    answer(WITH_REPOSITORIES, async () => {
      throw new HTTPErrorResponse(400, { message: credits }, {});
    });
    renderCard();

    await confirmIt();
    await pick("checkout-api");
    fireEvent.click(confirmButton());

    expect(await screen.findByText(credits)).toBeInTheDocument();

    await confirmIt();
    expect(confirmButton()).toBeEnabled();
    // The pick is read again by its id, and named.
    expect(
      await within(picker()).findByText("checkout-api"),
    ).toBeInTheDocument();
  });

  test("a second repository connected since the card read its choices: why, and the confirmation then asks the pick", async () => {
    answer(
      { offer: "Act", aiRunId: null, repositories: [] },
      async () => {
        throw new HTTPErrorResponse(
          400,
          { message: PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE },
          {},
        );
      },
      WITH_REPOSITORIES,
    );
    renderCard();

    await confirmIt();
    fireEvent.click(confirmButton());

    expect(
      await screen.findByText(PICK_A_REPOSITORY_FOR_THE_IMPROVEMENT_MESSAGE),
    ).toBeInTheDocument();

    await confirmIt();
    expect(picker()).toHaveTextContent(TELEMETRY_AI_FIX_COPY.pickRepository);
    expect(confirmButton()).toBeDisabled();
  });
});
