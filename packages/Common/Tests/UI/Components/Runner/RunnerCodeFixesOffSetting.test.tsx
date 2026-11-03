import "@testing-library/jest-dom";
import { describe, expect, test } from "@jest/globals";
import { RenderResult, render } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import RunnerCodeFixesOffSetting, {
  RUNNER_CODE_FIXES_OFF_SETTING_CLASS_NAME,
  RUNNER_CODE_FIXES_OFF_SETTING_TEST_ID,
} from "../../../../UI/Components/Runner/RunnerCodeFixesOffSetting";
import {
  RUNNER_CODE_FIXES_OFF_SETTING,
  RUNNER_CODE_FIXES_SETTING_NAME,
} from "../../../../Types/Runner/RunnerCodeFixes";

/*
 * THE SETTING THAT TURNS A RUNNER'S AI CODE FIXES OFF, IN A SENTENCE.
 *
 * Code's notice, a repository's Runner card and picker, a Runner's own page
 * and the Admin Dashboard's Global Runners name the setting a Runner's host
 * turned AI code fixes off with. It is one word of 40 letters, wider than a
 * phone's notice: written into the sentence, it broke at whatever letter
 * filled the line ("..._CODE_FIXES=fals" / "e", "..._CODE_FIX" / "ES=false").
 * Drawn here, it is code that breaks only after its underscores, reads as
 * written when copied, and is the sentence's {{setting}} value - so no
 * translation writes it out, and none can change it.
 */

const REPOSITORY: string = path.resolve(__dirname, "../../../../../..");

describe("the setting", () => {
  test("is the one the Runner reads, set to false", () => {
    expect(RUNNER_CODE_FIXES_SETTING_NAME).toBe(
      "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES",
    );
    expect(RUNNER_CODE_FIXES_OFF_SETTING).toBe(
      "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false",
    );

    const config: string = fs.readFileSync(
      path.join(REPOSITORY, "packages/Runner/Config.ts"),
      "utf8",
    );

    expect(config).toContain(
      `process.env["${RUNNER_CODE_FIXES_SETTING_NAME}"]`,
    );
  });
});

describe("RunnerCodeFixesOffSetting", () => {
  function draw(): HTMLElement {
    const view: RenderResult = render(<RunnerCodeFixesOffSetting />);

    return view.getByTestId(RUNNER_CODE_FIXES_OFF_SETTING_TEST_ID);
  }

  test("is code, and copies as the setting exactly", () => {
    const setting: HTMLElement = draw();

    expect(setting.tagName).toBe("CODE");
    expect(setting.textContent).toBe(RUNNER_CODE_FIXES_OFF_SETTING);
  });

  test("may break only after an underscore, never inside a word", () => {
    const setting: HTMLElement = draw();
    const parts: Array<HTMLElement> = Array.from(
      setting.querySelectorAll("span"),
    );

    expect(
      parts.map((part: HTMLElement): string => {
        return part.textContent || "";
      }),
    ).toEqual(["ONEUPTIME_", "RUNNER_", "ENABLE_", "CODE_", "FIXES=false"]);

    // One place to break after each part but the last.
    expect(setting.querySelectorAll("wbr")).toHaveLength(parts.length - 1);

    for (const wbr of Array.from(setting.querySelectorAll("wbr"))) {
      expect(wbr.previousSibling?.textContent?.endsWith("_")).toBe(true);
    }

    for (const part of parts) {
      expect(part).toHaveClass("whitespace-nowrap");
      expect(part).toHaveClass("font-mono");
    }
  });

  /*
   * In the colour of the sentence it is in (amber, every place it is
   * drawn), on a tint the dark theme redraws; each line a wrapped setting
   * takes keeps its own padding and rounded ends.
   */
  test("sits on an amber tint the dark theme redraws, a little smaller than the words around it", () => {
    const setting: HTMLElement = draw();

    for (const name of RUNNER_CODE_FIXES_OFF_SETTING_CLASS_NAME.split(" ")) {
      expect(setting).toHaveClass(name);
    }

    expect(setting).toHaveClass("bg-amber-100");
    expect(setting).toHaveClass("box-decoration-clone");
    // No colour of its own: the sentence's amber reads in both themes.
    expect(
      RUNNER_CODE_FIXES_OFF_SETTING_CLASS_NAME.split(" ").filter(
        (name: string): boolean => {
          return name.startsWith("text-") && !name.startsWith("text-[");
        },
      ),
    ).toEqual([]);

    const theme: string = fs.readFileSync(
      path.join(REPOSITORY, "packages/Common/UI/Styles/Theme.css"),
      "utf8",
    );
    const darkAmberTints: string =
      theme.split("html.dark :is(\n    .bg-amber-50,\n    .bg-amber-100,")[1] ||
      "";

    expect(darkAmberTints).not.toBe("");
  });
});
