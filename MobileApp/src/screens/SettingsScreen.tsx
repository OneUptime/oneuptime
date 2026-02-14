import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, ScrollView, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme, ThemeMode } from "../theme";
import { useAuth } from "../hooks/useAuth";
import { useBiometric } from "../hooks/useBiometric";
import { useHaptics } from "../hooks/useHaptics";
import { getServerUrl } from "../storage/serverUrl";
import Logo from "../components/Logo";

const APP_VERSION: string = "1.0.0";

interface SettingsRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  destructive?: boolean;
  isLast?: boolean;
  iconName?: keyof typeof Ionicons.glyphMap;
}

function SettingsRow({
  label,
  value,
  onPress,
  rightElement,
  destructive,
  isLast,
  iconName,
}: SettingsRowProps): React.JSX.Element {
  const { theme } = useTheme();

  const content: React.JSX.Element = (
    <View
      className="flex-row justify-between items-center px-4 min-h-[52px]"
      style={
        !isLast
          ? {
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.borderSubtle,
            }
          : undefined
      }
    >
      <View className="flex-row items-center flex-1">
        {iconName ? (
          <View
            className="w-7 h-7 rounded-lg items-center justify-center mr-3"
            style={{
              backgroundColor: destructive
                ? theme.colors.statusErrorBg
                : theme.colors.iconBackground,
            }}
          >
            <Ionicons
              name={iconName}
              size={15}
              color={
                destructive
                  ? theme.colors.actionDestructive
                  : theme.colors.actionPrimary
              }
            />
          </View>
        ) : null}
        <Text
          className="text-[15px] font-medium py-3"
          style={{
            color: destructive
              ? theme.colors.actionDestructive
              : theme.colors.textPrimary,
          }}
        >
          {label}
        </Text>
      </View>
      {rightElement ??
        (value ? (
          <Text
            className="text-[14px]"
            style={{ color: theme.colors.textTertiary }}
          >
            {value}
          </Text>
        ) : onPress ? (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={theme.colors.textTertiary}
          />
        ) : null)}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

export default function SettingsScreen(): React.JSX.Element {
  const { theme, themeMode, setThemeMode } = useTheme();
  const { logout } = useAuth();
  const biometric: ReturnType<typeof useBiometric> = useBiometric();
  const { selectionFeedback } = useHaptics();
  const [serverUrl, setServerUrlState] = useState("");
  const activeThemeOptionColor: string = theme.isDark
    ? theme.colors.backgroundPrimary
    : "#FFFFFF";

  useEffect(() => {
    getServerUrl().then(setServerUrlState);
  }, []);

  const handleThemeChange: (mode: ThemeMode) => void = (
    mode: ThemeMode,
  ): void => {
    selectionFeedback();
    setThemeMode(mode);
  };

  const handleBiometricToggle: (value: boolean) => Promise<void> = async (
    value: boolean,
  ): Promise<void> => {
    await biometric.setEnabled(value);
    if (value) {
      selectionFeedback();
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
    >
      {/* Header */}
      <View
        className="rounded-3xl overflow-hidden p-5 mb-6"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: theme.isDark ? "#000" : theme.colors.accentGradientMid,
          shadowOpacity: theme.isDark ? 0.28 : 0.12,
          shadowOffset: { width: 0, height: 10 },
          shadowRadius: 18,
          elevation: 7,
        }}
      >
        <LinearGradient
          colors={[
            theme.colors.accentGradientStart + "24",
            theme.colors.accentGradientEnd + "08",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: "absolute",
            top: -60,
            left: -10,
            right: -10,
            height: 190,
          }}
        />

        <View className="flex-row items-center">
          <View
            className="w-14 h-14 rounded-2xl items-center justify-center"
            style={{
              backgroundColor: "#000000",
              borderWidth: 1,
              borderColor: "#1F1F1F",
            }}
          >
            <Logo size={52} />
          </View>

          <View className="ml-3 flex-1">
            <Text
              className="text-[20px] font-bold"
              style={{ color: theme.colors.textPrimary, letterSpacing: -0.3 }}
            >
              Preferences
            </Text>
            <Text
              className="text-[12px] mt-0.5"
              style={{
                color: theme.colors.textSecondary,
                letterSpacing: 0.2,
              }}
            >
              Personalize your OneUptime experience
            </Text>
          </View>
        </View>

        <View className="mt-4 flex-row items-center justify-between">
          <Text
            className="text-[11px] font-semibold uppercase"
            style={{
              color: theme.colors.textTertiary,
              letterSpacing: 1,
            }}
          >
            Connected to
          </Text>

          <View
            className="px-2.5 py-1 rounded-lg"
            style={{
              backgroundColor: theme.colors.accentCyanBg,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            <Text
              className="text-[11px] font-semibold"
              style={{ color: theme.colors.accentCyan }}
            >
              {serverUrl || "oneuptime.com"}
            </Text>
          </View>
        </View>
      </View>

      {/* Appearance */}
      <View className="mb-6">
        <Text
          className="text-[12px] font-semibold uppercase mb-2 ml-1"
          style={{ color: theme.colors.textTertiary, letterSpacing: 0.8 }}
        >
          Appearance
        </Text>
        <View
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <View className="p-1.5">
            <View className="flex-row rounded-xl gap-1">
              {(["dark", "light", "system"] as ThemeMode[]).map(
                (mode: ThemeMode) => {
                  const isActive: boolean = themeMode === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      className="flex-1 flex-row items-center justify-center py-2.5 rounded-[10px] gap-1.5 overflow-hidden"
                      style={
                        isActive
                          ? {
                              backgroundColor: theme.colors.actionPrimary,
                              shadowColor: theme.colors.actionPrimary,
                              shadowOpacity: 0.3,
                              shadowOffset: { width: 0, height: 2 },
                              shadowRadius: 6,
                              elevation: 3,
                            }
                          : undefined
                      }
                      onPress={() => {
                        return handleThemeChange(mode);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={
                          mode === "dark"
                            ? "moon-outline"
                            : mode === "light"
                              ? "sunny-outline"
                              : "phone-portrait-outline"
                        }
                        size={15}
                        color={
                          isActive
                            ? activeThemeOptionColor
                            : theme.colors.textSecondary
                        }
                      />
                      <Text
                        className="text-[13px] font-semibold"
                        style={{
                          color: isActive
                            ? activeThemeOptionColor
                            : theme.colors.textPrimary,
                          letterSpacing: 0.2,
                        }}
                      >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                },
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Security */}
      {biometric.isAvailable ? (
        <View className="mb-6">
          <Text
            className="text-[12px] font-semibold uppercase mb-2 ml-1"
            style={{ color: theme.colors.textTertiary, letterSpacing: 0.8 }}
          >
            Security
          </Text>
          <View
            className="rounded-2xl overflow-hidden"
            style={{
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            <SettingsRow
              label="Biometrics Login"
              iconName="finger-print-outline"
              isLast
              rightElement={
                <Switch
                  value={biometric.isEnabled}
                  onValueChange={handleBiometricToggle}
                  trackColor={{
                    false: theme.colors.backgroundTertiary,
                    true: theme.colors.actionPrimary,
                  }}
                  thumbColor="#FFFFFF"
                />
              }
            />
          </View>
          <Text
            className="text-[12px] mt-1.5 ml-1 leading-4"
            style={{ color: theme.colors.textTertiary }}
          >
            Require biometrics to unlock the app
          </Text>
        </View>
      ) : null}

      {/* Server */}
      <View className="mb-6">
        <Text
          className="text-[12px] font-semibold uppercase mb-2 ml-1"
          style={{ color: theme.colors.textTertiary, letterSpacing: 0.8 }}
        >
          Server
        </Text>
        <View
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <SettingsRow
            label="Server URL"
            iconName="globe-outline"
            value={serverUrl || "oneuptime.com"}
            isLast
          />
        </View>
      </View>

      {/* Account */}
      <View className="mb-6">
        <Text
          className="text-[12px] font-semibold uppercase mb-2 ml-1"
          style={{ color: theme.colors.textTertiary, letterSpacing: 0.8 }}
        >
          Account
        </Text>
        <View
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <SettingsRow
            label="Log Out"
            iconName="log-out-outline"
            onPress={logout}
            destructive
            isLast
          />
        </View>
      </View>

      {/* About */}
      <View className="mb-6">
        <Text
          className="text-[12px] font-semibold uppercase mb-2 ml-1"
          style={{ color: theme.colors.textTertiary, letterSpacing: 0.8 }}
        >
          About
        </Text>
        <View
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <SettingsRow
            label="Version"
            iconName="information-circle-outline"
            value={APP_VERSION}
            isLast
          />
        </View>
      </View>

      {/* Footer */}
      <View className="pt-2 pb-2">
        <View
          className="rounded-2xl overflow-hidden px-4 py-4"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <View
            className="absolute top-0 left-0 right-0"
            style={{
              height: 3,
              backgroundColor: theme.colors.actionPrimary,
              opacity: theme.isDark ? 0.45 : 0.85,
            }}
          />

          <View className="items-center mt-1 mb-2.5">
            <View className="flex-row items-center gap-2">
              <View
                className="w-8 h-8 rounded-full items-center justify-center"
                style={{ backgroundColor: theme.colors.iconBackground }}
              >
                <Ionicons
                  name="heart-outline"
                  size={16}
                  color={theme.colors.actionPrimary}
                />
              </View>
              <View
                className="px-2.5 py-1 rounded-full"
                style={{ backgroundColor: theme.colors.iconBackground }}
              >
                <Text
                  className="text-[10px] font-semibold"
                  style={{
                    color: theme.colors.textSecondary,
                    letterSpacing: 0.4,
                  }}
                >
                  OPEN SOURCE
                </Text>
              </View>
            </View>
          </View>

          <Text
            className="text-[14px] font-semibold"
            style={{ color: theme.colors.textPrimary, textAlign: "center" }}
          >
            Thank you for supporting open source software.
          </Text>
          <Text
            className="text-[12px] mt-2 leading-5"
            style={{ color: theme.colors.textSecondary, textAlign: "center" }}
          >
            Built and maintained by contributors around the world.
          </Text>

          <View className="items-center mt-3">
            <View
              className="px-2.5 py-1 rounded-full"
              style={{
                backgroundColor: theme.colors.backgroundTertiary,
                borderWidth: 1,
                borderColor: theme.colors.borderSubtle,
              }}
            >
              <Text
                className="text-[11px]"
                style={{ color: theme.colors.textTertiary }}
              >
                Licensed under Apache 2.0
              </Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
