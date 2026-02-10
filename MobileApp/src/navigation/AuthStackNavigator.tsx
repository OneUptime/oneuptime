import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AuthStackParamList } from "./types";
import ServerUrlScreen from "../screens/auth/ServerUrlScreen";
import LoginScreen from "../screens/auth/LoginScreen";
import { useTheme } from "../theme";

const Stack: ReturnType<typeof createNativeStackNavigator<AuthStackParamList>> = createNativeStackNavigator<AuthStackParamList>();

interface AuthStackNavigatorProps {
  initialRoute: keyof AuthStackParamList;
}

export default function AuthStackNavigator({
  initialRoute,
}: AuthStackNavigatorProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
        },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="ServerUrl" component={ServerUrlScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}
