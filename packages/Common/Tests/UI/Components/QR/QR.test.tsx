import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import QRCodeElement from "../../../../UI/Components/QR/QR";
import { Logger } from "../../../../UI/Utils/Logger";

/*
 * The QR code element: it loads the qrcode library when it draws a code
 * (issue #5619) - the sign-in page draws one only while two-factor
 * authentication is being set up, and used to download and parse the library
 * on every visit before it could draw - and when a code cannot be made, it
 * says so in words and tells the page, which offers its other way in (issue
 * #6638: every code once failed, and the sign-in page showed "L.toDataURL is
 * not a function" where the code should have been, with nothing else).
 *
 * The module the element loads, QRCodeImage, stands in here, so each test
 * decides when a code is made. QRCodeImage.test.ts draws real codes, and
 * QRCodeInBrowserBuild.test.ts draws them with what the frontends' build
 * writes - where the code once broke.
 */

interface PendingCode {
  text: string;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
}

const mockQRCodeImage: { requires: number; pending: Array<PendingCode> } = {
  requires: 0,
  pending: [],
};

jest.mock("../../../../UI/Components/QR/QRCodeImage", () => {
  mockQRCodeImage.requires++;

  return {
    __esModule: true,
    default: (text: string): Promise<string> => {
      return new Promise(
        (resolve: (url: string) => void, reject: (error: Error) => void) => {
          mockQRCodeImage.pending.push({ text, resolve, reject });
        },
      );
    },
  };
});

