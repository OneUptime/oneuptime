import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Switch,
  Pressable,
  Alert,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useAuth } from "../hooks/useAuth";
import { useBiometric } from "../hooks/useBiometric";
import {
  useCriticalAlerts,
  type CriticalAlertsState,
} from "../hooks/useCriticalAlerts";
import { useHaptics } from "../hooks/useHaptics";
import { useOnCallCalendarFeedAvailability } from "../hooks/useOnCallCalendarFeedAvailability";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { getServerUrl } from "../storage/serverUrl";
import ScreenIntro from "../components/ScreenIntro";
import type { SettingsStackParamList } from "../navigation/types";

type SettingsNavigationProp = NativeStackNavigationProp<
  SettingsStackParamList,
  "SettingsList"
>;

interface SettingsRowProps {
  label: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  destructive?: boolean;
  iconName: keyof typeof Ionicons.glyphMap;
  testID?: string;
}

function SettingsRow({
  label,
  description,
  value,
  onPress,
  rightElement,
  destructive,
  iconName,
  testID,
}: SettingsRowProps): React.JSX.Element {
  const { theme } = useTheme();
  const content: React.JSX.Element = (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 16,
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: destructive
            ? theme.colors.statusErrorBg
            : theme.colors.iconBackground,
        }}
      >
        <Ionicons
          name={iconName}
          size={18}
          color={
            destructive
              ? theme.colors.actionDestructive
              : theme.colors.actionPrimary
          }
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 23,
            fontWeight: "600",
            color: destructive
              ? theme.colors.actionDestructive
              : theme.colors.textPrimary,
          }}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={{
              fontSize: 13,
              lineHeight: 20,
              marginTop: 2,
              color: theme.colors.textSecondary,
            }}
          >
            {description}
          </Text>
        ) : null}
        {value ? (
          <Text
            selectable
            style={{
              fontSize: 14,
              lineHeight: 21,
              marginTop: 4,
              color: theme.colors.textSecondary,
            }}
          >
            {value}
          </Text>
        ) : null}
      </View>
      {rightElement ??
        (onPress ? (
          <Ionicons
            name="chevron-forward"
            size={20}
            color={theme.colors.textTertiary}
          />
        ) : null)}
    </View>
  );
  const surface: ViewStyle = {
    backgroundColor: theme.colors.backgroundSecondary,
  };
  return onPress ? (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => {
        return [surface, { opacity: pressed ? 0.7 : 1 }];
      }}
    >
      {content}
    </Pressable>
  ) : (
    <View testID={testID} style={surface}>
      {content}
    </View>
  );
}

function SettingsSection({
  title,
  children,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View testID={testID} style={{ marginBottom: 24 }}>
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 12,
          letterSpacing: 1,
          fontWeight: "700",
          color: theme.colors.textTertiary,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.colors.borderSubtle,
          backgroundColor: theme.colors.backgroundSecondary,
          overflow: "hidden",
        }}
      >
        {React.Children.toArray(children).map(
          (child: React.ReactNode, index: number): React.JSX.Element => {
            return (
              <View
                key={index}
                style={
                  index > 0
                    ? {
                        borderTopWidth: 1,
                        borderTopColor: theme.colors.borderSubtle,
                      }
                    : undefined
                }
              >
                {child}
              </View>
            );
          },
        )}
      </View>
    </View>
  );
}

