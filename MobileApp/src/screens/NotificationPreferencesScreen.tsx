import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, Switch } from "react-native";
import { useTheme } from "../theme";
import { useHaptics } from "../hooks/useHaptics";
import {
  getNotificationPreferences,
  setNotificationPreferences,
  type NotificationPreferences,
} from "../storage/preferences";

interface PrefRowProps {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

function PrefRow({
  label,
  description,
  value,
  onValueChange,
}: PrefRowProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      className="flex-row justify-between items-center p-4 rounded-2xl mb-2.5 bg-bg-elevated shadow-sm"
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={`${label}. ${description}`}
    >
      <View className="flex-1 mr-3">
        <Text className="text-base font-medium text-text-primary">
          {label}
        </Text>
        <Text className="text-[13px] mt-0.5 leading-[18px] text-text-tertiary">
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: theme.colors.backgroundTertiary,
          true: theme.colors.actionPrimary,
        }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export default function NotificationPreferencesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { selectionFeedback } = useHaptics();
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    incidents: true,
    alerts: true,
    incidentEpisodes: true,
    alertEpisodes: true,
    criticalOnly: false,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getNotificationPreferences().then((p: NotificationPreferences) => {
      setPrefs(p);
      setLoaded(true);
    });
  }, []);

  const updatePref: (
    key: keyof NotificationPreferences,
    value: boolean,
  ) => void = useCallback(
    (key: keyof NotificationPreferences, value: boolean) => {
      selectionFeedback();
      const updated: NotificationPreferences = { ...prefs, [key]: value };
      setPrefs(updated);
      setNotificationPreferences(updated);
    },
    [prefs, selectionFeedback],
  );

  if (!loaded) {
    return (
      <View
        className="flex-1"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
      />
    );
  }

  return (
    <ScrollView
      className="bg-bg-primary"
      contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
    >
      {/* Event Types */}
      <View className="mb-7">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-1 ml-1 text-text-secondary">
          Event Types
        </Text>
        <Text className="text-xs mb-3 ml-1 leading-4 text-text-tertiary">
          Choose which event types send push notifications
        </Text>

        <View className="gap-px">
          <PrefRow
            label="Incidents"
            description="New incidents and state changes"
            value={prefs.incidents}
            onValueChange={(v: boolean) => {
              return updatePref("incidents", v);
            }}
          />
          <PrefRow
            label="Alerts"
            description="New alerts and state changes"
            value={prefs.alerts}
            onValueChange={(v: boolean) => {
              return updatePref("alerts", v);
            }}
          />
          <PrefRow
            label="Incident Episodes"
            description="Grouped incident notifications"
            value={prefs.incidentEpisodes}
            onValueChange={(v: boolean) => {
              return updatePref("incidentEpisodes", v);
            }}
          />
          <PrefRow
            label="Alert Episodes"
            description="Grouped alert notifications"
            value={prefs.alertEpisodes}
            onValueChange={(v: boolean) => {
              return updatePref("alertEpisodes", v);
            }}
          />
        </View>
      </View>

      {/* Priority Filter */}
      <View className="mb-7">
        <Text className="text-[13px] font-semibold uppercase tracking-widest mb-2.5 ml-1 text-text-secondary">
          Priority
        </Text>

        <View className="gap-px">
          <PrefRow
            label="Critical Only"
            description="Only receive notifications for critical and high severity events"
            value={prefs.criticalOnly}
            onValueChange={(v: boolean) => {
              return updatePref("criticalOnly", v);
            }}
          />
        </View>
      </View>

      {/* Info */}
      <View className="mt-1 px-1">
        <Text className="text-xs leading-[18px] text-text-tertiary">
          Notification preferences are stored locally on this device.
          Server-side notification rules configured in your project settings
          take precedence.
        </Text>
      </View>
    </ScrollView>
  );
}
