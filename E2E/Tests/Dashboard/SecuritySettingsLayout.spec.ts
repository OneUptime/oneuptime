import { BASE_URL } from "../../Config";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  APIResponse,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Locator,
  Page,
  Route,
  expect,
  test,
} from "@playwright/test";

interface SecurityPage {
  route: string;
  title: string;
  cardTitles: Array<string>;
  emptyMessage: string;
}

interface CardLayout {
  left: number;
  right: number;
  width: number;
  contentLeft: number;
  contentRight: number;
  contentWidth: number;
}

const securityPages: Array<SecurityPage> = [
  {
    route: "passkeys",
    title: "Passkeys",
    cardTitles: ["Passkeys"],
    emptyMessage: "No passkeys added yet.",
  },
  {
    route: "two-factor-auth",
    title: "Security keys",
    cardTitles: [
      "Two-factor authentication",
      "Security keys",
      "Authenticator apps",
      "Backup codes",
    ],
    emptyMessage: "No security keys added yet.",
  },
];

/*
 * The old 72rem cap was invisible at ordinary laptop sizes. Measure against
 * the shared Page's available content column at 2560px as well as desktop and
 * mobile, so shrinking the whole page cannot make a capped card pass.
 *
 * Onboarding, navigation, permissions, Page, Card and ModelTable are real.
 * Populated cases replace only read-only list replies, including both forms
 * of legacy purpose, without inventing stored authentication material. The
 * Passkeys account lifecycle spec covers real WebAuthn registration.
 */
