import React, { useState } from "react";
import { View, Platform, Linking } from "react-native";
import { radius, spacing, useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { LoginResponse } from "../../api/auth";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import AuthLayout, {
  AuthLink,
  AuthNotice,
  AuthStep,
  AuthTextField,
  authPrimaryButtonStyle,
} from "../../components/AuthLayout";
import AppText from "../../components/AppText";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import { getFriendlyErrorMessage } from "../../utils/error";
import {
  decideTwoFactorFollowUp,
  TwoFactorFollowUp,
} from "../../auth/twoFactorFollowUp";
import { secretFromOtpUrl } from "../../auth/otpUrl";

/*
 * Finishing a two factor setup an administrator made mandatory.
 *
 * The web sign-in draws a QR code here. A phone cannot scan its own screen, so
 * copying that would be the one presentation guaranteed not to work on the
 * device this runs on. What works on a handset is the otpauth:// URL itself:
 * tapping it hands the enrolment straight to whichever authenticator app is
 * installed, already filled in. The secret is printed underneath for the user
 * whose authenticator lives on a different device, or who prefers to type it.
 *
 * NO SESSION EXISTS ON THIS SCREEN. The user has proved their password and
 * nothing else; the server issues a session only when the code below verifies.
 * That is why the request re-submits the credentials, and why abandoning this
 * screen has to drop them.
 */

type EnrolmentNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "TwoFactorEnrolment"
>;

export default function TwoFactorEnrolmentScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const {
    pendingTwoFactor,
    verifyTotpEnrolment,
    cancelTwoFactor,
    completePendingLogin,
  } = useAuth();
  const navigation: EnrolmentNavigationProp =
    useNavigation<EnrolmentNavigationProp>();

  const [code, setCode] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Where the current error belongs. A link that no app could open is a step
   * one problem and is shown beside the setup key; anything else is about the
   * code, and outlines the code field.
   */
  const [isOpenError, setIsOpenError] = useState<boolean>(false);
  const [didOpenAuthenticator, setDidOpenAuthenticator] =
    useState<boolean>(false);

  const otpUrl: string = pendingTwoFactor?.enrolment?.twoFactorOtpUrl || "";
  const secret: string = secretFromOtpUrl(otpUrl);

  const openInAuthenticator: () => Promise<void> = async (): Promise<void> => {
    if (!otpUrl) {
      return;
    }

    try {
      await Linking.openURL(otpUrl);
      setDidOpenAuthenticator(true);
    } catch {
      /*
       * No app on the handset claims otpauth://. Not an error worth
       * interrupting the flow for -- the secret is printed below and can be
       * typed in by hand, which is the whole reason it is printed.
       */
      setIsOpenError(true);
      setError(
        "No authenticator app on this device could open that link. Add the setup key below to your authenticator app instead.",
      );
    }
  };

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (isLoading) {
      return;
    }
    if (!code.trim()) {
      setIsOpenError(false);
      setError("Enter the code your authenticator app is showing.");
      return;
    }

    setIsOpenError(false);
    setError(null);
    setIsLoading(true);

    try {
      const response: LoginResponse = await verifyTotpEnrolment({
        code: code.trim(),
      });

      /*
       * There is no challenge count on this path -- /login answered with an
       * enrolment, not a list of factors -- so the server says it directly
       * instead. `hasBackupCodes` arrives only when the account already had a
       * set and none were minted; its absence means the account genuinely has
       * nothing, whether because the codes are in this response or because
       * minting them failed.
       */
      const followUp: TwoFactorFollowUp = decideTwoFactorFollowUp({
        mintedCodeCount: response.backupCodes?.length || 0,
        accountHasNoCodes: response.hasBackupCodes !== true,

        /*
         * Never suppressed here. A user finishing a mandated enrolment has no
         * recovery route at all, and this is the first sign-in of that
         * account's new second factor -- there is no "you already told us to
         * stop asking" to honour.
         */
        offerRecentlySkipped: false,
      });

      if (followUp === "signed-in") {
        completePendingLogin();
        return;
      }

      navigation.navigate("BackupCodes", {
        mode: followUp === "show-codes" ? "show" : "offer",
      });
    } catch (err: unknown) {
      setIsOpenError(false);
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const startOver: () => void = (): void => {
    /*
     * Clears the submitted credentials as well as the enrolment: those are the
     * email and password the next step would re-submit, and leaving them
     * behind would let the previous account's password ride along into a fresh
     * attempt.
     */
    cancelTwoFactor();
    navigation.navigate("Login");
  };

  const codeError: string | null = error && !isOpenError ? error : null;

  return (
    <AuthLayout
      title="Protect your account"
      eyebrow="TWO-FACTOR SETUP"
      icon="shield-checkmark-outline"
      compact
      description="Set up an authenticator in two steps to finish signing in securely."
    >
      <AuthStep
        number={1}
        title="Add your account"
        description="Open your authenticator app or enter the setup key manually."
      />

      <GradientButton
        label="Add to Authenticator App"
        onPress={openInAuthenticator}
        icon="open-outline"
        variant="tonal"
        disabled={!otpUrl}
        style={authPrimaryButtonStyle}
      />

      {didOpenAuthenticator ? (
        <AuthNotice
          testID="opened-authenticator-hint"
          tone="success"
          icon="return-down-back"
          live
          message="Come back here and enter the six digit code it is showing."
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      {error && isOpenError ? (
        <AuthNotice
          tone="danger"
          message={error}
          style={{ marginTop: spacing.md }}
        />
      ) : null}

      {secret ? (
        <Card
          variant="outlined"
          testID="enrolment-secret-card"
          style={{ marginTop: spacing.lg, gap: spacing.sm }}
        >
          <AppText variant="subhead" weight="600" tone="secondary">
            Or add this setup key by hand
          </AppText>
          <View
            style={{
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.md,
              borderRadius: radius.sm,
              backgroundColor: theme.colors.backgroundTertiary,
            }}
          >
            <AppText
              testID="enrolment-secret"
              selectable={true}
              variant="headline"
              align="center"
              style={{
                letterSpacing: 2,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
            >
              {secret}
            </AppText>
          </View>
          <AppText variant="footnote" tone="secondary">
            Press and hold the key to copy it. Choose a time-based key if your
            app asks.
          </AppText>
        </Card>
      ) : null}

      <View
        style={{
          marginTop: spacing.xxl,
          paddingTop: spacing.xl,
          borderTopWidth: 1,
          borderTopColor: theme.colors.borderSubtle,
        }}
      >
        <AuthStep
          number={2}
          title="Confirm the setup"
          description="Enter the current six-digit code from your authenticator app."
        />
        <View style={{ gap: spacing.xl }}>
          <AuthTextField
            testID="enrolment-code-input"
            containerTestID="enrolment-code-field"
            variant="code"
            label="Six-digit code"
            accessibilityLabel="Authenticator code"
            editable={!isLoading}
            errorMessage={codeError}
            value={code}
            onChangeText={(text: string) => {
              setCode(text);
              setError(null);
            }}
            placeholder="000000"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          <GradientButton
            label="Verify and Sign In"
            onPress={submit}
            loading={isLoading}
            disabled={isLoading}
            style={authPrimaryButtonStyle}
          />
        </View>
      </View>

      <View style={{ marginTop: spacing.md }}>
        <AuthLink
          label="Sign in as a different user"
          tone="secondary"
          testID="sign-in-as-different-user"
          onPress={startOver}
          disabled={isLoading}
        />
      </View>
    </AuthLayout>
  );
}
