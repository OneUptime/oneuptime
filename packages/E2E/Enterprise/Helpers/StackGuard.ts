import { IS_BILLING_ENABLED } from "../../Config";
import {
  StackFrontendEnvironment,
  describeStackFrontendEnvironment,
  fetchStackFrontendEnvironment,
} from "./FrontendEnvironment";
import {
  EnterpriseLicenseState,
  describeEnterpriseLicenseState,
  fetchEnterpriseLicenseState,
  waitForEnterpriseLicenseState,
} from "./LicenseState";
import { APIRequestContext } from "@playwright/test";

/*
 * The shared precondition of every enterprise e2e spec: this run is pointed at
 * the stack it was written for, and it FAILS LOUDLY when it is not.
 *
 * Not test.skip(). Skipping is right for a spec that lives in the shared
 * ./Tests tree, which runs in all three full-stack jobs and must stay quiet on
 * the stacks it does not apply to. These specs are the opposite: they exist
 * only because the enterprise job boots a stack nothing else boots, and a
 * silent skip there would turn the whole point of the job - "the published
 * enterprise image really serves SSO, SCIM and audit logging with billing off"
 * - into a green tick that proved nothing. A misconfigured job must be as red
 * as a broken image.
 *
 * Every message names the stack that answered AND the stack the suite wanted,
 * because the three stacks differ only in their image tag and one environment
 * variable, and the operator reading the failure has to know which of the two
 * to change.
 */

export interface EnterpriseStackExpectation {
  // Names the suite in failure messages ("Licensed", "Lapsed").
  name: string;
  // The stack the suite needs, in the words an operator would use.
  summary: string;
  /*
   * The licence state the suite is written against: the Licensed suite needs a
   * usable licence (a fresh install inside its 14-day trial, or a real licence
   * installed), the Lapsed suite needs an unusable one.
   */
  requireLicenseValid: boolean;
  /*
   * How long to keep polling when the edition is right but licenseValid is
   * not yet. Only the lapse transition needs this: the app notices a backdated
   * GlobalConfig.enterpriseEditionFirstSeenAt without a restart, but only
   * after its 60s licence-inputs cache turns over. Zero for the Licensed
   * suite, where nothing is in flight and waiting would only delay a red.
   */
  licenseValidPollTimeoutMs: number;
  // The npm script that runs this suite, quoted back in failure messages.
  runCommand: string;
}

export const LICENSED_ENTERPRISE_STACK: EnterpriseStackExpectation = {
  name: "Licensed",
  summary:
    "a self-hosted ENTERPRISE stack with billing OFF whose licence is usable " +
    "(a fresh install inside its 14-day trial: status=grace, graceReason=unlicensed; " +
    "or status=valid once a licence is installed)",
  requireLicenseValid: true,
  licenseValidPollTimeoutMs: 0,
  runCommand: "npm run test-enterprise-licensed",
};

export const LAPSED_ENTERPRISE_STACK: EnterpriseStackExpectation = {
  name: "Lapsed",
  summary:
    "a self-hosted ENTERPRISE stack with billing OFF whose licence has LAPSED " +
    "(licenseValid=false - the trial was forced to end by backdating " +
    "GlobalConfig.enterpriseEditionFirstSeenAt; see packages/E2E/README.md)",
  requireLicenseValid: false,
  /*
   * 4 minutes: the 60s licence-inputs cache, plus the background reload the
   * synchronous snapshot kicks off, plus room for a loaded CI runner.
   */
  licenseValidPollTimeoutMs: 240000,
  runCommand: "npm run test-enterprise-lapsed",
};

type AssertEnterpriseStackFunction = (data: {
  expectation: EnterpriseStackExpectation;
  request?: APIRequestContext | undefined;
}) => Promise<EnterpriseLicenseState>;

/*
 * Checks the three things that make a stack the right one, cheapest and most
 * decisive first, and returns the licence state so a spec need not read it
 * twice.
 */
