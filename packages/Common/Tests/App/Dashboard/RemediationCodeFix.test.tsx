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
  within,
} from "@testing-library/react";
import * as React from "react";
import RemediationCodeFix, {
  REMEDIATION_CODE_FIX_PICK_CLASS_NAME,
  REMEDIATION_CODE_FIX_REPOSITORY_PICKER_TEST_ID,
  REMEDIATION_CODE_FIX_REPOSITORY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationCodeFix";
import {
  REMEDIATION_CODE_FIX_AUTOMATIC_REASONS,
  REMEDIATION_CODE_FIX_COPY,
  REMEDIATION_CODE_FIX_REASONS_WITH_SETTINGS_LINK,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import { CodeRepositoriesQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import { TELEMETRY_AI_FIX_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import {
  FakeCodeRepository,
  answerRepositoriesById,
  answerRepositoriesQuery,
} from "./CodeRepositoriesServer";
import {
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
  PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
  PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
} from "../../../Utils/Suggestions/CodeFixRepositoryPick";
import { PICK_A_REPOSITORY_FOR_THE_CODE_FIX_MESSAGES } from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { FinishedFixOutcome } from "../../../Utils/Suggestions/CodeFixSuggestion";
import {
  AutomaticCodeFixBlocker,
  InvestigationCodeFixSuggestion,
  NO_INVESTIGATION_CODE_FIX_SUGGESTION,
} from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * THE FIX IN THE CODE, ON THE REMEDIATION STEP (block 43).
 *
 * The investigation found the cause in the code: the step says what came
 * of it in one line - the pull request being written or done, with a link
 * to it; the one setup step in the way; or "Open fix pull request" - and
 * why OneUptime AI did not open it on its own. The automatic pull request
 * used to stop with a debug line, so a project with fixing on and no
 * repository saw nothing happen at all.
 */

/*
 * The connected repositories the person may read, as Code's routes answer
 * the step's repository search (#11209).
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

const SUBJECT_ID: string = "0193c0de-1111-4aaa-8bbb-000000000101";
const RUN_ID: string = "0193c0de-2222-4aaa-8bbb-000000000102";
const AI_RUN_ID: string = "0193c0de-3333-4aaa-8bbb-000000000103";

function suggestion(
  overrides: Partial<InvestigationCodeFixSuggestion>,
): InvestigationCodeFixSuggestion {
  return { ...NO_INVESTIGATION_CODE_FIX_SUGGESTION, ...overrides };
}

let postSpy: ReturnType<typeof jest.spyOn>;
let onChanged: ReturnType<typeof jest.fn>;

function renderRow(data: {
  suggestion: InvestigationCodeFixSuggestion;
  signal?: "incident" | "alert";
  investigationRunId?: string | null;
}): ReturnType<typeof render> {
  return render(
    <RemediationCodeFix
      signal={data.signal || "incident"}
      subjectId={SUBJECT_ID}
      investigationRunId={
        data.investigationRunId === undefined ? RUN_ID : data.investigationRunId
      }
      suggestion={data.suggestion}
      onChanged={onChanged as unknown as () => void}
    />,
  );
}

function row(): HTMLElement {
  return screen.getByTestId("remediation-code-fix");
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
  onChanged = jest.fn();
  postSpy = jest.spyOn(API, "post");
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the fix in the code, in one line", () => {
  test("says nothing when there is nothing to say", () => {
    const view: ReturnType<typeof render> = renderRow({
      suggestion: NO_INVESTIGATION_CODE_FIX_SUGGESTION,
    });

    expect(view.container).toBeEmptyDOMElement();
  });

  test.each<[string, boolean, string]>([
    [
      "OneUptime AI asked for it",
      true,
      REMEDIATION_CODE_FIX_COPY.inProgressAutomatic,
    ],
    ["a person asked for it", false, REMEDIATION_CODE_FIX_COPY.inProgress],
  ])(
    "being written, when %s: says so, and links to its progress in Code",
    (_case: string, isAutomatic: boolean, sentence: string) => {
      renderRow({
        suggestion: suggestion({
          offer: SuggestionOffer.InProgress,
          aiRunId: AI_RUN_ID,
          isAutomatic,
        }),
      });

      expect(row()).toHaveAttribute("data-tone", "waiting");
      expect(screen.getByTestId("remediation-code-fix-text")).toHaveTextContent(
        sentence,
      );
      expect(
        within(row()).getByRole("link", {
          name: REMEDIATION_CODE_FIX_COPY.viewProgress,
        }),
      ).toHaveAttribute(
        "href",
        expect.stringMatching(new RegExp(`/tasks/${AI_RUN_ID}$`)),
      );
      expect(screen.queryByTestId("remediation-code-fix-open")).toBeNull();
    },
  );

  test.each<[FinishedFixOutcome, string, string, string]>([
    [
      FinishedFixOutcome.Fixed,
      "acted",
      REMEDIATION_CODE_FIX_COPY.opened,
      REMEDIATION_CODE_FIX_COPY.viewPullRequest,
    ],
    [
      FinishedFixOutcome.WaitingForYou,
      "attention",
      REMEDIATION_CODE_FIX_COPY.waitingForYou,
      REMEDIATION_CODE_FIX_COPY.answerInCode,
    ],
    [
      FinishedFixOutcome.NothingToChange,
      "info",
      REMEDIATION_CODE_FIX_COPY.nothingToChange,
      REMEDIATION_CODE_FIX_COPY.viewTask,
    ],
  ])(
    "done, %s: what came of it, and where to see it",
    (
      fixOutcome: FinishedFixOutcome,
      tone: string,
      sentence: string,
      linkText: string,
    ) => {
      renderRow({
        suggestion: suggestion({
          offer: SuggestionOffer.Done,
          fixOutcome,
          aiRunId: AI_RUN_ID,
          isAutomatic: true,
        }),
      });

      expect(row()).toHaveAttribute("data-tone", tone);
      expect(screen.getByTestId("remediation-code-fix-text")).toHaveTextContent(
        sentence,
      );
      expect(
        within(row()).getByRole("link", { name: linkText }),
      ).toHaveAttribute(
        "href",
        expect.stringMatching(new RegExp(`/tasks/${AI_RUN_ID}$`)),
      );
    },
  );

  /*
   * The fix pull request is in a task a reply carried a private incident or
   * alert into, which the reader may not open: the line says it is there,
   * behind a lock, and why nothing of it shows - no state, no link its own
   * page would answer as not found, nothing to start.
   */
  test("in a task hidden from the reader: there, behind a lock, with no link", () => {
    renderRow({
      suggestion: suggestion({
        offer: SuggestionOffer.Done,
        fixOutcome: FinishedFixOutcome.Hidden,
        aiRunId: null,
        isAutomatic: false,
      }),
    });

    expect(row()).toHaveAttribute("data-tone", "info");
    expect(row()).toHaveAttribute("data-hidden", "true");
    expect(screen.getByTestId("remediation-code-fix-text")).toHaveTextContent(
      "A private incident or alert you can't open was added to this task, so its progress and pull request are hidden.",
    );
    expect(within(row()).queryAllByRole("link")).toHaveLength(0);
    expect(within(row()).queryAllByRole("button")).toHaveLength(0);
    expect(
      within(row()).queryByTestId("remediation-code-fix-action"),
    ).not.toBeInTheDocument();
  });

  test("no repository connected: says so, and links to connect one", () => {
    renderRow({
      suggestion: suggestion({
        offer: SuggestionOffer.SetUp,
        automaticBlocker: AutomaticCodeFixBlocker.NoRepository,
      }),
    });

    expect(row()).toHaveAttribute("data-tone", "attention");
    expect(screen.getByTestId("remediation-code-fix-text")).toHaveTextContent(
      REMEDIATION_CODE_FIX_COPY.noRepository,
    );
    expect(
      within(row()).getByRole("link", {
        name: REMEDIATION_CODE_FIX_COPY.connectRepository,
      }),
    ).toHaveAttribute("href", expect.stringMatching(/\/repositories$/));
    // The sentence already says why: no second line repeats it.
    expect(screen.queryByTestId("remediation-code-fix-why")).toBeNull();
    expect(screen.queryByTestId("remediation-code-fix-open")).toBeNull();
  });

  test("Code's gate in the way: its own words and fix, without a box", () => {
    renderRow({
      suggestion: suggestion({
        offer: SuggestionOffer.SetUp,
        blocker: {
          type: CodeTaskBlockerType.PlanRequired,
          message: "Code fixes need the Growth plan.",
        },
        automaticBlocker: AutomaticCodeFixBlocker.FixOff,
      }),
    });

    expect(screen.getByTestId("remediation-code-fix-text")).toHaveTextContent(
      REMEDIATION_CODE_FIX_COPY.recommended,
    );
    const blocker: HTMLElement = within(row()).getByTestId("code-blocker");
    expect(blocker).toBeVisible();
    expect(blocker.className).not.toMatch(/rounded-lg/);
    // The gate is the one step to take: the automatic reason waits behind it.
    expect(screen.queryByTestId("remediation-code-fix-why")).toBeNull();
  });
});

describe("opening the pull request", () => {
  function actRow(
    overrides: Partial<InvestigationCodeFixSuggestion> = {},
    investigationRunId?: string | null,
  ): void {
    renderRow({
      suggestion: suggestion({
        offer: SuggestionOffer.Act,
        automaticBlocker: AutomaticCodeFixBlocker.FixOff,
        ...overrides,
      }),
      ...(investigationRunId === undefined ? {} : { investigationRunId }),
    });
  }

  function openButton(): HTMLElement {
    return screen.getByTestId("remediation-code-fix-open");
  }

  test("offers it, under the investigation that found the cause in the code", () => {
    actRow();

    expect(screen.getByTestId("remediation-code-fix-text")).toHaveTextContent(
      REMEDIATION_CODE_FIX_COPY.recommended,
    );
    expect(openButton()).toHaveTextContent(
      REMEDIATION_CODE_FIX_COPY.openPullRequest,
    );
    expect(openButton()).toBeEnabled();
  });

  test("posts the run it is written from, once, and reads the fix again", async () => {
    let answer: (value: HTTPResponse<JSONObject>) => void = (): void => {};
    postSpy.mockImplementation((() => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          answer = resolve;
        },
      );
    }) as never);
    actRow();

    fireEvent.click(openButton());
    fireEvent.click(openButton());

    expect(postSpy).toHaveBeenCalledTimes(1);
    const request: { url: { toString: () => string }; data: JSONObject } =
      postSpy.mock.calls[0]![0] as {
        url: { toString: () => string };
        data: JSONObject;
      };
    expect(request.url.toString()).toContain(
      "/ai-investigation/create-fix-task",
    );
    expect(request.data).toEqual({
      subjectType: "incident",
      subjectId: SUBJECT_ID,
      investigationRunId: RUN_ID,
    });

    await act(async (): Promise<void> => {
      answer(new HTTPResponse<JSONObject>(200, { aiRunId: AI_RUN_ID }, {}));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("remediation-code-fix-error")).toBeNull();
  });

  test("an alert's is posted as the alert's", async () => {
    postSpy.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { aiRunId: AI_RUN_ID }, {}) as never,
    );
    renderRow({
      signal: "alert",
      suggestion: suggestion({ offer: SuggestionOffer.Act }),
    });

    await act(async (): Promise<void> => {
      fireEvent.click(openButton());
      await Promise.resolve();
    });

    expect(
      (postSpy.mock.calls[0]![0] as { data: JSONObject }).data["subjectType"],
    ).toBe("alert");
  });

  test("a refusal says why, in a notice, and leaves the button to try again", async () => {
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "No connected repository exists." },
        {},
      ) as never,
    );
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockReturnValue("No connected repository exists.");
    actRow();

    await act(async (): Promise<void> => {
      fireEvent.click(openButton());
      await Promise.resolve();
      await Promise.resolve();
    });

    const notice: HTMLElement = screen.getByTestId(
      "remediation-code-fix-error",
    );
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent(REMEDIATION_CODE_FIX_COPY.createFailed);
    expect(notice).toHaveTextContent("No connected repository exists.");
    expect(onChanged).not.toHaveBeenCalled();
    expect(openButton()).toBeEnabled();
  });

  test("without the run it would be written from, the button waits", () => {
    actRow({}, null);

    expect(openButton()).toBeDisabled();
    fireEvent.click(openButton());
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe("why OneUptime AI did not open it on its own", () => {
  const REASONS: Array<AutomaticCodeFixBlocker> = Object.values(
    AutomaticCodeFixBlocker,
  ).filter((blocker: AutomaticCodeFixBlocker): boolean => {
    return REMEDIATION_CODE_FIX_AUTOMATIC_REASONS[blocker] !== null;
  });

  test("every reason has words, but Enable AI off: then there is nothing to offer", () => {
    expect(REMEDIATION_CODE_FIX_AUTOMATIC_REASONS.AiOff).toBeNull();
    expect(REASONS).toHaveLength(
      Object.values(AutomaticCodeFixBlocker).length - 1,
    );
  });

  test.each(
    REASONS.flatMap(
      (
        blocker: AutomaticCodeFixBlocker,
      ): Array<[AutomaticCodeFixBlocker, "incident" | "alert"]> => {
        return [
          [blocker, "incident"],
          [blocker, "alert"],
        ];
      },
    ),
  )(
    "%s, on an %s: says why under the offer",
    (blocker: AutomaticCodeFixBlocker, signal: "incident" | "alert") => {
      renderRow({
        signal,
        suggestion: suggestion({
          offer: SuggestionOffer.Act,
          automaticBlocker: blocker,
        }),
      });

      const why: HTMLElement = screen.getByTestId("remediation-code-fix-why");
      expect(why).toHaveAttribute("data-reason", blocker);
      expect(why).toHaveTextContent(
        REMEDIATION_CODE_FIX_AUTOMATIC_REASONS[blocker]![signal],
      );

      /*
       * What to do comes first, right under what happened: Open fix pull
       * request, then why OneUptime AI did not open it on its own.
       */
      const open: HTMLElement = screen.getByTestId("remediation-code-fix-open");
      expect(
        screen
          .getByTestId("remediation-code-fix-text")
          .compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        open.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      const settings: HTMLElement | null = screen.queryByTestId(
        "remediation-code-fix-settings",
      );

      if (!REMEDIATION_CODE_FIX_REASONS_WITH_SETTINGS_LINK.includes(blocker)) {
        expect(settings).toBeNull();
        return;
      }

      // The switch, or the AI rules, on the record kind's AI settings page.
      expect(settings).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/${signal}s/ai/settings`,
      );
      expect(settings).toHaveTextContent(
        blocker === AutomaticCodeFixBlocker.FixOff
          ? signal === "incident"
            ? "Turn on for incidents"
            : "Turn on for alerts"
          : signal === "incident"
            ? "Incident AI rules"
            : "Alert AI rules",
      );
    },
  );
});

/*
 * A REPOSITORY TO PICK BEFORE THE PULL REQUEST OPENS (#11209).
 *
 * The pull request is a code task on the person's behalf, made only in a
 * repository they may use in Code. When several of theirs are connected
 * and the record's monitor names none of them, the server says so (the
 * suggestion's `repositories`) and the step asks which holds the code - in
 * the words a trace's Fix performance with AI asks it - from a search of
 * those on the server. The run would otherwise find no repository to work
 * in when it starts.
 */
describe("a repository to pick before the pull request opens", () => {
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

  function withRepositories(
    overrides: Partial<InvestigationCodeFixSuggestion> = {},
  ): InvestigationCodeFixSuggestion {
    return suggestion({
      offer: SuggestionOffer.Act,
      automaticBlocker: AutomaticCodeFixBlocker.FixOff,
      repositories: REPOSITORIES,
      ...overrides,
    });
  }

  function picker(): HTMLElement {
    return screen.getByTestId(REMEDIATION_CODE_FIX_REPOSITORY_TEST_ID);
  }

  function openButton(): HTMLElement {
    return screen.getByTestId("remediation-code-fix-open");
  }

  async function open(): Promise<void> {
    await act(async () => {
      fireEvent.focus(within(picker()).getByRole("combobox"));
    });
  }

  async function pick(name: string): Promise<void> {
    await open();

    const option: HTMLElement = await screen.findByRole("option", {
      name: new RegExp(name),
    });

    await act(async () => {
      fireEvent.click(option);
    });
  }

  async function press(): Promise<void> {
    await act(async (): Promise<void> => {
      fireEvent.click(openButton());
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  test("it asks which repository holds the code, in the words a trace's fix asks it", () => {
    renderRow({ suggestion: withRepositories() });

    expect(picker()).toHaveTextContent(TELEMETRY_AI_FIX_COPY.pickRepository);
    expect(within(picker()).getByRole("combobox")).toHaveAttribute(
      "placeholder",
      TELEMETRY_AI_FIX_COPY.pickRepositoryPlaceholder,
    );
    // The question names the box for a screen reader.
    expect(within(picker()).getByRole("combobox")).toHaveAccessibleName(
      TELEMETRY_AI_FIX_COPY.pickRepository,
    );
    expect(
      within(picker()).getByTestId(
        REMEDIATION_CODE_FIX_REPOSITORY_PICKER_TEST_ID,
      ),
    ).toBeInTheDocument();
  });

  test("the pick comes first, then the button under it, in one column", () => {
    renderRow({ suggestion: withRepositories() });

    const column: HTMLElement = picker().parentElement as HTMLElement;
    for (const name of REMEDIATION_CODE_FIX_PICK_CLASS_NAME.split(" ")) {
      expect(column).toHaveClass(name);
    }
    expect(
      picker().compareDocumentPosition(openButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The sentence and why it was not opened on its own stay as they were.
    expect(screen.getByTestId("remediation-code-fix-text")).toHaveTextContent(
      REMEDIATION_CODE_FIX_COPY.recommended,
    );
  });

  test("the pull request waits for the pick, and nothing is asked", async () => {
    renderRow({ suggestion: withRepositories() });

    expect(openButton()).toBeDisabled();

    await press();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("picked, the pull request opens in the pick - the run and the record as before", async () => {
    postSpy.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { aiRunId: AI_RUN_ID }, {}) as never,
    );
    renderRow({ suggestion: withRepositories() });

    await pick("checkout-api");
    expect(openButton()).toBeEnabled();

    await press();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect((postSpy.mock.calls[0]![0] as { data: JSONObject }).data).toEqual({
      subjectType: "incident",
      subjectId: SUBJECT_ID,
      investigationRunId: RUN_ID,
      repositoryId: "51000000-0000-4000-8000-000000000001",
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("an alert's pick is posted with the alert", async () => {
    postSpy.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { aiRunId: AI_RUN_ID }, {}) as never,
    );
    renderRow({ signal: "alert", suggestion: withRepositories() });

    await pick("billing");
    await press();

    expect((postSpy.mock.calls[0]![0] as { data: JSONObject }).data).toEqual(
      expect.objectContaining({
        subjectType: "alert",
        repositoryId: "51000000-0000-4000-8000-000000000002",
      }),
    );
  });

  test("opened, it lists the connected repositories the person may ask OneUptime AI to work in - the ones the route takes", async () => {
    renderRow({ suggestion: withRepositories() });

    await open();
    await screen.findByRole("option", { name: /billing/ });

    const options: Array<HTMLElement> = screen.getAllByRole("option");

    expect(
      options.map((option: HTMLElement): string => {
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

  test.each([
    ["no longer one the person may read", PICKED_REPOSITORY_NOT_FOUND_MESSAGE],
    [
      "no longer one the person may ask OneUptime AI to work in",
      PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
    ],
    ["no longer connected", PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE],
  ])(
    "a pick the server refused as %s is dropped, said, and the button waits for another",
    async (_name: string, refusal: string) => {
      postSpy.mockResolvedValue(
        new HTTPErrorResponse(422, { message: refusal }, {}) as never,
      );
      jest.spyOn(API, "getFriendlyMessage").mockReturnValue(refusal);
      renderRow({ suggestion: withRepositories() });

      await pick("checkout-api");
      await press();

      expect(screen.getByTestId("remediation-code-fix-error")).toHaveTextContent(
        refusal,
      );
      expect(openButton()).toBeDisabled();
      expect(within(picker()).queryByText("checkout-api")).toBeNull();
      expect(onChanged).not.toHaveBeenCalled();
    },
  );

  test("any other refusal keeps the pick, to try again", async () => {
    const credits: string = "This project's AI credits are used up.";
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(400, { message: credits }, {}) as never,
    );
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue(credits);
    renderRow({ suggestion: withRepositories() });

    await pick("checkout-api");
    await press();

    expect(screen.getByTestId("remediation-code-fix-error")).toHaveTextContent(
      credits,
    );
    expect(openButton()).toBeEnabled();
    expect(within(picker()).getByText("checkout-api")).toBeInTheDocument();
  });

  test.each([
    ["incident", PICK_A_REPOSITORY_FOR_THE_CODE_FIX_MESSAGES.incident],
    ["alert", PICK_A_REPOSITORY_FOR_THE_CODE_FIX_MESSAGES.alert],
  ])(
    "a second repository connected since the step read the %s's choices: why, and the choices read again for the picker",
    async (signal: string, askForPick: string) => {
      postSpy.mockResolvedValue(
        new HTTPErrorResponse(400, { message: askForPick }, {}) as never,
      );
      jest.spyOn(API, "getFriendlyMessage").mockReturnValue(askForPick);
      // Read before then: one repository was theirs, so no pick was asked.
      renderRow({
        signal: signal as "incident" | "alert",
        suggestion: suggestion({
          offer: SuggestionOffer.Act,
          automaticBlocker: AutomaticCodeFixBlocker.FixOff,
        }),
      });

      await press();

      expect(
        screen.getByTestId("remediation-code-fix-error"),
      ).toHaveTextContent(askForPick);
      // The step reads the suggestion again: its choices bring the picker.
      expect(onChanged).toHaveBeenCalledTimes(1);
    },
  );

  test("any other refusal does not read the choices again", async () => {
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "No." }, {}) as never,
    );
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue("No.");
    renderRow({ suggestion: withRepositories({ repositories: [] }) });

    await press();

    expect(onChanged).not.toHaveBeenCalled();
  });

  test("no repositories to pick from: no picker, and the pull request names none", async () => {
    postSpy.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { aiRunId: AI_RUN_ID }, {}) as never,
    );
    renderRow({ suggestion: withRepositories({ repositories: [] }) });

    expect(
      screen.queryByTestId(REMEDIATION_CODE_FIX_REPOSITORY_TEST_ID),
    ).toBeNull();
    expect(openButton()).toBeEnabled();

    await press();

    expect(
      (postSpy.mock.calls[0]![0] as { data: JSONObject }).data,
    ).not.toHaveProperty("repositoryId");
  });

  test("one repository is no choice: no picker", () => {
    renderRow({
      suggestion: withRepositories({ repositories: [REPOSITORIES[0]!] }),
    });

    expect(
      screen.queryByTestId(REMEDIATION_CODE_FIX_REPOSITORY_TEST_ID),
    ).toBeNull();
    expect(openButton()).toBeEnabled();
  });

  test.each([
    ["a set-up step", { offer: SuggestionOffer.SetUp }],
    [
      "a pull request being written",
      { offer: SuggestionOffer.InProgress, aiRunId: AI_RUN_ID },
    ],
    [
      "one that did its work",
      {
        offer: SuggestionOffer.Done,
        aiRunId: AI_RUN_ID,
        fixOutcome: FinishedFixOutcome.Fixed,
      },
    ],
  ])(
    "%s draws no picker, whatever the suggestion lists",
    (_name: string, overrides: Partial<InvestigationCodeFixSuggestion>) => {
      renderRow({ suggestion: withRepositories(overrides) });

      expect(
        screen.queryByTestId(REMEDIATION_CODE_FIX_REPOSITORY_TEST_ID),
      ).toBeNull();
    },
  );

  test("without the run it would be written from, the button waits even once picked", async () => {
    renderRow({ suggestion: withRepositories(), investigationRunId: null });

    await pick("checkout-api");

    expect(openButton()).toBeDisabled();
  });
});
