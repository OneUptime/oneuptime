/*
 * SsoRequiredSignIn (Common/Server/Utils/SsoRequiredSignIn) as a server that
 * does not require single sign-on: every sign-in and sign-up may go ahead.
 *
 * Every sign-in that is not SSO - a password and its second steps, a
 * passkey, the mobile app's passkey exchange - and every sign-up asks it
 * first, and the real one reads GlobalConfig, which the suites about
 * something else have no database for. They stand it in with this:
 *
 *   jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
 *     return jest
 *       .requireActual<typeof import("./SsoNotRequiredStandIn")>(
 *         "./SsoNotRequiredStandIn",
 *       )
 *       .ssoNotRequired();
 *   });
 *
 * SsoRequiredSignInRoutes.test.ts drives the real one, with the server
 * requiring SSO and not.
 */

export interface SsoRequiredSignInModule {
  __esModule: true;
  default: {
    isNonSsoSignInRefused: () => Promise<boolean>;
    assertNonSsoSignInAllowed: () => Promise<void>;
    isSsoRequired: () => Promise<boolean>;
    assertSignUpAllowed: () => Promise<void>;
  };
}

export const ssoNotRequired: () => SsoRequiredSignInModule =
  (): SsoRequiredSignInModule => {
    return {
      __esModule: true,
      default: {
        isNonSsoSignInRefused: (): Promise<boolean> => {
          return Promise.resolve(false);
        },
        assertNonSsoSignInAllowed: (): Promise<void> => {
          return Promise.resolve();
        },
        isSsoRequired: (): Promise<boolean> => {
          return Promise.resolve(false);
        },
        assertSignUpAllowed: (): Promise<void> => {
          return Promise.resolve();
        },
      },
    };
  };
