import {
  CDPSession,
  Page,
  Request,
  Route,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  generateRegistrationOptions,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  VerifiedRegistrationResponse,
  verifyRegistrationResponse,
} from "../../Common/node_modules/@simplewebauthn/server";
import {
  SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE,
  SecondStepEnrolmentChoice,
  VERIFY_SECURITY_KEY_ENROLMENT_ROUTE,
} from "Common/Types/Accounts/SecondStepEnrolment";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A SECURITY KEY SET UP WHILE SIGNING IN (#9764), in Chromium, with a
 * virtual authenticator the DevTools protocol plugs in: a USB key that
 * answers the browser's prompt as a real one does.
 *
 * An account required to use two-factor authentication with nothing set up
 * is walked through setting up a second step at its next sign-in. The real
 * sign-in page (Fixture/Fixture.js, enrolment=1) signs in over the real
 * network - its own address (apihost=self), where page.route answers - and
 * the browser runs its own WebAuthn ceremony:
 *
 *   - /identity/login says a second step must be set up first;
 *   - the page offers an authenticator app (picked) or a security key;
 *   - POST /identity/security-key-enrolment-options answers creation options
 *     made by @simplewebauthn/server as UserWebAuthnService makes a security
 *     key's (rpID, no attestation, no resident key, user verification
 *     preferred), only to a request that carries the email and password
 *     again and no session cookie: there is no session until the key works;
 *   - the browser asks the authenticator, which makes a credential;
 *   - POST /identity/verify-security-key-enrolment verifies the attestation
 *     against the challenge it made, for this origin and relying party, as
 *     the server does - and answers 400 when it does not verify - then the
 *     backup codes the first second step comes with;
 *   - the page shows them once, and signs in only once they are saved: it
 *     goes to the dashboard.
 *
 * A prompt that never completes - the key is never touched - says the key
 * was not registered, in the reader's language, and signs nobody in; so
 * does an answer the server refuses. A browser that cannot register a key
 * goes straight to the authenticator app, as the page always did. On a
 * phone every step fits its card: the choices and the buttons as wide as
 * it, and nothing scrolls sideways - in English, German and Persian, which
 * reads right to left.
 *
 * WebAuthn needs a domain for its relying party - an address such as
 * 127.0.0.1 is none - so the page is opened as localhost, on the fixture's
 * port.
 */

const RP_ID: string = "localhost";

const USER_ID: string = "97640000-0000-4000-8000-000000000001";
const EMAIL: string = "grace@example.com";
const NAME: string = "Grace Hopper";
const PASSWORD: string = "correct-horse-battery";
const TOTP_ID: string = "97640000-0000-4000-8000-000000000002";
const OTP_URL: string =
  "otpauth://totp/OneUptime:grace%40example.com?issuer=OneUptime&secret=MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ&algorithm=SHA1&digits=6&period=30";

// The recovery codes minted behind the key, as the server formats them.
const BACKUP_CODES: Array<string> = [
  "7KQ2M-XW4PA",
  "R9DHT-3NVLE",
  "B6YCF-QJ8ZS",
  "MW3KD-T5RUH",
];

// The session's cookies (Common/Types/CookieName): none until the key works.
const SESSION_COOKIES: Array<string> = ["user-token", "user-refresh-token"];

// A challenge the server never made: an answer to it must be refused.
const ANOTHER_CHALLENGE: string = "bm90LXRoaXMtY2hhbGxlbmdl";

const SIGN_IN_BUTTON: string = "#login-form-submit-button";

const CHOICE: string = "enrolment-choice";
const APP_OPTION: string = `card-select-option-${SecondStepEnrolmentChoice.AuthenticatorApp}`;
const KEY_OPTION: string = `card-select-option-${SecondStepEnrolmentChoice.SecurityKey}`;
const CONTINUE: string = "enrolment-choice-continue";
const REGISTER: string = "enrolment-security-key";
const ANOTHER_WAY: string = "enrolment-choose-another-way";
const CODES: string = "backup-codes-list";
const CODES_SAVED: string = "backup-codes-saved-checkbox";
const CODES_CONTINUE: string = "backup-codes-continue";

// The words of the sign-in page, as the Accounts app ships them.
interface PageWords {
  enrolment: Record<string, string>;
  backupCodes: Record<string, string>;
}

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Accounts/src/Locales",
);

