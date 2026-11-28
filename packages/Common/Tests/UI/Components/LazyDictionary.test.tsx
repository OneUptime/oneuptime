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
import DictionaryForm, {
  ValueType,
} from "../../../UI/Components/Dictionary/Dictionary";
import { ValueType as DictionaryValueType } from "../../../UI/Components/Dictionary/DictionaryValueType";
import LazyDictionary from "../../../UI/Components/Dictionary/LazyDictionary";
import { LazyLibrary } from "../../../UI/Utils/LazyLibrary";

/*
 * THE KEY/VALUE EDITOR IS A FILE OF ITS OWN (LazyDictionary): every page with
 * a form reaches FormField, and the public pages' forms - the sign-in pages',
 * a status page's, a public dashboard's - hold no key/value list
 * (packages/Common/Scripts/first-load-budgets.js). The editor opens on its
 * Add button alone - its rows come in once it has read the field's value -
 * and that is what its place draws until it arrives. These hold its file
 * back until the test lets it arrive.
 */

// A class a button takes its size from.
const BUTTON_SIZE_CLASS: RegExp =
  /^(p[xy]?-|h-|text-|gap-|inline-flex|rounded)/;

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

describe("a form's key/value list, until its file arrives", () => {
  test("draws the editor's first frame: its Add button, which cannot be pressed yet", () => {
    render(
      <LazyDictionary
        addButtonSuffix="Header"
        initialValue={{ "X-Team": "payments" }}
      />,
    );

    expect(screen.getByTestId("dictionary-placeholder")).toHaveAttribute(
      "data-load-state",
      "loading",
    );
    expect(
      screen.getByRole("button", { name: "Add Header", hidden: true }),
    ).toBeDisabled();
    expect(screen.queryByTestId("dictionary-row")).not.toBeInTheDocument();
  });

  test("the same first frame as the editor's own", () => {
    render(
      <LazyDictionary
        addButtonSuffix="Header"
        initialValue={{ "X-Team": "payments" }}
      />,
    );

    const placeholderButton: HTMLElement = screen.getByRole("button", {
      name: "Add Header",
      hidden: true,
    });
    const placeholderClasses: string = placeholderButton.className;

    cleanup();

    // The editor itself as it opens: no rows yet, its Add button.
    render(<DictionaryForm addButtonSuffix="Header" />);

    const editorButton: HTMLElement = screen.getByRole("button", {
      name: "Add Header",
    });

    expect(editorButton.parentElement).toHaveClass("mt-4");
    expect(placeholderButton.parentElement).toHaveClass("mt-4");
    // Pressable or not, the same button: the same size classes.
    expect(
      placeholderClasses
        .split(/\s+/)
        .filter((name: string): boolean => {
          return BUTTON_SIZE_CLASS.test(name);
        })
        .sort(),
    ).toEqual(
      editorButton.className
        .split(/\s+/)
        .filter((name: string): boolean => {
          return BUTTON_SIZE_CLASS.test(name);
        })
        .sort(),
    );
  });

  test("read-only, it says None, as the editor does with no rows", () => {
    render(<LazyDictionary readOnly={true} />);

    expect(screen.getByTestId("dictionary-placeholder")).toHaveTextContent(
      "None",
    );
  });

  test("the kinds of value a row holds are read from a module of their own, as from the editor", () => {
    expect(DictionaryValueType).toBe(ValueType);
  });
});

describe("once its file arrives", () => {
  test("is the editor, with the field's rows", async () => {
    render(
      <LazyDictionary
        addButtonSuffix="Header"
        initialValue={{ "X-Team": "payments" }}
      />,
    );

    expect(held).toHaveLength(1);

    await arrive();

    expect(screen.getAllByTestId("dictionary-row")).toHaveLength(1);
    expect(
      screen.queryByTestId("dictionary-placeholder"),
    ).not.toBeInTheDocument();
  });

  test("a file that does not arrive is said in the field's place", async () => {
    render(<LazyDictionary addButtonSuffix="Header" />);

    await act(async () => {
      held.shift()!.reject(new Error("Loading chunk 12 failed."));
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(screen.getByTestId("dictionary-placeholder")).toHaveAttribute(
      "data-load-state",
      "failed",
    );
  });
});
