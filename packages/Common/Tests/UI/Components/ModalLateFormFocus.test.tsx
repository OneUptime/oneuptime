import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Modal from "../../../UI/Components/Modal/Modal";
import { UNSAVED_CHANGES_SCOPE_ATTRIBUTE } from "../../../UI/Utils/NewVersion/UnsavedChanges";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import React, { ReactElement, useEffect, useState } from "react";

/*
 * A dialog places its first focus when it opens: a field in its body, else
 * the button the dialog is for. A form that draws after the dialog opened -
 * one that reads its record, or a field's options, first - had no field
 * yet, so the focus went to the footer's button (Add a Role's Add Role) and
 * stayed there once the fields came. The dialog now watches its body until
 * a form's first control arrives, and moves the focus there, as it would
 * have had the form drawn at once - only while the focus is still where the
 * dialog put it. Content that is not a form never takes it.
 */

afterEach(() => {
  cleanup();
});

/*
 * What a ModelForm draws: a loader, then - once its read lands - a form.
 * `drawForm` is handed out so the test decides when the read lands.
 */
interface LateFormHandle {
  drawForm: () => void;
}

const handle: LateFormHandle = { drawForm: (): void => {} };

const LateForm: (props: {
  children: ReactElement | Array<ReactElement>;
}) => ReactElement = (props: {
  children: ReactElement | Array<ReactElement>;
}): ReactElement => {
  const [isDrawn, setIsDrawn] = useState<boolean>(false);

  useEffect(() => {
    handle.drawForm = (): void => {
      setIsDrawn(true);
    };
  }, []);

  if (!isDrawn) {
    return <div role="status">Loading...</div>;
  }

  return <form>{props.children}</form>;
};

const drawTheForm: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    handle.drawForm();
  });
  // MutationObserver callbacks are microtasks: let them run.
  await act(async () => {
    await Promise.resolve();
  });
};

const renderDialog: (
  children: ReactElement,
  props?: Partial<React.ComponentProps<typeof Modal>>,
) => RenderResult = (
  children: ReactElement,
  props?: Partial<React.ComponentProps<typeof Modal>>,
): RenderResult => {
  return render(
    <Modal
      title="Add a Role"
      submitButtonText="Add Role"
      onSubmit={(): void => {}}
      onClose={(): void => {}}
      {...props}
    >
      {children}
    </Modal>,
  );
};

