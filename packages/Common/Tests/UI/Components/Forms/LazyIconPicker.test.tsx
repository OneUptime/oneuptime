import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import IconPicker from "../../../../UI/Components/Forms/Fields/IconPicker";
import LazyIconPicker, {
  ICON_PLACEHOLDER_BOX_CLASS,
  ICON_PLACEHOLDER_CLEAR_CLASS,
  ICON_PLACEHOLDER_NONE_CLASS,
  ICON_PLACEHOLDER_PREVIEW_CLASS,
  ICON_PLACEHOLDER_TEXT_BOX_CLASS,
} from "../../../../UI/Components/Forms/Fields/LazyIconPicker";
import IconProp from "../../../../Types/Icon/IconProp";
import { LazyLibrary } from "../../../../UI/Utils/LazyLibrary";

/*
 * THE ICON FIELD IS A FILE OF ITS OWN (LazyIconPicker): every page with a
 * form reaches FormField, and the public pages' forms - the sign-in pages',
 * a status page's, a public dashboard's - pick no icon
 * (packages/Common/Scripts/first-load-budgets.js). Until the field arrives,
 * its place draws its box - the picked icon or the dashed square of none,
 * its name or the placeholder, and the cross that clears it - by the field's
 * own classes, so nothing moves when it does. These hold the field's file
 * back until the test lets it arrive.
 */

interface HeldLoad {
  library: LazyLibrary<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const realLoad: () => Promise<unknown> = LazyLibrary.prototype.load;

let held: Array<HeldLoad> = [];

const arrive: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    while (held.length > 0) {
      const load: HeldLoad = held.shift() as HeldLoad;

      realLoad.call(load.library).then(load.resolve, load.reject);

      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
};

// A class a part of the box takes its size or its place from.
const SIZE_CLASS: RegExp =
  /^(flex|block|items-center|justify-center|border|w-full|[hw]-\d+|p[lrxy]?-\d+|text-sm|sm:text-sm)$/;

// The classes a part of the box takes its size from, out of all it has.
const sizeClassesOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return className
    .split(/\s+/)
    .filter((name: string): boolean => {
      return SIZE_CLASS.test(name);
    })
    .sort();
};

// The parts of the field's box, as the field draws it.
interface FieldParts {
  box: HTMLElement;
  preview: HTMLElement;
  textBox: HTMLElement;
  input: HTMLInputElement;
  clear: HTMLElement | null;
}

const fieldPartsOf: (dataTestId: string) => FieldParts = (
  dataTestId: string,
): FieldParts => {
  const input: HTMLInputElement = screen.getByTestId(
    dataTestId,
  ) as HTMLInputElement;
  const textBox: HTMLElement = input.parentElement as HTMLElement;
  const box: HTMLElement = textBox.parentElement as HTMLElement;

  return {
    box,
    preview: box.firstElementChild as HTMLElement,
    textBox,
    input,
    clear: box.querySelector("button"),
  };
};

