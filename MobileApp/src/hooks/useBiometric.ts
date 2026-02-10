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
  const [isAvailable, setIsAvailable] = useState<boolean>(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(false);
  const [biometricType, setBiometricType] = useState<string>("Biometrics");

  useEffect((): void => {
    const check = async (): Promise<void> => {
      const compatible: boolean = await LocalAuthentication.hasHardwareAsync();
      const enrolled: boolean = await LocalAuthentication.isEnrolledAsync();
      setIsAvailable(compatible && enrolled);

      if (compatible) {
        const types: LocalAuthentication.AuthenticationType[] =
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

      const enabled: boolean = await getBiometricEnabled();
      setIsEnabled(enabled);
    };

    check();
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    const result: LocalAuthentication.LocalAuthenticationResult =
      await LocalAuthentication.authenticateAsync({
      promptMessage: "Authenticate to access OneUptime",
      fallbackLabel: "Use passcode",
      disableDeviceFallback: false,
    });
    return result.success;
  }, []);

  const setEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    if (enabled) {
      const result: LocalAuthentication.LocalAuthenticationResult =
        await LocalAuthentication.authenticateAsync({
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
