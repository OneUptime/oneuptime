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
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import ReauthenticationPrompt, {
  REAUTHENTICATION_PROMPT_COPY,
} from "../../../UI/Components/Reauthentication/ReauthenticationPrompt";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import {
  REAUTHENTICATION_FIELDS,
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_ROUTE,
  REAUTHENTICATION_WEBAUTHN_OPTIONS_ROUTE,
  ReauthenticationMethods,
  ReauthenticationWebAuthnKind,
} from "../../../Types/Accounts/Reauthentication";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ACCOUNTS_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import Reauthentication from "../../../UI/Utils/Reauthentication";
import SessionEndReturn from "../../../UI/Utils/SessionEndReturn";
import UserUtil from "../../../UI/Utils/User";
import WebAuthn from "../../../UI/Utils/WebAuthn";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * CONFIRM IT'S YOU (#10155): the Dashboard's one prompt, rendered.
 *
 * The API client hands the prompt every change the server refused until the
 * session confirms it's its person's (Common/UI/Utils/Reauthentication);
 * the prompt asks for what signs the account in, and answers true once the
 * server took the confirmation - then the change is sent again. Pinned here,
 * against the server's answers:
 *
 *   - what it asks each kind of account: a password; a password and the
 *     second step (an authenticator code, a security key or a backup code,
 *     one link from each other); a passkey, alone or instead; Sign In Again
 *     for an account with neither;
 *   - what it sends, and that it answers true once the server took it;
 *   - what is wrong, said under its field in the reader's words, the dialog
 *     staying open; a key's failure over the dialog;
 *   - Cancel, Sign In Again and a status that cannot be read answer false;
 *   - the password field a password manager fills, and the address beside
 *     it;
 *   - in German and Persian, from the Dashboard's shipped locale files.
 */

const USER_ID: ObjectID = new ObjectID("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
const STATUS_URL: string = REAUTHENTICATION_ROUTE;
const OPTIONS_URL: string = REAUTHENTICATION_WEBAUTHN_OPTIONS_ROUTE;

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");

const PASSWORD_ONLY: ReauthenticationMethods = {
  password: true,
  secondStep: null,
  passkey: false,
  signInAgain: false,
};

const TWO_FACTOR: ReauthenticationMethods = {
  password: true,
  secondStep: { authenticatorApp: true, securityKey: true, backupCode: true },
  passkey: false,
  signInAgain: false,
};

let methods: ReauthenticationMethods;
let isConfirmed: boolean;
let confirmations: Array<JSONObject>;
let confirmationAnswers: Array<HTTPResponse<JSONObject> | HTTPErrorResponse>;
let optionsAsked: Array<JSONObject>;

function statusAnswer(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      isConfirmed: isConfirmed,
      confirmedUntil: isConfirmed ? "2026-11-20T10:10:00.000Z" : null,
      windowInMinutes: 10,
      methods: methods as unknown as JSONObject,
    },
    {},
  );
}

function refusal(message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(400, { message: message }, {});
}

function readText(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

// Opens the prompt as the API client does, and waits for it to draw.
async function ask(): Promise<{ answer: Promise<boolean> }> {
  let answer: Promise<boolean> = Promise.resolve(false);

  await act(async (): Promise<void> => {
    answer = Reauthentication.ask();
  });

  return { answer: answer };
}

async function openPrompt(): Promise<{ answer: Promise<boolean> }> {
  const asked: { answer: Promise<boolean> } = await ask();

  await waitFor(() => {
    expect(screen.getByTestId("reauthentication-prompt")).toBeInTheDocument();
  });

  return asked;
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function type(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value: value } });
}

