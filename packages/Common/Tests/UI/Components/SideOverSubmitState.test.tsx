import Modal from "../../../UI/Components/Modal/Modal";
import SideOver, {
  ComponentProps,
} from "../../../UI/Components/SideOver/SideOver";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";
import {
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * The submit/close STATE of the panel — the two props a panel needs while it
 * is running something it started. Everything else about SideOver lives in
 * SideOver.test.tsx; this file exists because these two props are what stop a
 * long-running panel from lying to the user about what it is doing.
 *
 * The behaviour being pinned came out of the recommendations batch-create
 * panel, which spends the better part of a minute creating monitors one at a
 * time. Before the props existed, every such caller hand-rolled the same two
 * things badly: a submit button relabelled "Creating..." that stayed clickable
 * and fired the whole batch a second time, and an `onClose` that quietly
 * returned early — leaving a Close button that looks live, takes the click and
 * does nothing, which reads as a frozen app rather than as a refusal.
 */
describe("SideOver submit and close state", () => {
  const childElement: ReactElement = <div key={0}>child element</div>;

  type MakePropsFunction = (data: {
    onClose: MockFunction;
    onSubmit: MockFunction;
  }) => ComponentProps;

  const makeProps: MakePropsFunction = (data: {
    onClose: MockFunction;
    onSubmit: MockFunction;
  }): ComponentProps => {
    return {
      title: "Create monitors",
      description: "From the recommendations you selected",
      onClose: data.onClose,
      onSubmit: data.onSubmit,
      children: childElement,
    };
  };

  /*
   * The submit button is the only one with this title, and its own text node
   * sits directly inside the <button> — the spinner is a sibling svg, so the
   * accessible text stays "Save" in both states and this query keeps working
   * while loading.
   */
  type GetSubmitButtonFunction = () => HTMLElement;

  const getSubmitButton: GetSubmitButtonFunction = (): HTMLElement => {
    return screen.getByText("Save");
  };

  /*
   * The FOOTER Close, scoped deliberately: the header's × is also a close
   * control, and the whole point of `closeButtonDisabled` is that the two do
   * not behave the same.
   */
  type GetFooterCloseButtonFunction = () => HTMLElement;

  const getFooterCloseButton: GetFooterCloseButtonFunction =
    (): HTMLElement => {
      return within(screen.getByTestId("side-over-footer")).getByText("Close");
    };

  type GetHeaderCloseButtonFunction = () => HTMLElement;

  const getHeaderCloseButton: GetHeaderCloseButtonFunction =
    (): HTMLElement => {
      return screen.getByTestId("close-button");
    };

  type HasSpinnerFunction = (button: HTMLElement) => boolean;

  const hasSpinner: HasSpinnerFunction = (button: HTMLElement): boolean => {
    return button.querySelector(".animate-spin") !== null;
  };

  /*
   * SideOver locks the page scrollbar while it is open, through a counter
   * shared with Modal. Resetting it around every test keeps one test's
   * unmount from being the thing that unlocks the page for the next.
   */
  beforeEach(() => {
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  afterEach(() => {
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  describe("submitButtonIsLoading", () => {
    /*
     * A spinner alone is decoration. The disable is the part that matters: a
     * second click on a batch-create submit runs the whole batch again, and
     * `createOrUpdate` with FormType.Create does not de-duplicate, so the user
     * ends up with two of every monitor.
     */
    test("spins the submit button and disables it, so a long job cannot be started twice", () => {
      const onClose: MockFunction = getJestMockFunction();
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <SideOver
          {...makeProps({ onClose: onClose, onSubmit: onSubmit })}
          submitButtonIsLoading={true}
        />,
      );

      const submitButton: HTMLElement = getSubmitButton();

      expect(hasSpinner(submitButton)).toBe(true);
      expect(submitButton).toBeDisabled();

      fireEvent.click(submitButton);

      expect(onSubmit).not.toHaveBeenCalled();
    });

    /*
     * The same affordance Modal has always forwarded to its footer. Asserted
     * side by side rather than described in a comment, because "SideOver
     * should behave like Modal here" is the entire reason the prop was added
     * instead of each caller relabelling its own button.
     */
    test("behaves the same way Modal's footer does for a loading submit", () => {
      const onClose: MockFunction = getJestMockFunction();
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <SideOver
          {...makeProps({ onClose: onClose, onSubmit: onSubmit })}
          submitButtonIsLoading={true}
        />,
      );

      render(
        <Modal
          title="Create monitors"
          onClose={onClose}
          onSubmit={onSubmit}
          submitButtonText="Save"
          isLoading={true}
        >
          <div>modal child</div>
        </Modal>,
      );

      const modalSubmitButton: HTMLElement = within(
        screen.getByTestId("modal-footer"),
      ).getByText("Save");
      const sideOverSubmitButton: HTMLElement = within(
        screen.getByTestId("side-over-footer"),
      ).getByText("Save");

      expect(hasSpinner(modalSubmitButton)).toBe(true);
      expect(modalSubmitButton).toBeDisabled();

      expect(hasSpinner(sideOverSubmitButton)).toBe(
        hasSpinner(modalSubmitButton),
      );
      expect(sideOverSubmitButton).toBeDisabled();
    });

    test("leaves the submit button alone when the panel is not loading", () => {
      const onClose: MockFunction = getJestMockFunction();
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <SideOver
          {...makeProps({ onClose: onClose, onSubmit: onSubmit })}
          submitButtonIsLoading={false}
        />,
      );

      const submitButton: HTMLElement = getSubmitButton();

      expect(hasSpinner(submitButton)).toBe(false);
      expect(submitButton).not.toBeDisabled();

      fireEvent.click(submitButton);

      expect(onSubmit).toHaveBeenCalled();
    });
  });

  describe("closeButtonDisabled", () => {
    /*
     * Half of a batch that has already written real records to the database
     * cannot be abandoned, so the footer Close is genuinely unavailable while
     * it runs. Disabling it is what makes that legible: the alternative every
     * caller reached for was an `onClose` that returned early, which leaves a
     * button that looks live, swallows the click and does nothing.
     */
    test("disables the footer Close button and does not call onClose when it is pressed", () => {
      const onClose: MockFunction = getJestMockFunction();
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <SideOver
          {...makeProps({ onClose: onClose, onSubmit: onSubmit })}
          closeButtonDisabled={true}
        />,
      );

      const closeButton: HTMLElement = getFooterCloseButton();

      expect(closeButton).toBeDisabled();

      fireEvent.click(closeButton);

      expect(onClose).not.toHaveBeenCalled();
    });

    /*
     * A panel must never trap the user. Whatever the panel is in the middle
     * of, the × is the one way out that always works — a run that cannot be
     * cancelled is still a run the user is allowed to stop watching.
     */
    test("leaves the header × working, so the panel can never trap the user", () => {
      const onClose: MockFunction = getJestMockFunction();
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <SideOver
          {...makeProps({ onClose: onClose, onSubmit: onSubmit })}
          closeButtonDisabled={true}
        />,
      );

      const headerCloseButton: HTMLElement = getHeaderCloseButton();

      expect(headerCloseButton).not.toBeDisabled();

      fireEvent.click(headerCloseButton);

      expect(onClose).toHaveBeenCalled();
    });

    test("keeps the header × working while the submit button is also loading, which is the real state of a running panel", () => {
      const onClose: MockFunction = getJestMockFunction();
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <SideOver
          {...makeProps({ onClose: onClose, onSubmit: onSubmit })}
          submitButtonIsLoading={true}
          closeButtonDisabled={true}
        />,
      );

      expect(getSubmitButton()).toBeDisabled();
      expect(getFooterCloseButton()).toBeDisabled();

      fireEvent.click(getHeaderCloseButton());

      expect(onClose).toHaveBeenCalled();
    });

    test("leaves the footer Close button alone when the panel is not running anything", () => {
      const onClose: MockFunction = getJestMockFunction();
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <SideOver
          {...makeProps({ onClose: onClose, onSubmit: onSubmit })}
          closeButtonDisabled={false}
        />,
      );

      const closeButton: HTMLElement = getFooterCloseButton();

      expect(closeButton).not.toBeDisabled();

      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("neither prop passed", () => {
    /*
     * Every existing caller passes neither, so both props defaulting to "no
     * change at all" is what keeps this an additive change rather than a
     * silent disabling of buttons across the app.
     */
    test("leaves an ordinary panel exactly as it was", () => {
      const onClose: MockFunction = getJestMockFunction();
      const onSubmit: MockFunction = getJestMockFunction();

      const rendered: RenderResult = render(
        <SideOver {...makeProps({ onClose: onClose, onSubmit: onSubmit })} />,
      );

      const submitButton: HTMLElement = getSubmitButton();

      expect(submitButton).not.toBeDisabled();
      expect(hasSpinner(submitButton)).toBe(false);

      fireEvent.click(submitButton);

      expect(onSubmit).toHaveBeenCalled();

      const closeButton: HTMLElement = getFooterCloseButton();

      expect(closeButton).not.toBeDisabled();

      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();

      rendered.unmount();
    });
  });
});
