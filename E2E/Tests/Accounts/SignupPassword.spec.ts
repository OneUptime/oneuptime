import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import {
  APIRequestContext,
  APIResponse,
  Locator,
  Page,
  Route,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";

const registrationUrl: string = URL.fromString(BASE_URL.toString())
  .addRoute("/accounts/register")
  .toString();
const signupUrl: string = URL.fromString(BASE_URL.toString())
  .addRoute("/identity/signup")
  .toString();
const passphrase: string = "violet river lantern";

const fillRegistration: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.goto(registrationUrl);
  await page.getByTestId("email").fill("signup-password-e2e@example.com");
  await page.getByTestId("name").fill("Password Test");

  if (IS_BILLING_ENABLED) {
    await page.getByTestId("companyName").fill("Example");
    await page.getByTestId("companyPhoneNumber").fill("+14155552671");
  }
};

test.describe("Signup password feedback", () => {
  test("shows accessible guidance and supports password managers", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(registrationUrl);
    const password: Locator = page.getByTestId("password");
    await expect(password).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByTestId("confirmPassword")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await expect(password).toHaveAccessibleDescription(
      "Use at least 15 characters. Try a few unrelated words.",
    );
    await expect(page.getByRole("status")).not.toContainText(
      "Password meets requirements",
    );
    await password.fill(passphrase);
    await expect(page.getByRole("status")).toHaveText(
      "Password meets requirements",
    );
    await password.clear();
    await expect(page.getByRole("status")).toContainText(
      "Use at least 15 characters.",
    );
  });

  for (const password of ["sample", "PasswordPassword", "123456789012345"]) {
    test(`blocks weak password ${password} before sending signup`, async ({
      page,
    }: {
      page: Page;
    }) => {
      let submissions: number = 0;
      await page.route("**/identity/signup", async (route: Route) => {
        submissions++;
        await route.fulfill({
          status: 400,
          json: { message: "Unexpected signup" },
        });
      });
      await fillRegistration(page);
      await page.getByTestId("password").fill(password);
      await page.getByTestId("confirmPassword").fill(password);
      await page.getByTestId("Sign Up").click();
      await expect(
        page
          .getByText(
            password === "sample"
              ? "Password must be at least 15 characters."
              : "Choose a less predictable password. Try a few unrelated words.",
            { exact: true },
          )
          .first(),
      ).toBeVisible();
      expect(submissions).toBe(0);
    });
  }

  test("submits a passphrase unchanged and lets users retry after an API error", async ({
    page,
  }: {
    page: Page;
  }) => {
    const submitted: Array<Record<string, any>> = [];
    await page.route("**/identity/signup", async (route: Route) => {
      submitted.push(route.request().postDataJSON());
      await route.fulfill({
        status: 400,
        json: { message: "Signup request captured." },
      });
    });
    await fillRegistration(page);
    await page.getByTestId("password").fill("sample");
    await page.getByTestId("confirmPassword").fill("sample");
    await page.getByTestId("Sign Up").click();
    await expect(
      page.getByText("Password must be at least 15 characters."),
    ).toBeVisible();

    const secret: string = ` ${passphrase} `;
    await page.getByTestId("password").fill(secret);
    await page.getByTestId("confirmPassword").fill(secret);
    await page.getByTestId("Sign Up").click();
    await expect(page.getByText("Signup request captured.")).toBeVisible();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.["data"]?.["password"]).toEqual({
      _type: "HashedString",
      value: secret,
    });
    await page.getByTestId("Sign Up").click();
    await expect
      .poll(() => {
        return submitted.length;
      })
      .toBe(2);
    expect(submitted[1]?.["data"]?.["password"]).toEqual({
      _type: "HashedString",
      value: secret,
    });
  });

  test("confirmation must match the exact password, including spaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    await fillRegistration(page);
    await page.getByTestId("password").fill(` ${passphrase} `);
    await page.getByTestId("confirmPassword").fill(passphrase);
    await page.getByTestId("Sign Up").click();
    await expect(
      page.getByText(/Confirm Password should match Password/),
    ).toBeVisible();
  });

  test("keeps guidance readable on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(registrationUrl);
    await page.getByTestId("password").fill(passphrase);
    await page.getByRole("status").scrollIntoViewIfNeeded();
    await expect(page.getByRole("status")).toHaveText(
      "Password meets requirements",
    );
    expect(
      await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth;
      }),
    ).toBe(true);
  });
});

test.describe("Signup API password enforcement", () => {
  for (const password of [
    "sample",
    "PasswordPassword",
    "123456789012345",
    { _type: "HashedString", value: "sample" },
    { _type: "HashedString", value: 123456789012345 },
    null,
  ]) {
    test(`rejects direct signup with ${JSON.stringify(password)}`, async ({
      request,
    }: {
      request: APIRequestContext;
    }) => {
      const response: APIResponse = await request.post(signupUrl, {
        data: {
          data: {
            email: "signup-password-e2e@example.com",
            name: "Password Test",
            password,
          },
        },
      });
      expect(response.status()).toBe(400);
      const body: Record<string, unknown> = await response.json();
      expect(body["message"]).toMatch(/Password|less predictable password/);
      expect(body["token"]).toBeUndefined();
    });
  }
});
