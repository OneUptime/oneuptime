import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";

/*
 * The reader's language for the feed: English unless a test says another.
 * useTranslateValue is what useTranslator reads the words through.
 */
let mockLocale: Record<string, string> = {};
let mockLanguage: string = "en";

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        language: mockLanguage,
        translateString: (text: string): string | undefined => {
          return mockLocale[text];
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import ChatActivityFeed, {
  countActivitySteps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import {
  LlmProviderActivity,
  LlmProviderFallbackReason,
  LlmProviderSource,
  describeLlmProviderActivityInEnglish,
  isLlmProviderActivityWarning,
} from "../../../Types/AI/LlmProviderChoice";
import ObjectID from "../../../Types/ObjectID";

/*
 * A RUN SAYS WHICH LLM PROVIDER IT USED - in its activity, first, when the
 * rule that started it picked one (Server/Utils/AI/LlmProviderChoice): the
 * rule's pick, or the one used instead and why, as a warning. The feed draws
 * the line from the data (resultSummary.llmProvider), in the reader's
 * language - not the English sentence the server stored beside it.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function useLanguage(language: string): void {
  mockLanguage = language;
  mockLocale =
    language === "en"
      ? {}
      : (JSON.parse(
          fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
        ) as Record<string, string>);
}

/*
 * The event a run records for its choice, as the server builds it
 * (LlmProviderChoice.getActivityEventSummary, pinned in its own tests).
 */
function providerEvent(activity: LlmProviderActivity): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.ProgressLog;
  event.resultSummary = {
    message: describeLlmProviderActivityInEnglish(activity),
    severity: isLlmProviderActivityWarning(activity) ? "Warning" : "Info",
    llmProvider: activity,
  };
  return event;
}

const RULE_PICK: LlmProviderActivity = {
  source: LlmProviderSource.RulePick,
  providerName: "Claude Opus",
};

const FELL_BACK: LlmProviderActivity = {
  source: LlmProviderSource.ProjectDefault,
  providerName: "Azure GPT-4o",
  fallbackReason: LlmProviderFallbackReason.Unavailable,
};

// The words and the colour class of each step the feed drew.
function drawnSteps(container: HTMLElement): Array<[string, string]> {
  return Array.from(container.querySelectorAll("span.break-words")).map(
    (element: Element): [string, string] => {
      return [element.textContent || "", element.className];
    },
  );
}

afterEach(() => {
  cleanup();
  useLanguage("en");
});

describe("a run's line about its LLM provider", () => {
  test("the rule's pick, as a plain step", () => {
    const { container } = render(
      <ChatActivityFeed
        events={[providerEvent(RULE_PICK)]}
        hideChrome={true}
      />,
    );

    expect(drawnSteps(container)).toEqual([
      [
        "Using Claude Opus, the rule's LLM provider",
        "break-words text-gray-500",
      ],
    ]);
  });

  test("the one used instead, and why, as a warning", () => {
    const { container } = render(
      <ChatActivityFeed
        events={[providerEvent(FELL_BACK)]}
        hideChrome={true}
      />,
    );

    expect(drawnSteps(container)).toEqual([
      [
        "Using Azure GPT-4o, the project's default LLM provider, because the rule's provider is no longer available",
        "break-words text-amber-600",
      ],
    ]);
  });

  test("no provider left at all, as a warning", () => {
    render(
      <ChatActivityFeed
        events={[
          providerEvent({
            fallbackReason: LlmProviderFallbackReason.Unavailable,
          }),
        ]}
        hideChrome={true}
      />,
    );

    expect(
      screen.getByText(
        "The rule's LLM provider is no longer available, and there is no other to use",
      ),
    ).toHaveClass("text-amber-600");
  });

  test("is drawn from the data, in the reader's language, not from the English the server stored", () => {
    useLanguage("de");

    const event: AIRunEvent = providerEvent(FELL_BACK);
    const { container } = render(
      <ChatActivityFeed events={[event]} hideChrome={true} />,
    );

    const [[text, className]] = drawnSteps(container) as [[string, string]];

    expect(text).not.toBe(event.resultSummary?.message);
    expect(text).toContain("Azure GPT-4o");
    expect(className).toContain("text-amber-600");
  });

  test("counts as one step", () => {
    expect(
      countActivitySteps([providerEvent(RULE_PICK), providerEvent(FELL_BACK)]),
    ).toBe(2);
  });
});
