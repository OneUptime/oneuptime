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
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import { Mock, SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Headers from "../../../Types/API/Headers";
import APIException from "../../../Types/Exception/ApiException";
import { JSONObject } from "../../../Types/JSON";
import Button, { ButtonStyleType } from "../../../UI/Components/Button/Button";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import ResendVerificationEmail, {
  ComponentProps,
} from "../../../../App/FeatureSet/Accounts/src/Components/ResendVerificationEmail/ResendVerificationEmail";

/*
 * The "Resend verification email" button, rendered for real with the
 * Accounts translations and only the network mocked.
 *
 * WHY THE CLOCK IS FAKE. The countdown is the whole point of this component:
 * a button that is disabled for exactly as long as the server will refuse,
 * with the wait written next to it. A test that waited on the real clock
 * would either take minutes or assert on whatever second it happened to land
 * in. The clock only moves here when a test says so, one whole second at a
 * time, so every countdown below is an exact string.
 *
 * WHY waitFor IS NOT USED. With fake timers, Testing Library's waitFor
 * advances the clock between polls. A mocked request settles in a handful of
 * microtasks, so settle() flushes those inside act() instead and the
 * countdown stays where the test put it.
 *
 * WHY THE ENGLISH SENTENCES. The component's whole surface comes out of t();
 * asserting on the English copy from Locales/en.json means a renamed or
 * missing key fails here instead of shipping as a dotted path.
 */

const RESEND_TOKEN: string =
  "v1.eyJ2IjoxLCJ1IjoiMzMzMyJ9.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmUtc2ln";
const VERIFICATION_TOKEN: string = "8f2d1c3a-4b5e-4f60-8a71-92b3c4d5e6f7";

// Straight out of en.json.
const BUTTON: string = "Resend verification email";
const SENT: string =
  "We've sent a new verification link. It can take a minute or two to arrive.";
const WAIT: string =
  "A verification email was sent recently. You can request another one when the timer runs out.";
const ALREADY_VERIFIED: string =
  "Your email address is already verified. You can sign in now.";
const FAILED: string =
  "We couldn't send a new verification email. Please try again in a moment.";
const CONTINUE_TO_SIGN_IN: string = "Continue to sign in";

// The server's curated refusals (flat locale keys in en.json).
const INVALID_REQUEST: string =
  "This verification request is no longer valid. Sign in with your email and password and we will send you a new verification link.";
const BLOCKED: string =
  "Your account has been blocked. Please contact your administrator.";
const RATE_LIMITED: string =
  "Too many requests for a new verification email. Please try again later.";
const UNAVAILABLE: string =
  "Unable to send a verification email right now. Please try again shortly.";

type CountdownFunction = (time: string) => string;

const countdown: CountdownFunction = (time: string): string => {
  return `You can request another email in ${time}.`;
};

type Answer = HTTPResponse<JSONObject> | HTTPErrorResponse;

interface Deferred {
  promise: Promise<Answer>;
  resolve: (answer: Answer) => void;
  reject: (error: unknown) => void;
}

type DeferredFunction = () => Deferred;

const deferred: DeferredFunction = (): Deferred => {
  let resolve: (answer: Answer) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise: Promise<Answer> = new Promise<Answer>(
    (
      onResolve: (answer: Answer) => void,
      onReject: (error: unknown) => void,
    ): void => {
      resolve = onResolve;
      reject = onReject;
    },
  );
  return { promise, resolve, reject };
};

type ResendAnswerFunction = (body: JSONObject) => HTTPResponse<JSONObject>;

const ok: ResendAnswerFunction = (
  body: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, body, {});
};

type SecondsAnswerFunction = (seconds: number) => HTTPResponse<JSONObject>;

const sent: SecondsAnswerFunction = (
  seconds: number,
): HTTPResponse<JSONObject> => {
  return ok({
    emailSent: true,
    alreadyVerified: false,
    retryAfterSeconds: seconds,
  });
};

const coolingDown: SecondsAnswerFunction = (
  seconds: number,
): HTTPResponse<JSONObject> => {
  return ok({
    emailSent: false,
    alreadyVerified: false,
    retryAfterSeconds: seconds,
  });
};

