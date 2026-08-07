import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const markdownViewerMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Markdown.tsx/MarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      markdownViewerMock(props);
      return React.createElement("div", {}, props.text);
    },
  };
});

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: ConfirmModalProps): React.ReactElement => {
      return React.createElement("div", { role: "dialog" }, props.description);
    },
  };
});

import FeedItem from "../../../UI/Components/Feed/FeedItem";
import { Blue500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";

interface MarkdownViewerProps {
  text: string;
  safeMode?: boolean | undefined;
}

interface ConfirmModalProps {
  description: React.ReactElement;
}

afterEach(() => {
  cleanup();
  markdownViewerMock.mockReset();
});

describe("FeedItem safe markdown", () => {
  test("applies safe mode to both the feed body and More Information modal", () => {
    render(
      <FeedItem
        key="ai-root-cause"
        textInMarkdown="[Primary link](https://example.com/primary)"
        moreTextInMarkdown="![Secondary image](https://example.com/image.png)"
        itemDateTime={new Date("2026-08-07T12:00:00.000Z")}
        icon={IconProp.Sparkles}
        color={Blue500}
        safeMode={true}
        isLastItem={true}
      />,
    );

    expect(markdownViewerMock).toHaveBeenCalledWith({
      text: "[Primary link](https://example.com/primary)",
      safeMode: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "More Information" }));

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(markdownViewerMock).toHaveBeenCalledWith({
      text: "![Secondary image](https://example.com/image.png)",
      safeMode: true,
    });
  });
});
