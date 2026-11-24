import React from "react";
import { Alert } from "react-native";
import { AxiosError, type AxiosResponse } from "axios";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import QueryErrorNotice from "./QueryErrorNotice";
import { ThemeProvider } from "../theme";
import { copyToClipboard } from "../utils/clipboard";
import { alertError, COPY_REFERENCE_LABEL } from "../utils/errorAlert";
import { getUnexplainedServerErrorMessage } from "../utils/unexplainedError";

jest.mock("../utils/clipboard", () => {
  return {
    __esModule: true,
    copyToClipboard: jest.fn((): boolean => {
      return true;
    }),
  };
});

/*
 * A FAILURE NOBODY EXPLAINED CAN HAVE ITS REFERENCE COPIED (#7275).
 *
 * The server names a reference - the start of the request's id, which its
 * log names - with every failure it could not explain. The app showed none
 * of it. A failed read's notice now shows the reference with a button that
 * copies it, and a failed action's alert has a Copy reference button; a
 * failure with no reference shows neither.
 */

function failureWith(data: unknown, status: number = 500): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_RESPONSE",
    undefined,
    undefined,
    {
      status: status,
      statusText: "",
      data: data,
      headers: {},
      config: {},
    } as unknown as AxiosResponse,
  );
}

const copy: jest.MockedFunction<typeof copyToClipboard> =
  copyToClipboard as jest.MockedFunction<typeof copyToClipboard>;

beforeEach(() => {
  copy.mockClear();
});

async function renderNotice(error: unknown): Promise<void> {
  await render(
    <ThemeProvider>
      <QueryErrorNotice
        message="Unable to load the latest activity."
        retryLabel="Retry activity"
        onRetry={(): void => {}}
        error={error}
      />
    </ThemeProvider>,
  );
}

describe("a failed read's notice", () => {
  test("shows the reference of a failure nobody explained, and copies it", async () => {
    await renderNotice(
      failureWith({
        message: getUnexplainedServerErrorMessage("1f0c9a2b"),
        reference: "1f0c9a2b",
      }),
    );

    expect(screen.getByText("Reference: 1f0c9a2b")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(COPY_REFERENCE_LABEL));

    expect(copy).toHaveBeenCalledWith("1f0c9a2b");
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  test("shows no reference for a failure that has none", async () => {
    await renderNotice(
      failureWith({ message: "Monitor name already exists" }, 400),
    );

    expect(screen.queryByTestId("query-error-reference")).toBeNull();
  });

  test("shows no reference for a read that only knows it failed", async () => {
    await renderNotice(true);

    expect(screen.queryByTestId("query-error-reference")).toBeNull();
  });
});

describe("a failed action's alert", () => {
  test("offers Copy reference for a failure nobody explained", () => {
    const alert: jest.SpiedFunction<typeof Alert.alert> = jest
      .spyOn(Alert, "alert")
      .mockImplementation((): void => {});

    alertError(
      "Could not end override",
      failureWith({ reference: "abcdef01" }),
    );

    expect(alert).toHaveBeenCalledTimes(1);

    const [title, message, buttons] = alert.mock.calls[0]!;

    expect(title).toBe("Could not end override");
    expect(message).toBe(getUnexplainedServerErrorMessage("abcdef01"));

    const copyButton: { text?: string; onPress?: () => void } | undefined = (
      buttons as Array<{ text?: string; onPress?: () => void }>
    ).find((button: { text?: string }): boolean => {
      return button.text === COPY_REFERENCE_LABEL;
    });

    copyButton?.onPress?.();

    expect(copy).toHaveBeenCalledWith("abcdef01");

    alert.mockRestore();
  });

  test("says any other failure with no extra button", () => {
    const alert: jest.SpiedFunction<typeof Alert.alert> = jest
      .spyOn(Alert, "alert")
      .mockImplementation((): void => {});

    alertError(
      "Could not cancel override",
      failureWith({ message: "This override has already ended." }, 400),
    );

    expect(alert).toHaveBeenCalledWith(
      "Could not cancel override",
      "This override has already ended.",
    );

    alert.mockRestore();
  });
});
