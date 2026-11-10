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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import AuthenticatorAppSetupCode, {
  copySelectedKeyWhole,
} from "../../../../UI/Components/AuthenticatorAppSetupCode/AuthenticatorAppSetupCode";
import { Logger } from "../../../../UI/Utils/Logger";

/*
 * What a person adds an authenticator app with: its QR code, and the setup
 * key for anyone who cannot scan it (issue #6638). Every QR code once failed
 * to draw, and the sign-in page offered nothing else, so somebody whose
 * administrator requires two-factor authentication could not set it up and
 * could not sign in. The key is folded away under a code that draws, and
 * open in place of one that cannot.
 *
 * The module the QR code loads, QRCodeImage, stands in here so each test
 * decides whether the code is drawn.
 */

interface PendingCode {
  text: string;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
}

const mockQRCodeImage: { pending: Array<PendingCode> } = { pending: [] };

jest.mock("../../../../UI/Components/QR/QRCodeImage", () => {
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

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

const OTP_URL: string =
  "otpauth://totp/OneUptime:ada%40example.com?issuer=OneUptime&secret=MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ&algorithm=SHA1&digits=6&period=30";
const KEY: string = "MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ";
const GROUPS: Array<string> = [
  "MTEA",
  "5EME",
  "V46E",
  "OK5M",
  "XD7E",
  "3ES7",
  "YSRR",
  "R6LQ",
];
const IMAGE: string = "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E";

const CANT_SCAN: string = "Can't scan the QR code?";
const ENTER_KEY: string =
  "Enter this setup key in your authenticator app instead.";
const TIME_BASED: string = "If your app asks, choose a time-based key.";
const QR_FAILED: string = "The QR code could not be shown.";

const GERMAN: Record<string, string> = {
  "QR code": "QR-Code",
  "The QR code could not be shown.":
    "Der QR-Code konnte nicht angezeigt werden.",
  "Can't scan the QR code?": "Sie können den QR-Code nicht scannen?",
  "Enter this setup key in your authenticator app instead.":
    "Geben Sie stattdessen diesen Einrichtungsschlüssel in Ihre Authenticator-App ein.",
  "If your app asks, choose a time-based key.":
    "Falls Ihre App danach fragt, wählen Sie einen zeitbasierten Schlüssel.",
  Copy: "Kopieren",
  "Copied!": "Kopiert!",
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

// Lets the QR code's module load and its code be asked for.
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const drawCode: () => Promise<void> = async (): Promise<void> => {
  await settle();
  await act(async () => {
    mockQRCodeImage.pending[mockQRCodeImage.pending.length - 1]!.resolve(IMAGE);
  });
};

const failCode: () => Promise<void> = async (): Promise<void> => {
  await settle();
  await act(async () => {
    mockQRCodeImage.pending[mockQRCodeImage.pending.length - 1]!.reject(
      new TypeError("L.toDataURL is not a function"),
    );
  });
};

const toggle: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: CANT_SCAN });
};

const shownKey: () => string = (): string => {
  return screen.getByTestId("authenticator-setup-key").textContent || "";
};

const originalClipboard: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  mockQRCodeImage.pending = [];
  jest.spyOn(Logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();

  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  }
});

