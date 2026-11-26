import { describe, expect, test } from "@jest/globals";
import {
  ReauthenticationStatus,
  SignInAgainProvider,
  readReauthenticationStatus,
  reauthenticationStatusToJSON,
} from "../../../Types/Accounts/Reauthentication";

/*
 * A SESSION THAT SIGNED IN WITH VERCEL, AS THE SERVER SAYS IT AND THE
 * PROMPT READS IT (#10331): GET /api/user/reauthentication's answer names
 * Vercel, so the prompt can say that Vercel cannot confirm it's them, and
 * offer what does; with no route of Vercel's to go back through.
 */

function status(
  provider: SignInAgainProvider,
  canUseSignInLink: boolean,
): ReauthenticationStatus {
  return {
    isConfirmed: false,
    confirmedUntil: null,
    windowInMinutes: 10,
    methods: {
      password: false,
      secondStep: null,
      passkey: false,
      signInAgain: true,
    },
    signInAgain: {
      route: null,
      provider: provider,
      providerName: "Vercel",
      refusal: null,
      canUseSignInLink: canUseSignInLink,
    },
  };
}

describe("a Vercel session's status, sent and read back", () => {
  test.each([[true], [false]])(
    "keeps that it signed in with Vercel, and whether a sign-in link stands in (%s)",
    (canUseSignInLink: boolean) => {
      const sent: ReauthenticationStatus = status(
        SignInAgainProvider.Vercel,
        canUseSignInLink,
      );

      expect(
        readReauthenticationStatus(
          JSON.parse(JSON.stringify(reauthenticationStatusToJSON(sent))),
        ),
      ).toEqual(sent);
    },
  );

  test("a provider the prompt does not know is read as the sign-in page, never as Vercel", () => {
    const read: ReauthenticationStatus | null = readReauthenticationStatus({
      ...reauthenticationStatusToJSON(status(SignInAgainProvider.Vercel, true)),
      signInAgain: {
        route: null,
        provider: "SomethingElse",
        providerName: "Vercel",
        refusal: null,
        canUseSignInLink: true,
      },
    });

    expect(read?.signInAgain?.provider).toBe(SignInAgainProvider.SignInPage);
  });

  test("a route sent beside Vercel is kept only as a path under Identity's address", () => {
    const read: ReauthenticationStatus | null = readReauthenticationStatus({
      ...reauthenticationStatusToJSON(status(SignInAgainProvider.Vercel, true)),
      signInAgain: {
        route: "https://vercel.com/sso/integrations/oneuptime/icfg_1",
        provider: SignInAgainProvider.Vercel,
        providerName: "Vercel",
        refusal: null,
        canUseSignInLink: true,
      },
    });

    expect(read?.signInAgain?.route).toBeNull();
    expect(read?.signInAgain?.provider).toBe(SignInAgainProvider.Vercel);
  });
});
