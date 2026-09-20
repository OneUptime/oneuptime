import { E2E_SIGNUP_PASSWORD } from "../../Config";
import {
  AUDIT_LOG_POLL_INTERVAL_MS,
  AuditLogEntry,
  ProjectAuditLogSettings,
  createAuditedLabel,
  listAuditLogEntries,
  readProjectAuditLogSettings,
  trySetProjectAuditLogs,
} from "../../Enterprise/Helpers/AuditLogs";
import {
  COMMUNITY_EDITION_MESSAGE_FRAGMENT,
  EnterpriseWriteResult,
  LICENSE_REQUIRED_MESSAGE_FRAGMENT,
  createProjectScim,
} from "../../Enterprise/Helpers/EnterpriseConfiguration";
import {
  IDENTITY_PREFIXES,
  IDENTITY_PROBES,
  PAGE_NOT_FOUND_MESSAGE_FRAGMENT,
  identityProbeUrl,
} from "../../Enterprise/Helpers/IdentityRoutes";
import {
  EnterpriseLicenseState,
  LICENSE_ENDPOINT_PATH,
  describeEnterpriseLicenseState,
  enterpriseUrl,
  fetchEnterpriseLicenseState,
} from "../../Enterprise/Helpers/LicenseState";
import { JSONish, toId } from "../Dashboard/Helpers/MonitorAlerting";
import {
  APIRequestContext,
  APIResponse,
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
  expect,
  test,
} from "@playwright/test";
import Faker from "Common/Utils/Faker";

/*
 * THE COMMUNITY EDITION NEGATIVE CONTROL - the other half of the enterprise
 * e2e job, and the reason its positives mean anything.
 *
 * packages/E2E/Enterprise/** asserts that a self-hosted ENTERPRISE stack
 * serves the identity routes, renders the enterprise screens, records audit
 * entries and accepts enterprise configuration - and that a lapsed licence
 * stops all of it in a way that is visibly NOT the Community Edition. Every
 * one of those assertions is only interesting if the Community image really
 * does none of it. That is what this spec pins, on the community stack, where
 * no enterprise suite ever runs.
 *
 * KEEP THE TWO IN STEP. The expectations here are the `community` column of
 * the same tables the enterprise suites read their own columns from
 * (Enterprise/Helpers/IdentityRoutes.ts, EnterpriseConfiguration.ts), so a
 * route added to one surface is added to all three at once. When you change
 * what an enterprise stack answers, change what this expects in the same
 * commit - a negative control that has drifted is worse than none, because it
 * still passes.
 *
 * WHY IT LIVES IN Tests/ AND SKIPS AT RUNTIME. The community image is booted
 * by test-e2e-test-self-hosted, which runs the whole ./Tests tree and nothing
 * else; a focused suite like the enterprise ones would never be run there. The
 * same tree also runs on the two enterprise stacks, where every assertion here
 * would be wrong, so this spec detects the edition at runtime from
 * GET /api/global-config/license and skips when it is not the Community one.
 * It does NOT read IS_ENTERPRISE_EDITION: docker-compose.base.yml passes that
 * variable through to the e2e container and no job sets it, so it reads false
 * even in the job that boots the enterprise image.
 *
 * It is deliberately cheap - a handful of API calls and no page navigation -
 * because the default suite is already near the 90-minute ceiling its own
 * config says must be read as a hang rather than raised.
 */

const COMMUNITY_EDITION: string = "community";

const NOT_COMMUNITY_SKIP_REASON: string =
  "Not the Community Edition: this is the negative control for the enterprise " +
  "e2e job and only applies to a stack whose enterprise module is absent.";

/*
 * How long the audit trail is re-read before concluding that nothing was
 * recorded.
 *
 * Far shorter than the enterprise suite's AUDIT_LOG_ENTRY_TIMEOUT_MS, and
 * deliberately so: there, the absence has to outlast the budget a working
 * recorder was given on the very same stack, because the recorder is present
 * and the licence is what stopped it. Here the absence is structural - the
 * recorder is not in the image at all, and the 404s asserted above are what
 * establishes that - so this window only guards against a row arriving
 * slightly after the write. This spec runs inside the default suite, in two
 * browsers, in all three jobs; spending ninety seconds on it would cost every
 * job that time to re-prove something the 404s already settled.
 */
