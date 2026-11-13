/** @timezone UTC */
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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import AiRunFailureNotice from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureNotice";
import AiRunTryAgainButton from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunTryAgainButton";
import {
  describeAiRunFailure,
  describeAttemptEnd,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureWords";
import ChatActivityFeed from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import { AIRunEventResultSummary } from "../../../Types/AI/AIChatTypes";
import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../Types/AI/AIRunAttempt";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A RUN THAT DID NOT FINISH, AND ITS ATTEMPTS, IN THE READER'S LANGUAGE
 * (issues #6437, #6438).
 *
 * The failure notice says what happened, how many times OneUptime tried and
 * what to do; the activity says each attempt, how it ended, how long the
 * run took and how often a step repeated. Each of those words is in every
 * language the Dashboard speaks, and a sentence built from others - "Did
 * not finish: {{cause}} Trying again at {{time}}." - is in one language
 * throughout: the reader's when it is translated, English when it is not.
 */

// Every word the retries, the attempts and Try again added to the Dashboard.
const WORDS: Array<string> = [
  "A project owner or someone with Manage Billing can add AI credits in Project Settings → AI → AI Credits.",
  "Add an LLM provider in Project Settings > AI > LLM Providers, then try again.",
  "Attempt {{number}}",
  "Attempt {{number}} of {{count}}",
  "Check that the LLM provider is up and that OneUptime can reach it, then try again.",
  "Check the provider's API key and model in Project Settings > AI > LLM Providers, and use Test there. Then try again.",
  "Did not finish: {{cause}} Trying again at {{time}}.",
  "Did not finish: {{cause}} Trying again.",
  "If it is a slow or self-hosted model, give it more time: raise the provider's Response Timeout in Project Settings > AI > LLM Providers. Then try again.",
  "Nothing needs to change: try again.",
  "OneUptime AI will try again",
  "OneUptime tried {{count}} times.",
  "OneUptime tried {{count}} times._one",
  "Paused: the server running it shut down. It goes on from the start on another server.",
  "Response Timeout (Seconds)",
  "Retry At",
  "Seconds to wait for the provider to answer one request. Leave empty for 120 (300 for Ollama). Raise it for a slow or self-hosted model.",
  "Something went wrong while it ran.",
  "Starting again…",
  "Stopped answering: the server running it may have restarted. It starts again from the beginning.",
  "Stopped: {{cause}}",
  "The LLM provider could not be reached, or was too busy to answer.",
  "The LLM provider did not answer in time.",
  "The LLM provider did not answer within {{count}} seconds.",
  "The LLM provider did not answer within {{count}} seconds._one",
  "The LLM provider refused the request: its API key or model may be wrong, or its account may lack access or credit.",
  "The last attempt did not finish. OneUptime tries again at {{time}}; its steps so far are below.",
  "The request grew larger than the model's context window.",
  "The run could not start again. Try again in a moment.",
  "The server running it stopped, for example while OneUptime restarted.",
  "There is no LLM provider to use.",
  "Try again. If it fails again, the details below say what went wrong.",
  "Trying again at {{time}}",
  "Trying again soon",
  "Use a model with a larger context window, or raise its context window (num_ctx for Ollama). Then try again.",
  "did not finish",
  "paused when its server stopped",
  "running for {{duration}}",
  "stopped answering",
  "took {{duration}}",
  "· {{count}} times",
  "· {{count}} times_one",
];

const EN: Record<string, string> = readDashboardLocale("en");
const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");

// A locale's sentence with its {{placeholders}} filled.
function fill(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (whole: string, name: string): string => {
      return values[name] ?? whole;
    },
  );
}

// The locale's wording of a key, which must be its own.
function word(words: Record<string, string>, key: string): string {
  const value: string | undefined = words[key];

  expect({ key, worded: Boolean(value) && value !== key }).toEqual({
    key,
    worded: true,
  });

  return value!;
}

interface StepEvent {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  at?: string | undefined;
  resultSummary?: AIRunEventResultSummary | undefined;
}

function at(time: string): string {
  return `2026-11-09T${time}.000Z`;
}

function events(steps: Array<StepEvent>): Array<AIRunEvent> {
  return steps.map((step: StepEvent): AIRunEvent => {
    const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
    event.eventType = step.eventType;

    if (step.toolName) {
      event.toolName = step.toolName;
    }

    if (step.at) {
      event.createdAt = new Date(step.at);
    }

    if (step.resultSummary) {
      event.resultSummary = step.resultSummary;
    }

    return event;
  });
}

function search(time?: string): Array<StepEvent> {
  return [
    {
      eventType: AIRunEventType.ToolCallStarted,
      toolName: "search_logs",
      ...(time ? { at: at(time) } : {}),
    },
    {
      eventType: AIRunEventType.ToolCallCompleted,
      toolName: "search_logs",
      resultSummary: { rowCount: 3 },
      ...(time ? { at: at(time) } : {}),
    },
  ];
}

const TIMED_OUT: AIRunAttemptEnd = {
  outcome: AIRunAttemptOutcome.WillRetry,
  failureKind: AIRunFailureKind.ProviderTimeout,
  attempt: 1,
  maxAttempts: 3,
  timeoutInSeconds: 120,
  nextAttemptAt: at("14:05:00"),
};

// A run whose first attempt timed out, and whose second runs now.
const RETRIED_RUN: Array<AIRunEvent> = events([
  { eventType: AIRunEventType.RunStarted, at: at("14:00:00") },
  ...search("14:00:05"),
  { eventType: AIRunEventType.LlmCallStarted, at: at("14:00:06") },
  {
    eventType: AIRunEventType.AttemptEnded,
    at: at("14:02:06"),
    resultSummary: { attemptEnd: TIMED_OUT },
  },
  { eventType: AIRunEventType.RunStarted, at: at("14:05:02") },
  ...search("14:05:09"),
]);

// A run that gave up after three attempts, the provider timing out each time.
const GAVE_UP: Array<AIRunEvent> = events([
  { eventType: AIRunEventType.RunStarted },
  { eventType: AIRunEventType.RunStarted },
  { eventType: AIRunEventType.RunStarted },
  {
    eventType: AIRunEventType.RunFailed,
    resultSummary: {
      attemptEnd: {
        outcome: AIRunAttemptOutcome.GaveUp,
        failureKind: AIRunFailureKind.ProviderTimeout,
        attempt: 3,
        maxAttempts: 3,
        timeoutInSeconds: 120,
      },
    },
  },
]);

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: { de: { translation: DE }, fa: { translation: FA } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
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

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

describe("every word the retries and Try again added", () => {
  test("is a key of the Dashboard's English", () => {
    const missing: Array<string> = WORDS.filter((key: string): boolean => {
      return typeof EN[key] !== "string";
    });

    expect(missing).toEqual([]);

    // A one form holds the English one form; every other key is its own English.
    expect(EN["OneUptime tried {{count}} times._one"]).toBe(
      "OneUptime tried {{count}} time.",
    );
    expect(EN["· {{count}} times_one"]).toBe("· {{count}} time");
    expect(EN["Attempt {{number}} of {{count}}"]).toBe(
      "Attempt {{number}} of {{count}}",
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each its own way, and keeps its placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const unworded: Array<string> = WORDS.filter((key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      });

      expect(unworded).toEqual([]);

      for (const key of WORDS) {
        expect({ key, placeholders: placeholdersOf(words[key] || "") }).toEqual(
          { key, placeholders: placeholdersOf(EN[key]!) },
        );
      }
    },
  );
});

describe("the failure notice, in German", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  test("says what happened, how many tries, what to do, and Try again in German", () => {
    render(
      <AiRunFailureNotice
        title="Triage did not finish"
        events={GAVE_UP}
        errorMessage="OpenAICompatible API request failed: timeout of 120000ms exceeded"
        onTryAgain={async (): Promise<void> => {}}
      />,
    );

    expect(screen.getByText(word(DE, "Triage did not finish"))).toBeVisible();
    expect(screen.getByTestId("ai-run-failure-cause")).toHaveTextContent(
      fill(
        word(DE, "The LLM provider did not answer within {{count}} seconds."),
        { count: "120" },
      ),
    );
    expect(screen.getByTestId("ai-run-failure-tries")).toHaveTextContent(
      fill(word(DE, "OneUptime tried {{count}} times."), { count: "3" }),
    );
    expect(screen.getByTestId("ai-run-failure-fix")).toHaveTextContent(
      word(
        DE,
        "If it is a slow or self-hosted model, give it more time: raise the provider's Response Timeout in Project Settings > AI > LLM Providers. Then try again.",
      ),
    );
    expect(screen.getByTestId("ai-run-failure-try-again")).toHaveTextContent(
      word(DE, "Try again"),
    );
    // "Details" is German too.
    expect(isWordedInDashboardLocale("Details", "de")).toBe(true);
    expect(
      screen.getByTestId("ai-run-failure-details-toggle"),
    ).toHaveTextContent(DE["Details"]!);

    // The provider's own error stays as written, under Details.
    expect(screen.getByTestId("ai-run-failure-details")).toHaveTextContent(
      "OpenAICompatible API request failed: timeout of 120000ms exceeded",
    );
  });

  test("Try again says it is starting again in German while it works", async () => {
    let finish: () => void = (): void => {};
    render(
      <AiRunTryAgainButton
        onTryAgain={(): Promise<void> => {
          return new Promise<void>((resolve: () => void) => {
            finish = resolve;
          });
        }}
      />,
    );

    const button: HTMLElement = screen.getByTestId("ai-run-try-again");
    expect(button).toHaveTextContent(word(DE, "Try again"));

    fireEvent.click(button);
    expect(button).toHaveTextContent(word(DE, "Starting again…"));
    expect(button).toBeDisabled();

    await act(async (): Promise<void> => {
      finish();
    });

    expect(button).toHaveTextContent(word(DE, "Try again"));
  });

  test("a refusal that is not the server's says the button's own sentence in German", async () => {
    render(
      <AiRunTryAgainButton
        onTryAgain={(): Promise<void> => {
          // Not an Error the API can word: the button's own sentence says it.
          return Promise.reject("socket closed");
        }}
      />,
    );

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("ai-run-try-again"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      word(DE, "The run could not start again. Try again in a moment."),
    );
  });
});

describe("the failure's words, by language", () => {
  test("every kind of failure has its cause and its fix in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);

      for (const failureKind of Object.values(AIRunFailureKind)) {
        const said: { whatHappened: string; whatToDo: string } =
          describeAiRunFailure({ failureKind }, translator);
        const english: { whatHappened: string; whatToDo: string } =
          describeAiRunFailure({ failureKind }, dashboardTranslator("en"));

        expect({
          language,
          failureKind,
          same: said.whatHappened === english.whatHappened,
        }).toEqual({
          language,
          failureKind,
          same: false,
        });
        expect({
          language,
          failureKind,
          same: said.whatToDo === english.whatToDo,
        }).toEqual({
          language,
          failureKind,
          same: false,
        });
      }
    }
  });

  test("Russian says the tries in the form its count takes", () => {
    const russian: Translator = dashboardTranslator("ru");
    const words: Record<string, string> = readDashboardLocale("ru");

    // 21 takes the one form; 3 and 5 the general one, which names the count.
    expect(
      describeAiRunFailure(
        { failureKind: AIRunFailureKind.ProviderUnavailable, attempts: 21 },
        russian,
      ).triedTimes,
    ).toBe(
      fill(words["OneUptime tried {{count}} times._one"]!, { count: "21" }),
    );

    for (const attempts of [3, 5]) {
      expect(
        describeAiRunFailure(
          { failureKind: AIRunFailureKind.ProviderUnavailable, attempts },
          russian,
        ).triedTimes,
      ).toBe(
        fill(words["OneUptime tried {{count}} times."]!, {
          count: String(attempts),
        }),
      );
    }
  });

  test("an attempt's end is one German sentence, its cause German too", () => {
    expect(describeAttemptEnd(TIMED_OUT, dashboardTranslator("de"))).toBe(
      fill(word(DE, "Did not finish: {{cause}} Trying again at {{time}}."), {
        cause: fill(
          word(DE, "The LLM provider did not answer within {{count}} seconds."),
          { count: "120" },
        ),
        time: "14:05",
      }),
    );
  });

  test("a sentence a language has not worded yet stays English throughout, its cause too", () => {
    // German, but for the attempt's end itself.
    const partly: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "Did not finish: {{cause}} Trying again at {{time}}."
          ? undefined
          : DE[text];
      },
      "de",
    );

    expect(describeAttemptEnd(TIMED_OUT, partly)).toBe(
      "Did not finish: The LLM provider did not answer within 120 seconds. Trying again at 14:05.",
    );
  });
});

