import { BASE_URL } from "../../Config";
import { registerAndCreateProject } from "../../Tests/Dashboard/Helpers/ProductOnboarding";
import { assertLapsedEnterpriseStack } from "../Helpers/StackGuard";
import {
  APIResponse,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
  expect,
  test,
} from "@playwright/test";

/*
 * What the Dashboard tells an administrator once the licence has lapsed.
 *
 * What this proves that the jest suites cannot: ee/Tests/UI/Identity/* already
 * pins which notice each licence mode renders, with the mode supplied by the
 * test. What none of them can show is the whole chain on a running
 * installation - the screens ask the SAME endpoint this suite's guard polled
 * (GET /api/global-config/license, through nginx), read the status the licence
 * client computed inside the image, and turn it into the copy a person acts
 * on. A lapse that the server enforces but the UI does not mention is the
 * worst of both worlds: writes fail, sign-in is off, audit entries stop, and
 * the screens keep looking normal.
 *
 * The other half of what this asserts is that the enterprise screens are STILL
 * THERE. A lapsed licence must not fall back to the upsell card: admins have
 * to read what is configured, disable a compromised provider, rotate a leaked
 * SCIM token and read the audit entries recorded so far (packages/App/
 * FeatureSet/Dashboard/src/Enterprise/EnterpriseEligibility.ts says so in as
 * many words). Seeing the enterprise copy AND the lapse notice on the same
 * page is what distinguishes this stack from a community image, which shows
 * the upsell and no notice at all.
 *
 * This spec registers its own throwaway project rather than borrowing the
 * Licensed phase's: none of the notices depend on what a project holds - they
 * are decided by the installation's licence - and a project of its own can be
 * deleted again, leaving the handoff fixtures for the specs that do need them.
 */

/*
 * Copy and test ids from ee/Dashboard, copied rather than imported: nothing in
 * core (this package included) may import from ee/, because the Community
 * image is built without it.
 *
 * Titles only. The descriptions under them are long paragraphs that get
 * reworded; the titles are the sentence an administrator scans for, and each
 * one names both what stopped and what to do about it.
 */

// ee/Dashboard/AuditLogs/AuditLogsLicenseNotice.tsx (AUDIT_LOGS_LAPSED_TITLE).
const AUDIT_LOGS_LAPSED_NOTICE_TEST_ID: string =
  "audit-logs-license-lapsed-notice";
const AUDIT_LOGS_LAPSED_TITLE: string =
  "Enterprise license required: audit logging is not recording.";

// ee/Dashboard/SSO/License/EnterpriseLicenseBanner.tsx (READ_ONLY_TITLE).
const READ_ONLY_BANNER_TEST_ID: string = "enterprise-license-read-only-banner";
const READ_ONLY_TITLE: string =
  "Enterprise license required: single sign-on and SCIM are off, and this configuration is read-only.";

// ee/Dashboard/SSO/TightenOnly/ReadOnlyActionsNotice.tsx.
const READ_ONLY_ACTIONS_NOTICE_TEST_ID: string =
  "enterprise-read-only-actions-notice";
const PROVIDER_ACTIONS_TITLE: string = "You can still disable a provider.";
const SCIM_ACTIONS_TITLE: string = "You can still reset a SCIM bearer token.";

/*
 * The upsell card's call to action (EnterpriseFeatureUpgrade). Its absence is
 * asserted on every screen below: a lapsed licence changes what the screens
 * SAY, never whether they are there.
 */
const UPSELL_CALL_TO_ACTION: string = "Learn about Enterprise Edition";

// A grace-period banner here would mean the licence had not lapsed after all.
const GRACE_BANNER_TEST_ID: string = "enterprise-license-grace-banner";
const AUDIT_LOGS_GRACE_NOTICE_TEST_ID: string =
  "audit-logs-license-grace-notice";

interface LapsedScreen {
  // Test title.
  label: string;
  // Path below /dashboard/<projectId>/.
  route: string;
  // The notice's test id, and the title it must carry.
  noticeTestId: string;
  noticeTitle: string;
  /*
   * The tighten-only notice under it: the one change the server still accepts
   * without a licence, which the screen has to keep offering. Empty for a
   * screen that has none.
   */
  actionsNoticeTitle: string;
  // Copy only the enterprise screen renders, so the upsell cannot pass for it.
  enterpriseCopy: string;
  // The "not lapsed yet" notice the same screen would show in its grace period.
  graceNoticeTestId: string;
}