const COMMUNITY_AUDIT_ABSENCE_WINDOW_MS: number = 15000;

type RegisterOwnerAndProjectFunction = (data: {
  page: Page;
}) => Promise<string>;

/*
 * Signs a fresh owner up and creates a project, over the API alone.
 *
 * The shared onboarding helper (Tests/Dashboard/Helpers/ProductOnboarding.ts)
 * drives the register form and the project modal in a browser, which is right
 * for a spec about onboarding and far too expensive for this one: it runs in
 * the default suite, in two browsers, in every job. These two calls are the
 * same two requests that flow ends in.
 *
 * The bodies are the envelopes the Dashboard's model forms send
 * (JSONFunctions.serialize), because that is what the API deserializes back
 * into Email, Name and HashedString before the User row is built.
 */
const registerOwnerAndProject: RegisterOwnerAndProjectFunction = async (data: {
  page: Page;
}): Promise<string> => {
  const email: string = Faker.generateEmail().toString();

  const signupUrl: string = enterpriseUrl("/api/identity/signup");
  const signupResponse: APIResponse = await data.page.request.post(signupUrl, {
    headers: { "content-type": "application/json" },
    data: {
      data: {
        email: { _type: "Email", value: email },
        name: { _type: "Name", value: "E2E Community Control" },
        password: { _type: "HashedString", value: E2E_SIGNUP_PASSWORD },
      },
    },
  });

  expect(
    signupResponse.ok(),
    `POST ${signupUrl} failed: ${signupResponse.status()} ${(
      await signupResponse.text()
    ).slice(0, 300)}`,
  ).toBe(true);

  /*
   * The session is a cookie the answer above set, and this request context
   * keeps it - so the project below is created BY this user, which is what
   * makes them its owner and gives the later calls their permissions.
   */
  const projectUrl: string = enterpriseUrl("/api/project");
  const projectResponse: APIResponse = await data.page.request.post(
    projectUrl,
    {
      headers: { "content-type": "application/json" },
      data: {
        data: {
          name: `E2E community control ${Faker.generateName().toString()}`,
        },
      },
    },
  );

  const projectBody: string = await projectResponse.text();

  expect(
    projectResponse.ok(),
    `POST ${projectUrl} failed: ${projectResponse.status()} ${projectBody.slice(
      0,
      300,
    )}`,
  ).toBe(true);

  const parsed: JSONish = JSON.parse(projectBody) as JSONish;
  const project: JSONish = (parsed["data"] as JSONish) || parsed;
  const projectId: string = toId(project["_id"]);

  expect(
    projectId,
    `POST ${projectUrl} did not return a project id: ${projectBody.slice(0, 300)}`,
  ).not.toBe("");

  return projectId;
};

