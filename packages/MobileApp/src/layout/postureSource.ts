import { requireOptionalNativeModule } from "expo-modules-core";
import {
  parseFoldReport,
  type FoldReport,
  type PostureSource,
} from "./windowPosture";

/*
 * How the window folds, as the app's own native module reports it
 * (modules/window-posture).
 *
 * On Android the module reads Jetpack WindowManager's folding features: where
 * the fold runs across the app's window, whether it splits the window (half
 * open, or a hinge between two screens), and which way. The app has no such
 * module on iOS yet - and none in Expo Go, or in a build made before the
 * module existed - so there the source is null, the posture stays unknown,
 * and every window keeps the layout its size gives it.
 *
 * The web build reads the browser instead (postureSource.web.ts).
 */

/** The module's name, as modules/window-posture registers it. */
export const WINDOW_POSTURE_MODULE_NAME: string = "OneUptimeWindowPosture";

/** The event the module sends whenever the window's folds change. */
export const FOLDS_CHANGE_EVENT: string = "foldsChange";

interface NativeSubscription {
  remove: () => void;
}

/** The native module, as JavaScript sees it. */
export interface WindowPostureNativeModule {
  /** The latest report, or null before the first one. */
  getFolds: () => unknown;
  addListener: (
    eventName: string,
    listener: (event: unknown) => void,
  ) => NativeSubscription;
}

function isWindowPostureModule(
  candidate: unknown,
): candidate is WindowPostureNativeModule {
  return (
    Boolean(candidate) &&
    typeof (candidate as WindowPostureNativeModule).getFolds === "function" &&
    typeof (candidate as WindowPostureNativeModule).addListener === "function"
  );
}

/**
 * A posture source over the native module, or null without one. A module
 * that answers with something this build cannot read, or throws, reports
 * nothing - the layout then stays today's - rather than breaking the app.
 */
export function createNativePostureSource(
  nativeModule: unknown,
): PostureSource | null {
  if (!isWindowPostureModule(nativeModule)) {
    return null;
  }

  return {
    getCurrent: (): FoldReport | null => {
      try {
        return parseFoldReport(nativeModule.getFolds());
      } catch {
        return null;
      }
    },
    subscribe: (
      listener: (report: FoldReport | null) => void,
    ): (() => void) => {
      let subscription: NativeSubscription | null = null;
      try {
        subscription = nativeModule.addListener(
          FOLDS_CHANGE_EVENT,
          (event: unknown): void => {
            listener(parseFoldReport(event));
          },
        );
      } catch {
        return (): void => {
          // Nothing was subscribed.
        };
      }
      return (): void => {
        subscription?.remove();
      };
    },
  };
}

/** The platform's posture source: the native module where the build has it, else null. */
export function getPlatformPostureSource(): PostureSource | null {
  return createNativePostureSource(
    requireOptionalNativeModule<WindowPostureNativeModule>(
      WINDOW_POSTURE_MODULE_NAME,
    ),
  );
}
