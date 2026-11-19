import React, { useEffect } from "react";
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
import { WindowLayoutProvider } from "./layout/WindowLayoutProvider";
import { ProjectSwitcherHost } from "./components/ProjectSwitcher";
import {
  recordUserActivity,
  startUserActivityTracking,
} from "./auth/userActivity";

/*
 * A touch anywhere in the app is its person using it (auth/userActivity),
 * which the server's idle timeout counts from. Touch events bubble through
 * every view an element is in, sheets and modals included, so the frame
 * around everything hears them all, and never takes one from the view it
 * was meant for.
 */
function onAnyTouch(): void {
  recordUserActivity();
}

function AppContent(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      testID="app-frame"
      onTouchStart={onAnyTouch}
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
  /*
   * From the first moment: the app opened is activity, coming back to the
   * screen is, and leaving it writes the newest activity down.
   */
  useEffect((): (() => void) => {
    return startUserActivityTracking();
  }, []);

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