describe("AuthenticatorAppSetupCode", () => {
  test("draws the QR code of the enrolment", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();

    expect(mockQRCodeImage.pending[0]!.text).toBe(OTP_URL);
    expect(screen.getByTestId("qr-code")).toHaveAttribute("src", IMAGE);
  });

  test("offers the setup key under the code, folded away: most people scan", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveAttribute("type", "button");
    expect(
      screen.queryByTestId("authenticator-setup-key-panel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(GROUPS[0]!)).not.toBeInTheDocument();
  });

  test("opens the key when asked, in groups of four with what to do with it", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();

    fireEvent.click(toggle());

    const panel: HTMLElement = screen.getByTestId(
      "authenticator-setup-key-panel",
    );

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(toggle()).toHaveAttribute("aria-controls", panel.id);
    expect(panel.id).not.toBe("");
    expect(within(panel).getByText(ENTER_KEY)).toBeInTheDocument();
    expect(within(panel).getByText(TIME_BASED)).toBeInTheDocument();

    const groups: Array<string> = Array.from(
      screen.getByTestId("authenticator-setup-key").children,
    ).map((group: Element): string => {
      return group.textContent || "";
    });

    expect(groups).toEqual(GROUPS);
    // The gap between the groups is drawn, not written into the key.
    expect(shownKey()).toBe(KEY);
  });

  test("folds the key away again", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();

    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("authenticator-setup-key-panel"),
    ).not.toBeInTheDocument();
  });

  test("keeps the code in view when the key is open, for whoever can scan after all", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();

    fireEvent.click(toggle());

    expect(screen.getByTestId("qr-code")).toHaveAttribute("src", IMAGE);
  });

  test("copies the key whole, without the gaps it is shown with", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();
    fireEvent.click(toggle());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });

    expect(writeText).toHaveBeenCalledWith(KEY);
    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent(
      "Copied!",
    );
  });

  test("copies the key selected by hand whole too, without the breaks between its groups", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();
    fireEvent.click(toggle());

    const key: HTMLElement = screen.getByTestId("authenticator-setup-key");
    const range: Range = document.createRange();
    range.selectNodeContents(key);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    const setData: ReturnType<
      typeof jest.fn<(format: string, data: string) => void>
    > = jest.fn<(format: string, data: string) => void>();
    const isNotPrevented: boolean = fireEvent.copy(
      key.firstElementChild as HTMLElement,
      { clipboardData: { setData } },
    );

    expect(setData).toHaveBeenCalledWith("text/plain", KEY);
    // The browser's own copy, with a break after each group, does not run.
    expect(isNotPrevented).toBe(false);

    window.getSelection()!.removeAllRanges();
  });

  test("leaves a selection that reaches beyond the key to the browser", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();
    fireEvent.click(toggle());

    const key: HTMLElement = screen.getByTestId("authenticator-setup-key");
    const range: Range = document.createRange();
    range.setStart(key.firstElementChild!.firstChild!, 0);
    range.setEnd(screen.getByText(TIME_BASED).firstChild!, 6);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    const setData: ReturnType<
      typeof jest.fn<(format: string, data: string) => void>
    > = jest.fn<(format: string, data: string) => void>();
    const isNotPrevented: boolean = fireEvent.copy(
      key.firstElementChild as HTMLElement,
      { clipboardData: { setData } },
    );

    expect(setData).not.toHaveBeenCalled();
    expect(isNotPrevented).toBe(true);

    window.getSelection()!.removeAllRanges();
  });

  test("reads the key left to right, a right-to-left page included", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();
    fireEvent.click(toggle());

    expect(screen.getByTestId("authenticator-setup-key")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("shows the key in place of a code that cannot be drawn, so setting up never comes to a dead end", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await failCode();

    expect(screen.getByRole("alert")).toHaveTextContent(QR_FAILED);
    expect(screen.queryByText(/toDataURL/)).not.toBeInTheDocument();

    const panel: HTMLElement = screen.getByTestId(
      "authenticator-setup-key-panel",
    );

    expect(within(panel).getByText(ENTER_KEY)).toBeInTheDocument();
    expect(shownKey()).toBe(KEY);
    // No code to fail to scan, and nothing to unfold.
    expect(
      screen.queryByRole("button", { name: CANT_SCAN }),
    ).not.toBeInTheDocument();
  });

  test("opens the key on a failed code even after it was folded away", async () => {
    render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await settle();

    fireEvent.click(toggle());
    fireEvent.click(toggle());

    await act(async () => {
      mockQRCodeImage.pending[0]!.reject(new Error("failed"));
    });

    expect(shownKey()).toBe(KEY);
  });

  test("offers no key for an enrolment whose URL has none to read, rather than one that cannot work", async () => {
    render(
      <AuthenticatorAppSetupCode otpUrl="otpauth://totp/OneUptime?issuer=OneUptime" />,
    );
    await drawCode();

    expect(
      screen.queryByRole("button", { name: CANT_SCAN }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("authenticator-setup-key-panel"),
    ).not.toBeInTheDocument();
  });

  test("still says the code could not be shown when there is no key to offer", async () => {
    render(
      <AuthenticatorAppSetupCode otpUrl="otpauth://totp/OneUptime?issuer=OneUptime" />,
    );
    await failCode();

    expect(screen.getByRole("alert")).toHaveTextContent(QR_FAILED);
    expect(
      screen.queryByTestId("authenticator-setup-key-panel"),
    ).not.toBeInTheDocument();
  });

  test("shows the key of the enrolment it is given now", async () => {
    const { rerender } = render(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();
    fireEvent.click(toggle());

    rerender(
      <AuthenticatorAppSetupCode otpUrl="otpauth://totp/OneUptime:ada?secret=ABCDEFGHIJKLMNOP" />,
    );

    expect(shownKey()).toBe("ABCDEFGHIJKLMNOP");
  });

  test("speaks the reader's language", async () => {
    const inGerman: (element: ReactElement) => void = (
      element: ReactElement,
    ): void => {
      render(<I18nextProvider i18n={german}>{element}</I18nextProvider>);
    };

    inGerman(<AuthenticatorAppSetupCode otpUrl={OTP_URL} />);
    await drawCode();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sie können den QR-Code nicht scannen?",
      }),
    );

    expect(
      screen.getByText(
        "Geben Sie stattdessen diesen Einrichtungsschlüssel in Ihre Authenticator-App ein.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Falls Ihre App danach fragt, wählen Sie einen zeitbasierten Schlüssel.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Kopieren" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR-Code" })).toBeInTheDocument();
  });
});