describe("a form that draws after its dialog opened", () => {
  test("first the button the dialog is for, then the form's first field once it draws", async () => {
    renderDialog(
      <LateForm>
        <input aria-label="Search roles" />
        <input aria-label="Role" type="radio" name="role" />
      </LateForm>,
    );

    // Nothing to fill in yet: the dialog's button holds the focus.
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveFocus();

    await drawTheForm();

    expect(screen.getByLabelText("Search roles")).toHaveFocus();
  });

  /*
   * BasicForm - every create and edit dialog's form - draws no <form>: its
   * root is a div it marks as a form scope. Add a Role's picker sits in one,
   * and its first control is a switch, which no autoFocus reaches.
   */
  test("BasicForm's root, which is no <form> element, counts as the form: its first control takes the focus", async () => {
    const LateScope: () => ReactElement = (): ReactElement => {
      const [isDrawn, setIsDrawn] = useState<boolean>(false);

      useEffect(() => {
        handle.drawForm = (): void => {
          setIsDrawn(true);
        };
      }, []);

      if (!isDrawn) {
        return <div role="status">Loading...</div>;
      }

      return (
        <div className="row" {...{ [UNSAVED_CHANGES_SCOPE_ATTRIBUTE]: "form" }}>
          <button type="button" aria-pressed="true">
            Whole project
          </button>
          <button type="button" aria-pressed="false">
            One area
          </button>
        </div>
      );
    };

    renderDialog(<LateScope />);

    expect(screen.getByTestId("modal-footer-submit-button")).toHaveFocus();

    await drawTheForm();

    expect(screen.getByRole("button", { name: "Whole project" })).toHaveFocus();
    expect(document.querySelector("form")).toBeNull();
  });

  test("a form's first control may be a choice rather than a text field", async () => {
    renderDialog(
      <LateForm>
        <div role="radiogroup" aria-label="Role">
          <div role="radio" aria-checked="false" tabIndex={0}>
            Owner
          </div>
        </div>
      </LateForm>,
    );

    await drawTheForm();

    expect(screen.getByRole("radio", { name: "Owner" })).toHaveFocus();
  });

  test("a person who moved the focus first keeps their place", async () => {
    renderDialog(
      <LateForm>
        <input aria-label="Search roles" />
      </LateForm>,
    );

    act(() => {
      screen.getByTestId("modal-footer-close-button").focus();
    });

    await drawTheForm();

    expect(screen.getByTestId("modal-footer-close-button")).toHaveFocus();
    expect(screen.getByLabelText("Search roles")).not.toHaveFocus();
  });

  test("the focus moves once: fields that draw later still leave it where it went", async () => {
    const Growing: () => ReactElement = (): ReactElement => {
      const [extra, setExtra] = useState<boolean>(false);

      return (
        <form>
          <input aria-label="Name" />
          <button
            type="button"
            onClick={(): void => {
              setExtra(true);
            }}
          >
            More fields
          </button>
          {extra ? <input aria-label="Description" /> : <></>}
        </form>
      );
    };

    renderDialog(
      <LateForm>
        <Growing />
      </LateForm>,
    );

    await drawTheForm();
    expect(screen.getByLabelText("Name")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "More fields" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Description")).not.toHaveFocus();
  });

  test("a destructive dialog starts on Cancel, and its late field to type into takes the focus", async () => {
    renderDialog(
      <LateForm>
        <input aria-label="Type the project's name to delete it" />
      </LateForm>,
      {
        title: "Delete Project",
        submitButtonText: "Delete Project",
        submitButtonStyleType: ButtonStyleType.DANGER,
      },
    );

    expect(screen.getByTestId("modal-footer-close-button")).toHaveFocus();

    await drawTheForm();

    expect(
      screen.getByLabelText("Type the project's name to delete it"),
    ).toHaveFocus();
  });
});

describe("what never takes the focus late", () => {
  test("content that is not a form - a list the dialog fills in, a link - leaves it on the button", async () => {
    const LateList: () => ReactElement = (): ReactElement => {
      const [isDrawn, setIsDrawn] = useState<boolean>(false);

      useEffect(() => {
        handle.drawForm = (): void => {
          setIsDrawn(true);
        };
      }, []);

      return isDrawn ? (
        <ul>
          <li>
            <a href="/monitors/1">API Monitor</a>
          </li>
          <li>
            <button type="button">Show all 12</button>
          </li>
        </ul>
      ) : (
        <p>Checking what still uses it...</p>
      );
    };

    renderDialog(<LateList />, {
      title: "Archive Severity",
      submitButtonText: "Archive",
    });

    expect(screen.getByTestId("modal-footer-submit-button")).toHaveFocus();

    await drawTheForm();

    expect(screen.getByTestId("modal-footer-submit-button")).toHaveFocus();
  });

  test("a dialog whose field was there at once keeps the focus on it", async () => {
    renderDialog(
      <div>
        <form>
          <input aria-label="Name" />
        </form>
        <LateForm>
          <input aria-label="Late field" />
        </LateForm>
      </div>,
    );

    expect(screen.getByLabelText("Name")).toHaveFocus();

    await drawTheForm();

    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  test("a dialog under another one never takes the focus from it", async () => {
    const Stacked: () => ReactElement = (): ReactElement => {
      return (
        <Modal title="Add a Role" onClose={(): void => {}}>
          <div>
            <LateForm>
              <input aria-label="Search roles" />
            </LateForm>
            <Modal
              title="Discard changes?"
              submitButtonText="Discard"
              onSubmit={(): void => {}}
              onClose={(): void => {}}
            >
              <p>Your changes are not saved.</p>
            </Modal>
          </div>
        </Modal>
      );
    };

    render(<Stacked />);

    const discard: HTMLElement = screen.getByRole("button", {
      name: "Discard",
    });

    expect(discard).toHaveFocus();

    await drawTheForm();

    expect(discard).toHaveFocus();
    expect(screen.getByLabelText("Search roles")).not.toHaveFocus();
  });

  test("a dialog that closed before its form drew does nothing once it is gone", async () => {
    const { unmount } = renderDialog(
      <LateForm>
        <input aria-label="Search roles" />
      </LateForm>,
    );

    unmount();

    // Nothing is left watching, and nothing throws.
    expect(document.activeElement).toBe(document.body);
  });
});
