import React from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "./theme";
import { AuthProvider } from "./hooks/useAuth";
import { ProjectProvider } from "./hooks/useProject";
import { queryClient } from "./api/queryClient";
import RootNavigator from "./navigation/RootNavigator";
import OfflineBanner from "./components/OfflineBanner";
import { WindowLayoutProvider } from "./layout/WindowLayout";
import { ProjectSwitcherHost } from "./components/ProjectSwitcher";

function AppContent(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        overflow: "hidden",
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <StatusBar style={theme.dark ? "light" : "dark"} />
      {/*
       * Above the navigation, so the project sheet stays open while a fold
       * moves the header that opened it.
       */}
      <ProjectSwitcherHost>
        <RootNavigator />
      </ProjectSwitcherHost>
      <OfflineBanner />
    </View>
  );
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      {/*
       * Every layout decision reads the window through this: a fold, an
       * unfold or a split-screen resize re-lays the app out in place.
       */}
      <WindowLayoutProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AuthProvider>
              <ProjectProvider>
                <AppContent />
              </ProjectProvider>
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </WindowLayoutProvider>
    </SafeAreaProvider>
  );
}
