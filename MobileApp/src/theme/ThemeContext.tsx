import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  ReactNode,
} from "react";
import { View, useColorScheme } from "react-native";
import { ColorTokens, darkColors, lightColors } from "./colors";
import {
  getThemeMode as loadThemeMode,
  setThemeMode as saveThemeMode,
} from "../storage/preferences";

export type ThemeMode = "dark" | "light" | "system";

export interface Theme {
  colors: ColorTokens;
  isDark: boolean;
}

interface ThemeContextValue {
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext: React.Context<ThemeContextValue | undefined> =
  createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({
  children,
}: ThemeProviderProps): React.JSX.Element {
  const systemColorScheme: "light" | "dark" | null | undefined =
    useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("light");

  // Load persisted theme on mount
  useEffect(() => {
    loadThemeMode().then((mode: ThemeMode) => {
      setThemeModeState(mode);
    });
  }, []);

  const setThemeMode: (mode: ThemeMode) => void = (mode: ThemeMode): void => {
    setThemeModeState(mode);
    saveThemeMode(mode);
  };

  const theme: Theme = useMemo((): Theme => {
    let isDark: boolean;

    if (themeMode === "system") {
      isDark = systemColorScheme !== "light";
    } else {
      isDark = themeMode === "dark";
    }

    return {
      colors: isDark ? darkColors : lightColors,
      isDark,
    };
  }, [themeMode, systemColorScheme]);

  const value: ThemeContextValue = useMemo((): ThemeContextValue => {
    return {
      theme,
      themeMode,
      setThemeMode,
    };
  }, [theme, themeMode]);

  return (
    <ThemeContext.Provider value={value}>
      <View style={{ flex: 1 }}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context: ThemeContextValue | undefined = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
