/*
 * A status page update's note is Markdown: paragraphs, and now quotes and
 * callouts (a quote is a <blockquote>, a callout a <blockquote> holding a
 * <div>). EventItem drew the note inside a <p>, and none of those may sit in
 * a <p>: React warned "validateDOMNesting" on every status page update with
 * a note, and a browser parsing the same markup would have closed the <p>
 * early. The note is drawn in a <div> now.
 *
 * The viewer is replaced by a stand-in that draws what the real one draws
 * for a note with a quote and a callout (MarkdownViewerLinksAndQuotes runs
 * the real renderers).
 */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return (
        <div className="max-w-none" data-testid="markdown-stand-in">
          <p>{props.text}</p>
          <blockquote>
            <p>They are rolling out a fix.</p>
          </blockquote>
          <blockquote role="note" aria-label="Note" data-callout="note">
            <div>
              <p>Orders outside the EU are not affected.</p>
            </div>
          </blockquote>
        </div>
      );
    },
  };
});

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import EventItem, {
  TimelineItemType,
} from "../../../UI/Components/EventItem/EventItem";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderUpdateWithNote(): void {
  render(
    <EventItem
      eventTitle="Checkout is failing for some customers in Europe"
      eventType="Incident"
      eventTypeColor={new Color("#ef4444")}
      isDetailItem={true}
      eventSecondDescription="Started 18:02 UTC"
      eventTimeline={[
        {
          date: new Date("2026-09-14T18:12:00Z"),
          type: TimelineItemType.Note,
          icon: IconProp.Chat,
          iconColor: new Color("#64748b"),
          note: "Our payment provider wrote:",
        },
      ]}
    />,
  );
}

describe("a status page update's note", () => {
  /*
   * First: React warns about each nesting only once per run, so a render
   * before this one would have used its warning up.
   */
  test("renders without a DOM nesting warning", () => {
    const consoleError: SpyInstance<typeof console.error> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    renderUpdateWithNote();

    const nestingWarnings: Array<string> = consoleError.mock.calls
      .map((call: Array<unknown>): string => {
        return call.map(String).join(" ");
      })
      .filter((message: string): boolean => {
        return message.includes("validateDOMNesting");
      });

    expect(nestingWarnings).toEqual([]);
  });

  test("is drawn in a <div>, so its paragraphs, quotes and callouts sit in no <p>", () => {
    renderUpdateWithNote();

    const note: HTMLElement = screen.getByTestId("event-item-note");
    const markdown: HTMLElement = screen.getByTestId("markdown-stand-in");

    expect(note.tagName).toBe("DIV");
    expect(note).toContainElement(markdown);
    expect(markdown.parentElement?.closest("p")).toBeNull();

    for (const block of Array.from(
      markdown.querySelectorAll("p, blockquote, div"),
    )) {
      expect(block.parentElement?.closest("p")).toBeNull();
    }

    expect(markdown).toHaveTextContent("Our payment provider wrote:");
  });
});
