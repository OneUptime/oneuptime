import { BASE_URL, E2E_SIGNUP_PASSWORD } from "../../Config";
import {
  JSONish,
  getItem,
} from "../../Tests/Dashboard/Helpers/MonitorAlerting";
import { registerAndCreateProject } from "../../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  AUDIT_LOG_ACTION_CREATE,
  AUDIT_LOG_ENTRY_TIMEOUT_MS,
  AUDIT_LOG_POLL_INTERVAL_MS,
  AuditLogEntry,
  LABEL_RESOURCE_TYPE,
  ProjectAuditLogSettings,
  createAuditedLabel,
  findAuditLogEntry,
  listAuditLogEntries,
  readProjectAuditLogSettings,
  setProjectAuditLogs,
} from "../Helpers/AuditLogs";
import {
  COMMUNITY_EDITION_MESSAGE_FRAGMENT,
  EnterpriseWriteResult,
  LICENSE_REQUIRED_MESSAGE_FRAGMENT,
  PROJECT_SCIM_API_PATH,
  createProjectScim,
  updateProjectScimName,
} from "../Helpers/EnterpriseConfiguration";
import {
  LicensedSuiteHandoff,
  readLicensedSuiteHandoff,
} from "../Helpers/Handoff";
import { assertLapsedEnterpriseStack } from "../Helpers/StackGuard";
import {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
  expect,
  test,
} from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";

/*
 * What a lapsed licence stops, and what it must never stop, for the
 * administrator of a running installation.
 *
 * Three claims, each of which only a booted stack can settle:
 *
 *   1. Password sign-in still works. This is the promise the lapse copy makes
 *      in so many words ("Sign in with your password, or ask your
 *      administrator to renew the license"), and the one whose failure would
 *      be unrecoverable: an installation whose licence ran out while nobody
 *      was watching must not lock its owners out of the Dashboard they would
 *      renew the licence from. Nothing else in the repository proves it end to
 *      end - the jest suites that cover the lapse never sign anybody in.
 *   2. Enterprise CONFIGURATION writes are refused with the licence message,
 *      not the Community-Edition one. Both are 402, so the status alone cannot
 *      tell a lapsed enterprise stack from a community image; the message can,
 *      and that substring is the proof that the enterprise module is loaded
 *      and it was the LICENCE, not the edition, that refused. Reads of the
 *      same row keep working, which is the other half of the contract:
 *      configuration is kept, shown and removable, just not changeable.
 *   3. The audit RECORDER has stopped, while the trail recorded while licensed
 *      is still readable. ee/Tests/Server/AuditLog/* pins the eligibility
 *      rules with the store mocked; only this stack can show the recorder in
 *      the published image going quiet after a lapse it noticed on its own.
 *
 * The fixtures are the ones the Licensed phase left behind on this same stack
 * (Enterprise/Helpers/Handoff.ts): its project still has audit logging on and
 * one recorded entry, its ProjectSCIM row was created while the licence was
 * alive, and its owner still has the shared signup password. Inheriting them
 * is the point - state created under a licence has to survive the lapse. When
 * the handoff is absent (a developer running this suite on its own) the spec
 * creates what it can for itself and says so; only the assertions that need a
 * row created while licensed are skipped.
 */

const DASHBOARD_URL_PATTERN: RegExp = /\/dashboard\//;

type DescribeTrailFunction = (entries: ReadonlyArray<AuditLogEntry>) => string;

/*
 * The trail in one line, for a failure message. Every assertion below prints
 * it, because the two ways each of them can fail - nothing was recorded, or
 * something other than what was expected - look identical without it.
 */
const describeTrail: DescribeTrailFunction = (
  entries: ReadonlyArray<AuditLogEntry>,
): string => {
  if (entries.length === 0) {
    return "nothing";
  }

  return entries
    .map((entry: AuditLogEntry): string => {
      return `${entry.action} ${entry.resourceType} "${entry.resourceName}"`;
    })
    .join(", ");
};

interface LapsedSuiteFixture {
  projectId: string;
  ownerEmail: string;
  // The entry recorded while the licence was usable, if there is one.
  licensedResourceType: string;
  licensedResourceName: string;
  // The enterprise configuration row created while licensed, if there is one.
  projectScimId: string;
  fromHandoff: boolean;
}

