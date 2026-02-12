import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
} from "react-native";
import { useTheme, ThemeMode } from "../theme";
import { useAuth } from "../hooks/useAuth";
import { useProject } from "../hooks/useProject";
import { useBiometric } from "../hooks/useBiometric";
import { useHaptics } from "../hooks/useHaptics";
import { getServerUrl } from "../storage/serverUrl";

const APP_VERSION: string = "1.0.0";

interface SettingsRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  textColor?: string;
  destructive?: boolean;
}

function SettingsRow({
  label,
  value,
  onPress,
  rightElement,
  textColor,
  destructive,
}: SettingsRowProps): React.JSX.Element {
  const { theme } = useTheme();

  const content: React.JSX.Element = (
    <View className="flex-row justify-between items-center p-4 rounded-2xl min-h-[52px] bg-bg-elevated shadow-sm">
      <Text
        className="text-base font-medium"
        style={{
          color: destructive
            ? theme.colors.actionDestructive
            : textColor || theme.colors.textPrimary,
        }}
      >
        {label}
      </Text>
      {rightElement ??
        (value ? (
          <Text className="text-[15px] text-text-secondary">{value}</Text>
        ) : onPress ? (
          <Text className="text-2xl font-light text-text-tertiary">{">"}</Text>
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
  const { selectedProject, clearProject } = useProject();
  const biometric: ReturnType<typeof useBiometric> = useBiometric();
  const { selectionFeedback } = useHaptics();
  const [serverUrl, setServerUrlState] = useState("");

  useEffect(() => {
    getServerUrl().then(setServerUrlState);
  }, []);

  const handleChangeProject: () => Promise<void> = async (): Promise<void> => {
    await clearProject();
  };

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
        <View className="flex-row rounded-2xl p-1 gap-1 bg-bg-elevated shadow-sm">
          {(["dark", "light", "system"] as ThemeMode[]).map(
            (mode: ThemeMode) => {
              const isActive: boolean = themeMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  className="flex-1 flex-row items-center justify-center py-2.5 rounded-lg gap-1.5"
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
                  <Text
                    className="text-base"
                    style={{
                      color: isActive
                        ? "#FFFFFF"
                        : theme.colors.textSecondary,
                    }}
                  >
                    {mode === "dark" ? "\u25D7" : mode === "light" ? "\u25CB" : "\u25D1"}
                  </Text>
                  <Text
                    className="text-sm font-semibold"
                    style={{
                      color: isActive ? "#FFFFFF" : theme.colors.textPrimary,
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

      {/* Security */}
      {biometric.isAvailable ? (
        <View className="mb-7">
          <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
            Security
          </Text>
          <SettingsRow
            label="Biometrics Login"
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
          <Text className="text-xs mt-2 ml-1 leading-4 text-text-tertiary">
            Require biometrics to unlock the app
          </Text>
        </View>
      ) : null}

      {/* Project */}
      {selectedProject ? (
        <View className="mb-7">
          <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
            Project
          </Text>
          <SettingsRow
            label={selectedProject.name}
            onPress={handleChangeProject}
          />
        </View>
      ) : null}

      {/* Server */}
      <View className="mb-7">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
          Server
        </Text>
        <SettingsRow label="Server URL" value={serverUrl || "oneuptime.com"} />
      </View>

      {/* Account */}
      <View className="mb-7">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
          Account
        </Text>
        <SettingsRow label="Log Out" onPress={logout} destructive />
      </View>

      {/* About */}
      <View className="mb-7">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
          About
        </Text>
        <SettingsRow label="Version" value={APP_VERSION} />
        <View className="h-px" />
        <SettingsRow label="Build" value="1" />
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