async function pressConfirm(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  methods = PASSWORD_ONLY;
  isConfirmed = false;
  confirmations = [];
  confirmationAnswers = [];
  optionsAsked = [];

  jest.spyOn(UserUtil, "getUserId").mockReturnValue(USER_ID);
  jest
    .spyOn(UserUtil, "getEmail")
    .mockReturnValue(new Email("river@example.com"));

  jest.spyOn(API, "get").mockImplementation((async (options: { url: URL }) => {
    if (options.url.toString().endsWith(STATUS_URL)) {
      return statusAnswer();
    }

    throw new Error(`Unexpected GET ${options.url.toString()}`);
  }) as never);

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
    options?: { skipReauthentication?: boolean };
  }) => {
    // The prompt's own requests are never handed back to it.
    expect(options.options?.skipReauthentication).toBe(true);

    if (options.url.toString().endsWith(OPTIONS_URL)) {
      optionsAsked.push(options.data);
      return new HTTPResponse<JSONObject>(
        200,
        { options: { challenge: "challenge" } },
        {},
      );
    }

    if (options.url.toString().endsWith(STATUS_URL)) {
      confirmations.push(options.data);
      return (
        confirmationAnswers.shift() ||
        new HTTPResponse<JSONObject>(
          200,
          { confirmedUntil: "2026-11-20T10:10:00.000Z" },
          {},
        )
      );
    }

    throw new Error(`Unexpected POST ${options.url.toString()}`);
  }) as never);

  jest.spyOn(WebAuthn, "ensureSupported").mockImplementation(() => {});
  jest
    .spyOn(WebAuthn, "authenticate")
    .mockResolvedValue({ id: "key-answer" } as never);

  render(<ReauthenticationPrompt />);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("mounted, it is the API client's way to ask", () => {
  test("it registers itself, and nothing is drawn until a change is refused", () => {
    expect(Reauthentication.hasAsker()).toBe(true);
    expect(screen.queryByTestId("reauthentication-prompt")).toBeNull();
  });

  test("a session that has confirmed meanwhile is not asked: true at once", async () => {
    isConfirmed = true;

    const { answer } = await ask();

    await expect(answer).resolves.toBe(true);
    expect(screen.queryByTestId("reauthentication-prompt")).toBeNull();
  });

  test("a status that cannot be read: false, and nothing is drawn", async () => {
    jest
      .spyOn(API, "get")
      .mockResolvedValue(refusal("Something is wrong.") as never);

    const { answer } = await ask();

    await expect(answer).resolves.toBe(false);
    expect(screen.queryByTestId("reauthentication-prompt")).toBeNull();
  });

  test("unmounted, it asks nothing", () => {
    cleanup();

    expect(Reauthentication.hasAsker()).toBe(false);
  });
});