const LAPSED_SCREENS: ReadonlyArray<LapsedScreen> = [
  {
    label: "Settings > Audit Logs",
    route: "settings/audit-logs/settings",
    noticeTestId: AUDIT_LOGS_LAPSED_NOTICE_TEST_ID,
    noticeTitle: AUDIT_LOGS_LAPSED_TITLE,
    actionsNoticeTitle: "",
    enterpriseCopy:
      "When enabled, every create, update and delete action on your project's resources will be recorded in the audit log",
    graceNoticeTestId: AUDIT_LOGS_GRACE_NOTICE_TEST_ID,
  },
  {
    label: "Settings > SSO",
    route: "settings/sso",
    noticeTestId: READ_ONLY_BANNER_TEST_ID,
    noticeTitle: READ_ONLY_TITLE,
    actionsNoticeTitle: PROVIDER_ACTIONS_TITLE,
    enterpriseCopy:
      "Single sign-on is an authentication scheme that allows a user to log in with a single ID",
    graceNoticeTestId: GRACE_BANNER_TEST_ID,
  },
  {
    label: "Settings > SCIM",
    route: "settings/scim",
    noticeTestId: READ_ONLY_BANNER_TEST_ID,
    noticeTitle: READ_ONLY_TITLE,
    actionsNoticeTitle: SCIM_ACTIONS_TITLE,
    enterpriseCopy:
      "SCIM is an open standard for automating the exchange of user identity information",
    graceNoticeTestId: GRACE_BANNER_TEST_ID,
  },
];

test.describe("Dashboard lapse notices (lapsed stack)", () => {
  test.describe.configure({ mode: "serial" });

  const origin: string = BASE_URL.toString().replace(/\/$/, "");
  /*
   * On a shared object, not in a `let`: the screen tests are generated in a
   * loop, and a closure over a mutable binding declared outside it is what
   * no-loop-func forbids.
   */
  const shared: { page: Page; projectId: string } = {
    page: undefined as unknown as Page,
    projectId: "",
  };
  let context: BrowserContext;

  test.beforeAll(
    async ({
      browser,
      contextOptions,
    }: {
      browser: Browser;
      contextOptions: BrowserContextOptions;
    }): Promise<void> => {
      test.setTimeout(300000);

      await assertLapsedEnterpriseStack();

      context = await browser.newContext({
        ...contextOptions,
        viewport: { width: 1440, height: 1000 },
      });
      shared.page = await context.newPage();
      shared.page.setDefaultTimeout(30000);

      /*
       * Registering and creating a project are core, so they still work with a
       * dead licence - and that they do is part of the guarantee: a lapse
       * stops the enterprise features, not the product.
       */
      shared.projectId = await registerAndCreateProject({
        page: shared.page,
        projectNamePrefix: "E2E enterprise lapse notices",
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
          "Remove the temporary lapse-notices project",
        ).toBe(true);
      }
    } finally {
      await context?.close();
    }
  });

  for (const screen of LAPSED_SCREENS) {
    test(`${screen.label} says the licence has lapsed, and is still the Enterprise screen`, async (): Promise<void> => {
      const page: Page = shared.page;

      await page.goto(
        `${origin}/dashboard/${shared.projectId}/${screen.route}`,
        {
          waitUntil: "domcontentloaded",
        },
      );

      /*
       * The ee chunk is lazy, so the first visit to each screen downloads it;
       * wait on the notice itself rather than on a load event. The notice is
       * rendered only after the screen has read the licence endpoint, so
       * seeing it also proves that request went through.
       */
      await expect(
        page.getByTestId(screen.noticeTestId),
        `${screen.label} did not show the lapsed-licence notice. Without it the ` +
          `screen looks exactly as it did while the licence was alive, while the ` +
          `server refuses every write behind it.`,
      ).toBeVisible({ timeout: 60000 });

      await expect(
        page.getByTestId(screen.noticeTestId),
        `${screen.label} showed a lapse notice with different copy.`,
      ).toContainText(screen.noticeTitle);

      /*
       * Not the warning the same screens show DURING the trial or the grace
       * period ("stops when the trial or grace period ends"). Telling an
       * administrator that things are about to stop, when they already have,
       * is the failure mode this catches - and it is exactly what a stack
       * whose licence state had not turned over yet would render.
       */
      await expect(
        page.getByTestId(screen.graceNoticeTestId),
        `${screen.label} showed the grace-period warning instead of the lapsed ` +
          `notice, so the screen still believes the licence is usable.`,
      ).toHaveCount(0);

      if (screen.actionsNoticeTitle) {
        /*
         * The incident-response half: while the configuration is read-only the
         * screen still offers the one change the server accepts without a
         * licence, because it can only tighten security.
         */
        await expect(
          page.getByTestId(READ_ONLY_ACTIONS_NOTICE_TEST_ID),
          `${screen.label} did not offer the tighten-only action a read-only ` +
            `screen must keep: an administrator has to be able to shut a ` +
            `compromised provider or a leaked token out without a licence.`,
        ).toContainText(screen.actionsNoticeTitle);
      }

      /*
       * And the screen itself is still the Enterprise one. A community image
       * shows the upsell card here and no notice at all; this stack shows the
       * real screen and says why it is read-only.
       */
      await expect(
        page.getByText(screen.enterpriseCopy).first(),
        `${screen.label} stopped rendering the Enterprise screen. A lapsed ` +
          `licence must keep it: configuration has to stay visible, deletable ` +
          `and (for the tighten-only changes) editable.`,
      ).toBeVisible();

      await expect(
        page.getByText(UPSELL_CALL_TO_ACTION),
        `${screen.label} fell back to the Enterprise upsell card, which is what a ` +
          `build WITHOUT the enterprise screens renders - not what a lapsed ` +
          `licence does.`,
      ).toHaveCount(0);
    });
  }
});
