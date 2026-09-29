import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { spacing } from "../theme";
import AuthLayout, { AuthNotice } from "../components/AuthLayout";
import AppText from "../components/AppText";
import GradientButton from "../components/GradientButton";

interface BiometricLockScreenProps {
  onSuccess: () => void;
  biometricType: string;
}

const FACE_BIOMETRIC_PATTERN: RegExp = /face/i;

/*
 * "Face ID", "Touch ID" and "Optic ID" are product names and keep their
 * capitals; a generic "Fingerprint" or "Biometrics" reads as an ordinary word
 * mid-sentence.
 */
const PRODUCT_NAME_PATTERN: RegExp = /\bID$/;

function describeBiometric(biometricType: string): string {
  return PRODUCT_NAME_PATTERN.test(biometricType.trim())
    ? biometricType.trim()
    : biometricType.trim().toLowerCase();
}

export default function BiometricLockScreen({
  onSuccess,
  biometricType,
}: BiometricLockScreenProps): React.JSX.Element {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending: React.MutableRefObject<boolean> = useRef(false);

  const authenticate: () => Promise<void> = async (): Promise<void> => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setIsAuthenticating(true);
    setNotice(null);
    try {
      const result: LocalAuthentication.LocalAuthenticationResult =
        await LocalAuthentication.authenticateAsync({
          promptMessage: "Unlock OneUptime",
          fallbackLabel: "Use passcode",
          disableDeviceFallback: false,
        });
      if (result.success) {
        onSuccess();
      } else {
        setNotice(
          "Your app is still locked. Try again, or use your device passcode in the unlock prompt.",
        );
      }
    } catch {
      setNotice("The unlock prompt could not open. Tap Unlock to try again.");
    } finally {
      pending.current = false;
      setIsAuthenticating(false);
    }
  };

  useEffect(() => {
    void authenticate();
  }, []);

  const usesFace: boolean = FACE_BIOMETRIC_PATTERN.test(biometricType);

  return (
    <AuthLayout
      showBrand
      centered
      icon="lock-closed"
      title="Unlock your workspace"
      eyebrow="WELCOME BACK"
      compact
      description={`Use ${describeBiometric(biometricType)} to unlock`}
    >
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <AppText variant="headline" align="center">
          Your workspace is protected
        </AppText>
        <AppText variant="callout" tone="secondary" align="center">
          Confirm it is you to return to your incidents and on-call work. Your
          device passcode is also available in the unlock prompt.
        </AppText>
      </View>

      {notice ? (
        <AuthNotice
          testID="biometric-notice"
          tone="warning"
          live
          message={notice}
          style={{ marginTop: spacing.xl }}
        />
      ) : null}

      <GradientButton
        label="Unlock"
        onPress={authenticate}
        loading={isAuthenticating}
        disabled={isAuthenticating}
        icon={usesFace ? "scan-outline" : "finger-print-outline"}
        style={{ minHeight: 56, marginTop: spacing.xxl }}
      />
    </AuthLayout>
  );
}