const wordsIn: (language: string) => PageWords = (
  language: string,
): PageWords => {
  const locale: {
    login: {
      twoFactorEnrolment: Record<string, string>;
      backupCodes: Record<string, string>;
    };
  } = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  );

  return {
    enrolment: locale.login.twoFactorEnrolment,
    backupCodes: locale.login.backupCodes,
  };
};

// What the stubs were asked, and what they decided.
interface SignInServer {
  origin: string;
  // Each request, in turn: "login", "options", "verify".
  asked: Array<string>;
  // The challenge of the options last made, until an answer spends it.
  challenge: string | null;
  // The credentials verified and saved, by id (base64url).
  saved: Array<string>;
  // Why a request was refused, in turn.
  refusals: Array<string>;
  // Check the key's answer against a challenge the server never made.
  checksAnotherChallenge: boolean;
  // How long the browser's prompt may take, in milliseconds.
  promptTimeoutInMs: number | undefined;
}

// The fixture's own address, as localhost: a relying party needs a domain.
const fixtureOrigin: (testInfo: TestInfo) => string = (
  testInfo: TestInfo,
): string => {
  const base: URL = new URL(String(testInfo.project.use.baseURL));

  return `http://${RP_ID}:${base.port}`;
};

const newServer: (testInfo: TestInfo) => SignInServer = (
  testInfo: TestInfo,
): SignInServer => {
  return {
    origin: fixtureOrigin(testInfo),
    asked: [],
    challenge: null,
    saved: [],
    refusals: [],
    checksAnotherChallenge: false,
    promptTimeoutInMs: undefined,
  };
};

/*
 * What is wrong with a sign-in request: every one of them carries the email
 * and password again - there is no session until the second step works -
 * and none carries a session's cookie.
 */
const signInProblems: (request: Request) => Promise<Array<string>> = async (
  request: Request,
): Promise<Array<string>> => {
  const problems: Array<string> = [];
  const body: { data?: { email?: unknown; password?: unknown } } | null =
    request.postDataJSON();
  const data: { email?: unknown; password?: unknown } = body?.data || {};
  const password: unknown = data.password;
  const passwordValue: unknown =
    password && typeof password === "object"
      ? (password as { value?: unknown }).value
      : password;

  if (data.email !== EMAIL) {
    problems.push(`the email was ${JSON.stringify(data.email)}`);
  }

  if (passwordValue !== PASSWORD) {
    problems.push("the password was not sent again");
  }

  const cookies: Array<string> = ((await request.allHeaders())["cookie"] || "")
    .split(";")
    .map((cookie: string): string => {
      return cookie.trim();
    });

  for (const name of SESSION_COOKIES) {
    if (
      cookies.some((cookie: string): boolean => {
        return cookie.startsWith(`${name}=`);
      })
    ) {
      problems.push(`a session cookie was sent (${name})`);
    }
  }

  return problems;
};

const refuse: (data: {
  route: Route;
  server: SignInServer;
  step: string;
  reason: string;
}) => Promise<void> = async (data: {
  route: Route;
  server: SignInServer;
  step: string;
  reason: string;
}): Promise<void> => {
  data.server.refusals.push(`${data.step}: ${data.reason}`);

  await data.route.fulfill({ status: 400, json: { message: data.reason } });
};

// The user as the sign-in routes answer them, with what follows.
const signedInUser: (
  miscData: Record<string, unknown>,
) => Record<string, unknown> = (
  miscData: Record<string, unknown>,
): Record<string, unknown> => {
  return { _id: USER_ID, email: EMAIL, name: NAME, _miscData: miscData };
};

/*
 * Answers the page's sign-in as the Identity API does for an account that
 * must set up a second step, with @simplewebauthn/server's ceremony for the
 * security key.
 */
