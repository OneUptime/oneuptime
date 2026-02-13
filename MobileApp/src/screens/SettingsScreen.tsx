import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, ThemeMode } from "../theme";
import { useAuth } from "../hooks/useAuth";
import { useBiometric } from "../hooks/useBiometric";
import { useHaptics } from "../hooks/useHaptics";
import { getServerUrl } from "../storage/serverUrl";

const APP_VERSION: string = "1.0.0";

interface SettingsRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  destructive?: boolean;
  isLast?: boolean;
}

function SettingsRow({
  label,
  value,
  onPress,
  rightElement,
  destructive,
  isLast,
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
      <Text
        className="text-base font-medium py-3.5"
        style={{
          color: destructive
            ? theme.colors.actionDestructive
            : theme.colors.textPrimary,
        }}
      >
        {label}
      </Text>
      {rightElement ??
        (value ? (
          <Text className="text-[15px] text-text-secondary">{value}</Text>
        ) : onPress ? (
          <Ionicons
            name="chevron-forward"
            size={20}
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

function SectionCard({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      className="rounded-2xl overflow-hidden bg-bg-elevated"
      style={{
        borderWidth: 1,
        borderColor: theme.colors.borderSubtle,
      }}
    >
      {children}
    </View>
  );
}

export default function SettingsScreen(): React.JSX.Element {
  const { theme, themeMode, setThemeMode } = useTheme();
  const { logout } = useAuth();
  const biometric: ReturnType<typeof useBiometric> = useBiometric();
  const { selectionFeedback } = useHaptics();
  const [serverUrl, setServerUrlState] = useState("");

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
      className="bg-bg-primary"
      contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
    >
      {/* Appearance */}
      <View className="mb-7">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
          Appearance
        </Text>
        <SectionCard>
          <View className="p-1.5">
            <View className="flex-row rounded-xl gap-1">
              {(["dark", "light", "system"] as ThemeMode[]).map(
                (mode: ThemeMode) => {
                  const isActive: boolean = themeMode === mode;
                  return (
                    <TouchableOpacity
                      key={mode}
                      className="flex-1 flex-row items-center justify-center py-2.5 rounded-[10px] gap-1.5"
                      style={
                        isActive
                          ? { backgroundColor: theme.colors.actionPrimary }
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
                        size={16}
                        color={
                          isActive ? "#FFFFFF" : theme.colors.textSecondary
                        }
                      />
                      <Text
                        className="text-sm font-semibold"
                        style={{
                          color: isActive
                            ? "#FFFFFF"
                            : theme.colors.textPrimary,
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
        </SectionCard>
      </View>

      {/* Security */}
      {biometric.isAvailable ? (
        <View className="mb-7">
          <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
            Security
          </Text>
          <SectionCard>
            <SettingsRow
              label="Biometrics Login"
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
          </SectionCard>
          <Text className="text-xs mt-2 ml-1 leading-4 text-text-tertiary">
            Require biometrics to unlock the app
          </Text>
        </View>
      ) : null}

      {/* Server */}
      <View className="mb-7">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
          Server
        </Text>
        <SectionCard>
          <SettingsRow
            label="Server URL"
            value={serverUrl || "oneuptime.com"}
            isLast
          />
        </SectionCard>
      </View>

      {/* Account */}
      <View className="mb-7">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
          Account
        </Text>
        <SectionCard>
          <SettingsRow label="Log Out" onPress={logout} destructive isLast />
        </SectionCard>
      </View>

      {/* About */}
      <View className="mb-7">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
          About
        </Text>
        <SectionCard>
          <SettingsRow label="Version" value={APP_VERSION} isLast />
        </SectionCard>
      </View>

      {/* Footer branding */}
      <View className="items-center pt-3">
        <Text className="text-xs font-medium text-text-tertiary">
          OneUptime On-Call
        </Text>
      </View>
    </ScrollView>
  );
}
