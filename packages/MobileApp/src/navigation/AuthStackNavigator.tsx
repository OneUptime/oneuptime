import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AuthStackParamList } from "./types";
import ServerUrlScreen from "../screens/auth/ServerUrlScreen";
import LoginScreen from "../screens/auth/LoginScreen";
import SSOLoginScreen from "../screens/auth/SSOLoginScreen";
import ForgotPasswordScreen from "../screens/auth/ForgotPasswordScreen";
import TwoFactorScreen from "../screens/auth/TwoFactorScreen";
import TwoFactorEnrolmentScreen from "../screens/auth/TwoFactorEnrolmentScreen";
import BackupCodesScreen from "../screens/auth/BackupCodesScreen";
import { useTheme } from "../theme";

const Stack: ReturnType<typeof createNativeStackNavigator<AuthStackParamList>> =
  createNativeStackNavigator<AuthStackParamList>();

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
      <Stack.Screen name="SSOLogin" component={SSOLoginScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="TwoFactor" component={TwoFactorScreen} />
      <Stack.Screen
        name="TwoFactorEnrolment"
        component={TwoFactorEnrolmentScreen}
      />

      {/*
       * Back is disabled on this one, and it is the only screen in the app
       * where that is right. It shows recovery codes that exist in memory and
       * nowhere else -- the server keeps keyed digests -- so a swipe-back
       * gesture made by reflex destroys them permanently. The way forward is
       * the Continue button, which is itself disabled until the user says they
       * have saved them.
       */}
      <Stack.Screen
        name="BackupCodes"
        component={BackupCodesScreen}
        options={{ gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}