const alreadyVerified: () => HTTPResponse<JSONObject> =
  (): HTTPResponse<JSONObject> => {
    return ok({
      emailSent: false,
      alreadyVerified: true,
      retryAfterSeconds: 0,
    });
  };

type RefusalFunction = (
  statusCode: number,
  message: string,
  headers?: Headers,
) => HTTPErrorResponse;

const refusal: RefusalFunction = (
  statusCode: number,
  message: string,
  headers: Headers = {},
): HTTPErrorResponse => {
  return new HTTPErrorResponse(statusCode, { message: message }, headers);
};

interface PostedRequest {
  url: string;
  data: unknown;
}

let posted: Array<PostedRequest> = [];

/*
 * What the next POST /resend-verification-email answers with. A function so
 * a test can hand back a pending promise, or throw like a dropped
 * connection does.
 */
let answerResend: () => Promise<Answer> = async (): Promise<Answer> => {
  return sent(60);
};

let consoleErrors: SpyInstance<typeof console.error>;

/*
 * Printed once per run by Testing Library 13 itself on React 18.3, whatever
 * the component does. Every other console error fails the test.
 */
const TEST_UTILS_ACT_DEPRECATION: string =
  "`ReactDOMTestUtils.act` is deprecated";

type SettleFunction = () => Promise<void>;

/*
 * Lets a mocked request run to completion inside act(). A handful of
 * microtasks is all the request chain takes; twenty leaves room to spare
 * without ever touching the (fake) clock.
 */
const settle: SettleFunction = async (): Promise<void> => {
  await act(async () => {
    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }
  });
};

type AdvanceFunction = (milliseconds: number) => void;

const advance: AdvanceFunction = (milliseconds: number): void => {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
};

type RenderFunction = (
  props?: Partial<ComponentProps>,
) => ReturnType<typeof render>;

const renderButton: RenderFunction = (
  props: Partial<ComponentProps> = {},
): ReturnType<typeof render> => {
  return render(
    <MemoryRouter>
      <ResendVerificationEmail
        credential={{ resendToken: RESEND_TOKEN }}
        {...props}
      />
    </MemoryRouter>,
  );
};

type ElementFunction = () => HTMLElement;

const button: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("resend-verification-email");
};

const status: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("resend-verification-email-status");
};

type TextFunction = () => string | null;

const countdownText: TextFunction = (): string | null => {
  const element: HTMLElement | null = screen.queryByTestId(
    "resend-verification-email-countdown",
  );
  return element ? element.textContent : null;
};

type ClickFunction = () => Promise<void>;

/*
 * A plain DOM click: it does not move focus, which is what a click on a
 * button that is about to disable itself amounts to in a real browser.
 */
const clickResend: ClickFunction = async (): Promise<void> => {
  fireEvent.click(button());
  await settle();
};

type SetupUserFunction = () => UserEvent;

const setupUser: SetupUserFunction = (): UserEvent => {
  return userEvent.setup({
    delay: null,
    advanceTimers: jest.advanceTimersByTime,
  });
};

type ExpectButtonLabelFunction = () => void;

/*
 * The label never carries the countdown. A label that changes every second
 * is re-announced by some screen readers every second, and the name a voice
 * control user says to press it would keep changing under them.
 */
const expectFixedButtonLabel: ExpectButtonLabelFunction = (): void => {
  expect(button()).toHaveAccessibleName(BUTTON);
  expect(button()).toHaveTextContent(BUTTON);
  expect(button().textContent).not.toMatch(/\d/);
};

/*
 * WHY THE BUTTON'S CLASSES ARE PINNED. The shared Button's OUTLINE style is
 * nothing but two custom classes, btn-outline-secondary and
 * background-very-light-Gray500-on-hover, and no stylesheet the Accounts app
 * loads defines either -- an OUTLINE button there renders as bare text with
 * no border. NORMAL is plain Tailwind (a gray border on white), which the
 * Accounts build does ship, so it is the one that looks like a button.
 *
 * NORMAL also carries md:w-auto and md:ml-3 for dialog footers. The inline
 * width and margin are what keep it full width and flush with the card on a
 * wide screen, where those md: classes would otherwise win over w-full.
 */
const ACCOUNTS_BUTTON_CLASSES: string =
  "w-full justify-center gap-1 disabled:cursor-not-allowed disabled:opacity-60";

