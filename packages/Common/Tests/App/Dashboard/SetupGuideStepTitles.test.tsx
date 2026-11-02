import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import SetupGuideSteps from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideSteps";

/*
 * A step's title beside its number. The title was one 36px line of text
 * (leading-9), the number circle's height, so its first line sat centred
 * on the number - and every further line of a title that wraps (a phone,
 * the upgrade dialog, German's "Die neuesten Images abrufen und den Agent
 * neu erstellen") came 36px under it, a gap that read as two headings.
 * The title is now as tall as the number for one line - 6px above and
 * below a 24px line - and wraps at the text's own line height.
 */

// Tailwind's spacing scale: 1 unit is 4px.
const TAILWIND_UNIT_PX: number = 4;

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(" ").filter(Boolean);
}

// The pixels a Tailwind spacing class gives, "h-9" -> 36.
function pixelsOf(classes: Array<string>, prefix: string): number {
  const found: string | undefined = classes.find((name: string): boolean => {
    return name.startsWith(prefix);
  });

  expect(found).toBeDefined();

  return Number(found!.substring(prefix.length)) * TAILWIND_UNIT_PX;
}

function renderSteps(): RenderResult {
  return render(
    <SetupGuideSteps
      steps={[
        {
          title:
            "Die neuesten Images abrufen und den Agent neu erstellen, auch wenn der Titel lang ist",
          content: <p>Body</p>,
        },
        { title: "Verify", content: <p>Body</p> },
      ]}
    />,
  );
}

describe("a step's title beside its number", () => {
  afterEach(() => {
    cleanup();
  });

  test("is as tall as the number for one line, its text centred on it", () => {
    const result: RenderResult = renderSteps();
    const step: HTMLElement = result.getByTestId("setup-guide-step-1");
    const title: HTMLElement = step.querySelector("h3") as HTMLElement;
    const number: HTMLElement = step.querySelector(
      "div[aria-hidden='true']",
    ) as HTMLElement;
    const titleClasses: Array<string> = classesOf(title);

    expect(number).toHaveTextContent("1");
    expect(
      pixelsOf(titleClasses, "py-") * 2 + pixelsOf(titleClasses, "leading-"),
    ).toBe(pixelsOf(classesOf(number), "h-"));
  });

  test("wraps at the text's own line height, not one number's height a line", () => {
    const result: RenderResult = renderSteps();
    const titleClasses: Array<string> = classesOf(
      result.getByTestId("setup-guide-step-1").querySelector("h3")!,
    );

    expect(titleClasses).toContain("leading-6");
    expect(titleClasses).not.toContain("leading-9");
  });

  test("still tells a screen reader which step it is", () => {
    const result: RenderResult = renderSteps();

    expect(
      result.getByTestId("setup-guide-step-2").querySelector("h3"),
    ).toHaveTextContent("Step 2: Verify");
  });
});
