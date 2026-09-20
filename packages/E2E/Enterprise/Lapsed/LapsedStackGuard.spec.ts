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

  test("the forced lapse leaves an Enterprise payload with nothing entitled", (): void => {
    const found: string = describeEnterpriseLicenseState(licenseState);

    /*
     * The shape the documented lapse produces, pinned exactly rather than
     * loosely as above, because this is the one the enterprise CI job creates:
     * an installation that never held a licence, whose 14-day trial was forced
     * to end by backdating GlobalConfig.enterpriseEditionFirstSeenAt (see
     * packages/E2E/README.md). No token was ever stored, so the status is
     * "missing" rather than the "expired" or "invalid" a real licence would
     * leave behind - if this fails with one of those, the stack was lapsed
     * some other way than the phase this suite is the second half of.
     */
    expect(
      licenseState.status,
      `The lapse this suite expects leaves the licence "missing". Found: ${found}`,
    ).toBe("missing");

    /*
     * features is the field that tells a LAPSED ENTERPRISE stack from a
     * COMMUNITY one, and neither licenseValid nor status can: an empty ARRAY
     * means an enterprise module is loaded and its licence entitles nothing,
     * while null means there is no licence to speak of because the image has
     * no enterprise module at all (GlobalConfigAPI.toFeaturesResponse answers
     * null only for a missing snapshot). The whole point of this phase is that
     * the first is not the second, so the distinction is asserted on the type,
     * not just on the emptiness.
     */
    expect(
      Array.isArray(licenseState.features),
      `An Enterprise stack must report its covered features as a list, even an ` +
        `empty one. null is the Community Edition's answer, which would mean ` +
        `the enterprise module is not loaded at all. Found: ${found}`,
    ).toBe(true);

    expect(licenseState.features, `Found: ${found}`).toEqual([]);

    /*
     * No token was ever stored, so there is nothing to have verified and no
     * expiry to report. graceEndsAt is the trial's end, now in the past - the
     * backdated date is exactly what put it there.
     */
    expect(licenseState.verification, `Found: ${found}`).toBe("none");
    expect(licenseState.expiresAt, `Found: ${found}`).toBeNull();
    expect(licenseState.graceReason, `Found: ${found}`).toBeNull();

    expect(
      licenseState.graceEndsAt,
      `A trial that has ended still says when it ended. Found: ${found}`,
    ).not.toBeNull();

    expect(
      Date.parse(licenseState.graceEndsAt!),
      `The trial must be OVER: graceEndsAt ${String(
        licenseState.graceEndsAt,
      )} is still in the future, so the backdated ` +
        `enterpriseEditionFirstSeenAt did not move it far enough back. Found: ${found}`,
    ).toBeLessThan(Date.now());
  });
});
