import Toast, { ToastType } from "../../Components/Toast/Toast";
import "@testing-library/jest-dom/extend-expect";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";

describe("Test for Toast.tsx", () => {
  test("should render the component", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("toast")).toHaveClass(
      "pointer-events-none fixed z-40 top-0 left-0 right-0  flex items-end px-4 py-6 sm:items-start sm:p-6",
    );
  });

  test("should have close button", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("close-button")).toBeInTheDocument();
  });

  test("Checking Title", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("Spread");
  });

  test("Checking Description", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("description")).toHaveTextContent("Love");
  });

  test("Checking if Toast is for SUCCESS", () => {
    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("toast-icon")).toHaveClass("text-green-400");
  });
  test("Checking if Toast is for INFO", () => {
    render(<Toast type={ToastType.INFO} title="Spread" description="Love" />);
    expect(screen.getByTestId("toast-icon")).toHaveClass("text-blue-400");
  });

  test("Checking if Toast is for Warning", () => {
    render(
      <Toast type={ToastType.WARNING} title="Spread" description="Love" />,
    );
    expect(screen.getByTestId("toast-icon")).toHaveClass("text-yellow-400");
  });

  test("Checking if Toast is for Normal", () => {
    render(<Toast type={ToastType.NORMAL} title="Spread" description="Love" />);
    expect(screen.getByTestId("toast-icon")).toHaveClass("text-gray-400");
  });
  test("simulates button click and sets the state to flase, closing the toast", async () => {
    const user: UserEvent = userEvent.setup();

    render(
      <Toast type={ToastType.SUCCESS} title="Spread" description="Love" />,
    );

    const closeButton: HTMLButtonElement = screen.getByTestId("close-button");
    await user.click(closeButton);

    expect(screen.queryByTestId("toast")).toBeFalsy();
  });
});
