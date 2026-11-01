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
import RemediationCodeFix from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationCodeFix";
import {
  REMEDIATION_CODE_FIX_AUTOMATIC_REASONS,
  REMEDIATION_CODE_FIX_COPY,
  REMEDIATION_CODE_FIX_REASONS_WITH_SETTINGS_LINK,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
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
