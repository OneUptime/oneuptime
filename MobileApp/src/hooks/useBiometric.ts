import { useState, useEffect, useCallback } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import {
  getBiometricEnabled,
  setBiometricEnabled as storeBiometricEnabled,
} from "../storage/preferences";

interface BiometricState {
  isAvailable: boolean;
  isEnabled: boolean;
  biometricType: string;
  authenticate: () => Promise<boolean>;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export function useBiometric(): BiometricState {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState("Biometrics");

  useEffect(() => {
    const check = async (): Promise<void> => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setIsAvailable(compatible && enrolled);

      if (compatible) {
        const types =
          await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (
          types.includes(
            LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
          )
        ) {
          setBiometricType("Face ID");
        } else if (
          types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ) {
          setBiometricType("Fingerprint");
        }
      }

      const enabled = await getBiometricEnabled();
      setIsEnabled(enabled);
    };

    check();
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Authenticate to access OneUptime",
      fallbackLabel: "Use passcode",
      disableDeviceFallback: false,
    });
    return result.success;
  }, []);

  const setEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    if (enabled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm to enable biometric unlock",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
      });
      if (!result.success) {
        return;
      }
    }
    await storeBiometricEnabled(enabled);
    setIsEnabled(enabled);
  }, []);

  return {
    isAvailable,
    isEnabled,
    biometricType,
    authenticate,
    setEnabled,
  };
}
