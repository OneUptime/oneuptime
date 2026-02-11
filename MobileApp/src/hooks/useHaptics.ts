import * as Haptics from "expo-haptics";

interface HapticsResult {
  successFeedback: () => Promise<void>;
  errorFeedback: () => Promise<void>;
  lightImpact: () => Promise<void>;
  mediumImpact: () => Promise<void>;
  selectionFeedback: () => Promise<void>;
}

export function useHaptics(): HapticsResult {
  const successFeedback: () => Promise<void> = async (): Promise<void> => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const errorFeedback: () => Promise<void> = async (): Promise<void> => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const lightImpact: () => Promise<void> = async (): Promise<void> => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const mediumImpact: () => Promise<void> = async (): Promise<void> => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const selectionFeedback: () => Promise<void> = async (): Promise<void> => {
    await Haptics.selectionAsync();
  };

  return {
    successFeedback,
    errorFeedback,
    lightImpact,
    mediumImpact,
    selectionFeedback,
  };
}
