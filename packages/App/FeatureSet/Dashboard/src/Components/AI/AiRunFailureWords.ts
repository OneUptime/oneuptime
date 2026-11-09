import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
  classifyAIRunFailureMessage,
  parseAIRunAttemptEnd,
} from "Common/Types/AI/AIRunAttempt";
import OneUptimeDate from "Common/Types/Date";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Why an AI run did not finish, in words a person can act on (issues #6437,
 * #6438): what happened, how many times OneUptime tried, and what to do -
 * instead of the provider's error ("OpenAICompatible API request failed:
 * ..."), which the notice keeps under Details. Every AI card that shows a
 * run that did not finish words it here: an insight's triage, an
 * incident's or alert's investigation, and any other kind of run.
 */

export interface AiRunFailure {
  failureKind: AIRunFailureKind;
  // ProviderTimeout: the response timeout the provider missed, in seconds.
  timeoutInSeconds?: number | undefined;
  // How many attempts the run made, when it made more than one.
  attempts?: number | undefined;
}

export interface AiRunFailureWords {
  // What happened, as one sentence.
  whatHappened: string;
  // "OneUptime tried 3 times.", when it tried more than once.
  triedTimes?: string | undefined;
  // What the reader can do about it.
  whatToDo: string;
}

/*
 * A run's failure, read from its events and its error message: the run's
 * RunFailed event says it (attemptEnd), and a run that failed before
 * attempts recorded their end is read from its message. Attempts are the
 * RunFailed's count, else the run's RunStarted events.
 */
export function readAiRunFailure(data: {
  events: Array<AIRunEvent>;
  errorMessage?: string | undefined;
}): AiRunFailure {
  let attemptEnd: AIRunAttemptEnd | null = null;

  for (let index: number = data.events.length - 1; index >= 0; index--) {
    const event: AIRunEvent = data.events[index]!;

    if (
      event.eventType === AIRunEventType.RunFailed ||
      event.eventType === AIRunEventType.AttemptEnded
    ) {
      attemptEnd = parseAIRunAttemptEnd(event.resultSummary?.attemptEnd);

      if (attemptEnd) {
        break;
      }
    }
  }

  const startedAttempts: number = data.events.filter(
    (event: AIRunEvent): boolean => {
      return event.eventType === AIRunEventType.RunStarted;
    },
  ).length;

  const fromMessage: {
    failureKind: AIRunFailureKind;
    timeoutInSeconds?: number | undefined;
  } = classifyAIRunFailureMessage(data.errorMessage || "");

  const failureKind: AIRunFailureKind =
    attemptEnd?.failureKind &&
    !(
      attemptEnd.failureKind === AIRunFailureKind.Other &&
      fromMessage.failureKind !== AIRunFailureKind.Other
    )
      ? attemptEnd.failureKind
      : fromMessage.failureKind;

  const attempts: number = Math.max(attemptEnd?.attempt || 0, startedAttempts);

  return {
    failureKind,
    timeoutInSeconds:
      attemptEnd?.timeoutInSeconds ?? fromMessage.timeoutInSeconds,
    ...(attempts > 1 ? { attempts } : {}),
  };
}

// What happened, as one sentence in the reader's language.
export function describeAiRunFailureCause(
  failure: AiRunFailure,
  translator: Translator,
): string {
  switch (failure.failureKind) {
    case AIRunFailureKind.ProviderTimeout:
      return failure.timeoutInSeconds
        ? translator.translatePlural(
            {
              one: "The AI provider did not answer within {{count}} second.",
              other: "The AI provider did not answer within {{count}} seconds.",
            },
            failure.timeoutInSeconds,
          )
        : (translator.translateText(
            "The AI provider did not answer in time.",
          ) as string);
    case AIRunFailureKind.ProviderUnavailable:
      return translator.translateText(
        "The AI provider could not be reached, or was too busy to answer.",
      ) as string;
    case AIRunFailureKind.ProviderRejected:
      return translator.translateText(
        "The AI provider refused the request: its API key, its model or its access may be wrong.",
      ) as string;
    case AIRunFailureKind.ContextWindow:
      return translator.translateText(
        "The request grew larger than the model's context window.",
      ) as string;
    case AIRunFailureKind.NotConfigured:
      return translator.translateText(
        "There is no AI provider to use.",
      ) as string;
    case AIRunFailureKind.LimitReached:
      return translator.translateText(
        "A daily AI limit or the AI balance was reached.",
      ) as string;
    case AIRunFailureKind.ServerStopped:
      return translator.translateText(
        "The server running it stopped, for example while OneUptime restarted.",
      ) as string;
    default:
      return translator.translateText(
        "Something went wrong while it ran.",
      ) as string;
  }
}

// What the reader can do about it, as one sentence.
export function describeAiRunFailureFix(
  failure: AiRunFailure,
  translator: Translator,
): string {
  switch (failure.failureKind) {
    case AIRunFailureKind.ProviderTimeout:
      return translator.translateText(
        "If it is a slow or self-hosted model, give it more time: raise the provider's Response Timeout in Project Settings > AI > LLM Providers. Then try again.",
      ) as string;
    case AIRunFailureKind.ProviderUnavailable:
      return translator.translateText(
        "Check that the AI provider is up and that OneUptime can reach it, then try again.",
      ) as string;
    case AIRunFailureKind.ProviderRejected:
      return translator.translateText(
        "Check the provider's API key and model in Project Settings > AI > LLM Providers, and use Test there. Then try again.",
      ) as string;
    case AIRunFailureKind.ContextWindow:
      return translator.translateText(
        "Use a model with a larger context window, or raise its context window (num_ctx for Ollama). Then try again.",
      ) as string;
    case AIRunFailureKind.NotConfigured:
      return translator.translateText(
        "Add an AI provider in Project Settings > AI > LLM Providers, then try again.",
      ) as string;
    case AIRunFailureKind.LimitReached:
      return translator.translateText(
        "Try again tomorrow, or raise the limit in Project Settings > AI.",
      ) as string;
    case AIRunFailureKind.ServerStopped:
      return translator.translateText(
        "Nothing needs to change: try again.",
      ) as string;
    default:
      return translator.translateText(
        "Try again. If it fails again, the details below say what went wrong.",
      ) as string;
  }
}

export function describeAiRunFailure(
  failure: AiRunFailure,
  translator: Translator,
): AiRunFailureWords {
  return {
    whatHappened: describeAiRunFailureCause(failure, translator),
    ...(failure.attempts && failure.attempts > 1
      ? {
          triedTimes: translator.translatePlural(
            {
              one: "OneUptime tried {{count}} time.",
              other: "OneUptime tried {{count}} times.",
            },
            failure.attempts,
          ),
        }
      : {}),
    whatToDo: describeAiRunFailureFix(failure, translator),
  };
}

// A time of day, as the reader's clock reads it: "14:05" or "2:05 PM".
export function formatAiRunTime(date: Date): string {
  return OneUptimeDate.getLocalTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

/*
 * How an attempt ended, as one line of the run's activity: "Did not finish:
 * the AI provider did not answer within 120 seconds. Trying again at
 * 14:05." The cause is said without its full stop and lower-cased only in
 * English, where the line reads as one sentence.
 */
export function describeAttemptEnd(
  attemptEnd: AIRunAttemptEnd,
  translator: Translator,
): string {
  const cause: string = describeAiRunFailureCause(
    {
      failureKind: attemptEnd.failureKind || AIRunFailureKind.Other,
      timeoutInSeconds: attemptEnd.timeoutInSeconds,
    },
    translator,
  );

  switch (attemptEnd.outcome) {
    case AIRunAttemptOutcome.HandedBack:
      return translator.translateText(
        "Paused: the server running it shut down. It goes on from the start on another server.",
      ) as string;
    case AIRunAttemptOutcome.Stalled:
      return translator.translateText(
        "Stopped answering: the server running it may have restarted. It starts again from the beginning.",
      ) as string;
    case AIRunAttemptOutcome.WillRetry: {
      const nextAttemptAt: Date | null = attemptEnd.nextAttemptAt
        ? new Date(attemptEnd.nextAttemptAt)
        : null;

      return nextAttemptAt
        ? translator.translateTemplate(
            "Did not finish: {{cause}} Trying again at {{time}}.",
            { cause, time: formatAiRunTime(nextAttemptAt) },
          )
        : translator.translateTemplate(
            "Did not finish: {{cause}} Trying again.",
            { cause },
          );
    }
    default:
      return translator.translateTemplate("Stopped: {{cause}}", { cause });
  }
}
