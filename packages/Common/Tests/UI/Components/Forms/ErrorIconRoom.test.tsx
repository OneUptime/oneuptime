import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import React from "react";
import Input from "../../../../UI/Components/Input/Input";
import TextArea from "../../../../UI/Components/TextArea/TextArea";
import MarkdownEditor from "../../../../UI/Components/Markdown.tsx/MarkdownEditor";

/*
 * ROOM FOR THE ERROR'S ICON.
 *
 * A field in error draws a red icon at its end and keeps 40px there (pr-10),
 * so what is typed never runs under it. Each field asked for pr-10 beside
 * its own pr-3, and Tailwind's stylesheet writes pr-3 after pr-10, so pr-3
 * won: a long value ran under the icon, and on a Persian page an English
 * value - which starts at the left, where the icon is - started under it.
 * A field now asks for one or the other, never both.
 */

const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return (element.getAttribute("class") || "")
    .split(" ")
    .filter((name: string): boolean => {
      return name.length > 0;
    });
};

const expectRoomForTheIcon: (element: Element) => void = (
  element: Element,
): void => {
  expect(classesOf(element)).toContain("pr-10");
  expect(classesOf(element)).not.toContain("pr-3");
};

const expectNoRoomForAnIcon: (element: Element) => void = (
  element: Element,
): void => {
  expect(classesOf(element)).toContain("pr-3");
  expect(classesOf(element)).not.toContain("pr-10");
};

afterEach(() => {
  cleanup();
});

describe("a text field", () => {
  test("in error keeps room at its end for the icon, and only that", () => {
    render(<Input onChange={() => {}} error="Promo code is invalid." />);

    expectRoomForTheIcon(screen.getByRole("textbox"));
  });

  test("with nothing wrong keeps its usual padding", () => {
    render(<Input onChange={() => {}} />);

    expectNoRoomForAnIcon(screen.getByRole("textbox"));
  });

  test("drawn with classes of its own keeps them, and the room for the icon", () => {
    render(
      <Input
        onChange={() => {}}
        className="block w-full rounded-md border px-2 py-1"
        error="Promo code is invalid."
      />,
    );

    const classes: Array<string> = classesOf(screen.getByRole("textbox"));

    expect(classes).toEqual(
      expect.arrayContaining(["block", "w-full", "px-2", "pr-10"]),
    );
  });
});

describe("a long text", () => {
  test("in error keeps room at its end for the icon, and only that", () => {
    render(<TextArea onChange={() => {}} error="Rollback note is too long." />);

    expectRoomForTheIcon(screen.getByRole("textbox"));
  });

  test("with nothing wrong keeps its usual padding", () => {
    render(<TextArea onChange={() => {}} />);

    expectNoRoomForAnIcon(screen.getByRole("textbox"));
  });
});

describe("a note's editor", () => {
  test("in error keeps room at its end for the icon, and only that", () => {
    const { container } = render(
      <MarkdownEditor
        initialValue="Customers cannot pay."
        error="Description is too long."
      />,
    );

    const editor: Element | null =
      container.querySelector(".oneuptime-wysiwyg");

    expect(editor).not.toBeNull();
    expectRoomForTheIcon(editor!);
  });

  test("with nothing wrong keeps its usual padding", () => {
    const { container } = render(
      <MarkdownEditor initialValue="Customers cannot pay." />,
    );

    const editor: Element | null =
      container.querySelector(".oneuptime-wysiwyg");

    expect(editor).not.toBeNull();
    expectNoRoomForAnIcon(editor!);
  });
});
