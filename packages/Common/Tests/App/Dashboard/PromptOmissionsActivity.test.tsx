import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import ChatActivityFeed, {
  countActivitySteps,
  describePromptOmissions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import {
  AIPromptOmissions,
  AIRunEventResultSummary,
} from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import ObjectID from "../../../Types/ObjectID";
import PromptText from "../../../Utils/AI/PromptText";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * WHAT AN INVESTIGATION LEFT OUT, IN ITS ACTIVITY (issue #4587).
 *
 * An investigation gives the model the incident's text with each embedded
 * image - a synthetic monitor's screenshot - as a short note, and a field
 * too long cut short. The run records what it left out as a ProgressLog
 * event with the counts (promptOmissions), and the activity feed draws a
 * line for each kind, in the reader's language - so a responder who sees a
 * screenshot on the incident knows why OneUptime AI says nothing about it.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

function omissions(partial: Partial<AIPromptOmissions>): AIPromptOmissions {
  return { ...PromptText.noOmissions(), ...partial };
}

function progressLog(summary: AIRunEventResultSummary): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.ProgressLog;
  event.resultSummary = summary;
  return event;
}

function runStarted(): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.RunStarted;
  return event;
}

const EVERYTHING: AIPromptOmissions = omissions({
  imageCount: 2,
  imageBytes: 1.2 * 1024 * 1024,
  encodedDataCount: 1,
  encodedDataBytes: 4096,
  shortenedTextCount: 1,
  omittedCharacterCount: 12345,
});

afterEach(() => {
  cleanup();
});

describe("describePromptOmissions", () => {
  test("one line per kind, in English", () => {
    expect(describePromptOmissions(EVERYTHING)).toEqual([
      "Left out 2 embedded images (1.2 MB): AI reads text, not images",
      "Left out 4 KB of encoded data: AI reads text only",
      "Shortened 1 long text: 12,345 characters left out",
    ]);
  });

  test("the singular for one image, the plural for more texts", () => {
    expect(
      describePromptOmissions(
        omissions({
          imageCount: 1,
          imageBytes: 340 * 1024,
          shortenedTextCount: 3,
          omittedCharacterCount: 900,
        }),
      ),
    ).toEqual([
      "Left out 1 embedded image (340 KB): AI reads text, not images",
      "Shortened 3 long texts: 900 characters left out",
    ]);
  });

  test("nothing left out draws nothing", () => {
    expect(describePromptOmissions(PromptText.noOmissions())).toEqual([]);
  });

  test("German reads it in German, singular and plural", () => {
    const german: Translator = translatorFor("de");

    expect(describePromptOmissions(EVERYTHING, german)).toEqual([
      "2 eingebettete Bilder ausgelassen (1.2 MB): KI liest Text, keine Bilder",
      "4 KB codierte Daten ausgelassen: KI liest nur Text",
      "1 langen Text gekürzt: 12.345 Zeichen ausgelassen",
    ]);
    expect(
      describePromptOmissions(
        omissions({ imageCount: 1, imageBytes: 1024 }),
        german,
      ),
    ).toEqual([
      "1 eingebettetes Bild ausgelassen (1 KB): KI liest Text, keine Bilder",
    ]);
  });

  test.each([
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ])("%s has its own words for every line, with every value in it", (language: string) => {
    const lines: Array<string> = describePromptOmissions(
      EVERYTHING,
      translatorFor(language),
    );
    const english: Array<string> = describePromptOmissions(EVERYTHING);

    expect(lines).toHaveLength(3);

    lines.forEach((line: string, index: number): void => {
      expect(line).not.toBe(english[index]);
      expect(line).not.toContain("{{");
    });

    expect(lines[0]).toContain("1.2 MB");
    expect(lines[1]).toContain("4 KB");
  });
});

describe("the activity feed draws what an investigation left out", () => {
  test("a line per kind, right after the run starts, as quiet log lines", () => {
    const { container } = render(
      <ChatActivityFeed
        events={[
          runStarted(),
          progressLog({
            message: PromptText.describeOmissions(EVERYTHING) || undefined,
            severity: "Info",
            promptOmissions: EVERYTHING,
          }),
        ]}
        hideChrome={true}
      />,
    );

    const lines: Array<string> = Array.from(
      container.querySelectorAll(".text-xs > span:last-child"),
    ).map((element: Element): string => {
      return element.textContent || "";
    });

    expect(lines).toEqual([
      "Starting investigation",
      "Left out 2 embedded images (1.2 MB): AI reads text, not images",
      "Left out 4 KB of encoded data: AI reads text only",
      "Shortened 1 long text: 12,345 characters left out",
    ]);

    // Informational, not a warning: gray, with no warning icon.
    expect(
      screen.getByText(
        "Left out 2 embedded images (1.2 MB): AI reads text, not images",
      ),
    ).toHaveClass("text-gray-500");
  });

  test("the counts, not the English sentence the server stored, are what is drawn", () => {
    render(
      <ChatActivityFeed
        events={[
          progressLog({
            message: "Left out 1 embedded image (340 KB): AI reads text, not images.",
            promptOmissions: omissions({ imageCount: 1, imageBytes: 340 * 1024 }),
          }),
        ]}
        hideChrome={true}
      />,
    );

    expect(
      screen.getByText(
        "Left out 1 embedded image (340 KB): AI reads text, not images",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(
        "Left out 1 embedded image (340 KB): AI reads text, not images.",
      ),
    ).toBeNull();
  });

  test("a progress log without counts still shows its message", () => {
    render(
      <ChatActivityFeed
        events={[progressLog({ message: "Cloning repository" })]}
        hideChrome={true}
      />,
    );

    expect(screen.getByText("Cloning repository")).toBeVisible();
  });

  test("the activity count counts each line", () => {
    expect(
      countActivitySteps([
        runStarted(),
        progressLog({ promptOmissions: EVERYTHING }),
      ]),
    ).toBe(4);
    expect(
      countActivitySteps([
        progressLog({
          promptOmissions: omissions({ imageCount: 1, imageBytes: 10 }),
        }),
      ]),
    ).toBe(1);
  });
});
