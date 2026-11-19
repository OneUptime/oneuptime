import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { getTokens } from "../storage/keychain";
import { getServerUrl, hasServerUrl } from "../storage/serverUrl";
import {
  login as apiLogin,
  logout as apiLogout,
  verifyTotpAuth as apiVerifyTotpAuth,
  verifyBackupCode as apiVerifyBackupCode,
  verifyTotpEnrolment as apiVerifyTotpEnrolment,
  LoginResponse,
  TwoFactorMethod,
} from "../api/auth";
import { setOnAuthFailure } from "../api/client";
import type { SessionEndReason } from "../auth/sessionEnded";
import { queryClient } from "../api/queryClient";
import { unregisterPushToken } from "./pushTokenUtils";
import {
  clearAllSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
} from "../storage/ssoTokens";
import {
  consumeInitialSsoCallbackUrl,
  startSsoCallbackCapture,
  stopSsoCallbackCapture,
} from "../sso/deepLink";
import {
  completeSsoLoginFromUrl,
  type CompleteSsoLoginOutcome,
} from "../sso/session";
import { clearAllSsoDenials } from "../sso/ssoDenials";
import { clearAllProjectPermissions } from "../api/projectPermissions";
import {
  signInWithPasskey,
  discardPasskeySession,
  PasskeySignInOptions,
} from "../passkeys/signIn";
import {
  enrolPasskey as runPasskeyEnrolment,
  PasskeyEnrolmentOptions,
  PasskeyEnrolmentOutcome,
} from "../passkeys/enrol";
import { isPasskeyEnrolmentAvailable } from "../passkeys/enrolment";
import { Platform } from "react-native";

/**
 * A password step that succeeded and is waiting on a second factor.
 *
 * IT HOLDS THE PASSWORD, and that is why it lives here rather than in
 * navigation params. Every identity verify route re-submits the email and
 * password -- there is no session until the second step completes, so there is
 * nothing else to authenticate them with -- and React Navigation params are
 * serialized into navigation state, which is persisted, restored and logged by
 * developer tooling. This object is in memory, is never written to storage,
 * and is dropped the moment the login finishes or is abandoned.
 */
export interface PendingTwoFactor {
  email: string;
  password: string;

  /* The factors the challenge screen can offer. */
  totpAuthList: Array<TwoFactorMethod>;
  webAuthnList: Array<TwoFactorMethod>;

  /*
   * Unused recovery codes, or null for "the server did not say". Null is not
   * zero: zero is what makes the app tell the user they have no way in.
   */
  backupCodeCount: number | null;

  /* Set instead of the lists when the account is being forced to enrol. */
  enrolment?: {
    twoFactorAuthId: string;
    twoFactorOtpUrl: string;
    /*
     * Whether a passkey is offered beside the authenticator app (#9817):
     * the server offers one, it is reached over HTTPS, and this phone's
     * browser makes passkeys (passkeys/enrolment). Decided once, at the
     * password step, where the server's address is at hand.
     */
    canEnrolPasskey: boolean;
  };
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  needsServerUrl: boolean;
  user: LoginResponse["user"] | null;
  login: (email: string, password: string) => Promise<LoginResponse>;
  /*
   * Sign in with a passkey, in the phone's browser. `keepsPendingSignIn`:
   * started from a password's second step (#9817), whose challenge stays
   * until the passkey has signed the person in - so a canceled passkey
   * leaves them on the challenge they were on.
   */
  loginWithPasskey: (
    options: PasskeySignInOptions & { keepsPendingSignIn?: boolean },
  ) => Promise<LoginResponse | null>;
  logout: () => Promise<void>;
  setNeedsServerUrl: (value: boolean) => void;
  setIsAuthenticated: (value: boolean) => void;

  /*
   * Why the server ended the last session, when it said why: its length or
   * its idle timeout (auth/sessionEnded, issue #8381). The sign-in screen
   * says it above the form. Null after any other end - a sign-out, a
   * session signed out elsewhere - and from the next sign-in on.
   */
  sessionEndReason: SessionEndReason | null;

  /* The challenge in flight, or null when there is not one. */
  pendingTwoFactor: PendingTwoFactor | null;

  /*
   * Recovery codes waiting to be shown exactly once, in plaintext.
   *
   * Here rather than in navigation params for the same reason the password is:
   * these are sign-in credentials, and navigation params are serialized into
   * navigation state that tooling reads and persists. In memory, dropped the
   * moment the user acknowledges them.
   */
  pendingBackupCodes: Array<string> | null;

