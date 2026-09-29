import { registerAndCreateProject } from "../../Tests/Dashboard/Helpers/ProductOnboarding";
import {
  AUDIT_LOG_ACTION_CREATE,
  AuditLogEntry,
  LABEL_RESOURCE_TYPE,
  ProjectAuditLogSettings,
  createAuditedLabel,
  readProjectAuditLogSettings,
  setProjectAuditLogs,
  waitForAuditLogEntry,
} from "../Helpers/AuditLogs";
import {
  COMMUNITY_EDITION_MESSAGE_FRAGMENT,
  EnterpriseWriteResult,
  LICENSE_REQUIRED_MESSAGE_FRAGMENT,
  createProjectScim,
  isProjectScimListed,
} from "../Helpers/EnterpriseConfiguration";
import { writeLicensedSuiteHandoff } from "../Helpers/Handoff";
import { assertLicensedEnterpriseStack } from "../Helpers/StackGuard";
import {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
  expect,
  test,
} from "@playwright/test";
import Faker from "Common/Utils/Faker";

/*
 * The two things a licensed enterprise stack does that no other stack does:
 * it RECORDS audit entries, and it ACCEPTS enterprise configuration writes.
 *
 * What this proves that the jest suites cannot:
 *
 *   - ee/Tests/Server/AuditLog/* pins the recorder's eligibility rules and its
 *     redaction with the store mocked. Only a booted stack shows the recorder
 *     inside the published enterprise image writing a row into the real
 *     ClickHouse that docker-compose.yml starts, which the CORE read API then
 *     returns - the recorder is enterprise code, the AuditLogV2 table and the
 *     read API are core, and they meet nowhere else.
 *   - The enterprise-configuration gate is unit-tested against the permission
 *     check directly. Here the same rule is exercised through a real session,
 *     nginx, the API layer and a live licence snapshot.
 *
 * STATE THIS SUITE DELIBERATELY LEAVES BEHIND (see Helpers/Handoff.ts): the
 * project is NOT deleted. It keeps audit logging ON, one recorded entry and
 * one ProjectSCIM row, and its owner account keeps the shared signup password,
 * so the Lapsed suite - which runs against this same stack after the licence
 * is forced to lapse - can show that a further audited write records nothing,
 * that changing that SCIM row is refused, that the existing trail is still
 * readable, and that password sign-in still works. Deleting the project here
 * would take all of that away.
 */

