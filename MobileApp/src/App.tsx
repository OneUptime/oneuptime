import React from "react";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "./theme";
import { AuthProvider } from "./hooks/useAuth";
import RootNavigator from "./navigation/RootNavigator";

const queryClient = new QueryClient();

function AppContent(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <>
      <StatusBar style={theme.isDark ? "light" : "dark"} />
      <RootNavigator />
    </>
  );
}

export default function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