test.describe("Security settings card layout", () => {
  test.describe.configure({ mode: "serial" });

  const origin: string = BASE_URL.toString().replace(/\/$/, "");
  const legacyName: string = "Existing credential from my original laptop";
  const olderName: string = "Older office security key";
  const currentName: string = "Current device";
  const authenticatorName: string = "Work authenticator app";
  const shared: { page: Page } = { page: undefined as unknown as Page };
  let context: BrowserContext;
  let projectId: string = "";

  test.beforeAll(
    async ({
      browser,
      contextOptions,
    }: {
      browser: Browser;
      contextOptions: BrowserContextOptions;
    }) => {
      test.setTimeout(300000);
      context = await browser.newContext({
        ...contextOptions,
        viewport: { width: 1440, height: 1000 },
      });
      shared.page = await context.newPage();
      shared.page.setDefaultTimeout(30000);
      projectId = await registerAndCreateProject({
        page: shared.page,
        projectNamePrefix: "E2E security settings layout",
        enablePaidUsage: false,
      });
    },
  );

  test.afterAll(async () => {
    try {
      if (projectId) {
        const response: APIResponse = await context.request.delete(
          `${origin}/api/project/${projectId}`,
          { headers: { tenantid: projectId } },
        );
        expect(response.ok(), "Remove the temporary layout project").toBe(true);
      }
    } finally {
      await context?.close();
    }
  });

  for (const populated of [false, true]) {
    for (const settings of securityPages) {
      test(`${settings.route}: ${populated ? "populated" : "empty"} cards fill the content column on wide desktop, desktop and mobile`, async () => {
        const page: Page = shared.page;
        await page.setViewportSize({ width: 1440, height: 1000 });

        if (populated) {
          await page.route(
            "**/user-webauthn/get-list*",
            async (route: Route) => {
              await route.fulfill({
                json: {
                  data: [
                    {
                      _id: "11111111-1111-4111-8111-111111111111",
                      name: legacyName,
                      isVerified: true,
                      createdAt: {
                        _type: "DateTime",
                        value: "2026-09-10T10:00:00.000Z",
                      },
                    },
                    {
                      _id: "22222222-2222-4222-8222-222222222222",
                      name: olderName,
                      isVerified: true,
                      isPasskey: null,
                    },
                    {
                      _id: "33333333-3333-4333-8333-333333333333",
                      name: currentName,
                      isVerified: true,
                      isPasskey: settings.route === "passkeys",
                    },
                  ],
                  count: 3,
                  skip: 0,
                  limit: 10,
                },
              });
            },
          );
          await page.route(
            "**/user-totp-auth/get-list*",
            async (route: Route) => {
              await route.fulfill({
                json: {
                  data: [
                    {
                      _id: "44444444-4444-4444-8444-444444444444",
                      name: authenticatorName,
                      isVerified: false,
                    },
                  ],
                  count: 1,
                  skip: 0,
                  limit: 10,
                },
              });
            },
          );
        }

        try {
          await page.goto(`${origin}/dashboard/user-profile/${settings.route}`);
          const credentialCard: Locator = page.getByTestId("card").filter({
            has: page.getByRole("heading", {
              name: settings.title,
              exact: true,
            }),
          });
          await expect(credentialCard).toBeVisible();

          if (populated) {
            for (const name of [legacyName, olderName, currentName]) {
              const row: Locator = credentialCard
                .getByRole("row")
                .filter({ hasText: name });
              await expect(row).toBeVisible();
              await expect(
                row.getByRole("button", { name: "Rename", exact: true }),
              ).toBeEnabled();
              await expect(
                row.getByRole("button", { name: "Delete", exact: true }),
              ).toBeEnabled();
            }
            await expect(
              credentialCard.getByText("Existing credential", { exact: true }),
            ).toHaveCount(2);
            if (settings.route === "two-factor-auth") {
              await expect(page.getByText(authenticatorName)).toBeVisible();
              await expect(
                page.getByRole("button", { name: "Finish setup", exact: true }),
              ).toBeEnabled();
            }
          } else {
            await expect(page.getByText(settings.emptyMessage)).toBeVisible();
            if (settings.route === "two-factor-auth") {
              await expect(
                page.getByText("No authenticator apps added yet."),
              ).toBeVisible();
            }
          }

          let desktopWidth: number = 0;
          for (const viewport of [
            { width: 1440, height: 1000 },
            { width: 2560, height: 1440 },
            { width: 390, height: 844 },
          ]) {
            await page.setViewportSize(viewport);
            for (const title of settings.cardTitles) {
              const card: Locator = page.getByTestId("card").filter({
                has: page.getByRole("heading", { name: title, exact: true }),
              });
              await expect(card).toBeVisible();
              const layout: CardLayout = await card.evaluate(
                (element: HTMLElement): CardLayout => {
                  // This ancestor belongs to shared Page, outside the page's wrapper.
                  const content: Element | null =
                    element.closest(".space-y-6.flex-1");
                  if (!content) {
                    throw new Error("Cannot find the Page content column");
                  }
                  const bounds: DOMRect = element.getBoundingClientRect();
                  const contentBounds: DOMRect =
                    content.getBoundingClientRect();
                  return {
                    left: bounds.left,
                    right: bounds.right,
                    width: bounds.width,
                    contentLeft: contentBounds.left,
                    contentRight: contentBounds.right,
                    contentWidth: contentBounds.width,
                  };
                },
              );
              expect(
                Math.abs(layout.left - layout.contentLeft),
                `${title} aligns with the content column at ${viewport.width}px`,
              ).toBeLessThanOrEqual(1);
              expect(
                Math.abs(layout.right - layout.contentRight),
                `${title} fills the available right edge at ${viewport.width}px`,
              ).toBeLessThanOrEqual(1);
              expect(
                Math.abs(layout.width - layout.contentWidth),
              ).toBeLessThanOrEqual(1);
              if (title === settings.title && viewport.width === 1440) {
                desktopWidth = layout.width;
              }
              if (title === settings.title && viewport.width === 2560) {
                expect(layout.width).toBeGreaterThan(desktopWidth + 800);
              }
            }

            await expect(
              page.getByText(
                /Existing credentials appear on both security pages/,
              ),
            ).toHaveCount(0);
            await expect(
              page.getByText(/They continue to work as before/),
            ).toHaveCount(0);
            expect(
              await page.evaluate((): boolean => {
                return (
                  document.documentElement.scrollWidth <=
                  document.documentElement.clientWidth + 1
                );
              }),
              `No page overflow at ${viewport.width}px`,
            ).toBe(true);

            await test.info().attach(`${settings.route}-${viewport.width}px`, {
              body: await page.screenshot({ fullPage: true }),
              contentType: "image/png",
            });
          }
        } finally {
          await page.unroute("**/user-webauthn/get-list*");
          await page.unroute("**/user-totp-auth/get-list*");
        }
      });
    }
  }
});
