import {
  EnterpriseLicenseState,
  LICENSE_ENDPOINT_PATH,
  MASTER_ADMIN_ONLY_LICENSE_FIELDS,
  describeEnterpriseLicenseState,
  enterpriseUrl,
} from "../Helpers/LicenseState";
import { assertLicensedEnterpriseStack } from "../Helpers/StackGuard";
import { expect, test } from "@playwright/test";
import { ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS } from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";

/*
 * The edition and licence endpoint, through nginx, on a self-hosted
 * ENTERPRISE stack with billing off.
 *
 * What this proves that the jest suites cannot: packages/Common/Tests/Server/
 * API/GlobalConfigLicense.test.ts already pins the payload per audience by
 * calling buildLicenseResponse directly, and ee/Tests/Server/License/* pins
 * the classification arithmetic. Neither of them boots anything. This spec is
 * the only place that shows the PUBLISHED enterprise image, started by the
 * real docker-compose.yml with BILLING_ENABLED=false, loading its enterprise
 * module and reporting a usable licence on a route reached through the
 * ingress - which is the precondition for everything else in this suite, and
 * the single answer the Dashboard's edition pill and every licence gate read.
 *
 * Deliberately not re-tested here: how a licence is classified, what the
 * master-admin payload contains, or what each field means. Only what a booted
 * stack decides.
 */

const MILLISECONDS_PER_DAY: number = 24 * 60 * 60 * 1000;

/*
 * A licence installed on the stack would make status "valid" instead; the CI
 * job installs none, so the fresh-install trial is the expected shape and the
 * assertions below take the branch the stack reports.
 */
const UNLICENSED_TRIAL_STATUS: string = "grace";
const UNLICENSED_TRIAL_GRACE_REASON: string = "unlicensed";

test.describe("Enterprise licence endpoint (licensed stack)", () => {
  let licenseState: EnterpriseLicenseState;

  test.beforeAll(async (): Promise<void> => {
    licenseState = await assertLicensedEnterpriseStack();
  });

  test(`GET ${LICENSE_ENDPOINT_PATH} reports the Enterprise Edition with a usable licence`, (): void => {
    const found: string = describeEnterpriseLicenseState(licenseState);

    expect(
      licenseState.httpStatus,
      `${enterpriseUrl(LICENSE_ENDPOINT_PATH)} must answer 200 through nginx. Found: ${found}`,
    ).toBe(200);

    /*
     * "enterprise" is EnterpriseEdition.isLoaded() in the App process: the
     * enterprise module in the image was found and loaded. On the community
     * image this reads "community" and every identity route 404s.
     */
    expect(licenseState.edition, `Found: ${found}`).toBe("enterprise");

    // True for a valid licence and for one inside a grace period or the trial.
    expect(licenseState.licenseValid, `Found: ${found}`).toBe(true);

    /*
     * "all" is what an unlicensed trial (and a licence that lists no feature
     * subset) entitles. Anything else here would stop SSO, SCIM or audit
     * logging on a stack this suite then expects to serve them.
     */
    expect(licenseState.features, `Found: ${found}`).toBe("all");

    expect([UNLICENSED_TRIAL_STATUS, "valid"], `Found: ${found}`).toContain(
      licenseState.status,
    );

    expect(typeof licenseState.isEvaluation, `Found: ${found}`).toBe("boolean");
  });

  test("a fresh install is inside its unlicensed trial, which has not yet ended", (): void => {
    const found: string = describeEnterpriseLicenseState(licenseState);

    if (licenseState.status !== UNLICENSED_TRIAL_STATUS) {
      /*
       * A licence was installed on this stack, so there is no trial to check.
       * Not a skip: the licensed suite is equally valid either way, and the
       * assertion above already established the licence is usable.
       */
      expect(licenseState.status, `Found: ${found}`).toBe("valid");
      expect(licenseState.expiresAt, `Found: ${found}`).not.toBeNull();
      return;
    }

    /*
     * graceReason is the only thing that tells the two grace periods apart: an
     * install that never had a licence ("unlicensed", counted from
     * GlobalConfig.enterpriseEditionFirstSeenAt) and a licence that expired
     * ("expired", counted from its expiry). A fresh CI stack is the first.
     */
    expect(licenseState.graceReason, `Found: ${found}`).toBe(
      UNLICENSED_TRIAL_GRACE_REASON,
    );

    // No token is stored on a fresh install, so there is nothing to verify.
    expect(licenseState.verification, `Found: ${found}`).toBe("none");
    expect(licenseState.companyName, `Found: ${found}`).toBeNull();
    expect(licenseState.expiresAt, `Found: ${found}`).toBeNull();

    expect(
      licenseState.graceEndsAt,
      `An unlicensed trial must say when it ends. Found: ${found}`,
    ).not.toBeNull();

    const graceEndsAt: number = Date.parse(licenseState.graceEndsAt!);
    expect(
      Number.isNaN(graceEndsAt),
      `graceEndsAt must be an ISO timestamp. Found: ${String(licenseState.graceEndsAt)}`,
    ).toBe(false);

    const now: number = Date.now();

    expect(
      graceEndsAt,
      `The trial must still be running: graceEndsAt ${String(
        licenseState.graceEndsAt,
      )} is not in the future. Found: ${found}`,
    ).toBeGreaterThan(now);

    /*
     * And it must be THIS trial, not some other date: the endpoint counts
     * ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS from the first time the stack
     * ran the Enterprise Edition, which for a stack booted minutes ago is
     * within the window (plus an hour of slack for a slow boot and clock
     * skew between the runner and the container).
     */
    const trialCeiling: number =
      now +
      ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS * MILLISECONDS_PER_DAY +
      60 * 60 * 1000;

    expect(
      graceEndsAt,
      `graceEndsAt ${String(licenseState.graceEndsAt)} is further away than a ` +
        `${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial started on this ` +
        `stack could be. Found: ${found}`,
    ).toBeLessThanOrEqual(trialCeiling);
  });

  test("an unauthenticated caller gets the public payload only", (): void => {
    /*
     * This route also serves the login page, so it answers without a session -
     * which is why the whole suite can probe it. It must still disclose
     * nothing a master admin alone may see: the stored token and key, the
     * instance id, and which version this server runs (telling an anonymous
     * caller that would advertise an unpatched target).
     */
    for (const field of MASTER_ADMIN_ONLY_LICENSE_FIELDS) {
      expect(
        Object.keys(licenseState.body),
        `${field} is a master-admin-only field and must not reach an unauthenticated caller`,
      ).not.toContain(field);
    }

    // The public fields the edition pill reads are all there.
    for (const field of [
      "edition",
      "status",
      "verification",
      "graceReason",
      "licenseValid",
      "features",
      "companyName",
      "expiresAt",
      "graceEndsAt",
      "isEvaluation",
    ]) {
      expect(Object.keys(licenseState.body)).toContain(field);
    }
  });
});
