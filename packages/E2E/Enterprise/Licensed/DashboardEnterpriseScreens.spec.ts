import { BASE_URL } from "../../Config";
import { registerAndCreateProject } from "../../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  StackFrontendEnvironment,
  describeStackFrontendEnvironment,
  fetchStackFrontendEnvironment,
} from "../Helpers/FrontendEnvironment";
import { assertLicensedEnterpriseStack } from "../Helpers/StackGuard";
import {
  APIResponse,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";

/*
 * The shipped Dashboard bundle really carries the Enterprise screens.
 *
 * What this proves that the jest suites cannot: the Dashboard renders each
 * enterprise screen through EnterprisePluginPage, which shows the ee plugin
 * when the build includes it and an upsell card when it does not
 * (packages/App/FeatureSet/Dashboard/src/Enterprise/EnterprisePluginPage.tsx).
 * Which of the two a browser gets is decided by what the IMAGE BUILD resolved
 * the bare plugin specifier to - the ee chunk in the enterprise image, a stub
 * in the community one. Every jest test of that component supplies the plugin
 * itself, so none of them can tell whether the published bundle has one. Only
 * loading the real screens from the real image can, and that is the difference
 * between "the server serves SSO" and "an administrator can configure SSO".
 *
 * The same page load also proves the edition pill reports the Enterprise
 * Edition, which reads env.js's IS_ENTERPRISE_EDITION - overwritten by the
 * server with EnterpriseEdition.isLoaded(), not with the raw variable.
 *
 * This is the only spec in the Licensed suite that opens a browser; everything
 * else asserts over HTTP.
 */

interface EnterpriseScreen {
  // Test title.
  label: string;
  // Path below /dashboard/<projectId>/.
  route: string;
  /*
   * Copy that only the ee screen renders. Every one of these is the screen's
   * own card description, which the upsell card for the same route words
   * differently - so seeing it is proof the plugin rendered, not the shell.
   */
  enterpriseCopy: string;
}

/*
 * The upsell card's call to action when a self-hosted build lacks the
 * enterprise screens (EnterpriseFeatureUpgrade, Edition reason - the reason
 * used whenever billing is off). Its absence is asserted on every screen:
 * seeing the enterprise copy proves the plugin rendered, and this proves the
 * shell did not ALSO fall back for some other element of the page.
 */
const UPSELL_CALL_TO_ACTION: string = "Learn about Enterprise Edition";

const ENTERPRISE_SCREENS: ReadonlyArray<EnterpriseScreen> = [
  {
    label: "Settings > SSO",
    route: "settings/sso",
    enterpriseCopy:
      "Single sign-on is an authentication scheme that allows a user to log in with a single ID",
  },
  {
    label: "Settings > OIDC",
    route: "settings/oidc",
    enterpriseCopy:
      "Configure OpenID Connect identity providers for single sign-on",
  },
  {
    label: "Settings > SCIM",
    route: "settings/scim",
    enterpriseCopy:
      "SCIM is an open standard for automating the exchange of user identity information",
  },
  {
    label: "Settings > Audit Logs",
    route: "settings/audit-logs/settings",
    enterpriseCopy:
      "When enabled, every create, update and delete action on your project's resources will be recorded in the audit log",
  },
];

test.describe("Dashboard enterprise screens (licensed stack)", () => {
  test.describe.configure({ mode: "serial" });

  const origin: string = BASE_URL.toString().replace(/\/$/, "");
  /*
   * The project id lives on this shared object rather than in a `let`: the
   * screen tests are generated in a loop, and a closure over a mutable
   * binding declared outside it is exactly what no-loop-func forbids.
   */
  const shared: { page: Page; projectId: string } = {
    page: undefined as unknown as Page,
    projectId: "",
  };
  let context: BrowserContext;
  let frontendEnvironment: StackFrontendEnvironment;

  test.beforeAll(
    async ({
      browser,
      contextOptions,
    }: {
      browser: Browser;
      contextOptions: BrowserContextOptions;
    }): Promise<void> => {
      test.setTimeout(300000);

      await assertLicensedEnterpriseStack();
      frontendEnvironment = await fetchStackFrontendEnvironment();

      context = await browser.newContext({
        ...contextOptions,
        viewport: { width: 1440, height: 1000 },
      });
      shared.page = await context.newPage();
      shared.page.setDefaultTimeout(30000);

      shared.projectId = await registerAndCreateProject({
        page: shared.page,
        projectNamePrefix: "E2E enterprise screens",
        enablePaidUsage: false,
      });
    },
  );

  test.afterAll(async (): Promise<void> => {
    try {
      if (shared.projectId) {
        const response: APIResponse = await context.request.delete(
          `${origin}/api/project/${shared.projectId}`,
          { headers: { tenantid: shared.projectId } },
        );
        expect(
          response.ok(),
          "Remove the temporary enterprise screens project",
        ).toBe(true);
      }
    } finally {
      await context?.close();
    }
  });

  test("the Dashboard bundle is served with the Enterprise Edition loaded", (): void => {
    /*
     * The server replaces this variable with EnterpriseEdition.isLoaded()
     * before serving it (Common/Server/Utils/FrontendEnvironment.ts), so
     * "true" here is the process saying its enterprise module loaded - the
     * condition every screen below depends on.
     */
    expect(
      frontendEnvironment.isEnterpriseEdition,
      `The Dashboard must be told it is the Enterprise Edition. Found: ${describeStackFrontendEnvironment(
        frontendEnvironment,
      )}`,
    ).toBe(true);
  });

  for (const screen of ENTERPRISE_SCREENS) {
    test(`${screen.label} renders the Enterprise screen, not the upsell`, async (): Promise<void> => {
      const page: Page = shared.page;

      await page.goto(
        `${origin}/dashboard/${shared.projectId}/${screen.route}`,
        {
          waitUntil: "domcontentloaded",
        },
      );

      /*
       * The plugin is lazy, so the ee chunk downloads on the first visit to
       * each screen: wait on the copy itself rather than on a load event.
       */
      await expect(
        page.getByText(screen.enterpriseCopy).first(),
        `${screen.label} did not render the Enterprise screen. On a build without ` +
          `the ee Dashboard plugins this route shows the upsell card instead.`,
      ).toBeVisible({ timeout: 60000 });

      await expect(
        page.getByText(UPSELL_CALL_TO_ACTION),
        `${screen.label} showed the Enterprise upsell card, which a build that ` +
          `includes the Enterprise screens must never render.`,
      ).toHaveCount(0);
    });
  }

  test("Settings > SSO renders the enterprise-only Force SSO card", async (): Promise<void> => {
    const page: Page = shared.page;

    await page.goto(`${origin}/dashboard/${shared.projectId}/settings/sso`, {
      waitUntil: "domcontentloaded",
    });

    /*
     * A second card the upsell has no counterpart for: the SSO screen is the
     * whole ee page, not just a table the shell could have rendered.
     */
    await expect(
      page.getByRole("heading", { name: "SSO Settings", exact: true }),
    ).toBeVisible({ timeout: 60000 });
  });

  test("the edition label reports the Enterprise Edition", async (): Promise<void> => {
    const page: Page = shared.page;

    await page.goto(`${origin}/dashboard/${shared.projectId}/home`, {
      waitUntil: "domcontentloaded",
    });

    /*
     * The pill is a button in the Dashboard footer whose accessible name is
     * "<edition name>, <call to action>" (Common/UI/Components/EditionLabel).
     * On this stack the edition name is "Enterprise Edition" followed by the
     * licence state - "(Trial, N days left)" on a fresh install - so the
     * assertion anchors on the edition and leaves the licence wording to the
     * jest tests that own it. The pill is not rendered at all when the bundle
     * is told billing is on, so seeing it is also a billing-off signal.
     */
    const editionPill: Locator = page.getByRole("button", {
      name: /^Enterprise Edition/,
    });

    await expect(editionPill.first()).toBeVisible({ timeout: 60000 });

    await expect(
      page.getByRole("button", { name: /^Community Edition/ }),
      "The Dashboard reported the Community Edition on an enterprise stack.",
    ).toHaveCount(0);
  });
});