export default function SettingsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { logout, user } = useAuth();
  const navigation: SettingsNavigationProp =
    useNavigation<SettingsNavigationProp>();
  const biometric: ReturnType<typeof useBiometric> = useBiometric();
  const criticalAlerts: CriticalAlertsState = useCriticalAlerts();
  const calendarFeed: ReturnType<typeof useOnCallCalendarFeedAvailability> =
    useOnCallCalendarFeedAvailability();
  const { selectionFeedback } = useHaptics();
  const paddingBottom: number = useScreenPadding();
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

  const handleCriticalAlertsToggle: (value: boolean) => Promise<void> = async (
    value: boolean,
  ): Promise<void> => {
    await criticalAlerts.setEnabled(value);
    if (value) {
      selectionFeedback();
    }
  };

  const confirmLogout: () => void = (): void => {
    Alert.alert(
      "Log out of OneUptime?",
      "You will need to sign in again to access your workspace.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out",
          style: "destructive",
          onPress: () => {
            void logout();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      testID="settings-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom }}
    >
      <ScreenIntro
        title="Settings"
        description="Your account, workspace and preferences."
        compact
      />

      <View
        testID="settings-account-identity"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          paddingVertical: 8,
          marginBottom: 28,
        }}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.iconBackground,
          }}
        >
          <Ionicons
            name="person-outline"
            size={24}
            color={theme.colors.actionPrimary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 20,
              fontWeight: "700",
              lineHeight: 27,
              color: theme.colors.textPrimary,
            }}
          >
            {user?.name || "Your account"}
          </Text>
          <Text
            selectable
            style={{
              fontSize: 14,
              lineHeight: 21,
              marginTop: 3,
              color: theme.colors.textSecondary,
            }}
          >
            {user?.email || "Signed in to OneUptime"}
          </Text>
        </View>
      </View>

      <SettingsSection title="Workspace" testID="settings-workspace-section">
        <SettingsRow
          label="Manage Projects"
          description="Project access and single sign-on"
          iconName="grid-outline"
          onPress={() => {
            navigation.navigate("ProjectsList");
          }}
        />
        <SettingsRow
          label="Server URL"
          value={serverUrl || "Loading server…"}
          iconName="globe-outline"
        />
      </SettingsSection>

      {criticalAlerts.isSupported ? (
        <SettingsSection title="Notifications">
          <SettingsRow
            label="Critical On-Call Alerts"
            iconName="notifications-outline"
            description="Only urgent on-call notifications override silent mode or Do Not Disturb."
            rightElement={
              <Switch
                accessibilityLabel="Critical On-Call Alerts"
                accessibilityHint="Allow urgent on-call notifications to override silent mode."
                value={criticalAlerts.isEnabled}
                onValueChange={handleCriticalAlertsToggle}
                disabled={criticalAlerts.isBusy}
                trackColor={{
                  false: theme.colors.backgroundTertiary,
                  true: theme.colors.actionPrimary,
                }}
                thumbColor="#FFFFFF"
              />
            }
          />
          {criticalAlerts.error ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={{
                padding: 16,
                fontSize: 14,
                marginTop: 12,
                lineHeight: 21,
                color: theme.colors.statusError,
              }}
            >
              {criticalAlerts.error}
            </Text>
          ) : criticalAlerts.isEnabled && criticalAlerts.statusMessage ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                padding: 16,
                fontSize: 14,
                marginTop: 12,
                lineHeight: 21,
                color: theme.colors.statusSuccess,
              }}
            >
              {criticalAlerts.statusMessage}
            </Text>
          ) : null}
        </SettingsSection>
      ) : null}

      {biometric.isAvailable ? (
        <SettingsSection title="Security">
          <SettingsRow
            label="Biometrics Login"
            description="Require biometrics to unlock the app"
            iconName="finger-print-outline"
            rightElement={
              <Switch
                accessibilityLabel="Biometrics Login"
                accessibilityHint="Require your fingerprint, face, or device passcode when opening OneUptime."
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
        </SettingsSection>
      ) : null}

      {calendarFeed.isAvailable ? (
        <SettingsSection title="On-Call" testID="settings-section-oncall">
          <SettingsRow
            testID="settings-row-calendar-feed"
            label="Calendar feed"
            description="Subscribe to your on-call shifts from Google, Outlook or Apple Calendar"
            iconName="calendar-outline"
            onPress={() => {
              navigation.navigate("OnCallCalendarFeed");
            }}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title="Account">
        <SettingsRow
          label="Log Out"
          description="Sign out of this device."
          iconName="log-out-outline"
          onPress={confirmLogout}
          destructive
        />
      </SettingsSection>

      <View style={{ alignItems: "center", paddingTop: 8, gap: 8 }}>
        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
          OneUptime · Version {Constants.expoConfig?.version || "unknown"}
        </Text>
        <Text
          style={{
            fontSize: 14,
            lineHeight: 21,
            color: theme.colors.textTertiary,
            textAlign: "center",
          }}
        >
          Built with care by the open source community.
        </Text>
      </View>
    </ScrollView>
  );
}
