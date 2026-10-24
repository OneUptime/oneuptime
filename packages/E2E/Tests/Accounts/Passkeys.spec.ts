import {
  BASE_URL,
  E2E_SIGNUP_PASSWORD,
  IS_BILLING_ENABLED,
} from "../../Config";
import { registerAndCreateProject } from "../Dashboard/Helpers/ProductOnboarding";
import { clickRowMenuAction } from "../Helpers/RowActions";
import {
  APIRequestContext,
  APIResponse,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  CDPSession,
  Page,
  Locator,
  Request,
  Response,
  Route,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

/*
 * Exercise the actual browser WebAuthn implementation, server verification,
 * stored credentials and session cookies. Chromium's virtual CTAP2 device
 * produces real signatures; only the cancellation case stubs a browser API.
 *
 * Keep one browser/device through this serial lifecycle so its signature
 * counter advances naturally and the final revocation test uses the same
 * private key that successfully signed in earlier. No existing user or
 * credential is changed: the suite creates its own account and project.
 */
/*
 * The page has no horizontal scroll at its current width. Read until the
 * layout has caught up with the setViewportSize just before each call: a
 * single read taken while the page was still reflowing measured the wider
 * layout and failed a self-hosted run (2026-10-24) that passed on retry. A
 * page that really overflows still fails, once the wait is over.
 */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(
      async (): Promise<boolean> => {
        return page.evaluate((): boolean => {
          return document.documentElement.scrollWidth <= window.innerWidth;
        });
      },
      { timeout: 10000 },
    )
    .toBe(true);
}

