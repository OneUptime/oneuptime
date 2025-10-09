import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { LoginScreen } from "@/screens/LoginScreen";
import { TwoFactorScreen } from "@/screens/TwoFactorScreen";
import { ProjectSelectScreen } from "@/screens/ProjectSelectScreen";
import { IncidentsScreen } from "@/screens/IncidentsScreen";
import { AlertsScreen } from "@/screens/AlertsScreen";
import { MonitorsScreen } from "@/screens/MonitorsScreen";
import { OnCallScreen } from "@/screens/OnCallScreen";
import { useAuth } from "@/hooks/useAuth";
import { useProject } from "@/hooks/useProject";
import { FullScreenLoader } from "@/components/FullScreenLoader";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const MainTabs: React.FC = () => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: "#2D63F7",
      tabBarInactiveTintColor: "#475569",
      tabBarLabelStyle: {
        fontSize: 12,
        fontWeight: "600",
      },
    }}
  >
    <Tab.Screen name="Incidents" component={IncidentsScreen} />
    <Tab.Screen name="Alerts" component={AlertsScreen} />
    <Tab.Screen name="Monitors" component={MonitorsScreen} />
    <Tab.Screen name="OnCall" component={OnCallScreen} options={{ title: "On-call" }} />
  </Tab.Navigator>
);

export const AppNavigator: React.FC = () => {
  const { user, pendingTwoFactor, isLoading: authLoading } = useAuth();
  const { project, isLoading: projectLoading } = useProject();

  const shouldShowProjectLoader = Boolean(user) && projectLoading;
  const isBusy = authLoading || shouldShowProjectLoader;

  if (isBusy) {
    return <FullScreenLoader />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        pendingTwoFactor ? (
          <Stack.Screen name="TwoFactor" component={TwoFactorScreen} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )
      ) : !project ? (
        <Stack.Screen name="ProjectSelect" component={ProjectSelectScreen} />
      ) : (
        <Stack.Screen name="Main" component={MainTabs} />
      )}
    </Stack.Navigator>
  );
};
