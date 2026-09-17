import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * OneUptime issue #3382 -- "No MFA recovery path".
 *
 * The bug shipped TWICE, and the reason it shipped twice is that every test
 * this feature had was a grep over source text. Backup codes existed, the
 * endpoint existed, the locale strings existed, and a source-text test could
 * see all three -- but nothing in the product ever minted a code, so
 * `backupCodeCount` was 0 for essentially every account, and the one recovery
 * affordance on the sign-in page was gated on `backupCodeCount > 0`. A user
 * who had lost their authenticator saw a list of one method they could not
 * use and NOTHING else. Indistinguishable, on screen, from a build where the
 * feature had never been written.
 *
 * So this file renders the real sign-in page and asserts what a locked-out
 * person can actually see and click. Every test below is a screen the reporter
 * was looking at.
 *
 * WHY THE REAL TRANSLATIONS. The page's entire user-visible surface comes out
 * of `t()`, so a passthrough `t` that echoes its key would let this suite pass
 * against a build whose locale files never gained the new strings -- the user
 * would read "login.twoFactor.lostAccess" and the assertions would be happy.
 * The Accounts feature set's own i18n module is imported instead (its language
 * detector is stubbed to English by Common's jest config), and the assertions
 * are on the English sentences from Locales/en.json. A missing or renamed key
 * therefore fails here rather than rendering as a dotted path in production.
 *
 * WHY THE FORM IS DRIVEN, NOT STUBBED. The two factor state is entered from
 * the login ModelForm's `onSuccess`, so the form is filled in and submitted
 * like a person would, with ModelAPI.createOrUpdate standing in for the
 * network. That keeps the branch order in `onSuccess` (enrolment before
 * method lists before plain login) under test as well as the screens.
 */

import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import LoginUtil from "../../../UI/Utils/Login";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";

/*
 * The edition pill fetches the instance's global config on mount. It is page
 * chrome with nothing to do with recovery, and stubbing the component is a
 * smaller lie than stubbing the fetch it makes.
 */
jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

// Registers the Accounts locale resources on the shared i18next instance.
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";

const USER_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_EMAIL: string = "ada@analytical-engine.example.com";
const TOTP_ID: string = "11111111-1111-4111-8111-111111111111";
const WEBAUTHN_ID: string = "22222222-2222-4222-8222-222222222222";

const PASSWORD: string = "correct-horse-battery";

/* Straight out of en.json, so a dropped key is a failure rather than a pass. */
const LOST_ACCESS: string = "Lost access to your authenticator?";

/*
 * The security-key screen asks the question about the right object. "Lost
 * access to your authenticator?" is the wrong noun for somebody whose hardware
 * key is what is gone, and an affordance a locked-out user does not recognise
 * as addressed to them is the same failure the whole issue was filed about.
 */
const LOST_ACCESS_SECURITY_KEY: string = "Lost access to your security key?";
const BACK_TO_PICKER: string =
  "Select a different two factor authentication method";
const SKIP_FOR_NOW: string = "Skip for now";
const REGISTER_LINK: string = "Register.";
const ADMIN_RESET: string = "reset two factor authentication on your account";

type LoginMockCall = { user?: unknown; token?: unknown };

let loginCalls: Array<LoginMockCall> = [];
let postedUrls: Array<string> = [];

/*
 * What the mocked /login answers with. Set per test, read when the form is
 * submitted.
 */
let loginMiscData: JSONObject = {};

/* What the mocked second-step endpoints answer with. */
let secondStepMiscData: JSONObject = {};

/* What the mocked /user-two-factor-backup-code/generate answers with. */
let generatedCodes: Array<string> = [];

/*
 * Which account is signing in. Variable rather than a constant because the
 * "skip for now" snooze is keyed on it, and the test that matters most about
 * that keying is the one where a SECOND account signs in on the same browser
 * and must still be asked.
 */
let signedInUserId: string = USER_ID;

