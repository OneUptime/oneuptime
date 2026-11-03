import { SignedUpWithMicrosoft } from "Common/Types/Marketing/Attribution";
import {
  Host,
  HttpProtocol,
  MicrosoftSignInClientId,
  MicrosoftSignInClientSecret,
} from "Common/Server/EnvironmentConfig";
import { ExpressRouter } from "Common/Server/Utils/Express";
import MicrosoftSignInClient, {
  MicrosoftSignInError,
} from "Common/Server/Utils/MicrosoftSignIn/MicrosoftSignInClient";
import createProviderSignInRouter from "../Utils/ProviderSignIn";

/*
 * Sign in with Microsoft (see MicrosoftSignInClient for what it is, and who
 * it will and will not sign in):
 *
 *   GET /identity/microsoft/sign-in    sends the browser to Microsoft
 *   GET /identity/microsoft/callback   where Microsoft sends it back
 *
 * Offered when this server has a Microsoft Entra app for it
 * (MICROSOFT_SIGN_IN_CLIENT_ID / _SECRET). The sign-in page shows the button
 * then, and Microsoft Marketplace buyers who are not signed in are sent
 * straight here from the landing page.
 *
 * Whom it signs in, and what a new account keeps of where the visitor came
 * from, is every provider's sign-in's (../Utils/ProviderSignIn): the
 * verified user with the account's address, or a new one where sign-up is
 * open - never an account with two-factor authentication, nor a master
 * admin's, which sign in with their password; an unverified account is sent
 * a verification link first.
 */

const router: ExpressRouter = createProviderSignInRouter({
  name: "Microsoft",
  path: "microsoft",
  signedUpWith: SignedUpWithMicrosoft,
  getClient: (): MicrosoftSignInClient | null => {
    if (!MicrosoftSignInClientId || !MicrosoftSignInClientSecret) {
      return null;
    }

    return new MicrosoftSignInClient({
      clientId: MicrosoftSignInClientId,
      clientSecret: MicrosoftSignInClientSecret,
      redirectUri: `${HttpProtocol}${Host}/identity/microsoft/callback`,
    });
  },
  getUserMessage: (err: unknown): string | null => {
    return err instanceof MicrosoftSignInError ? err.userMessage : null;
  },
});

export default router;