// Lets the module's import, and a code made, reach the element.
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const codeFor: (text: string) => PendingCode = (text: string): PendingCode => {
  const pending: PendingCode | undefined = mockQRCodeImage.pending.find(
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
const IMAGE: string = "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E";
const FAILED: string = "The QR code could not be shown.";

const GERMAN: Record<string, string> = {
  "QR code": "QR-Code",
  "The QR code could not be shown.":
    "Der QR-Code konnte nicht angezeigt werden.",
};

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: { de: { translation: GERMAN } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

let loggedErrors: Array<string> = [];

beforeEach(() => {
  mockQRCodeImage.pending = [];
  loggedErrors = [];
  jest.spyOn(Logger, "error").mockImplementation((text: unknown) => {
    loggedErrors.push(String(text));
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("QRCodeElement", () => {
  test("loads the library only once a code is drawn", async () => {
    expect(mockQRCodeImage.requires).toBe(0);

    render(<QRCodeElement text={OTP_URL} />);
    await settle();

    expect(mockQRCodeImage.requires).toBe(1);
    expect(
      mockQRCodeImage.pending.map((code: PendingCode) => {
        return code.text;
      }),
    ).toEqual([OTP_URL]);
  });

  test("holds the code's place from the first frame, and draws the code there once it is made", async () => {
    render(<QRCodeElement text={OTP_URL} />);

    const placeholder: HTMLElement = screen.getByTestId("qr-code-loading");

    expect(placeholder).toHaveClass("h-48", "w-48");
    expect(placeholder).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("img", { name: "QR code" })).toBe(placeholder);
    expect(screen.queryByTestId("qr-code")).toBeNull();

    await settle();
    await act(async () => {
      codeFor(OTP_URL).resolve(IMAGE);
    });

    const image: HTMLElement = screen.getByRole("img", { name: "QR code" });

    expect(image).toBe(screen.getByTestId("qr-code"));
    expect(image.tagName).toBe("IMG");
    expect(image).toHaveAttribute("src", IMAGE);
    expect(image).toHaveClass("h-48", "w-48");
    expect(screen.queryByTestId("qr-code-loading")).toBeNull();
  });

  test("is named by what it is for, never by the secret it encodes", async () => {
    render(
      <QRCodeElement
        text={OTP_URL}
        alt="QR code to scan with your authenticator app"
      />,
    );
    await settle();
    await act(async () => {
      codeFor(OTP_URL).resolve(IMAGE);
    });

    expect(
      screen.getByRole("img", {
        name: "QR code to scan with your authenticator app",
      }),
    ).toHaveAttribute("src", IMAGE);
    expect(screen.queryByRole("img", { name: OTP_URL })).toBeNull();
  });

  test("draws the code for the text it shows now, not a late one made for text it showed before", async () => {
    const { rerender } = render(<QRCodeElement text="first" />);
    await settle();

    rerender(<QRCodeElement text="second" />);
    await settle();

    await act(async () => {
      codeFor("second").resolve("data:image/svg+xml,second");
    });
    await act(async () => {
      codeFor("first").resolve("data:image/svg+xml,first");
    });

    expect(screen.getByTestId("qr-code")).toHaveAttribute(
      "src",
      "data:image/svg+xml,second",
    );
  });

  test("never shows the code of the text it showed before while the new text's code is made", async () => {
    const { rerender } = render(<QRCodeElement text="first" />);
    await settle();
    await act(async () => {
      codeFor("first").resolve("data:image/svg+xml,first");
    });

    expect(screen.getByTestId("qr-code")).toHaveAttribute(
      "src",
      "data:image/svg+xml,first",
    );

    rerender(<QRCodeElement text="second" />);

    expect(screen.queryByTestId("qr-code")).toBeNull();
    expect(screen.getByTestId("qr-code-loading")).toBeInTheDocument();
  });

  test("says the code could not be shown, in words a person can act on, never the error the script threw", async () => {
    render(<QRCodeElement text={OTP_URL} />);
    await settle();

    await act(async () => {
      codeFor(OTP_URL).reject(new TypeError("L.toDataURL is not a function"));
    });

    const failure: HTMLElement = screen.getByRole("alert");

    expect(failure).toHaveTextContent(FAILED);
    expect(failure).toBe(screen.getByTestId("qr-code-failed"));
    expect(screen.queryByText(/toDataURL/)).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByTestId("qr-code-loading")).toBeNull();
  });

  test("puts the script's error in the console, for whoever looks there to find out why", async () => {
    render(<QRCodeElement text={OTP_URL} />);
    await settle();

    await act(async () => {
      codeFor(OTP_URL).reject(new TypeError("L.toDataURL is not a function"));
    });

    expect(loggedErrors).toEqual([
      "The QR code could not be drawn: L.toDataURL is not a function",
    ]);
  });

  test("tells the page once when the code cannot be drawn, so it can offer another way in", async () => {
    const onError: jest.Mock<void, []> = jest.fn<void, []>();

    render(<QRCodeElement text={OTP_URL} onError={onError} />);
    await settle();

    expect(onError).not.toHaveBeenCalled();

    await act(async () => {
      codeFor(OTP_URL).reject(new Error("The amount of data is too big"));
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("tells the page that drew it last, not the one it was first drawn with", async () => {
    const first: jest.Mock<void, []> = jest.fn<void, []>();
    const latest: jest.Mock<void, []> = jest.fn<void, []>();

    const { rerender } = render(
      <QRCodeElement text={OTP_URL} onError={first} />,
    );
    await settle();
    rerender(<QRCodeElement text={OTP_URL} onError={latest} />);

    // A new callback is not a new code: the library is asked once.
    expect(mockQRCodeImage.pending).toHaveLength(1);

    await act(async () => {
      codeFor(OTP_URL).reject(new Error("failed"));
    });

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  test("says nothing about a code for text it no longer shows", async () => {
    const onError: jest.Mock<void, []> = jest.fn<void, []>();
    const { rerender } = render(
      <QRCodeElement text="first" onError={onError} />,
    );
    await settle();

    rerender(<QRCodeElement text="second" onError={onError} />);
    await settle();

    await act(async () => {
      codeFor("first").reject(new Error("failed"));
    });

    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loggedErrors).toEqual([]);

    await act(async () => {
      codeFor("second").resolve("data:image/svg+xml,second");
    });

    expect(screen.getByTestId("qr-code")).toHaveAttribute(
      "src",
      "data:image/svg+xml,second",
    );
  });

  test("tries again for a new text after a code could not be drawn", async () => {
    const { rerender } = render(<QRCodeElement text="first" />);
    await settle();
    await act(async () => {
      codeFor("first").reject(new Error("failed"));
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<QRCodeElement text="second" />);
    await settle();

    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      codeFor("second").resolve("data:image/svg+xml,second");
    });

    expect(screen.getByTestId("qr-code")).toHaveAttribute(
      "src",
      "data:image/svg+xml,second",
    );
  });

  test("speaks the reader's language", async () => {
    const inGerman: (element: ReactElement) => void = (
      element: ReactElement,
    ): void => {
      render(<I18nextProvider i18n={german}>{element}</I18nextProvider>);
    };

    inGerman(<QRCodeElement text={OTP_URL} />);

    expect(screen.getByRole("img", { name: "QR-Code" })).toBeInTheDocument();

    await settle();
    await act(async () => {
      codeFor(OTP_URL).reject(new Error("failed"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Der QR-Code konnte nicht angezeigt werden.",
    );
  });
});
