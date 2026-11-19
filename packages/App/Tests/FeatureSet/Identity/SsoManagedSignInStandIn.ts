/*
 * SsoManagedSignIn (Common/Server/Utils/SsoManagedSignIn) as a server where
 * single sign-on manages nobody's sign-in: everyone may set up a second step
 * at sign-in, claim an invited account with a password, and be mailed a
 * password reset link.
 *
 * The real one reads the server's Require SSO to Sign In and, since #9763,
 * every project the person belongs to - their memberships and each project's
 * sign-in rule - which the suites about something else have no database for.
 * They stand it in with this:
 *
 *   jest.mock("Common/Server/Utils/SsoManagedSignIn", () => {
 *     return (
 *       jest.requireActual(
 *         "./SsoManagedSignInStandIn",
 *       ) as typeof import("./SsoManagedSignInStandIn")
 *     ).ssoManagesNobody();
 *   });
 *
 * SignInMatrixSsoAndTwoFactor.test.ts and ForgotPasswordSsoManaged.test.ts
 * drive the real one, with the server and each project requiring SSO or
 * not; SsoManagedSignInAtSignIn.test.ts and SecurityKeyEnrolmentSignIn
 * .test.ts drive the sign-in routes with it managing someone.
 */

// The person's state, as the real rule answers it: managed by nobody.
const NOT_MANAGED: {
  managedBy: null;
  managingProjects: Array<never>;
  otherProjects: Array<never>;
} = {
  managedBy: null,
  managingProjects: [],
  otherProjects: [],
};

export interface SsoManagedSignInModule {
  __esModule: true;
  default: {
    getStateFor: () => Promise<typeof NOT_MANAGED>;
    getState: () => Promise<typeof NOT_MANAGED>;
    getManagedBy: () => Promise<null>;
    isManagedBySsoFor: () => Promise<boolean>;
    isManagedBySso: () => Promise<boolean>;
    assertMayChangeLocalSignIn: () => Promise<void>;
    assertMayChangeLocalSignInFor: () => Promise<void>;
    getSignInManagement: () => Promise<{
      isManagedBySso: boolean;
      ssoProviderNames: Array<string>;
      localSignInProjectNames: Array<string>;
    }>;
  };
}

export const ssoManagesNobody: () => SsoManagedSignInModule =
  (): SsoManagedSignInModule => {
    return {
      __esModule: true,
      default: {
        getStateFor: (): Promise<typeof NOT_MANAGED> => {
          return Promise.resolve(NOT_MANAGED);
        },
        getState: (): Promise<typeof NOT_MANAGED> => {
          return Promise.resolve(NOT_MANAGED);
        },
        getManagedBy: (): Promise<null> => {
          return Promise.resolve(null);
        },
        isManagedBySsoFor: (): Promise<boolean> => {
          return Promise.resolve(false);
        },
        isManagedBySso: (): Promise<boolean> => {
          return Promise.resolve(false);
        },
        assertMayChangeLocalSignIn: (): Promise<void> => {
          return Promise.resolve();
        },
        assertMayChangeLocalSignInFor: (): Promise<void> => {
          return Promise.resolve();
        },
        getSignInManagement: (): Promise<{
          isManagedBySso: boolean;
          ssoProviderNames: Array<string>;
          localSignInProjectNames: Array<string>;
        }> => {
          return Promise.resolve({
            isManagedBySso: false,
            ssoProviderNames: [],
            localSignInProjectNames: [],
          });
        },
      },
    };
  };
