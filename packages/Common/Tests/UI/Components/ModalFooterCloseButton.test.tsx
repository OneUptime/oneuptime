import Modal from "../../../UI/Components/Modal/Modal";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import getJestMockFunction, { MockFunction } from "../../MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Modal's hasFooterCloseButton: a dialog that only reports something - Test
 * LLM Provider's verdict - has one button that closes it, "Close", as its
 * submit button. It still wants every other way out a dialog has (the
 * header's X, Escape, the backdrop), which onClose gives; but onClose also
 * put a Cancel in the footer beside Close, two buttons doing one thing.
 * With hasFooterCloseButton={false} the footer keeps Close alone, and the
 * rest still close the dialog.
 */

function footerButtons(): Array<string> {
  return within(screen.getByTestId("modal-footer"))
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return button.textContent || "";
    });
}

function renderReport(
  onClose: MockFunction,
  hasFooterCloseButton?: boolean,
): void {
  render(
    <Modal
      title="Test LLM Provider"
      onClose={onClose}
      onSubmit={onClose}
      submitButtonText="Close"
      submitButtonStyleType={ButtonStyleType.NORMAL}
      {...(hasFooterCloseButton === undefined ? {} : { hasFooterCloseButton })}
      secondaryButton={{
        title: "Test again",
        onClick: getJestMockFunction(),
      }}
    >
      <p>Test passed</p>
    </Modal>,
  );
}

describe("Modal hasFooterCloseButton", () => {
  afterEach(() => {
    cleanup();
  });

  test("false: the footer keeps its submit button as the one way out", () => {
    renderReport(getJestMockFunction(), false);

    expect(footerButtons()).toEqual(["Test again", "Close"]);
    expect(screen.queryByTestId("modal-footer-close-button")).toBeNull();
  });

  test("false: the header's X still closes the dialog", () => {
    const onClose: MockFunction = getJestMockFunction();
    renderReport(onClose, false);

    fireEvent.click(screen.getByTestId("close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("false: Escape still closes the dialog", () => {
    const onClose: MockFunction = getJestMockFunction();
    renderReport(onClose, false);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("false: the focus starts on the submit button, the way out", () => {
    renderReport(getJestMockFunction(), false);

    expect(screen.getByTestId("modal-footer-submit-button")).toHaveFocus();
  });

  test("left out, the footer has its Cancel as before", () => {
    renderReport(getJestMockFunction());

    expect(footerButtons()).toEqual(["Cancel", "Test again", "Close"]);
  });
});
