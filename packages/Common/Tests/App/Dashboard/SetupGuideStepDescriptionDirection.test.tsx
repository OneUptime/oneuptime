import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import SetupGuideSteps from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideSteps";

/*
 * A step's gray sentence reads the way most of its letters read. On a
 * Persian page, the Developer > CLI page's "Ask for the fields you need
 * with --fields. This incident's ID is ...", not translated yet, was laid
 * out from the right: its full stop came out at the start of its last
 * line, before the ID it ends. A Persian sentence that starts with a name
 * in Latin letters ("CLI با یک کلید API ...") still reads from the right,
 * as dir="auto" would not have it.
 */

const ENGLISH: string =
  "Ask for the fields you need with --fields. This incident's ID is 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11.";
const PERSIAN: string =
  "CLI با یک کلید API پروژه وارد می‌شود. پروژه از روی کلید مشخص می‌شود.";

function descriptionOf(result: RenderResult, step: number): HTMLElement {
  return result
    .getByTestId(`setup-guide-step-${step}`)
    .querySelector("p") as HTMLElement;
}

describe("a step's description", () => {
  afterEach(() => {
    cleanup();
  });

  test("reads its own way: an English one left to right, a Persian one right to left", () => {
    const result: RenderResult = render(
      <div dir="rtl">
        <SetupGuideSteps
          steps={[
            { title: "Read it", description: ENGLISH, content: <p>Body</p> },
            {
              title: "اتصال آن به OneUptime",
              description: PERSIAN,
              content: <p>Body</p>,
            },
            { title: "No letters", description: "1234", content: <p /> },
          ]}
        />
      </div>,
    );

    expect(descriptionOf(result, 1)).toHaveAttribute("dir", "ltr");
    expect(descriptionOf(result, 1)).toHaveTextContent(ENGLISH);
    // Its first letter is Latin, most of its letters are Persian.
    expect(descriptionOf(result, 2)).toHaveAttribute("dir", "rtl");
    // No letter to read: it follows the page.
    expect(descriptionOf(result, 3)).not.toHaveAttribute("dir");
  });
});
