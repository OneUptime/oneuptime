import "@testing-library/jest-dom";
import {
  afterEach,
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
import { Mock, SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import { formatCountdown } from "../../../../App/FeatureSet/Accounts/src/Utils/VerificationEmailResend";
import VerifyEmailPending, {
  ComponentProps,
} from "../../../../App/FeatureSet/Accounts/src/Components/VerifyEmailPending/VerifyEmailPending";

/*
 * The screen a hosted signup lands on, rendered for real with the Accounts
 * translations. Everything on it exists to get one email opened: the address
 * it went to (so a typo is caught now), a shortcut to the inbox, a way to get
 * another link without signing in, and a way back to the form when the
 * address was wrong. Each of those is only offered when it can work, and
 * these tests pin both halves: present when it should be, absent otherwise.
 *
 * The clock is fake because the resend button under the card counts down
 * from the moment the screen appears; a real interval would tick outside
 * act() partway through a slow test.
 */

const EMAIL: string = "ada@example.com";
const RESEND_TOKEN: string =
  "v1.eyJ2IjoxLCJ1IjoiMzMzMyJ9.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmUtc2ln";

// Straight out of en.json.
const TITLE: string = "Verify your email to finish signing up";
const SENT_TO: (email: string) => string = (email: string): string => {
  return `We've sent a verification link to ${email}.`;
};
const SENT_GENERIC: string = "We've sent you a verification link.";
const INSTRUCTIONS: string =
  "Open the link in that email to activate your account, then sign in.";
const SPAM_HINT: string =
  "Can't find it? Check your spam or junk folder. The link expires in 24 hours.";
const SIGN_IN_FALLBACK_HINT: string =
  "Can't find it? Check your spam folder. The link expires in 24 hours, and signing in with your email and password sends you a new one.";
const OPENS_IN_NEW_TAB: string = "(opens in a new tab)";
const ALREADY_VERIFIED_PROMPT: string = "Already verified your email?";
const GO_TO_SIGN_IN: string = "Go to sign in";
const WRONG_ADDRESS: string = "Wrong email address?";
const USE_DIFFERENT_EMAIL: string = "Sign up with a different email";
const RESEND_BUTTON: string = "Resend verification email";
const SENT: string =
  "We've sent a new verification link. It can take a minute or two to arrive.";

const TEST_UTILS_ACT_DEPRECATION: string =
  "`ReactDOMTestUtils.act` is deprecated";

type CountdownFunction = (time: string) => string;

const countdown: CountdownFunction = (time: string): string => {
  return `You can request another email in ${time}.`;
};

let posted: Array<{ url: string; data: unknown }> = [];
let consoleErrors: SpyInstance<typeof console.error>;

type RenderFunction = (
  props?: Partial<ComponentProps>,
) => ReturnType<typeof render>;

const renderScreen: RenderFunction = (
  props: Partial<ComponentProps> = {},
): ReturnType<typeof render> => {
  return render(
    <MemoryRouter>
      <VerifyEmailPending email={EMAIL} {...props} />
    </MemoryRouter>,
  );
};

type ElementFunction = () => HTMLElement;

const card: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("verify-email-required");
};

const heading: ElementFunction = (): HTMLElement => {
  return screen.getByRole("heading", { level: 1 });
};

type AdvanceFunction = (milliseconds: number) => void;

const advance: AdvanceFunction = (milliseconds: number): void => {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
};

type SettleFunction = () => Promise<void>;

const settle: SettleFunction = async (): Promise<void> => {
  await act(async () => {
    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }
  });
};

type IsBeforeFunction = (first: Node, second: Node) => boolean;

const isBefore: IsBeforeFunction = (first: Node, second: Node): boolean => {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
};

