import React from "react";
import MarkdownEditor from "../../../UI/Components/Markdown.tsx/MarkdownEditor";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "@jest/globals";

describe("MarkdownEditor with SpellCheck", () => {
  test("should enable spell check by default", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with speling errors"
        placeholder="Enter markdown here..."
      />
    );
    
    const textarea = screen.getByRole("textbox");
    expect(textarea.spellcheck).toBe(true);
  });

  test("should disable spell check when disableSpellCheck is true", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with speling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={true}
      />
    );
    
    const textarea = screen.getByRole("textbox");
    expect(textarea.spellcheck).toBe(false);
  });

  test("should handle spell check prop changes", () => {
    const { rerender } = render(
      <MarkdownEditor
        initialValue="This is a test with speling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={false}
      />
    );
    
    let textarea = screen.getByRole("textbox");
    expect(textarea.spellcheck).toBe(true);

    rerender(
      <MarkdownEditor
        initialValue="This is a test with speling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={true}
      />
    );
    
    textarea = screen.getByRole("textbox");
    expect(textarea.spellcheck).toBe(false);
  });
});
