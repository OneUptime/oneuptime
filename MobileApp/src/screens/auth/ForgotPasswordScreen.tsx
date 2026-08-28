import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { requestPasswordReset } from "../../api/auth";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { AuthStackParamList } from "../../navigation/types";
import Logo from "../../components/Logo";
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
  const { theme } = useTheme();
  const navigation: ForgotPasswordNavigationProp =
    useNavigation<ForgotPasswordNavigationProp>();

  const [email, setEmail] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSent, setIsSent] = useState<boolean>(false);

  const submit: () => Promise<void> = async (): Promise<void> => {
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
          <View style={{ alignItems: "center", marginBottom: 36 }}>
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
              Forgot Password
            </Text>
            <Text
              testID="forgot-password-subtitle"
              style={{
                fontSize: 14,
                marginTop: 6,
                textAlign: "center",
                lineHeight: 20,
                color: theme.colors.textSecondary,
              }}
            >
              {isSent
                ? "If that address has an account, we have emailed a link for resetting the password. Open it on a device with a browser to finish."
                : "Enter your email address and we will send you a link to reset your password."}
            </Text>
          </View>

          {!isSent ? (
            <View>
              <Text
                style={{
                  fontSize: 13,
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
                  height: 48,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  backgroundColor: theme.colors.backgroundSecondary,
                  borderWidth: 1.5,
                  borderColor: theme.colors.borderDefault,
                }}
              >
                <Ionicons
                  name="mail-outline"
                  size={18}
                  color={theme.colors.textTertiary}
                  style={{ marginRight: 10 }}
                />
                <TextInput
                  testID="forgot-password-email-input"
                  style={{
                    flex: 1,
                    fontSize: 15,
                    color: theme.colors.textPrimary,
                  }}
                  value={email}
                  onChangeText={(text: string) => {
                    setEmail(text);
                    setError(null);
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={theme.colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
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
                  label="Send Reset Link"
                  testID="send-reset-link"
                  onPress={submit}
                  loading={isLoading}
                  disabled={isLoading}
                />
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            accessibilityRole="button"
            testID="back-to-sign-in"
            onPress={() => {
              navigation.navigate("Login");
            }}
            style={{ marginTop: 24, alignItems: "center" }}
          >
            <Text style={{ fontSize: 14, color: theme.colors.actionPrimary }}>
              Back to sign in
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