const answerSignIn: (
  page: Page,
  server: SignInServer,
) => Promise<void> = async (
  page: Page,
  server: SignInServer,
): Promise<void> => {
  await page.route(
    `${server.origin}/identity/login`,
    async (route: Route): Promise<void> => {
      server.asked.push("login");

      const problems: Array<string> = await signInProblems(route.request());

      if (problems.length > 0) {
        return await refuse({
          route,
          server,
          step: "login",
          reason: problems.join("; "),
        });
      }

      await route.fulfill({
        status: 200,
        json: signedInUser({
          twoFactorEnrolmentRequired: true,
          twoFactorAuthId: TOTP_ID,
          twoFactorOtpUrl: OTP_URL,
        }),
      });
    },
  );

  await page.route(
    `${server.origin}/identity${SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE}`,
    async (route: Route): Promise<void> => {
      server.asked.push("options");

      const problems: Array<string> = await signInProblems(route.request());

      if (problems.length > 0) {
        return await refuse({
          route,
          server,
          step: "options",
          reason: problems.join("; "),
        });
      }

      // As UserWebAuthnService makes a security key's (isPasskey false).
      const options: PublicKeyCredentialCreationOptionsJSON =
        await generateRegistrationOptions({
          rpName: "OneUptime",
          rpID: RP_ID,
          userID: new Uint8Array(Buffer.from(USER_ID)),
          userName: EMAIL,
          userDisplayName: NAME,
          attestationType: "none",
          excludeCredentials: [],
          authenticatorSelection: {
            residentKey: "discouraged",
            userVerification: "preferred",
          },
          ...(server.promptTimeoutInMs
            ? { timeout: server.promptTimeoutInMs }
            : {}),
        });

      server.challenge = options.challenge;

      await route.fulfill({ status: 200, json: { options } });
    },
  );

  await page.route(
    `${server.origin}/identity${VERIFY_SECURITY_KEY_ENROLMENT_ROUTE}`,
    async (route: Route): Promise<void> => {
      server.asked.push("verify");

      const request: Request = route.request();
      const problems: Array<string> = await signInProblems(request);

      if (problems.length > 0) {
        return await refuse({
          route,
          server,
          step: "verify",
          reason: problems.join("; "),
        });
      }

      const credential: unknown = (
        request.postDataJSON() as { data?: { credential?: unknown } } | null
      )?.data?.credential;

      // Spent whether the answer verifies or not, as the server spends it.
      const challenge: string | null = server.challenge;
      server.challenge = null;

      if (!credential || !challenge) {
        return await refuse({
          route,
          server,
          step: "verify",
          reason: "There is no key's answer, or no challenge for it.",
        });
      }

      let verification: VerifiedRegistrationResponse;

      try {
        verification = await verifyRegistrationResponse({
          response: credential as RegistrationResponseJSON,
          expectedChallenge: server.checksAnotherChallenge
            ? ANOTHER_CHALLENGE
            : challenge,
          expectedOrigin: server.origin,
          expectedRPID: RP_ID,
          requireUserVerification: false,
        });
      } catch (error) {
        return await refuse({
          route,
          server,
          step: "verify",
          reason:
            error instanceof Error ? error.message : "Verification failed.",
        });
      }

      if (!verification.verified) {
        return await refuse({
          route,
          server,
          step: "verify",
          reason: "Registration verification failed",
        });
      }

      server.saved.push(verification.registrationInfo.credential.id);

      await route.fulfill({
        status: 200,
        json: signedInUser({
          token: "session-token",
          backupCodes: BACKUP_CODES,
        }),
      });
    },
  );
};

// A USB security key, plugged in through the DevTools protocol.
interface VirtualKey {
  client: CDPSession;
  authenticatorId: string;
}

const plugInSecurityKey: (page: Page) => Promise<VirtualKey> = async (
  page: Page,
): Promise<VirtualKey> => {
  const client: CDPSession = await page.context().newCDPSession(page);

  await client.send("WebAuthn.enable");

  const added: { authenticatorId: string } = await client.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "usb",
        hasResidentKey: false,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );

  return { client: client, authenticatorId: added.authenticatorId };
};

interface KeyCredential {
  credentialId: string;
  rpId?: string | undefined;
  isResidentCredential: boolean;
}

const credentialsOn: (
  key: VirtualKey,
) => Promise<Array<KeyCredential>> = async (
  key: VirtualKey,
): Promise<Array<KeyCredential>> => {
  return (
    await key.client.send("WebAuthn.getCredentials", {
      authenticatorId: key.authenticatorId,
    })
  ).credentials;
};

