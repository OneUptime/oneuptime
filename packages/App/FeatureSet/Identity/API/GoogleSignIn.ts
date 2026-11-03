import { SignedUpWithGoogle } from "Common/Types/Marketing/Attribution";
import {
  GoogleSignInClientId,
  GoogleSignInClientSecret,
  Host,
  HttpProtocol,
} from "Common/Server/EnvironmentConfig";
import { ExpressRouter } from "Common/Server/Utils/Express";
import GoogleSignInClient, {
  GoogleSignInError,
} from "Common/Server/Utils/GoogleSignIn/GoogleSignInClient";
import createProviderSignInRouter from "../Utils/ProviderSignIn";

/*
 * Continue with Google (see GoogleSignInClient for what it is, and who it
 * will and will not sign in):
 *
 *   GET /identity/google/sign-in    sends the browser to Google
 *   GET /identity/google/callback   where Google sends it back
 *
 * Offered when this server has a Google OAuth client for it
 * (GOOGLE_SIGN_IN_CLIENT_ID / _SECRET; GoogleSignIn/RELEASING.md says how to
 * make one). The sign-in and sign-up pages show the button then; a server
 * without one offers nothing new.
 *
 * Whom it signs in, and what a new account keeps of where the visitor came
 * from, is every provider's sign-in's (../Utils/ProviderSignIn), the same as
 * Sign in with Microsoft's: the verified user with the account's address, or
 * a new one where sign-up is open - never an account with two-factor
 * authentication, nor a master admin's, which sign in with their password;
 * an unverified account is sent a verification link first.
 */

const router: ExpressRouter = createProviderSignInRouter({
  name: "Google",
  path: "google",
  signedUpWith: SignedUpWithGoogle,
  getClient: (): GoogleSignInClient | null => {
    if (!GoogleSignInClientId || !GoogleSignInClientSecret) {
      return null;
    }

    return new GoogleSignInClient({
      clientId: GoogleSignInClientId,
      clientSecret: GoogleSignInClientSecret,
      redirectUri: `${HttpProtocol}${Host}/identity/google/callback`,
    });
  },
  getUserMessage: (err: unknown): string | null => {
    return err instanceof GoogleSignInError ? err.userMessage : null;
  },
});

export default router;