test.describe("Community Edition: no enterprise routes are served", () => {
  let licenseState: EnterpriseLicenseState;

  test.beforeAll(
    async ({ request }: { request: APIRequestContext }): Promise<void> => {
      licenseState = await fetchEnterpriseLicenseState({ request });
    },
  );

  test.beforeEach((): void => {
    test.skip(
      licenseState.edition !== COMMUNITY_EDITION,
      NOT_COMMUNITY_SKIP_REASON,
    );
  });

  test(`GET ${LICENSE_ENDPOINT_PATH} reports the Community Edition`, (): void => {
    const found: string = describeEnterpriseLicenseState(licenseState);

    expect(licenseState.httpStatus, `Found: ${found}`).toBe(200);

    /*
     * "community" is EnterpriseEdition.isLoaded() answering false in the App
     * process: the image carries no enterprise module. Everything else in this
     * file follows from that one fact.
     */
    expect(licenseState.edition, `Found: ${found}`).toBe(COMMUNITY_EDITION);

    /*
     * There is no licence to have a status, a verification or a grace period:
     * GlobalConfigAPI builds the payload from a null snapshot, and a leftover
     * licence key from an earlier Enterprise image licenses nothing here.
     */
    expect(licenseState.status, `Found: ${found}`).toBeNull();
    expect(licenseState.verification, `Found: ${found}`).toBeNull();
    expect(licenseState.graceReason, `Found: ${found}`).toBeNull();
    expect(licenseState.licenseValid, `Found: ${found}`).toBe(false);

    /*
     * null, not []. The empty LIST is what a lapsed Enterprise stack reports -
     * an enterprise module whose licence entitles nothing - and telling the
     * two apart is the whole job of the enterprise phase this spec is the
     * control for.
     */
    expect(licenseState.features, `Found: ${found}`).toBeNull();
  });

  for (const prefix of IDENTITY_PREFIXES) {
    for (const probe of IDENTITY_PROBES) {
      test(`GET ${prefix}${probe.path} is not served - ${probe.label}`, async ({
        request,
      }: {
        request: APIRequestContext;
      }): Promise<void> => {
        const url: string = identityProbeUrl({ prefix, path: probe.path });

        const response: APIResponse = await request.get(url, {
          maxRedirects: 0,
        });
        const status: number = response.status();
        const body: string = await response.text();
        const found: string = `HTTP ${status} from ${url}: ${body.slice(0, 300)}`;

        /*
         * 404 from the App's catch-all, and nothing else. A 402 or 403 here
         * would mean this image DOES mount the enterprise identity routers and
         * is merely refusing per request - that is the lapsed Enterprise
         * stack's answer, and on a community build it would mean enterprise
         * code shipped where it must not.
         */
        expect(
          status,
          `${url} answered something other than 404, so this build mounts the ` +
            `enterprise identity routers. ${found}`,
        ).toBe(probe.community.status);

        expect(
          body,
          `${url} did not answer the App's catch-all. ${found}`,
        ).toContain(
          probe.community.bodyContains || PAGE_NOT_FOUND_MESSAGE_FRAGMENT,
        );
      });
    }
  }

  test(`POST ${LICENSE_ENDPOINT_PATH} is not served`, async ({
    request,
  }: {
    request: APIRequestContext;
  }): Promise<void> => {
    const url: string = enterpriseUrl(LICENSE_ENDPOINT_PATH);

    /*
     * Activating a licence is enterprise code (ee/Server/License/API/
     * LicenseClientAPI.ts mounts POST /global-config/license under /api); only
     * the GET asserted above stayed in core, because the edition pill and the
     * sign-in page read it on every stack. So the Community Edition offers no
     * way to install a licence at all - it is not a build with the features
     * switched off, it is a build without them.
     */
    const response: APIResponse = await request.post(url, {
      data: { licenseKey: "e2e-community-control" },
      maxRedirects: 0,
    });
    const body: string = await response.text();
    const found: string = `HTTP ${response.status()} from ${url}: ${body.slice(0, 300)}`;

    expect(
      response.status(),
      `${url} accepted a licence activation on the Community Edition. ${found}`,
    ).toBe(404);

    expect(body, `${found}`).toContain(PAGE_NOT_FOUND_MESSAGE_FRAGMENT);
  });
});