// The DevTools protocol's base64, as WebAuthn's base64url writes it.
const asBase64Url: (base64: string) => string = (base64: string): string => {
  return Buffer.from(base64, "base64").toString("base64url");
};

// Opens the sign-in page, and signs in with the password.
const signIn: (data: {
  page: Page;
  server: SignInServer;
  language?: string | undefined;
}) => Promise<void> = async (data: {
  page: Page;
  server: SignInServer;
  language?: string | undefined;
}): Promise<void> => {
  await data.page.goto(
    `${data.server.origin}/?page=login&enrolment=1&apihost=self&lang=${
      data.language || "en"
    }`,
  );

  await data.page.getByTestId("email").fill(EMAIL);
  await data.page.getByTestId("password").fill(PASSWORD);
  await data.page.locator(SIGN_IN_BUTTON).click();
};

// Picks a choice, and goes on with it.
const choose: (page: Page, option: string) => Promise<void> = async (
  page: Page,
  option: string,
): Promise<void> => {
  await page.getByTestId(option).click();
  await expect(page.getByTestId(option)).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByTestId(CONTINUE).click();
};

interface Span {
  testId: string;
  left: number;
  right: number;
  height: number;
}

interface StepLayout {
  // The card's content box: what its choices and buttons line up with.
  left: number;
  right: number;
  parts: Array<Span>;
}

/*
 * The card a step is drawn in, and these parts of it, read in one frame:
 * the card is the sign-in card, the box the page draws its steps in.
 */
const stepLayout: (
  page: Page,
  testIds: Array<string>,
) => Promise<StepLayout> = async (
  page: Page,
  testIds: Array<string>,
): Promise<StepLayout> => {
  return await page.evaluate((ids: Array<string>): StepLayout => {
    const first: Element | null = document.querySelector(
      `[data-testid="${ids[0]}"]`,
    );
    const card: HTMLElement | null =
      (first?.closest(".max-w-md > div") as HTMLElement | null) || null;

    if (!card) {
      throw new Error(`No card around ${ids[0]}`);
    }

    const style: CSSStyleDeclaration = getComputedStyle(card);
    const rect: DOMRect = card.getBoundingClientRect();

    return {
      left:
        rect.left +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.paddingLeft),
      right:
        rect.right -
        parseFloat(style.borderRightWidth) -
        parseFloat(style.paddingRight),
      parts: ids.map((id: string): Span => {
        const element: Element | null = document.querySelector(
          `[data-testid="${id}"]`,
        );

        if (!element) {
          throw new Error(`Nothing drawn for ${id}`);
        }

        const box: DOMRect = element.getBoundingClientRect();

        return {
          testId: id,
          left: box.left,
          right: box.right,
          height: box.height,
        };
      }),
    };
  }, testIds);
};

/*
 * What is wrong with a step's layout: each part that spans the card - the
 * choices' list and the step's button - is as wide as the card's content,
 * each choice fills the list (less its rule), a button is as tall as the
 * page's own Sign in, and a choice is one a finger can hit.
 */
const layoutProblems: (data: {
  layout: StepLayout;
  spanning: Array<string>;
  buttons: Array<string>;
  choices?: Array<string> | undefined;
  buttonHeight: number;
}) => Array<string> = (data: {
  layout: StepLayout;
  spanning: Array<string>;
  buttons: Array<string>;
  choices?: Array<string> | undefined;
  buttonHeight: number;
}): Array<string> => {
  const problems: Array<string> = [];
  const partOf: (testId: string) => Span = (testId: string): Span => {
    return data.layout.parts.find((part: Span): boolean => {
      return part.testId === testId;
    })!;
  };

  for (const testId of data.spanning) {
    const part: Span = partOf(testId);

    if (
      Math.abs(part.left - data.layout.left) > 1 ||
      Math.abs(part.right - data.layout.right) > 1
    ) {
      problems.push(
        `${testId} spans ${part.left.toFixed(1)}-${part.right.toFixed(1)}, the card ${data.layout.left.toFixed(1)}-${data.layout.right.toFixed(1)}`,
      );
    }
  }

  for (const testId of data.buttons) {
    if (partOf(testId).height < data.buttonHeight - 0.5) {
      problems.push(
        `${testId} is ${partOf(testId).height.toFixed(1)}px tall, Sign in ${data.buttonHeight.toFixed(1)}px`,
      );
    }
  }

  for (const testId of data.choices || []) {
    const part: Span = partOf(testId);
    const width: number = data.layout.right - data.layout.left;

    if (
      part.left < data.layout.left - 0.5 ||
      part.right > data.layout.right + 0.5 ||
      part.right - part.left < width - 4
    ) {
      problems.push(
        `${testId} spans ${part.left.toFixed(1)}-${part.right.toFixed(1)}, the card ${data.layout.left.toFixed(1)}-${data.layout.right.toFixed(1)}`,
      );
    }

    if (part.height < 44) {
      problems.push(`${testId} is ${part.height.toFixed(1)}px tall`);
    }
  }

  return problems;
};