describe("an account with a password", () => {
  test("asks for the password, in one short dialog", async () => {
    await openPrompt();

    expect(readText(within(dialog()).getByTestId("modal-title"))).toBe(
      "Confirm It's You",
    );
    expect(readText(within(dialog()).getByTestId("modal-description"))).toBe(
      "Enter your password to change how you sign in.",
    );
    expect(screen.getByTestId("reauthentication-password")).toBeInTheDocument();
    expect(screen.queryByTestId("reauthentication-code")).toBeNull();
    expect(readText(screen.getByTestId("reauthentication-window"))).toBe(
      "You won't be asked again for 10 minutes.",
    );
    expect(
      readText(within(dialog()).getByTestId("modal-footer-submit-button")),
    ).toBe("Confirm");
    // No passkey on this account: nothing offers one.
    expect(screen.queryByTestId("reauthentication-use-passkey")).toBeNull();
  });

  test("the password field is the one a password manager fills, beside the account's address", async () => {
    await openPrompt();

    const password: HTMLElement = screen.getByTestId(
      "reauthentication-password",
    );

    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).not.toHaveAttribute("data-1p-ignore");

    const username: HTMLElement | null = dialog().querySelector(
      'input[autocomplete="username"]',
    );

    expect(username).toHaveValue("river@example.com");
  });

  test("sends the password, and answers true once the server took it", async () => {
    const { answer } = await openPrompt();

    type("reauthentication-password", "the right password");
    await pressConfirm();

    await expect(answer).resolves.toBe(true);
    expect(confirmations).toEqual([
      { [REAUTHENTICATION_FIELDS.password]: "the right password" },
    ]);
    expect(screen.queryByTestId("reauthentication-prompt")).toBeNull();
  });

  test("Enter in the field sends it too, once", async () => {
    const { answer } = await openPrompt();

    type("reauthentication-password", "the right password");

    await act(async (): Promise<void> => {
      fireEvent.keyDown(screen.getByTestId("reauthentication-password"), {
        key: "Enter",
      });
    });

    await expect(answer).resolves.toBe(true);
    expect(confirmations).toHaveLength(1);
  });

  test("no password: said under the field, and nothing is sent", async () => {
    await openPrompt();

    await pressConfirm();

    expect(confirmations).toHaveLength(0);
    expect(readText(dialog())).toContain(
      REAUTHENTICATION_MESSAGES.passwordRequired,
    );
  });

  test("a wrong password is said under the field, and the dialog stays for another try", async () => {
    confirmationAnswers.push(refusal(REAUTHENTICATION_MESSAGES.wrongPassword));
    const { answer } = await openPrompt();

    type("reauthentication-password", "a wrong one");
    await pressConfirm();

    await waitFor(() => {
      expect(readText(dialog())).toContain(
        REAUTHENTICATION_MESSAGES.wrongPassword,
      );
    });
    expect(screen.queryByTestId("modal-error")).toBeNull();

    // Typing again clears it, and the right one confirms.
    type("reauthentication-password", "the right password");
    expect(readText(dialog())).not.toContain(
      REAUTHENTICATION_MESSAGES.wrongPassword,
    );

    await pressConfirm();
    await expect(answer).resolves.toBe(true);
  });

  test("too many attempts, or a server that cannot confirm now, is said over the dialog", async () => {
    confirmationAnswers.push(
      refusal(REAUTHENTICATION_MESSAGES.tooManyAttempts),
    );
    await openPrompt();

    type("reauthentication-password", "the right password");
    await pressConfirm();

    await waitFor(() => {
      expect(readText(screen.getByTestId("modal-error"))).toContain(
        REAUTHENTICATION_MESSAGES.tooManyAttempts,
      );
    });
  });

  test("Cancel answers false: the change keeps its refusal", async () => {
    const { answer } = await openPrompt();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-close-button"),
      );
    });

    await expect(answer).resolves.toBe(false);
    expect(confirmations).toHaveLength(0);
    expect(screen.queryByTestId("reauthentication-prompt")).toBeNull();
  });

  test("two refusals at once share the one prompt", async () => {
    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(false);

    await act(async (): Promise<void> => {
      first = Reauthentication.ask();
      second = Reauthentication.ask();
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("reauthentication-prompt")).toHaveLength(1);
    });

    type("reauthentication-password", "the right password");
    await pressConfirm();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(confirmations).toHaveLength(1);
  });
});

