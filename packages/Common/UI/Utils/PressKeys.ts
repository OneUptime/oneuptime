import React from "react";

/*
 * The keys that press a control: Enter and Space, as they press a
 * `<button>`. For the few things drawn with role="button" because a button
 * cannot hold their layout (a band of an SVG diagram, a node of a canvas),
 * so a keyboard presses them the same way (#9222, #9223).
 */
export const isPressKey: (key: string) => boolean = (key: string): boolean => {
  return key === "Enter" || key === " " || key === "Spacebar";
};

/*
 * An onKeyDown that runs `press` for Enter and Space and keeps Space from
 * scrolling the page, as a native button does. Other keys pass by.
 */
export const onPressKeys: <T extends Element>(
  press: () => void,
) => (event: React.KeyboardEvent<T>) => void = <T extends Element>(
  press: () => void,
): ((event: React.KeyboardEvent<T>) => void) => {
  return (event: React.KeyboardEvent<T>): void => {
    if (!isPressKey(event.key) || event.repeat) {
      return;
    }

    event.preventDefault();
    press();
  };
};
