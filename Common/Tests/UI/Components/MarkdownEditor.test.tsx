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

  test("should default to WYSIWYG and toggle to markdown source", () => {
    render(
      <MarkdownEditor
        initialValue="**bold text**"
        placeholder="Enter markdown here..."
      />,
    );

    // Default mode shows a toggle button labelled "Markdown" — the
    // button-role query disambiguates from the help text which also
    // mentions "Markdown".
    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Markdown",
    });
    expect(toggle).toBeInTheDocument();

    // Switch to markdown source mode.
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: "Visual" }),
    ).toBeInTheDocument();

    // Switch back to WYSIWYG.
    fireEvent.click(screen.getByRole("button", { name: "Visual" }));
    expect(
      screen.getByRole("button", { name: "Markdown" }),
    ).toBeInTheDocument();
  });

  test("should enable spell check by default", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
      />,
    );

    const editor: HTMLElement = screen.getByRole("textbox");
    /*
     * jsdom doesn't reflect the spellcheck IDL property reliably, so assert
     * the attribute that React renders.
     */
    expect(editor.getAttribute("spellcheck")).toBe("true");
  });

  test("should enable spell check when disableSpellCheck is undefined", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={undefined}
      />,
    );

    const editor: HTMLElement = screen.getByRole("textbox");
    expect(editor.getAttribute("spellcheck")).toBe("true");
  });

  test("should disable spell check when disableSpellCheck is true", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={true}
      />,
    );

    const editor: HTMLElement = screen.getByRole("textbox");
    expect(editor.getAttribute("spellcheck")).toBe("false");
  });

  test("should handle spell check prop changes", () => {
    const { rerender } = render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={false}
      />,
    );

    let editor: HTMLElement = screen.getByRole("textbox");
    expect(editor.getAttribute("spellcheck")).toBe("true");

    rerender(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={true}
      />,
    );

    editor = screen.getByRole("textbox");
    expect(editor.getAttribute("spellcheck")).toBe("false");
  });

  test("should show help text", () => {
    render(
      <MarkdownEditor initialValue="" placeholder="Enter markdown here..." />,
    );

    expect(screen.getByText("Formatting help")).toBeInTheDocument();
  });

  test("should handle onChange callback in markdown mode", () => {
    const mockOnChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue=""
        placeholder="Enter markdown here..."
        onChange={mockOnChange}
      />,
    );

    // Switch to markdown source mode so we can drive the textarea directly.
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));

    const textarea: HTMLElement = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "new text" } });

    expect(mockOnChange).toHaveBeenCalledWith("new text");
  });
});
