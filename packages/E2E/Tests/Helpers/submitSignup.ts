import { BASE_URL } from "../../Config";
import { expect, Page, Response } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Submits a filled-in register form and returns once the new account is
 * signed in -- the point at which Accounts hands it to the Dashboard, so the
 * caller goes on waiting for /dashboard/welcome exactly as before.
 *
 * On a self-hosted stack (billing off) /identity/signup signs the account in
 * itself and there is nothing more to do.
 *
 * On the hosted stack (billing on) it creates the account and answers
 * `emailVerificationRequired` with no session, and the page shows "check your
 * email". The e2e stack has no mailbox, so it runs with
 * EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E=true, which puts the token
 * from the welcome email on that one response. This follows it to
 * /accounts/verify-email the way the email's button would, then signs in with
 * the password the form was filled with -- the same three steps a real person
 * takes, so the gate itself is exercised rather than stepped around.
 */
type SubmitSignupFunction = (data: {
  page: Page;
  email: string;
  password: string;
}) => Promise<void>;

const isPostTo: (response: Response, path: string) => boolean = (
  response: Response,
  path: string,
): boolean => {
  return (
    response.url().endsWith(path) && response.request().method() === "POST"
  );
};

const submitSignup: SubmitSignupFunction = async (data: {
  page: Page;
  email: string;
  password: string;
}): Promise<void> => {
  const page: Page = data.page;

  const signupResponsePromise: Promise<Response> = page.waitForResponse(
    (response: Response): boolean => {
      return isPostTo(response, "/identity/signup");
    },
  );

  await page.getByTestId("Sign Up").click();

  const signupResponse: Response = await signupResponsePromise;

  /*
   * The response's body is read only while the page is known to hold it. A
   * signup that signs the account in hands it to the Dashboard with a full
   * page load at once, and the browser drops the body along with the
   * document: reading it after that fails with "No resource with given
   * identifier found", although the signup worked. A failed signup, and one
   * held for email verification, stay on the page.
   */
  if (!signupResponse.ok()) {
    throw new Error(
      `Signup failed: ${signupResponse.status()} ${(await signupResponse.text()).slice(0, 300)}`,
    );
  }

  /*
   * Which of the two the server chose shows on the page: "check your email",
   * or a navigation out of Accounts. The wait that loses goes on until the
   * page closes; that rejection is expected and ignored.
   */
  const heldForVerification: Promise<boolean> = page
    .getByTestId("verify-email-required")
    .waitFor({ state: "visible" })
    .then((): boolean => {
      return true;
    });
  const signedIn: Promise<boolean> = page
    .waitForURL(
      (url: globalThis.URL): boolean => {
        return !url.pathname.startsWith("/accounts/");
      },
      { waitUntil: "commit" },
    )
    .then((): boolean => {
      return false;
    });
  heldForVerification.catch((): void => {});
  signedIn.catch((): void => {});

  if (!(await Promise.race([heldForVerification, signedIn]))) {
    return;
  }

  const body: Record<string, unknown> = ((await signupResponse.json()) ||
    {}) as Record<string, unknown>;
  const miscData: Record<string, unknown> = (body["_miscData"] || {}) as Record<
    string,
    unknown
  >;

  expect(
    miscData["emailVerificationRequired"],
    'The page is held at "check your email", so /identity/signup should have answered emailVerificationRequired.',
  ).toBe(true);

  const token: unknown = miscData["emailVerificationToken"];

  if (typeof token !== "string" || !token) {
    throw new Error(
      "Signup needs email verification but the response carried no token. " +
        "The hosted e2e stack must run the App with " +
        "EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E=true -- it has no " +
        "mailbox to read the welcome email from.",
    );
  }

  const verifyResponsePromise: Promise<Response> = page.waitForResponse(
    (response: Response): boolean => {
      return isPostTo(response, "/identity/verify-email");
    },
  );

  await page.goto(
    URL.fromString(BASE_URL.toString())
      .addRoute("/accounts/verify-email/" + token)
      .toString(),
  );

  const verifyResponse: Response = await verifyResponsePromise;

  // Read only on failure, for the same reason as the signup response above.
  if (!verifyResponse.ok()) {
    throw new Error(
      `Email verification failed: ${verifyResponse.status()} ${(await verifyResponse.text()).slice(0, 300)}`,
    );
  }

  await page.goto(
    URL.fromString(BASE_URL.toString()).addRoute("/accounts/login").toString(),
  );

  await page.locator('input[type="email"]').fill(data.email);
  await page.locator('input[type="password"]').fill(data.password);
  await page.locator('input[type="password"]').press("Enter");
};

export default submitSignup;