describe("copySelectedKeyWhole", () => {
  type CopyEventStandIn = {
    event: React.ClipboardEvent<HTMLElement>;
    setData: ReturnType<typeof jest.fn<(format: string, data: string) => void>>;
    preventDefault: ReturnType<typeof jest.fn<() => void>>;
  };

  const copyEvent: () => CopyEventStandIn = (): CopyEventStandIn => {
    const setData: ReturnType<
      typeof jest.fn<(format: string, data: string) => void>
    > = jest.fn<(format: string, data: string) => void>();
    const preventDefault: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    return {
      event: {
        clipboardData: { setData },
        preventDefault,
      } as unknown as React.ClipboardEvent<HTMLElement>,
      setData,
      preventDefault,
    };
  };

  const keyElement: () => HTMLElement = (): HTMLElement => {
    const key: HTMLElement = document.createElement("code");
    key.innerHTML = "<span>MTEA</span><span>5EME</span><span>V46E</span>";
    document.body.appendChild(key);
    return key;
  };

  // A selection as a browser reads it off the groups: a line for each.
  const selecting: (text: string, within: Node) => void = (
    text: string,
    within: Node,
  ): void => {
    jest.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      getRangeAt: (): Partial<Range> => {
        return { commonAncestorContainer: within };
      },
      toString: (): string => {
        return text;
      },
    } as unknown as Selection);
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("copies the groups a browser reads a line each as one string", () => {
    const key: HTMLElement = keyElement();
    const copy: CopyEventStandIn = copyEvent();

    selecting("MTEA\n5EME\nV46E\n", key);
    copySelectedKeyWhole(copy.event, key);

    expect(copy.setData).toHaveBeenCalledWith("text/plain", "MTEA5EMEV46E");
    expect(copy.preventDefault).toHaveBeenCalledTimes(1);
  });

  test("copies part of the key as the characters selected", () => {
    const key: HTMLElement = keyElement();
    const copy: CopyEventStandIn = copyEvent();

    selecting("5E", key.children[1]!.firstChild!);
    copySelectedKeyWhole(copy.event, key);

    expect(copy.setData).toHaveBeenCalledWith("text/plain", "5E");
  });

  test("leaves the browser to copy a selection beyond the key, an empty one, or none", () => {
    const key: HTMLElement = keyElement();
    const outside: HTMLElement = document.createElement("p");
    document.body.appendChild(outside);

    for (const [text, within] of [
      ["MTEA\nIf your app asks", document.body],
      ["Somewhere else", outside],
      [" \n ", key],
    ] as Array<[string, Node]>) {
      const copy: CopyEventStandIn = copyEvent();

      selecting(text, within);
      copySelectedKeyWhole(copy.event, key);

      expect(copy.setData).not.toHaveBeenCalled();
      expect(copy.preventDefault).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    }

    const noSelection: CopyEventStandIn = copyEvent();
    jest.spyOn(window, "getSelection").mockReturnValue(null);
    copySelectedKeyWhole(noSelection.event, key);
    expect(noSelection.setData).not.toHaveBeenCalled();

    const noKey: CopyEventStandIn = copyEvent();
    selecting("MTEA", key);
    copySelectedKeyWhole(noKey.event, null);
    expect(noKey.setData).not.toHaveBeenCalled();
  });
});
