import React, { useState, useEffect } from "react";
import {
  View,
  ScrollView,
  Switch,
  Pressable,
  Alert,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  darkColors,
  lightColors,
  useTheme,
  type AppearancePreference,
  type ColorTokens,
  type Theme,
} from "../theme";
import { radius, spacing } from "../theme/tokens";
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
import AppText from "../components/AppText";
import Card from "../components/Card";
import { ListGroup, ListItem } from "../components/ListGroup";
import ScreenIntro from "../components/ScreenIntro";
import type { SettingsStackParamList } from "../navigation/types";
import { getInitials } from "../utils/text";

type SettingsNavigationProp = NativeStackNavigationProp<
  SettingsStackParamList,
  "SettingsList"
>;

type IconName = keyof typeof Ionicons.glyphMap;

/*
 * Native switches take their colours as props, so they cannot inherit the
 * theme. The "on" thumb uses the label colour of filled controls; the "off"
 * thumb stays light on light surfaces and becomes a mid-tone on dark ones, so
 * it never disappears into its track.
 */
function getSwitchColors(
  theme: Theme,
  value: boolean,
): {
  trackColor: { false: string; true: string };
  thumbColor: string;
  ios_backgroundColor: string;
} {
  return {
    trackColor: {
      false: theme.colors.borderDefault,
      true: theme.colors.actionPrimary,
    },
    thumbColor: value
      ? theme.colors.textInverse
      : theme.dark
        ? theme.colors.textSecondary
        : theme.colors.backgroundElevated,
    ios_backgroundColor: theme.colors.borderDefault,
  };
}

interface AppearanceOption {
  key: AppearancePreference;
  label: string;
  hint: string;
}

const appearanceOptions: ReadonlyArray<AppearanceOption> = [
  {
    key: "system",
    label: "System",
    hint: "Match your device's light or dark setting.",
  },
  { key: "light", label: "Light", hint: "Always use the light appearance." },
  { key: "dark", label: "Dark", hint: "Always use the dark appearance." },
];

/*
 * A miniature of the screen in each palette. It deliberately reads BOTH
 * palettes, whatever is showing now, so "Dark" previews dark even while the
 * app is light. "System" is split down the middle.
 */
