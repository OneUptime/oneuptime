import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { Appearance, View, useColorScheme } from "react-native";
import { ColorTokens, darkColors, lightColors } from "./colors";
import {
  getAppearancePreference,
  setAppearancePreference,
  type AppearancePreference,
} from "../storage/preferences";
import logger from "../utils/logger";

export type { AppearancePreference };

export interface Theme {
  colors: ColorTokens;
  /** Whether the dark palette is showing; drives shadows and the status bar. */
  dark: boolean;
}

interface ThemeContextValue {
  theme: Theme;
  /** What the person chose in Settings; "system" follows the device. */
  preference: AppearancePreference;
  setPreference: (preference: AppearancePreference) => void;
}

/*
 * Two frozen theme objects, not one built per render: consumers memoise styles
 * on `theme.colors`, so the identity must only change when the palette does.
 */
export const lightTheme: Theme = Object.freeze({
  colors: lightColors,
  dark: false,
});
export const darkTheme: Theme = Object.freeze({
  colors: darkColors,
  dark: true,
});

const ThemeContext: React.Context<ThemeContextValue> =
  createContext<ThemeContextValue>({
    theme: lightTheme,
    preference: "system",
    setPreference: (): void => {
      // Outside a provider there is nothing to change.
    },
  });

interface ThemeProviderProps {
  children: ReactNode;
}

/*
 * Native pickers, alerts and the keyboard follow `Appearance`, not this
 * context, so an explicit choice is mirrored there too. Web has no such API.
 */
function applyNativeAppearance(preference: AppearancePreference): void {
  if (typeof Appearance.setColorScheme !== "function") {
    return;
  }
  try {
    Appearance.setColorScheme(
      preference === "system" ? "unspecified" : preference,
    );
  } catch (error: unknown) {
    logger.warn("Could not apply the appearance preference natively", error);
  }
}

export function ThemeProvider({
  children,
}: ThemeProviderProps): React.JSX.Element {
  const systemScheme: string | null | undefined = useColorScheme();
  const [preference, setPreferenceState] =
    useState<AppearancePreference>("system");

  useEffect((): (() => void) => {
    let active: boolean = true;
    getAppearancePreference()
      .then((stored: AppearancePreference): void => {
        if (active) {
          setPreferenceState(stored);
          applyNativeAppearance(stored);
        }
      })
      .catch((error: unknown): void => {
        logger.warn("Could not read the appearance preference", error);
      });
    return (): void => {
      active = false;
    };
  }, []);

  const setPreference: (next: AppearancePreference) => void = useCallback(
    (next: AppearancePreference): void => {
      setPreferenceState(next);
      applyNativeAppearance(next);
      setAppearancePreference(next).catch((error: unknown): void => {
        logger.warn("Could not save the appearance preference", error);
      });
    },
    [],
  );

  const isDark: boolean =
    preference === "system" ? systemScheme === "dark" : preference === "dark";
  const theme: Theme = isDark ? darkTheme : lightTheme;

  const value: ThemeContextValue = useMemo((): ThemeContextValue => {
    return { theme, preference, setPreference };
  }, [theme, preference, setPreference]);

  return (
    <ThemeContext.Provider value={value}>
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        {children}
      </View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
