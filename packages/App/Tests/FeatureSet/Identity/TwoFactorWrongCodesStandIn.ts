import { TwoFactorCodeCheck } from "Common/Server/Utils/TwoFactorWrongCodes";

/*
 * A stand-in for the account's count of wrong two factor codes
 * (Common/Server/Utils/TwoFactorWrongCodes), for the identity suites that are
 * about something else: what a code is checked against, which factor signs
 * in, what a response carries. It lets every code through to its check and
 * counts nothing, so those suites run without a Valkey and read as they did.
 *
 * The count itself - five wrong codes, the waits, the owner's email, what
 * is held and what is not - is TwoFactorWrongCodesSignIn.test.ts, through the
 * real routes and a real Valkey.
 *
 * For a jest.mock factory:
 *
 *   jest.mock("Common/Server/Utils/TwoFactorWrongCodes", () => {
 *     return require("./TwoFactorWrongCodesStandIn").letEveryCodeBeChecked();
 *   });
 */
export function letEveryCodeBeChecked(): Record<string, unknown> {
  const actual: Record<string, unknown> & {
    default: Record<string, unknown>;
  } = jest.requireActual("Common/Server/Utils/TwoFactorWrongCodes");

  const allowed: TwoFactorCodeCheck = {
    outcome: (
      actual["TwoFactorCodeCheckOutcome"] as Record<string, string>
    )["Allowed"] as TwoFactorCodeCheck["outcome"],
    wrongCodesInARow: 1,
    waitSeconds: 0,
  };

  return {
    ...actual,
    __esModule: true,
    default: {
      startCheck: (): Promise<TwoFactorCodeCheck> => {
        return Promise.resolve({ ...allowed });
      },
      forget: (): Promise<void> => {
        return Promise.resolve();
      },
      shouldTellOwner: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      getWaitingMessage: actual.default["getWaitingMessage"],
      describeWait: actual.default["describeWait"],
    },
  };
}
