import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/*
 * Whether the reader has asked the OS to reduce motion.
 *
 * Three answers, not two, for the reason SkeletonCard spells out: the OS is
 * asked asynchronously and answers a tick after the first render, so `null`
 * means "not known yet" and a caller animates nothing until it is `false`.
 * Starting a loop on a guess and stopping it when the answer lands would
 * flash exactly the motion the setting exists to suppress.
 *
 * A question the OS refuses to answer is taken as "reduce": a reader who
 * wanted the motion loses an ornament, where a reader who asked for stillness
 * and is animated at anyway loses a great deal more. A change made in the
 * settings while the screen is open is followed.
 */
export function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect((): (() => void) => {
    let isMounted: boolean = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled: boolean): undefined => {
        if (isMounted) {
          setReduceMotion(enabled);
        }

        return undefined;
      })
      .catch((): void => {
        if (isMounted) {
          setReduceMotion(true);
        }
      });

    const subscription: { remove: () => void } | undefined =
      AccessibilityInfo.addEventListener(
        "reduceMotionChanged",
        (enabled: boolean): void => {
          setReduceMotion(enabled);
        },
      );

    return (): void => {
      isMounted = false;
      subscription?.remove();
    };
  }, []);

  return reduceMotion;
}