type UserJsonFunction = () => JSONObject;

const userJson: UserJsonFunction = (): JSONObject => {
  return {
    _id: signedInUserId,
    email: USER_EMAIL,
    name: "Ada Lovelace",
  };
};

type TotpJsonFunction = (name: string) => JSONObject;

const totpJson: TotpJsonFunction = (name: string): JSONObject => {
  return { _id: TOTP_ID, name: name };
};

type WebAuthnJsonFunction = (name: string) => JSONObject;

const webAuthnJson: WebAuthnJsonFunction = (name: string): JSONObject => {
  return { _id: WEBAUTHN_ID, name: name };
};

type SetupUserFunction = () => UserEvent;

/*
 * No inter-keystroke delay: Input mirrors its value onto the DOM node from an
 * effect, so a keystroke that lands before React has committed the previous
 * one is overwritten and lost. See the same note in BasicForm.test.tsx.
 */
const setupUser: SetupUserFunction = (): UserEvent => {
  return userEvent.setup({ delay: null });
};

type RenderPageFunction = () => void;

const renderPage: RenderPageFunction = (): void => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
};

type SubmitPasswordFunction = () => Promise<void>;

// The first step, typed in as a person types it.
const submitPassword: SubmitPasswordFunction = async (): Promise<void> => {
  const user: UserEvent = setupUser();

  /*
   * ModelForm assembles its field list in an async effect, so the boxes do
   * not exist on the first paint.
   */
  await user.type(await screen.findByTestId("email"), USER_EMAIL);
  await user.type(screen.getByTestId("password"), PASSWORD);

  /*
   * The submit handler keeps running after the click returns, and the state
   * it sets on the way out lands outside React's act() scope unless the whole
   * awaited click is inside one.
   */
  await act(async () => {
    await user.click(screen.getByTestId("Login"));
  });
};

type TwoFactorChallengeOptions = {
  totpNames?: Array<string>;
  webAuthnNames?: Array<string>;
  /*
   * `null` reproduces a /login that could NOT count the account's codes and
   * therefore omitted the key. That is not the same wire shape as zero, and
   * the page is required to tell them apart -- see the "unknown" tests below.
   */
  backupCodeCount: number | null;
};

type StartTwoFactorChallengeFunction = (
  options: TwoFactorChallengeOptions,
) => Promise<void>;

/*
 * Sign in with a password on an account that has a second factor, and stop on
 * whichever two factor screen that produces.
 */
const startTwoFactorChallenge: StartTwoFactorChallengeFunction = async (
  options: TwoFactorChallengeOptions,
): Promise<void> => {
  loginMiscData = {
    totpAuthList: (options.totpNames || []).map(totpJson),
    webAuthnList: (options.webAuthnNames || []).map(webAuthnJson),
    ...(options.backupCodeCount === null
      ? {}
      : { backupCodeCount: options.backupCodeCount }),
  };

  renderPage();
  await submitPassword();

  await screen.findByText("Two Factor Authentication");
};

type StartForcedEnrolmentFunction = () => Promise<void>;

/*
 * The other way onto a second factor: an administrator has mandated two factor
 * auth (or just reset it for somebody who was locked out), so /login answers a
 * correct password with a QR code and no session at all.
 */
const startForcedEnrolment: StartForcedEnrolmentFunction =
  async (): Promise<void> => {
    loginMiscData = {
      twoFactorEnrolmentRequired: true,
      twoFactorAuthId: TOTP_ID,
      twoFactorOtpUrl: "otpauth://totp/OneUptime:ada?secret=ABCDEFGH",
    };

    renderPage();
    await submitPassword();

    await screen.findByText("Set Up Two Factor Authentication");
  };

type SubmitEnrolmentCodeFunction = () => Promise<void>;

