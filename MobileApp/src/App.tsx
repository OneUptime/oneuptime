import React from "react";
import { View, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider, useTheme } from "./theme";
import { AuthProvider } from "./hooks/useAuth";
import { ProjectProvider } from "./hooks/useProject";
import RootNavigator from "./navigation/RootNavigator";
import OfflineBanner from "./components/OfflineBanner";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
    },
  },
});

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  throttleTime: 1000,
});

function AppContent(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.backgroundPrimary }]}>
      <StatusBar style={theme.isDark ? "light" : "dark"} />
      <RootNavigator />
      <OfflineBanner />
    </View>
  );
}

export default function App(): React.JSX.Element {
  return (
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