describe("an account with two-factor authentication on", () => {
  beforeEach(() => {
    methods = TWO_FACTOR;
  });

  test("asks for the password and a code from the authenticator app, with the other ways one link away", async () => {
    await openPrompt();

    expect(readText(within(dialog()).getByTestId("modal-description"))).toBe(
      "Enter your password and a code from your authenticator app to change how you sign in.",
    );
    expect(screen.getByTestId("reauthentication-code")).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
    expect(
      screen.getByTestId("reauthentication-use-SecurityKey"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("reauthentication-use-BackupCode"),
    ).toBeInTheDocument();
  });

  test("sends the password and the code", async () => {
    const { answer } = await openPrompt();

    type("reauthentication-password", "the right password");
    type("reauthentication-code", "123 456");
    await pressConfirm();

    await expect(answer).resolves.toBe(true);
    expect(confirmations).toEqual([
      {
        [REAUTHENTICATION_FIELDS.password]: "the right password",
        [REAUTHENTICATION_FIELDS.code]: "123456",
      },
    ]);
  });

  test("a code that is not six digits is said under its field, and nothing is sent", async () => {
    await openPrompt();

    type("reauthentication-password", "the right password");
    type("reauthentication-code", "123");
    await pressConfirm();

    expect(confirmations).toHaveLength(0);
    expect(readText(dialog())).toContain(
      REAUTHENTICATION_PROMPT_COPY.enterCode,
    );
  });

  test("a wrong code is said under the code, not the password", async () => {
    confirmationAnswers.push(refusal(REAUTHENTICATION_MESSAGES.wrongCode));
    await openPrompt();

    type("reauthentication-password", "the right password");
    type("reauthentication-code", "000000");
    await pressConfirm();

    await waitFor(() => {
      expect(readText(dialog())).toContain(REAUTHENTICATION_MESSAGES.wrongCode);
    });
    expect(screen.queryByTestId("modal-error")).toBeNull();
  });

  test("a backup code instead: its own field and words, sent in place of a code", async () => {
    const { answer } = await openPrompt();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("reauthentication-use-BackupCode"));
    });

    expect(screen.queryByTestId("reauthentication-code")).toBeNull();
    expect(readText(within(dialog()).getByTestId("modal-description"))).toBe(
      "Enter your password and one of your backup codes to change how you sign in.",
    );

    type("reauthentication-password", "the right password");
    type("reauthentication-backup-code", " ABCDE-12345 ");
    await pressConfirm();

    await expect(answer).resolves.toBe(true);
    expect(confirmations).toEqual([
      {
        [REAUTHENTICATION_FIELDS.password]: "the right password",
        [REAUTHENTICATION_FIELDS.backupCode]: "ABCDE-12345",
      },
    ]);
  });

  test("the security key instead: its options for this session, then its answer with the password", async () => {
    const { answer } = await openPrompt();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("reauthentication-use-SecurityKey"));
    });

    expect(readText(within(dialog()).getByTestId("modal-description"))).toBe(
      "Enter your password, then use your security key, to change how you sign in.",
    );

    type("reauthentication-password", "the right password");
    await pressConfirm();

    await expect(answer).resolves.toBe(true);
    expect(optionsAsked).toEqual([
      {
        [REAUTHENTICATION_FIELDS.webAuthnKind]:
          ReauthenticationWebAuthnKind.SecurityKey,
      },
    ]);
    expect(confirmations).toEqual([
      {
        [REAUTHENTICATION_FIELDS.password]: "the right password",
        [REAUTHENTICATION_FIELDS.securityKeyCredential]: { id: "key-answer" },
      },
    ]);
  });

  test("a security key prompt closed or refused is said over the dialog, in OneUptime's words", async () => {
    jest
      .spyOn(WebAuthn, "authenticate")
      .mockRejectedValue(new DOMException("closed", "NotAllowedError"));
    await openPrompt();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("reauthentication-use-SecurityKey"));
    });

    type("reauthentication-password", "the right password");
    await pressConfirm();

    await waitFor(() => {
      expect(readText(screen.getByTestId("modal-error"))).toContain(
        REAUTHENTICATION_MESSAGES.securityKeyNotAccepted,
      );
    });
    expect(confirmations).toHaveLength(0);
  });

  test("an account whose only second step is a key starts with the key", async () => {
    methods = {
      ...TWO_FACTOR,
      secondStep: {
        authenticatorApp: false,
        securityKey: true,
        backupCode: false,
      },
    };

    await openPrompt();

    expect(screen.queryByTestId("reauthentication-code")).toBeNull();
    expect(screen.queryByTestId("reauthentication-use-BackupCode")).toBeNull();
  });
});

