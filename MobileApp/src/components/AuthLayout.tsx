import React, { useContext } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
import Logo from "./Logo";
import ScreenIntro from "./ScreenIntro";

interface AuthLayoutProps {
  title: string;
  description?: string;
  eyebrow?: string;
  showBrand?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}

/** A scrollable, keyboard-aware sign-in layout that also fits small phones. */
export default function AuthLayout({
  title,
  description,
  eyebrow,
  showBrand = false,
  compact = false,
  children,
}: AuthLayoutProps): React.JSX.Element {
  const { theme } = useTheme();
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const paddingBottom: number = useScreenPadding({ tabBar: false });

  return (
    <KeyboardAvoidingView
      testID="auth-keyboard"
      style={{ flex: 1, backgroundColor: theme.colors.backgroundSecondary }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        testID="auth-scroll"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingTop: Math.max(insets?.top ?? 0, 16) + (compact ? 0 : 8),
          paddingBottom,
        }}
      >
        <View style={{ width: "100%", maxWidth: 440, alignSelf: "center" }}>
          {showBrand ? (
            <View
              testID="auth-brand"
              style={{
                alignSelf: "flex-start",
                marginBottom: compact ? 24 : 36,
              }}
            >
              <Logo
                size={25}
                variant="wordmark"
                color={theme.colors.textPrimary}
              />
            </View>
          ) : null}
          <ScreenIntro
            title={title}
            description={description}
            eyebrow={eyebrow}
            compact={compact}
          />
          <View testID="auth-form" style={{ marginTop: compact ? 0 : 8 }}>
            {children}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthStep({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        marginTop: 12,
        marginBottom: 20,
      }}
    >
      <View
        style={{
          minWidth: 32,
          minHeight: 32,
          borderRadius: 8,
          padding: 6,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.backgroundPrimary,
          marginRight: 12,
        }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "700",
            color: theme.colors.actionPrimary,
          }}
        >
          {number}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          style={{
            fontSize: 17,
            lineHeight: 24,
            fontWeight: "700",
            color: theme.colors.textPrimary,
          }}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={{
              fontSize: 14,
              lineHeight: 21,
              marginTop: 4,
              color: theme.colors.textSecondary,
            }}
          >
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
