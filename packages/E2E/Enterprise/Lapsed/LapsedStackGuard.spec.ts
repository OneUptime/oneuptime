import {
  EnterpriseLicenseState,
  describeEnterpriseLicenseState,
} from "../Helpers/LicenseState";
import { assertLapsedEnterpriseStack } from "../Helpers/StackGuard";
import { expect, test } from "@playwright/test";

/*
 * The shared precondition of the Lapsed suite, and the first thing phase two
 * of the enterprise job proves: the licence really did lapse on the running
 * stack, without a restart.
 *
 * What this proves that the jest suites cannot: ee/Tests/Server/License/*
 * already pins how a licence is classified, and IdentityRoutesLicenseLapse
 * pins the whole lapse-and-renew matrix against a mounted Express app. What
 * none of them can show is a BOOTED image noticing that its trial ended -
 * the licence inputs are read through a 60s cache and the snapshot the gates
 * use is served synchronously while a reload runs behind it, so "the app
 * notices without a restart" is a claim about a live process. The guard polls
 * the licence endpoint until the state flips and fails loudly, naming the
 * stack it found, if it never does.
 *
 * THIS FILE IS THE SEAM, NOT THE SUITE. The specs that assert what a lapse
 * actually stops belong beside it, each calling assertLapsedEnterpriseStack()
 * in its own beforeAll:
 *
 *   - the identity surface refuses on both nginx prefixes: Enterprise/Helpers/
 *     IdentityRoutes.ts already carries each probe's `lapsed` expectation
 *     (402 with the SSO message, 403 with the SCIM error body) beside the
 *     `licensed` one the other suite asserts;
 *   - enterprise configuration writes are refused with the LICENSE_REQUIRED
 *     message and NOT the COMMUNITY_EDITION one (Enterprise/Helpers/
 *     EnterpriseConfiguration.ts), while a tighten-only update still goes
 *     through;
 *   - an audited write records nothing, though the trail recorded while
 *     licensed is still readable (Enterprise/Helpers/AuditLogs.ts exports
 *     findAuditLogEntry for exactly that negative);
 *   - password sign-in still works - a lapsed licence must never lock an
 *     administrator out.
 *
 * The project, the recorded entry, the SCIM row and the owner account those
 * specs need were left behind by the Licensed suite; read them with
 * readLicensedSuiteHandoff() from Enterprise/Helpers/Handoff.ts, and fall back
 * to creating your own when it returns null.
 */

test.describe("Enterprise licence has lapsed (lapsed stack)", () => {
  let licenseState: EnterpriseLicenseState;

  test.beforeAll(async (): Promise<void> => {
    /*
     * Polls until the licence state flips: after the job backdates
     * GlobalConfig.enterpriseEditionFirstSeenAt the running app can serve the
     * previous answer for up to its cache TTL.
     */
    licenseState = await assertLapsedEnterpriseStack();
  });

  test("the stack is still the Enterprise Edition, with an unusable licence", (): void => {
    const found: string = describeEnterpriseLicenseState(licenseState);

    /*
     * Still "enterprise": the module is loaded and every identity route is
     * still MOUNTED. That is what makes the refusals below 402/403 rather
     * than the Community Edition's 404, and it is the whole distinction this
     * phase exists to draw.
     */
    expect(licenseState.edition, `Found: ${found}`).toBe("enterprise");

    expect(licenseState.licenseValid, `Found: ${found}`).toBe(false);

    /*
     * A trial that was forced to end leaves "missing" - no token was ever
     * stored. An expired token past its grace period would leave "expired",
     * and an untrustworthy one "invalid"; all three are lapsed states.
     */
    expect(["missing", "expired", "invalid"], `Found: ${found}`).toContain(
      licenseState.status,
    );

    /*
     * And nothing is entitled any more. "all" here would mean the gates still
     * let SSO, SCIM and audit logging run.
     */
    expect(licenseState.features, `Found: ${found}`).not.toBe("all");
  });
});
