import * as Haptics from "expo-haptics";

export function useHaptics() {
  const successFeedback = async (): Promise<void> => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const errorFeedback = async (): Promise<void> => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const lightImpact = async (): Promise<void> => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const mediumImpact = async (): Promise<void> => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const selectionFeedback = async (): Promise<void> => {
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
