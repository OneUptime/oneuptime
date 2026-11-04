import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import QRCodeElement from "../../../../UI/Components/QR/QR";

/*
 * The QR code element loads the qrcode library when it draws a code (issue
 * #5619): the sign-in page draws one only while two-factor authentication is
 * being set up, and used to download and parse the library on every visit
 * before it could draw.
 */

interface PendingCode {
  text: string;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
}

const mockQRCode: { requires: number; pending: Array<PendingCode> } = {
  requires: 0,
  pending: [],
};

jest.mock("qrcode", () => {
  mockQRCode.requires++;

  return {
    toDataURL: (text: string): Promise<string> => {
      return new Promise(
        (resolve: (url: string) => void, reject: (error: Error) => void) => {
          mockQRCode.pending.push({ text, resolve, reject });
        },
      );
    },
  };
});

// Lets the library's import, and a code made, reach the element.
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const codeFor: (text: string) => PendingCode = (text: string): PendingCode => {
  const pending: PendingCode | undefined = mockQRCode.pending.find(
    (code: PendingCode): boolean => {
      return code.text === text;
    },
  );

  if (!pending) {
    throw new Error(`No code was asked for "${text}"`);
  }

  return pending;
};

const OTP_URL: string = "otpauth://totp/OneUptime:ada@example.com?secret=ABC";

beforeEach(() => {
  mockQRCode.pending = [];
});

afterEach(() => {
  cleanup();
});

describe("QRCodeElement", () => {
  test("loads the library only once a code is drawn", async () => {
    expect(mockQRCode.requires).toBe(0);

    render(<QRCodeElement text={OTP_URL} />);
    await settle();

    expect(mockQRCode.requires).toBe(1);
    expect(
      mockQRCode.pending.map((code: PendingCode) => {
        return code.text;
      }),
    ).toEqual([OTP_URL]);
  });

  test("is an image named after its text from the first frame, drawn once the code is made", async () => {
    render(<QRCodeElement text={OTP_URL} />);

    const image: HTMLElement = screen.getByRole("img", { name: OTP_URL });

    expect(image).not.toHaveAttribute("src");

    await settle();
    await act(async () => {
      codeFor(OTP_URL).resolve("data:image/png;base64,QUJD");
    });

    expect(image).toHaveAttribute("src", "data:image/png;base64,QUJD");
  });

  test("draws the code for the text it shows now, not a late one made for text it showed before", async () => {
    const { rerender } = render(<QRCodeElement text="first" />);
    await settle();

    rerender(<QRCodeElement text="second" />);
    await settle();

    await act(async () => {
      codeFor("second").resolve("data:image/png;base64,c2Vjb25k");
    });
    await act(async () => {
      codeFor("first").resolve("data:image/png;base64,Zmlyc3Q=");
    });

    expect(screen.getByRole("img", { name: "second" })).toHaveAttribute(
      "src",
      "data:image/png;base64,c2Vjb25k",
    );
  });

  test("says why when the code cannot be made", async () => {
    render(<QRCodeElement text={OTP_URL} />);
    await settle();

    await act(async () => {
      codeFor(OTP_URL).reject(new Error("The text is too long for a code"));
    });

    expect(
      screen.getByText("The text is too long for a code"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