const submitEnrolmentCode: SubmitEnrolmentCodeFunction =
  async (): Promise<void> => {
    const user: UserEvent = setupUser();

    await user.type(await screen.findByTestId("enrolment-code"), "123456");

    await act(async () => {
      await user.click(screen.getByTestId("Verify and Sign In"));
    });
  };

type EnterTotpCodeFunction = () => Promise<void>;

// The second step: pick the authenticator app and type its code.
const enterTotpCode: EnterTotpCodeFunction = async (): Promise<void> => {
  const user: UserEvent = setupUser();

  await user.click(screen.getByText("Authenticator App"));
  await user.type(await screen.findByTestId("code"), "123456");

  await act(async () => {
    await user.click(screen.getByTestId("Login"));
  });
};

type InstallMocksFunction = () => void;

/*
 * Everything the page would otherwise reach for. The redirect in particular:
 * every "was the user let through?" assertion below is really "was
 * LoginUtil.login called?", and the real one navigates away from the only
 * copy of the recovery codes that will ever exist.
 */
const installMocks: InstallMocksFunction = (): void => {
  /*
   * "Skip for now" is now REMEMBERED -- it writes a timestamp to local storage
   * keyed by user id so an account with no codes is not stopped on every
   * sign-in for the rest of its life. jsdom keeps one storage for the whole
   * file, so without this a test that skips silences the offer for every later
   * test that signs the same user in, and they fail asserting on a screen that
   * was deliberately suppressed.
   */
  try {
    window.localStorage.clear();
  } catch {
    /* Nothing to clear is not a failure. */
  }

  signedInUserId = USER_ID;
  loginCalls = [];
  postedUrls = [];
  loginMiscData = {};
  secondStepMiscData = { token: "session-token" };
  generatedCodes = [];

  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue("");
  jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});

  jest.spyOn(LoginUtil, "login").mockImplementation((value: JSONObject) => {
    loginCalls.push(value as LoginMockCall);
  });

  // The /login call the ModelForm makes.
  jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
      const response: ModelAPIHttpResponse<User> =
        new ModelAPIHttpResponse<User>(200, userJson(), {});

      response.miscData = loginMiscData;

      return response;
    });

  // Every second-step call the page makes directly, routed by URL.
  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (options: {
        url?: { toString: () => string } | undefined;
      }): Promise<HTTPResponse<JSONObject>> => {
        const url: string = options.url?.toString() || "";

        postedUrls.push(url);

        if (url.includes("/user-two-factor-backup-code/generate")) {
          return new HTTPResponse<JSONObject>(
            200,
            { codes: generatedCodes },
            {},
          );
        }

        /*
         * Security keys do not exist in jsdom. The page has to survive that
         * and keep the recovery link on screen -- which is precisely the
         * screen somebody with a broken key is standing on.
         */
        if (url.includes("/user-webauthn/generate-authentication-options")) {
          throw new Error("No authenticator is available on this device.");
        }

        return new HTTPResponse<JSONObject>(
          200,
          { ...userJson(), _miscData: secondStepMiscData },
          {},
        );
      },
    );
};

