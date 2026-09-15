import React, { useState, useEffect, useRef } from "react";
import { View, TextInput } from "react-native";
import { spacing } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { LoginResponse } from "../../api/auth";
import { getServerUrl } from "../../storage/serverUrl";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import AuthLayout, {
  AuthDivider,
  AuthLink,
  AuthNotice,
  AuthTextField,
  authPrimaryButtonStyle,
} from "../../components/AuthLayout";
import AppText from "../../components/AppText";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import IconBadge from "../../components/IconBadge";
import { getFriendlyErrorMessage } from "../../utils/error";
import { PasskeyProgress } from "../../passkeys/signIn";

type LoginNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "Login"
>;

export default function LoginScreen(): React.JSX.Element {
  const { login, loginWithPasskey, setNeedsServerUrl } = useAuth();
  const navigation: LoginNavigationProp = useNavigation<LoginNavigationProp>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const passwordInput: React.RefObject<TextInput | null> =
    useRef<TextInput>(null);
  const [serverUrl, setServerUrlState] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyProgress, setPasskeyProgress] =
    useState<PasskeyProgress | null>(null);
  const [passkeyNotice, setPasskeyNotice] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [showPasskeyHelp, setShowPasskeyHelp] = useState(false);
  const passkeyAttempt: React.MutableRefObject<AbortController | null> =
    useRef<AbortController | null>(null);
  const isPasskeyLoading: boolean = passkeyProgress !== null;

  useEffect(() => {
    let mounted: boolean = true;
    const refreshServerUrl: () => void = (): void => {
      void getServerUrl()
        .then((url: string): void => {
          if (mounted) {
            setServerUrlState(url);
          }
        })
        .catch((): void => {
          // A failed storage read should leave sign-in available for retry.
        });
    };
    refreshServerUrl();
    const removeFocus: (() => void) | undefined = navigation.addListener?.(
      "focus",
      refreshServerUrl,
    );
    const removeBlur: (() => void) | undefined = navigation.addListener?.(
      "blur",
      (): void => {
        passkeyAttempt.current?.abort();
        passkeyAttempt.current = null;
        setPasskeyProgress(null);
      },
    );
    return (): void => {
      mounted = false;
      removeFocus?.();
      removeBlur?.();
      passkeyAttempt.current?.abort();
      passkeyAttempt.current = null;
    };
  }, []);

  const handlePasskeyLogin: () => Promise<void> = async (): Promise<void> => {
    if (passkeyAttempt.current || isLoading) {
      return;
    }
    const attempt: AbortController = new AbortController();
    passkeyAttempt.current = attempt;
    setError(null);
    setPasskeyError(null);
    setPasskeyNotice(null);
    setPasskeyProgress("preparing");
    try {
      const response: LoginResponse | null = await loginWithPasskey({
        signal: attempt.signal,
        onProgress: (progress: PasskeyProgress): void => {
          if (passkeyAttempt.current === attempt && !attempt.signal.aborted) {
            setPasskeyProgress(progress);
          }
        },
      });
      if (passkeyAttempt.current === attempt && !response) {
        setPasskeyNotice(
          "Passkey sign-in canceled. You can try again or use another sign-in option.",
        );
      }
    } catch (err: unknown) {
      if (passkeyAttempt.current === attempt && !attempt.signal.aborted) {
        setPasskeyError(getFriendlyErrorMessage(err));
      }
    } finally {
      if (passkeyAttempt.current === attempt) {
        passkeyAttempt.current = null;
        setPasskeyProgress(null);
      }
    }
  };

  const handleCancelPasskey: () => void = (): void => {
    if (passkeyProgress === "verifying") {
      return;
    }
    passkeyAttempt.current?.abort();
    passkeyAttempt.current = null;
    setPasskeyProgress(null);
    setPasskeyNotice(
      "Passkey sign-in canceled. You can try again or use another sign-in option.",
    );
  };

  const handleLogin: () => Promise<void> = async (): Promise<void> => {
    if (passkeyAttempt.current || isLoading) {
      return;
    }
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const response: LoginResponse = await login(email.trim(), password);

      /*
       * Both of these used to be a dead end with an apology in it: "not yet
       * supported in the mobile app, please use the web dashboard". For an
       * on-call engineer that is the wrong answer at the worst possible time,
       * because the dashboard they are being sent to is the one with the
       * incident on it. Now they are screens.
       *
       * Enrolment is checked FIRST and the order is load-bearing: an account
       * being forced to enrol has no factors set up, so `totpAuthList` is
       * empty for it and the challenge screen would have nothing to offer.
       *
       * The credentials are already on the auth context by this point -- the
       * verify routes re-submit them, because no session exists until one of
       * them succeeds -- so neither navigation carries anything sensitive.
       */
      if (response.twoFactorEnrolmentRequired) {
        navigation.navigate("TwoFactorEnrolment");
        return;
      }

      if (response.twoFactorRequired) {
        navigation.navigate("TwoFactor");
      }
    } catch (err: unknown) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSSOLogin: () => void = (): void => {
    if (isPasskeyLoading || isLoading) {
      return;
    }
    navigation.navigate("SSOLogin");
  };

  const handleChangeServer: () => void = (): void => {
    if (passkeyProgress === "verifying" || isLoading) {
      return;
    }
    handleCancelPasskey();
    setNeedsServerUrl(true);
    navigation.navigate("ServerUrl");
  };

  const isBusy: boolean = isLoading || isPasskeyLoading;

  return (
    <AuthLayout
      showBrand
      compact
      title="Welcome back"
      description="Sign in to your workspace."
    >
      <View style={{ gap: spacing.lg }}>
        <AuthTextField
          label="Email"
          containerTestID="login-email-field"
          icon="mail-outline"
          accessibilityLabel="Email"
          value={email}
          editable={!isBusy}
          invalid={Boolean(error) && !email.trim()}
          onChangeText={(text: string) => {
            setEmail(text);
            setError(null);
          }}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => {
            passwordInput.current?.focus();
          }}
          submitBehavior="submit"
        />

        <AuthTextField
          inputRef={passwordInput}
          label="Password"
          containerTestID="login-password-field"
          icon="lock-closed-outline"
          accessibilityLabel="Password"
          revealable
          value={password}
          editable={!isBusy}
          invalid={Boolean(error) && !password.trim()}
          onChangeText={(text: string) => {
            setPassword(text);
            setError(null);
          }}
          placeholder="Your password"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="current-password"
          secureTextEntry
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />

        {error ? <AuthNotice tone="danger" message={error} /> : null}

        <GradientButton
          label="Sign In"
          onPress={handleLogin}
          loading={isLoading}
          disabled={isBusy}
          style={authPrimaryButtonStyle}
        />
      </View>

      {/*
       * Under the password button, where the web sign-in puts it and where
       * somebody who has just failed to remember their password is
       * already looking.
       */}
      <View style={{ marginTop: spacing.xs }}>
        <AuthLink
          label="Forgot password?"
          testID="forgot-password-link"
          disabled={isBusy}
          onPress={() => {
            navigation.navigate("ForgotPassword");
          }}
        />
      </View>

      <AuthDivider label="Other ways to sign in" />

      <View testID="alternative-sign-in" style={{ gap: spacing.md }}>
        <GradientButton
          testID="passkey-sign-in"
          label={
            passkeyProgress === "preparing"
              ? "Preparing passkey sign-in…"
              : passkeyProgress === "browser"
                ? "Continue in your browser…"
                : passkeyProgress === "verifying"
                  ? "Completing sign-in…"
                  : passkeyError || passkeyNotice
                    ? "Try passkey again"
                    : "Sign in with a passkey"
          }
          onPress={(): void => {
            void handlePasskeyLogin();
          }}
          loading={isPasskeyLoading}
          disabled={isBusy}
          icon="finger-print-outline"
          variant="secondary"
        />
        {isPasskeyLoading ? (
          <AuthNotice
            tone="info"
            live
            icon={
              passkeyProgress === "verifying"
                ? "checkmark-circle"
                : "finger-print-outline"
            }
            message={
              passkeyProgress === "preparing"
                ? "Preparing a secure sign-in…"
                : passkeyProgress === "browser"
                  ? "Choose your passkey in the browser, then return to OneUptime."
                  : "Passkey confirmed. Completing your sign-in…"
            }
          />
        ) : null}
        {isPasskeyLoading && passkeyProgress !== "verifying" ? (
          <AuthLink
            label="Cancel"
            accessibilityLabel="Cancel passkey sign-in"
            onPress={handleCancelPasskey}
          />
        ) : null}
        {passkeyError ? (
          <AuthNotice tone="danger" message={passkeyError} />
        ) : null}
        {passkeyNotice ? (
          <AuthNotice tone="neutral" live message={passkeyNotice} />
        ) : null}

        <GradientButton
          label="Sign in with SSO"
          onPress={handleSSOLogin}
          variant="secondary"
          icon="shield-checkmark-outline"
          disabled={isBusy}
        />
      </View>

      <View style={{ marginTop: spacing.xs }}>
        <AuthLink
          label="New to passkeys?"
          trailingIcon={showPasskeyHelp ? "chevron-up" : "chevron-down"}
          accessibilityState={{ expanded: showPasskeyHelp }}
          aria-expanded={showPasskeyHelp}
          onPress={(): void => {
            setShowPasskeyHelp(!showPasskeyHelp);
          }}
        />
      </View>
      {showPasskeyHelp ? (
        <Card variant="tinted" padding={spacing.lg}>
          <AppText variant="subhead" tone="secondary">
            Sign in on the OneUptime website with your password or SSO. In your
            profile, open Passkeys &amp; Two Factor Auth to add a passkey. Use
            that passkey here on the same server.
          </AppText>
        </Card>
      ) : null}

      <Card
        variant="outlined"
        testID="connected-server"
        style={{ marginTop: spacing.xxl }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          <IconBadge name="server-outline" size="sm" />
          <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
            <AppText variant="overline" tone="secondary">
              Connected server
            </AppText>
            {serverUrl ? (
              <AppText selectable variant="subhead" numberOfLines={2}>
                {serverUrl}
              </AppText>
            ) : null}
          </View>
        </View>
        <View
          style={{
            marginTop: spacing.sm,
            marginLeft: 30 + spacing.md,
          }}
        >
          <AuthLink
            label="Change Server"
            align="start"
            icon="swap-horizontal-outline"
            onPress={handleChangeServer}
            disabled={isLoading || passkeyProgress === "verifying"}
          />
        </View>
      </Card>
    </AuthLayout>
  );
}