beforeEach(() => {
  held = [];

  jest.spyOn(LazyLibrary.prototype, "getLoaded").mockReturnValue(null);

  jest.spyOn(LazyLibrary.prototype, "load").mockImplementation(function (
    this: LazyLibrary<unknown>,
  ): Promise<unknown> {
    return new Promise(
      (
        resolve: (value: unknown) => void,
        reject: (error: unknown) => void,
      ): void => {
        held.push({ library: this, resolve, reject });
      },
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a form's icon field, until its file arrives", () => {
  test("draws its box: the dashed square of no icon and the placeholder", () => {
    render(
      <LazyIconPicker
        onChange={(): void => {}}
        placeholder="Pick an icon"
        isPlaceholderTranslated={true}
      />,
    );

    expect(screen.getByTestId("icon-picker-placeholder")).toHaveAttribute(
      "data-load-state",
      "loading",
    );
    expect(
      screen.getByTestId("icon-picker-placeholder-none"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("icon-picker-placeholder-text"),
    ).toHaveTextContent("Pick an icon");
    // Nothing to clear.
    expect(
      screen.queryByTestId("icon-picker-placeholder-clear"),
    ).not.toBeInTheDocument();
  });

  test("draws the icon it is opened on, its name and the cross that clears it", () => {
    render(
      <LazyIconPicker
        onChange={(): void => {}}
        placeholder="Pick an icon"
        isPlaceholderTranslated={true}
        initialValue={IconProp.Bell}
      />,
    );

    expect(
      screen.queryByTestId("icon-picker-placeholder-none"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("icon-picker-placeholder-text"),
    ).toHaveTextContent(IconProp.Bell);
    expect(
      screen.getByTestId("icon-picker-placeholder-clear"),
    ).toBeInTheDocument();
  });

  test("takes the field's box, the field's preview and the field's room for the text", () => {
    render(
      <IconPicker
        onChange={(): void => {}}
        placeholder="Pick an icon"
        isPlaceholderTranslated={true}
        dataTestId="role-icon"
      />,
    );

    const empty: FieldParts = fieldPartsOf("role-icon");

    expect(empty.box.className).toBe(ICON_PLACEHOLDER_BOX_CLASS);
    expect(sizeClassesOf(empty.preview.className)).toEqual(
      sizeClassesOf(ICON_PLACEHOLDER_PREVIEW_CLASS),
    );
    expect((empty.preview.firstElementChild as HTMLElement).className).toBe(
      ICON_PLACEHOLDER_NONE_CLASS,
    );
    expect(sizeClassesOf(empty.textBox.className)).toEqual(
      sizeClassesOf(ICON_PLACEHOLDER_TEXT_BOX_CLASS),
    );
    // The text itself sits as far in: the field's input takes the same room.
    expect(sizeClassesOf(empty.input.className)).toEqual(
      sizeClassesOf(ICON_PLACEHOLDER_TEXT_BOX_CLASS),
    );

    cleanup();
    render(
      <IconPicker
        onChange={(): void => {}}
        placeholder="Pick an icon"
        isPlaceholderTranslated={true}
        initialValue={IconProp.Bell}
        dataTestId="role-icon"
      />,
    );

    const picked: FieldParts = fieldPartsOf("role-icon");

    expect(picked.input.value).toBe(IconProp.Bell);
    expect(picked.clear).not.toBeNull();
    expect(sizeClassesOf((picked.clear as HTMLElement).className)).toEqual(
      sizeClassesOf(ICON_PLACEHOLDER_CLEAR_CLASS),
    );
  });

  test("says the field's error under its place", () => {
    render(
      <LazyIconPicker
        onChange={(): void => {}}
        placeholder="Pick an icon"
        isPlaceholderTranslated={true}
        error="An icon is required."
      />,
    );

    expect(screen.getByTestId("icon-picker-placeholder")).toHaveTextContent(
      "An icon is required.",
    );
  });
});

describe("once its file arrives", () => {
  test("is the field, with what the form hands it", async () => {
    render(
      <LazyIconPicker
        onChange={(): void => {}}
        placeholder="Pick an icon"
        isPlaceholderTranslated={true}
        initialValue={IconProp.Bell}
        dataTestId="role-icon"
      />,
    );

    expect(held).toHaveLength(1);

    await arrive();

    expect(screen.getByTestId("role-icon")).toHaveValue(IconProp.Bell);
    expect(
      screen.queryByTestId("icon-picker-placeholder"),
    ).not.toBeInTheDocument();
  });

  test("a file that does not arrive is said in the field's place", async () => {
    render(
      <LazyIconPicker
        onChange={(): void => {}}
        placeholder="Pick an icon"
        isPlaceholderTranslated={true}
      />,
    );

    await act(async () => {
      held.shift()!.reject(new Error("Loading chunk 12 failed."));
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(screen.getByTestId("icon-picker-placeholder")).toHaveAttribute(
      "data-load-state",
      "failed",
    );
  });
});
