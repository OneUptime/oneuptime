import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { getTokens } from "../storage/keychain";
import { hasServerUrl } from "../storage/serverUrl";
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
  };
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  needsServerUrl: boolean;
  user: LoginResponse["user"] | null;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  setNeedsServerUrl: (value: boolean) => void;
  setIsAuthenticated: (value: boolean) => void;

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
    setOnAuthFailure((): void => {
      setIsAuthenticated(false);
      setUser(null);
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

  const logout: () => Promise<void> = useCallback(async (): Promise<void> => {
    await unregisterPushToken();
    await apiLogout();
    await clearAllSsoTokens();
    /*
     * The denial set is module-scope and in-memory, so without this a project
     * the previous user was refused would still read as "needs SSO" for
     * whoever signs in next on the same handset.
     */
    clearAllSsoDenials();
    setIsAuthenticated(false);
    setUser(null);
    setPendingTwoFactor(null);
    setHeldUser(null);
    setPendingBackupCodes(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        needsServerUrl,
        user,
        login,
        logout,
        setNeedsServerUrl,
        setIsAuthenticated,
        pendingTwoFactor,
        pendingBackupCodes,
        showBackupCodes,
        pendingLoginUserId: heldUser?._id || null,
        cancelTwoFactor,
        verifyTotpAuth,
        verifyBackupCode,
        verifyTotpEnrolment,
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