// Only Button's NORMAL branch renders these; OUTLINE replaces them wholesale.
const NORMAL_STYLE_CLASSES: Array<string> = ["border-gray-300", "bg-white"];

// OUTLINE's classes, undefined in every stylesheet Accounts loads.
const OUTLINE_STYLE_CLASSES: Array<string> = [
  "btn-outline-secondary",
  "background-very-light-Gray500-on-hover",
];

type ExpectButtonStyleFunction = (element: HTMLElement) => void;

const expectAccountsButtonStyle: ExpectButtonStyleFunction = (
  element: HTMLElement,
): void => {
  expect(element).toHaveClass(...ACCOUNTS_BUTTON_CLASSES.split(" "));
  expect(element).toHaveStyle({ width: "100%", marginLeft: "0px" });

  for (const className of NORMAL_STYLE_CLASSES) {
    expect(element).toHaveClass(className);
  }

  for (const className of OUTLINE_STYLE_CLASSES) {
    expect(element).not.toHaveClass(className);
  }
};

describe("ResendVerificationEmail", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-02T10:00:00.000Z"));

    posted = [];
    answerResend = async (): Promise<Answer> => {
      return sent(60);
    };

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

          return (await answerResend()) as HTTPResponse<JSONObject>;
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

    // Restored before asserting, so one failure cannot leak into the next test.
    jest.useRealTimers();
    jest.restoreAllMocks();

    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }

    // Nothing this component does may leave React complaining.
    expect(reportedErrors).toEqual([]);
  });

  describe("the countdown", () => {
    test("with no wait the button is ready and nothing counts down", () => {
      renderButton();

      expect(button()).toBeEnabled();
      expectFixedButtonLabel();
      expect(countdownText()).toBeNull();
      expect(
        screen.queryByTestId("resend-verification-email-status"),
      ).not.toBeInTheDocument();
      expect(jest.getTimerCount()).toBe(0);
    });

    test("an initial wait disables the button and counts down beside it, never inside it", () => {
      renderButton({ initialCooldownSeconds: 5 });

      expect(button()).toBeDisabled();
      expectFixedButtonLabel();
      expect(countdownText()).toBe(countdown("0:05"));

      const countdownElement: HTMLElement = screen.getByTestId(
        "resend-verification-email-countdown",
      );
      expect(button()).not.toContainElement(countdownElement);
      expect(countdownElement.tagName).toBe("P");
      // Not a live region: a countdown read out every second drowns out the page.
      expect(countdownElement).not.toHaveAttribute("aria-live");
      expect(countdownElement).not.toHaveAttribute("role");
      expect(countdownElement).toHaveClass("tabular-nums");

      for (const [elapsed, time] of [
        [1000, "0:04"],
        [1000, "0:03"],
        [1000, "0:02"],
        [1000, "0:01"],
      ] as const) {
        advance(elapsed);
        expect(countdownText()).toBe(countdown(time));
        expect(button()).toBeDisabled();
        expectFixedButtonLabel();
      }

      advance(1000);

      expect(button()).toBeEnabled();
      expectFixedButtonLabel();
      expect(countdownText()).toBeNull();
      // The ticking stops once there is nothing left to count.
      expect(jest.getTimerCount()).toBe(0);
    });

    test("does not move between whole seconds", () => {
      renderButton({ initialCooldownSeconds: 3 });

      advance(999);
      expect(countdownText()).toBe(countdown("0:03"));

      advance(1);
      expect(countdownText()).toBe(countdown("0:02"));
    });

    test("uses the initial wait as given, with no extra second", () => {
      renderButton({ initialCooldownSeconds: 60 });

      expect(countdownText()).toBe(countdown("1:00"));

      advance(59_000);
      expect(countdownText()).toBe(countdown("0:01"));

      advance(1000);
      expect(button()).toBeEnabled();
    });

    test("shows minutes and seconds for a longer wait", () => {
      renderButton({ initialCooldownSeconds: 725 });

      expect(countdownText()).toBe(countdown("12:05"));

      advance(5000);
      expect(countdownText()).toBe(countdown("12:00"));

      advance(60_000);
      expect(countdownText()).toBe(countdown("11:00"));
    });

    test("rounds a fractional initial wait up", () => {
      renderButton({ initialCooldownSeconds: 2.2 });

      expect(countdownText()).toBe(countdown("0:03"));
    });

    test.each([
      ["zero", 0],
      ["negative", -30],
      ["NaN", Number.NaN],
      ["infinite", Number.POSITIVE_INFINITY],
    ])(
      "treats a %s initial wait as none",
      (_label: string, seconds: number) => {
        renderButton({ initialCooldownSeconds: seconds });

        expect(button()).toBeEnabled();
        expect(countdownText()).toBeNull();
      },
    );

    test("caps an absurd initial wait at one day", () => {
      renderButton({ initialCooldownSeconds: 30 * 24 * 60 * 60 });

      expect(countdownText()).toBe(countdown("1440:00"));
      expect(button()).toBeDisabled();
    });

    test("recomputes from the clock, so a throttled tab catches up at once", () => {
      renderButton({ initialCooldownSeconds: 30 });

      /*
       * A background tab can go a long time without an interval firing.
       * Moving the wall clock without firing any timer, then letting one
       * tick through, must land on the true remaining time rather than one
       * second less than before.
       */
      jest.setSystemTime(Date.now() + 20_000);
      advance(1000);

      expect(countdownText()).toBe(countdown("0:09"));
    });

    test("a click during the wait sends nothing", async () => {
      renderButton({ initialCooldownSeconds: 10 });

      await clickResend();

      expect(posted).toHaveLength(0);
      expect(
        screen.queryByTestId("resend-verification-email-status"),
      ).not.toBeInTheDocument();
    });

    test("unmounting stops the countdown", () => {
      const { unmount } = renderButton({ initialCooldownSeconds: 30 });

      expect(jest.getTimerCount()).toBe(1);

      unmount();

      expect(jest.getTimerCount()).toBe(0);

      // A tick after unmount would be a state update on a dead component.
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
    });
  });

  describe("sending", () => {
    test("posts the resend token to /resend-verification-email", async () => {
      renderButton();

      await clickResend();

      expect(posted).toEqual([
        {
          url: expect.stringMatching(/\/resend-verification-email$/),
          data: { data: { resendToken: RESEND_TOKEN } },
        },
      ]);
    });

    test("posts a verification token the same way", async () => {
      renderButton({ credential: { verificationToken: VERIFICATION_TOKEN } });

      await clickResend();

      expect(posted).toEqual([
        {
          url: expect.stringMatching(/\/resend-verification-email$/),
          data: { data: { verificationToken: VERIFICATION_TOKEN } },
        },
      ]);
    });

    test("a double click sends exactly one request", async () => {
      /*
       * The second click of a double click lands while the first request is
       * still on the wire -- which is the case the guard exists for.
       */
      const pending: Deferred = deferred();
      answerResend = (): Promise<Answer> => {
        return pending.promise;
      };
      renderButton();
      const user: UserEvent = setupUser();

      await act(async () => {
        await user.dblClick(button());
      });

      expect(posted).toHaveLength(1);

      await act(async () => {
        pending.resolve(sent(60));
      });
      await settle();

      expect(posted).toHaveLength(1);
      expect(status()).toHaveTextContent(SENT);
      expect(button()).toBeDisabled();
    });

    test("two clicks that land before React re-renders still send one request", async () => {
      const pending: Deferred = deferred();
      answerResend = (): Promise<Answer> => {
        return pending.promise;
      };
      renderButton();

      const element: HTMLElement = button();

      /*
       * Both clicks inside one act(): React has not re-rendered the button as
       * disabled in between, so only the ref can stop the second one.
       */
      act(() => {
        element.click();
        element.click();
        element.click();
      });

      expect(posted).toHaveLength(1);

      await act(async () => {
        pending.resolve(sent(60));
      });
      await settle();

      expect(posted).toHaveLength(1);
      expect(status()).toHaveTextContent(SENT);
    });

    test("the button stays disabled and says it is busy while the request runs", async () => {
      const pending: Deferred = deferred();
      answerResend = (): Promise<Answer> => {
        return pending.promise;
      };
      renderButton();

      await clickResend();

      expect(button()).toBeDisabled();
      expect(button()).toHaveAttribute("aria-disabled", "true");
      expectFixedButtonLabel();
      expect(countdownText()).toBeNull();

      await act(async () => {
        pending.resolve(coolingDown(5));
      });
      await settle();

      expect(button()).toBeDisabled();
      expect(countdownText()).toBe(countdown("0:06"));
    });
  });

  describe("what the server answered", () => {
    test("Sent: a success message and the server's cooldown, plus a second of slack", async () => {
      renderButton();

      await clickResend();

      const alert: HTMLElement = status();
      expect(alert).toHaveTextContent(SENT);
      expect(alert).toHaveAttribute("role", "alert");
      expect(alert).toHaveClass("border-emerald-200");
      expect(alert).toHaveClass("mt-4");
      expect(alert).toHaveClass("text-start");

      /*
       * 60 seconds from the server, shown as 1:01: the server rounds and
       * measures against its own timestamps, so a click at exactly 1:00
       * could land early and buy nothing but another refusal.
       */
      expect(countdownText()).toBe(countdown("1:01"));
      expect(button()).toBeDisabled();
      expectFixedButtonLabel();

      advance(60_000);
      expect(countdownText()).toBe(countdown("0:01"));
      expect(button()).toBeDisabled();

      advance(1000);
      expect(button()).toBeEnabled();
      expect(countdownText()).toBeNull();
      // The confirmation stays up after the wait is over.
      expect(status()).toHaveTextContent(SENT);
    });

    test("Sent with no usable wait falls back to the default minute", async () => {
      answerResend = async (): Promise<Answer> => {
        return ok({ emailSent: true });
      };
      renderButton();

      await clickResend();

      expect(status()).toHaveTextContent(SENT);
      expect(countdownText()).toBe(countdown("1:01"));
    });

    test("CoolingDown: an informational message and the wait that is left", async () => {
      answerResend = async (): Promise<Answer> => {
        return coolingDown(42);
      };
      renderButton();

      await clickResend();

      expect(status()).toHaveTextContent(WAIT);
      expect(status()).toHaveClass("border-blue-200");
      expect(countdownText()).toBe(countdown("0:43"));
      expect(button()).toBeDisabled();

      advance(43_000);
      expect(button()).toBeEnabled();
    });

    test("a request after the wait is over goes out and starts a new wait", async () => {
      renderButton({ initialCooldownSeconds: 2 });

      advance(2000);
      await clickResend();

      expect(posted).toHaveLength(1);
      expect(countdownText()).toBe(countdown("1:01"));

      advance(61_000);
      answerResend = async (): Promise<Answer> => {
        return coolingDown(30);
      };
      await clickResend();

      expect(posted).toHaveLength(2);
      expect(status()).toHaveTextContent(WAIT);
      expect(countdownText()).toBe(countdown("0:31"));
    });

    test("AlreadyVerified: the button gives way to a focused sign-in link", async () => {
      const onAlreadyVerified: Mock<() => void> = jest.fn<() => void>();
      answerResend = async (): Promise<Answer> => {
        return alreadyVerified();
      };
      renderButton({ onAlreadyVerified: onAlreadyVerified });

      await clickResend();

      expect(status()).toHaveTextContent(ALREADY_VERIFIED);
      expect(status()).toHaveClass("border-emerald-200");
      expect(
        screen.queryByTestId("resend-verification-email"),
      ).not.toBeInTheDocument();
      expect(countdownText()).toBeNull();

      const signIn: HTMLElement = screen.getByTestId(
        "resend-verification-email-sign-in",
      );
      expect(signIn).toBe(
        screen.getByRole("link", { name: CONTINUE_TO_SIGN_IN }),
      );
      expect(signIn).toHaveAttribute("href", "/accounts/login");
      expect(signIn).toHaveClass("bg-indigo-600");
      expect(signIn).toHaveFocus();

      expect(onAlreadyVerified).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    test("AlreadyVerified wins even while a wait was showing", async () => {
      renderButton({ initialCooldownSeconds: 1 });
      advance(1000);

      answerResend = async (): Promise<Answer> => {
        return alreadyVerified();
      };
      await clickResend();

      expect(countdownText()).toBeNull();
      expect(
        screen.getByTestId("resend-verification-email-sign-in"),
      ).toHaveFocus();
    });

    test("AlreadyVerified works without an onAlreadyVerified callback", async () => {
      answerResend = async (): Promise<Answer> => {
        return alreadyVerified();
      };
      renderButton();

      await clickResend();

      expect(status()).toHaveTextContent(ALREADY_VERIFIED);
      expect(
        screen.getByTestId("resend-verification-email-sign-in"),
      ).toBeInTheDocument();
    });

    test("the sign-in link navigates in the app on a plain click", async () => {
      answerResend = async (): Promise<Answer> => {
        return alreadyVerified();
      };
      renderButton();
      await clickResend();

      const signIn: HTMLElement = screen.getByTestId(
        "resend-verification-email-sign-in",
      );

      const plainClickAllowed: boolean = fireEvent.click(signIn);

      expect(plainClickAllowed).toBe(false);
      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
      expect(
        jest.mocked(Navigation.navigate).mock.calls[0]![0].toString(),
      ).toBe("/accounts/login");
    });

    test.each([
      ["ctrl", { ctrlKey: true }],
      ["meta", { metaKey: true }],
      ["shift", { shiftKey: true }],
      ["alt", { altKey: true }],
    ])(
      "the sign-in link leaves a %s-click to the browser",
      async (_label: string, modifiers: MouseEventInit) => {
        answerResend = async (): Promise<Answer> => {
          return alreadyVerified();
        };
        renderButton();
        await clickResend();

        /*
         * Whether the page left the click to the browser is read last in the
         * event's path; the default is then prevented anyway, because jsdom
         * cannot open a new tab and says so on the console.
         */
        let leftToTheBrowser: boolean | null = null;
        const recordDefault: (event: Event) => void = (event: Event): void => {
          leftToTheBrowser = !event.defaultPrevented;
          event.preventDefault();
        };
        window.addEventListener("click", recordDefault);

        try {
          fireEvent.click(
            screen.getByTestId("resend-verification-email-sign-in"),
            modifiers,
          );
        } finally {
          window.removeEventListener("click", recordDefault);
        }

        expect(leftToTheBrowser).toBe(true);
        expect(Navigation.navigate).not.toHaveBeenCalled();
      },
    );
  });

  describe("refusals and failures", () => {
    test("429 with Retry-After: the wait message and that wait, not the limiter's text", async () => {
      answerResend = async (): Promise<Answer> => {
        return refusal(429, RATE_LIMITED, { "retry-after": "120" });
      };
      renderButton();

      await clickResend();

      expect(status()).toHaveTextContent(WAIT);
      expect(status()).toHaveClass("border-blue-200");
      expect(status()).not.toHaveTextContent(RATE_LIMITED);
      expect(countdownText()).toBe(countdown("2:01"));
      expect(button()).toBeDisabled();

      advance(121_000);
      expect(button()).toBeEnabled();
    });

    test("429 thrown rather than returned is handled the same way", async () => {
      answerResend = async (): Promise<Answer> => {
        throw refusal(429, RATE_LIMITED, { "Retry-After": "15" });
      };
      renderButton();

      await clickResend();

      expect(status()).toHaveTextContent(WAIT);
      expect(countdownText()).toBe(countdown("0:16"));
    });

    test.each([
      ["no Retry-After", {}],
      ["an unreadable Retry-After", { "retry-after": "soon" }],
      ["a zero Retry-After", { "retry-after": "0" }],
    ])(
      "429 with %s waits the default minute",
      async (_label: string, headers: Headers) => {
        answerResend = async (): Promise<Answer> => {
          return refusal(429, RATE_LIMITED, headers);
        };
        renderButton();

        await clickResend();

        expect(status()).toHaveTextContent(WAIT);
        expect(countdownText()).toBe(countdown("1:01"));
      },
    );

    test("429 with a huge Retry-After is capped at a day", async () => {
      answerResend = async (): Promise<Answer> => {
        return refusal(429, RATE_LIMITED, { "retry-after": "999999999" });
      };
      renderButton();

      await clickResend();

      expect(countdownText()).toBe(countdown("1440:01"));
    });

    test("400: the server's curated message, and the button can be tried again", async () => {
      answerResend = async (): Promise<Answer> => {
        return refusal(400, INVALID_REQUEST);
      };
      renderButton();

      await clickResend();

      expect(status()).toHaveTextContent(INVALID_REQUEST);
      expect(status()).toHaveClass("border-red-200");
      expect(status()).not.toHaveTextContent(FAILED);
      expect(countdownText()).toBeNull();
      expect(button()).toBeEnabled();
    });

    test("400 thrown rather than returned is handled the same way", async () => {
      answerResend = async (): Promise<Answer> => {
        throw refusal(400, INVALID_REQUEST);
      };
      renderButton();

      await clickResend();

      expect(status()).toHaveTextContent(INVALID_REQUEST);
    });

    test("403 for a blocked account shows the server's message", async () => {
      answerResend = async (): Promise<Answer> => {
        return refusal(403, BLOCKED);
      };
      renderButton();

      await clickResend();

      expect(status()).toHaveTextContent(BLOCKED);
      expect(status()).toHaveClass("border-red-200");
    });

    test("a curated refusal is shown in the reader's language", async () => {
      await act(async () => {
        await i18n.changeLanguage("fa");
      });
      answerResend = async (): Promise<Answer> => {
        return refusal(400, INVALID_REQUEST);
      };
      renderButton();

      await clickResend();

      const persian: string = i18n.t(INVALID_REQUEST, {
        keySeparator: false,
        nsSeparator: false,
      });
      expect(persian).not.toBe(INVALID_REQUEST);
      expect(status()).toHaveTextContent(persian);
      expect(status()).not.toHaveTextContent(INVALID_REQUEST);
    });

    test.each([
      [500, "Server Error"],
      [502, "Bad Gateway"],
      [503, UNAVAILABLE],
      [504, "Gateway Timeout"],
    ])(
      "%p: the localized failure copy, not the server's text",
      async (statusCode: number, message: string) => {
        answerResend = async (): Promise<Answer> => {
          return refusal(statusCode, message);
        };
        renderButton();

        await clickResend();

        expect(status()).toHaveTextContent(FAILED);
        expect(status()).toHaveClass("border-red-200");
        expect(status()).not.toHaveTextContent(message);
        expect(button()).toBeEnabled();
        expect(countdownText()).toBeNull();
      },
    );

    test.each([
      ["a network error", new APIException("Network Error")],
      ["a plain error", new Error("socket hang up")],
      ["a thrown string", "offline"],
    ])(
      "%s: the localized failure copy",
      async (_label: string, failure: unknown) => {
        answerResend = async (): Promise<Answer> => {
          throw failure;
        };
        renderButton();

        await clickResend();

        expect(status()).toHaveTextContent(FAILED);
        expect(status()).not.toHaveTextContent("Network Error");
        expect(button()).toBeEnabled();
      },
    );

    test("an answer it cannot read is a failure, never 'sent'", async () => {
      answerResend = async (): Promise<Answer> => {
        return ok({ ok: true });
      };
      renderButton();

      await clickResend();

      expect(status()).toHaveTextContent(FAILED);
      expect(status()).not.toHaveTextContent(SENT);
      expect(countdownText()).toBeNull();
    });

    test("the last message is cleared as soon as a new request starts", async () => {
      answerResend = async (): Promise<Answer> => {
        return refusal(500, "Server Error");
      };
      renderButton();

      await clickResend();
      expect(status()).toHaveTextContent(FAILED);

      const pending: Deferred = deferred();
      answerResend = (): Promise<Answer> => {
        return pending.promise;
      };
      await clickResend();

      expect(
        screen.queryByTestId("resend-verification-email-status"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(FAILED)).not.toBeInTheDocument();

      await act(async () => {
        pending.resolve(sent(60));
      });
      await settle();

      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(status()).toHaveTextContent(SENT);
      expect(posted).toHaveLength(2);
    });

    test("a repeated outcome is a fresh alert, so it is announced again", async () => {
      answerResend = async (): Promise<Answer> => {
        return refusal(500, "Server Error");
      };
      renderButton();

      await clickResend();
      const first: HTMLElement = status();

      await clickResend();
      const second: HTMLElement = status();

      expect(second).toHaveTextContent(FAILED);
      expect(second).not.toBe(first);
    });
  });

  describe("focus", () => {
    test("moves to the result when nothing else holds focus", async () => {
      renderButton();

      expect(document.body).toHaveFocus();

      await clickResend();

      const wrapper: HTMLElement | null = status().parentElement;
      expect(wrapper).toHaveAttribute("tabindex", "-1");
      expect(wrapper).toHaveFocus();
    });

    test("moves to the result of a failure as well", async () => {
      answerResend = async (): Promise<Answer> => {
        throw new APIException("Network Error");
      };
      renderButton();

      await clickResend();

      expect(status().parentElement).toHaveFocus();
    });

    test("never pulls someone out of a field they moved to meanwhile", async () => {
      const pending: Deferred = deferred();
      answerResend = (): Promise<Answer> => {
        return pending.promise;
      };
      render(
        <MemoryRouter>
          <ResendVerificationEmail credential={{ resendToken: RESEND_TOKEN }} />
          <input data-testid="elsewhere" aria-label="Elsewhere" />
        </MemoryRouter>,
      );

      await clickResend();

      const elsewhere: HTMLElement = screen.getByTestId("elsewhere");
      act(() => {
        elsewhere.focus();
      });

      await act(async () => {
        pending.resolve(sent(60));
      });
      await settle();

      expect(status()).toHaveTextContent(SENT);
      expect(elsewhere).toHaveFocus();
    });
  });

  describe("lifecycle", () => {
    test("applies className to the root", () => {
      const { container } = renderButton({ className: "mt-6" });

      expect(container.firstElementChild).toHaveClass("mt-6");
      expect(container.firstElementChild).toContainElement(button());
    });

    test("an answer that arrives after unmount changes nothing and warns about nothing", async () => {
      const pending: Deferred = deferred();
      answerResend = (): Promise<Answer> => {
        return pending.promise;
      };
      const { unmount } = renderButton();

      await clickResend();
      unmount();

      await act(async () => {
        pending.resolve(sent(60));
      });
      await settle();

      advance(120_000);
      expect(jest.getTimerCount()).toBe(0);
    });

    test("no timers are left behind once a wait started by a click is unmounted", async () => {
      const { unmount } = renderButton();

      await clickResend();
      expect(jest.getTimerCount()).toBe(1);

      unmount();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("appearance", () => {
    test("is a full-width NORMAL button, never an OUTLINE one", () => {
      renderButton();

      expect(button()).toBeEnabled();
      expectAccountsButtonStyle(button());
    });

    test("keeps the same look while it waits and while it sends", async () => {
      renderButton({ initialCooldownSeconds: 5 });

      expect(button()).toBeDisabled();
      expectAccountsButtonStyle(button());

      advance(5000);
      const pending: Deferred = deferred();
      answerResend = (): Promise<Answer> => {
        return pending.promise;
      };
      await clickResend();

      expect(button()).toBeDisabled();
      expectAccountsButtonStyle(button());

      await act(async () => {
        pending.resolve(sent(60));
      });
      await settle();
    });

    test("the check above fails for an OUTLINE button with the same classes and style", () => {
      /*
       * A control, so the check cannot pass by accident: the shared Button
       * in OUTLINE style, given exactly what the component passes, keeps
       * w-full, justify-center and the inline width -- those come from the
       * caller -- but loses NORMAL's border and background to the two
       * classes Accounts has no CSS for.
       */
      render(
        <Button
          buttonStyle={ButtonStyleType.OUTLINE}
          title={BUTTON}
          dataTestId="outline-control"
          className={ACCOUNTS_BUTTON_CLASSES}
          style={{ width: "100%", marginLeft: 0 }}
        />,
      );

      const outline: HTMLElement = screen.getByTestId("outline-control");
      expect(outline).toHaveClass("w-full", "justify-center");
      expect(outline).toHaveStyle({ width: "100%", marginLeft: "0px" });

      for (const className of NORMAL_STYLE_CLASSES) {
        expect(outline).not.toHaveClass(className);
      }

      for (const className of OUTLINE_STYLE_CLASSES) {
        expect(outline).toHaveClass(className);
      }

      expect(() => {
        expectAccountsButtonStyle(outline);
      }).toThrow();
    });
  });
});
