import React from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "./theme";
import { AuthProvider } from "./hooks/useAuth";
import { ProjectProvider } from "./hooks/useProject";
import RootNavigator from "./navigation/RootNavigator";
import OfflineBanner from "./components/OfflineBanner";

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
    },
  },
});

function AppContent(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[theme.colors.accentGradientStart + "1C", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.9 }}
        style={{
          position: "absolute",
          top: -80,
          left: -40,
          width: 260,
          height: 260,
          borderRadius: 999,
        }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[theme.colors.accentCyan + "16", "transparent"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          position: "absolute",
          bottom: -140,
          right: -80,
          width: 320,
          height: 320,
          borderRadius: 999,
        }}
      />
      <StatusBar style={theme.isDark ? "light" : "dark"} />
      <RootNavigator />
      <OfflineBanner />
    </View>
  );
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <ProjectProvider>
              <AppContent />
            </ProjectProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