/*
 * Arabic, the eighteenth language, is one of DASHBOARD_LANGUAGES, so every
 * test above covers it; these hold its own rules (Locales/ARABIC.md):
 * i18next reads a count's general form for 0, 2, 3-10, 11-99 and 100+, so
 * that form is a label and its count, or a unit the same for every count;
 * and figures are Latin digits.
 */
describe("the failure's words, in Arabic", () => {
  const AR: Record<string, string> = readDashboardLocale("ar");
  const arabic: Translator = dashboardTranslator("ar");

  test("every word is worded its own way, and keeps its placeholders", () => {
    for (const key of WORDS) {
      expect({
        key,
        worded: Boolean(AR[key]?.trim()) && AR[key] !== EN[key],
      }).toEqual({ key, worded: true });
      expect({ key, placeholders: placeholdersOf(AR[key] || "") }).toEqual({
        key,
        placeholders: placeholdersOf(EN[key]!),
      });
    }
  });

  test("every kind of failure has its cause and its fix in Arabic", () => {
    const english: Translator = dashboardTranslator("en");

    for (const failureKind of Object.values(AIRunFailureKind)) {
      const said: { whatHappened: string; whatToDo: string } =
        describeAiRunFailure({ failureKind }, arabic);
      const inEnglish: { whatHappened: string; whatToDo: string } =
        describeAiRunFailure({ failureKind }, english);

      expect({
        failureKind,
        sameCause: said.whatHappened === inEnglish.whatHappened,
        sameFix: said.whatToDo === inEnglish.whatToDo,
      }).toEqual({ failureKind, sameCause: false, sameFix: false });
    }
  });

  test.each([2, 3, 11, 100])(
    "%i tries: a label and its count, in Latin digits",
    (attempts: number) => {
      expect(
        describeAiRunFailure(
          { failureKind: AIRunFailureKind.ProviderUnavailable, attempts },
          arabic,
        ).triedTimes,
      ).toBe(`عدد المحاولات: ${attempts}.`);
    },
  );

  test("a timeout's seconds in the short unit Arabic writes for every count", () => {
    expect(
      describeAiRunFailure(
        {
          failureKind: AIRunFailureKind.ProviderTimeout,
          timeoutInSeconds: 120,
        },
        arabic,
      ).whatHappened,
    ).toBe("لم يُجب موفّر LLM خلال 120 ث.");
  });

  test("the notice's heading, its buttons and its links to the settings are Arabic too", () => {
    for (const key of [
      "The investigation stopped before it could report.",
      "Try again",
      "Details",
      "Open LLM Providers",
      "Open AI Features",
      "Open AI Credits",
    ]) {
      expect({ key, worded: isWordedInDashboardLocale(key, "ar") }).toEqual({
        key,
        worded: true,
      });
    }
  });

  test("an attempt's end is one Arabic sentence, its cause Arabic too", () => {
    expect(describeAttemptEnd(TIMED_OUT, arabic)).toBe(
      fill(word(AR, "Did not finish: {{cause}} Trying again at {{time}}."), {
        cause: fill(
          word(AR, "The LLM provider did not answer within {{count}} seconds."),
          { count: "120" },
        ),
        time: "14:05",
      }),
    );
  });
});