function AppearanceSwatch({
  preference,
}: {
  preference: AppearancePreference;
}): React.JSX.Element {
  const { theme } = useTheme();
  const palettes: Array<ColorTokens> =
    preference === "system"
      ? [lightColors, darkColors]
      : [preference === "dark" ? darkColors : lightColors];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: "100%",
        maxWidth: 76,
        height: 46,
        flexDirection: "row",
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: theme.colors.borderDefault,
        overflow: "hidden",
      }}
    >
      {palettes.map((palette: ColorTokens, index: number) => {
        return (
          <View
            key={index}
            style={{
              flex: 1,
              padding: spacing.xs + 1,
              gap: spacing.xs - 1,
              backgroundColor: palette.backgroundPrimary,
            }}
          >
            <View
              style={{
                width: "55%",
                height: 5,
                borderRadius: 3,
                backgroundColor: palette.actionPrimary,
              }}
            />
            <View
              style={{
                flex: 1,
                borderRadius: 3,
                borderWidth: 1,
                borderColor: palette.borderSubtle,
                backgroundColor: palette.backgroundElevated,
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

function AppearancePicker({
  onChange,
}: {
  onChange: () => void;
}): React.JSX.Element {
  const { theme, preference, setPreference } = useTheme();

  return (
    <View
      testID="settings-appearance"
      accessibilityRole="radiogroup"
      accessibilityLabel="Appearance"
      style={{
        flexDirection: "row",
        gap: spacing.sm,
        padding: spacing.md,
      }}
    >
      {appearanceOptions.map((option: AppearanceOption) => {
        const selected: boolean = option.key === preference;
        return (
          <Pressable
            key={option.key}
            testID={`settings-appearance-${option.key}`}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityHint={option.hint}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => {
              if (selected) {
                return;
              }
              setPreference(option.key);
              onChange();
            }}
            style={({
              pressed,
            }: {
              pressed: boolean;
            }): StyleProp<ViewStyle> => {
              return {
                flex: 1,
                minWidth: 0,
                minHeight: 112,
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.sm,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: selected
                  ? theme.colors.actionPrimary
                  : theme.colors.borderSubtle,
                backgroundColor: selected
                  ? theme.colors.cardAccent
                  : pressed
                    ? theme.colors.backgroundTertiary
                    : theme.colors.backgroundElevated,
              };
            }}
          >
            <AppearanceSwatch preference={option.key} />
            <AppText
              variant="subhead"
              weight={selected ? "700" : "500"}
              color={
                selected ? theme.colors.actionPrimary : theme.colors.textPrimary
              }
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {option.label}
            </AppText>
            <Ionicons
              name={selected ? "radio-button-on" : "radio-button-off"}
              size={18}
              color={
                selected
                  ? theme.colors.actionPrimary
                  : theme.colors.textTertiary
              }
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Help or status text under a group, with an icon that repeats its tone. */
function GroupFootnote({
  tone,
  icon,
  isAlert = false,
  testID,
  children,
}: {
  tone: "danger" | "success";
  icon: IconName;
  isAlert?: boolean;
  testID?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.xs + 2,
        marginHorizontal: spacing.xs,
      }}
    >
      <Ionicons
        name={icon}
        size={15}
        color={
          tone === "danger"
            ? theme.colors.statusError
            : theme.colors.statusSuccess
        }
        style={{ marginTop: 2 }}
      />
      <AppText
        variant="footnote"
        tone={tone}
        accessibilityRole={isAlert ? "alert" : undefined}
        accessibilityLiveRegion="polite"
        style={{ flex: 1 }}
      >
        {children}
      </AppText>
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

  const initials: string = getInitials(user?.name?.trim() || user?.email);

  return (
    <ScrollView
      testID="settings-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom,
        gap: spacing.xxl,
      }}
    >
      <ScreenIntro
        title="Settings"
        description="Your account, workspace and preferences."
        compact
        style={{ marginBottom: 0 }}
      />

      <Card testID="settings-account-identity">
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md + 2,
          }}
        >
          <View
            testID="settings-account-avatar"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.actionPrimary,
            }}
          >
            {initials ? (
              <AppText variant="title3" weight="700" tone="inverse">
                {initials}
              </AppText>
            ) : (
              <Ionicons
                name="person"
                size={26}
                color={theme.colors.textInverse}
              />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
            <AppText variant="title3" numberOfLines={2}>
              {user?.name || "Your account"}
            </AppText>
            <AppText variant="subhead" tone="secondary" selectable>
              {user?.email || "Signed in to OneUptime"}
            </AppText>
          </View>
        </View>
      </Card>

      <ListGroup title="Workspace" testID="settings-workspace-section">
        <ListItem
          title="Manage Projects"
          subtitle="Project access and single sign-on"
          icon="grid-outline"
          onPress={() => {
            navigation.navigate("ProjectsList");
          }}
        />
        <ListItem
          title="Server URL"
          value={serverUrl || "Loading server…"}
          icon="globe-outline"
          selectableValue
        />
      </ListGroup>

      <ListGroup
        title="Appearance"
        testID="settings-section-appearance"
        footer="System follows your device's light or dark setting."
      >
        <AppearancePicker onChange={selectionFeedback} />
      </ListGroup>

      {criticalAlerts.isSupported ? (
        <View
          testID="settings-section-notifications"
          style={{ gap: spacing.sm }}
        >
          <ListGroup title="Notifications">
            <ListItem
              title="Critical On-Call Alerts"
              icon="notifications-outline"
              subtitle="Only urgent on-call notifications override silent mode or Do Not Disturb."
              trailing={
                <Switch
                  accessibilityLabel="Critical On-Call Alerts"
                  accessibilityHint="Allow urgent on-call notifications to override silent mode."
                  value={criticalAlerts.isEnabled}
                  onValueChange={handleCriticalAlertsToggle}
                  disabled={criticalAlerts.isBusy}
                  {...getSwitchColors(theme, criticalAlerts.isEnabled)}
                />
              }
            />
          </ListGroup>
          {criticalAlerts.error ? (
            <GroupFootnote
              testID="settings-critical-alerts-error"
              tone="danger"
              icon="alert-circle"
              isAlert
            >
              {criticalAlerts.error}
            </GroupFootnote>
          ) : criticalAlerts.isEnabled && criticalAlerts.statusMessage ? (
            <GroupFootnote
              testID="settings-critical-alerts-status"
              tone="success"
              icon="checkmark-circle"
            >
              {criticalAlerts.statusMessage}
            </GroupFootnote>
          ) : null}
        </View>
      ) : null}

      {biometric.isAvailable ? (
        <ListGroup title="Security" testID="settings-section-security">
          <ListItem
            title="Biometrics Login"
            subtitle="Require biometrics to unlock the app"
            icon="finger-print-outline"
            trailing={
              <Switch
                accessibilityLabel="Biometrics Login"
                accessibilityHint="Require your fingerprint, face, or device passcode when opening OneUptime."
                value={biometric.isEnabled}
                onValueChange={handleBiometricToggle}
                {...getSwitchColors(theme, biometric.isEnabled)}
              />
            }
          />
        </ListGroup>
      ) : null}

      {calendarFeed.isAvailable ? (
        <ListGroup title="On-Call" testID="settings-section-oncall">
          <ListItem
            testID="settings-row-calendar-feed"
            title="Calendar feed"
            subtitle="Subscribe to your on-call shifts from Google, Outlook or Apple Calendar"
            icon="calendar-outline"
            onPress={() => {
              navigation.navigate("OnCallCalendarFeed");
            }}
          />
        </ListGroup>
      ) : null}

      <ListGroup title="Account" testID="settings-section-account">
        <ListItem
          title="Log Out"
          subtitle="Sign out of this device."
          icon="log-out-outline"
          onPress={confirmLogout}
          destructive
        />
      </ListGroup>

      <View
        testID="settings-footer"
        style={{ alignItems: "center", gap: spacing.xs }}
      >
        <AppText variant="footnote" tone="secondary" align="center">
          OneUptime · Version {Constants.expoConfig?.version || "unknown"}
        </AppText>
        <AppText variant="footnote" tone="tertiary" align="center">
          Built with care by the open source community.
        </AppText>
      </View>
    </ScrollView>
  );
}