describe("Two factor sign-in always offers a way out", () => {
  beforeEach(() => {
    installMocks();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  /*
   * THE REPORTED BUG, at its smallest.
   *
   * `backupCodeCount` is 0 here because that is what it was for essentially
   * every real account: nothing in the product minted codes at setup time.
   * The old page gated the recovery link on that count, so this screen had a
   * list of methods and nothing else on it.
   */
  test("the lost-access link is on the method picker even with no codes", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      webAuthnNames: ["YubiKey"],
      backupCodeCount: 0,
    });

    expect(screen.getByText(LOST_ACCESS)).toBeInTheDocument();
  });

  /*
   * The screen the issue actually named. The old link lived INSIDE the method
   * picker, so choosing a method took it away: the user was left staring at a
   * box asking for a code they cannot produce, with "select a different
   * method" as the only exit -- back to a list of methods they already told us
   * they cannot use.
   */
  test("the lost-access link is on the code-entry screen the issue named", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });

    const user: UserEvent = setupUser();
    await user.click(screen.getByText("Authenticator App"));

    expect(await screen.findByTestId("code")).toBeInTheDocument();
    expect(screen.getByText(LOST_ACCESS)).toBeInTheDocument();
  });

  test("the lost-access link is on the security-key screen too", async () => {
    await startTwoFactorChallenge({
      webAuthnNames: ["YubiKey"],
      backupCodeCount: 0,
    });

    const user: UserEvent = setupUser();
    await user.click(screen.getByText("Security Key"));

    await screen.findByText("Authenticating with Security Key");

    await waitFor(() => {
      expect(screen.getByText(LOST_ACCESS_SECURITY_KEY)).toBeInTheDocument();
    });

    /* And it does not ask about an authenticator app they may not own. */
    expect(screen.queryByText(LOST_ACCESS)).not.toBeInTheDocument();
  });

  /*
   * Until the link above existed, "Don't have an account? Register." was the
   * only other thing on a two factor screen -- an offer to make a second
   * account, made to somebody who is locked out of the one they have.
   */
  test("a locked-out user is not offered the registration link instead", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });

    expect(screen.queryByText(REGISTER_LINK)).not.toBeInTheDocument();
  });

  /*
   * What is behind the link for the population the issue was about. Not a
   * form that would refuse every code they typed: the sentence naming who can
   * reset their two factor auth, which is the only true answer to their
   * question and one nothing in the product used to give.
   */
  test("with no codes, the link explains the administrator reset", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });

    const user: UserEvent = setupUser();
    await user.click(screen.getByText(LOST_ACCESS));

    const guidance: HTMLElement = await screen.findByTestId("no-backup-codes");

    expect(guidance).toHaveTextContent("You have no backup codes.");
    expect(guidance).toHaveTextContent(ADMIN_RESET);

    /*
     * And no code box. Offering one to an account with no codes is offering a
     * form that can only ever say "invalid" -- which reads as "you typed it
     * wrong", not "there was never a code to type".
     */
    expect(screen.queryByTestId("backup-code")).not.toBeInTheDocument();
  });

  test("with codes, the link opens the backup code form and not the guidance", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 8,
    });

    const user: UserEvent = setupUser();
    await user.click(screen.getByText(LOST_ACCESS));

    expect(await screen.findByTestId("backup-code")).toBeInTheDocument();
    expect(screen.queryByTestId("no-backup-codes")).not.toBeInTheDocument();
  });

  /*
   * Opening recovery by mistake must not be a trap. The "go back" link clears
   * `isUsingBackupCode` as well as the two selections, because the picker is
   * hidden while that flag is set -- without it, the link would appear to do
   * nothing at all.
   */
  /*
   * "UNKNOWN" IS NOT "NONE".
   *
   * /login omits `backupCodeCount` entirely when it could not read it -- one
   * bad index, one exhausted connection pool -- rather than reporting zero,
   * because zero is a CLAIM and the page acts on it by telling the user they
   * have nothing and should go and find an administrator. Said to somebody
   * holding ten printed codes during a transient fault, that is both false and
   * unrecoverable advice: they would stop trying the thing that works.
   *
   * Absent therefore has to behave like "there may be codes", which means the
   * form.
   */
  test("a count the server could not read still offers the code form", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: null,
    });

    const user: UserEvent = setupUser();
    await user.click(screen.getByText(LOST_ACCESS));

    expect(await screen.findByTestId("backup-code")).toBeInTheDocument();
    expect(screen.queryByTestId("no-backup-codes")).not.toBeInTheDocument();
  });

  test("the user can get back to the method picker from recovery", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      webAuthnNames: ["YubiKey"],
      backupCodeCount: 0,
    });

    const user: UserEvent = setupUser();
    await user.click(screen.getByText(LOST_ACCESS));
    await screen.findByTestId("no-backup-codes");

    await user.click(screen.getByText(BACK_TO_PICKER));

    expect(await screen.findByText("Authenticator App")).toBeInTheDocument();
    expect(screen.getByText("Security Key")).toBeInTheDocument();
    expect(screen.queryByTestId("no-backup-codes")).not.toBeInTheDocument();
  });
});

