import React from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Persister } from "@tanstack/query-persist-client-core";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

const asyncStoragePersister: Persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  throttleTime: 1000,
});

function AppContent(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      className="flex-1 bg-bg-primary"
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
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: asyncStoragePersister }}
      >
        <ThemeProvider>
          <AuthProvider>
            <ProjectProvider>
              <AppContent />
            </ProjectProvider>
          </AuthProvider>
        </ThemeProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
