import * as Haptics from "expo-haptics";

interface HapticsResult {
  successFeedback: () => Promise<void>;
  errorFeedback: () => Promise<void>;
  lightImpact: () => Promise<void>;
  mediumImpact: () => Promise<void>;
  selectionFeedback: () => Promise<void>;
}

async function playFeedback(feedback: () => Promise<void>): Promise<void> {
  try {
    await feedback();
  } catch {
    /*
     * Optional device feedback must never change the result of an API request
     * or prevent navigation on devices where haptics are unavailable.
     */
  }
}

export function useHaptics(): HapticsResult {
  const successFeedback: () => Promise<void> = async (): Promise<void> => {
    await playFeedback(() => {
      return Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    });
  };

  const errorFeedback: () => Promise<void> = async (): Promise<void> => {
    await playFeedback(() => {
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    });
  };

  const lightImpact: () => Promise<void> = async (): Promise<void> => {
    await playFeedback(() => {
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    });
  };

  const mediumImpact: () => Promise<void> = async (): Promise<void> => {
    await playFeedback(() => {
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    });
  };

  const selectionFeedback: () => Promise<void> = async (): Promise<void> => {
    await playFeedback(() => {
      return Haptics.selectionAsync();
    });
  };

  return {
    successFeedback,
    errorFeedback,
    lightImpact,
    mediumImpact,
    selectionFeedback,
  };
}
