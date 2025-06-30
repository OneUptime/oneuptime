import React from "react";
import MarkdownEditor from "../../../UI/Components/Markdown.tsx/MarkdownEditor";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "@jest/globals";

describe("MarkdownEditor with SpellCheck", () => {
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
    expect(textarea.spellcheck).toBe(true);
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
    expect(textarea.spellcheck).toBe(false);
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
    expect(textarea.spellcheck).toBe(true);

    rerender(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={true}
      />,
    );

    textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.spellcheck).toBe(false);
  });
});
