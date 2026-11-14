/** @timezone UTC */
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
} from "@testing-library/react";
import * as React from "react";
import AiRunFailureNotice, {
  AiRunFailureSettingsLink,
  getAiRunFailureSettingsLink,
  getAiRunFailureSettingsRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureNotice";
import {
  AI_LANE_ADVANCED_COLUMNS,
  AiLane,
  AiLaneAdvancedCard,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import AiRunTryAgainButton, {
  TRY_AGAIN_ERROR_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunTryAgainButton";
import { NOTICE_LINK_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationNotice";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import { PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN } from "../../../Types/AI/ProjectAiDailyLimits";
import {
  ButtonSize,
  OUTLINE_BUTTON_CLASS_NAME,
} from "../../../UI/Components/Button/Button";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  AiRunFailure,
  AiRunFailureWords,
  describeAiRunFailure,
  describeAiRunFailureCause,
  describeAiRunFailureFix,
  describeAttemptEnd,
  formatAiRunTime,
  readAiRunFailure,
  RECORD_TOKEN_LIMIT_FAILURE_WORDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureWords";
import {
  getRecordAiTokenLimitRunError,
  RECORD_AI_TOKEN_LIMIT_WORDS,
} from "../../../Types/AI/RecordAiTokenLimit";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { AIRunEventResultSummary } from "../../../Types/AI/AIChatTypes";
import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
  RECORD_TOKEN_LIMIT_FAILURE_KINDS,
} from "../../../Types/AI/AIRunAttempt";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  getProjectBalanceWhoCanAddSentence,
  PROJECT_AI_CREDITS_USED_UP_MESSAGE,
  PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
} from "../../../Utils/Project/ProjectBalance";

/*
 * AN AI RUN THAT DID NOT FINISH SAYS WHY, AND OFFERS TRY AGAIN (issue
 * #6438).
 *
 * A customer's triage failed with "OpenAICompatible API request failed"
 * and nothing to press. Every AI card now says a run that did not finish
 * with one notice: what happened, in words a person can act on, how many
 * times OneUptime tried, what to do, Try again for whoever may start the
 * run again, and the provider's own error under Details. Its Try again is
 * the one button every AI card offers it with.
 */

type TryAgainMock = ReturnType<typeof jest.fn<() => Promise<void>>>;

function event(
  eventType: AIRunEventType,
  resultSummary?: AIRunEventResultSummary,
): AIRunEvent {
  const aiRunEvent: AIRunEvent = new AIRunEvent(ObjectID.generate());
  aiRunEvent.eventType = eventType;

  if (resultSummary) {
    aiRunEvent.resultSummary = resultSummary;
  }

  return aiRunEvent;
}

function runFailed(attemptEnd: AIRunAttemptEnd): AIRunEvent {
  return event(AIRunEventType.RunFailed, { attemptEnd });
}

function started(times: number): Array<AIRunEvent> {
  return Array.from({ length: times }, (): AIRunEvent => {
    return event(AIRunEventType.RunStarted);
  });
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

function deferred(): Deferred {
  let resolve: () => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};
  const promise: Promise<void> = new Promise<void>(
    (onResolve: () => void, onReject: (reason: unknown) => void): void => {
      resolve = onResolve;
      reject = onReject;
    },
  );

  return { promise, resolve, reject };
}

// A provider that timed out on all three of its attempts.
const TIMED_OUT_THREE_TIMES: Array<AIRunEvent> = [
  ...started(3),
  runFailed({
    outcome: AIRunAttemptOutcome.GaveUp,
    failureKind: AIRunFailureKind.ProviderTimeout,
    attempt: 3,
    maxAttempts: 3,
    timeoutInSeconds: 120,
  }),
];

const PROVIDER_ERROR: string =
  "OpenAICompatible API request failed: The LLM provider did not respond within 120 seconds.";

beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("AiRunFailureNotice", () => {
  test("says what happened, how many times it tried, and what to do", () => {
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage={PROVIDER_ERROR}
        testId="triage-failure"
      />,
    );

    expect(screen.getByText("Triage did not finish")).toBeVisible();
    expect(screen.getByTestId("triage-failure-cause")).toHaveTextContent(
      /^The LLM provider did not answer within 120 seconds\.$/,
    );
    expect(screen.getByTestId("triage-failure-tries")).toHaveTextContent(
      /^OneUptime tried 3 times\.$/,
    );
    expect(screen.getByTestId("triage-failure-fix")).toHaveTextContent(
      "raise the provider's Response Timeout in Project Settings > AI > LLM Providers",
    );
  });

  test("the provider's own error waits under Details when the words name it", () => {
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage={PROVIDER_ERROR}
      />,
    );

    const toggle: HTMLElement = screen.getByRole("button", { name: "Details" });
    const details: HTMLElement = screen.getByTestId("ai-run-failure-details");

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", details.id);
    expect(details).toHaveTextContent(PROVIDER_ERROR);
    expect(details).not.toBeVisible();
    /*
     * The provider's words are English in every language: laid out by
     * their own first letter, an Arabic page does not put their full stop
     * at the start of the line.
     */
    expect(details).toHaveAttribute("dir", "auto");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(details).toBeVisible();

    fireEvent.click(toggle);

    expect(details).not.toBeVisible();
  });

  test("an error the words cannot name shows from the start: it is all there is", () => {
    render(
      <AiRunFailureNotice
        title="The investigation stopped before it could report."
        events={[]}
        errorMessage="The tool loop crashed"
      />,
    );

    expect(screen.getByTestId("ai-run-failure-cause")).toHaveTextContent(
      "Something went wrong while it ran.",
    );
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("The tool loop crashed")).toBeVisible();
  });

  test("no error, no Details", () => {
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage="   "
      />,
    );

    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByTestId("ai-run-failure-details")).toBeNull();
    expect(screen.queryByTestId("ai-run-failure-actions")).toBeNull();
  });

  test("a run tried once says nothing of tries", () => {
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={[
          ...started(1),
          runFailed({
            outcome: AIRunAttemptOutcome.GaveUp,
            failureKind: AIRunFailureKind.ProviderRejected,
            attempt: 1,
            maxAttempts: 1,
          }),
        ]}
        errorMessage="401 invalid_api_key"
      />,
    );

    expect(screen.queryByTestId("ai-run-failure-tries")).toBeNull();
    expect(screen.getByTestId("ai-run-failure-cause")).toHaveTextContent(
      "The LLM provider refused the request",
    );
  });

  test("Try again is there only for who may start the run again", async () => {
    const onTryAgain: TryAgainMock = jest.fn(async (): Promise<void> => {});
    const { rerender } = render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage={PROVIDER_ERROR}
        testId="triage-failure"
      />,
    );

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    rerender(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage={PROVIDER_ERROR}
        onTryAgain={onTryAgain}
        testId="triage-failure"
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Try again",
    });
    expect(button).toHaveAttribute("data-testid", "triage-failure-try-again");
    // With Details, in the notice's row of ways forward.
    expect(screen.getByTestId("triage-failure-actions")).toContainElement(
      button,
    );

    await act(async () => {
      fireEvent.click(button);
    });

    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  test("it is the card's notice - a red mark and a sentence - never a box", () => {
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage={PROVIDER_ERROR}
        onTryAgain={async (): Promise<void> => {}}
      />,
    );

    const notice: HTMLElement = screen.getByTestId("ai-run-failure");
    expect(notice.className).toBe("flex items-start gap-3");
    expect(notice.querySelector("svg")?.getAttribute("class")).toContain(
      "text-red-600",
    );

    const BOX: RegExp =
      /(^|\s)(bg-[a-z]+-(50|100)(\/\d+)?|rounded-(lg|xl|2xl)|shadow(-sm|-md|-lg)?|border(\s|$))/;
    const tryAgain: HTMLElement = screen.getByRole("button", {
      name: "Try again",
    });
    const boxes: Array<string> = [
      notice,
      ...Array.from(notice.querySelectorAll("*")),
    ]
      .filter((element: Element): boolean => {
        // Try again is a button, bordered as every outline button is.
        return element !== tryAgain && !tryAgain.contains(element);
      })
      .map((element: Element): string => {
        return element.getAttribute("class") || "";
      })
      .filter((className: string): boolean => {
        return BOX.test(className);
      });
    expect(boxes).toEqual([]);
  });

  test("a block is never put inside the notice's paragraph", () => {
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage={PROVIDER_ERROR}
        onTryAgain={async (): Promise<void> => {}}
      />,
    );

    for (const paragraph of Array.from(document.querySelectorAll("p"))) {
      expect(paragraph.querySelector("div, p, button")).toBeNull();
    }
  });
});

