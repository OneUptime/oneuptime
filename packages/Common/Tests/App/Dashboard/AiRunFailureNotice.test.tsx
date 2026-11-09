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
import AiRunFailureNotice from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureNotice";
import AiRunTryAgainButton from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunTryAgainButton";
import {
  AiRunFailure,
  AiRunFailureWords,
  describeAiRunFailure,
  describeAiRunFailureCause,
  describeAiRunFailureFix,
  describeAttemptEnd,
  formatAiRunTime,
  readAiRunFailure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureWords";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { AIRunEventResultSummary } from "../../../Types/AI/AIChatTypes";
import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../Types/AI/AIRunAttempt";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  getProjectBalanceWhoCanAddSentence,
  PROJECT_AI_CREDITS_USED_UP_MESSAGE,
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
      /^The AI provider did not answer within 120 seconds\.$/,
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
      "The AI provider refused the request",
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
    const boxes: Array<string> = [
      notice,
      ...Array.from(notice.querySelectorAll("*")),
    ]
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

    fireEvent.click(button);

    expect(onTryAgain).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Starting again…");
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
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toHaveTextContent("Try again");
    expect(screen.queryByRole("alert")).toBeNull();
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
    ).toBe("The AI provider did not answer within 1 second.");
    expect(
      describeAiRunFailureCause(
        { failureKind: AIRunFailureKind.ProviderTimeout },
        translator,
      ),
    ).toBe("The AI provider did not answer in time.");
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
      "The AI provider refused the request: its API key or model may be wrong, or its account may lack access or credit.",
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
      "Did not finish: The AI provider could not be reached, or was too busy to answer. Trying again at 14:05.",
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
      "Did not finish: The AI provider did not answer within 90 seconds. Trying again.",
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
