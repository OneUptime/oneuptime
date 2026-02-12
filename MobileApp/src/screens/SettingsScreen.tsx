import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  StyleSheet,
} from "react-native";
import { useTheme, ThemeMode } from "../theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../hooks/useAuth";
import { useProject } from "../hooks/useProject";
import { useBiometric } from "../hooks/useBiometric";
import { useHaptics } from "../hooks/useHaptics";
import { getServerUrl } from "../storage/serverUrl";
import type { SettingsStackParamList } from "../navigation/types";

type SettingsNavProp = NativeStackNavigationProp<
  SettingsStackParamList,
  "SettingsList"
>;

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
    <View
      style={[
        styles.row,
        theme.shadows.sm,
        {
          backgroundColor: theme.colors.backgroundElevated,
        },
      ]}
    >
      <Text
        style={[
          styles.rowLabel,
          {
            color: destructive
              ? theme.colors.actionDestructive
              : textColor || theme.colors.textPrimary,
          },
        ]}
      >
        {label}
      </Text>
      {rightElement ??
        (value ? (
          <Text
            style={[styles.rowValue, { color: theme.colors.textSecondary }]}
          >
            {value}
          </Text>
        ) : onPress ? (
          <Text style={[styles.chevron, { color: theme.colors.textTertiary }]}>
            ›
          </Text>
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
  const navigation: SettingsNavProp = useNavigation<SettingsNavProp>();
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
      style={[{ backgroundColor: theme.colors.backgroundPrimary }]}
      contentContainerStyle={styles.content}
    >
      {/* Appearance */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          Appearance
        </Text>
        <View
          style={[
            styles.themeSelector,
            theme.shadows.sm,
            {
              backgroundColor: theme.colors.backgroundElevated,
            },
          ]}
        >
          {(["dark", "light", "system"] as ThemeMode[]).map(
            (mode: ThemeMode) => {
              const isActive: boolean = themeMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.themeOption,
                    isActive && {
                      backgroundColor: theme.colors.actionPrimary,
                    },
                  ]}
                  onPress={() => {
                    return handleThemeChange(mode);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.themeOptionIcon,
                      {
                        color: isActive
                          ? "#FFFFFF"
                          : theme.colors.textSecondary,
                      },
                    ]}
                  >
                    {mode === "dark" ? "◗" : mode === "light" ? "○" : "◑"}
                  </Text>
                  <Text
                    style={[
                      styles.themeOptionLabel,
                      {
                        color: isActive ? "#FFFFFF" : theme.colors.textPrimary,
                      },
                    ]}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            },
          )}
        </View>
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          Notifications
        </Text>
        <SettingsRow
          label="Notification Preferences"
          onPress={() => {
            return navigation.navigate("NotificationPreferences");
          }}
        />
      </View>

      {/* Security */}
      {biometric.isAvailable ? (
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
          >
            Security
          </Text>
          <SettingsRow
            label={biometric.biometricType}
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
          <Text
            style={[styles.sectionHint, { color: theme.colors.textTertiary }]}
          >
            Require {biometric.biometricType.toLowerCase()} to unlock the app
          </Text>
        </View>
      ) : null}

      {/* Project */}
      {selectedProject ? (
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
          >
            Project
          </Text>
          <SettingsRow
            label={selectedProject.name}
            onPress={handleChangeProject}
          />
        </View>
      ) : null}

      {/* Server */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          Server
        </Text>
        <SettingsRow label="Server URL" value={serverUrl || "oneuptime.com"} />
      </View>

      {/* Account */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          Account
        </Text>
        <SettingsRow label="Log Out" onPress={logout} destructive />
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          About
        </Text>
        <SettingsRow label="Version" value={APP_VERSION} />
        <View style={{ height: 1 }} />
        <SettingsRow label="Build" value="1" />
      </View>

      {/* Footer branding */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: theme.colors.textTertiary }]}>
          OneUptime On-Call
        </Text>
      </View>
    </ScrollView>
  );
}

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionHint: {
    fontSize: 12,
    marginTop: 8,
    marginLeft: 4,
    lineHeight: 16,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    minHeight: 52,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  rowValue: {
    fontSize: 15,
  },
  chevron: {
    fontSize: 24,
    fontWeight: "300",
  },
  // Theme selector
  themeSelector: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 4,
    gap: 4,
  },
  themeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  themeOptionIcon: {
    fontSize: 16,
  },
  themeOptionLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  // Footer
  footer: {
    alignItems: "center",
    paddingTop: 12,
  },
  footerText: {
    fontSize: 12,
    fontWeight: "500",
  },
});
