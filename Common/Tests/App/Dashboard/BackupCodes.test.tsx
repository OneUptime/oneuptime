import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import BackupCodes from "../../../../App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/BackupCodes";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";

const CODES: Array<string> = ["ABCD-EFGH-2345", "JKLM-NPQR-6789"];
const clipboardDescriptor: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(navigator, "clipboard");
const createObjectURLDescriptor: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(window.URL, "createObjectURL");
const revokeObjectURLDescriptor: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(window.URL, "revokeObjectURL");

const response: (data: JSONObject) => HTTPResponse<JSONObject> = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

describe("backup code recovery experience", () => {
  let getStatus: jest.SpyInstance;
  let generateCodes: jest.SpyInstance;

  beforeEach(() => {
    getStatus = jest
      .spyOn(API, "get")
      .mockResolvedValue(
        response({ total: 10, unused: 8, generatedAt: "2026-09-10T10:00:00Z" }),
      );
    generateCodes = jest
      .spyOn(API, "post")
      .mockResolvedValue(response({ codes: CODES }));
    jest
      .spyOn(API, "getFriendlyErrorMessage")
      .mockImplementation((error: unknown): string => {
        return (error as Error).message;
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    for (const [target, property, descriptor] of [
      [navigator, "clipboard", clipboardDescriptor],
      [window.URL, "createObjectURL", createObjectURLDescriptor],
      [window.URL, "revokeObjectURL", revokeObjectURLDescriptor],
    ] as Array<[object, string, PropertyDescriptor | undefined]>) {
      if (descriptor) {
        Object.defineProperty(target, property, descriptor);
      } else {
        Reflect.deleteProperty(target, property);
      }
    }
  });

  test("loads recovery status without generating or exposing codes", async () => {
    render(<BackupCodes />);

    const status: HTMLElement = await screen.findByRole("status", {
      name: "Backup code status",
    });
    expect(status).toHaveTextContent("8 of 10 backup codes remaining");
    expect(status).toHaveTextContent("Ready to use");
    expect(status).toHaveTextContent("Each code can be used once");
    expect(status).toHaveTextContent("Generated");
    expect(screen.queryByTestId("backup-code")).not.toBeInTheDocument();
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(getStatus.mock.calls[0][0].url.toString()).toContain(
      "/user-two-factor-backup-code/status",
    );
    expect(generateCodes).not.toHaveBeenCalled();
  });

  test.each<[number, string, string]>([
    [4, "Ready to use", "Each code can be used once"],
    [3, "Running low", "Generate a new set before you run out"],
    [1, "Running low", "Generate a new set before you run out"],
    [0, "No codes left", "Generate a new set to restore your recovery option"],
  ])(
    "explains the recovery state with %i unused codes",
    async (unused, label, guidance) => {
      getStatus.mockResolvedValue(
        response({ total: 10, unused, generatedAt: null }),
      );
      render(<BackupCodes />);

      const status: HTMLElement = await screen.findByRole("status", {
        name: "Backup code status",
      });
      expect(status).toHaveTextContent(
        `${unused} of 10 backup codes remaining`,
      );
      expect(status).toHaveTextContent(label);
      expect(status).toHaveTextContent(guidance);
      expect(status).not.toHaveTextContent("Generated");
    },
  );

  test("a new user can generate codes directly and sees a useful error on failure", async () => {
    getStatus.mockResolvedValue(
      response({ total: 0, unused: 0, generatedAt: null }),
    );
    generateCodes.mockRejectedValueOnce(
      new Error("Codes could not be generated"),
    );
    render(<BackupCodes />);

    expect(
      await screen.findByRole("status", { name: "Backup code status" }),
    ).toHaveTextContent("Set up your recovery option");
    fireEvent.click(
      screen.getByRole("button", { name: "Generate backup codes" }),
    );

    expect(
      await screen.findByText("Codes could not be generated"),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(generateCodes).toHaveBeenCalledTimes(1);
    expect(generateCodes.mock.calls[0][0].url.toString()).toContain(
      "/user-two-factor-backup-code/generate",
    );
    expect(generateCodes.mock.calls[0][0].data).toEqual({});

    fireEvent.click(
      screen.getByRole("button", { name: "Generate backup codes" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Your backup codes" }),
    ).toBeInTheDocument();
    expect(generateCodes).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText("Codes could not be generated"),
    ).not.toBeInTheDocument();
  });

  test("existing codes require confirmation and cancelling preserves the set", async () => {
    render(<BackupCodes />);
    await screen.findByRole("status", { name: "Backup code status" });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate codes" }));

    const confirmation: HTMLElement = await screen.findByRole("dialog", {
      name: "Regenerate backup codes?",
    });
    expect(confirmation).toHaveTextContent(
      "Your current codes will stop working immediately",
    );
    expect(generateCodes).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(generateCodes).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "8 of 10 backup codes remaining",
    );
  });

  test("unavailable status still requires confirmation before replacing codes", async () => {
    getStatus.mockRejectedValue(new Error("Recovery status is unavailable"));
    render(<BackupCodes />);
    await screen.findByText("Recovery status is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Regenerate codes" }));

    expect(
      await screen.findByRole("dialog", { name: "Regenerate backup codes?" }),
    ).toBeInTheDocument();
    expect(generateCodes).not.toHaveBeenCalled();
  });

  test("rapid confirmation clicks send one request and keep a failure visible", async () => {
    let rejectGeneration: ((error: Error) => void) | undefined;
    generateCodes.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectGeneration = reject;
      }),
    );
    render(<BackupCodes />);
    await screen.findByRole("status", { name: "Backup code status" });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate codes" }));
    const confirmation: HTMLElement = await screen.findByRole("dialog", {
      name: "Regenerate backup codes?",
    });
    const regenerateButton: HTMLElement = within(confirmation).getByRole(
      "button",
      { name: "Regenerate" },
    );

    act(() => {
      fireEvent.click(regenerateButton);
      fireEvent.click(regenerateButton);
    });
    expect(generateCodes).toHaveBeenCalledTimes(1);
    expect(regenerateButton).toBeDisabled();
    fireEvent.keyDown(confirmation, { key: "Escape" });
    expect(confirmation).toBeInTheDocument();

    await act(async () => {
      rejectGeneration!(new Error("Unable to replace codes"));
    });
    expect(
      within(confirmation).getByText("Unable to replace codes"),
    ).toBeVisible();
    expect(
      within(confirmation).getByRole("button", { name: "Regenerate" }),
    ).toBeEnabled();
  });

  test("a failed refresh after first generation cannot reuse a stale empty status", async () => {
    getStatus
      .mockResolvedValueOnce(
        response({ total: 0, unused: 0, generatedAt: null }),
      )
      .mockRejectedValue(new Error("Recovery status is unavailable"));
    render(<BackupCodes />);
    await screen.findByRole("status", { name: "Backup code status" });
    fireEvent.click(
      screen.getByRole("button", { name: "Generate backup codes" }),
    );
    await screen.findByRole("dialog", { name: "Your backup codes" });
    await screen.findByText("Recovery status is unavailable");
    fireEvent.click(screen.getByTestId("backup-codes-saved-checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate codes" }));

    expect(
      await screen.findByRole("dialog", { name: "Regenerate backup codes?" }),
    ).toBeInTheDocument();
    expect(generateCodes).toHaveBeenCalledTimes(1);
  });

  test("enrollment codes require acknowledgement and cannot be dismissed by reflex", async () => {
    const acknowledge: jest.Mock = jest.fn();
    render(
      <BackupCodes
        codesFromEnrolment={CODES}
        onEnrolmentCodesAcknowledged={acknowledge}
      />,
    );
    const modal: HTMLElement = await screen.findByRole("dialog", {
      name: "Your backup codes",
    });
    expect(modal).toHaveTextContent("These codes are shown only once.");
    expect(
      screen
        .getAllByTestId("backup-code")
        .map((code: HTMLElement): string | null => {
          return code.textContent;
        }),
    ).toEqual(CODES);
    const done: HTMLElement = within(modal).getByRole("button", {
      name: "Done",
    });
    expect(done).toBeDisabled();
    expect(
      within(modal).queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    expect(
      within(modal).queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(modal, { key: "Escape" });
    fireEvent.mouseDown(modal);
    fireEvent.mouseUp(modal);
    fireEvent.click(modal);
    fireEvent.click(done);
    expect(modal).toBeInTheDocument();
    expect(acknowledge).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I have saved these codes somewhere safe.",
      }),
    );
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("backup-code")).not.toBeInTheDocument();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(generateCodes).not.toHaveBeenCalled();
  });

  test("passkey enrollment shows codes without loading the two-factor card and rerenders do not reopen them", async () => {
    const { rerender } = render(
      <BackupCodes hideCard={true} codesFromEnrolment={CODES} />,
    );
    await screen.findByRole("dialog", { name: "Your backup codes" });
    expect(screen.queryByTestId("card")).not.toBeInTheDocument();
    expect(getStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("backup-codes-saved-checkbox"));

    rerender(<BackupCodes hideCard={true} codesFromEnrolment={[...CODES]} />);
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    rerender(<BackupCodes hideCard={true} codesFromEnrolment={[...CODES]} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <BackupCodes hideCard={true} codesFromEnrolment={["2345-6789-ABCD"]} />,
    );
    await screen.findByRole("dialog", { name: "Your backup codes" });
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    expect(getStatus).not.toHaveBeenCalled();
    expect(generateCodes).not.toHaveBeenCalled();
  });

  test("copy saves only code values and downloading contains the same set", async () => {
    const copy: jest.Mock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    const createObjectURL: jest.Mock = jest
      .fn()
      .mockReturnValue("blob:backup-codes");
    const revokeObjectURL: jest.Mock = jest.fn();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click: jest.SpyInstance = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement): void {
        expect(this.download).toBe("oneuptime-backup-codes.txt");
        expect(this.href).toBe("blob:backup-codes");
      });
    render(<BackupCodes hideCard={true} codesFromEnrolment={CODES} />);
    await screen.findByRole("dialog", { name: "Your backup codes" });
    fireEvent.click(screen.getByRole("button", { name: "Copy codes" }));
    await waitFor(() => {
      expect(copy).toHaveBeenCalledWith(CODES.join("\n"));
    });
    expect(
      await screen.findByText("Backup codes copied to clipboard."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download as .txt" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup-codes");
    expect(document.querySelector("a[download]")).toBeNull();
    const content: string = await new Promise((resolve, reject) => {
      const reader: FileReader = new FileReader();
      reader.onload = (): void => {
        resolve(String(reader.result));
      };
      reader.onerror = reject;
      reader.readAsText(createObjectURL.mock.calls[0][0] as Blob);
    });
    expect(content).toContain(CODES.join("\n"));
    expect(content).toContain(
      "Each code can be used once after entering your password.",
    );
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  });

  test.each(["denied", "unavailable"])(
    "clipboard %s offers a visible download fallback without acknowledging the codes",
    async (state: string) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value:
          state === "denied"
            ? {
                writeText: jest
                  .fn()
                  .mockRejectedValue(
                    new DOMException("Clipboard denied", "NotAllowedError"),
                  ),
              }
            : undefined,
      });
      render(<BackupCodes hideCard={true} codesFromEnrolment={CODES} />);
      await screen.findByRole("dialog", { name: "Your backup codes" });
      fireEvent.click(screen.getByRole("button", { name: "Copy codes" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not copy the codes. Download them instead.",
      );
      expect(
        screen.queryByText("Backup codes copied to clipboard."),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Download as .txt" }),
      ).toBeEnabled();
      expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
      expect(screen.getAllByTestId("backup-code")).toHaveLength(CODES.length);
    },
  );
});
