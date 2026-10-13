import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const markdownViewerMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      markdownViewerMock(props);
      return React.createElement("div", {}, props.text);
    },
  };
});

import FeedItem, { FeedItemProps } from "../../../UI/Components/Feed/FeedItem";
import { Blue500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import User from "../../../Models/DatabaseModels/User";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { FeedTimelineEntry } from "../../../UI/Components/Feed/FeedTimeline";

interface MarkdownViewerProps {
  text: string;
  safeMode?: boolean | undefined;
}

/*
 * An AI investigation's entry is model-written Markdown: every piece of it
 * the feed draws - the sentence after a name, the body, the details that
 * unfold - goes through the viewer in safe mode, so no link in it is
 * clickable and no image is fetched.
 */

const entry: (item: FeedItemProps) => FeedTimelineEntry<FeedItemProps> = (
  item: FeedItemProps,
): FeedTimelineEntry<FeedItemProps> => {
  return {
    item,
    time: {
      label: "3:25 PM",
      isShown: true,
      fullLabel: "Tuesday, October 13, 2026 at 3:25:00 PM GMT+08",
      isoString: "2026-10-13T07:25:00.000Z",
    },
    isInBurst: false,
  };
};

afterEach(() => {
  cleanup();
  markdownViewerMock.mockReset();
});

describe("FeedItem safe markdown", () => {
  test("applies safe mode to the body and to the details that unfold", () => {
    render(
      <FeedItem
        entry={entry({
          key: "ai-root-cause",
          textInMarkdown: "[Primary link](https://example.com/primary)",
          moreTextInMarkdown:
            "![Secondary image](https://example.com/image.png)",
          itemDateTime: new Date("2026-10-13T07:25:00.000Z"),
          icon: IconProp.Sparkles,
          color: Blue500,
          safeMode: true,
          detailsLabel: "Show the full report",
        })}
        isLastInDay={true}
      />,
    );

    expect(markdownViewerMock).toHaveBeenCalledWith({
      text: "[Primary link](https://example.com/primary)",
      safeMode: true,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Show the full report" }),
    );

    expect(screen.getByTestId("feed-entry-details")).toBeVisible();
    expect(markdownViewerMock).toHaveBeenCalledWith({
      text: "![Secondary image](https://example.com/image.png)",
      safeMode: true,
    });
  });

  test("applies safe mode to the sentence that follows a name", () => {
    const user: User = new User();
    user.id = ObjectID.generate();
    user.name = new Name("Nitin Kumar");

    render(
      <FeedItem
        entry={entry({
          key: "lead",
          textInMarkdown:
            "posted [a link](https://example.com/x):\n\nAnd a body.",
          itemDateTime: new Date("2026-10-13T07:25:00.000Z"),
          icon: IconProp.Lock,
          color: Blue500,
          user,
          safeMode: true,
        })}
        isLastInDay={true}
      />,
    );

    expect(markdownViewerMock).toHaveBeenCalledWith({
      text: "posted [a link](https://example.com/x):",
      safeMode: true,
    });
    expect(markdownViewerMock).toHaveBeenCalledWith({
      text: "And a body.",
      safeMode: true,
    });
  });

  test("everything else is drawn without safe mode", () => {
    render(
      <FeedItem
        entry={entry({
          key: "note",
          textInMarkdown: "Owners were notified.",
          moreTextInMarkdown: "- [Nitin](https://example.com/u)",
          itemDateTime: new Date("2026-10-13T07:25:00.000Z"),
          icon: IconProp.Bell,
          color: Blue500,
        })}
        isLastInDay={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

    for (const call of markdownViewerMock.mock.calls) {
      expect((call[0] as MarkdownViewerProps).safeMode).toBe(false);
    }
  });
});