test.describe("Community Edition: enterprise writes and audit logging", () => {
  test.describe.configure({ mode: "serial" });

  /*
   * A browser page is used for its request context only - this spec never
   * navigates. That context shares the cookie jar the sign-up below fills, so
   * every call here is a real signed-in project owner, and the enterprise
   * helpers (which take a Page) can be reused exactly as the enterprise suites
   * use them, instead of this spec growing its own copies that could drift.
   */
  const shared: { page: Page; projectId: string } = {
    page: undefined as unknown as Page,
    projectId: "",
  };
  let context: BrowserContext;
  let licenseState: EnterpriseLicenseState;

  test.beforeAll(
    async ({
      browser,
      contextOptions,
    }: {
      browser: Browser;
      contextOptions: BrowserContextOptions;
    }): Promise<void> => {
      test.setTimeout(120000);

      licenseState = await fetchEnterpriseLicenseState();

      if (licenseState.edition !== COMMUNITY_EDITION) {
        // Every test below skips; do not spend a sign-up on the wrong stack.
        return;
      }

      context = await browser.newContext(contextOptions);
      shared.page = await context.newPage();
      shared.page.setDefaultTimeout(30000);

      shared.projectId = await registerOwnerAndProject({ page: shared.page });
    },
  );

  test.beforeEach((): void => {
    test.skip(
      licenseState.edition !== COMMUNITY_EDITION,
      NOT_COMMUNITY_SKIP_REASON,
    );
  });

  test.afterAll(async (): Promise<void> => {
    await context?.close();
  });

  test("creating enterprise configuration is refused as the Community Edition", async (): Promise<void> => {
    const result: EnterpriseWriteResult = await createProjectScim({
      page: shared.page,
      projectId: shared.projectId,
      name: `E2E community SCIM ${Faker.generateName().toString()}`,
    });

    const found: string = `HTTP ${result.status}: ${result.body.slice(0, 300)}`;

    expect(
      result.status,
      `Creating enterprise configuration must be refused with 402 on the ` +
        `Community Edition. ${found}`,
    ).toBe(402);

    /*
     * The message, not the status, is the assertion. A lapsed Enterprise stack
     * refuses this very write with the same 402 and a different message
     * (EnterpriseEdition.createUnavailableException picks between them on
     * isLoaded()), and the enterprise job's lapsed phase asserts that one. If
     * this build ever answered with the licence message it would mean the
     * enterprise module is loaded here.
     */
    expect(
      result.body,
      `The refusal must name the EDITION as the reason. ${found}`,
    ).toContain(COMMUNITY_EDITION_MESSAGE_FRAGMENT);

    expect(
      result.body,
      `The Community Edition refused this write for want of a LICENCE, which ` +
        `means it is running an enterprise module. ${found}`,
    ).not.toContain(LICENSE_REQUIRED_MESSAGE_FRAGMENT);
  });

  test("audit logging cannot even be switched on, and nothing is ever recorded", async (): Promise<void> => {
    const page: Page = shared.page;
    const projectId: string = shared.projectId;

    /*
     * The AuditLogV2 table and the read API are core, but the project's
     * enableAuditLogs column is enterprise CONFIGURATION: EditionPermission
     * refuses to store it without the module, so a Community image will not
     * even accept the intent. Verified against a booted community stack - the
     * PUT comes back 402 with the edition's message, not the licence's.
     */
    const attempt: { status: number; body: string } =
      await trySetProjectAuditLogs({ page, projectId, enabled: true });

    const attemptFound: string = `HTTP ${attempt.status}: ${attempt.body.slice(
      0,
      300,
    )}`;

    expect(
      attempt.status,
      `Turning audit logging on must be refused on the Community Edition. ${attemptFound}`,
    ).toBe(402);

    expect(
      attempt.body,
      `The refusal must name the EDITION as the reason. ${attemptFound}`,
    ).toContain(COMMUNITY_EDITION_MESSAGE_FRAGMENT);

    expect(
      attempt.body,
      `A refusal for want of a LICENCE would mean this image is running an ` +
        `enterprise module. ${attemptFound}`,
    ).not.toContain(LICENSE_REQUIRED_MESSAGE_FRAGMENT);

    const settings: ProjectAuditLogSettings = await readProjectAuditLogSettings(
      {
        page,
        projectId,
      },
    );

    expect(
      settings.enableAuditLogs,
      "The refused switch must not have been stored either",
    ).toBe(false);

    /*
     * And with the switch off and no recorder in the image, an audited write
     * leaves no trail. The write itself must succeed: Label is core.
     */
    const labelId: string = await createAuditedLabel({
      page,
      projectId,
      name: `E2E community audited label ${Faker.generateName().toString()}`,
    });

    expect(
      labelId,
      "The audited write itself must succeed: the model is core",
    ).not.toBe("");

    /*
     * Re-read for a short window rather than once, so a row written just after
     * the first read cannot pass unnoticed. See the constant above for why
     * this window is short where the enterprise suite's is long.
     */
    const deadline: number = Date.now() + COMMUNITY_AUDIT_ABSENCE_WINDOW_MS;

    for (;;) {
      const entries: Array<AuditLogEntry> = await listAuditLogEntries({
        page,
        projectId,
      });

      expect(
        entries.length,
        `The Community Edition recorded an audit entry. The recorder is ` +
          `Enterprise code (ee/Server/AuditLog/AuditLogRecorder.ts) and must not ` +
          `be in this image: ${entries
            .map((entry: AuditLogEntry): string => {
              return `${entry.action} ${entry.resourceType} "${entry.resourceName}"`;
            })
            .join(", ")}`,
      ).toBe(0);

      if (Date.now() >= deadline) {
        break;
      }

      await page.waitForTimeout(AUDIT_LOG_POLL_INTERVAL_MS);
    }
  });
});
