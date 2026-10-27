import { SignInMethods } from "../../../Types/SSO/SignInMethods";

/*
 * The Accounts pages' read of how the server signs people in
 * (App/FeatureSet/Accounts/src/Utils/SignInMethods), as a server that does
 * not require single sign-on and has no instance-wide provider - answered at
 * once, so a page draws on its first render, as the suites about something
 * else expect. The sign-in, single sign-on and sign-up pages read it before
 * drawing anything of their own, over the network.
 *
 *   jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/SignInMethods", () => {
 *     return (
 *       jest.requireActual(
 *         "./SignInMethodsStandIn",
 *       ) as typeof import("./SignInMethodsStandIn")
 *     ).signInMethodsNotRequired();
 *   });
 *
 * LoginSsoRequired.test.tsx drives the real read, the server requiring SSO
 * and not.
 */

export const SSO_NOT_REQUIRED: SignInMethods = {
  isSsoRequired: false,
  ssoProviders: [],
  hasProjectSsoProviders: false,
};

export interface SignInMethodsModuleStandIn {
  __esModule: true;
  readSignInMethods: () => Promise<SignInMethods | null>;
  useSignInMethods: (known?: SignInMethods | undefined) => {
    signInMethods: SignInMethods | null;
    isReading: boolean;
    readAgain: () => void;
  };
}

export const signInMethodsNotRequired: () => SignInMethodsModuleStandIn =
  (): SignInMethodsModuleStandIn => {
    return {
      __esModule: true,
      readSignInMethods: (): Promise<SignInMethods | null> => {
        return Promise.resolve(SSO_NOT_REQUIRED);
      },
      useSignInMethods: (
        known?: SignInMethods | undefined,
      ): {
        signInMethods: SignInMethods | null;
        isReading: boolean;
        readAgain: () => void;
      } => {
        return {
          signInMethods: known || SSO_NOT_REQUIRED,
          isReading: false,
          readAgain: (): void => {
            return undefined;
          },
        };
      },
    };
  };