test.describe("Enterprise writes and the audit recorder (lapsed stack)", () => {
  test.describe.configure({ mode: "serial" });

  /*
   * The page is shared rather than taken per test: the sign-in below is both
   * the first assertion and the session every later test makes its API calls
   * with.
   */
  const shared: { page: Page } = { page: undefined as unknown as Page };
  let context: BrowserContext;
  let fixture: LapsedSuiteFixture;

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

      const handoff: LicensedSuiteHandoff | null = readLicensedSuiteHandoff();

      if (handoff) {
        fixture = {
          projectId: handoff.projectId,
          ownerEmail: handoff.ownerEmail,
          licensedResourceType: handoff.auditedResourceType,
          licensedResourceName: handoff.auditedResourceName,
          projectScimId: handoff.projectScimId,
          fromHandoff: true,
        };
      } else {
        /*
         * No Licensed phase ran on this machine. Sign-up and project creation
         * are core, so they still work with a dead licence, and that is enough
         * for everything except the two assertions about a row created while
         * the licence was alive.
         *
         * This bootstrap context is thrown away on purpose: the sign-in test
         * below has to start without a session, and registering leaves one.
         */
        const bootstrapContext: BrowserContext =
          await browser.newContext(contextOptions);
        const bootstrapPage: Page = await bootstrapContext.newPage();
        bootstrapPage.setDefaultTimeout(30000);

        const ownerEmail: string = Faker.generateEmail().toString();

        try {
          const projectId: string = await registerAndCreateProject({
            page: bootstrapPage,
            projectNamePrefix: "E2E enterprise lapsed",
            email: ownerEmail,
            enablePaidUsage: false,
          });

          /*
           * Turning the project switch on is a core update, so it is still
           * allowed - the recorder simply will not act on it while the licence
           * is dead, which is exactly what the absence test asserts.
           */
          await setProjectAuditLogs({
            page: bootstrapPage,
            projectId,
            enabled: true,
          });

          fixture = {
            projectId,
            ownerEmail,
            licensedResourceType: "",
            licensedResourceName: "",
            projectScimId: "",
            fromHandoff: false,
          };
        } finally {
          await bootstrapContext.close();
        }
      }

      context = await browser.newContext(contextOptions);
      shared.page = await context.newPage();
      shared.page.setDefaultTimeout(30000);
    },
  );

  test.afterAll(async (): Promise<void> => {
    /*
     * The project is left behind, handoff or not: the enterprise job tears the
     * whole stack down after this phase, and a developer rerunning the suite
     * against a stack they lapsed by hand is better served by the fixtures
     * staying put.
     */
    await context?.close();
  });

  test("password sign-in still works while the licence is lapsed", async (): Promise<void> => {
    const page: Page = shared.page;

    await page.goto(
      URL.fromString(BASE_URL.toString()).addRoute("/accounts/").toString(),
    );

    /*
     * The ordinary password form, not an SSO one: the accounts page asks the
     * identity discovery routes which providers to offer, and those routes now
     * answer 402. A sign-in page that treated that refusal as a failure - or a
     * lapse that had disabled password login along with SSO - would strand
     * every administrator of this installation.
     */
    await page.locator('input[type="email"]').fill(fixture.ownerEmail);
    await page.locator('input[type="password"]').fill(E2E_SIGNUP_PASSWORD);
    await page.locator('input[type="password"]').press("Enter");

    await page.waitForURL(DASHBOARD_URL_PATTERN, { timeout: 120000 });

    /*
     * Reaching a /dashboard URL only proves the redirect happened. Reading the
     * project through the API with the session this sign-in established is
     * what proves the session is real: without it this answers 401 and the
     * helper fails with the server's own message.
     */
    const project: JSONish = await getItem({
      page,
      projectId: fixture.projectId,
      path: "/api/project",
      id: fixture.projectId,
      select: { name: true },
    });

    expect(
      String(project["name"] || ""),
      "The signed-in owner must be able to read the project the lapse left behind",
    ).not.toBe("");
  });

  test("the project's audit-log switch survived the lapse", async (): Promise<void> => {
    const settings: ProjectAuditLogSettings = await readProjectAuditLogSettings(
      {
        page: shared.page,
        projectId: fixture.projectId,
      },
    );

    /*
     * The switch is untouched by the lapse. It has to be: the Dashboard's
     * notice promises that recording resumes "with the same settings" as soon
     * as a licence is activated, and a lapse that quietly turned the switch
     * off would break that promise. It also makes the absence test below mean
     * what it says - nothing is recorded DESPITE the project asking for it.
     */
    expect(
      settings.enableAuditLogs,
      "A lapsed licence must not turn the project's audit-log switch off",
    ).toBe(true);
  });

  test("the audit trail recorded while licensed is still readable", async (): Promise<void> => {
    /*
     * The handoff records what the Licensed phase actually left, not what it
     * meant to: it is written even when a test there failed. So this reads the
     * name rather than assuming one, and says so when there is none.
     */
    test.skip(
      !fixture.fromHandoff || !fixture.licensedResourceName,
      "No entry recorded under a live licence to read back (no licensed-phase handoff, or its audited write did not happen).",
    );

    const page: Page = shared.page;

    const entries: Array<AuditLogEntry> = await listAuditLogEntries({
      page,
      projectId: fixture.projectId,
    });

    const recordedWhileLicensed: AuditLogEntry | null = findAuditLogEntry({
      entries,
      match: {
        resourceType: fixture.licensedResourceType,
        resourceName: fixture.licensedResourceName,
        action: AUDIT_LOG_ACTION_CREATE,
      },
    });

    /*
     * Entries already recorded are kept and stay readable - the read API is
     * core, and only the recorder is enterprise. This is also what makes the
     * absence test below sound: the same read, against the same project,
     * returns rows, so an empty answer there cannot be a broken reader.
     */
    expect(
      recordedWhileLicensed,
      `The entry the Licensed phase recorded ("${AUDIT_LOG_ACTION_CREATE} ` +
        `${fixture.licensedResourceType} \\"${fixture.licensedResourceName}\\"") is ` +
        `gone after the lapse. A lapse must stop recording, never drop what was ` +
        `recorded. The trail now holds: ${describeTrail(entries)}`,
    ).not.toBeNull();
  });

  test("creating enterprise configuration is refused for want of a licence", async (): Promise<void> => {
    const page: Page = shared.page;

    const result: EnterpriseWriteResult = await createProjectScim({
      page,
      projectId: fixture.projectId,
      name: `E2E lapsed SCIM ${Faker.generateName().toString()}`,
    });

    const found: string = `HTTP ${result.status}: ${result.body.slice(0, 300)}`;

    expect(
      result.status,
      `Creating enterprise configuration must be refused with 402 while the ` +
        `licence is lapsed. ${found}`,
    ).toBe(402);

    /*
     * THE assertion of this file. Both refusals are 402 and both stop the same
     * write, so only the message says which check turned it away:
     * EnterpriseEdition.createUnavailableException picks the Community-Edition
     * message when no enterprise module is loaded and the licence message when
     * one is. Seeing the licence message is the proof that this stack is the
     * Enterprise image with a dead licence - not a community image that would
     * have refused anyway and made the whole phase vacuous.
     */
    expect(
      result.body,
      `The stack refused this write as the COMMUNITY Edition, which means it is ` +
        `not running the enterprise module at all - so this phase proves nothing ` +
        `about a lapsed licence. ${found}`,
    ).not.toContain(COMMUNITY_EDITION_MESSAGE_FRAGMENT);

    expect(
      result.body,
      `The refusal must name the licence as the reason. ${found}`,
    ).toContain(LICENSE_REQUIRED_MESSAGE_FRAGMENT);
  });

  test("configuration created while licensed is kept and readable, but cannot be changed", async (): Promise<void> => {
    test.skip(
      !fixture.projectScimId,
      "No licensed-phase handoff: there is no enterprise configuration row created under a live licence.",
    );

    const page: Page = shared.page;

    // Reads are never gated: an administrator must still see what is configured.
    const projectScim: JSONish = await getItem({
      page,
      projectId: fixture.projectId,
      path: PROJECT_SCIM_API_PATH,
      id: fixture.projectScimId,
      select: { name: true },
    });

    const existingName: string = String(projectScim["name"] || "");

    expect(
      existingName,
      "The SCIM configuration created while licensed must still be readable",
    ).not.toBe("");

    const result: EnterpriseWriteResult = await updateProjectScimName({
      page,
      projectId: fixture.projectId,
      projectScimId: fixture.projectScimId,
      name: `${existingName} (renamed while lapsed)`,
    });

    const found: string = `HTTP ${result.status}: ${result.body.slice(0, 300)}`;

    /*
     * An ordinary column, so an ordinary update: it needs the licence exactly
     * as a create does. Only the tighten-only updates (disabling a provider,
     * rotating a leaked bearer token) go through without one, and they are
     * pinned by EditionPermission's own unit tests rather than here.
     */
    expect(
      result.status,
      `Renaming enterprise configuration must be refused while the licence is ` +
        `lapsed. ${found}`,
    ).toBe(402);

    expect(
      result.body,
      `The refusal must name the licence as the reason, not the edition. ${found}`,
    ).toContain(LICENSE_REQUIRED_MESSAGE_FRAGMENT);

    expect(result.body, `${found}`).not.toContain(
      COMMUNITY_EDITION_MESSAGE_FRAGMENT,
    );
  });

  test("an audited write records nothing while the licence is lapsed", async (): Promise<void> => {
    const page: Page = shared.page;

    const before: Array<AuditLogEntry> = await listAuditLogEntries({
      page,
      projectId: fixture.projectId,
    });

    const auditedLabelName: string = `E2E lapsed label ${Faker.generateName().toString()}`;

    /*
     * The same audited write the Licensed phase made on this same stack, in
     * the same project, through the same helper - only the licence changed
     * underneath it.
     */
    const labelId: string = await createAuditedLabel({
      page,
      projectId: fixture.projectId,
      name: auditedLabelName,
    });

    expect(
      labelId,
      "The write itself must still succeed: a lapse stops the recorder, not the product",
    ).not.toBe("");

    /*
     * WHY AN ABSENCE IS SOUND HERE, AND WHY IT IS BOUNDED THE WAY IT IS.
     *
     * "Nothing appeared" is normally a weak assertion: a fixture that never
     * worked produces the same nothing as a feature that correctly stopped.
     * That ambiguity is closed on this stack from both ends. The Licensed
     * phase already made this exact write, in this exact project, through
     * these exact helpers, and read the entry back - so recording demonstrably
     * works here, and the reader demonstrably returns rows (the test above
     * reads that very entry back again, after the lapse). What changed between
     * the two is the licence and nothing else.
     *
     * The deadline is AUDIT_LOG_ENTRY_TIMEOUT_MS, the helper's own budget for
     * a recorded entry to show up - not a number invented here. Waiting the
     * whole of it means this negative outlasts the entire window the positive
     * was allowed on the same stack: if a row could arrive later than this, the
     * Licensed phase would already be failing. Raising that constant makes the
     * positive more patient and this negative more certain in one edit.
     *
     * The trail is re-read throughout the window rather than once at the end,
     * so a row that appears and is then aged out cannot slip between two
     * reads. Reading the first page only is enough: it is the ten most recent
     * entries by createdAt, and a row recorded now would necessarily be on it.
     */
    const match: {
      resourceType: string;
      resourceName: string;
      action: string;
    } = {
      resourceType: LABEL_RESOURCE_TYPE,
      resourceName: auditedLabelName,
      action: AUDIT_LOG_ACTION_CREATE,
    };

    const deadline: number = Date.now() + AUDIT_LOG_ENTRY_TIMEOUT_MS;
    let after: Array<AuditLogEntry> = before;

    for (;;) {
      after = await listAuditLogEntries({
        page,
        projectId: fixture.projectId,
      });

      expect(
        findAuditLogEntry({ entries: after, match }),
        `The audit recorder wrote an entry for a write performed while the ` +
          `Enterprise licence was lapsed. Recording must stop until a licence is ` +
          `activated. The trail holds: ${describeTrail(after)}`,
      ).toBeNull();

      if (Date.now() >= deadline) {
        break;
      }

      await page.waitForTimeout(AUDIT_LOG_POLL_INTERVAL_MS);
    }

    /*
     * And nothing else was recorded either - not just nothing matching this
     * label. A recorder that wrote a redacted or misattributed row instead
     * would pass the check above and fail this one.
     */
    expect(
      after.length,
      `The project's audit trail grew from ${before.length} to ${after.length} ` +
        `entries while the licence was lapsed. Before: ${describeTrail(before)}. ` +
        `After: ${describeTrail(after)}`,
    ).toBe(before.length);
  });
});