/*
 * The whole way, from the password to the dashboard, at one width and in
 * one language: every step drawn in that language, fitting the card and the
 * window. Returns what was wrong.
 */
const walkThrough: (data: {
  page: Page;
  server: SignInServer;
  key: VirtualKey;
  language: string;
  width: number;
}) => Promise<Array<string>> = async (data: {
  page: Page;
  server: SignInServer;
  key: VirtualKey;
  language: string;
  width: number;
}): Promise<Array<string>> => {
  const page: Page = data.page;
  const words: PageWords = wordsIn(data.language);
  const where: string = `${data.language} at ${data.width}px`;
  const problems: Array<string> = [];
  const credentialsBefore: number = (await credentialsOn(data.key)).length;

  data.server.asked = [];
  data.server.refusals = [];

  await page.setViewportSize({ width: data.width, height: 900 });
  await page.goto(
    `${data.server.origin}/?page=login&enrolment=1&apihost=self&lang=${data.language}`,
  );

  // The page's own filled button, to hold the steps' buttons to.
  const buttonHeight: number = await page
    .locator(SIGN_IN_BUTTON)
    .evaluate((button: Element): number => {
      return button.getBoundingClientRect().height;
    });

  await page.getByTestId("email").fill(EMAIL);
  await page.getByTestId("password").fill(PASSWORD);
  await page.locator(SIGN_IN_BUTTON).click();

  // The choice.
  await expect(
    page.getByText(words.enrolment["chooseInstruction"]!),
  ).toBeVisible();
  await expect(page.getByTestId(APP_OPTION)).toContainText(
    words.enrolment["authenticatorApp"]!,
  );
  await expect(page.getByTestId(APP_OPTION)).toContainText(
    words.enrolment["authenticatorAppDescription"]!,
  );
  await expect(page.getByTestId(KEY_OPTION)).toContainText(
    words.enrolment["securityKey"]!,
  );
  await expect(page.getByTestId(KEY_OPTION)).toContainText(
    words.enrolment["securityKeyDescription"]!,
  );
  await expect(page.getByTestId(CONTINUE)).toHaveText(
    words.enrolment["continue"]!,
  );
  await expectNoSidewaysScroll(page, {
    message: `${where}: the choice`,
    soft: true,
  });
  problems.push(
    ...layoutProblems({
      layout: await stepLayout(page, [
        CHOICE,
        APP_OPTION,
        KEY_OPTION,
        CONTINUE,
      ]),
      spanning: [CHOICE, CONTINUE],
      buttons: [CONTINUE],
      choices: [APP_OPTION, KEY_OPTION],
      buttonHeight: buttonHeight,
    }).map((problem: string): string => {
      return `${where}, the choice: ${problem}`;
    }),
  );

  // The security key.
  await choose(page, KEY_OPTION);
  await expect(
    page.getByText(words.enrolment["securityKeyInstruction"]!),
  ).toBeVisible();
  await expect(page.getByTestId(REGISTER)).toHaveText(
    words.enrolment["securityKeyButton"]!,
  );
  await expectNoSidewaysScroll(page, {
    message: `${where}: the security key`,
    soft: true,
  });
  problems.push(
    ...layoutProblems({
      layout: await stepLayout(page, [REGISTER]),
      spanning: [REGISTER],
      buttons: [REGISTER],
      buttonHeight: buttonHeight,
    }).map((problem: string): string => {
      return `${where}, the security key: ${problem}`;
    }),
  );

  await page.getByTestId(REGISTER).click();

  // The backup codes, once the key is registered and verified.
  await expect(page.getByTestId(CODES)).toBeVisible();
  await expect(
    page.getByText(words.backupCodes["title"]!, { exact: true }),
  ).toBeVisible();
  await expectNoSidewaysScroll(page, {
    message: `${where}: the backup codes`,
    soft: true,
  });
  problems.push(
    ...layoutProblems({
      layout: await stepLayout(page, [CODES, CODES_CONTINUE]),
      spanning: [CODES, CODES_CONTINUE],
      buttons: [CODES_CONTINUE],
      buttonHeight: buttonHeight,
    }).map((problem: string): string => {
      return `${where}, the backup codes: ${problem}`;
    }),
  );

  if ((await credentialsOn(data.key)).length !== credentialsBefore + 1) {
    problems.push(`${where}: the key does not hold one more credential`);
  }

  if (data.server.refusals.length > 0) {
    problems.push(`${where}: refused - ${data.server.refusals.join(" | ")}`);
  }

  await page.getByTestId(CODES_SAVED).check();
  await page.getByTestId(CODES_CONTINUE).click();
  await page.waitForURL(`${data.server.origin}/dashboard`);

  return problems;
};

