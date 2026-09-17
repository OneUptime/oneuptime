import React, { useMemo } from "react";
import { Platform } from "react-native";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import ProjectSwitcher from "../components/ProjectSwitcher";
import { useTheme } from "../theme";

/*
 * Every workspace stack shares one header: the project switcher on the canvas
 * colour, with no hairline, so a page reads as one continuous surface. Stacks
 * used to each carry their own copy and had drifted - one on a different
 * background, one without a content colour, which flashed white on push.
 */
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const { theme } = useTheme();
  return useMemo((): NativeStackNavigationOptions => {
    return {
      headerTitle: () => {
        return <ProjectSwitcher />;
      },
      headerTitleAlign: "left",
      headerStyle: { backgroundColor: theme.colors.backgroundPrimary },
      headerTintColor: theme.colors.actionPrimary,
      headerTitleStyle: {
        fontSize: 17,
        fontWeight: "600",
        color: theme.colors.textPrimary,
      },
      headerShadowVisible: false,
      headerBackButtonDisplayMode: "minimal",
      contentStyle: { backgroundColor: theme.colors.backgroundPrimary },
      ...(Platform.OS === "ios"
        ? {
            headerLargeTitle: false,
            headerLargeStyle: {
              backgroundColor: theme.colors.backgroundPrimary,
            },
          }
        : {}),
    };
  }, [theme]);
}