test.describe("Audit recorder and enterprise writes (licensed stack)", () => {
  test.describe.configure({ mode: "serial" });

  const shared: { page: Page } = { page: undefined as unknown as Page };
  let context: BrowserContext;
  let projectId: string = "";
  let ownerEmail: string = "";
  let auditedLabelName: string = "";
  let auditLogsEnabled: boolean = false;
  let projectScimId: string = "";
  let projectScimName: string = "";

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

      context = await browser.newContext(contextOptions);
      shared.page = await context.newPage();
      shared.page.setDefaultTimeout(30000);

      /*
       * The email is generated here rather than inside the onboarding helper
       * so the handoff can name the account the Lapsed suite signs in as.
       */
      ownerEmail = Faker.generateEmail().toString();

      projectId = await registerAndCreateProject({
        page: shared.page,
        projectNamePrefix: "E2E enterprise licensed",
        email: ownerEmail,
        enablePaidUsage: false,
      });
    },
  );

  test.afterAll(async (): Promise<void> => {
    /*
     * The handoff is written even when a test above failed: it records what
     * this run actually left behind, and a Lapsed spec reads the flags rather
     * than assuming. The project itself is intentionally kept.
     */
    if (projectId) {
      writeLicensedSuiteHandoff({
        projectId,
        ownerEmail,
        auditLogsEnabled,
        auditedResourceType: LABEL_RESOURCE_TYPE,
        auditedResourceName: auditedLabelName,
        projectScimId,
        projectScimName,
        completedAt: new Date().toISOString(),
      });
    }

    await context?.close();
  });

  test("audit logging can be turned on for the project", async (): Promise<void> => {
    const page: Page = shared.page;

    const before: ProjectAuditLogSettings = await readProjectAuditLogSettings({
      page,
      projectId,
    });

    /*
     * enableAuditLogs defaults to false on every project
     * (Common/Models/DatabaseModels/Project.ts), so nothing is recorded until
     * an owner turns it on - the third of the three conditions the recorder
     * checks, and the only one this suite controls.
     */
    expect(
      before.enableAuditLogs,
      "A new project must start with audit logging off",
    ).toBe(false);

    await setProjectAuditLogs({ page, projectId, enabled: true });

    const after: ProjectAuditLogSettings = await readProjectAuditLogSettings({
      page,
      projectId,
    });

    expect(
      after.enableAuditLogs,
      "The project's audit logging switch did not persist",
    ).toBe(true);

    auditLogsEnabled = true;
  });

  test("an audited write is recorded and readable through the core API", async (): Promise<void> => {
    const page: Page = shared.page;

    expect(
      auditLogsEnabled,
      "Audit logging must be on before the audited write",
    ).toBe(true);

    auditedLabelName = `E2E audited label ${Faker.generateName().toString()}`;

    /*
     * An ordinary CRUD create by the signed-in owner. Nothing about it asks
     * for an audit entry: the recorder has to notice on its own, which it only
     * does while the enterprise module is loaded AND the licence covers audit
     * logs AND the project switch is on. Updating the project above already
     * invalidated the recorder's settings cache, so no wait is needed here.
     */
    const labelId: string = await createAuditedLabel({
      page,
      projectId,
      name: auditedLabelName,
    });

    expect(labelId, "The audited write did not return a label id").not.toBe("");

    const entry: AuditLogEntry = await waitForAuditLogEntry({
      page,
      projectId,
      match: {
        resourceType: LABEL_RESOURCE_TYPE,
        resourceName: auditedLabelName,
        action: AUDIT_LOG_ACTION_CREATE,
      },
    });

    expect(entry.action).toBe(AUDIT_LOG_ACTION_CREATE);
    expect(entry.resourceType).toBe(LABEL_RESOURCE_TYPE);
    expect(entry.resourceName).toBe(auditedLabelName);
    expect(
      entry.resourceId,
      "The entry must point at the row that was created",
    ).toBe(labelId);

    /*
     * Attribution: the entry names the signed-in owner, not the system. A
     * system event would carry no user at all and would be dropped unless the
     * project opted into storing them.
     */
    expect(
      entry.userEmail,
      "The entry must be attributed to the signed-in owner",
    ).toBe(ownerEmail);
  });

  test("enterprise configuration writes are accepted while the licence is usable", async (): Promise<void> => {
    const page: Page = shared.page;

    projectScimName = `E2E licensed SCIM ${Faker.generateName().toString()}`;

    const result: EnterpriseWriteResult = await createProjectScim({
      page,
      projectId,
      name: projectScimName,
    });

    const found: string = `HTTP ${result.status}: ${result.body.slice(0, 300)}`;

    /*
     * 402 is how both of the other stacks refuse this write, and the message
     * says which one refused. Naming them here means the failure explains
     * itself instead of only reporting an unexpected status.
     */
    expect(
      result.body,
      `The stack refused this write as the Community Edition, so it is not ` +
        `running the enterprise module at all. ${found}`,
    ).not.toContain(COMMUNITY_EDITION_MESSAGE_FRAGMENT);

    expect(
      result.body,
      `The stack refused this write for want of a licence, so its licence is no ` +
        `longer usable - that is the Lapsed stack's behaviour. ${found}`,
    ).not.toContain(LICENSE_REQUIRED_MESSAGE_FRAGMENT);

    expect(
      result.status,
      `Creating enterprise configuration must not be refused here. ${found}`,
    ).not.toBe(402);

    expect(
      result.status,
      `Creating enterprise configuration must succeed. ${found}`,
    ).toBe(200);

    /*
     * The create must hand back the row's key. It did not for a while - a
     * column-metadata cache in Common dropped `_id` from every serialized
     * response for a model once one create had been made for it - and the
     * Lapsed phase needs this id to address the row for an update, so assert
     * it rather than working around its absence.
     */
    expect(
      result.id,
      `The created SCIM configuration must come back with an id. ${found}`,
    ).not.toBe("");

    projectScimId = result.id;

    /*
     * And read it back rather than trusting the 200: the row has to be really
     * there for the Lapsed phase to show that a lapse keeps it.
     */
    const isListed: boolean = await isProjectScimListed({
      page,
      projectId,
      name: projectScimName,
    });

    expect(
      isListed,
      `The SCIM configuration created while licensed must be listed back. ${found}`,
    ).toBe(true);
  });
});