test.describe("Passkey account lifecycle", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    IS_BILLING_ENABLED && !process.env["E2E_PASSKEY_EMAIL"],
    "Billing-enabled environments require E2E_PASSKEY_EMAIL and a test mailbox that verifies the fixture's email after registration.",
  );

  const origin: string = BASE_URL.toString().replace(/\/$/, "");
  /*
   * Billing-enabled environments must verify this fixture's email through
   * their test mailbox before sign-in; the default CI instance verifies
   * fresh registrations automatically because billing is disabled.
   */
  const email: string =
    process.env["E2E_PASSKEY_EMAIL"] ||
    `passkey-${randomUUID()}@oneuptime-e2e.invalid`;
  const passkeyName: string = "My laptop passkey";
  const securityKeyName: string = "My USB security key";
  const loginUrl: string = `${origin}/accounts/login`;
  const profileUrl: string = `${origin}/dashboard/user-profile/passkeys`;
  const twoFactorUrl: string = `${origin}/dashboard/user-profile/two-factor-auth`;
  const loginEndpoint: string = `${origin}/identity/passkey-login`;
  const optionsRoute: string = "**/identity/passkey-login-options";
  let context: BrowserContext;
  let page: Page;
  let client: CDPSession;
  let authenticatorId: string;
  let securityAuthenticatorId: string;
  let projectId: string;
  let userId: string;
  let successfulAssertion: Record<string, unknown>;
  let successfulChallengeCookie: string;

  const saveScreenshot: (
    name: string,
    info: TestInfo,
  ) => Promise<void> = async (name: string, info: TestInfo): Promise<void> => {
    const directory: string | undefined =
      process.env["E2E_PASSKEY_SCREENSHOT_DIR"];
    const screenshotPath: string = directory
      ? path.join(directory, `${name}.png`)
      : info.outputPath(`${name}.png`);

    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await info.attach(name, {
      path: screenshotPath,
      contentType: "image/png",
    });
  };

  const signOut: () => Promise<void> = async (): Promise<void> => {
    /*
     * Leave the app before the session ends. An app page still open gets a
     * 401 on its next request, signs itself out and navigates to the login
     * page on its own, racing the navigation below: whichever starts second
     * aborts the other (net::ERR_ABORTED). /status is a plain response on
     * the same origin, so no app code runs there, and the app's storage for
     * this origin can still be cleared from it.
     */
    await page.goto(`${origin}/status`);
    const response: APIResponse = await context.request.post(
      `${origin}/identity/logout`,
    );
    expect(response.ok()).toBe(true);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await context.clearCookies();
    await page.goto(loginUrl);
    await expect(page.getByTestId("passkey-login")).toBeVisible();
  };

  const expectSignedOut: () => Promise<void> = async (): Promise<void> => {
    await expect(page).toHaveURL(/\/accounts\/login/);
    expect(
      (await context.cookies()).some((cookie: { name: string }) => {
        return cookie.name === "user-token";
      }),
    ).toBe(false);
    await expect(page.getByTestId("passkey-login")).toBeEnabled();
  };

  const expectSignedIn: () => Promise<void> = async (): Promise<void> => {
    await expect(page).toHaveURL(/\/dashboard\//, { timeout: 60000 });
    const cookies: Awaited<ReturnType<BrowserContext["cookies"]>> =
      await context.cookies();
    expect(
      cookies.find((cookie: { name: string }) => {
        return cookie.name === "user-id";
      })?.value,
    ).toBe(userId);
    expect(
      cookies.find((cookie: { name: string }) => {
        return cookie.name === "user-token";
      }),
    ).toMatchObject({ httpOnly: true });
  };

  type Box = { x: number; y: number; width: number; height: number };

  const boxOf: (locator: Locator) => Promise<Box> = async (
    locator: Locator,
  ): Promise<Box> => {
    const bounds: Box | null = await locator.boundingBox();
    expect(bounds).not.toBeNull();
    return bounds as Box;
  };

  // Single sign-on, the first of the other ways in.
  const ssoOption: () => Locator = (): Locator => {
    return page.getByRole("link", { name: "Sign in with SSO", exact: true });
  };

  type Look = { background: string; border: string };

  const lookOf: (locator: Locator) => Promise<Look> = async (
    locator: Locator,
  ): Promise<Look> => {
    return locator.evaluate((element: HTMLElement): Look => {
      const style: CSSStyleDeclaration = window.getComputedStyle(element);
      return {
        background: style.backgroundColor,
        border: style.borderTopWidth,
      };
    });
  };

  /*
   * The sign-in page leads with the password form, and Login is its one
   * filled button. Under it, an "or" divider and the other ways in as normal
   * buttons, "Sign in with SSO" then "Sign in with a passkey": as wide and
   * as tall as Login, lined up with it, white and outlined where it is
   * filled. They used to be centred text links. The tinted passkey panel and
   * its divider over the form are long gone, and "New to passkeys?" waits
   * for an attempt that did not sign in.
   */
  const expectFormFirstThenOtherWaysIn: () => Promise<void> =
    async (): Promise<void> => {
      const passkeyOption: Locator = page.getByTestId("passkey-login");
      const email: Box = await boxOf(page.getByTestId("email"));
      const signIn: Box = await boxOf(page.getByTestId("Login"));
      const divider: Box = await boxOf(
        page.getByTestId("sign-in-options-divider"),
      );
      const sso: Box = await boxOf(ssoOption());
      const passkey: Box = await boxOf(passkeyOption);

      expect(email.y).toBeLessThan(signIn.y);
      expect(signIn.y + signIn.height).toBeLessThanOrEqual(divider.y);
      expect(divider.y + divider.height).toBeLessThanOrEqual(sso.y);
      expect(sso.y + sso.height).toBeLessThanOrEqual(passkey.y);
      for (const option of [sso, passkey]) {
        expect(Math.abs(option.x - signIn.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(option.width - signIn.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(option.height - signIn.height)).toBeLessThanOrEqual(1);
      }
      await expect(page.getByTestId("sign-in-options-divider")).toHaveText(
        "or",
      );

      const outlined: Look = {
        background: "rgb(255, 255, 255)",
        border: "1px",
      };
      expect(await lookOf(passkeyOption)).toEqual(outlined);
      expect(await lookOf(ssoOption())).toEqual(outlined);
      expect((await lookOf(page.getByTestId("Login"))).background).not.toBe(
        outlined.background,
      );

      await expect(
        page.getByText("Use single sign-on (SSO) instead", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Use a saved passkey", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("or sign in with a password", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("New to passkeys?", { exact: true }),
      ).toHaveCount(0);
    };

  const signInWithPasskey: () => Promise<void> = async (): Promise<void> => {
    await expect(page.locator('input[type="email"]')).toHaveValue("");
    await expect(page.locator('input[type="password"]')).toHaveValue("");
    const responsePromise: Promise<Response> = page.waitForResponse(
      (response: Response) => {
        return response.url() === loginEndpoint;
      },
    );
    await page.getByTestId("passkey-login").click();
    expect((await responsePromise).ok()).toBe(true);
    await expectSignedIn();
  };

  test.beforeAll(
    async ({
      browser,
      browserName,
      contextOptions,
    }: {
      browser: Browser;
      browserName: string;
      contextOptions: BrowserContextOptions;
    }) => {
      test.skip(
        browserName !== "chromium",
        "Virtual WebAuthn authenticators require Chromium's DevTools protocol.",
      );
      context = await browser.newContext({
        ...contextOptions,
        viewport: { width: 1440, height: 1000 },
      });
      page = await context.newPage();
      page.setDefaultTimeout(30000);
      client = await context.newCDPSession(page);
      await client.send("WebAuthn.enable");
      const authenticator: { authenticatorId: string } = await client.send(
        "WebAuthn.addVirtualAuthenticator",
        {
          options: {
            protocol: "ctap2",
            ctap2Version: "ctap2_1",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        },
      );
      authenticatorId = authenticator.authenticatorId;
    },
  );

  test.afterAll(async () => {
    await context?.close();
  });

  test("creates a discoverable passkey in account settings and shows recovery codes", async () => {
    const onboardingOptions: Parameters<typeof registerAndCreateProject>[0] & {
      enablePaidUsage: false;
    } = {
      page,
      email,
      projectNamePrefix: "Passkey tests",
      enablePaidUsage: false,
    };
    projectId = await registerAndCreateProject(onboardingOptions);
    userId = (await context.cookies()).find((cookie: { name: string }) => {
      return cookie.name === "user-id";
    })!.value;
    await page.goto(profileUrl);
    await page
      .getByRole("button", { name: "Add Passkey", exact: true })
      .click();
    await page
      .getByTestId("modal")
      .locator('input[type="text"]')
      .fill(passkeyName);

    const optionsPromise: Promise<Response> = page.waitForResponse(
      "**/user-webauthn/generate-registration-options",
    );
    const registrationPromise: Promise<Response> = page.waitForResponse(
      "**/user-webauthn/verify-registration",
    );
    await page
      .getByRole("button", { name: "Create Passkey", exact: true })
      .click();
    const optionsResponse: Response = await optionsPromise;
    expect(optionsResponse.ok()).toBe(true);
    expect(
      (await optionsResponse.json()).options.authenticatorSelection,
    ).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    expect((await registrationPromise).ok()).toBe(true);

    await expect(page.getByTestId("backup-code")).toHaveCount(10);
    await expect(
      page.getByRole("button", { name: "Done", exact: true }),
    ).toBeDisabled();
    await page.getByTestId("backup-codes-saved-checkbox").check();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("row").filter({ hasText: passkeyName }),
    ).toBeVisible();

    const device: { credentials: Array<{ isResidentCredential: boolean }> } =
      await client.send("WebAuthn.getCredentials", { authenticatorId });
    expect(device.credentials).toHaveLength(1);
    expect(device.credentials[0]!.isResidentCredential).toBe(true);
    await saveScreenshot("passkey-settings", test.info());
  });

  test("registers a security key on the separate two-factor page and keeps credential lists distinct", async () => {
    await page
      .getByRole("link", { name: /Two.factor authentication/i })
      .click();
    await expect(page).toHaveURL(twoFactorUrl);
    await expect(
      page.getByRole("button", { name: "Add Passkey", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /Authenticator apps/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Backup codes/i }),
    ).toBeVisible();
    await expect(
      page.getByText("Keep another way to sign in", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("row").filter({ hasText: passkeyName }),
    ).toHaveCount(0);

    const authenticator: { authenticatorId: string } = await client.send(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          ctap2Version: "ctap2_1",
          transport: "usb",
          hasResidentKey: false,
          hasUserVerification: false,
          automaticPresenceSimulation: true,
        },
      },
    );
    securityAuthenticatorId = authenticator.authenticatorId;
    await client.send("WebAuthn.setAutomaticPresenceSimulation", {
      authenticatorId,
      enabled: false,
    });
    try {
      await page
        .getByRole("button", { name: "Add Security Key", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Security key name" })
        .fill(securityKeyName);
      const optionsPromise: Promise<Response> = page.waitForResponse(
        "**/user-webauthn/generate-registration-options",
      );
      const registrationPromise: Promise<Response> = page.waitForResponse(
        "**/user-webauthn/verify-registration",
      );
      await page
        .getByRole("button", { name: "Register Security Key", exact: true })
        .click();
      const optionsResponse: Response = await optionsPromise;
      expect(optionsResponse.request().postDataJSON()).toMatchObject({
        isPasskey: false,
      });
      expect((await registrationPromise).ok()).toBe(true);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("row").filter({ hasText: securityKeyName }),
      ).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: passkeyName }),
      ).toHaveCount(0);
      // Adding another method preserves the existing recovery codes.
      await expect(page.getByTestId("backup-code")).toHaveCount(0);
      const device: { credentials: Array<{ isResidentCredential: boolean }> } =
        await client.send("WebAuthn.getCredentials", {
          authenticatorId: securityAuthenticatorId,
        });
      expect(device.credentials).toHaveLength(1);
      expect(device.credentials[0]!.isResidentCredential).toBe(false);
      await saveScreenshot("two-factor-settings", test.info());
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.getByRole("button", { name: "Add Security Key", exact: true }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
      await saveScreenshot("two-factor-settings-mobile", test.info());
      await page.setViewportSize({ width: 1440, height: 1000 });
    } finally {
      await client.send("WebAuthn.setAutomaticPresenceSimulation", {
        authenticatorId,
        enabled: true,
      });
      await client.send("WebAuthn.setAutomaticPresenceSimulation", {
        authenticatorId: securityAuthenticatorId,
        enabled: false,
      });
    }

    await page.getByRole("link", { name: "Passkeys", exact: true }).click();
    await expect(page).toHaveURL(profileUrl);
    await expect(
      page.getByRole("row").filter({ hasText: passkeyName }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: securityKeyName }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add Security Key", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /Backup codes/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /Authenticator apps/i }),
    ).toHaveCount(0);
    await saveScreenshot("passkey-settings-separated", test.info());
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Add Passkey", exact: true }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await saveScreenshot("passkey-settings-mobile", test.info());
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  test("signs in with a passkey without entering an email or password", async () => {
    await signOut();
    await expectFormFirstThenOtherWaysIn();
    await saveScreenshot("passkey-login-desktop", test.info());
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("Login")).toBeInViewport();
    await expect(page.getByTestId("passkey-login")).toBeInViewport();
    await expectFormFirstThenOtherWaysIn();
    await expectNoHorizontalScroll(page);
    await saveScreenshot("passkey-login-mobile", test.info());
    await page.setViewportSize({ width: 1440, height: 1000 });

    const requestPromise: Promise<Request> = page.waitForRequest(loginEndpoint);
    await signInWithPasskey();
    const request: Request = await requestPromise;
    successfulAssertion = request.postDataJSON() as Record<string, unknown>;
    successfulChallengeCookie = (await request.allHeaders())["cookie"] || "";
    expect(successfulAssertion["credential"]).toBeDefined();
    expect(successfulAssertion["email"]).toBeUndefined();
    expect(successfulAssertion["password"]).toBeUndefined();
  });

  test("rejects replay with a spent challenge and without a browser challenge", async () => {
    await signOut();
    for (const cookie of [successfulChallengeCookie, ""]) {
      const response: APIResponse = await context.request.post(loginEndpoint, {
        headers: { Origin: origin, Cookie: cookie },
        data: successfulAssertion,
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      await expectSignedOut();
    }
    await signInWithPasskey();
  });

  test("rejects an invalid signature and permits a fresh attempt", async () => {
    await signOut();
    await client.send("WebAuthn.setResponseOverrideBits", {
      authenticatorId,
      isBogusSignature: true,
    });
    try {
      const responsePromise: Promise<Response> =
        page.waitForResponse(loginEndpoint);
      await page.getByTestId("passkey-login").click();
      const response: Response = await responsePromise;
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      await expectSignedOut();
    } finally {
      await client.send("WebAuthn.setResponseOverrideBits", {
        authenticatorId,
      });
    }
    await signInWithPasskey();
  });

  test("requires authenticator user verification even when the client downgrades its options", async () => {
    await signOut();
    await page.route(optionsRoute, async (route: Route) => {
      const response: APIResponse = await route.fetch();
      const body: { options: { userVerification: string } } =
        await response.json();
      expect(body.options.userVerification).toBe("required");
      body.options.userVerification = "discouraged";
      await route.fulfill({ response, json: body });
    });
    await client.send("WebAuthn.setResponseOverrideBits", {
      authenticatorId,
      isBadUV: true,
    });
    try {
      const responsePromise: Promise<Response> =
        page.waitForResponse(loginEndpoint);
      await page.getByTestId("passkey-login").click();
      const response: Response = await responsePromise;
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      await expectSignedOut();
    } finally {
      await page.unroute(optionsRoute);
      await client.send("WebAuthn.setResponseOverrideBits", {
        authenticatorId,
      });
    }
    await signInWithPasskey();
  });

  test("handles a canceled browser prompt and lets the user retry", async () => {
    await signOut();
    await page.evaluate(() => {
      const originalGet: CredentialsContainer["get"] =
        navigator.credentials.get.bind(navigator.credentials);
      navigator.credentials.get = async (): Promise<Credential | null> => {
        navigator.credentials.get = originalGet;
        throw new DOMException(
          "The user canceled the request.",
          "NotAllowedError",
        );
      };
    });
    await page.getByTestId("passkey-login").click();
    /*
     * One sentence: "Try passkey again" right above it, and the password
     * form above that, are the next steps.
     */
    await expect(
      page.getByText("Passkey sign-in was canceled or timed out.", {
        exact: true,
      }),
    ).toBeVisible();
    await expectSignedOut();
    await expect(
      page.getByText("Email is required.", { exact: true }),
    ).toHaveCount(0);

    /*
     * "New to passkeys?" is help for exactly this moment: an attempt that did
     * not sign in, often because there is no passkey yet. It names the
     * Dashboard's real menu.
     */
    const help: Locator = page.getByText("New to passkeys?", { exact: true });
    await expect(help).toBeVisible();
    await help.click();
    await expect(
      page.getByText(/then open User Profile → Security → Passkeys\./),
    ).toBeVisible();

    /*
     * The in-page Cancel action must abort a real pending browser ceremony,
     * restore password sign-in, and permit a fresh attempt with the same key.
     */
    await client.send("WebAuthn.setAutomaticPresenceSimulation", {
      authenticatorId,
      enabled: false,
    });
    try {
      await page.getByTestId("passkey-login").click();
      await expect(
        page.getByRole("button", { name: "Check your device", exact: true }),
      ).toBeVisible();
      /*
       * While the attempt runs, the password form is paused, and looks it:
       * disabled, faded as a whole and out of the pointer's reach, its
       * links included. The passkey option and its Cancel, outside the
       * form, are not.
       */
      const passwordForm: Locator = page
        .locator("fieldset")
        .filter({ has: page.getByTestId("email") });
      await expect(page.getByTestId("email")).toBeDisabled();
      await expect(page.getByTestId("Login")).toBeDisabled();
      await expect(passwordForm).toHaveCSS("opacity", "0.5");
      await expect(passwordForm).toHaveCSS("pointer-events", "none");
      // The "or" divider and single sign-on pause with the form.
      await expect(ssoOption()).toHaveCSS("pointer-events", "none");
      await expect(
        passwordForm.getByTestId("sign-in-options-divider"),
      ).toHaveCount(1);
      await expect(page.getByTestId("passkey-option")).toHaveCSS(
        "opacity",
        "1",
      );
      // The passkey button keeps its look while its attempt runs.
      expect(await lookOf(page.getByTestId("passkey-login"))).toEqual({
        background: "rgb(255, 255, 255)",
        border: "1px",
      });
      await expect(page.getByTestId("cancel-passkey-login")).toHaveCSS(
        "pointer-events",
        "auto",
      );
      await page.getByTestId("cancel-passkey-login").click();
      await expect(
        page.getByText("Passkey sign-in canceled.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("email")).toBeEnabled();
      await expect(passwordForm).toHaveCSS("opacity", "1");
      await expect(passwordForm).toHaveCSS("pointer-events", "auto");
      await expect(
        page.getByText("New to passkeys?", { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("passkey-login")).toBeFocused();
      await expect(page.locator('input[type="password"]')).toBeEnabled();
      await expect(
        page.getByText("Email is required.", { exact: true }),
      ).toHaveCount(0);
      await expectSignedOut();
    } finally {
      await client.send("WebAuthn.setAutomaticPresenceSimulation", {
        authenticatorId,
        enabled: true,
      });
    }
    await signInWithPasskey();
  });

  /*
   * A browser without WebAuthn (an in-app web view, an old browser) keeps the
   * quiet option and says why it cannot work there when it is clicked,
   * instead of a sentence about passkeys on every visit. It asks the server
   * for nothing, and the password form stays usable.
   */
  test("a browser without passkeys keeps the option and explains it when clicked, without a request", async () => {
    await signOut();
    const other: Page = await context.newPage();
    const passkeyRequests: Array<string> = [];

    try {
      await other.addInitScript(() => {
        Object.defineProperty(window, "PublicKeyCredential", {
          configurable: true,
          value: undefined,
        });
      });
      other.on("request", (request: Request) => {
        const pathname: string = new URL(request.url()).pathname;
        if (pathname.startsWith("/identity/passkey-login")) {
          passkeyRequests.push(pathname);
        }
      });
      await other.goto(loginUrl);

      const option: Locator = other.getByRole("button", {
        name: "Sign in with a passkey",
        exact: true,
      });
      await expect(option).toBeEnabled();
      await expect(
        other.getByText(/Passkeys aren’t available in this browser/),
      ).toHaveCount(0);

      await option.click();

      await expect(
        other.getByText(
          "Passkeys aren’t available in this browser. You can still sign in with your password or SSO.",
          { exact: true },
        ),
      ).toBeVisible();
      /*
       * Having said it cannot work here, the option is unavailable to a
       * screen reader and drawn grey, and keeps the focus it was given.
       */
      await expect(option).toHaveAttribute("aria-disabled", "true");
      await expect(option).toBeFocused();
      await expect(
        other.getByText("New to passkeys?", { exact: true }),
      ).toHaveCount(0);
      await expect(other.locator('input[type="password"]')).toBeEnabled();
      expect(passkeyRequests).toEqual([]);
    } finally {
      await other.close();
    }

    await signInWithPasskey();
  });

  test.describe("mobile browser handoff", () => {
    test.skip(
      !origin.startsWith("https://"),
      "The app handoff requires an HTTPS E2E server, including for localhost.",
    );

    interface MobileRequest {
      url: string;
      state: string;
      codeVerifier: string;
      codeChallenge: string;
    }

    const mobilePageUrl: string = `${origin}/accounts/mobile-passkey`;
    const exchangeEndpoint: string = `${origin}/identity/mobile-passkey-exchange`;
    const sessionCookieNames: Array<string> = [
      "user-id",
      "user-token",
      "user-refresh-token",
    ];

    const createMobileRequest: () => MobileRequest = (): MobileRequest => {
      const codeVerifier: string = randomBytes(32).toString("hex");
      const state: string = randomBytes(32).toString("hex");
      const codeChallenge: string = createHash("sha256")
        .update(codeVerifier, "ascii")
        .digest("base64url");
      const url: URL = new URL(mobilePageUrl);
      url.searchParams.set("state", state);
      url.searchParams.set("codeChallenge", codeChallenge);
      url.searchParams.set("codeChallengeMethod", "S256");
      return { url: url.toString(), state, codeVerifier, codeChallenge };
    };

    const expectNoBrowserSession: () => Promise<void> =
      async (): Promise<void> => {
        expect(
          (await context.cookies()).filter((cookie: { name: string }) => {
            return sessionCookieNames.includes(cookie.name);
          }),
        ).toEqual([]);
      };

    test("exchanges a real mobile passkey proof once without signing in the browser", async ({
      request,
    }: {
      request: APIRequestContext;
    }) => {
      await signOut();
      const mobile: MobileRequest = createMobileRequest();
      await page.goto(mobile.url);
      await expect(page.getByTestId("mobile-passkey-sign-in")).toBeEnabled();
      await expect(
        page.locator('input[type="email"], input[type="password"]'),
      ).toHaveCount(0);
      const optionsPromise: Promise<Response> =
        page.waitForResponse(optionsRoute);
      const assertionPromise: Promise<Request> =
        page.waitForRequest(loginEndpoint);
      const proofPromise: Promise<Response> =
        page.waitForResponse(loginEndpoint);
      await page.getByTestId("mobile-passkey-sign-in").click();

      const optionsResponse: Response = await optionsPromise;
      expect(optionsResponse.ok()).toBe(true);
      expect(optionsResponse.request().postDataJSON()).toEqual({
        mobileAuth: {
          state: mobile.state,
          codeChallenge: mobile.codeChallenge,
          codeChallengeMethod: "S256",
        },
      });
      expect((await optionsResponse.json()).options.userVerification).toBe(
        "required",
      );
      const assertionRequest: Request = await assertionPromise;
      expect(assertionRequest.postDataJSON()).toEqual({
        credential: expect.any(Object),
      });
      expect((await assertionRequest.allHeaders())["cookie"]).toMatch(
        /oneuptime-passkey-login=mobile\.[A-Za-z0-9_-]+/,
      );

      const proof: Response = await proofPromise;
      expect(proof.ok()).toBe(true);
      expect(proof.headers()["cache-control"]).toContain("no-store");
      const proofBody: { mobileAuth: { callbackUrl: string } } =
        await proof.json();
      expect(proofBody).toEqual({
        mobileAuth: { callbackUrl: expect.any(String) },
      });
      const callback: URL = new URL(proofBody.mobileAuth.callbackUrl);
      expect(callback.protocol).toBe("oneuptime:");
      expect(callback.hostname).toBe("passkey");
      expect(callback.pathname).toBe("");
      expect(Array.from(callback.searchParams.keys())).toEqual([
        "code",
        "state",
        "serverOrigin",
      ]);
      expect(callback.searchParams.get("state")).toBe(mobile.state);
      expect(callback.searchParams.get("serverOrigin")).toBe(
        new URL(origin).origin,
      );
      const code: string = callback.searchParams.get("code") || "";
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await expect(
        page.getByRole("link", { name: "Return to app", exact: true }),
      ).toHaveAttribute("href", callback.toString());
      await expectNoBrowserSession();
      await saveScreenshot("passkey-mobile-browser-confirmed", test.info());

      /*
       * The isolated API context represents the app after its system-browser
       * callback. It has neither the browser's challenge cookie nor a session.
       * The proof and code above came from the real server and authenticator.
       */
      const exchangeBody: {
        code: string;
        codeVerifier: string;
        state: string;
      } = {
        code,
        codeVerifier: mobile.codeVerifier,
        state: mobile.state,
      };
      for (const wrong of [
        { codeVerifier: randomBytes(32).toString("hex") },
        { state: randomBytes(32).toString("hex") },
      ]) {
        const refused: APIResponse = await request.post(exchangeEndpoint, {
          data: { ...exchangeBody, ...wrong },
        });
        expect(refused.status()).toBeGreaterThanOrEqual(400);
        expect(refused.status()).toBeLessThan(500);
        expect(refused.headers()["cache-control"]).toContain("no-store");
      }

      let nativeRefreshToken: string | undefined;
      try {
        const exchanged: APIResponse = await request.post(exchangeEndpoint, {
          data: exchangeBody,
        });
        expect(exchanged.ok()).toBe(true);
        expect(exchanged.headers()["cache-control"]).toContain("no-store");
        const session: {
          _id: string | { value: string };
          _miscData: {
            accessToken: string;
            refreshToken: string;
            refreshTokenExpiresAt: string;
          };
        } = await exchanged.json();
        nativeRefreshToken = session._miscData.refreshToken;
        expect(
          typeof session._id === "string" ? session._id : session._id.value,
        ).toBe(userId);
        expect(session._miscData.accessToken).toEqual(expect.any(String));
        expect(session._miscData.accessToken.length).toBeGreaterThan(0);
        expect(nativeRefreshToken.length).toBeGreaterThan(0);
        expect(
          Date.parse(session._miscData.refreshTokenExpiresAt),
        ).toBeGreaterThan(Date.now());
        expect(
          (await request.storageState()).cookies.filter(
            (cookie: { name: string }) => {
              return sessionCookieNames.includes(cookie.name);
            },
          ),
        ).toEqual([]);
        await expectNoBrowserSession();

        const replayed: APIResponse = await request.post(exchangeEndpoint, {
          data: exchangeBody,
        });
        expect(replayed.status()).toBeGreaterThanOrEqual(400);
        expect(replayed.status()).toBeLessThan(500);

        // Confirm that the returned refresh token belongs to a real active session.
        const renewed: APIResponse = await request.post(
          `${origin}/identity/refresh-token`,
          {
            data: { refreshToken: nativeRefreshToken },
          },
        );
        expect(renewed.ok()).toBe(true);
        const renewedSession: { accessToken: string; refreshToken: string } =
          await renewed.json();
        nativeRefreshToken = renewedSession.refreshToken;
        expect(renewedSession.accessToken.length).toBeGreaterThan(0);
        expect(nativeRefreshToken.length).toBeGreaterThan(0);
        await expectNoBrowserSession();
      } finally {
        if (nativeRefreshToken) {
          const loggedOut: APIResponse = await request.post(
            `${origin}/identity/logout`,
            {
              data: { refreshToken: nativeRefreshToken },
            },
          );
          expect(loggedOut.ok()).toBe(true);
        }
      }
    });

    test("canceling a real pending mobile prompt issues no code or session", async () => {
      await signOut();
      const mobile: MobileRequest = createMobileRequest();
      await page.goto(mobile.url);
      let assertionRequests: number = 0;
      const countAssertions: (request: Request) => void = (
        request: Request,
      ): void => {
        if (request.url() === loginEndpoint) {
          assertionRequests++;
        }
      };
      page.on("request", countAssertions);
      await client.send("WebAuthn.setAutomaticPresenceSimulation", {
        authenticatorId,
        enabled: false,
      });
      try {
        // Observe settlement of the real browser operation without replacing its result.
        await page.evaluate(() => {
          const originalGet: CredentialsContainer["get"] =
            navigator.credentials.get.bind(navigator.credentials);
          const runtime: Window & { passkeyRequestSettled?: boolean } = window;
          runtime.passkeyRequestSettled = false;
          navigator.credentials.get = async (
            ...args: Parameters<CredentialsContainer["get"]>
          ): Promise<Credential | null> => {
            try {
              return await originalGet(...args);
            } finally {
              navigator.credentials.get = originalGet;
              runtime.passkeyRequestSettled = true;
            }
          };
        });
        await page.getByTestId("mobile-passkey-sign-in").click();
        await expect(
          page.getByRole("button", { name: "Check your device", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", {
            name: "Cancel and return to app",
            exact: true,
          })
          .click();
        await expect(
          page.getByText("Passkey sign-in canceled.", { exact: true }),
        ).toBeVisible();
        await expect(page.getByTestId("mobile-passkey-sign-in")).toBeEnabled();
        await page.waitForFunction(() => {
          const runtime: Window & { passkeyRequestSettled?: boolean } = window;
          return runtime.passkeyRequestSettled === true;
        });
        expect(assertionRequests).toBe(0);
        await expectNoBrowserSession();
        await expect(
          page.getByRole("link", { name: "Return to app", exact: true }),
        ).toHaveCount(0);
      } finally {
        page.off("request", countAssertions);
        await client.send("WebAuthn.setAutomaticPresenceSimulation", {
          authenticatorId,
          enabled: true,
        });
      }
    });

    test("invalid mobile requests and missing browser binding cannot issue a session", async () => {
      await signOut();
      let authenticationRequests: number = 0;
      const countAuthentication: (request: Request) => void = (
        request: Request,
      ): void => {
        if (request.url().startsWith(`${origin}/identity/passkey-login`)) {
          authenticationRequests++;
        }
      };
      page.on("request", countAuthentication);
      try {
        await page.goto(`${mobilePageUrl}?codeChallengeMethod=S256`);
        await expect(page.getByRole("alert")).toHaveText(
          "Start sign-in from the OneUptime mobile app. This request is missing or invalid.",
        );
        await expect(page.getByTestId("mobile-passkey-sign-in")).toHaveCount(0);
        expect(authenticationRequests).toBe(0);
        await expectNoBrowserSession();
      } finally {
        page.off("request", countAuthentication);
      }

      const invalidOptions: APIResponse = await context.request.post(
        `${origin}/identity/passkey-login-options`,
        {
          headers: { Origin: new URL(origin).origin },
          data: { mobileAuth: { codeChallengeMethod: "S256" } },
        },
      );
      expect(invalidOptions.status()).toBeGreaterThanOrEqual(400);
      expect(invalidOptions.status()).toBeLessThan(500);
      const unboundProof: APIResponse = await context.request.post(
        loginEndpoint,
        {
          headers: { Origin: new URL(origin).origin },
          data: successfulAssertion,
        },
      );
      expect(unboundProof.status()).toBeGreaterThanOrEqual(400);
      expect(unboundProof.status()).toBeLessThan(500);
      expect(await unboundProof.json()).not.toHaveProperty("mobileAuth");
      await expectNoBrowserSession();

      // Restore the web session used by the existing credential-revocation test.
      await page.goto(loginUrl);
      await signInWithPasskey();
    });
  });

  test("revokes a registered passkey while preserving password sign-in", async () => {
    await page.goto(profileUrl);
    // Rename is the row's one button; Delete is in its ⋯ menu.
    await clickRowMenuAction({
      row: page.getByRole("row").filter({ hasText: passkeyName }),
      name: "Delete",
    });
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(
      page.getByRole("row").filter({ hasText: passkeyName }),
    ).toHaveCount(0);
    await signOut();
    const responsePromise: Promise<Response> =
      page.waitForResponse(loginEndpoint);
    await page.getByTestId("passkey-login").click();
    const response: Response = await responsePromise;
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
    await expectSignedOut();

    await page.locator('input[type="email"]').fill(email);
    /*
     * This account was created by registerAndCreateProject, so it can only be
     * signed back in with the passphrase that helper signed up with.
     */
    await page.locator('input[type="password"]').fill(E2E_SIGNUP_PASSWORD);
    await page.locator('input[type="password"]').press("Enter");
    await expectSignedIn();
    await expect(page).toHaveURL(new RegExp(`/dashboard/${projectId}`), {
      timeout: 60000,
    });
  });

  test("enables two-factor authentication and signs in with the registered security key", async () => {
    await page.goto(twoFactorUrl);
    await expect(
      page.getByRole("row").filter({ hasText: securityKeyName }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Enable two-factor authentication",
        exact: true,
      })
      .click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Enable two-factor authentication?",
      exact: true,
    });
    await dialog
      .getByRole("button", {
        name: "Enable two-factor authentication",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Enabled", { exact: true })).toBeVisible();
    await saveScreenshot("two-factor-settings-enabled", test.info());

    await signOut();
    await page.locator('input[type="email"]').fill(email);
    /*
     * The same account registerAndCreateProject signed up, so the same
     * passphrase it used - a password the signup policy would reject can
     * never have been set on it.
     */
    await page.locator('input[type="password"]').fill(E2E_SIGNUP_PASSWORD);
    await page.locator('input[type="password"]').press("Enter");
    await expect(
      page.getByText(securityKeyName, { exact: true }),
    ).toBeVisible();
    expect(
      (await context.cookies()).some((cookie: { name: string }) => {
        return cookie.name === "user-token";
      }),
    ).toBe(false);
    await client.send("WebAuthn.setAutomaticPresenceSimulation", {
      authenticatorId: securityAuthenticatorId,
      enabled: true,
    });
    const authenticationPromise: Promise<Response> = page.waitForResponse(
      "**/identity/verify-webauthn-auth",
    );
    await page.getByText(securityKeyName, { exact: true }).click();
    expect((await authenticationPromise).ok()).toBe(true);
    await expectSignedIn();
    await page.goto(twoFactorUrl);
    await expect(page.getByText("Enabled", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: securityKeyName }),
    ).toBeVisible();
  });
});