test.describe("A security key set up while signing in (#9764)", () => {
  test("the browser registers the key, the server verifies it, the backup codes show once, and only then is the person signed in", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const server: SignInServer = newServer(testInfo);
    const key: VirtualKey = await plugInSecurityKey(page);
    const words: PageWords = wordsIn("en");

    await answerSignIn(page, server);
    await signIn({ page, server });

    // The choice, the authenticator app picked first.
    await expect(
      page.getByText(words.enrolment["chooseInstruction"]!),
    ).toBeVisible();
    await expect(page.getByTestId(APP_OPTION)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId(KEY_OPTION)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(server.asked).toEqual(["login"]);

    await choose(page, KEY_OPTION);

    await expect(page.getByTestId(REGISTER)).toHaveText(
      words.enrolment["securityKeyButton"]!,
    );
    // Choosing asks nothing, and the key holds nothing yet.
    expect(server.asked).toEqual(["login"]);
    expect(await credentialsOn(key)).toEqual([]);

    await page.getByTestId(REGISTER).click();

    // The codes the server minted behind the key, shown once.
    const codes: ReturnType<Page["getByTestId"]> = page.getByTestId(CODES);

    await expect(codes).toBeVisible();

    for (const code of BACKUP_CODES) {
      await expect(codes).toContainText(code);
    }

    expect(server.asked).toEqual(["login", "options", "verify"]);
    expect(server.refusals).toEqual([]);

    // One credential on the key, for this relying party: a security key, not a passkey.
    const credentials: Array<KeyCredential> = await credentialsOn(key);

    expect(credentials).toHaveLength(1);
    expect(credentials[0]!.rpId).toBe(RP_ID);
    expect(credentials[0]!.isResidentCredential).toBe(false);
    expect(server.saved).toEqual([asBase64Url(credentials[0]!.credentialId)]);

    // Not signed in until the codes are saved.
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByTestId(CODES_CONTINUE)).toBeDisabled();

    await page.getByTestId(CODES_SAVED).check();
    await page.getByTestId(CODES_CONTINUE).click();

    await page.waitForURL(`${server.origin}/dashboard`);
  });

  test("a prompt that never completes - the key is never touched - says the key was not registered, in the reader's language, and signs nobody in", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const server: SignInServer = newServer(testInfo);
    const key: VirtualKey = await plugInSecurityKey(page);
    const german: PageWords = wordsIn("de");

    /*
     * The key waits for a touch that never comes, and the browser gives up
     * when the prompt's time is out: as short as the options allow, and no
     * shorter than Chromium's own floor.
     */
    await key.client.send("WebAuthn.setAutomaticPresenceSimulation", {
      authenticatorId: key.authenticatorId,
      enabled: false,
    });
    server.promptTimeoutInMs = 1000;

    await answerSignIn(page, server);
    await signIn({ page, server, language: "de" });
    await expect(
      page.getByText(german.enrolment["chooseInstruction"]!),
    ).toBeVisible();

    await choose(page, KEY_OPTION);
    await page.getByTestId(REGISTER).click();

    await expect(
      page.getByText(german.enrolment["securityKeyNotCompleted"]!),
    ).toBeVisible({ timeout: 60000 });

    // Nothing was sent for it, nothing is on the key, and nobody is signed in.
    expect(server.asked).toEqual(["login", "options"]);
    expect(await credentialsOn(key)).toEqual([]);
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByTestId(CODES)).toHaveCount(0);

    // And it can be tried again.
    await expect(page.getByTestId(REGISTER)).toBeEnabled();
  });

  test("an answer the server does not verify is refused, and signs nobody in", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const server: SignInServer = newServer(testInfo);
    const key: VirtualKey = await plugInSecurityKey(page);

    server.checksAnotherChallenge = true;

    await answerSignIn(page, server);
    await signIn({ page, server });
    await choose(page, KEY_OPTION);
    await page.getByTestId(REGISTER).click();

    await expect(
      page.getByText(/Unexpected registration response challenge/),
    ).toBeVisible();

    expect(server.asked).toEqual(["login", "options", "verify"]);
    expect(server.saved).toEqual([]);
    expect(server.refusals).toHaveLength(1);
    // The browser made a credential; the server did not take it.
    expect(await credentialsOn(key)).toHaveLength(1);
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByTestId(CODES)).toHaveCount(0);
  });

  test("Choose another way goes back to the choice, and the authenticator app is its QR code and its code", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const server: SignInServer = newServer(testInfo);
    const words: PageWords = wordsIn("en");

    await plugInSecurityKey(page);
    await answerSignIn(page, server);
    await signIn({ page, server });
    await choose(page, KEY_OPTION);

    await page.getByTestId(ANOTHER_WAY).click();
    await expect(page.getByTestId(CHOICE)).toBeVisible();
    await expect(page.getByTestId(REGISTER)).toHaveCount(0);

    await choose(page, APP_OPTION);

    await expect(
      page.getByText(words.enrolment["scanInstruction"]!),
    ).toBeVisible();
    await expect(page.getByTestId("qr-code")).toBeVisible();
    await expect(page.getByTestId("enrolment-code")).toBeVisible();
    expect(server.asked).toEqual(["login"]);
  });

  test("a browser that cannot register a key goes straight to the authenticator app's QR code, with no choice", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const server: SignInServer = newServer(testInfo);
    const words: PageWords = wordsIn("en");

    await page.addInitScript((): void => {
      Object.defineProperty(window, "PublicKeyCredential", {
        configurable: true,
        value: undefined,
      });
    });

    await answerSignIn(page, server);
    await signIn({ page, server });

    await expect(
      page.getByText(words.enrolment["scanInstruction"]!),
    ).toBeVisible();
    await expect(page.getByTestId("qr-code")).toBeVisible();
    await expect(page.getByTestId("enrolment-code")).toBeVisible();
    await expect(page.getByTestId(CHOICE)).toHaveCount(0);
    await expect(page.getByTestId(ANOTHER_WAY)).toHaveCount(0);
    expect(server.asked).toEqual(["login"]);
  });

  test("on a phone, 320px and 390px wide, every step fits its card and the window", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const server: SignInServer = newServer(testInfo);
    const key: VirtualKey = await plugInSecurityKey(page);
    const problems: Array<string> = [];

    await answerSignIn(page, server);

    for (const width of [320, 390]) {
      problems.push(
        ...(await walkThrough({ page, server, key, language: "en", width })),
      );
    }

    expect(problems).toEqual([]);
  });

  test("in German and in Persian, which reads right to left, every step is in the reader's words and fits a phone", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const server: SignInServer = newServer(testInfo);
    const key: VirtualKey = await plugInSecurityKey(page);
    const problems: Array<string> = [];

    await answerSignIn(page, server);

    for (const language of ["de", "fa"]) {
      for (const width of [320, 390]) {
        problems.push(
          ...(await walkThrough({ page, server, key, language, width })),
        );
      }
    }

    expect(problems).toEqual([]);
  });

  test("Persian is drawn right to left", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const server: SignInServer = newServer(testInfo);

    await plugInSecurityKey(page);
    await answerSignIn(page, server);
    await signIn({ page, server, language: "fa" });

    await expect(
      page.getByText(wordsIn("fa").enrolment["chooseInstruction"]!),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});
