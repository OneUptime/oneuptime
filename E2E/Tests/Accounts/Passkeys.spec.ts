import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { registerAndCreateProject } from "../Dashboard/Helpers/ProductOnboarding";
import {
  APIResponse,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  CDPSession,
  Page,
  Request,
  Response,
  Route,
  TestInfo,
  expect,
  test,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
  const loginUrl: string = `${origin}/accounts/login`;
  const profileUrl: string = `${origin}/dashboard/user-profile/two-factor-auth`;
  const loginEndpoint: string = `${origin}/identity/passkey-login`;
  const optionsRoute: string = "**/identity/passkey-login-options";
  let context: BrowserContext;
  let page: Page;
  let client: CDPSession;
  let authenticatorId: string;
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
    await page.getByTestId("add-passkey").click();
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

  test("signs in with a passkey without entering an email or password", async () => {
    await signOut();
    await saveScreenshot("passkey-login-desktop", test.info());
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("passkey-login")).toBeInViewport();
    expect(
      await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth;
      }),
    ).toBe(true);
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
    await expect(
      page.getByText(
        "Passkey sign-in was canceled or timed out. Try again, or sign in with your password.",
      ),
    ).toBeVisible();
    await expectSignedOut();
    await signInWithPasskey();
  });

  test("revokes a registered passkey while preserving password sign-in", async () => {
    await page.goto(profileUrl);
    await page
      .getByRole("row")
      .filter({ hasText: passkeyName })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
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
    await page.locator('input[type="password"]').fill("sample");
    await page.locator('input[type="password"]').press("Enter");
    await expectSignedIn();
    await expect(page).toHaveURL(new RegExp(`/dashboard/${projectId}`), {
      timeout: 60000,
    });
  });
});
