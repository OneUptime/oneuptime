import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import { ColorTokens, darkColors, lightColors } from "./colors";
import { typography } from "./typography";
import { spacing, radius } from "./spacing";
import {
  getThemeMode as loadThemeMode,
  setThemeMode as saveThemeMode,
} from "../storage/preferences";

export type ThemeMode = "dark" | "light" | "system";

export interface Theme {
  colors: ColorTokens;
  typography: typeof typography;
  spacing: typeof spacing;
  radius: typeof radius;
  isDark: boolean;
}

interface ThemeContextValue {
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.JSX.Element {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("dark");

  // Load persisted theme on mount
  useEffect(() => {
    loadThemeMode().then((mode) => {
      setThemeModeState(mode);
    });
  }, []);

  const setThemeMode = (mode: ThemeMode): void => {
    setThemeModeState(mode);
    saveThemeMode(mode);
  };

  const theme = useMemo((): Theme => {
    let isDark: boolean;

    if (themeMode === "system") {
      isDark = systemColorScheme !== "light";
    } else {
      isDark = themeMode === "dark";
    }

    return {
      colors: isDark ? darkColors : lightColors,
      typography,
      spacing,
      radius,
      isDark,
    };
  }, [themeMode, systemColorScheme]);

  const value = useMemo(
    (): ThemeContextValue => ({
      theme,
      themeMode,
      setThemeMode,
    }),
    [theme, themeMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
