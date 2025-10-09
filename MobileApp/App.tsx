import "react-native-gesture-handler";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import Toast from "react-native-toast-message";
import { AuthProvider } from "@/context/AuthContext";
import { ProjectProvider } from "@/context/ProjectContext";
import { AppNavigator } from "@/navigation/AppNavigator";

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#F8FAFC",
  },
};

const queryClient = new QueryClient();

const App: React.FC = () => {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ProjectProvider>
            <NavigationContainer theme={navigationTheme}>
              <StatusBar style="dark" />
              <AppNavigator />
            </NavigationContainer>
            <Toast position="bottom" />
          </ProjectProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
};

export default App;
