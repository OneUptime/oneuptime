import React, { useState, useEffect } from "react";
import { View, Text, ScrollView, Switch, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
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
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 16,
        minHeight: 52,
        ...(!isLast
          ? {
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.borderSubtle,
            }
          : {}),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
        {iconName ? (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 12,
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
          style={{
            fontSize: 15,
            fontWeight: "500",
            paddingVertical: 12,
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
          <Text style={{ fontSize: 14, color: theme.colors.textTertiary }}>
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
      <Pressable
        onPress={onPress}
        style={({ pressed }: { pressed: boolean }) => {
          return { opacity: pressed ? 0.7 : 1 };
        }}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

export default function SettingsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { logout } = useAuth();
  const biometric: ReturnType<typeof useBiometric> = useBiometric();
  const { selectionFeedback } = useHaptics();
  const [serverUrl, setServerUrlState] = useState("");

  useEffect(() => {
    getServerUrl().then(setServerUrlState);
  }, []);

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
        style={{
          borderRadius: 24,
          overflow: "hidden",
          padding: 20,
          marginBottom: 24,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          shadowColor: "#000",
          shadowOpacity: 0.28,
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

        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#000000",
              borderWidth: 1,
              borderColor: "#1F1F1F",
            }}
          >
            <Logo size={52} />
          </View>

          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text
              style={{
                fontSize: 20,
                fontWeight: "bold",
                color: theme.colors.textPrimary,
                letterSpacing: -0.3,
              }}
            >
              Preferences
            </Text>
            <Text
              style={{
                fontSize: 12,
                marginTop: 2,
                color: theme.colors.textSecondary,
                letterSpacing: 0.2,
              }}
            >
              Personalize your OneUptime experience
            </Text>
          </View>
        </View>

        <View
          style={{
            marginTop: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              textTransform: "uppercase",
              color: theme.colors.textTertiary,
              letterSpacing: 1,
            }}
          >
            Connected to
          </Text>

          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 8,
              backgroundColor: theme.colors.accentCyanBg,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                color: theme.colors.accentCyan,
              }}
            >
              {serverUrl || "oneuptime.com"}
            </Text>
          </View>
        </View>
      </View>

      {/* Security */}
      {biometric.isAvailable ? (
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              textTransform: "uppercase",
              marginBottom: 8,
              marginLeft: 4,
              color: theme.colors.textTertiary,
              letterSpacing: 0.8,
            }}
          >
            Security
          </Text>
          <View
            style={{
              borderRadius: 16,
              overflow: "hidden",
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
            style={{
              fontSize: 12,
              marginTop: 6,
              marginLeft: 4,
              lineHeight: 16,
              color: theme.colors.textTertiary,
            }}
          >
            Require biometrics to unlock the app
          </Text>
        </View>
      ) : null}

      {/* Server */}
      <View style={{ marginBottom: 24 }}>
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            textTransform: "uppercase",
            marginBottom: 8,
            marginLeft: 4,
            color: theme.colors.textTertiary,
            letterSpacing: 0.8,
          }}
        >
          Server
        </Text>
        <View
          style={{
            borderRadius: 16,
            overflow: "hidden",
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
      <View style={{ marginBottom: 24 }}>
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            textTransform: "uppercase",
            marginBottom: 8,
            marginLeft: 4,
            color: theme.colors.textTertiary,
            letterSpacing: 0.8,
          }}
        >
          Account
        </Text>
        <View
          style={{
            borderRadius: 16,
            overflow: "hidden",
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
      <View style={{ marginBottom: 24 }}>
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            textTransform: "uppercase",
            marginBottom: 8,
            marginLeft: 4,
            color: theme.colors.textTertiary,
            letterSpacing: 0.8,
          }}
        >
          About
        </Text>
        <View
          style={{
            borderRadius: 16,
            overflow: "hidden",
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
      <View style={{ paddingTop: 8, paddingBottom: 8 }}>
        <View
          style={{
            borderRadius: 16,
            overflow: "hidden",
            paddingHorizontal: 16,
            paddingVertical: 16,
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              backgroundColor: theme.colors.actionPrimary,
              opacity: 0.45,
            }}
          />

          <View
            style={{ alignItems: "center", marginTop: 4, marginBottom: 10 }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.colors.iconBackground,
                }}
              >
                <Ionicons
                  name="heart-outline"
                  size={16}
                  color={theme.colors.actionPrimary}
                />
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 9999,
                  backgroundColor: theme.colors.iconBackground,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "600",
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
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.textPrimary,
              textAlign: "center",
            }}
          >
            Thank you for supporting open source software.
          </Text>
          <Text
            style={{
              fontSize: 12,
              marginTop: 8,
              lineHeight: 20,
              color: theme.colors.textSecondary,
              textAlign: "center",
            }}
          >
            Built and maintained by contributors around the world.
          </Text>

          <View style={{ alignItems: "center", marginTop: 12 }}>
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 9999,
                backgroundColor: theme.colors.backgroundTertiary,
                borderWidth: 1,
                borderColor: theme.colors.borderSubtle,
              }}
            >
              <Text style={{ fontSize: 11, color: theme.colors.textTertiary }}>
                Licensed under Apache 2.0
              </Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
