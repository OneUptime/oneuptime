import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import LayersSaveBar, {
  LAYERS_SAVE_BAR_ACTIONS_CLASS_NAME,
  LAYERS_SAVE_BAR_BUTTON_CLASS_NAME,
  LayersSaveStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayersSaveBar";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * THE LAYERS PAGE'S BAR ON A PHONE (issue #7575).
 *
 * The bar at the foot of a schedule's Layers page stays in view as the page
 * scrolls, over the layers being changed. On a phone, and beside a record
 * page's side menu, its buttons stacked one above the other, each as wide
 * as the bar: with three changes named, the bar covered a third of a
 * phone's screen. Now they share one row under the words, half the bar
 * each, and a button takes a row of its own only when a language's words
 * do not fit both. From 40rem wide they sit beside the words, each as wide
 * as its words.
 *
 * jsdom lays nothing out, so this pins the classes that do it on every
 * button the bar shows. The browser check is the Layers page harness's
 * screenshots at 390px, and at 768px beside the side menu, in English,
 * German, French and Arabic.
 */

// A state of the bar: what it is drawn as, and the buttons it offers.
interface BarState {
  status: LayersSaveStatus;
  testId: string;
  buttons: ReadonlyArray<string>;
}

const BAR_STATES: ReadonlyArray<BarState> = [
  {
    status: { kind: "idle" },
    testId: "layers-save-bar",
    buttons: ["layers-save-bar-discard", "layers-save-bar-save"],
  },
  {
    status: { kind: "saving" },
    testId: "layers-save-bar",
    buttons: ["layers-save-bar-discard", "layers-save-bar-save"],
  },
  {
    status: {
      kind: "error",
      message:
        "You do not have permission to take people out of this schedule's layers.",
    },
    testId: "layers-save-bar",
    buttons: ["layers-save-bar-discard", "layers-save-bar-save"],
  },
  {
    status: { kind: "conflict" },
    testId: "layers-save-bar-conflict",
    buttons: ["layers-save-bar-reload"],
  },
  {
    status: {
      kind: "reloadFailed",
      message: "The layers could not be loaded.",
    },
    testId: "layers-save-bar-reload-failed",
    buttons: ["layers-save-bar-reload"],
  },
];

function classesOf(element: Element): Array<string> {
  return Array.from(element.classList);
}

function drawBar(status: LayersSaveStatus): void {
  render(
    <LayersSaveBar
      hasUnsavedChanges={status.kind !== "reloadFailed"}
      status={status}
      changeLines={[
        "1 user added to Primary",
        "1 user removed from Primary",
        "New turn order in Primary",
      ]}
      onSave={() => {}}
      onDiscard={() => {}}
      onReload={() => {}}
    />,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: readDashboardLocale("en") } },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

describe("the row the bar's buttons sit in", () => {
  test("wraps as a row, and is never a column of buttons as wide as the bar", () => {
    const row: Array<string> = LAYERS_SAVE_BAR_ACTIONS_CLASS_NAME.split(" ");

    expect(row).toEqual(expect.arrayContaining(["flex", "flex-wrap"]));
    expect(row).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/(^|:)grid(-|$)/)]),
    );
    expect(row).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/(^|:)flex-col$/)]),
    );
    // At the bar's end only when beside the words.
    expect(row).toContain("[@container(min-width:40rem)]:justify-end");
    expect(row).not.toContain("justify-end");
    // A dialog footer's left margin, which Button gives its buttons, goes.
    expect(row).toEqual(
      expect.arrayContaining([
        "[&>button]:ml-0",
        "[&>button]:md:ml-0",
        "[&>*>button]:ml-0",
        "[&>*>button]:md:ml-0",
      ]),
    );
  });

  test("each button takes half of a narrow bar, keeps its words on one line, and is as wide as its words in a wide one", () => {
    const button: Array<string> = LAYERS_SAVE_BAR_BUTTON_CLASS_NAME.split(" ");

    expect(button).toEqual(
      expect.arrayContaining([
        "flex-1",
        "whitespace-nowrap",
        "[@container(min-width:40rem)]:flex-none",
        "[@container(min-width:40rem)]:w-auto",
      ]),
    );
  });
});

describe.each([...BAR_STATES])("the bar, $status.kind", (state: BarState) => {
  test("lays itself out by its own width, and every button sits in the one wrapping row", () => {
    drawBar(state.status);

    const bar: HTMLElement = screen.getByTestId(state.testId);
    expect(classesOf(bar)).toContain("[container-type:inline-size]");

    const rows: Set<Element> = new Set<Element>();

    for (const testId of state.buttons) {
      const button: HTMLElement = screen.getByTestId(testId);

      expect({ testId, classes: classesOf(button) }).toEqual({
        testId,
        classes: expect.arrayContaining(
          LAYERS_SAVE_BAR_BUTTON_CLASS_NAME.split(" "),
        ),
      });

      const row: Element | null = button.closest(
        '[class~="flex-wrap"][class~="[&>button]:ml-0"]',
      );
      expect(row).not.toBeNull();
      expect(row!.className).toBe(LAYERS_SAVE_BAR_ACTIONS_CLASS_NAME);
      rows.add(row!);
    }

    expect(rows.size).toBe(1);
    // Nothing else in the bar is a button.
    expect(
      Array.from(bar.querySelectorAll("button")).map(
        (button: HTMLButtonElement): string => {
          return button.getAttribute("data-testid") || "";
        },
      ),
    ).toEqual([...state.buttons]);
  });
});
