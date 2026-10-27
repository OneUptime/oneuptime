import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import UnsavedChanges, {
  useUnsavedChanges,
} from "../../../../UI/Utils/NewVersion/UnsavedChanges";

/*
 * Nothing reloads a page that holds something the reader typed and has not
 * saved - not a new version of OneUptime, not a part that would not
 * download. What counts is read from the page itself, in every frontend, so
 * these drive real input events on real elements: typed text in a field
 * counts while it is on the page and holds text; a change anywhere in a
 * form scope counts until the form is saved or leaves; ignored fields never
 * count; and edits that are not typed are held while they are there.
 */

const type: (element: HTMLElement, value: string) => void = (
  element: HTMLElement,
  value: string,
): void => {
  fireEvent.input(element, { target: { value } });
};

beforeEach(() => {
  UnsavedChanges.reset();
  UnsavedChanges.install();
});

afterEach(() => {
  cleanup();
  UnsavedChanges.reset();
});

describe("UnsavedChanges", () => {
  test("a page nobody typed in has nothing unsaved", () => {
    render(
      <div>
        <input data-testid="name" defaultValue="Prefilled" />
        <textarea data-testid="note" />
      </div>,
    );

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test.each<[string, ReactElement]>([
    ["a text field", <input key="i" data-testid="field" />],
    ["an email field", <input key="e" type="email" data-testid="field" />],
    ["a password field", <input key="p" type="password" data-testid="field" />],
    [
      "a textarea (the AI chat, a note)",
      <textarea key="t" data-testid="field" />,
    ],
  ])("text typed into %s counts", (_label: string, element: ReactElement) => {
    const { getByTestId } = render(element);

    type(getByTestId("field"), "Half a sentence");

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  test("a field typed in and then emptied again no longer counts", () => {
    const { getByTestId } = render(<textarea data-testid="note" />);
    const note: HTMLElement = getByTestId("note");

    type(note, "Something");
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

    type(note, "   ");
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("text typed into a field that has left the page no longer counts", () => {
    const Page: FunctionComponent<{ show: boolean }> = (props: {
      show: boolean;
    }): ReactElement => {
      return props.show ? <input data-testid="field" /> : <p>Elsewhere</p>;
    };

    const { getByTestId, rerender } = render(<Page show={true} />);
    type(getByTestId("field"), "Typed");
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

    rerender(<Page show={false} />);

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test.each<[string, ReactElement]>([
    ["a checkbox", <input key="c" type="checkbox" data-testid="field" />],
    ["a radio button", <input key="r" type="radio" data-testid="field" />],
    ["a search box", <input key="s" type="search" data-testid="field" />],
    ["a range slider", <input key="g" type="range" data-testid="field" />],
  ])(
    "%s outside a form is not unsaved work (a table's select-all, a filter)",
    (_label: string, element: ReactElement) => {
      const { getByTestId } = render(element);

      fireEvent.input(getByTestId("field"), { target: { value: "on" } });
      fireEvent.change(getByTestId("field"), { target: { value: "on" } });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    },
  );

  test("a field under data-unsaved-changes-ignore never counts", () => {
    const { getByTestId } = render(
      <div data-unsaved-changes-ignore="">
        <input data-testid="filter" />
      </div>,
    );

    type(getByTestId("filter"), "monitor-1");

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("typing into a contenteditable editor counts", () => {
    const { getByTestId } = render(
      <div
        contentEditable={true}
        data-testid="editor"
        suppressContentEditableWarning
      >
        Draft
      </div>,
    );

    fireEvent.input(getByTestId("editor"));

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  describe("a form scope (BasicForm's root)", () => {
    const Form: FunctionComponent<{ show?: boolean }> = (props: {
      show?: boolean;
    }): ReactElement => {
      if (props.show === false) {
        return <p>Closed</p>;
      }

      return (
        <div data-unsaved-changes-scope="form" data-testid="form">
          <input type="checkbox" data-testid="toggle" />
          <select data-testid="pick">
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
          <input data-testid="name" />
        </div>
      );
    };

    test("any change in it counts, a toggle or a pick as much as text", () => {
      const { getByTestId } = render(<Form />);

      fireEvent.change(getByTestId("toggle"), { target: { checked: true } });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
    });

    test("a pick counts too", () => {
      const { getByTestId } = render(<Form />);

      fireEvent.change(getByTestId("pick"), { target: { value: "b" } });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
    });

    test("it counts even once the typed field is emptied: the form is still edited", () => {
      const { getByTestId } = render(<Form />);

      type(getByTestId("name"), "x");
      type(getByTestId("name"), "");

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
    });

    test("saving it (markSaved) clears it", () => {
      const { getByTestId } = render(<Form />);

      type(getByTestId("name"), "Saved name");
      UnsavedChanges.markSaved(getByTestId("form"));

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("closing it clears it: what was typed left with it", () => {
      const { getByTestId, rerender } = render(<Form />);

      type(getByTestId("name"), "Abandoned");
      rerender(<Form show={false} />);

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("markSaved also clears loose fields inside the saved form", () => {
      const { getByTestId } = render(
        <div data-testid="outer">
          <div
            contentEditable={true}
            data-testid="editor"
            suppressContentEditableWarning
          >
            Body
          </div>
        </div>,
      );

      fireEvent.input(getByTestId("editor"));
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

      UnsavedChanges.markSaved(getByTestId("outer"));

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("markSaved of nothing is a no-op", () => {
      expect(() => {
        UnsavedChanges.markSaved(null);
        UnsavedChanges.markSaved(undefined);
      }).not.toThrow();
    });
  });

  describe("held changes (useUnsavedChanges)", () => {
    const Editor: FunctionComponent = (): ReactElement => {
      const [isEditing, setIsEditing] = useState<boolean>(false);

      useUnsavedChanges(isEditing);

      return (
        <button
          type="button"
          onClick={() => {
            setIsEditing(!isEditing);
          }}
        >
          {isEditing ? "Save" : "Edit"}
        </button>
      );
    };

    test("count while held, and stop when let go", () => {
      const { getByText } = render(<Editor />);

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

      fireEvent.click(getByText("Edit"));
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

      fireEvent.click(getByText("Save"));
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("are let go when the editor leaves the page", () => {
      const { getByText, unmount } = render(<Editor />);

      fireEvent.click(getByText("Edit"));
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

      act(() => {
        unmount();
      });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("two holds are two: letting one go leaves the other", () => {
      const releaseFirst: () => void = UnsavedChanges.hold();
      const releaseSecond: () => void = UnsavedChanges.hold();

      releaseFirst();
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

      releaseSecond();
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });
  });

  describe("a page on its way out under a Suspense fallback", () => {
    const NeverLoads: React.LazyExoticComponent<FunctionComponent> = React.lazy(
      () => {
        return new Promise<{ default: FunctionComponent }>(() => {
          // The next page's code never arrives.
        });
      },
    );

    const Screen: FunctionComponent<{ next: boolean }> = (props: {
      next: boolean;
    }): ReactElement => {
      return (
        <React.Suspense fallback={<p data-testid="loader">Loading</p>}>
          {props.next ? (
            <NeverLoads />
          ) : (
            <div data-unsaved-changes-scope="form">
              <input data-testid="field" />
            </div>
          )}
        </React.Suspense>
      );
    };

    test("does not count: React keeps it hidden until the next page shows, then drops it", () => {
      const { getByTestId, rerender } = render(<Screen next={false} />);
      type(getByTestId("field"), "Typed on the page being left");
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

      act(() => {
        rerender(<Screen next={true} />);
      });

      // Still in the document, hidden: what React does with it.
      expect(getByTestId("field").isConnected).toBe(true);
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("a form folded away by the page itself (an inline display none) still counts", () => {
      const { getByTestId } = render(
        <div style={{ display: "none" }}>
          <div data-unsaved-changes-scope="form">
            <input data-testid="field" />
          </div>
        </div>,
      );

      type(getByTestId("field"), "Typed, then folded");

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
    });
  });

  test("install is idempotent: one input is heard once", () => {
    UnsavedChanges.install();
    UnsavedChanges.install();

    const { getByTestId } = render(<input data-testid="field" />);
    type(getByTestId("field"), "x");

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  test("before install nothing is heard", () => {
    UnsavedChanges.reset();

    const { getByTestId } = render(<input data-testid="field" />);
    type(getByTestId("field"), "x");

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("a field that stops its events from bubbling is still heard (capture)", () => {
    const { getByTestId } = render(
      <div
        onInput={(event: React.FormEvent) => {
          event.stopPropagation();
        }}
      >
        <input data-testid="field" />
      </div>,
    );

    getByTestId("field").addEventListener("input", (event: Event) => {
      event.stopPropagation();
    });
    type(getByTestId("field"), "x");

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  /*
   * What is typed into a search or a filter is a query: it never holds the
   * page, in a form or out of one (a picker's own search inside a form, a
   * table's filters in a dialog).
   */
  describe("a search or filter box", () => {
    const FormWithSearch: FunctionComponent = (): ReactElement => {
      return (
        <div data-unsaved-changes-scope="form" data-testid="form">
          <input type="search" data-testid="type-search" />
          <input role="searchbox" data-testid="searchbox" />
          <input data-unsaved-changes-ignore="" data-testid="marked" />
          <div data-unsaved-changes-ignore="">
            <input data-testid="under-marked" />
          </div>
          <input data-testid="name" />
        </div>
      );
    };

    test.each<[string]>([
      ["type-search"],
      ["searchbox"],
      ["marked"],
      ["under-marked"],
    ])(
      "typing into one inside a form (%s) is no change to the form",
      (testId: string) => {
        const { getByTestId } = render(<FormWithSearch />);

        type(getByTestId(testId), "checkout");
        fireEvent.change(getByTestId(testId), {
          target: { value: "checkout" },
        });

        expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
      },
    );

    test("a field of the form beside them still makes it count", () => {
      const { getByTestId } = render(<FormWithSearch />);

      type(getByTestId("type-search"), "checkout");
      type(getByTestId("name"), "Checkout API");

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
    });

    test("one outside a form never counts, however much it holds", () => {
      const { getByTestId } = render(
        <div>
          <input type="search" data-testid="a" />
          <input role="searchbox" data-testid="b" />
          <input data-unsaved-changes-ignore="" data-testid="c" />
        </div>,
      );

      for (const testId of ["a", "b", "c"]) {
        type(getByTestId(testId), "status:open owner:me");
      }

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });
  });

  /*
   * A change no input event announces: a pick from a dropdown or a picker,
   * a value a field's own control set. BasicForm notes each edit of its
   * values (noteChange), and the form counts from then on.
   */
  describe("noteChange", () => {
    test("makes the form it is in count, until the form is saved", () => {
      const { getByTestId } = render(
        <div data-unsaved-changes-scope="form" data-testid="form">
          <div data-testid="picker" />
        </div>,
      );

      UnsavedChanges.noteChange(getByTestId("picker"));
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

      UnsavedChanges.markSaved(getByTestId("form"));
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("noted on the form's own root, it counts that form", () => {
      const { getByTestId } = render(
        <div data-unsaved-changes-scope="form" data-testid="form" />,
      );

      UnsavedChanges.noteChange(getByTestId("form"));

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
    });

    test("outside any form it does nothing: a pick outside a form was never held", () => {
      const { getByTestId } = render(<div data-testid="loose-picker" />);

      UnsavedChanges.noteChange(getByTestId("loose-picker"));

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("nothing to note, or not listening yet: nothing happens", () => {
      const { getByTestId } = render(
        <div data-unsaved-changes-scope="form" data-testid="form" />,
      );

      UnsavedChanges.noteChange(null);
      UnsavedChanges.noteChange(undefined);
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

      UnsavedChanges.reset();
      UnsavedChanges.noteChange(getByTestId("form"));
      UnsavedChanges.install();

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("a form that has left the page no longer counts", () => {
      const Page: FunctionComponent<{ show: boolean }> = (props: {
        show: boolean;
      }): ReactElement => {
        return props.show ? (
          <div data-unsaved-changes-scope="form" data-testid="form" />
        ) : (
          <p>Closed</p>
        );
      };

      const { getByTestId, rerender } = render(<Page show={true} />);

      UnsavedChanges.noteChange(getByTestId("form"));
      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

      rerender(<Page show={false} />);

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });
  });

  /*
   * A long session opens and closes form after form: what it remembers of
   * the ones that left is let go as soon as anything new is noted, not
   * kept until the next time someone asks.
   */
  test("forms and fields that left the page are let go as new ones are noted", () => {
    const remembered: () => number = (): number => {
      const memory: {
        changedScopes: Set<Element>;
        typedFields: Set<Element>;
      } = UnsavedChanges as unknown as {
        changedScopes: Set<Element>;
        typedFields: Set<Element>;
      };

      return memory.changedScopes.size + memory.typedFields.size;
    };

    const Page: FunctionComponent<{ index: number }> = (props: {
      index: number;
    }): ReactElement => {
      return (
        <div key={props.index}>
          <div data-unsaved-changes-scope="form" data-testid="form" />
          <textarea data-testid="note" />
        </div>
      );
    };

    const { getByTestId, rerender } = render(<Page index={0} />);

    for (let index: number = 1; index <= 20; index++) {
      UnsavedChanges.noteChange(getByTestId("form"));
      type(getByTestId("note"), `Note ${index}`);
      rerender(<Page key={index} index={index} />);
    }

    UnsavedChanges.noteChange(getByTestId("form"));
    type(getByTestId("note"), "The last note");

    expect(remembered()).toBe(2);
  });
});