describe("an account with a passkey", () => {
  test("with a password too: Use a Passkey confirms on its own, beside Confirm", async () => {
    methods = { ...PASSWORD_ONLY, passkey: true };
    const { answer } = await openPrompt();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("reauthentication-use-passkey"));
    });

    await expect(answer).resolves.toBe(true);
    expect(optionsAsked).toEqual([
      {
        [REAUTHENTICATION_FIELDS.webAuthnKind]:
          ReauthenticationWebAuthnKind.Passkey,
      },
    ]);
    expect(confirmations).toEqual([
      { [REAUTHENTICATION_FIELDS.passkeyCredential]: { id: "key-answer" } },
    ]);
  });

  test("with no password: the passkey is the one way, the dialog's own button", async () => {
    methods = {
      password: false,
      secondStep: null,
      passkey: true,
      signInAgain: false,
    };
    const { answer } = await openPrompt();

    expect(screen.queryByTestId("reauthentication-password")).toBeNull();
    expect(readText(within(dialog()).getByTestId("modal-description"))).toBe(
      "Use your passkey to change how you sign in.",
    );
    expect(
      readText(within(dialog()).getByTestId("modal-footer-submit-button")),
    ).toBe("Use a Passkey");

    await pressConfirm();

    await expect(answer).resolves.toBe(true);
  });
});

describe("an account that signs in with single sign-on only", () => {
  beforeEach(() => {
    methods = {
      password: false,
      secondStep: null,
      passkey: false,
      signInAgain: true,
    };
  });

  test("asks it to sign in again, and says it comes back to the page", async () => {
    await openPrompt();

    expect(readText(within(dialog()).getByTestId("modal-title"))).toBe(
      "Sign In Again",
    );
    expect(readText(within(dialog()).getByTestId("modal-description"))).toBe(
      "To change how you sign in, sign in again first. You'll come back to this page.",
    );
    expect(screen.queryByTestId("reauthentication-password")).toBeNull();
    expect(screen.queryByTestId("reauthentication-window")).toBeNull();
  });

  test("Sign In Again remembers the page, signs out and opens the sign-in page", async () => {
    const remember: SpyInstance<typeof SessionEndReturn.rememberCurrentPage> =
      jest.spyOn(SessionEndReturn, "rememberCurrentPage").mockReturnValue(true);
    const logout: SpyInstance<typeof UserUtil.logout> = jest
      .spyOn(UserUtil, "logout")
      .mockResolvedValue(null);
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    const { answer } = await openPrompt();

    await pressConfirm();

    await expect(answer).resolves.toBe(false);
    expect(remember).toHaveBeenCalledWith(USER_ID.toString());
    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(ACCOUNTS_URL);
    expect(remember.mock.invocationCallOrder[0]!).toBeLessThan(
      logout.mock.invocationCallOrder[0]!,
    );
  });
});

describe("in the reader's language", () => {
  afterEach(async () => {
    await inLanguage("en");
  });

  test.each([
    ["German", "de", DE],
    ["Persian", "fa", FA],
  ] as Array<[string, string, Record<string, string>]>)(
    "in %s: the title, what it asks, its fields and a wrong password",
    async (_name: string, language: string, words: Record<string, string>) => {
      methods = TWO_FACTOR;
      confirmationAnswers.push(
        refusal(REAUTHENTICATION_MESSAGES.wrongPassword),
      );
      await inLanguage(language);
      await openPrompt();

      for (const key of [
        REAUTHENTICATION_PROMPT_COPY.title,
        REAUTHENTICATION_PROMPT_COPY.passwordAndCode,
        REAUTHENTICATION_MESSAGES.wrongPassword,
      ]) {
        // Translated: never the English.
        expect(words[key]).toBeTruthy();
        expect(words[key]).not.toBe(key);
      }

      expect(readText(within(dialog()).getByTestId("modal-title"))).toBe(
        words[REAUTHENTICATION_PROMPT_COPY.title],
      );
      expect(readText(within(dialog()).getByTestId("modal-description"))).toBe(
        words[REAUTHENTICATION_PROMPT_COPY.passwordAndCode],
      );
      expect(readText(dialog())).toContain(
        words[REAUTHENTICATION_PROMPT_COPY.passwordLabel]!,
      );

      type("reauthentication-password", "a wrong one");
      type("reauthentication-code", "123456");
      await pressConfirm();

      await waitFor(() => {
        expect(readText(dialog())).toContain(
          words[REAUTHENTICATION_MESSAGES.wrongPassword]!,
        );
      });
      expect(readText(dialog())).not.toContain(
        REAUTHENTICATION_MESSAGES.wrongPassword,
      );
    },
  );
});
