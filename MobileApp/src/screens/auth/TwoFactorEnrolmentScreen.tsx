import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { useAuth } from "../../hooks/useAuth";
import { LoginResponse } from "../../api/auth";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import Logo from "../../components/Logo";
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
      setError(
        "No authenticator app on this device could open that link. Add the setup key below to your authenticator app instead.",
      );
    }
  };

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (!code.trim()) {
      setError("Enter the code your authenticator app is showing.");
      return;
    }

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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{ flex: 1, justifyContent: "center", paddingHorizontal: 28 }}
        >
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <View
              style={{
                borderWidth: 2,
                borderColor: theme.colors.borderDefault,
                borderRadius: 20,
                marginBottom: 20,
                overflow: "hidden",
              }}
            >
              <Logo size={72} />
            </View>
            <Text
              style={{
                fontSize: 24,
                fontWeight: "bold",
                textAlign: "center",
                color: theme.colors.textPrimary,
              }}
            >
              Set Up Two Factor Authentication
            </Text>
            <Text
              style={{
                fontSize: 14,
                marginTop: 6,
                textAlign: "center",
                lineHeight: 20,
                color: theme.colors.textSecondary,
              }}
            >
              Your administrator requires two factor authentication on this
              account. Set it up now to finish signing in.
            </Text>
          </View>

          <GradientButton
            label="Add to Authenticator App"
            onPress={openInAuthenticator}
            icon="open-outline"
            disabled={!otpUrl}
          />

          {didOpenAuthenticator ? (
            <Text
              testID="opened-authenticator-hint"
              style={{
                fontSize: 13,
                marginTop: 10,
                textAlign: "center",
                color: theme.colors.textSecondary,
              }}
            >
              Come back here and enter the six digit code it is showing.
            </Text>
          ) : null}

          {secret ? (
            <View style={{ marginTop: 20 }}>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  marginBottom: 8,
                  color: theme.colors.textSecondary,
                }}
              >
                Or add this setup key by hand
              </Text>
              <View
                style={{
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: theme.colors.backgroundSecondary,
                  borderWidth: 1,
                  borderColor: theme.colors.borderDefault,
                }}
              >
                <Text
                  testID="enrolment-secret"
                  selectable={true}
                  style={{
                    fontSize: 15,
                    letterSpacing: 1.5,
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    color: theme.colors.textPrimary,
                  }}
                >
                  {secret}
                </Text>
              </View>
            </View>
          ) : null}

          <View style={{ marginTop: 24 }}>
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                marginBottom: 8,
                color: theme.colors.textSecondary,
              }}
            >
              Code
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                height: 48,
                borderRadius: 12,
                paddingHorizontal: 14,
                backgroundColor: theme.colors.backgroundSecondary,
                borderWidth: 1.5,
                borderColor: theme.colors.borderDefault,
              }}
            >
              <Ionicons
                name="keypad-outline"
                size={18}
                color={theme.colors.textTertiary}
                style={{ marginRight: 10 }}
              />
              <TextInput
                testID="enrolment-code-input"
                style={{
                  flex: 1,
                  fontSize: 15,
                  color: theme.colors.textPrimary,
                }}
                value={code}
                onChangeText={(text: string) => {
                  setCode(text);
                  setError(null);
                }}
                placeholder="123456"
                placeholderTextColor={theme.colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                returnKeyType="go"
                onSubmitEditing={submit}
              />
            </View>

            {error ? (
              <View
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
                    fontSize: 13,
                    flex: 1,
                    color: theme.colors.statusError,
                  }}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: 24 }}>
              <GradientButton
                label="Verify and Sign In"
                onPress={submit}
                loading={isLoading}
                disabled={isLoading}
              />
            </View>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            testID="sign-in-as-different-user"
            onPress={startOver}
            style={{ marginTop: 20, alignItems: "center" }}
          >
            <Text style={{ fontSize: 14, color: theme.colors.textTertiary }}>
              Sign in as a different user
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
