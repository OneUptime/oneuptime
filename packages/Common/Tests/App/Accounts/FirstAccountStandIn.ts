/*
 * The register page's question to a self-hosted server (App/FeatureSet/
 * Accounts/src/Utils/FirstAccount): is it waiting for its first account?
 * Here a server that has accounts, answered at once, so the page draws its
 * form on its first render, as the suites about something else expect. The
 * page draws nothing of its own until the answer lands, and these suites do
 * not run a server to answer the real request.
 *
 *   jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/FirstAccount", () => {
 *     return (
 *       jest.requireActual(
 *         "./FirstAccountStandIn",
 *       ) as typeof import("./FirstAccountStandIn")
 *     ).serverWithAccounts();
 *   });
 *
 * RegisterSelfHosted.test.tsx drives the real request.
 */

export interface FirstAccountModuleStandIn {
  __esModule: true;
  fetchIsAwaitingFirstAccount: () => Promise<boolean>;
  default: () => Promise<boolean>;
}

export const serverWithAccounts: () => FirstAccountModuleStandIn =
  (): FirstAccountModuleStandIn => {
    const answer: () => Promise<boolean> = (): Promise<boolean> => {
      return Promise.resolve(false);
    };

    return {
      __esModule: true,
      fetchIsAwaitingFirstAccount: answer,
      default: answer,
    };
  };
