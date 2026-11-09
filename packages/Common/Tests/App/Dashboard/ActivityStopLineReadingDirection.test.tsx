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

import ChatActivityFeed from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
} from "../../../Types/AI/AIAgentRunLimits";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE LINE THAT A LIMIT STOPPED A RUN, ON A PAGE IN ANOTHER LANGUAGE
 * (issue #6440). The run's activity ends with one line from the server -
 * "This investigation stopped at the incident investigation time limit of
 * 20 minutes. Change it in Incidents → AI → Settings → More settings →
 * Investigation limits." - in English, while the steps around it are in the
 * reader's language. On an Arabic or Persian page, looked at in a browser,
 * the line's full stop stood before its first word (".Investigation
 * limits"), as an English sentence does when a right-to-left paragraph
 * orders it. Every log line the feed draws is the server's own text, so it
 * reads in its own direction (dir="auto"): an English line keeps its full
 * stop at its end, an Arabic one stays right to left, and each still starts
 * beside its mark like every other step.
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

const MINUTE_MS: number = 60 * 1000;

// The incident lane's time limit, 20 minutes, as the server reads it.
const LANE_LIMITS: AIAgentRunLimits = {
  maxLlmCalls: undefined,
  maxToolCalls: undefined,
  maxTokens: undefined,
  maxWallClockMs: 20 * MINUTE_MS,
  timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
};

// The sentence the server writes on the run's activity when a limit stops it.
const STOP_LINE: string = AIAgentRunLimitsHelper.getStopNoteText({
  reason: AIRunStopReason.TimeLimit,
  limits: LANE_LIMITS,
});

// A ProgressLog event, as the runners record one.
function logEvent(message: string, severity: string): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.ProgressLog;
  event.resultSummary = { message, severity };
  return event;
}

/*
 * A tool call that finished, as a run records one: the start opens the
 * step, the completion closes it.
 */
function toolEvents(toolName: string): Array<AIRunEvent> {
  const started: AIRunEvent = new AIRunEvent(ObjectID.generate());
  started.eventType = AIRunEventType.ToolCallStarted;
  started.toolName = toolName;

  const completed: AIRunEvent = new AIRunEvent(ObjectID.generate());
  completed.eventType = AIRunEventType.ToolCallCompleted;
  completed.toolName = toolName;
  completed.resultSummary = { rowCount: 42, durationInMs: 1200 };

  return [started, completed];
}

// The element that holds a line's words, found by its words.
function lineOf(text: string): HTMLElement {
  return screen.getByText(text);
}

afterEach(() => {
  cleanup();
  useLanguage("en");
});

describe("the activity line that a limit stopped the run", () => {
  test("is the server's sentence, amber, read in its own direction", () => {
    expect(STOP_LINE).toBe(
      "This investigation stopped at the incident investigation time limit of 20 minutes. Change it in Incidents → AI → Settings → More settings → Investigation limits.",
    );

    render(
      <ChatActivityFeed
        events={[logEvent(STOP_LINE, "Warning")]}
        hideChrome={true}
      />,
    );

    const line: HTMLElement = lineOf(STOP_LINE);

    expect(line.tagName).toBe("SPAN");
    expect(line).toHaveAttribute("dir", "auto");
    expect(line).toHaveClass("text-amber-600");
    // Its words only: no Markdown and no address spelled out.
    expect(line.textContent).not.toMatch(/[_[\]]|https?:/);
  });

  test.each(["ar", "fa", "de"])(
    "on a %s page it is the same English sentence, read left to right by its own words",
    (language: string) => {
      useLanguage(language);

      render(
        <ChatActivityFeed
          events={[
            ...toolEvents("search_logs"),
            logEvent(STOP_LINE, "Warning"),
          ]}
          hideChrome={true}
        />,
      );

      const line: HTMLElement = lineOf(STOP_LINE);

      expect(line).toHaveAttribute("dir", "auto");
      expect(line).toHaveClass("text-amber-600");
    },
  );

  test("its row keeps the page's direction, so its mark sits where every step's does", () => {
    useLanguage("ar");

    render(
      <ChatActivityFeed
        events={[logEvent(STOP_LINE, "Warning")]}
        hideChrome={true}
      />,
    );

    const line: HTMLElement = lineOf(STOP_LINE);
    let element: HTMLElement | null = line.parentElement;

    // No element between the line and the feed sets a direction of its own.
    while (element && element !== document.body) {
      expect(element.hasAttribute("dir")).toBe(false);
      element = element.parentElement;
    }
  });
});

describe("every log line is read in its own direction", () => {
  test.each([
    ["Info", "text-gray-500"],
    ["Warning", "text-amber-600"],
    ["Error", "text-red-600"],
    ["Fatal", "text-red-600"],
  ])("a line of severity %s", (severity: string, colour: string) => {
    const message: string = `A ${severity.toLowerCase()} line from the server.`;

    render(
      <ChatActivityFeed
        events={[logEvent(message, severity)]}
        hideChrome={true}
      />,
    );

    const line: HTMLElement = lineOf(message);

    expect(line).toHaveAttribute("dir", "auto");
    expect(line).toHaveClass(colour);
  });

  test("a line in Arabic is read right to left by the same rule", () => {
    const message: string = "توقف التحقيق عند المهلة الزمنية.";

    render(
      <ChatActivityFeed
        events={[logEvent(message, "Warning")]}
        hideChrome={true}
      />,
    );

    expect(lineOf(message)).toHaveAttribute("dir", "auto");
  });

  test("a step the feed words itself keeps the page's direction", () => {
    useLanguage("ar");

    render(
      <ChatActivityFeed
        events={[...toolEvents("search_logs"), logEvent(STOP_LINE, "Warning")]}
        hideChrome={true}
      />,
    );

    const steps: Array<Element> = Array.from(
      document.querySelectorAll('[data-testid="activity-step-text"]'),
    );

    // The tool step, then the stop line.
    expect(steps).toHaveLength(2);

    const toolWords: Array<Element> = Array.from(
      (steps[0] as Element).querySelectorAll("span"),
    );

    expect(toolWords.length).toBeGreaterThan(0);

    for (const word of toolWords) {
      expect(word.hasAttribute("dir")).toBe(false);
    }

    expect((steps[1] as Element).querySelector("span")).toHaveAttribute(
      "dir",
      "auto",
    );
  });
});
