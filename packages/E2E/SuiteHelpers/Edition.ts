import { APIRequestContext, APIResponse, test } from "@playwright/test";

/*
 * Which edition a focused suite's fixture serves, and what an Enterprise
 * spec does about it.
 *
 * A fixture that bundles Enterprise pages (the Backups page, Enterprise
 * Licenses, custom roles) reaches them through the frontends' Enterprise
 * plugins when ee/ is checked out, and the Community stubs when it is not,
 * and says which at /edition.json. App Test's Dashboard Offline UI groups
 * remove ee/, so there an Enterprise spec skips. The Enterprise Edition
 * Test workflow's Enterprise UI job runs the same suites with ee/ and sets
 * E2E_REQUIRE_ENTERPRISE: there a spec that would skip fails instead, so a
 * fixture that stops finding ee/ cannot turn the job green by skipping every
 * test it was meant to run.
 */

export const REQUIRE_ENTERPRISE_VARIABLE: string = "E2E_REQUIRE_ENTERPRISE";

export type ReadFixtureEditionFunction = (
  request: APIRequestContext,
) => Promise<string>;

// "enterprise" or "community", as the fixture's /edition.json says.
export const readFixtureEdition: ReadFixtureEditionFunction = async (
  request: APIRequestContext,
): Promise<string> => {
  const response: APIResponse = await request.get("/edition.json");

  return ((await response.json()) as { edition: string }).edition;
};

export type IsEnterpriseRequiredFunction = () => boolean;

// Whether this run must have the Enterprise Edition (E2E_REQUIRE_ENTERPRISE).
export const isEnterpriseRequired: IsEnterpriseRequiredFunction =
  (): boolean => {
    const value: string = (
      process.env[REQUIRE_ENTERPRISE_VARIABLE] || ""
    ).trim();

    return value !== "" && value !== "0" && value !== "false";
  };

export type SkipUnlessEnterpriseFunction = (
  edition: string,
  reason: string,
) => void;

/*
 * Skips the running test (or every test of a hook) unless the fixture
 * serves the Enterprise Edition - and fails it instead where the run must
 * have that edition.
 */
export const skipUnlessEnterprise: SkipUnlessEnterpriseFunction = (
  edition: string,
  reason: string,
): void => {
  if (edition === "enterprise") {
    return;
  }

  if (isEnterpriseRequired()) {
    throw new Error(
      `${REQUIRE_ENTERPRISE_VARIABLE} is set, so this run must have the Enterprise Edition, but the fixture serves "${edition || "nothing"}". ${reason}`,
    );
  }

  test.skip(true, reason);
};