describe("Finishing a two factor sign-in offers the codes that were missing", () => {
  beforeEach(() => {
    installMocks();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  /*
   * The population the whole issue was about: everybody who set two factor
   * auth up before recovery codes existed. They are signed in at this point --
   * the server has already set the session cookie -- and the ONLY moment the
   * product has ever had their attention on their second factor is right now.
   *
   * The assertion that matters is the negative one: the redirect has not
   * happened. An offer made after the navigation is an offer made to an empty
   * page.
   */
  test("an account with no codes is offered a set instead of being redirected", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });

    await enterTotpCode();

    expect(await screen.findByTestId("generate-backup-codes")).toBeVisible();
    expect(loginCalls).toHaveLength(0);
  });

  /*
   * ...and the offer can always be refused. A prompt that could wedge a
   * sign-in the server has already completed would be a worse bug than the one
   * being fixed.
   */
  test("'Skip for now' lets the completed sign-in through", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });

    await enterTotpCode();
    await screen.findByTestId("generate-backup-codes");

    const user: UserEvent = setupUser();
    await user.click(screen.getByText(SKIP_FOR_NOW));

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });
    expect(loginCalls[0]?.token).toBe("session-token");
  });

  test("accepting the offer shows the codes it minted", async () => {
    generatedCodes = ["AAAAA-11111", "BBBBB-22222"];

    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });

    await enterTotpCode();

    const user: UserEvent = setupUser();
    const generateButton: HTMLElement = await screen.findByTestId(
      "generate-backup-codes",
    );

    await act(async () => {
      await user.click(generateButton);
    });

    const shown: Array<HTMLElement> =
      await screen.findAllByTestId("backup-code-value");

    expect(
      shown.map((element: HTMLElement): string => {
        return element.textContent || "";
      }),
    ).toEqual(generatedCodes);

    // Still not signed through -- these have not been acknowledged yet.
    expect(loginCalls).toHaveLength(0);
    expect(
      postedUrls.some((url: string): boolean => {
        return url.includes("/user-two-factor-backup-code/generate");
      }),
    ).toBe(true);
  });

  /*
   * THE SHOW-ONCE GUARANTEE.
   *
   * The server keeps only keyed digests, so the plaintext in this response is
   * the only copy that will ever exist. A redirect that fires before the user
   * has said "I have these" destroys them silently -- the account keeps ten
   * codes nobody has ever seen, which is the original bug wearing a different
   * hat.
   */
  test("server-minted codes are all shown, and the redirect waits for the tick", async () => {
    const minted: Array<string> = [
      "AAAAA-11111",
      "BBBBB-22222",
      "CCCCC-33333",
      "DDDDD-44444",
    ];

    secondStepMiscData = { token: "session-token", backupCodes: minted };

    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });

    await enterTotpCode();

    const shown: Array<HTMLElement> =
      await screen.findAllByTestId("backup-code-value");

    // Every one of them, not just the first row of the grid.
    expect(
      shown.map((element: HTMLElement): string => {
        return element.textContent || "";
      }),
    ).toEqual(minted);

    const continueButton: HTMLElement = screen.getByTestId(
      "backup-codes-continue",
    );

    expect(continueButton).toBeDisabled();

    const user: UserEvent = setupUser();

    // Pressing it before acknowledging must do nothing at all.
    await user.click(continueButton);
    expect(loginCalls).toHaveLength(0);

    await user.click(screen.getByTestId("backup-codes-saved-checkbox"));

    await waitFor(() => {
      expect(screen.getByTestId("backup-codes-continue")).toBeEnabled();
    });

    await user.click(screen.getByTestId("backup-codes-continue"));

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });
  });

  /*
   * The account that already has codes and was not given new ones is not
   * stopped for anything. Nothing has been lost and nothing is being handed
   * over, so a screen here would be pure friction on every single sign-in.
   */
  test("an account that already has codes is signed straight in", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 8,
    });

    await enterTotpCode();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });

    expect(
      screen.queryByTestId("generate-backup-codes"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("backup-codes-list")).not.toBeInTheDocument();
  });

  /*
   * The same "unknown is not none" rule, on the way out rather than the way
   * in. A database that cannot count backup codes for a minute would otherwise
   * put a "you have no backup codes" screen in front of every two factor
   * sign-in on the instance -- an outage turned into a product-wide nag.
   */
  test("a count the server could not read does not interrupt the sign-in", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: null,
    });

    await enterTotpCode();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });

    expect(
      screen.queryByTestId("generate-backup-codes"),
    ).not.toBeInTheDocument();
  });

  /*
   * FORCED ENROLMENT -- the path with the strongest claim on this feature.
   *
   * An account reaches it in one of two ways: an admin has mandated two factor
   * auth on somebody who had none, or an admin has just RESET it for somebody
   * who was locked out (which deletes their codes). Both used to end with the
   * user signed in, a fresh authenticator app, and no recovery route at all --
   * the user who had just been rescued was the one most certain to need
   * rescuing again.
   *
   * The handler used to throw the response's misc bag away with a literal
   * `{}`, so even once the server started minting here, the only copy of the
   * plaintext went in the bin.
   */
  test("codes minted behind a forced enrolment are shown before the redirect", async () => {
    const minted: Array<string> = ["AAAAA-11111", "BBBBB-22222"];

    secondStepMiscData = { token: "session-token", backupCodes: minted };

    await startForcedEnrolment();
    await submitEnrolmentCode();

    const shown: Array<HTMLElement> =
      await screen.findAllByTestId("backup-code-value");

    expect(
      shown.map((element: HTMLElement): string => {
        return element.textContent || "";
      }),
    ).toEqual(minted);

    expect(loginCalls).toHaveLength(0);
  });

  /*
   * ...and the enrolment that minted nothing BECAUSE the account already had a
   * set must not be treated as an account with none. The profile card lets a
   * user generate codes before turning two factor auth on, so somebody can be
   * holding a printed set when an admin mandates a factor. There is no count
   * on this path -- /login answered with a QR code, not a factor list -- so the
   * server says it outright with `hasBackupCodes`. Ignoring that would tell
   * that user they have no codes and offer to make some, which would replace
   * the very set they printed.
   */
  test("an enrolment on an account that already had codes is not offered more", async () => {
    secondStepMiscData = { token: "session-token", hasBackupCodes: true };

    await startForcedEnrolment();
    await submitEnrolmentCode();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });

    expect(
      screen.queryByTestId("generate-backup-codes"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("backup-codes-list")).not.toBeInTheDocument();
  });

  /*
   * And the offer must not leak onto accounts with no second factor at all.
   * There is no lock for these recovery codes to open, so asking for them
   * would put a screen in front of every password-only sign-in in the product
   * -- an unrelated regression that this fix is one `if` away from causing.
   */
  test("a password-only account is never prompted for backup codes", async () => {
    loginMiscData = { token: "session-token" };

    renderPage();
    await submitPassword();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });

    expect(
      screen.queryByTestId("generate-backup-codes"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("backup-codes-list")).not.toBeInTheDocument();
    expect(screen.queryByText(LOST_ACCESS)).not.toBeInTheDocument();
  });

  /*
   * SPENDING THE LAST CODE.
   *
   * The one user in the product who has just PROVED they needed a recovery
   * route, and who now has none. The count on the challenge response was taken
   * before the code was spent, so it is one too high by the time this runs --
   * and this screen is only reachable when it was above zero, which means the
   * obvious "is the count zero" test is false here forever. Nothing else on
   * the response says so: the identity route's remaining-code count is
   * computed on a detached promise that must never fail the login, so it
   * cannot be waited on to put it in the body.
   *
   * Without the decrement this user is redirected into the dashboard and the
   * product never mentions it again, which is precisely the state issue #3382
   * was filed about, reached by the one path that is supposed to prevent it.
   */
  test("spending the last backup code offers a fresh set", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 1,
    });

    const user: UserEvent = setupUser();
    await user.click(screen.getByText(LOST_ACCESS));
    await user.type(await screen.findByTestId("backup-code"), "ABCDE-12345");

    await act(async () => {
      await user.click(screen.getByTestId("Login"));
    });

    expect(
      await screen.findByTestId("generate-backup-codes"),
    ).toBeInTheDocument();

    /* Held, not redirected -- the offer is the point. */
    expect(loginCalls).toHaveLength(0);
  });

  /*
   * And the same sign-in with codes still to spare goes straight through. A
   * decrement applied too eagerly would stop every recovery sign-in with an
   * offer the user does not need, on the screen they reached because they were
   * already having a bad day.
   */
  test("spending a backup code with others left does not interrupt", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 4,
    });

    const user: UserEvent = setupUser();
    await user.click(screen.getByText(LOST_ACCESS));
    await user.type(await screen.findByTestId("backup-code"), "ABCDE-12345");

    await act(async () => {
      await user.click(screen.getByTestId("Login"));
    });

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });
    expect(
      screen.queryByTestId("generate-backup-codes"),
    ).not.toBeInTheDocument();
  });

  /*
   * "SKIP FOR NOW" HAS TO MEAN SOMETHING.
   *
   * The offer interrupts a sign-in that has already succeeded. Made once, that
   * is a security prompt; made on every sign-in for the life of the account it
   * is a toll, and it is worst on an instance where the generate route is
   * failing -- a button that cannot work and a link that says "later", every
   * time, with no way to mean it.
   *
   * Bounded rather than permanent, and keyed to the user id so a shared
   * machine does not silence the prompt for the next person to sign in on it.
   */
  test("skipping the offer suppresses it on the next sign-in", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });

    await enterTotpCode();
    await screen.findByTestId("generate-backup-codes");

    const user: UserEvent = setupUser();
    await user.click(screen.getByText(SKIP_FOR_NOW));

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });

    /* Sign in again on the same browser, same account, still no codes. */
    cleanup();
    loginCalls = [];

    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });
    await enterTotpCode();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });
    expect(
      screen.queryByTestId("generate-backup-codes"),
    ).not.toBeInTheDocument();
  });

  /*
   * A DIFFERENT ACCOUNT ON THE SAME BROWSER IS STILL ASKED.
   *
   * Scoping the snooze to the user id is what stops one person's "later" from
   * hiding a security prompt from somebody who never dismissed it -- which on
   * a shared or handed-down machine is somebody who then has no recovery route
   * and was never told.
   */
  test("skipping for one account does not silence the offer for another", async () => {
    await startTwoFactorChallenge({
      totpNames: ["Ada's phone"],
      backupCodeCount: 0,
    });

    await enterTotpCode();
    await screen.findByTestId("generate-backup-codes");

    const user: UserEvent = setupUser();
    await user.click(screen.getByText(SKIP_FOR_NOW));

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });

    cleanup();
    loginCalls = [];
    signedInUserId = "22222222-2222-4222-8222-222222222222";

    await startTwoFactorChallenge({
      totpNames: ["Grace's phone"],
      backupCodeCount: 0,
    });
    await enterTotpCode();

    expect(
      await screen.findByTestId("generate-backup-codes"),
    ).toBeInTheDocument();
    expect(loginCalls).toHaveLength(0);
  });
});
