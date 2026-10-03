import { BASE_URL } from "../../Config";
import { registerAndCreateProject } from "../../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  StackFrontendEnvironment,
  describeStackFrontendEnvironment,
  fetchStackFrontendEnvironment,
} from "../Helpers/FrontendEnvironment";
import {
  EnterpriseLicenseState,
  describeEnterpriseLicenseState,
} from "../Helpers/LicenseState";
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
 * The shipped Dashboard bundle really carries the Enterprise screens - and
 * renders the single sign-on screens as the core screens they are.
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
 * between "the server serves SCIM" and "an administrator can configure SCIM".
 *
 * Settings > SSO and Settings > OIDC are NOT enterprise screens: single
 * sign-on is core, and those pages are plain core pages in every edition
 * (packages/App/FeatureSet/Dashboard/src/Pages/Settings/SSO.tsx and OIDC.tsx).
 * On this stack they are the other half of the proof - rendered with no
 * upsell and no licence notice, although a fresh install is in its trial,
 * where the SCIM screen beside them does warn that SCIM stops when the trial
 * ends. A licence notice on an SSO screen would mean single sign-on depended
 * on the licence.
 *
 * The same page load also proves the edition pill reports the Enterprise
 * Edition, which reads env.js's IS_ENTERPRISE_EDITION - overwritten by the
 * server with EnterpriseEdition.isLoaded(), not with the raw variable.
 *
 * This is the only spec in the Licensed suite that opens a browser; everything
 * else asserts over HTTP.
 */

interface DashboardScreen {
  // Test title.
  label: string;
  // Path below /dashboard/<projectId>/.
  route: string;
  /*
   * Copy only the real screen renders: its own card description, which the
   * upsell card for the same route words differently - so seeing it is proof
   * the screen rendered, not the upsell.
   */
  copy: string;
}

/*
 * The upsell card's call to action when a self-hosted build lacks the
 * enterprise screens (EnterpriseFeatureUpgrade, Edition reason - the reason
 * used whenever billing is off). Its absence is asserted on every screen:
 * seeing the screen's copy proves it rendered, and this proves the page did
 * not ALSO fall back to an upsell for some other element of it.
 */
const UPSELL_CALL_TO_ACTION: string = "Learn about Enterprise Edition";

const ENTERPRISE_SCREENS: ReadonlyArray<DashboardScreen> = [
  {
    label: "Settings > SCIM",
    route: "settings/scim",
    copy: "SCIM is an open standard for automating the exchange of user identity information",
  },
  {
    label: "Settings > Audit Logs",
    route: "settings/audit-logs/settings",
    copy: "When enabled, every create, update and delete action on your project's resources will be recorded in the audit log",
  },
];

// Core screens in every edition, which never depend on a licence.
const SINGLE_SIGN_ON_SCREENS: ReadonlyArray<DashboardScreen> = [
  {
    label: "Settings > SSO",
    route: "settings/sso",
    copy: "Single sign-on is an authentication scheme that allows a user to log in with a single ID",
  },
  {
    label: "Settings > OIDC",
    route: "settings/oidc",
    copy: "Configure OpenID Connect identity providers for single sign-on",
  },
];

/*
 * Test ids of every licence notice the ee identity screens can show
 * (ee/Dashboard/Identity/License/EnterpriseLicenseBanner.tsx and
 * ee/Dashboard/Identity/TightenOnly/ReadOnlyActionsNotice.tsx), copied rather
 * than imported: nothing in core, this package included, may import from ee/.
 */
const GRACE_BANNER_TEST_ID: string = "enterprise-license-grace-banner";

const LICENSE_NOTICE_TEST_IDS: ReadonlyArray<string> = [
  GRACE_BANNER_TEST_ID,
  "enterprise-license-read-only-banner",
  "enterprise-license-not-included-banner",
  "enterprise-read-only-actions-notice",
];

// EnterpriseLicenseBanner.tsx GRACE_TITLE: what the SCIM screen says during the trial.
const SCIM_GRACE_TITLE: string =
  "No valid Enterprise license: SCIM stops when the trial or grace period ends.";

// A fresh install's licence status, inside its unlicensed trial.
const TRIAL_LICENSE_STATUS: string = "grace";

/*
 * The edition pill in the Dashboard footer once it has the licence answer:
 * its accessible name starts "Enterprise Edition (Checking...)" until
 * GET /api/global-config/license - the endpoint every ee licence notice reads
 * too - has answered (Common/UI/Components/EditionLabel/EditionLabel.tsx).
 * Waiting for it is the settle point before asserting that a screen shows NO
 * licence notice, so the absence is read after the licence was known.
 */