export const assertEnterpriseStack: AssertEnterpriseStackFunction =
  async (data: {
    expectation: EnterpriseStackExpectation;
    request?: APIRequestContext | undefined;
  }): Promise<EnterpriseLicenseState> => {
    const expectation: EnterpriseStackExpectation = data.expectation;
    const requestOptions: { request?: APIRequestContext | undefined } =
      data.request ? { request: data.request } : {};

    const wanted: string = `The ${expectation.name} enterprise suite (${expectation.runCommand}) needs ${expectation.summary}.`;

    // 1. Billing, as the STACK reports it: it decides what the licence means.
    const frontendEnvironment: StackFrontendEnvironment =
      await fetchStackFrontendEnvironment(requestOptions);

    if (frontendEnvironment.billingEnabled) {
      throw new Error(
        `${wanted} The stack under test runs with BILLING_ENABLED=true, where the ` +
          `subscription plan decides enterprise access and the licence decides nothing ` +
          `(EditionPermissions and the audit recorder both defer to the plan). ` +
          `Found: ${describeStackFrontendEnvironment(frontendEnvironment)}.`,
      );
    }

    /*
     * The harness's own BILLING_ENABLED must agree with the stack's: the shared
     * onboarding helper fills the billing-only signup fields and walks the plan
     * step when its copy says billing is on, so a disagreement hangs the UI spec
     * on a form that is not there rather than failing with a reason.
     */
    if (IS_BILLING_ENABLED) {
      throw new Error(
        `${wanted} This run was started with BILLING_ENABLED=true while the stack ` +
          `reports BILLING_ENABLED=false. Export BILLING_ENABLED=false for the ` +
          `enterprise suites.`,
      );
    }

    if (frontendEnvironment.enterpriseEditionRequestedButNotLoaded) {
      throw new Error(
        `${wanted} The stack was ASKED for the Enterprise Edition but its enterprise ` +
          `module did not load, so it is serving the Community Edition: the identity ` +
          `routes are not mounted and the Dashboard ships no enterprise screens. ` +
          `This is an image problem, not a test problem - check that APP_TAG is an ` +
          `enterprise-* tag. Found: ${describeStackFrontendEnvironment(
            frontendEnvironment,
          )}.`,
      );
    }

    // 2. The edition. Immutable for a booted stack, so a mismatch fails at once.
    const state: EnterpriseLicenseState =
      await fetchEnterpriseLicenseState(requestOptions);

    if (state.edition !== "enterprise") {
      throw new Error(
        `${wanted} The stack under test is the COMMUNITY Edition, where none of ` +
          `these routes or screens exist at all (they answer 404). Found: ` +
          `${describeEnterpriseLicenseState(state)}.`,
      );
    }

    if (!frontendEnvironment.isEnterpriseEdition) {
      throw new Error(
        `${wanted} The licence endpoint reports the Enterprise Edition but the ` +
          `Dashboard's env.js reports IS_ENTERPRISE_EDITION=false, so the two halves ` +
          `of the stack disagree about the edition. Found: ` +
          `${describeStackFrontendEnvironment(
            frontendEnvironment,
          )} / ${describeEnterpriseLicenseState(state)}.`,
      );
    }

    // 3. The licence. Polled only where a transition is genuinely in flight.
    if (state.licenseValid === expectation.requireLicenseValid) {
      return state;
    }

    if (expectation.licenseValidPollTimeoutMs > 0) {
      return waitForEnterpriseLicenseState({
        ...requestOptions,
        description: `the Enterprise licence to become ${
          expectation.requireLicenseValid ? "usable" : "unusable"
        } (licenseValid=${String(expectation.requireLicenseValid)})`,
        timeoutMs: expectation.licenseValidPollTimeoutMs,
        isReady: (polled: EnterpriseLicenseState): boolean => {
          return polled.licenseValid === expectation.requireLicenseValid;
        },
      });
    }

    throw new Error(
      `${wanted} The stack under test is the Enterprise Edition, but its licence is ` +
        `${state.licenseValid ? "still usable" : "not usable"} - so this is the ` +
        `${state.licenseValid ? "LICENSED" : "LAPSED"} stack and the ${
          expectation.name
        } suite is the wrong one to run against it. Found: ` +
        `${describeEnterpriseLicenseState(state)}.`,
    );
  };

type AssertStackFunction = (data?: {
  request?: APIRequestContext | undefined;
}) => Promise<EnterpriseLicenseState>;

// Call from a beforeAll hook in every spec under Enterprise/Licensed.
export const assertLicensedEnterpriseStack: AssertStackFunction =
  async (data?: {
    request?: APIRequestContext | undefined;
  }): Promise<EnterpriseLicenseState> => {
    return assertEnterpriseStack({
      expectation: LICENSED_ENTERPRISE_STACK,
      ...(data?.request ? { request: data.request } : {}),
    });
  };

// Call from a beforeAll hook in every spec under Enterprise/Lapsed.
export const assertLapsedEnterpriseStack: AssertStackFunction = async (data?: {
  request?: APIRequestContext | undefined;
}): Promise<EnterpriseLicenseState> => {
  return assertEnterpriseStack({
    expectation: LAPSED_ENTERPRISE_STACK,
    ...(data?.request ? { request: data.request } : {}),
  });
};
