import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import SetupGuideSteps from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideSteps";
import {
  UNBROKEN_FLAG_CLASS_NAME,
  withUnbrokenFlags,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/UnbrokenFlags";

/*
 * A sentence that names a command-line flag keeps the flag on one line
 * (Components/SetupGuide/UnbrokenFlags). On a phone, the Developer > CLI
 * page's "Add --help to any of them for its flags" broke into "Add --" at
 * the end of one line and "help" at the start of the next: a browser may
 * end a line after a hyphen.
 */

function flagsOf(element: HTMLElement): Array<string> {
  return Array.from(
    element.querySelectorAll(`span.${UNBROKEN_FLAG_CLASS_NAME}`),
  ).map((span: Element): string => {
    // Set apart left to right: a Persian sentence drew "--help" as "help--".
    expect(span).toHaveAttribute("dir", "ltr");

    return span.textContent || "";
  });
}

function sentence(text: string): HTMLElement {
  const result: RenderResult = render(<p>{withUnbrokenFlags(text)}</p>);

  return result.container.querySelector("p") as HTMLElement;
}

describe("a sentence that names a flag", () => {
  afterEach(() => {
    cleanup();
  });

  test("keeps each flag on one line, and every word as it was written", () => {
    const text: string =
      "Every command the CLI has for these. Add --help to any of them for its flags.";
    const shown: HTMLElement = sentence(text);

    expect(flagsOf(shown)).toEqual(["--help"]);
    expect(shown.textContent).toBe(text);
  });

  test("sets a flag apart left to right in a sentence read right to left", () => {
    const text: string =
      "همهٔ دستورهایی که CLI برای این‌ها دارد. برای دیدن پرچم‌های هر دستور، --help را به آن اضافه کنید.";
    const result: RenderResult = render(
      <p dir="rtl">{withUnbrokenFlags(text)}</p>,
    );
    const shown: HTMLElement = result.container.querySelector(
      "p",
    ) as HTMLElement;

    expect(flagsOf(shown)).toEqual(["--help"]);
    expect(shown.textContent).toBe(text);
  });

  test("keeps every flag of a sentence whole, in order", () => {
    const shown: HTMLElement = sentence("--all, or --skip and --limit");

    expect(flagsOf(shown)).toEqual(["--all", "--skip", "--limit"]);
    expect(shown.textContent).toBe("--all, or --skip and --limit");

    expect(
      flagsOf(sentence("Ask for the fields you need with --fields.")),
    ).toEqual(["--fields"]);
    expect(
      flagsOf(sentence("Set it with --incident-severity-id, not --data.")),
    ).toEqual(["--incident-severity-id", "--data"]);
  });

  test("leaves a sentence without a flag as the text it was", () => {
    for (const text of [
      "The CLI signs in with a project API key.",
      "This incident's ID is 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11.",
      "Hyphen-joined words - and a dash.",
      "",
    ]) {
      expect(withUnbrokenFlags(text)).toBe(text);
    }
  });

  test("keeps a step's flags whole, under its title", () => {
    const result: RenderResult = render(
      <SetupGuideSteps
        steps={[
          {
            title: "Read it",
            description:
              "Ask for the fields you need with --fields. This incident's ID is 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11.",
            content: <p>Body</p>,
          },
        ]}
      />,
    );
    const description: HTMLElement = result
      .getByTestId("setup-guide-step-1")
      .querySelector("p") as HTMLElement;

    expect(flagsOf(description)).toEqual(["--fields"]);
    expect(description).toHaveTextContent(
      "Ask for the fields you need with --fields. This incident's ID is 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11.",
    );
  });
});
