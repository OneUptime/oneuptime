/*
 * The keys Create a workflow and Create a dashboard answer to
 * (Utils/TemplatePicker/WizardKeys): Enter in the Name step's name goes on,
 * as the footer's button does, so a name is typed and taken without the
 * mouse - and the template picker's keys leave an input method's keys alone.
 *
 * What these pin is the Enter that must NOT go on: the one that commits the
 * characters an input method is composing (a Japanese, Chinese or Korean
 * name), which Chrome marks isComposing and Safari only with keyCode 229,
 * and the repeats of a held key, which would create one record after
 * another.
 */

import { describe, expect, test } from "@jest/globals";
import {
  WizardKeyEvent,
  isComposingKey,
  isEnterToSubmit,
} from "../../FeatureSet/Dashboard/src/Utils/TemplatePicker/WizardKeys";

type KeyFunction = (
  key: string,
  extra?: Partial<Omit<WizardKeyEvent, "nativeEvent">> & {
    isComposing?: boolean;
  },
) => WizardKeyEvent;

// A key press as React hands it over: the fields the rules read.
const press: KeyFunction = (
  key: string,
  extra: Partial<Omit<WizardKeyEvent, "nativeEvent">> & {
    isComposing?: boolean;
  } = {},
): WizardKeyEvent => {
  return {
    key: key,
    repeat: extra.repeat || false,
    // What a browser sends for Enter, and for the letters typed below.
    keyCode: extra.keyCode === undefined ? 13 : extra.keyCode,
    nativeEvent: { isComposing: extra.isComposing || false },
  };
};

describe("isEnterToSubmit", () => {
  test("a plain Enter goes on", () => {
    expect(isEnterToSubmit(press("Enter"))).toBe(true);
  });

  test("no other key does", () => {
    for (const key of ["a", " ", "Tab", "Escape", "ArrowDown", "Backspace"]) {
      expect({ key: key, goesOn: isEnterToSubmit(press(key)) }).toEqual({
        key: key,
        goesOn: false,
      });
    }
  });

  test("the Enter that commits an input method's characters does not: Chrome marks it composing", () => {
    expect(isEnterToSubmit(press("Enter", { isComposing: true }))).toBe(false);
  });

  test("nor the one Safari sends after the composition has ended, with keyCode 229", () => {
    expect(isEnterToSubmit(press("Enter", { keyCode: 229 }))).toBe(false);
  });

  test("a held Enter goes on once: its repeats do not", () => {
    expect(isEnterToSubmit(press("Enter", { repeat: true }))).toBe(false);
  });
});

describe("isComposingKey", () => {
  test("a key an input method is composing with is its own", () => {
    expect(isComposingKey(press("Enter", { isComposing: true }))).toBe(true);
    expect(isComposingKey(press("ArrowDown", { isComposing: true }))).toBe(
      true,
    );
  });

  test("keyCode 229 is an input method's too, composing or not", () => {
    expect(isComposingKey(press("Enter", { keyCode: 229 }))).toBe(true);
    expect(isComposingKey(press("Process", { keyCode: 229 }))).toBe(true);
  });

  test("an ordinary key is not", () => {
    expect(isComposingKey(press("Enter"))).toBe(false);
    expect(isComposingKey(press("ArrowUp", { keyCode: 38 }))).toBe(false);
    expect(isComposingKey(press("k", { keyCode: 75 }))).toBe(false);
  });
});
