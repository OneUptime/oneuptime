import {
  getLastInputModality,
  InputModality,
  listenForInputModality,
  wasLastInputFromKeyboard,
} from "../../../UI/Utils/InputModality";
import { fireEvent } from "@testing-library/react";
import { describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * Whether the person's last press was a key or a pointer: what tells a
 * focus the keyboard moved apart from one a script moved after a click (a
 * menu opened with the mouse focusing its first item, a closed dialog
 * handing focus back). Tooltips that show on keyboard focus only ask it
 * (Tooltip's isShownOnKeyboardFocusOnly).
 */

describe("the last press", () => {
  test("before any press, focus counts as the keyboard's, as every focus did", () => {
    /*
     * Jest loads this module fresh for this file, and nothing has been
     * pressed yet: a page that has just loaded, or a test that moves focus
     * itself, reads as before.
     */
    expect(getLastInputModality()).toBe(InputModality.Keyboard);
    expect(wasLastInputFromKeyboard()).toBe(true);
  });

  test("a pointer press - mouse, pen or finger - makes it the pointer's", () => {
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.pointerDown(document.body);

    expect(getLastInputModality()).toBe(InputModality.Pointer);
    expect(wasLastInputFromKeyboard()).toBe(false);
  });

  test("a browser that sends the mouse's press alone counts too", () => {
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.mouseDown(document.body);

    expect(wasLastInputFromKeyboard()).toBe(false);
  });

  test("a key after it makes it the keyboard's again", () => {
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(getLastInputModality()).toBe(InputModality.Keyboard);
  });

  test("a shortcut held with a modifier is not someone moving with the keys", () => {
    for (const modifier of ["metaKey", "ctrlKey", "altKey"]) {
      fireEvent.pointerDown(document.body);
      fireEvent.keyDown(document.body, { key: "c", [modifier]: true });

      expect(wasLastInputFromKeyboard()).toBe(false);
    }
  });

  test("a press whose handler stops it spreading is still heard: the listener is captured", () => {
    const stopper: HTMLButtonElement = document.createElement("button");
    stopper.addEventListener("pointerdown", (event: Event) => {
      event.stopPropagation();
    });
    document.body.appendChild(stopper);

    try {
      fireEvent.keyDown(document.body, { key: "Tab" });
      fireEvent.pointerDown(stopper);

      expect(wasLastInputFromKeyboard()).toBe(false);
    } finally {
      stopper.remove();
    }
  });

  test("listening twice adds no second listener", () => {
    const addEventListener: SpyInstance<typeof document.addEventListener> =
      jest.spyOn(document, "addEventListener");

    try {
      listenForInputModality();
      listenForInputModality();

      expect(addEventListener).not.toHaveBeenCalled();
    } finally {
      addEventListener.mockRestore();
    }
  });
});
