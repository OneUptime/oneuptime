import React, { useState } from "react";
import { View } from "react-native";
import { spacing } from "../../theme";
import { requestPasswordReset } from "../../api/auth";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import AuthLayout, {
  AuthLink,
  AuthTextField,
  authPrimaryButtonStyle,
} from "../../components/AuthLayout";
import AppText from "../../components/AppText";
import GradientButton from "../../components/GradientButton";
import { getFriendlyErrorMessage } from "../../utils/error";

/*
 * "Forgot password?" -- the other half of desktop parity for sign-in.
 *
 * The web sign-in has had this since the beginning. The mobile app did not,
 * which meant an engineer who could not remember their password had no route
 * at all from the app: no link, no mention of one, nothing to tap. On an
 * on-call app that is a page they reach at 3am, on a phone, away from the
 * laptop they would otherwise use.
 *
 * THE SUCCESS MESSAGE IS DELIBERATELY VAGUE. The server answers the same way
 * whether or not the address has an account -- anything else turns this into a
 * way of testing which addresses exist on the instance -- so the screen says
 * "if that address has an account" rather than claiming a mail was sent. Saying
 * "sent" would be a lie for half the callers and an oracle for the other half.
 *
 * The RESET is finished in a browser, from the link in the mail, exactly as on
 * the web. That token is a credential and routing it through a deep link into
 * a handset app is a much larger surface than the one screen it would save.
 */

type ForgotPasswordNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  "ForgotPassword"
>;

export default function ForgotPasswordScreen(): React.JSX.Element {
  const navigation: ForgotPasswordNavigationProp =
    useNavigation<ForgotPasswordNavigationProp>();

  const [email, setEmail] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSent, setIsSent] = useState<boolean>(false);

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (isLoading) {
      return;
    }
    if (!email.trim()) {
      setError("Enter the email address on your account.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      await requestPasswordReset(email.trim());
      setIsSent(true);
    } catch (err: unknown) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const backToSignIn: () => void = (): void => {
    navigation.navigate("Login");
  };

  return (
    <AuthLayout
      title={isSent ? "Check your email" : "Reset your password"}
      eyebrow="ACCOUNT RECOVERY"
      icon={isSent ? "mail-open-outline" : "key-outline"}
      iconTone={isSent ? "success" : "accent"}
      compact
    >
      <AppText
        testID="forgot-password-subtitle"
        accessibilityLiveRegion="polite"
        variant="body"
        tone="secondary"
        style={{ marginBottom: spacing.xxl }}
      >
        {isSent
          ? "If that address has an account, we have emailed a link for resetting the password. Open it on a device with a browser to finish."
          : "Enter your email address and we will send you a link to reset your password."}
      </AppText>

      {!isSent ? (
        <View style={{ gap: spacing.xl }}>
          <AuthTextField
            testID="forgot-password-email-input"
            containerTestID="forgot-password-email-field"
            label="Email"
            icon="mail-outline"
            accessibilityLabel="Email"
            editable={!isLoading}
            errorMessage={error}
            value={email}
            onChangeText={(text: string) => {
              setEmail(text);
              setError(null);
            }}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          <GradientButton
            label="Send Reset Link"
            testID="send-reset-link"
            onPress={submit}
            loading={isLoading}
            disabled={isLoading}
            style={authPrimaryButtonStyle}
          />

          <AuthLink
            label="Back to sign in"
            testID="back-to-sign-in"
            icon="arrow-back"
            onPress={backToSignIn}
          />
        </View>
      ) : (
        <GradientButton
          label="Back to sign in"
          testID="back-to-sign-in"
          icon="arrow-back"
          onPress={backToSignIn}
          style={authPrimaryButtonStyle}
        />
      )}
    </AuthLayout>
  );
}
