import React, { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { LoginResponse } from "../../api/auth";
import { getServerUrl } from "../../storage/serverUrl";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import AuthLayout from "../../components/AuthLayout";
import GradientButton from "../../components/GradientButton";
import { getFriendlyErrorMessage } from "../../utils/error";
import { PasskeyProgress } from "../../passkeys/signIn";

type LoginNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "Login"
>;

export default function LoginScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { login, loginWithPasskey, setNeedsServerUrl } = useAuth();
  const navigation: LoginNavigationProp = useNavigation<LoginNavigationProp>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordInput: React.RefObject<TextInput | null> =
    useRef<TextInput>(null);
  const [serverUrl, setServerUrlState] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
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

  return (
    <AuthLayout
      showBrand
      compact
      title="Welcome back"
      description="Sign in to your workspace."
    >
      <View>
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            marginBottom: 8,
            color: theme.colors.textSecondary,
          }}
        >
          Email
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: 56,
            borderRadius: 12,
            paddingHorizontal: 14,
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: 1.5,
            borderColor: emailFocused
              ? theme.colors.actionPrimary
              : theme.colors.borderDefault,
          }}
        >
          <Ionicons
            name="mail-outline"
            size={18}
            color={
              emailFocused
                ? theme.colors.actionPrimary
                : theme.colors.textTertiary
            }
            style={{ marginRight: 10 }}
          />
          <TextInput
            accessibilityLabel="Email"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 16,
              color: theme.colors.textPrimary,
            }}
            value={email}
            editable={!isLoading && !isPasskeyLoading}
            onChangeText={(text: string) => {
              setEmail(text);
              setError(null);
            }}
            onFocus={() => {
              return setEmailFocused(true);
            }}
            onBlur={() => {
              return setEmailFocused(false);
            }}
            placeholder="you@example.com"
            placeholderTextColor={theme.colors.textTertiary}
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
        </View>

        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            marginBottom: 8,
            marginTop: 12,
            color: theme.colors.textSecondary,
          }}
        >
          Password
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            minHeight: 56,
            borderRadius: 12,
            paddingHorizontal: 14,
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: 1.5,
            borderColor: passwordFocused
              ? theme.colors.actionPrimary
              : theme.colors.borderDefault,
          }}
        >
          <Ionicons
            name="lock-closed-outline"
            size={18}
            color={
              passwordFocused
                ? theme.colors.actionPrimary
                : theme.colors.textTertiary
            }
            style={{ marginRight: 10 }}
          />
          <TextInput
            ref={passwordInput}
            accessibilityLabel="Password"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 16,
              color: theme.colors.textPrimary,
            }}
            value={password}
            editable={!isLoading && !isPasskeyLoading}
            onChangeText={(text: string) => {
              setPassword(text);
              setError(null);
            }}
            onFocus={() => {
              return setPasswordFocused(true);
            }}
            onBlur={() => {
              return setPasswordFocused(false);
            }}
            placeholder="Your password"
            placeholderTextColor={theme.colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="current-password"
            secureTextEntry={!showPassword}
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={
              showPassword ? "Hide password" : "Show password"
            }
            onPress={() => {
              setShowPassword(!showPassword);
            }}
            style={{
              minWidth: 48,
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={theme.colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {error ? (
          <View
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              marginTop: 12,
            }}
          >
            <Ionicons
              name="alert-circle"
              size={14}
              color={theme.colors.statusError}
              style={{ marginRight: 6, marginTop: 2 }}
            />
            <Text
              style={{
                fontSize: 14,
                flex: 1,
                color: theme.colors.statusError,
              }}
            >
              {error}
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: 16 }}>
          <GradientButton
            label="Sign In"
            onPress={handleLogin}
            loading={isLoading}
            disabled={isLoading || isPasskeyLoading}
          />
        </View>
      </View>

      {/*
       * Under the password button, where the web sign-in puts it and where
       * somebody who has just failed to remember their password is
       * already looking.
       */}
      <TouchableOpacity
        accessibilityRole="button"
        testID="forgot-password-link"
        disabled={isLoading || isPasskeyLoading}
        onPress={() => {
          navigation.navigate("ForgotPassword");
        }}
        style={{
          marginTop: 8,
          minHeight: 48,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 14, color: theme.colors.actionPrimary }}>
          Forgot password?
        </Text>
      </TouchableOpacity>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          marginVertical: 16,
        }}
      >
        <View
          style={{
            flex: 1,
            height: 1,
            backgroundColor: theme.colors.borderSubtle,
          }}
        />
        <Text style={{ fontSize: 13, color: theme.colors.textTertiary }}>
          Other ways to sign in
        </Text>
        <View
          style={{
            flex: 1,
            height: 1,
            backgroundColor: theme.colors.borderSubtle,
          }}
        />
      </View>
      <View testID="alternative-sign-in" style={{ gap: 10 }}>
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
          disabled={isLoading || isPasskeyLoading}
          icon="finger-print-outline"
          variant="secondary"
        />
        {isPasskeyLoading ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              marginTop: 12,
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.textSecondary,
            }}
          >
            {passkeyProgress === "preparing"
              ? "Preparing a secure sign-in…"
              : passkeyProgress === "browser"
                ? "Choose your passkey in the browser, then return to OneUptime."
                : "Passkey confirmed. Completing your sign-in…"}
          </Text>
        ) : null}
        {isPasskeyLoading && passkeyProgress !== "verifying" ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cancel passkey sign-in"
            onPress={handleCancelPasskey}
            style={{
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 4,
            }}
          >
            <Text style={{ color: theme.colors.actionPrimary, fontSize: 14 }}>
              Cancel
            </Text>
          </TouchableOpacity>
        ) : null}
        {passkeyError ? (
          <Text
            accessibilityRole="alert"
            accessible
            accessibilityLiveRegion="polite"
            style={{
              marginTop: 12,
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.statusError,
            }}
          >
            {passkeyError}
          </Text>
        ) : null}
        {passkeyNotice ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              marginTop: 12,
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.textSecondary,
            }}
          >
            {passkeyNotice}
          </Text>
        ) : null}

        <GradientButton
          label="Sign in with SSO"
          onPress={handleSSOLogin}
          variant="secondary"
          icon="shield-checkmark-outline"
          disabled={isLoading || isPasskeyLoading}
        />
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: showPasskeyHelp }}
        aria-expanded={showPasskeyHelp}
        onPress={(): void => {
          setShowPasskeyHelp(!showPasskeyHelp);
        }}
        style={{
          minHeight: 48,
          justifyContent: "center",
          marginTop: 0,
        }}
      >
        <Text style={{ fontSize: 14, color: theme.colors.actionPrimary }}>
          New to passkeys?
        </Text>
      </TouchableOpacity>
      {showPasskeyHelp ? (
        <Text
          style={{
            fontSize: 14,
            lineHeight: 21,
            color: theme.colors.textSecondary,
          }}
        >
          Sign in on the OneUptime website with your password or SSO. In your
          profile, open Passkeys &amp; Two Factor Auth to add a passkey. Use
          that passkey here on the same server.
        </Text>
      ) : null}

      <View
        style={{
          marginTop: 20,
          paddingTop: 16,
          borderTopWidth: 1,
          borderTopColor: theme.colors.borderSubtle,
        }}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: theme.colors.textTertiary,
            letterSpacing: 1,
          }}
        >
          CONNECTED SERVER
        </Text>
        {serverUrl ? (
          <Text
            selectable
            style={{
              marginTop: 6,
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.textSecondary,
            }}
          >
            {serverUrl}
          </Text>
        ) : null}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Change Server"
          onPress={handleChangeServer}
          disabled={isLoading || passkeyProgress === "verifying"}
          style={{
            minHeight: 48,
            justifyContent: "center",
            alignSelf: "flex-start",
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.actionPrimary,
            }}
          >
            Change Server
          </Text>
        </TouchableOpacity>
      </View>
    </AuthLayout>
  );
}