describe("a run's attempts and summary, in German", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  beforeEach(() => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(at("14:09:00")));
  });

  test("an earlier attempt: its number, how it ended and its steps, in German", () => {
    render(
      <ChatActivityFeed
        events={RETRIED_RUN}
        hideChrome={true}
        run={{ status: AIRunStatus.Running }}
      />,
    );

    expect(screen.getByTestId("activity-attempt-toggle")).toHaveTextContent(
      [
        fill(word(DE, "Attempt {{number}} of {{count}}"), {
          number: "1",
          count: "3",
        }),
        word(DE, "did not finish"),
        fill(word(DE, "{{count}} steps"), { count: "3" }),
      ].join(" · "),
    );
    expect(screen.getByTestId("activity-attempt-title")).toHaveTextContent(
      fill(word(DE, "Attempt {{number}} of {{count}}"), {
        number: "2",
        count: "3",
      }),
    );

    fireEvent.click(screen.getByTestId("activity-attempt-toggle"));

    expect(
      screen.getByText(
        fill(word(DE, "Did not finish: {{cause}} Trying again at {{time}}."), {
          cause: fill(
            word(
              DE,
              "The LLM provider did not answer within {{count}} seconds.",
            ),
            { count: "120" },
          ),
          time: "14:05",
        }),
      ),
    ).toBeVisible();
  });

  test("Persian writes an attempt's numbers as it writes its step count", async () => {
    await inLanguage("fa");

    try {
      render(
        <ChatActivityFeed
          events={RETRIED_RUN}
          hideChrome={true}
          run={{ status: AIRunStatus.Running }}
        />,
      );

      const toggle: string =
        screen.getByTestId("activity-attempt-toggle").textContent || "";

      expect(toggle).toContain(
        fill(word(FA, "Attempt {{number}} of {{count}}"), {
          number: (1).toLocaleString("fa"),
          count: (3).toLocaleString("fa"),
        }),
      );
      expect(toggle).toContain(
        fill(word(FA, "{{count}} steps"), { count: (3).toLocaleString("fa") }),
      );
      expect(toggle).not.toMatch(/[0-9]/);
    } finally {
      await inLanguage("de");
    }
  });

  test("the same step again and again says how many times in German", () => {
    render(
      <ChatActivityFeed
        events={events(
          Array.from({ length: 12 }, (): Array<StepEvent> => {
            return search();
          }).flat(),
        )}
        hideChrome={true}
      />,
    );

    expect(screen.getByTestId("activity-step-repeat-toggle")).toHaveTextContent(
      fill(word(DE, "· {{count}} times"), { count: "12" }),
    );
  });

  test("the run's summary: started, took and steps, in German", () => {
    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted, at: at("14:00:00") },
          ...search("14:00:05"),
          { eventType: AIRunEventType.RunCompleted, at: at("14:06:00") },
        ])}
        hideChrome={true}
        showStepTimes={true}
        run={{
          status: AIRunStatus.Completed,
          startedAt: new Date(at("14:00:00")),
          completedAt: new Date(at("14:06:00")),
        }}
      />,
    );

    expect(screen.getByTestId("activity-run-summary")).toHaveTextContent(
      [
        fill(word(DE, "Started {{time}}"), { time: "14:00" }),
        fill(word(DE, "took {{duration}}"), {
          duration: fill(word(DE, "{{count}} minutes"), { count: "6" }),
        }),
        fill(word(DE, "{{count}} steps"), { count: "2" }),
      ].join(" · "),
    );
  });

  test("a run running now says for how long in German", () => {
    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted, at: at("14:06:00") },
          ...search("14:06:05"),
        ])}
        hideChrome={true}
        showStepTimes={true}
        run={{
          status: AIRunStatus.Running,
          startedAt: new Date(at("14:06:00")),
        }}
      />,
    );

    expect(screen.getByTestId("activity-run-summary")).toHaveTextContent(
      fill(word(DE, "running for {{duration}}"), {
        duration: fill(word(DE, "{{count}} minutes"), { count: "3" }),
      }),
    );
  });
});