describe("VerifyEmailPending", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-02T10:00:00.000Z"));

    posted = [];
    consoleErrors = jest.spyOn(console, "error");

    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: Parameters<typeof API.post>[0],
        ): Promise<HTTPResponse<JSONObject>> => {
          const url: string = options.url.toString();
          posted.push({ url: url, data: options.data });

          if (!url.endsWith("/resend-verification-email")) {
            throw new Error(`Unexpected request to ${url}`);
          }

          return new HTTPResponse<JSONObject>(
            200,
            { emailSent: true, alreadyVerified: false, retryAfterSeconds: 60 },
            {},
          );
        },
      );
  });

  afterEach(async () => {
    cleanup();

    const reportedErrors: Array<string> = consoleErrors.mock.calls
      .map((call: Array<unknown>) => {
        return call.map(String).join(" ");
      })
      .filter((message: string) => {
        return !message.includes(TEST_UTILS_ACT_DEPRECATION);
      });

    jest.useRealTimers();
    jest.restoreAllMocks();

    // Language is shared by every test in the file: always put English back.
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }

    expect(reportedErrors).toEqual([]);
  });

  describe("the address", () => {
    test("is emphasised inside the sentence that names it", () => {
      renderScreen();

      const address: HTMLElement = screen.getByTestId("verify-email-address");
      expect(address.tagName).toBe("STRONG");
      expect(address).toHaveTextContent(EMAIL);
      expect(address).toHaveClass("font-semibold");
      expect(address).toHaveClass("[overflow-wrap:anywhere]");

      // Isolated, so an address stays left-to-right even inside Persian text.
      const isolate: Element | null = address.querySelector("bdi");
      expect(isolate).not.toBeNull();
      expect(isolate!.textContent).toBe(EMAIL);
      expect(address.children).toHaveLength(1);

      const sentence: HTMLElement | null = address.closest("p");
      expect(sentence).not.toBeNull();
      expect(sentence!.textContent).toBe(SENT_TO(EMAIL));
      expect(
        sentence!.textContent!.startsWith("We've sent a verification link to "),
      ).toBe(true);
      expect(within(card()).getAllByText(EMAIL, { exact: false })).toHaveLength(
        1,
      );
    });

    test("is shown exactly as typed, markup and all, never interpreted", () => {
      const suspicious: string = "ada+<img src=x onerror=alert(1)>@example.com";
      const { container } = renderScreen({ email: suspicious });

      expect(screen.getByTestId("verify-email-address")).toHaveTextContent(
        suspicious,
      );
      expect(container.querySelector("img[src='x']")).toBeNull();
    });

    test("an empty address falls back to the generic sentence", () => {
      renderScreen({ email: "" });

      expect(screen.getByText(SENT_GENERIC)).toBeInTheDocument();
      expect(
        screen.queryByTestId("verify-email-address"),
      ).not.toBeInTheDocument();
      expect(card()).not.toHaveTextContent("We've sent a verification link to");
      expect(screen.queryByTestId("open-webmail")).not.toBeInTheDocument();
    });

    test("the screen says what to do next", () => {
      renderScreen();

      expect(heading()).toHaveTextContent(TITLE);
      expect(screen.getByText(INSTRUCTIONS)).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "OneUptime" }),
      ).toBeInTheDocument();
    });
  });

  describe("focus", () => {
    test("lands on the heading as the screen replaces the form", () => {
      renderScreen();

      expect(heading()).toHaveTextContent(TITLE);
      expect(heading()).toHaveAttribute("tabindex", "-1");
      expect(heading()).toHaveFocus();
    });

    test("lands on the heading with or without a resend token", () => {
      renderScreen({ resendToken: RESEND_TOKEN });

      expect(heading()).toHaveFocus();
    });
  });

  describe("the inbox shortcut", () => {
    test.each([
      ["ada@gmail.com", "Gmail", "https://mail.google.com/mail/u/0/#inbox"],
      [
        "ada@googlemail.com",
        "Gmail",
        "https://mail.google.com/mail/u/0/#inbox",
      ],
      ["ada@outlook.com", "Outlook", "https://outlook.live.com/mail/0/"],
      ["ada@hotmail.co.uk", "Outlook", "https://outlook.live.com/mail/0/"],
      ["ada@live.de", "Outlook", "https://outlook.live.com/mail/0/"],
      ["ada@yahoo.com", "Yahoo Mail", "https://mail.yahoo.com/"],
      ["ada@yahoo.co.jp", "Yahoo Mail", "https://mail.yahoo.com/"],
      ["ada@icloud.com", "iCloud Mail", "https://www.icloud.com/mail"],
      ["ada@proton.me", "Proton Mail", "https://mail.proton.me/"],
      ["Ada@PM.ME", "Proton Mail", "https://mail.proton.me/"],
    ])(
      "offers %s a link to %s",
      (email: string, provider: string, url: string) => {
        renderScreen({ email: email });

        const link: HTMLElement = screen.getByTestId("open-webmail");
        expect(link.tagName).toBe("A");
        expect(link).toHaveAttribute("href", url);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        expect(link).toHaveTextContent(`Open ${provider}`);
        expect(link).toHaveAccessibleName(
          `Open ${provider} ${OPENS_IN_NEW_TAB}`,
        );
        expect(
          screen.getByRole("link", {
            name: `Open ${provider} ${OPENS_IN_NEW_TAB}`,
          }),
        ).toBe(link);

        // The new-tab warning is for screen readers only.
        const note: HTMLElement = within(link).getByText(OPENS_IN_NEW_TAB);
        expect(note).toHaveClass("sr-only");
      },
    );

    test.each([
      ["a company domain", "ada@acme.com"],
      ["a look-alike domain", "ada@gmail.com.evil.io"],
      ["a look-alike prefix", "ada@notgmail.com"],
      ["two at signs", "a@b@gmail.com"],
      ["no domain", "ada@"],
    ])("offers no link for %s", (_label: string, email: string) => {
      renderScreen({ email: email });

      expect(screen.queryByTestId("open-webmail")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /^Open / }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(OPENS_IN_NEW_TAB)).not.toBeInTheDocument();
    });

    test("the link never carries the address", () => {
      renderScreen({ email: "ada.lovelace+signup@gmail.com" });

      const href: string =
        screen.getByTestId("open-webmail").getAttribute("href") || "";
      expect(href).not.toContain("ada");
      expect(href).not.toContain("lovelace");
    });
  });

  describe("getting another link", () => {
    test("with a resend token: the spam hint and a resend button that counts down", () => {
      renderScreen({ resendToken: RESEND_TOKEN, resendAvailableInSeconds: 45 });

      expect(screen.getByText(SPAM_HINT)).toBeInTheDocument();
      expect(screen.queryByText(SIGN_IN_FALLBACK_HINT)).not.toBeInTheDocument();

      const resend: HTMLElement = screen.getByTestId(
        "resend-verification-email",
      );
      expect(resend).toHaveAccessibleName(RESEND_BUTTON);
      expect(resend).toBeDisabled();
      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("0:45"));
      expect(card()).toContainElement(resend);
      expect(resend.parentElement).toHaveClass("mt-4");
    });

    test("with a resend token and no wait given: the default minute", () => {
      renderScreen({ resendToken: RESEND_TOKEN });

      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("1:00"));
    });

    test("with a resend token and no wait: the button is ready at once", () => {
      renderScreen({ resendToken: RESEND_TOKEN, resendAvailableInSeconds: 0 });

      expect(screen.getByTestId("resend-verification-email")).toBeEnabled();
      expect(
        screen.queryByTestId("resend-verification-email-countdown"),
      ).not.toBeInTheDocument();
    });

    test("once the wait is over, the button sends the resend token", async () => {
      renderScreen({ resendToken: RESEND_TOKEN, resendAvailableInSeconds: 3 });

      advance(3000);
      const resend: HTMLElement = screen.getByTestId(
        "resend-verification-email",
      );
      expect(resend).toBeEnabled();

      fireEvent.click(resend);
      await settle();

      expect(posted).toEqual([
        {
          url: expect.stringMatching(/\/resend-verification-email$/),
          data: { data: { resendToken: RESEND_TOKEN } },
        },
      ]);
      expect(
        screen.getByTestId("resend-verification-email-status"),
      ).toHaveTextContent(SENT);
    });

    test("without a resend token: the sign-in advice and no button", () => {
      renderScreen();

      expect(screen.getByText(SIGN_IN_FALLBACK_HINT)).toBeInTheDocument();
      expect(screen.queryByText(SPAM_HINT)).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("resend-verification-email"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: RESEND_BUTTON }),
      ).not.toBeInTheDocument();
      expect(jest.getTimerCount()).toBe(0);
    });

    test("an empty resend token counts as none", () => {
      renderScreen({ resendToken: "" });

      expect(screen.getByText(SIGN_IN_FALLBACK_HINT)).toBeInTheDocument();
      expect(
        screen.queryByTestId("resend-verification-email"),
      ).not.toBeInTheDocument();
    });
  });

  describe("a wrong address", () => {
    test("offers to sign up again with a different email", () => {
      const onUseDifferentEmail: Mock<() => void> = jest.fn<() => void>();
      renderScreen({ onUseDifferentEmail: onUseDifferentEmail });

      const button: HTMLElement = screen.getByTestId(
        "verify-email-use-different-email",
      );
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAccessibleName(USE_DIFFERENT_EMAIL);
      expect(button.closest("p")).toHaveTextContent(
        `${WRONG_ADDRESS} ${USE_DIFFERENT_EMAIL}`,
      );

      fireEvent.click(button);

      expect(onUseDifferentEmail).toHaveBeenCalledTimes(1);
    });

    test("is not offered without somewhere to go", () => {
      renderScreen();

      expect(
        screen.queryByTestId("verify-email-use-different-email"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(WRONG_ADDRESS)).not.toBeInTheDocument();
      expect(screen.queryByText(USE_DIFFERENT_EMAIL)).not.toBeInTheDocument();
    });
  });

  describe("signing in", () => {
    test("links to the sign-in page below the card", () => {
      renderScreen();

      const link: HTMLElement = screen.getByRole("link", {
        name: GO_TO_SIGN_IN,
      });
      expect(link).toHaveAttribute("href", "/accounts/login");
      expect(link.closest("p")).toHaveTextContent(
        `${ALREADY_VERIFIED_PROMPT} ${GO_TO_SIGN_IN}`,
      );
      expect(card()).not.toContainElement(link);
      expect(isBefore(card(), link)).toBe(true);
    });
  });

  describe("layout", () => {
    test("keeps its parts in reading order", () => {
      const { container } = renderScreen({
        email: "ada@gmail.com",
        resendToken: RESEND_TOKEN,
        onUseDifferentEmail: () => {},
      });

      const order: Array<Node> = [
        heading(),
        screen.getByTestId("verify-email-address"),
        screen.getByTestId("verify-email-use-different-email"),
        screen.getByText(INSTRUCTIONS),
        screen.getByTestId("open-webmail"),
        container.querySelector("hr") as Node,
        screen.getByText(SPAM_HINT),
        screen.getByTestId("resend-verification-email"),
        screen.getByRole("link", { name: GO_TO_SIGN_IN }),
      ];

      expect(order.every(Boolean)).toBe(true);

      for (let index: number = 1; index < order.length; index++) {
        expect(isBefore(order[index - 1]!, order[index]!)).toBe(true);
      }
    });

    test("uses no dark-mode styles (Accounts is light only)", () => {
      const { container } = renderScreen({
        email: "ada@gmail.com",
        resendToken: RESEND_TOKEN,
        onUseDifferentEmail: () => {},
      });

      expect(container.innerHTML).not.toContain("dark:");
    });
  });

  describe("direction and language", () => {
    test("the card is left-to-right in English", () => {
      renderScreen();

      expect(card()).toHaveAttribute("dir", "ltr");
    });

    test("the card is right-to-left in Persian, and the address stays isolated", async () => {
      await act(async () => {
        await i18n.changeLanguage("fa");
      });

      renderScreen({ resendToken: RESEND_TOKEN, resendAvailableInSeconds: 60 });

      expect(card()).toHaveAttribute("dir", "rtl");

      const persianTitle: string = i18n.t("register.verifyEmailTitle");
      expect(persianTitle).not.toBe(TITLE);
      expect(heading()).toHaveTextContent(persianTitle);
      expect(heading()).toHaveFocus();

      const address: HTMLElement = screen.getByTestId("verify-email-address");
      expect(address.querySelector("bdi")!.textContent).toBe(EMAIL);
      expect(address.closest("p")!.textContent).toBe(
        i18n.t("register.verifyEmailSentTo", { email: EMAIL }),
      );

      // The countdown uses Persian numerals.
      const countdownText: string =
        screen.getByTestId("resend-verification-email-countdown").textContent ||
        "";
      expect(countdownText).toContain(formatCountdown(60, "fa"));
      expect(countdownText).not.toContain("1:00");
    });

    test("English is back for the next test", () => {
      renderScreen();

      expect(i18n.language).toBe("en");
      expect(heading()).toHaveTextContent(TITLE);
      expect(card()).toHaveAttribute("dir", "ltr");
    });
  });
});
