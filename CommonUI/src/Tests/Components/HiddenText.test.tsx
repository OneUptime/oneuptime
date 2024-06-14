import HiddenText from "../../Components/HiddenText/HiddenText";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

describe("tests for HiddenText component", () => {
  test("it should click hidden-text and reveal text in document", async () => {
    render(<HiddenText text="Special" />);
    const hiddenText: HTMLElement = screen.getByRole("hidden-text");
    fireEvent.click(hiddenText);

    await waitFor(() => {
      expect(screen.getByRole("revealed-text")).toBeInTheDocument();
    });

    expect(screen.queryByRole("hidden-text")).toBeFalsy();
    expect(screen.queryByRole("revealed-text")).toHaveTextContent("Special");
  });

  test("it should not show copy to clipboard if isCopyable is false", async () => {
    render(<HiddenText text="text" isCopyable={false} />);
    const hiddenText: HTMLElement = screen.getByRole("hidden-text");
    fireEvent.click(hiddenText);

    await waitFor(() => {
      expect(screen.getByRole("revealed-text")).toBeInTheDocument();
    });

    expect(screen.queryByRole("hidden-text")).toBeFalsy();
    expect(screen.queryByRole("copy-to-clipboard")).toBeFalsy();
  });

  test("it should click hidden-text and reveal icon", async () => {
    render(<HiddenText text="text" isCopyable={true} />);
    const hiddenText: HTMLElement = screen.getByRole("hidden-text");
    fireEvent.click(hiddenText);
    await waitFor(() => {
      expect(screen.getByRole("revealed-text")).toBeInTheDocument();
    });
    expect(screen.getByTestId("hide-text-icon")).toBeTruthy();
  });

  test("it should click hidden-text and copy to clipboard", async () => {
    render(<HiddenText text="text" isCopyable={true} />);
    const hiddenText: HTMLElement = screen.getByRole("hidden-text");
    fireEvent.click(hiddenText);
    await waitFor(() => {
      expect(screen.getByRole("revealed-text")).toBeInTheDocument();
    });

    expect(screen.getByTestId("copy-to-clipboard-icon")).toBeTruthy();

    const copy: HTMLElement = screen.getByTestId("copy-to-clipboard-icon");
    fireEvent.click(copy);

    await waitFor(() => {
      expect(screen.getByRole("copy-to-clipboard")).toHaveTextContent(
        "Copied to Clipboard",
      );
    });
  });
});