/*
 * The notice's "what to do" names a settings page. Whoever may make the
 * change there is taken to it, beside Try again; a reader who may not
 * keeps the sentence (it says where, and who), and is never sent to a page
 * that refuses them.
 */
describe("the settings page a failure's fix is made on", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000001",
  );

  // Where each kind of failure is fixed; null: there is nothing to change.
  const FIXED_ON: Record<
    AIRunFailureKind,
    { label: string; page: PageMap; path: string; card?: string } | null
  > = {
    [AIRunFailureKind.ProviderTimeout]: {
      label: "Open LLM Providers",
      page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      path: "settings/llm-providers",
    },
    [AIRunFailureKind.ProviderUnavailable]: {
      label: "Open LLM Providers",
      page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      path: "settings/llm-providers",
    },
    [AIRunFailureKind.ProviderRejected]: {
      label: "Open LLM Providers",
      page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      path: "settings/llm-providers",
    },
    [AIRunFailureKind.ContextWindow]: {
      label: "Open LLM Providers",
      page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      path: "settings/llm-providers",
    },
    [AIRunFailureKind.NotConfigured]: {
      label: "Open LLM Providers",
      page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      path: "settings/llm-providers",
    },
    [AIRunFailureKind.LimitReached]: {
      label: "Open AI Features",
      page: PageMap.SETTINGS_AI_FEATURES,
      path: "settings/ai-features",
    },
    [AIRunFailureKind.CreditsUsedUp]: {
      label: "Open AI Credits",
      page: PageMap.SETTINGS_AI_CREDITS,
      path: "settings/ai-credits",
    },
    /*
     * The incident's or alert's own daily AI token limit (#7157): the
     * record's AI settings, opened at the Daily limits card under More
     * settings - never the project's AI Features.
     */
    [AIRunFailureKind.IncidentTokenLimitPaused]: {
      label: "Review incident AI settings",
      page: PageMap.INCIDENTS_SETTINGS_AI,
      path: "incidents/ai/settings#DailyLimits",
      card: "DailyLimits",
    },
    [AIRunFailureKind.IncidentTokenLimitUsedUp]: {
      label: "Review incident AI settings",
      page: PageMap.INCIDENTS_SETTINGS_AI,
      path: "incidents/ai/settings#DailyLimits",
      card: "DailyLimits",
    },
    [AIRunFailureKind.AlertTokenLimitPaused]: {
      label: "Review alert AI settings",
      page: PageMap.ALERTS_SETTINGS_AI,
      path: "alerts/ai/settings#DailyLimits",
      card: "DailyLimits",
    },
    [AIRunFailureKind.AlertTokenLimitUsedUp]: {
      label: "Review alert AI settings",
      page: PageMap.ALERTS_SETTINGS_AI,
      path: "alerts/ai/settings#DailyLimits",
      card: "DailyLimits",
    },
    [AIRunFailureKind.ServerStopped]: null,
    [AIRunFailureKind.Other]: null,
  };

  function endedWith(failureKind: AIRunFailureKind): Array<AIRunEvent> {
    return [
      runFailed({
        outcome: AIRunAttemptOutcome.GaveUp,
        failureKind,
        attempt: 1,
        maxAttempts: 1,
      }),
    ];
  }

  function allow(isAllowed: boolean): void {
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed });
    jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue({ isAllowed });
  }

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  test("every kind of failure is decided: fixed on a page, or nothing to change", () => {
    expect(Object.keys(FIXED_ON).sort()).toEqual(
      Object.values(AIRunFailureKind).sort(),
    );
  });

  test.each(Object.values(AIRunFailureKind))(
    "%s: its page, for whoever may make the change there",
    (kind: AIRunFailureKind) => {
      allow(true);
      const expected: { label: string; page: PageMap; card?: string } | null =
        FIXED_ON[kind];
      const link: AiRunFailureSettingsLink | null =
        getAiRunFailureSettingsLink(kind);

      if (!expected) {
        expect(link).toBeNull();
        return;
      }

      expect(link).toEqual({
        label: expected.label,
        page: expected.page,
        ...(expected.card ? { card: expected.card } : {}),
        isAllowed: true,
      });
    },
  );

  test("a provider is changed by who may update one, and added by who may create one", () => {
    const check: ReturnType<typeof jest.spyOn> = jest
      .spyOn(PermissionGate, "check")
      .mockReturnValue({ isAllowed: false });

    expect(
      getAiRunFailureSettingsLink(AIRunFailureKind.ProviderTimeout)?.isAllowed,
    ).toBe(false);
    expect(check).toHaveBeenLastCalledWith(
      expect.any(LlmProvider),
      ModelAction.Update,
    );

    getAiRunFailureSettingsLink(AIRunFailureKind.NotConfigured);
    expect(check).toHaveBeenLastCalledWith(
      expect.any(LlmProvider),
      ModelAction.Create,
    );
  });

  test("the daily limits are asked of their column; the credits, of who may add them", () => {
    const columnCheck: ReturnType<typeof jest.spyOn> = jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue({ isAllowed: true });

    getAiRunFailureSettingsLink(AIRunFailureKind.LimitReached);
    expect(columnCheck).toHaveBeenCalledTimes(1);
    expect(columnCheck).toHaveBeenLastCalledWith(
      expect.any(Project),
      PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
    );

    columnCheck.mockClear();
    getAiRunFailureSettingsLink(AIRunFailureKind.CreditsUsedUp);
    expect(
      columnCheck.mock.calls.map((call: Array<unknown>): unknown => {
        return call[1];
      }),
    ).toEqual([
      ...PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[ProjectBalanceType.AI],
    ]);

    // One of them refused: not who may add credits, so no link.
    columnCheck.mockReturnValueOnce({ isAllowed: true });
    columnCheck.mockReturnValueOnce({ isAllowed: false });
    expect(
      getAiRunFailureSettingsLink(AIRunFailureKind.CreditsUsedUp)?.isAllowed,
    ).toBe(false);
  });

  test("whoever may make the fix is taken to its page, between Try again and Details", () => {
    allow(true);
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage={PROVIDER_ERROR}
        onTryAgain={async (): Promise<void> => {}}
        testId="triage-failure"
      />,
    );

    const link: HTMLElement = screen.getByRole("link", {
      name: "Open LLM Providers",
    });
    expect(link).toHaveAttribute("data-testid", "triage-failure-settings");
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/settings/llm-providers`,
    );
    // The notice's link: indigo words with the arrow glued to the last.
    expect(link.className).toContain(NOTICE_LINK_CLASS_NAME);
    expect(link.querySelector("[aria-hidden='true'] svg")).not.toBeNull();
    // The fix sentence still says where, for who reads rather than clicks.
    expect(screen.getByTestId("triage-failure-fix")).toHaveTextContent(
      "Project Settings > AI > LLM Providers",
    );

    const row: Array<string | null> = Array.from(
      screen.getByTestId("triage-failure-actions").children,
    ).map((child: Element): string | null => {
      return child.getAttribute("data-testid");
    });
    expect(row).toEqual([
      "triage-failure-try-again",
      "triage-failure-settings",
      "triage-failure-details-toggle",
    ]);
  });

  test.each(
    Object.values(AIRunFailureKind).filter((kind: AIRunFailureKind) => {
      return FIXED_ON[kind] !== null;
    }),
  )(
    "%s takes whoever may fix it to the page its words name",
    (kind: AIRunFailureKind) => {
      allow(true);
      render(
        <AiRunFailureNotice
          title="Triage did not finish"
          events={endedWith(kind)}
          testId="triage-failure"
        />,
      );

      const link: HTMLElement = screen.getByTestId("triage-failure-settings");
      expect(link).toHaveAccessibleName(FIXED_ON[kind]!.label);
      expect(link).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID.toString()}/${FIXED_ON[kind]!.path}`,
      );
      // A link alone is a row of ways forward of its own.
      expect(screen.getByTestId("triage-failure-actions")).toContainElement(
        link,
      );
    },
  );

  test("a reader who may not make the fix keeps the sentence, without a link to a page that refuses them", () => {
    allow(false);
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage={PROVIDER_ERROR}
        testId="triage-failure"
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("triage-failure-settings")).toBeNull();
    expect(screen.getByTestId("triage-failure-fix")).toHaveTextContent(
      "Project Settings > AI > LLM Providers",
    );
    // Details is still there to press.
    expect(screen.getByRole("button", { name: "Details" })).toBeVisible();
  });

  test("with no link, no Try again and no error, there is no row of actions at all", () => {
    allow(false);
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={endedWith(AIRunFailureKind.LimitReached)}
        testId="triage-failure"
      />,
    );

    expect(screen.queryByTestId("triage-failure-actions")).toBeNull();
  });

  test("a server that stopped, or an error the words cannot name, has nothing to change: no link", () => {
    allow(true);
    const { rerender } = render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={endedWith(AIRunFailureKind.ServerStopped)}
        onTryAgain={async (): Promise<void> => {}}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();

    rerender(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={[]}
        errorMessage="The tool loop crashed"
        onTryAgain={async (): Promise<void> => {}}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("AiRunTryAgainButton", () => {
  test("starts the run again once, and locks while it works", async () => {
    const pending: Deferred = deferred();
    const onTryAgain: TryAgainMock = jest.fn((): Promise<void> => {
      return pending.promise;
    });

    render(<AiRunTryAgainButton onTryAgain={onTryAgain} />);

    const button: HTMLElement = screen.getByTestId("ai-run-try-again");
    expect(button).toHaveTextContent("Try again");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(button.querySelector("svg")?.getAttribute("class")).not.toContain(
      "animate-spin",
    );

    fireEvent.click(button);

    expect(onTryAgain).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent("Starting again…");
    // Its arrow gives way to the spinner while it works: one mark, not two.
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(button.querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin",
    );

    // A second press while it works starts nothing more.
    fireEvent.click(button);
    expect(onTryAgain).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });

    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(button).toHaveTextContent("Try again");
    expect(button.querySelector("svg")?.getAttribute("class")).not.toContain(
      "animate-spin",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /*
   * It read as a link: indigo words with an arrow, in a row with Details
   * (gray words) - two things to press that looked like two things to
   * read. It is the product's outline button now, sized to its words at
   * every width, as a button in a card's row is.
   */
  test("it is the product's outline button, sized to its words", () => {
    render(<AiRunTryAgainButton onTryAgain={async (): Promise<void> => {}} />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "Try again",
    });
    expect(button.className).toContain(OUTLINE_BUTTON_CLASS_NAME);
    expect(button.className).toContain(ButtonSize.Small);
    // Not a dialog footer's button: as wide as its words, with no margin.
    expect(button.className).not.toMatch(/(^|\s)(w-full|md:ml-3)(\s|$)/);
    expect(button.className).not.toMatch(/(^|\s)text-indigo-\d+/);
  });

  test("its refusal takes a whole line after the row's last action, never one between them", async () => {
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={TIMED_OUT_THREE_TIMES}
        errorMessage={PROVIDER_ERROR}
        onTryAgain={async (): Promise<void> => {
          throw new Error("The network is down");
        }}
        testId="triage-failure"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("triage-failure-try-again"));
    });

    const refusal: HTMLElement = screen.getByRole("alert");
    expect(refusal).toHaveTextContent("The network is down");
    expect(refusal.className).toBe(TRY_AGAIN_ERROR_CLASS_NAME);
    expect(refusal).toHaveClass("order-last", "basis-full");
    // In the notice's row of actions, so the row orders it last.
    expect(screen.getByTestId("triage-failure-actions")).toContainElement(
      refusal,
    );
    expect(screen.getByTestId("triage-failure-actions")).toHaveClass(
      "flex",
      "flex-wrap",
    );
  });

  test("a refusal is said under it, in the server's words, and it can be pressed again", async () => {
    const onTryAgain: TryAgainMock = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new HTTPErrorResponse(
          400,
          {
            message:
              "This incident's investigation is queued or running already.",
          },
          {},
        ),
      )
      .mockResolvedValueOnce(undefined);

    render(<AiRunTryAgainButton onTryAgain={onTryAgain} testId="retry" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("retry"));
    });

    const error: HTMLElement = screen.getByRole("alert");
    expect(error).toHaveAttribute("data-testid", "retry-error");
    expect(error).toHaveTextContent(
      "This incident's investigation is queued or running already.",
    );
    // The server's words are English in every language: their own direction.
    expect(error).toHaveAttribute("dir", "auto");
    expect(screen.getByTestId("retry")).not.toBeDisabled();

    // Pressed again, the last refusal goes.
    await act(async () => {
      fireEvent.click(screen.getByTestId("retry"));
    });

    expect(onTryAgain).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("an error says its message; anything else, the button's own words", async () => {
    const onTryAgain: TryAgainMock = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("The network is down"))
      .mockRejectedValueOnce(undefined);

    render(<AiRunTryAgainButton onTryAgain={onTryAgain} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("ai-run-try-again"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("The network is down");

    await act(async () => {
      fireEvent.click(screen.getByTestId("ai-run-try-again"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The run could not start again. Try again in a moment.",
    );
    // The button's own words, translated, read in their own direction too.
    expect(screen.getByRole("alert")).toHaveAttribute("dir", "auto");
  });

  test("a card can name it", () => {
    render(
      <AiRunTryAgainButton
        onTryAgain={async (): Promise<void> => {}}
        label="Triage again"
      />,
    );

    expect(screen.getByRole("button", { name: "Triage again" })).toBeVisible();
  });

  test("taken away while it works (the card moved on), it does nothing more", async () => {
    const pending: Deferred = deferred();
    const consoleError: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {});

    const { unmount } = render(
      <AiRunTryAgainButton
        onTryAgain={(): Promise<void> => {
          return pending.promise;
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("ai-run-try-again"));
    unmount();

    await act(async () => {
      pending.reject(new Error("too late"));
      await pending.promise.catch((): void => {});
    });

    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("readAiRunFailure: why a run did not finish, from its events and its error", () => {
  test("its RunFailed says the kind, the timeout and how many attempts", () => {
    expect(
      readAiRunFailure({ events: TIMED_OUT_THREE_TIMES, errorMessage: "x" }),
    ).toEqual({
      failureKind: AIRunFailureKind.ProviderTimeout,
      timeoutInSeconds: 120,
      attempts: 3,
    });
  });

  test("the latest attempt end is read, an AttemptEnded among them", () => {
    expect(
      readAiRunFailure({
        events: [
          ...started(1),
          event(AIRunEventType.AttemptEnded, {
            attemptEnd: {
              outcome: AIRunAttemptOutcome.WillRetry,
              failureKind: AIRunFailureKind.ProviderTimeout,
              attempt: 1,
            },
          }),
          ...started(1),
          event(AIRunEventType.AttemptEnded, {
            attemptEnd: {
              outcome: AIRunAttemptOutcome.Stalled,
              failureKind: AIRunFailureKind.ServerStopped,
              attempt: 2,
            },
          }),
        ],
      }),
    ).toEqual({ failureKind: AIRunFailureKind.ServerStopped, attempts: 2 });
  });

  test("an end it cannot read is passed over for the one before it", () => {
    expect(
      readAiRunFailure({
        events: [
          event(AIRunEventType.AttemptEnded, {
            attemptEnd: {
              outcome: AIRunAttemptOutcome.WillRetry,
              failureKind: AIRunFailureKind.ProviderUnavailable,
            },
          }),
          event(AIRunEventType.RunFailed, {
            attemptEnd: { outcome: "Exploded" } as unknown as AIRunAttemptEnd,
          }),
        ],
      }).failureKind,
    ).toBe(AIRunFailureKind.ProviderUnavailable);
  });

  test("an end that says Other gives way to an error that names the kind", () => {
    expect(
      readAiRunFailure({
        events: [
          runFailed({
            outcome: AIRunAttemptOutcome.GaveUp,
            failureKind: AIRunFailureKind.Other,
          }),
        ],
        errorMessage: "Error: 429 Too Many Requests",
      }).failureKind,
    ).toBe(AIRunFailureKind.ProviderUnavailable);
  });

  test("an end that names the kind wins over an error that does not", () => {
    expect(
      readAiRunFailure({
        events: [
          runFailed({
            outcome: AIRunAttemptOutcome.GaveUp,
            failureKind: AIRunFailureKind.ContextWindow,
          }),
        ],
        errorMessage: "The tool loop crashed",
      }).failureKind,
    ).toBe(AIRunFailureKind.ContextWindow);
  });

  test("a run from before attempts said how they ended is read from its error", () => {
    expect(
      readAiRunFailure({
        events: started(2),
        errorMessage:
          "OpenAICompatible API request failed: The LLM provider did not respond within 300 seconds.",
      }),
    ).toEqual({
      failureKind: AIRunFailureKind.ProviderTimeout,
      timeoutInSeconds: 300,
      attempts: 2,
    });
  });

  test("one attempt is no count of attempts; nothing at all is Other", () => {
    expect(readAiRunFailure({ events: started(1) })).toEqual({
      failureKind: AIRunFailureKind.Other,
    });
    expect(readAiRunFailure({ events: [] })).toEqual({
      failureKind: AIRunFailureKind.Other,
    });
  });

  test("the attempts are the most its end or its starts say", () => {
    expect(
      readAiRunFailure({
        events: [
          ...started(1),
          runFailed({ outcome: AIRunAttemptOutcome.GaveUp, attempt: 3 }),
        ],
      }).attempts,
    ).toBe(3);
    expect(
      readAiRunFailure({
        events: [
          ...started(4),
          runFailed({ outcome: AIRunAttemptOutcome.GaveUp, attempt: 3 }),
        ],
      }).attempts,
    ).toBe(4);
  });
});

describe("the words for each kind of failure", () => {
  const translator: ReturnType<typeof getGlobalTranslator> =
    getGlobalTranslator();
  const KINDS: Array<AIRunFailureKind> = Object.values(AIRunFailureKind);

  test.each(KINDS)(
    "%s says what happened and what to do",
    (kind: AIRunFailureKind) => {
      const failure: AiRunFailure = { failureKind: kind };

      expect(describeAiRunFailureCause(failure, translator)).toMatch(
        /^[A-Z].+\.$/,
      );
      expect(describeAiRunFailureFix(failure, translator)).toMatch(
        /^[A-Z].+\.$/,
      );
    },
  );

  test("each kind says it its own way", () => {
    const causes: Set<string> = new Set(
      KINDS.map((kind: AIRunFailureKind): string => {
        return describeAiRunFailureCause({ failureKind: kind }, translator);
      }),
    );
    const fixes: Set<string> = new Set(
      KINDS.map((kind: AIRunFailureKind): string => {
        return describeAiRunFailureFix({ failureKind: kind }, translator);
      }),
    );

    expect(causes.size).toBe(KINDS.length);
    expect(fixes.size).toBe(KINDS.length);
  });

  test("a timeout says how long the provider had, when it is known", () => {
    expect(
      describeAiRunFailureCause(
        {
          failureKind: AIRunFailureKind.ProviderTimeout,
          timeoutInSeconds: 1,
        },
        translator,
      ),
    ).toBe("The LLM provider did not answer within 1 second.");
    expect(
      describeAiRunFailureCause(
        { failureKind: AIRunFailureKind.ProviderTimeout },
        translator,
      ),
    ).toBe("The LLM provider did not answer in time.");
  });

  test("the fixes point at the setting that helps", () => {
    expect(
      describeAiRunFailureFix(
        { failureKind: AIRunFailureKind.ProviderTimeout },
        translator,
      ),
    ).toContain("Response Timeout");
    expect(
      describeAiRunFailureFix(
        { failureKind: AIRunFailureKind.ProviderRejected },
        translator,
      ),
    ).toContain("API key");
    expect(
      describeAiRunFailureFix(
        { failureKind: AIRunFailureKind.ContextWindow },
        translator,
      ),
    ).toContain("num_ctx");
  });

  /*
   * A daily limit and used-up AI credits are changed by fewer people than
   * read the notice (a project owner or someone with Manage Billing): the
   * words name them, as the rest of the product does, and never send the
   * reader to try again tomorrow when it is the credits that ran out.
   */
  test("a daily limit says when AI starts again, and who can change the limits", () => {
    expect(
      describeAiRunFailure(
        { failureKind: AIRunFailureKind.LimitReached },
        translator,
      ),
    ).toEqual({
      whatHappened:
        "The project reached its daily AI limit. OneUptime AI starts again at midnight UTC.",
      whatToDo:
        "A project owner or someone with Manage Billing can change the project's daily AI limits in Project Settings → AI → AI Features.",
    });
  });

  test("used-up AI credits say so, and who can add them where, in the server's own words", () => {
    const words: AiRunFailureWords = describeAiRunFailure(
      { failureKind: AIRunFailureKind.CreditsUsedUp },
      translator,
    );

    expect(words.whatHappened).toBe("This project's AI credits are used up.");
    expect(words.whatToDo).toBe(
      getProjectBalanceWhoCanAddSentence(ProjectBalanceType.AI),
    );
    // The two sentences are the server's refusal, word for word.
    expect(`${words.whatHappened} ${words.whatToDo}`).toBe(
      PROJECT_AI_CREDITS_USED_UP_MESSAGE,
    );
  });

  test("a run that failed on used-up credits reads as used-up credits", () => {
    expect(
      readAiRunFailure({
        events: [],
        errorMessage: PROJECT_AI_CREDITS_USED_UP_MESSAGE,
      }).failureKind,
    ).toBe(AIRunFailureKind.CreditsUsedUp);
  });

  test("the provider's own account out of quota is the provider refusing", () => {
    const failure: AiRunFailure = readAiRunFailure({
      events: [],
      errorMessage:
        "429 You exceeded your current quota, please check your plan and billing details.",
    });

    expect(failure.failureKind).toBe(AIRunFailureKind.ProviderRejected);
    expect(describeAiRunFailureCause(failure, translator)).toBe(
      "The LLM provider refused the request: its API key or model may be wrong, or its account may lack access or credit.",
    );
  });

  test("tries are counted only past one", () => {
    const once: AiRunFailureWords = describeAiRunFailure(
      { failureKind: AIRunFailureKind.Other, attempts: 1 },
      translator,
    );
    const twice: AiRunFailureWords = describeAiRunFailure(
      { failureKind: AIRunFailureKind.Other, attempts: 2 },
      translator,
    );

    expect(once.triedTimes).toBeUndefined();
    expect(twice.triedTimes).toBe("OneUptime tried 2 times.");
  });
});

describe("describeAttemptEnd: how an attempt ended, as a line of the activity", () => {
  const translator: ReturnType<typeof getGlobalTranslator> =
    getGlobalTranslator();

  test("one tried again says why and when", () => {
    expect(
      describeAttemptEnd(
        {
          outcome: AIRunAttemptOutcome.WillRetry,
          failureKind: AIRunFailureKind.ProviderUnavailable,
          nextAttemptAt: "2026-11-09T14:05:00.000Z",
        },
        translator,
      ),
    ).toBe(
      "Did not finish: The LLM provider could not be reached, or was too busy to answer. Trying again at 14:05.",
    );
  });

  test("one tried again at no time it knows says it is trying again", () => {
    expect(
      describeAttemptEnd(
        {
          outcome: AIRunAttemptOutcome.WillRetry,
          failureKind: AIRunFailureKind.ProviderTimeout,
          timeoutInSeconds: 90,
        },
        translator,
      ),
    ).toBe(
      "Did not finish: The LLM provider did not answer within 90 seconds. Trying again.",
    );
  });

  test("the last one says it stopped, and why", () => {
    expect(
      describeAttemptEnd(
        {
          outcome: AIRunAttemptOutcome.GaveUp,
          failureKind: AIRunFailureKind.LimitReached,
        },
        translator,
      ),
    ).toBe(
      "Stopped: The project reached its daily AI limit. OneUptime AI starts again at midnight UTC.",
    );
    // Without a kind, as Other.
    expect(
      describeAttemptEnd({ outcome: AIRunAttemptOutcome.GaveUp }, translator),
    ).toBe("Stopped: Something went wrong while it ran.");
  });

  test("a hand-back and a stall say the run goes on by itself", () => {
    expect(
      describeAttemptEnd(
        { outcome: AIRunAttemptOutcome.HandedBack },
        translator,
      ),
    ).toBe(
      "Paused: the server running it shut down. It goes on from the start on another server.",
    );
    expect(
      describeAttemptEnd({ outcome: AIRunAttemptOutcome.Stalled }, translator),
    ).toBe(
      "Stopped answering: the server running it may have restarted. It starts again from the beginning.",
    );
  });
});

describe("formatAiRunTime", () => {
  test("the reader's clock: 24 hours, or twelve when they keep twelve", () => {
    const date: Date = new Date("2026-11-09T14:05:00.000Z");

    expect(formatAiRunTime(date)).toBe("14:05");

    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    expect(formatAiRunTime(date)).toBe("2:05 PM");
  });
});

/*
 * AN INCIDENT'S OR ALERT'S OWN DAILY AI TOKEN LIMIT (#7157).
 *
 * A project set the Daily Incident AI Token Limit to 0, and every automatic
 * investigation failed. The card said the project reached its daily AI
 * limit and that OneUptime AI starts again at midnight UTC: the wrong
 * setting, and a promise a limit of 0 never keeps. The card now names the
 * record's limit, says a limit of 0 pauses the work until someone raises
 * it, and takes whoever may change it to the record's AI settings, at the
 * Daily limits card.
 */
describe("a run the record's own daily AI token limit stopped", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000002",
  );

  interface TokenLimitCase {
    name: string;
    errorMessage: string;
    kind: AIRunFailureKind;
    cause: string;
    fix: string;
    path: string;
    label: string;
  }

  const CASES: Array<TokenLimitCase> = [
    {
      name: "an incident's limit of 0",
      errorMessage: getRecordAiTokenLimitRunError("incident", {
        limitInTokens: 0,
        usedTokensToday: 0,
      }),
      kind: AIRunFailureKind.IncidentTokenLimitPaused,
      cause:
        "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents.",
      fix: "Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
      path: "incidents/ai/settings#DailyLimits",
      label: "Review incident AI settings",
    },
    {
      name: "an incident's limit below 0",
      errorMessage: getRecordAiTokenLimitRunError("incident", {
        limitInTokens: -50,
        usedTokensToday: 0,
      }),
      kind: AIRunFailureKind.IncidentTokenLimitPaused,
      cause:
        "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents.",
      fix: "Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
      path: "incidents/ai/settings#DailyLimits",
      label: "Review incident AI settings",
    },
    {
      name: "an incident's limit used up",
      errorMessage: getRecordAiTokenLimitRunError("incident", {
        limitInTokens: 1000,
        usedTokensToday: 1300,
      }),
      kind: AIRunFailureKind.IncidentTokenLimitUsedUp,
      cause:
        "Automatic AI work for incidents used up today's Daily Incident AI Token Limit.",
      fix: "Raise or clear it under Incidents → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
      path: "incidents/ai/settings#DailyLimits",
      label: "Review incident AI settings",
    },
    {
      name: "an alert's limit of 0",
      errorMessage: getRecordAiTokenLimitRunError("alert", {
        limitInTokens: 0,
        usedTokensToday: 0,
      }),
      kind: AIRunFailureKind.AlertTokenLimitPaused,
      cause:
        "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts.",
      fix: "Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
      path: "alerts/ai/settings#DailyLimits",
      label: "Review alert AI settings",
    },
    {
      name: "an alert's limit below 0",
      errorMessage: getRecordAiTokenLimitRunError("alert", {
        limitInTokens: -1,
        usedTokensToday: 0,
      }),
      kind: AIRunFailureKind.AlertTokenLimitPaused,
      cause:
        "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts.",
      fix: "Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
      path: "alerts/ai/settings#DailyLimits",
      label: "Review alert AI settings",
    },
    {
      name: "an alert's limit used up",
      errorMessage: getRecordAiTokenLimitRunError("alert", {
        limitInTokens: 400,
        usedTokensToday: 400,
      }),
      kind: AIRunFailureKind.AlertTokenLimitUsedUp,
      cause:
        "Automatic AI work for alerts used up today's Daily Alert AI Token Limit.",
      fix: "Raise or clear it under Alerts → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
      path: "alerts/ai/settings#DailyLimits",
      label: "Review alert AI settings",
    },
  ];

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  test.each(CASES)(
    "$name: the cause, the fix, and the record's AI settings at the Daily limits card",
    (data: TokenLimitCase) => {
      jest
        .spyOn(PermissionGate, "checkColumnUpdate")
        .mockReturnValue({ isAllowed: true });

      render(
        <AiRunFailureNotice
          title="Investigation did not finish"
          events={[
            runFailed({
              outcome: AIRunAttemptOutcome.GaveUp,
              failureKind: data.kind,
              attempt: 1,
              maxAttempts: 1,
            }),
          ]}
          errorMessage={data.errorMessage}
          testId="investigation-failure"
        />,
      );

      expect(
        screen.getByTestId("investigation-failure-cause"),
      ).toHaveTextContent(data.cause);
      expect(screen.getByTestId("investigation-failure-fix")).toHaveTextContent(
        data.fix,
      );

      const link: HTMLElement = screen.getByTestId(
        "investigation-failure-settings",
      );
      expect(link).toHaveAccessibleName(data.label);
      expect(link).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID.toString()}/${data.path}`,
      );

      // Never the project's daily AI limit, and midnight only when used up.
      const notice: string =
        screen.getByTestId("investigation-failure").textContent || "";
      expect(notice).not.toContain("The project reached its daily AI limit");
      expect(notice.includes("midnight")).toBe(
        data.kind === AIRunFailureKind.IncidentTokenLimitUsedUp ||
          data.kind === AIRunFailureKind.AlertTokenLimitUsedUp,
      );
    },
  );

  test.each(CASES)(
    "$name: the run's error alone reads as its kind",
    (data: TokenLimitCase) => {
      expect(
        readAiRunFailure({ events: [], errorMessage: data.errorMessage })
          .failureKind,
      ).toBe(data.kind);
    },
  );

  /*
   * A run stored before #7157 recorded LimitReached for the record's limit,
   * with "Daily autonomous AI token budget exhausted (0 of 0 tokens used
   * today)". Its message says more than its kind: it reads as the record's
   * limit, paused, and says no midnight.
   */
  test("a run stored before reads as the record's limit its error names", () => {
    const oldError: (used: string, limit: string, place: string) => string = (
      used: string,
      limit: string,
      place: string,
    ): string => {
      return `Daily autonomous AI token budget exhausted (${used} of ${limit} tokens used today). Autonomous AI requests resume tomorrow (UTC) — raise or unset the limit under ${place} > AI > Settings.`;
    };
    const storedAs: (
      errorMessage: string,
      failureKind?: AIRunFailureKind,
    ) => AIRunFailureKind = (
      errorMessage: string,
      failureKind: AIRunFailureKind = AIRunFailureKind.LimitReached,
    ): AIRunFailureKind => {
      return readAiRunFailure({
        events: [
          runFailed({
            outcome: AIRunAttemptOutcome.GaveUp,
            failureKind,
            attempt: 1,
            maxAttempts: 1,
          }),
        ],
        errorMessage,
      }).failureKind;
    };

    expect(storedAs(oldError("0", "0", "Incidents"))).toBe(
      AIRunFailureKind.IncidentTokenLimitPaused,
    );
    expect(storedAs(oldError("0", "0", "Alerts"))).toBe(
      AIRunFailureKind.AlertTokenLimitPaused,
    );
    expect(storedAs(oldError("2,000", "1,000", "Incidents"))).toBe(
      AIRunFailureKind.IncidentTokenLimitUsedUp,
    );
    expect(storedAs(oldError("1,000", "1,000", "Alerts"))).toBe(
      AIRunFailureKind.AlertTokenLimitUsedUp,
    );
    // The project's own limits stay the project's.
    expect(storedAs("This project has reached its daily AI token limit.")).toBe(
      AIRunFailureKind.LimitReached,
    );
    // A kind the event names is kept over a message that names another.
    expect(
      storedAs(oldError("0", "0", "Incidents"), AIRunFailureKind.CreditsUsedUp),
    ).toBe(AIRunFailureKind.CreditsUsedUp);
  });

  test("the link is for whoever may change the record's daily token limit", () => {
    const columnCheck: ReturnType<typeof jest.spyOn> = jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue({ isAllowed: false });

    expect(
      getAiRunFailureSettingsLink(AIRunFailureKind.IncidentTokenLimitPaused)
        ?.isAllowed,
    ).toBe(false);
    expect(columnCheck).toHaveBeenLastCalledWith(
      expect.any(Project),
      AI_LANE_ADVANCED_COLUMNS[AiLane.Incident].dailyTokens,
    );

    getAiRunFailureSettingsLink(AIRunFailureKind.AlertTokenLimitUsedUp);
    expect(columnCheck).toHaveBeenLastCalledWith(
      expect.any(Project),
      AI_LANE_ADVANCED_COLUMNS[AiLane.Alert].dailyTokens,
    );

    // Refused: the sentences stay, the link does not.
    render(
      <AiRunFailureNotice
        title="Investigation did not finish"
        events={[]}
        errorMessage={getRecordAiTokenLimitRunError("alert", {
          limitInTokens: 0,
          usedTokensToday: 0,
        })}
        testId="investigation-failure"
      />,
    );
    expect(screen.queryByTestId("investigation-failure-settings")).toBeNull();
    expect(screen.getByTestId("investigation-failure-fix")).toHaveTextContent(
      "Alerts → AI → Settings → More settings",
    );
  });

  test("a link with no card goes to the page as before", () => {
    expect(
      getAiRunFailureSettingsRoute({
        label: "Open AI Features",
        page: PageMap.SETTINGS_AI_FEATURES,
        isAllowed: true,
      }).toString(),
    ).toBe(`/dashboard/${PROJECT_ID.toString()}/settings/ai-features`);
    expect(
      getAiRunFailureSettingsRoute({
        label: "Review alert AI settings",
        page: PageMap.ALERTS_SETTINGS_AI,
        card: AiLaneAdvancedCard.DailyLimits,
        isAllowed: true,
      }).toString(),
    ).toBe(
      `/dashboard/${PROJECT_ID.toString()}/alerts/ai/settings#DailyLimits`,
    );
  });

  /*
   * The Dashboard's keys are the server's sentences, so a run's error and
   * a refused Try again read in the reader's language word for word.
   */
  test("the words are the server's, sentence for sentence", () => {
    expect(RECORD_TOKEN_LIMIT_FAILURE_WORDS).toEqual({
      [AIRunFailureKind.IncidentTokenLimitPaused]: {
        cause: RECORD_AI_TOKEN_LIMIT_WORDS.incident.paused,
        fix: RECORD_AI_TOKEN_LIMIT_WORDS.incident.pausedStep,
      },
      [AIRunFailureKind.IncidentTokenLimitUsedUp]: {
        cause: RECORD_AI_TOKEN_LIMIT_WORDS.incident.usedUp,
        fix: RECORD_AI_TOKEN_LIMIT_WORDS.incident.usedUpStep,
      },
      [AIRunFailureKind.AlertTokenLimitPaused]: {
        cause: RECORD_AI_TOKEN_LIMIT_WORDS.alert.paused,
        fix: RECORD_AI_TOKEN_LIMIT_WORDS.alert.pausedStep,
      },
      [AIRunFailureKind.AlertTokenLimitUsedUp]: {
        cause: RECORD_AI_TOKEN_LIMIT_WORDS.alert.usedUp,
        fix: RECORD_AI_TOKEN_LIMIT_WORDS.alert.usedUpStep,
      },
    });
    expect(Object.keys(RECORD_TOKEN_LIMIT_FAILURE_WORDS).sort()).toEqual(
      [...RECORD_TOKEN_LIMIT_FAILURE_KINDS].sort(),
    );
  });
});