const EDITION_PILL_WITH_LICENSE_ANSWER: RegExp =
  /^Enterprise Edition(?! \(Checking)/;

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
  let licenseState: EnterpriseLicenseState;

  test.beforeAll(
    async ({
      browser,
      contextOptions,
    }: {
      browser: Browser;
      contextOptions: BrowserContextOptions;
    }): Promise<void> => {
      test.setTimeout(300000);

      licenseState = await assertLicensedEnterpriseStack();
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
        page.getByText(screen.copy).first(),
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

  test("Settings > SCIM says what stops when the trial ends", async (): Promise<void> => {
    const page: Page = shared.page;
    const found: string = describeEnterpriseLicenseState(licenseState);

    await page.goto(`${origin}/dashboard/${shared.projectId}/settings/scim`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page
        .getByText(
          "SCIM is an open standard for automating the exchange of user identity information",
        )
        .first(),
    ).toBeVisible({ timeout: 60000 });

    if (licenseState.status !== TRIAL_LICENSE_STATUS) {
      /*
       * A licence was installed on this stack, so there is no trial to warn
       * about and the screen shows no notice at all. Not a skip: the licensed
       * suite is equally valid either way.
       */
      await expect(
        page.getByTestId(GRACE_BANNER_TEST_ID),
        `A valid licence must not warn about a trial ending. Found: ${found}`,
      ).toHaveCount(0);
      return;
    }

    /*
     * The control for the single sign-on screens below: on this very stack,
     * in this very state, the licence machinery does put a notice on an
     * Enterprise screen - naming SCIM alone, since SCIM is what the licence
     * decides.
     */
    await expect(
      page.getByTestId(GRACE_BANNER_TEST_ID),
      `A fresh install inside its trial must warn on the SCIM screen that SCIM ` +
        `stops when the trial ends. Found: ${found}`,
    ).toBeVisible({ timeout: 60000 });

    await expect(page.getByTestId(GRACE_BANNER_TEST_ID)).toContainText(
      SCIM_GRACE_TITLE,
    );
  });

  for (const screen of SINGLE_SIGN_ON_SCREENS) {
    test(`${screen.label} renders as a core screen: no upsell and no licence notice`, async (): Promise<void> => {
      const page: Page = shared.page;

      await page.goto(
        `${origin}/dashboard/${shared.projectId}/${screen.route}`,
        {
          waitUntil: "domcontentloaded",
        },
      );

      await expect(
        page.getByText(screen.copy).first(),
        `${screen.label} did not render its configuration screen.`,
      ).toBeVisible({ timeout: 60000 });

      await expect(
        page
          .getByRole("button", { name: EDITION_PILL_WITH_LICENSE_ANSWER })
          .first(),
        "The edition pill never showed the licence state, so the page never " +
          "finished reading the licence.",
      ).toBeVisible({ timeout: 60000 });

      await expect(
        page.getByText(UPSELL_CALL_TO_ACTION),
        `${screen.label} showed the Enterprise upsell card: single sign-on is ` +
          `in every edition and must never be sold as an Enterprise feature.`,
      ).toHaveCount(0);

      for (const noticeTestId of LICENSE_NOTICE_TEST_IDS) {
        await expect(
          page.getByTestId(noticeTestId),
          `${screen.label} showed a licence notice (${noticeTestId}). Single ` +
            `sign-on never depends on the Enterprise licence.`,
        ).toHaveCount(0);
      }
    });
  }

  test("Settings > SSO offers the Require SSO switch, unlocked", async (): Promise<void> => {
    const page: Page = shared.page;

    await page.goto(`${origin}/dashboard/${shared.projectId}/settings/sso`, {
      waitUntil: "domcontentloaded",
    });

    /*
     * "Require SSO for login" is core too, so its switch is always there and
     * can always be flipped - it is never locked behind a licence. (It saves
     * when flipped and asks first; this only looks, so nothing is required.)
     */
    await expect(
      page.getByRole("heading", { name: "SSO Settings", exact: true }),
    ).toBeVisible({ timeout: 60000 });

    const requireSso: Locator = page.getByRole("switch", {
      name: "Require SSO for Login",
      exact: true,
    });

    await expect(requireSso).toBeVisible({ timeout: 60000 });

    await expect(
      requireSso,
      "The Require SSO switch must be unlocked for the project owner.",
    ).not.toHaveAttribute("aria-disabled", "true", { timeout: 60000 });
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