  /* Hand a freshly minted set to the screen that will display it. */
  showBackupCodes: (codes: Array<string>) => void;

  /*
   * The id of a user whose sign-in is finished but held for one more screen.
   * `user` is deliberately still null at that point -- publishing it is what
   * swaps the navigator -- so the held screens read the id from here.
   */
  pendingLoginUserId: string | null;

  /* Abandon it -- "sign in as a different user" from a challenge screen. */
  cancelTwoFactor: () => void;

  verifyTotpAuth: (data: {
    twoFactorAuthId: string;
    code: string;
  }) => Promise<LoginResponse>;
  verifyBackupCode: (data: { backupCode: string }) => Promise<LoginResponse>;
  verifyTotpEnrolment: (data: { code: string }) => Promise<LoginResponse>;

  /*
   * Finish that setup with a passkey instead (#9817, passkeys/enrol): in the
   * phone's browser, then saved with the password the challenge holds. On
   * "enrolled" the session is stored and the second step settled as the
   * authenticator app's is; "unsupported" means this browser cannot make
   * one, and the authenticator app is the way.
   */
  enrolPasskey: (
    options: PasskeyEnrolmentOptions,
  ) => Promise<PasskeyEnrolmentOutcome>;

  /*
   * Finish a login that was held back for one more screen -- the codes the
   * enrolment minted, or the offer to mint some. Kept separate from the verify
   * calls because the SESSION already exists by then: the tokens are stored
   * and the server considers the user signed in. All this does is let the app
   * navigate, which is what must not happen while a set of show-once codes is
   * still on screen.
   */
  completePendingLogin: () => void;
}

const AuthContext: React.Context<AuthContextValue | undefined> = createContext<
  AuthContextValue | undefined
>(undefined);

/*
 * Whether a required setup may offer a passkey beside the authenticator app
 * (#9817): the server offers one, it is reached over HTTPS, and this phone's
 * browser makes passkeys. A nicety, never a reason a sign-in fails: anything
 * that cannot be read is no offer, and the authenticator app is there.
 */
