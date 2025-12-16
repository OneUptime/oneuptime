import React from "react";
import MarkdownEditor from "../../../UI/Components/Markdown.tsx/MarkdownEditor";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test } from "@jest/globals";

describe("MarkdownEditor", () => {
  test("should render with toolbar buttons", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test"
        placeholder="Enter markdown here..."
      />,
    );

    // Check for toolbar buttons
    expect(screen.getByTitle("Bold (Ctrl+B)")).toBeInTheDocument();
    expect(screen.getByTitle("Italic (Ctrl+I)")).toBeInTheDocument();
    expect(screen.getByTitle("Underline")).toBeInTheDocument();
    expect(screen.getByTitle("Strikethrough")).toBeInTheDocument();
    expect(screen.getByTitle("Heading 1")).toBeInTheDocument();
    expect(screen.getByTitle("Heading 2")).toBeInTheDocument();
    expect(screen.getByTitle("Heading 3")).toBeInTheDocument();
    expect(screen.getByTitle("Bullet List")).toBeInTheDocument();
    expect(screen.getByTitle("Numbered List")).toBeInTheDocument();
    expect(screen.getByTitle("Task List")).toBeInTheDocument();
    expect(screen.getByTitle("Link")).toBeInTheDocument();
    expect(screen.getByTitle("Image")).toBeInTheDocument();
    expect(screen.getByTitle("Table")).toBeInTheDocument();
    expect(screen.getByTitle("Code")).toBeInTheDocument();
    expect(screen.getByTitle("Quote")).toBeInTheDocument();
    expect(screen.getByTitle("Horizontal Rule")).toBeInTheDocument();
  });

  test("should toggle preview mode", () => {
    render(
      <MarkdownEditor
        initialValue="**bold text**"
        placeholder="Enter markdown here..."
      />,
    );

    const previewButton: HTMLElement = screen.getByText("Preview");
    fireEvent.click(previewButton);

    // Should show preview
    expect(screen.getByText("Write")).toBeInTheDocument();

    // Click to go back to write mode
    fireEvent.click(screen.getByText("Write"));
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  test("should enable spell check by default", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
      />,
    );

    const textarea: HTMLTextAreaElement = screen.getByRole(
      "textbox",
    ) as HTMLTextAreaElement;
    // jsdom doesn't properly reflect spellcheck property, so we check the attribute
    expect(textarea.getAttribute("spellcheck")).toBe("true");
  });

  test("should enable spell check when disableSpellCheck is undefined", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={undefined}
      />,
    );

    const textarea: HTMLTextAreaElement = screen.getByRole(
      "textbox",
    ) as HTMLTextAreaElement;
    expect(textarea.getAttribute("spellcheck")).toBe("true");
  });

  test("should disable spell check when disableSpellCheck is true", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={true}
      />,
    );

    const textarea: HTMLTextAreaElement = screen.getByRole(
      "textbox",
    ) as HTMLTextAreaElement;
    expect(textarea.getAttribute("spellcheck")).toBe("false");
  });

  test("should handle spell check prop changes", () => {
    const { rerender } = render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={false}
      />,
    );

    let textarea: HTMLTextAreaElement = screen.getByRole(
      "textbox",
    ) as HTMLTextAreaElement;
    expect(textarea.getAttribute("spellcheck")).toBe("true");

    rerender(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={true}
      />,
    );

    textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.getAttribute("spellcheck")).toBe("false");
  });

  test("should show help text", () => {
    render(
      <MarkdownEditor initialValue="" placeholder="Enter markdown here..." />,
    );

    expect(screen.getByText("Markdown help")).toBeInTheDocument();
  });

  test("should handle onChange callback", () => {
    const mockOnChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue=""
        placeholder="Enter markdown here..."
        onChange={mockOnChange}
      />,
    );

    const textarea: HTMLElement = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "new text" } });

    expect(mockOnChange).toHaveBeenCalledWith("new text");
  });
});
