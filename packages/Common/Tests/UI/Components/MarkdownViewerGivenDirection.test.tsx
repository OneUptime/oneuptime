import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import MarkdownViewer from "../../../UI/Components/Markdown.tsx/MarkdownViewer";

/*
 * A text whose writer knows its direction (MarkdownViewer's
 * readingDirection) - the UI review of #6149.
 *
 * The environment setup guide is worded whole in the reader's language. In
 * Persian, its step that walks the AWS console names more English labels
 * ("AWS Console -> Amazon Elastic Container Service -> Task definitions")
 * than it has Persian words, and the viewer, which lays a note out the way
 * most of its letters read, laid that step out left to right on a page
 * read from the right: its numbers on the wrong side, its sentences in the
 * wrong order. The guide says which way its words read now, and the
 * viewer lays the whole text out that way.
 *
 * Common's jest renders react-markdown's children as text, so what is read
 * here is the viewer's frame; each block's way is measured in a browser by
 * the App Platforms suite (its Documentation test).
 */

// A Persian step of the guide: more English letters than Persian ones.
const PERSIAN_STEP: string = [
  "1. **AWS Console → Amazon Elastic Container Service → Task definitions** ← خانواده را انتخاب کنید ← **Create new revision**.",
  "2. زیر کانتینر برنامهٔ خود، **Environment variables** را باز کنید.",
].join("\n");

afterEach(() => {
  cleanup();
});

function frameOf(result: RenderResult): Element {
  return result.container.firstElementChild!;
}

describe("a text whose direction its writer gave", () => {
  test("reads that way, though most of its letters read the other", () => {
    const result: RenderResult = render(
      <MarkdownViewer text={PERSIAN_STEP} readingDirection="rtl" />,
    );

    expect(frameOf(result)).toHaveAttribute("dir", "rtl");
    expect(frameOf(result)).toHaveTextContent("Create new revision");
  });

  test("left to right as given, whatever its letters", () => {
    const result: RenderResult = render(
      <MarkdownViewer text="استقرار تمام شد." readingDirection="ltr" />,
    );

    expect(frameOf(result)).toHaveAttribute("dir", "ltr");
  });

  test("without one, a text still reads the way most of its letters do - a note as someone typed it", () => {
    const result: RenderResult = render(<MarkdownViewer text={PERSIAN_STEP} />);

    // The same step, read by its letters: left to right, as it was drawn.
    expect(frameOf(result)).toHaveAttribute("dir", "ltr");

    result.rerender(<MarkdownViewer text="استقرار تمام شد." />);
    expect(frameOf(result)).toHaveAttribute("dir", "rtl");
  });
});