async function readCanEnrolPasskey(response: LoginResponse): Promise<boolean> {
  if (
    !response.twoFactorEnrolmentRequired ||
    response.passkeyEnrolmentOffered !== true
  ) {
    return false;
  }

  try {
    return isPasskeyEnrolmentAvailable({
      isOfferedByServer: true,
      serverUrl: await getServerUrl(),
      platform: { os: Platform.OS, version: Platform.Version },
    });
  } catch {
    return false;
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({
  children,
}: AuthProviderProps): React.JSX.Element {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [needsServerUrl, setNeedsServerUrl] = useState<boolean>(false);
  const [user, setUser] = useState<LoginResponse["user"] | null>(null);

  /*
   * In memory only, and deliberately not in a ref: the challenge screens
   * render from it, so a change has to re-render them.
   */
  const [pendingTwoFactor, setPendingTwoFactor] =
    useState<PendingTwoFactor | null>(null);

  /*
   * A user whose second step has completed but who is being held on the auth
   * stack for one more screen. `setIsAuthenticated(true)` swaps the whole
   * navigator, so calling it while show-once recovery codes are on screen
   * would replace them with the dashboard -- and those codes exist nowhere
   * else, ever.
   */
  const [heldUser, setHeldUser] = useState<LoginResponse["user"] | null>(null);

  const [pendingBackupCodes, setPendingBackupCodes] =
    useState<Array<string> | null>(null);

  const [sessionEndReason, setSessionEndReason] =
    useState<SessionEndReason | null>(null);

  /*
   * Said until the person is signed in again, however they sign in: a
   * password, a second factor, a passkey or single sign-on all end at the
   * authenticated navigator.
   */
  useEffect((): void => {
    if (isAuthenticated) {
      setSessionEndReason(null);
    }
  }, [isAuthenticated]);

  useEffect((): (() => void) => {
    /*
     * Start capturing `oneuptime://sso-callback` before anything else can
     * open a browser. The capture also drains the launch URL, which is how
     * the callback arrives when the OS killed the app while the user was at
     * their identity provider - common on Android under memory pressure.
     * Without this the completed login is simply lost.
     */
    startSsoCallbackCapture();

    const checkAuth: () => Promise<void> = async (): Promise<void> => {
      try {
        const hasUrl: boolean = await hasServerUrl();
        if (!hasUrl) {
          setNeedsServerUrl(true);
          setIsLoading(false);
          return;
        }

        /*
         * A callback waiting at launch means an SSO login completed while the
         * app was dead. Finish it here so the user lands signed in instead of
         * back on the login screen with no explanation.
         */
        const launchCallbackUrl: string | null =
          await consumeInitialSsoCallbackUrl();

        if (launchCallbackUrl) {
          const completed: CompleteSsoLoginOutcome =
            await completeSsoLoginFromUrl(launchCallbackUrl);

          if (completed.status === "success") {
            setIsAuthenticated(true);
            setIsLoading(false);
            return;
          }
        }

        const tokens: { accessToken: string; refreshToken: string } | null =
          await getTokens();
        if (tokens?.accessToken) {
          setIsAuthenticated(true);
        }

        // Initialize SSO token caches for the API client interceptor
        await getSsoTokens();
        await getGlobalSsoToken();
      } catch {
        // If anything fails, user needs to re-authenticate
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();

    return (): void => {
      stopSsoCallbackCapture();
    };
  }, []);

  // Register auth failure handler for 401 interceptor
  useEffect((): void => {
    setOnAuthFailure((reason: SessionEndReason | null): void => {
      setIsAuthenticated(false);
      setUser(null);

      /*
       * Why, when the server said why. An end that says nothing never
       * replaces one that did: the requests a screen had in flight when
       * the server ended the session come back refused one by one, with
       * nothing left to renew, after the refusal that said why.
       */
      if (reason) {
        setSessionEndReason(reason);
      }

      /*
       * The cache goes here too, for the same reason it goes on sign-out.
       *
       * This fires only after a refresh attempt failed and the client threw
       * the stored tokens away, so the session is over just as definitively as
       * if the user had pressed Sign out - and this is the MORE likely way the
       * next responder finds themselves at the login screen, because it is
       * what an app that sat in a pocket past its refresh token does on its
       * own. Leaving the cache behind here would mean the one sign-out path
       * nobody chooses is the one that hands the previous user's alerts,
       * incidents and internal notes to whoever signs in next.
       *
       * The cost of being wrong in this direction is a refetch: if a straggler
       * request from the dead session 401s after somebody has already signed
       * back in, that user loses cached rows they can fetch again. The cost of
       * the other direction is showing one account another account's data.
       */
      queryClient.clear();

      // And what the departing person may do, for the same reason.
      clearAllProjectPermissions();
    });
  }, []);

  const login: (email: string, password: string) => Promise<LoginResponse> =
    useCallback(
      async (email: string, password: string): Promise<LoginResponse> => {
        /*
         * Drop whatever challenge was parked before starting a new one.
         *
         * A pending challenge holds a PLAINTEXT PASSWORD, and until this line
         * existed it could outlive the attempt it belonged to: the two factor
         * screens are ordinary stack screens, so a swipe back to Login does
         * not run `cancelTwoFactor`, and the next person to sign in on that
         * handset would have had the previous account's password sitting in
         * memory behind their session. Clearing on the way IN covers every way
         * back to this screen, including the ones nobody has thought of yet.
         */
        setPendingTwoFactor(null);
        setHeldUser(null);
        setPendingBackupCodes(null);

        const response: LoginResponse = await apiLogin(email, password);

        if (response.twoFactorRequired) {
          const canEnrolPasskey: boolean = await readCanEnrolPasskey(response);

          /*
           * The credentials are carried forward because every verify route
           * re-submits them. They live here and nowhere else -- see
           * PendingTwoFactor.
           */
          setPendingTwoFactor({
            email,
            password,
            totpAuthList: response.totpAuthList || [],
            webAuthnList: response.webAuthnList || [],
            backupCodeCount:
              response.backupCodeCount === undefined
                ? null
                : response.backupCodeCount,
            ...(response.twoFactorEnrolmentRequired
              ? {
                  enrolment: {
                    twoFactorAuthId: response.twoFactorAuthId || "",
                    twoFactorOtpUrl: response.twoFactorOtpUrl || "",
                    canEnrolPasskey: canEnrolPasskey,
                  },
                }
              : {}),
          });

          return response;
        }

        if (response.accessToken) {
          setIsAuthenticated(true);
          setUser(response.user);
        }

        return response;
      },
      [],
    );

  const loginWithPasskey: (
    options: PasskeySignInOptions & { keepsPendingSignIn?: boolean },
  ) => Promise<LoginResponse | null> = useCallback(
    async (
      options: PasskeySignInOptions & { keepsPendingSignIn?: boolean },
    ): Promise<LoginResponse | null> => {
      const forgetPendingSignIn: () => void = (): void => {
        setPendingTwoFactor(null);
        setHeldUser(null);
        setPendingBackupCodes(null);
      };

      if (!options.keepsPendingSignIn) {
        forgetPendingSignIn();
      }
      const response: LoginResponse | null = await signInWithPasskey(options);
      if (response && options.signal.aborted) {
        await discardPasskeySession(response.accessToken);
        return null;
      }
      if (response) {
        // The passkey signed them in: the password's challenge is done with.
        forgetPendingSignIn();
        setUser(response.user);
        setIsAuthenticated(true);
      }
      return response;
    },
    [],
  );

  const cancelTwoFactor: () => void = useCallback((): void => {
    setPendingTwoFactor(null);
    setHeldUser(null);
    setPendingBackupCodes(null);
  }, []);

  /*
   * What every second step funnels through.
   *
   * The session is already stored by the time this runs -- the api layer does
   * that -- so the only decision left is whether the app may navigate. It may
   * NOT while there are show-once codes to hand over, and it may not when the
   * account has no recovery route and is being offered one. In both cases the
   * user is parked in `heldUser` and released by `completePendingLogin`.
   *
   * The pending challenge is cleared either way: the password it holds has
   * done its job, and keeping it alive past the login is keeping a plaintext
   * password in memory for no reason.
   */
  const settleSecondStep: (response: LoginResponse) => LoginResponse =
    useCallback((response: LoginResponse): LoginResponse => {
      /*
       * The guard comes FIRST. A verify that resolved without a session --
       * a server that answered 200 with no tokens, a proxy that stripped the
       * body -- has not signed anybody in, and clearing the challenge for it
       * would take the user's email, password and factor list with it. The
       * screen would then be showing a code box wired to a challenge that no
       * longer exists, and every further attempt would throw "there is no
       * sign-in waiting for a code": a dead end reached by an error the user
       * could otherwise just retry.
       */
      if (!response.accessToken) {
        return response;
      }

      setPendingTwoFactor(null);

      setHeldUser(response.user);

      if (response.backupCodes && response.backupCodes.length > 0) {
        setPendingBackupCodes(response.backupCodes);
      }

      return response;
    }, []);

  const showBackupCodes: (codes: Array<string>) => void = useCallback(
    (codes: Array<string>): void => {
      setPendingBackupCodes(codes);
    },
    [],
  );

  const completePendingLogin: () => void = useCallback((): void => {
    /*
     * Cleared BEFORE the navigator swaps. `setIsAuthenticated(true)` unmounts
     * the whole auth stack, and leaving the plaintext codes on the context
     * would keep them in memory for the life of the session for a screen that
     * no longer exists.
     */
    setPendingBackupCodes(null);

    setHeldUser((current: LoginResponse["user"] | null) => {
      if (current) {
        setUser(current);
        setIsAuthenticated(true);
      }

      return null;
    });
  }, []);

  const verifyTotpAuth: (data: {
    twoFactorAuthId: string;
    code: string;
  }) => Promise<LoginResponse> = useCallback(
    async (data: {
      twoFactorAuthId: string;
      code: string;
    }): Promise<LoginResponse> => {
      if (!pendingTwoFactor) {
        throw new Error("There is no sign-in waiting for a code.");
      }

      return settleSecondStep(
        await apiVerifyTotpAuth({
          email: pendingTwoFactor.email,
          password: pendingTwoFactor.password,
          twoFactorAuthId: data.twoFactorAuthId,
          code: data.code,
        }),
      );
    },
    [pendingTwoFactor, settleSecondStep],
  );

  const verifyBackupCode: (data: {
    backupCode: string;
  }) => Promise<LoginResponse> = useCallback(
    async (data: { backupCode: string }): Promise<LoginResponse> => {
      if (!pendingTwoFactor) {
        throw new Error("There is no sign-in waiting for a code.");
      }

      return settleSecondStep(
        await apiVerifyBackupCode({
          email: pendingTwoFactor.email,
          password: pendingTwoFactor.password,
          backupCode: data.backupCode,
        }),
      );
    },
    [pendingTwoFactor, settleSecondStep],
  );

  const verifyTotpEnrolment: (data: {
    code: string;
  }) => Promise<LoginResponse> = useCallback(
    async (data: { code: string }): Promise<LoginResponse> => {
      if (!pendingTwoFactor?.enrolment) {
        throw new Error("There is no two factor setup waiting to finish.");
      }

      return settleSecondStep(
        await apiVerifyTotpEnrolment({
          email: pendingTwoFactor.email,
          password: pendingTwoFactor.password,
          twoFactorAuthId: pendingTwoFactor.enrolment.twoFactorAuthId,
          code: data.code,
        }),
      );
    },
    [pendingTwoFactor, settleSecondStep],
  );

  const enrolPasskey: (
    options: PasskeyEnrolmentOptions,
  ) => Promise<PasskeyEnrolmentOutcome> = useCallback(
    async (
      options: PasskeyEnrolmentOptions,
    ): Promise<PasskeyEnrolmentOutcome> => {
      if (!pendingTwoFactor?.enrolment) {
        throw new Error("There is no two factor setup waiting to finish.");
      }

      const outcome: PasskeyEnrolmentOutcome = await runPasskeyEnrolment({
        ...options,
        email: pendingTwoFactor.email,
        password: pendingTwoFactor.password,
      });

      /*
       * Settled exactly as the authenticator app's is: the session is
       * stored already, and the codes the setup minted are held for the
       * one screen that shows them.
       */
      if (outcome.status === "enrolled") {
        settleSecondStep(outcome.response);
      }

      return outcome;
    },
    [pendingTwoFactor, settleSecondStep],
  );

  const logout: () => Promise<void> = useCallback(async (): Promise<void> => {
    await unregisterPushToken();
    await apiLogout();
    try {
      await clearAllSsoTokens();
    } catch {
      /*
       * The SSO store clears its memory caches before touching disk. A failed
       * removal must still let the user leave the account on this device.
       */
    }
    /*
     * The denial set is module-scope and in-memory, so without this a project
     * the previous user was refused would still read as "needs SSO" for
     * whoever signs in next on the same handset.
     */
    clearAllSsoDenials();

    /*
     * So are the departing person's permission rows: until the next person's
     * first answer replaced them, the cover sheet would follow the last
     * person's role.
     */
    clearAllProjectPermissions();

    /*
     * Everything the departing user's screens fetched is still sitting in the
     * shared react-query cache under keys that carry no account identity -
     * ["alerts", "all-projects"], ["incidents", projectId, ...] and the
     * internal notes hanging off them - and nothing else ever evicts it inside
     * a 24 hour gcTime. Hand the handset to the next responder on the rotation
     * and react-query serves them the previous user's rows instantly while the
     * refetch is still in flight; if the new account cannot see those projects
     * the refetch fails and the stale rows just stay on screen. Internal notes
     * are the worst of it.
     *
     * Cleared HERE, after the awaits, rather than at the top of logout: until
     * apiLogout has returned the old session is still valid and its screens
     * are still mounted, so a request that went out before the clear would
     * resolve after it and write the departing user's rows straight back in.
     * Cleared SYNCHRONOUSLY inside logout, and not from an effect watching
     * isAuthenticated, because the login screen is one render away - a clear
     * that lands late would empty the NEXT user's first page instead.
     */
    queryClient.clear();

    setIsAuthenticated(false);
    setUser(null);
    setPendingTwoFactor(null);
    setHeldUser(null);
    setPendingBackupCodes(null);

    /*
     * The person chose to sign out: the sign-in screen says nothing of a
     * reason, even when the server ended the session while the sign-out
     * waited for its renewal.
     */
    setSessionEndReason(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        needsServerUrl,
        user,
        login,
        loginWithPasskey,
        logout,
        setNeedsServerUrl,
        setIsAuthenticated,
        sessionEndReason,
        pendingTwoFactor,
        pendingBackupCodes,
        showBackupCodes,
        pendingLoginUserId: heldUser?._id || null,
        cancelTwoFactor,
        verifyTotpAuth,
        verifyBackupCode,
        verifyTotpEnrolment,
        enrolPasskey,
        completePendingLogin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context: AuthContextValue | undefined = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
