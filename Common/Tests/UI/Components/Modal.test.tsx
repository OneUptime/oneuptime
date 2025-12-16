import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ButtonType from "../../../UI/Components/Button/ButtonTypes";
import Modal, { ModalWidth } from "../../../UI/Components/Modal/Modal";
import { describe, expect, it, test } from "@jest/globals";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render } from "@testing-library/react";
import IconProp from "../../../Types/Icon/IconProp";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

describe("Modal", () => {
  test("renders the modal with the title and description", () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const { getByTestId, getByText } = render(
      <Modal
        title="Test Modal Title"
        description="Test modal description"
        onSubmit={onSubmit}
      >
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("modal-title")).toHaveTextContent("Test Modal Title");
    expect(getByText("Test modal description")).toBeInTheDocument();
    expect(getByText("Modal content")).toBeInTheDocument();
  });

  it("closes the modal when the close button is clicked", () => {
    const onCloseMock: MockFunction = getJestMockFunction();
    const onSubmit: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmit} onClose={onCloseMock}>
        <div>Modal content</div>
      </Modal>,
    );

    const closeButton: HTMLElement = getByTestId("close-button");

    fireEvent.click(closeButton);

    expect(onCloseMock).toHaveBeenCalled();
  });

  it("calls the onSubmit function when the submit button is clicked", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonText="Submit"
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    fireEvent.click(submitButton);

    expect(onSubmitMock).toHaveBeenCalled();
  });

  it("displays the modal with the default width when modalWidth is not set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("modal")).toHaveClass("sm:max-w-lg");
  });

  it("displays the modal with the correct width when modalWidth is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        modalWidth={ModalWidth.Medium}
      >
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("modal")).toHaveClass("sm:max-w-3xl");
  });

  it("displays the children passed to the modal", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByText } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByText("Modal content")).toBeInTheDocument();
  });

  it("displays the loader when isBodyLoading is true", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock} isBodyLoading>
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("bar-loader")).toBeInTheDocument();
  });

  it("does not display the loader when isBodyLoading is false", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { queryByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(queryByTestId("bar-loader")).not.toBeInTheDocument();
  });

  it("does not display the loader when isBodyLoading is undefined", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { queryByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(queryByTestId("bar-loader")).not.toBeInTheDocument();
  });

  it("disables the submit button when isLoading is true", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonText="Submit"
        isLoading={true}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toBeDisabled();
  });

  it("disables the submit button when disableSubmitButton is true", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonText="Submit"
        disableSubmitButton={true}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toBeDisabled();
  });

  it("disables the submit button when isBodyLoading is true", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonText="Submit"
        isBodyLoading={true}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toBeDisabled();
  });

  it("displays the icon when icon is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock} icon={IconProp.SMS}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("icon")).toBeInTheDocument();
  });

  it("displays the submit button with the default style when submitButtonStyleType is not set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal title="Test Modal" onSubmit={onSubmitMock}>
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toHaveAttribute("type", "button");
  });

  it("displays the submit button with the correct style when submitButtonStyleType is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonType={ButtonType.Reset}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toHaveAttribute("type", "reset");
  });

  it("displays the submit button with the default style when submitButtonStyleType is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        submitButtonStyleType={ButtonStyleType.DANGER}
      >
        <div>Modal content</div>
      </Modal>,
    );

    const submitButton: HTMLElement = getByTestId("modal-footer-submit-button");

    expect(submitButton).toHaveClass("bg-red-600");
  });

  it("displays the right element when rightElement is set", () => {
    const onSubmitMock: MockFunction = getJestMockFunction();

    const { getByTestId } = render(
      <Modal
        title="Test Modal"
        onSubmit={onSubmitMock}
        rightElement={<div>Right element</div>}
      >
        <div>Modal content</div>
      </Modal>,
    );

    expect(getByTestId("right-element")).toBeInTheDocument();
  });
});
