import React, { createContext, useContext, ReactNode } from "react";
import { View } from "react-native";
import { ColorTokens, darkColors } from "./colors";

export interface Theme {
  colors: ColorTokens;
}

interface ThemeContextValue {
  theme: Theme;
}

const theme: Theme = { colors: darkColors };

const ThemeContext: React.Context<ThemeContextValue> =
  createContext<ThemeContextValue>({ theme });

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({
  children,
}: ThemeProviderProps): React.JSX.Element {
  return (
    <ThemeContext.Provider value={{ theme }}>
      <View style={{ flex: 1 }}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
