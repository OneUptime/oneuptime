import Modal from "../../../UI/Components/Modal/Modal";
import getJestMockFunction, { MockFunction } from "../../MockType";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Modal's secondaryButton: a plain button the footer draws between Cancel
 * and the submit button - a stepped form's Next, on every step but the last
 * (Forms/Utils/SteppedFormFooter.ts). Next commits nothing, and the submit
 * button, on the last step, is the dialog's one primary action, so the
 * secondary button is drawn plain, like Cancel.
 */

const PLAIN_CLASS: string = "bg-white";
const PRIMARY_CLASS: string = "bg-indigo-600";

function footerButtons(): Array<HTMLElement> {
  return within(screen.getByTestId("modal-footer")).getAllByRole("button");
}

describe("Modal secondaryButton", () => {
  afterEach(() => {
    cleanup();
  });

  test("is drawn plain, between Cancel and the submit button", () => {
    render(
      <Modal
        title="Edit Probe"
        submitButtonText="Save Changes"
        onSubmit={getJestMockFunction()}
        onClose={getJestMockFunction()}
        secondaryButton={{
          title: "Next",
          dataTestId: "modal-footer-next-button",
          onClick: getJestMockFunction(),
        }}
      >
        <p>Body</p>
      </Modal>,
    );

    expect(
      footerButtons().map((button: HTMLElement): string => {
        return button.textContent || "";
      }),
    ).toEqual(["Cancel", "Next", "Save Changes"]);

    const next: HTMLElement = screen.getByTestId("modal-footer-next-button");

    expect(next).toHaveAttribute("type", "button");
    expect(next.className).toContain(PLAIN_CLASS);
    expect(next.className).not.toContain(PRIMARY_CLASS);
    expect(
      screen.getByTestId("modal-footer-submit-button").className,
    ).toContain(PRIMARY_CLASS);
  });

  test("runs its own handler, not the submit handler", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const onNext: MockFunction = getJestMockFunction();

    render(
      <Modal
        title="Edit Probe"
        submitButtonText="Save Changes"
        onSubmit={onSubmit}
        onClose={getJestMockFunction()}
        secondaryButton={{ title: "Next", onClick: onNext }}
      >
        <p>Body</p>
      </Modal>,
    );

    await userEvent.click(screen.getByTestId("modal-footer-secondary-button"));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("cannot be pressed while the dialog is busy", async () => {
    const onNext: MockFunction = getJestMockFunction();

    render(
      <Modal
        title="Edit Probe"
        submitButtonText="Save Changes"
        onSubmit={getJestMockFunction()}
        onClose={getJestMockFunction()}
        isLoading={true}
        secondaryButton={{ title: "Next", onClick: onNext }}
      >
        <p>Body</p>
      </Modal>,
    );

    await userEvent.click(screen.getByTestId("modal-footer-secondary-button"));

    expect(onNext).not.toHaveBeenCalled();
  });

  test("is not drawn unless asked for", () => {
    render(
      <Modal
        title="Edit Probe"
        submitButtonText="Save Changes"
        onSubmit={getJestMockFunction()}
        onClose={getJestMockFunction()}
      >
        <p>Body</p>
      </Modal>,
    );

    expect(
      footerButtons().map((button: HTMLElement): string => {
        return button.textContent || "";
      }),
    ).toEqual(["Cancel", "Save Changes"]);
  });
});
